/**
 * UserRecord CRUD over a Redis hash, plus the watchlist & active-index
 * sorted sets that let other code enumerate users efficiently.
 *
 * Storage shape:
 *
 *   HSET s:u:{userId}
 *     userId           → string
 *     username         → string
 *     features         → JSON({...FeatureVector})
 *     score            → number-as-string
 *     state            → "HEALTHY" | ... | "BANNED"
 *     stateSince       → number-as-string
 *     pendingState     → "HEALTHY" | ... | "BANNED" | "null"
 *     pendingSince     → number-as-string | "null"
 *     submissions      → number-as-string
 *     removals         → number-as-string
 *     lastEventAt      → number-as-string
 *     firstSeenAt      → number-as-string
 *     lastWarningAt    → number-as-string | "null"
 *     removalRateAtWarning → number-as-string | "null"
 *     hourHistogram    → JSON(number[24])
 *     ngramCounts      → JSON(Record<string, number>)
 *     schema           → number-as-string
 *
 * Each field is its own hash entry so partial updates don't rewrite the whole
 * blob, but the variable-shape fields (features, hourHistogram, ngramCounts)
 * are JSON to avoid a hash-of-hash explosion.
 */
import { redis } from "@devvit/web/server";
import type { FeatureVector, UserRecord, UserState, UserSummary } from "../../shared/types.ts";
import { STATE_RANK } from "../../shared/types.ts";
import { Keys } from "./keys.ts";
import {
  emptyFeatureVector,
  newUserRecord,
  parseJson,
  parseNullableNumber,
  parseNumber,
  parsePendingState,
  parseState,
  toSummary,
} from "./user-record.ts";

export {
  emptyFeatureVector,
  newUserRecord,
  toSummary,
};

export async function getUser(userId: string): Promise<UserRecord | null> {
  const raw = await redis.hGetAll(Keys.user(userId));
  if (!raw || Object.keys(raw).length === 0) return null;

  const features = parseJson<FeatureVector>(raw["features"], emptyFeatureVector());
  const hourHistogram = parseJson<number[]>(raw["hourHistogram"], new Array<number>(24).fill(0));
  const ngramCounts = parseJson<Record<string, number>>(raw["ngramCounts"], {});

  return {
    userId: raw["userId"] ?? userId,
    username: raw["username"] ?? userId,
    features,
    score: parseNumber(raw["score"], 0),
    state: parseState(raw["state"]),
    stateSince: parseNumber(raw["stateSince"], 0),
    pendingState: parsePendingState(raw["pendingState"]),
    pendingSince: parseNullableNumber(raw["pendingSince"]),
    submissions: parseNumber(raw["submissions"], 0),
    removals: parseNumber(raw["removals"], 0),
    lastEventAt: parseNumber(raw["lastEventAt"], 0),
    firstSeenAt: parseNumber(raw["firstSeenAt"], 0),
    lastWarningAt: parseNullableNumber(raw["lastWarningAt"]),
    removalRateAtWarning: parseNullableNumber(raw["removalRateAtWarning"]),
    hourHistogram,
    ngramCounts,
    schema: parseNumber(raw["schema"], 0),
  };
}

export async function putUser(record: UserRecord): Promise<void> {
  await redis.hSet(Keys.user(record.userId), {
    userId: record.userId,
    username: record.username,
    features: JSON.stringify(record.features),
    score: String(record.score),
    state: record.state,
    stateSince: String(record.stateSince),
    pendingState: record.pendingState ?? "null",
    pendingSince: record.pendingSince === null ? "null" : String(record.pendingSince),
    submissions: String(record.submissions),
    removals: String(record.removals),
    lastEventAt: String(record.lastEventAt),
    firstSeenAt: String(record.firstSeenAt),
    lastWarningAt: record.lastWarningAt === null ? "null" : String(record.lastWarningAt),
    removalRateAtWarning:
      record.removalRateAtWarning === null ? "null" : String(record.removalRateAtWarning),
    hourHistogram: JSON.stringify(record.hourHistogram),
    ngramCounts: JSON.stringify(record.ngramCounts),
    schema: String(record.schema),
  });

  // Maintain watchlist (score-ranked) and active index (recency-ranked).
  await redis.zAdd(Keys.watchlist(), { member: record.userId, score: record.score });
  await redis.zAdd(Keys.activeIndex(), { member: record.userId, score: record.lastEventAt });
}

export async function deleteUser(userId: string): Promise<void> {
  await redis.del(Keys.user(userId));
  await redis.del(Keys.userTrajectory(userId));
  await redis.zRem(Keys.watchlist(), [userId]);
  await redis.zRem(Keys.activeIndex(), [userId]);
}

/**
 * Top N userIds in the watchlist by score, optionally filtered to states at
 * or above a given band. The implementation walks the zset from highest to
 * lowest and resolves UserSummary for any survivors.
 */
export async function topByScore(
  limit: number,
  minState: UserState = "WATCHING",
): Promise<UserSummary[]> {
  const minRank = STATE_RANK[minState];
  const candidateIds = await redis.zRange(Keys.watchlist(), 0, limit * 4 - 1, {
    by: "rank",
    reverse: true,
  });
  if (!candidateIds || candidateIds.length === 0) return [];
  const out: UserSummary[] = [];
  for (const entry of candidateIds) {
    if (out.length >= limit) break;
    const record = await getUser(entry.member);
    if (!record) continue;
    if (STATE_RANK[record.state] < minRank) continue;
    out.push(toSummary(record));
  }
  return out;
}

/** Enumerate userIds with activity in the trailing `days` days. */
export async function activeSince(sinceMs: number, limit: number = 500): Promise<string[]> {
  const entries = await redis.zRange(Keys.activeIndex(), sinceMs, "+inf", {
    by: "score",
    limit: { offset: 0, count: limit },
  });
  if (!entries) return [];
  return entries.map((e) => e.member);
}
