/**
 * Endpoint paths and their request/response contracts. The server's router
 * dispatches by string equality on these constants; the client imports the
 * same constants — no string duplication, full type safety end-to-end.
 */
import type {
  Alert,
  CommunityHealth,
  EvaderFingerprint,
  FeatureVector,
  SentinelSettings,
  TrajectoryPoint,
  UserRecord,
  UserState,
  UserSummary,
} from "./types.ts";

export const ApiEndpoint = {
  // dashboard read APIs
  Init: "/api/init",
  Overview: "/api/overview",
  Health: "/api/health",
  Watchlist: "/api/watchlist",
  Trajectory: "/api/trajectory",
  AlertsFeed: "/api/alerts",
  Evaders: "/api/evaders",
  DevSeed: "/api/dev/seed",
  DevReset: "/api/dev/reset",
  DebugUser: "/api/debug/user",

  // triggers
  TriggerAppInstall: "/internal/triggers/app-install",
  TriggerAppUpgrade: "/internal/triggers/app-upgrade",
  TriggerPostSubmit: "/internal/triggers/post-submit",
  TriggerPostCreate: "/internal/triggers/post-create",
  TriggerPostDelete: "/internal/triggers/post-delete",
  TriggerPostReport: "/internal/triggers/post-report",
  TriggerCommentSubmit: "/internal/triggers/comment-submit",
  TriggerCommentDelete: "/internal/triggers/comment-delete",
  TriggerCommentReport: "/internal/triggers/comment-report",
  TriggerModAction: "/internal/triggers/mod-action",

  // menu items
  MenuOpenDashboard: "/internal/menu/open-dashboard",
  MenuInspectPostAuthor: "/internal/menu/inspect-post-author",
  MenuInspectCommentAuthor: "/internal/menu/inspect-comment-author",
  MenuMarkEvaderFromPost: "/internal/menu/mark-evader-from-post",
  MenuExemptFromPost: "/internal/menu/exempt-from-post",
  MenuRecompute: "/internal/menu/recompute",

  // scheduled jobs
  JobCommunityDrift: "/internal/jobs/community-drift",
  JobDecayRefresh: "/internal/jobs/decay-refresh",
  JobStateRecompute: "/internal/jobs/state-recompute",
} as const;

export type ApiEndpoint = (typeof ApiEndpoint)[keyof typeof ApiEndpoint];

export type InitResponse = {
  readonly type: "init";
  readonly subreddit: string;
  readonly username: string;
  readonly settings: SentinelSettings;
  readonly health: CommunityHealth | null;
  readonly watchlist: readonly UserSummary[];
  readonly recentAlerts: readonly Alert[];
};

export type HealthResponse = {
  readonly type: "health";
  readonly health: CommunityHealth;
};

export type WatchlistResponse = {
  readonly type: "watchlist";
  readonly users: readonly UserSummary[];
  readonly cursor: string | null;
};

export type TrajectoryRequest = {
  readonly userId: string;
};

export type TrajectoryResponse = {
  readonly type: "trajectory";
  readonly user: UserRecord | null;
  readonly points: readonly TrajectoryPoint[];
};

export type AlertsFeedResponse = {
  readonly type: "alerts";
  readonly alerts: readonly Alert[];
};

export type EvadersResponse = {
  readonly type: "evaders";
  readonly evaders: readonly EvaderFingerprint[];
};

export type ErrorResponse = {
  readonly error: string;
  readonly status: number;
};

/** Compact summary row used by the attention table on the Overview tab. */
export type AttentionRow = {
  readonly userId: string;
  readonly username: string;
  readonly state: UserState;
  readonly score: number;
  /** Last-7-day score points for the per-row sparkline, length <= 7. */
  readonly spark: readonly number[];
  /** Top-2 driver attributions (feature + Δ vs 7-day baseline). */
  readonly topDrivers: readonly { readonly feature: keyof FeatureVector; readonly delta: number }[];
};

/** Item on the right-hand escalations timeline. */
export type EscalationEvent = {
  readonly id: string;
  readonly t: number;
  readonly kind: "entered" | "returned" | "evader";
  readonly toState: UserState;
  readonly fromState: UserState | null;
  readonly userId: string;
  readonly username: string;
  readonly drivers: readonly { readonly feature: keyof FeatureVector; readonly delta: number }[];
  readonly similarity?: number;
  readonly evaderMatchUsername?: string;
};

/** Five-card metrics row at the top of the overview. */
export type OverviewMetrics = {
  readonly healthIndex: number;
  readonly healthSpark: readonly number[];
  readonly healthDelta7d: number;
  readonly populationSize: number;
  readonly populationDelta7d: number;
  readonly watchingCount: number;
  readonly watchingDelta7d: number;
  readonly elevatedCount: number;
  readonly elevatedDelta7d: number;
  readonly criticalCount: number;
  readonly criticalDelta7d: number;
};

/** Top-drivers card: which features dominate community-wide risk right now. */
export type TopDriversBreakdown = {
  readonly feature: keyof FeatureVector;
  /** Average contribution to the community-wide risk total. */
  readonly contribution: number;
};

/** Compact row used by the "Recent activity" feed. */
export type RecentActivityRow = {
  readonly userId: string;
  readonly username: string;
  readonly state: UserState;
  readonly score: number;
  readonly lastEventAt: number;
  readonly submissions: number;
  readonly removals: number;
};

/** A pin for the currently-signed-in moderator so they can see their own
 *  trajectory without scrolling. */
export type SelfCard = {
  readonly userId: string;
  readonly username: string;
  readonly state: UserState;
  readonly score: number;
  readonly submissions: number;
  readonly removals: number;
  readonly lastEventAt: number;
  readonly firstSeenAt: number;
} | null;

/** Full payload that hydrates the Overview tab in one round trip. */
export type OverviewResponse = {
  readonly type: "overview";
  readonly subreddit: string;
  readonly username: string;
  readonly updatedAt: number;
  readonly metrics: OverviewMetrics;
  readonly attention: readonly AttentionRow[];
  readonly escalations: readonly EscalationEvent[];
  readonly communityTrend: readonly { readonly t: number; readonly health: number }[];
  readonly topDrivers: readonly TopDriversBreakdown[];
  readonly evaderMatchesPending: number;
  readonly recentActivity: readonly RecentActivityRow[];
  readonly you: SelfCard;
};

export type DevSeedResponse = {
  readonly type: "dev-seed";
  readonly inserted: number;
  readonly bannedUsers: number;
  readonly evaderCandidates: number;
};

export type DevResetResponse = {
  readonly type: "dev-reset";
  readonly deletedKeys: number;
};

/** Minimal payload shape passed to the inspect-user menu when navigated to. */
export type InspectPayload = {
  readonly userId: string;
  readonly username: string;
  readonly state: UserState;
};
