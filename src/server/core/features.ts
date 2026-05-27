/**
 * Per-event feature updates.
 *
 * Each function takes the current `UserRecord`, an `Event`, and returns the
 * new feature vector. Pure: no Redis, no clock, no Reddit API. The ingest
 * pipeline (`ingest.ts`) wires these to storage.
 *
 * Why factor it this way? Tests are trivial — give the function a record and
 * an event, assert the output. No mocks. No fakes. No flakiness.
 */
import type { FeatureVector, UserRecord } from "../../shared/types.ts";
import { addEvent, tightness } from "./histogram.ts";
import { clamp01, daysBetween, emaUpdateBounded } from "./decay.ts";

export type EventKind =
  | "submission"
  | "removal"           // mod explicitly removed via mod queue (strongest signal)
  | "self_delete"       // user deleted their own content (weak signal)
  | "approval"
  | "warning"
  | "report"
  | "controversy_engagement"
  | "ban";

export type SentinelEvent = {
  readonly kind: EventKind;
  readonly userId: string;
  readonly username: string;
  readonly tMs: number;
  /** Body for submissions/comments — drives n-gram & vocab fingerprint. May be empty. */
  readonly body?: string;
  /** Was the engagement on a thread that was later removed/locked/flagged? */
  readonly onFlaggedThread?: boolean;
};

/**
 * Apply an event to a user's feature vector. Returns the NEW vector and the
 * incremented submission/removal counters used for context. This function is
 * the single source of truth for how each axis moves on each event.
 */
