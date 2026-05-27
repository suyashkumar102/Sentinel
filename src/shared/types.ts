/**
 * Cross-boundary type contracts.
 *
 * Shared between the Devvit server actor and the dashboard webview client.
 * Everything here must be JSON-serializable: no Maps, no Dates, no functions.
 */

/**
 * The six dimensions of Sentinel's behavioral feature vector.
 *
 * Each axis is a value in [0, 1] after normalization, where higher = more concerning.
 * Read once and reason about all six together: a single rising axis is noise,
 * three rising axes is a trajectory.
 */
export type FeatureVector = {
  /** EMA of (posts + comments) per week. Rising activity precedes rising risk. */
  readonly velocity: number;
  /** EMA of (removals / submissions). The TREND matters more than the level. */
  readonly removalRate: number;
  /** Share of engagements that landed on locked / heavily-reported / removed threads. */
  readonly controversyAffinity: number;
  /** Δ(removal rate) measured across a moderator warning. <0 = responsive, >0 = defiant. */
  readonly warningResponse: number;
  /** Self-similarity of recent hour-of-day posting pattern vs a stable baseline. */
  readonly timeSignature: number;
  /** Vocabulary distinctiveness vs the subreddit baseline (TF-IDF on bigrams+trigrams). */
  readonly vocabularyFingerprint: number;
};

export const FEATURE_KEYS = [
  "velocity",
  "removalRate",
  "controversyAffinity",
  "warningResponse",
  "timeSignature",
  "vocabularyFingerprint",
] as const satisfies readonly (keyof FeatureVector)[];

/** Lifecycle state of a monitored user. Strictly ordered by escalation. */
export type UserState = "HEALTHY" | "WATCHING" | "ELEVATED" | "CRITICAL" | "BANNED";

export const USER_STATES = ["HEALTHY", "WATCHING", "ELEVATED", "CRITICAL", "BANNED"] as const;

/** Severity rank used for ordering and thresholds. Higher = more severe. */
export const STATE_RANK: Readonly<Record<UserState, number>> = {
  HEALTHY: 0,
  WATCHING: 1,
  ELEVATED: 2,
  CRITICAL: 3,
  BANNED: 4,
};

/** Full per-user record stored in Redis (serialized as JSON hash field). */
export type UserRecord = {
  readonly userId: string;
  readonly username: string;
  readonly features: FeatureVector;
  readonly score: number;
  readonly state: UserState;
  /** Unix ms timestamp when the user's score first crossed the current band. */
  readonly stateSince: number;
  /** Pending state, if we're inside a hysteresis window waiting to commit. */
  readonly pendingState: UserState | null;
  /** Unix ms timestamp when the pending state began. */
  readonly pendingSince: number | null;
  /** Total submissions counted toward the velocity EMA. */
  readonly submissions: number;
  /** Total mod removals counted toward the removalRate EMA. */
  readonly removals: number;
  /** Unix ms of the last event we processed for this user. */
  readonly lastEventAt: number;
  /** Unix ms of the user's first observed event. */
  readonly firstSeenAt: number;
  /** Unix ms of the last moderator warning observed (informs warningResponse). */
  readonly lastWarningAt: number | null;
  /** Removal rate snapshot AT the time of the most recent warning. */
  readonly removalRateAtWarning: number | null;
  /** Recent hour-of-day posting histogram (length 24, sums to 1 after normalization). */
  readonly hourHistogram: readonly number[];
  /** Recent top n-grams with raw counts (capped). */
  readonly ngramCounts: Readonly<Record<string, number>>;
  /** App schema version this record was written under. */
  readonly schema: number;
};

/** Read-only summary used in lists / cards. */
export type UserSummary = {
  readonly userId: string;
  readonly username: string;
  readonly score: number;
  readonly state: UserState;
  readonly stateSince: number;
  readonly velocity: number;
  readonly removalRate: number;
  readonly lastEventAt: number;
};

/** Trajectory point recorded at major state changes / job ticks. */
export type TrajectoryPoint = {
  readonly t: number;
  readonly score: number;
  readonly state: UserState;
};

/** Single ban-evader fingerprint stored after a user reaches BANNED. */
export type EvaderFingerprint = {
  readonly userId: string;
  readonly username: string;
  readonly bannedAt: number;
  readonly hourHistogram: readonly number[];
  readonly ngramCounts: Readonly<Record<string, number>>;
  readonly finalScore: number;
};

/** Community-level aggregate, recomputed daily by the drift job. */
export type CommunityHealth = {
  readonly subreddit: string;
  readonly computedAt: number;
  readonly populationSize: number;
  readonly activeLast7d: number;
  readonly medianScore: number;
  readonly meanScore: number;
  readonly stateDistribution: Readonly<Record<UserState, number>>;
  /** 0-100 (100 = healthiest). Derived from median score, distribution skew, drift. */
  readonly healthIndex: number;
  /** Δ healthIndex over the trailing 30-day window. Negative = drifting toxic. */
  readonly drift30d: number;
  /** Trailing 30-day health index history. */
  readonly history: readonly { readonly t: number; readonly health: number }[];
};

/** Alert emitted on state transitions to ELEVATED / CRITICAL. */
export type Alert = {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly createdAt: number;
  readonly fromState: UserState;
  readonly toState: UserState;
  readonly score: number;
  readonly drivers: readonly AlertDriver[];
  /** Brief human-readable rationale. */
  readonly rationale: string;
  /** Optional permalink to the most recent triggering content. */
  readonly contextLink: string | null;
};

/** Per-feature contribution explaining why an alert fired. */
export type AlertDriver = {
  readonly feature: keyof FeatureVector;
  readonly value: number;
  readonly weight: number;
  readonly contribution: number;
};

/** Settings shape exposed to the dashboard. */
export type SentinelSettings = {
  readonly decayWindowDays: number;
  readonly thresholdWatching: number;
  readonly thresholdElevated: number;
  readonly thresholdCritical: number;
  readonly escalateAfterDays: number;
  readonly deescalateAfterDays: number;
  readonly evaderSimilarityThreshold: number;
  readonly alertChannel: "modmail" | "modnote" | "both";
  readonly enabled: boolean;
  readonly exemptUsers: readonly string[];
};
