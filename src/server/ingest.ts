/**
 * The ingest pipeline.
 *
 * Every observable thing on Reddit — a new post, a removed comment, a mod
 * warning, an approval — flows through `ingest(event)`. This function:
 *
 *   1. Loads the user record (creating it if absent).
 *   2. Updates the six-feature vector via `applyEvent`.
 *   3. Folds the body text into the user's n-gram counts AND into the
 *      subreddit's document-frequency corpus.
 *   4. Recomputes the composite score.
 *   5. Runs the state machine; emits an alert if a transition committed.
 *   6. Appends a trajectory point.
 *   7. Persists the new record.
 *
 * This is the ONLY place state-altering logic lives. Trigger handlers are
 * thin: they unpack their payloads, build a `SentinelEvent`, and call ingest.
 */
import type { SentinelEvent } from "./core/features.ts";
import { applyEvent, distinctivenessFromTfIdf } from "./core/features.ts";
import { compositeScore } from "./core/score.ts";
import { decide } from "./core/state.ts";
import { capTopK, foldText, tfIdf } from "./core/ngrams.ts";
import { clamp01 } from "./core/decay.ts";
import type { FeatureVector, UserRecord } from "../shared/types.ts";
import { MAX_NGRAMS_PER_USER, MIN_EVENTS_FOR_SCORING, SCHEMA_VERSION } from "../shared/constants.ts";
import { getUser, newUserRecord, putUser } from "./storage/user.ts";
import { appendPoint } from "./storage/trajectory.ts";
import { bumpFrequencies, frequencies, incrTotalDocs, totalDocs } from "./storage/corpus.ts";
import { isExempt, readSettings } from "./storage/settings.ts";
import { emitTransitionAlert } from "./alerts.ts";

export type IngestResult = {
  readonly userBefore: UserRecord | null;
  readonly userAfter: UserRecord;
  readonly transitioned: boolean;
  readonly emittedAlert: boolean;
};

