/**
 * Centralized Redis key namespace.
 *
 * Every key Sentinel writes flows through these helpers. This is a non-negotiable
 * boundary — a typo elsewhere is a silent data corruption bug. Mods who uninstall
 * the app rely on `clearAll()` finding every key we ever wrote.
 *
 * Namespace layout:
 *
 *   s:u:{userId}              hash    — UserRecord (JSON-encoded fields)
 *   s:u:{userId}:traj         zset    — TrajectoryPoint (score → JSON)
 *   s:watch                   zset    — userId → score, used for watchlist
 *   s:active                  zset    — userId → lastEventAt, used by decay job
 *   s:evader:{userId}         string  — EvaderFingerprint (JSON)
 *   s:evader:index            set     — set of evader userIds for enumeration
 *   s:community               hash    — CommunityHealth snapshot
 *   s:community:history       zset    — timestamp → JSON({t,health})
 *   s:settings                hash    — SentinelSettings (JSON-encoded fields)
 *   s:alert:{id}              string  — Alert (JSON), TTL 30d
 *   s:alert:feed              zset    — createdAt → alertId
 *   s:alert:dedup:{u}:{kind}  string  — TTL marker for dedup
 *   s:df                      hash    — n-gram → document frequency (subreddit baseline)
 *   s:df:totalDocs            string  — total docs in DF map
 *   s:exempt                  set     — userIds excluded from scoring
 *   s:meta:schema             string  — schema version sentinel
 */

const NS = "s";

export const Keys = {
  user(userId: string): string {
    return `${NS}:u:${userId}`;
  },
  userTrajectory(userId: string): string {
    return `${NS}:u:${userId}:traj`;
  },
  watchlist(): string {
    return `${NS}:watch`;
  },
  activeIndex(): string {
    return `${NS}:active`;
  },
  evader(userId: string): string {
    return `${NS}:evader:${userId}`;
  },
  evaderIndex(): string {
    return `${NS}:evader:index`;
  },
  community(): string {
    return `${NS}:community`;
  },
  communityHistory(): string {
    return `${NS}:community:history`;
  },
  settings(): string {
    return `${NS}:settings`;
  },
  alert(id: string): string {
    return `${NS}:alert:${id}`;
  },
  alertFeed(): string {
    return `${NS}:alert:feed`;
  },
  alertDedup(userId: string, kind: string): string {
    return `${NS}:alert:dedup:${userId}:${kind}`;
  },
  documentFrequencies(): string {
    return `${NS}:df`;
  },
  documentFrequencyTotal(): string {
    return `${NS}:df:totalDocs`;
  },
  exempt(): string {
    return `${NS}:exempt`;
  },
  schemaVersion(): string {
    return `${NS}:meta:schema`;
  },
} as const;
