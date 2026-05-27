/**
 * Tunable defaults. Every threshold can be overridden by mods via Devvit settings;
 * these are the values Sentinel ships with so installation requires zero config.
 *
 * Values are chosen to be conservative — false positives are far more costly than
 * delayed detection for mod-trust reasons. Mods who want sharper sensitivity dial
 * down `thresholdWatching` / `thresholdElevated`.
 */

export const SCHEMA_VERSION = 1 as const;

/** EMA half-life expressed in days. Used by `decay.ts` to derive α. */
export const DEFAULT_DECAY_WINDOW_DAYS = 30 as const;

/** State machine thresholds — score is in [0, 1]. */
export const DEFAULT_THRESHOLD_WATCHING = 0.2 as const;
export const DEFAULT_THRESHOLD_ELEVATED = 0.45 as const;
export const DEFAULT_THRESHOLD_CRITICAL = 0.7 as const;

/** Hysteresis windows: time a pending state must persist before committing. */
export const DEFAULT_ESCALATE_DAYS = 3 as const;
export const DEFAULT_DEESCALATE_DAYS = 7 as const;

/** Ban-evader detection: cosine similarity cutoff in [0, 1] (higher = stricter). */
export const DEFAULT_EVADER_SIMILARITY = 0.78 as const;

/** Per-feature weights for composite score. Sum to 1.0. */
export const FEATURE_WEIGHTS = {
  velocity: 0.12,
  removalRate: 0.3,
  controversyAffinity: 0.18,
  warningResponse: 0.22,
  timeSignature: 0.06,
  vocabularyFingerprint: 0.12,
} as const;

/** Maximum n-grams to retain per user. Caps Redis hash size. */
export const MAX_NGRAMS_PER_USER = 50 as const;

/** Maximum trajectory points retained per user. */
export const MAX_TRAJECTORY_POINTS = 90 as const;

/** Number of trailing days of community-health history we keep. */
export const COMMUNITY_HISTORY_DAYS = 30 as const;

/** Alert dedup TTL — same user/transition won't re-alert within this window. */
export const ALERT_DEDUP_SECONDS = 6 * 60 * 60;

/** Minimum events before a user's score is treated as meaningful. */
export const MIN_EVENTS_FOR_SCORING = 2 as const;

/** Cap on number of users surfaced in the watchlist payload. */
export const WATCHLIST_LIMIT = 100 as const;

/** Sentinel never stores raw content. We retain only n-gram counts. */
export const RAW_CONTENT_RETAINED = false as const;