export async function ingest(event: SentinelEvent): Promise<IngestResult> {
  const settings = await readSettings();

  // Hard kill-switch: if mods disabled Sentinel, do nothing (keeps history intact).
  if (!settings.enabled) {
    const existing = (await getUser(event.userId)) ?? newUserRecord(event.userId, event.username, event.tMs);
    return {
      userBefore: existing,
      userAfter: existing,
      transitioned: false,
      emittedAlert: false,
    };
  }

  // Exempt users: pass through, never score.
  if (await isExempt(event.userId)) {
    const existing = (await getUser(event.userId)) ?? newUserRecord(event.userId, event.username, event.tMs);
    return {
      userBefore: existing,
      userAfter: existing,
      transitioned: false,
      emittedAlert: false,
    };
  }

  const previous = (await getUser(event.userId)) ?? newUserRecord(event.userId, event.username, event.tMs);

  // ── feature update ──
  const updated = applyEvent(previous, event, settings.decayWindowDays);

  // ── n-gram corpus update (submission only — comments + posts both qualify) ──
  let ngramCounts = previous.ngramCounts;
  let vocabularyFingerprint = updated.features.vocabularyFingerprint;
  if (event.kind === "submission" && event.body && event.body.length > 0) {
    const folded = foldText(previous.ngramCounts, event.body);
    ngramCounts = capTopK(folded, MAX_NGRAMS_PER_USER);

    const corpusKeys = Object.keys(ngramCounts);
    const df = await frequencies(corpusKeys);
    const total = Math.max(1, await totalDocs());
    const tfidfMap = tfIdf(ngramCounts, df, total);
    vocabularyFingerprint = distinctivenessFromTfIdf(tfidfMap);

    await bumpFrequencies(ngramCounts);
    await incrTotalDocs(1);
  }

  const features: FeatureVector = {
    ...updated.features,
    vocabularyFingerprint,
  };

  // ── scoring (only above the minimum-events floor) ──
  // totalEvents counts submissions + full removals + partial self-deletes.
  // self_delete contributes 0.4 to the removal counter (set in applyEvent),
  // so Math.floor gives us the integer event count for the floor check.
  const totalEvents = updated.submissions + Math.ceil(updated.removals);
  let score = 0;
  if (totalEvents >= MIN_EVENTS_FOR_SCORING) {
    const emaScore = compositeScore(features);
    // Blend EMA score with a direct removal ratio during early activity so
    // that even a small number of events registers visibly.
    // directWeight fades from 0.6 → 0 as totalEvents grows past ~50.
    const directWeight = Math.max(0, 0.6 - (totalEvents - MIN_EVENTS_FOR_SCORING) / 80);
    // Use the raw removal counter (which includes fractional self-deletes) for
    // the direct ratio — this naturally weights mod-removals higher than self-deletes.
    const directRatio = updated.removals / Math.max(1, updated.submissions + updated.removals);
    score = clamp01(emaScore * (1 - directWeight) + directRatio * directWeight);
  }

  // ── state machine ──
  // Force-commit the state immediately when the score is high enough —
  // bypassing the hysteresis dwell — so that a user with a very high removal
  // ratio (e.g. 3/4 = 75%) appears in the dashboard right away rather than
  // waiting 3 days. The dwell still applies for borderline scores.
  const IMMEDIATE_COMMIT_SCORE = 0.35; // above WATCHING (0.2), skip dwell

  // Use zero escalate days for high-confidence scores so they commit immediately.
  const escalateDays = score >= IMMEDIATE_COMMIT_SCORE ? 0 : settings.escalateAfterDays;

  const decision = decide(
    {
      currentState: previous.state,
      pendingState: previous.pendingState,
      pendingSince: previous.pendingSince,
      score,
      nowMs: event.tMs,
    },
    {
      watching: settings.thresholdWatching,
      elevated: settings.thresholdElevated,
      critical: settings.thresholdCritical,
    },
    {
      escalateDays,
      deescalateDays: settings.deescalateAfterDays,
    },
  );

  let resolvedUsername = event.username || previous.username;
  if (event.username && (event.username === event.userId || event.username.startsWith("t2_"))) {
    if (previous.username && !previous.username.startsWith("t2_") && previous.username !== previous.userId) {
      resolvedUsername = previous.username;
    }
  }

  const after: UserRecord = {
    userId: previous.userId,
    username: resolvedUsername,
    features,
    score,
    state: decision.nextState,
    stateSince: decision.transitioned ? event.tMs : previous.stateSince,
    pendingState: decision.pendingState,
    pendingSince: decision.pendingSince,
    submissions: updated.submissions,
    removals: updated.removals,
    lastEventAt: event.tMs,
    firstSeenAt: previous.firstSeenAt,
    lastWarningAt: updated.lastWarningAt,
    removalRateAtWarning: updated.removalRateAtWarning,
    hourHistogram: updated.hourHistogram,
    ngramCounts,
    schema: SCHEMA_VERSION,
  };

  await putUser(after);

  // Write a trajectory point on every state transition AND on every submission
  // event (so the dashboard shows activity even before the score crosses a
  // threshold). This ensures new users appear in the sparklines immediately.
  const shouldWritePoint =
    decision.transitioned ||
    event.kind === "submission" ||
    event.kind === "removal" ||
    event.kind === "self_delete";
  if (shouldWritePoint) {
    await appendPoint(after.userId, { t: event.tMs, score, state: after.state });
  }

  let emittedAlert = false;
  if (decision.transitioned) {
    emittedAlert = await emitTransitionAlert({
      previous,
      after,
      contextLink: null,
    });
  }

  return {
    userBefore: previous,
    userAfter: after,
    transitioned: decision.transitioned,
    emittedAlert,
  };
}

/**
 * Read-only recompute: pull a user's record, apply lazy decay forward to `now`,
 * and re-evaluate the state machine without consuming any new event. The decay
 * job uses this to keep scores moving for inactive users.
 */
export async function refreshUser(userId: string, nowMs: number): Promise<IngestResult | null> {
  const previous = await getUser(userId);
  if (!previous) return null;
  // Treat as a no-op "tick" event of kind "approval" with no body. This decays
  // every axis forward without contributing any observation.
  return ingest({
    kind: "approval",
    userId: previous.userId,
    username: previous.username,
    tMs: nowMs,
  });
}