export function applyEvent(
  prev: UserRecord,
  event: SentinelEvent,
  halfLifeDays: number,
): {
  features: FeatureVector;
  hourHistogram: number[];
  submissions: number;
  removals: number;
  lastWarningAt: number | null;
  removalRateAtWarning: number | null;
} {
  const deltaDays = daysBetween(prev.lastEventAt, event.tMs);

  // ── velocity ────────────────────────────────────────────────────────────────
  // Observation is the count of "actions" this event represents per week,
  // amortized over the elapsed window. Only submissions drive velocity up.
  // Non-submission events just decay the existing value forward — they do NOT
  // push a zero observation (which would actively suppress velocity).
  let velocity = prev.features.velocity;
  if (event.kind === "submission") {
    const window = Math.max(1 / 24, deltaDays); // at least one hour
    const velocityObs = clamp01(1 / window / 7); // submissions/week, normalized to [0, 1]
    velocity = emaUpdateBounded(prev.features.velocity, velocityObs, deltaDays, halfLifeDays);
  } else {
    // Decay forward only — no new observation.
    velocity = emaUpdateBounded(prev.features.velocity, prev.features.velocity, deltaDays, halfLifeDays);
  }

  // ── submissions / removals counters ─────────────────────────────────────────
  // self_delete counts as a fractional removal (0.4) for the counter so the
  // dashboard shows it, but doesn't inflate the removal count as much as a
  // full mod removal.
  const submissions = prev.submissions + (event.kind === "submission" ? 1 : 0);
  const removals =
    prev.removals +
    (event.kind === "removal" ? 1 : event.kind === "self_delete" ? 0.4 : 0);

  // ── removal rate ────────────────────────────────────────────────────────────
  // Observation values by event kind:
  //   submission  → 0.0  (good behaviour, pulls rate down)
  //   removal     → 1.0  (mod judged content bad — full signal)
  //   self_delete → 0.3  (user cleaned up — weak signal, could be innocent)
  //   others      → decay only, no new observation
  let removalRate = prev.features.removalRate;
  if (event.kind === "submission") {
    removalRate = emaUpdateBounded(removalRate, 0, deltaDays, halfLifeDays);
  } else if (event.kind === "removal") {
    removalRate = emaUpdateBounded(removalRate, 1.0, deltaDays, halfLifeDays);
  } else if (event.kind === "self_delete") {
    removalRate = emaUpdateBounded(removalRate, 0.3, deltaDays, halfLifeDays);
  } else {
    // decay forward only
    removalRate = emaUpdateBounded(removalRate, removalRate, deltaDays, halfLifeDays);
  }

  // ── controversy affinity ────────────────────────────────────────────────────
  let controversyAffinity = prev.features.controversyAffinity;
  if (event.kind === "controversy_engagement" || event.onFlaggedThread === true) {
    controversyAffinity = emaUpdateBounded(controversyAffinity, 1, deltaDays, halfLifeDays);
  } else if (event.kind === "submission") {
    controversyAffinity = emaUpdateBounded(controversyAffinity, 0, deltaDays, halfLifeDays);
  } else {
    controversyAffinity = emaUpdateBounded(
      controversyAffinity,
      controversyAffinity,
      deltaDays,
      halfLifeDays,
    );
  }

  // ── warning response ────────────────────────────────────────────────────────
  // After a warning, we expect removalRate to go DOWN. Defiant users hold or
  // increase. This axis encodes Δ(removalRate) since the warning, mapped to [0, 1]:
  //   responsive  (decrease): 0
  //   no change           : ~0.5
  //   defiant (increase)  : ~1
  let lastWarningAt = prev.lastWarningAt;
  let removalRateAtWarning = prev.removalRateAtWarning;
  let warningResponse = prev.features.warningResponse;

  if (event.kind === "warning") {
    lastWarningAt = event.tMs;
    removalRateAtWarning = removalRate;
    // Reset toward neutral on a fresh warning so the user has a clean window.
    warningResponse = emaUpdateBounded(warningResponse, 0.5, deltaDays, halfLifeDays);
  } else if (lastWarningAt !== null && removalRateAtWarning !== null) {
    const delta = removalRate - removalRateAtWarning;
    // Map Δ ∈ [-1, 1] → obs ∈ [0, 1].  Clamped & re-centered.
    const obs = clamp01(0.5 + delta * 0.5);
    warningResponse = emaUpdateBounded(warningResponse, obs, deltaDays, halfLifeDays);
  } else {
    warningResponse = emaUpdateBounded(warningResponse, warningResponse, deltaDays, halfLifeDays);
  }

  // ── time signature ──────────────────────────────────────────────────────────
  // Only update the histogram on events that represent user-initiated activity.
  // self_delete and removal are reactions to prior submissions, not new activity.
  const updateHistogram = event.kind === "submission" || event.kind === "report";
  const hist = updateHistogram
    ? addEvent(prev.hourHistogram, event.tMs, deltaDays, halfLifeDays)
    : (() => {
        // Decay buckets forward without adding a new event.
        const out = prev.hourHistogram.slice() as number[];
        for (let i = 0; i < 24; i++) {
          out[i] = (out[i] ?? 0) * Math.pow(0.5, deltaDays / halfLifeDays);
        }
        return out;
      })();
  const timeSignature = tightness(hist);

  // ── vocabulary fingerprint ──────────────────────────────────────────────────
  // The vocab axis is updated by `ingest.applyContent`; here we only decay it
  // forward so the rest of the vector stays time-aligned.
  const vocabularyFingerprint = emaUpdateBounded(
    prev.features.vocabularyFingerprint,
    prev.features.vocabularyFingerprint,
    deltaDays,
    halfLifeDays,
  );

  return {
    features: {
      velocity,
      removalRate,
      controversyAffinity,
      warningResponse,
      timeSignature,
      vocabularyFingerprint,
    },
    hourHistogram: hist,
    submissions,
    removals,
    lastWarningAt,
    removalRateAtWarning,
  };
}

/**
 * Update the vocabulary fingerprint AXIS — distinct from updating the raw
 * n-gram counts. This is the [0, 1] score that summarizes how distinctive a
 * user's writing is vs the subreddit baseline. It rises when a user's recent
 * n-grams differ sharply from the subreddit-wide distribution.
 *
 * The mechanism: we don't need a perfect score; we just need a stable input
 * to the composite score. Distinctiveness is the L1 distance between the
 * user's TF-IDF profile and the uniform document. We compress that into
 * [0, 1] via a tanh-like saturation.
 */
export function distinctivenessFromTfIdf(tfidf: Readonly<Record<string, number>>): number {
  const values = Object.values(tfidf);
  if (values.length === 0) return 0;
  let sumSq = 0;
  for (const v of values) sumSq += v * v;
  const magnitude = Math.sqrt(sumSq);
  // Saturating compression: magnitude 0 → 0, magnitude 1 → ~0.5, magnitude 3+ → ~0.95.
  return 1 - Math.exp(-magnitude);
}
