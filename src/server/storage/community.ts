/**
 * Community-level metrics & history.
 *
 * The drift job recomputes the snapshot once per day; the dashboard reads it
 * once per page load. Cheap to read, expensive to write — so we lean on the
 * scheduler instead of recomputing on every event.
 */
import { redis } from "@devvit/web/server";
import { COMMUNITY_HISTORY_DAYS } from "../../shared/constants.ts";
import type { CommunityHealth, UserState } from "../../shared/types.ts";
import { Keys } from "./keys.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultDistribution: Readonly<Record<UserState, number>> = {
  HEALTHY: 0,
  WATCHING: 0,
  ELEVATED: 0,
  CRITICAL: 0,
  BANNED: 0,
};

export async function readHealth(subreddit: string): Promise<CommunityHealth | null> {
  const raw = await redis.hGetAll(Keys.community());
  if (!raw || Object.keys(raw).length === 0) return null;
  const distribution = parseJson<Record<UserState, number>>(
    raw["stateDistribution"],
    { ...defaultDistribution },
  );
  const history = parseJson<{ t: number; health: number }[]>(raw["history"], []);
  return {
    subreddit: raw["subreddit"] ?? subreddit,
    computedAt: parseNumber(raw["computedAt"], 0),
    populationSize: parseNumber(raw["populationSize"], 0),
    activeLast7d: parseNumber(raw["activeLast7d"], 0),
    medianScore: parseNumber(raw["medianScore"], 0),
    meanScore: parseNumber(raw["meanScore"], 0),
    stateDistribution: distribution,
    healthIndex: parseNumber(raw["healthIndex"], 100),
    drift30d: parseNumber(raw["drift30d"], 0),
    history,
  };
}

export async function writeHealth(h: CommunityHealth): Promise<void> {
  await redis.hSet(Keys.community(), {
    subreddit: h.subreddit,
    computedAt: String(h.computedAt),
    populationSize: String(h.populationSize),
    activeLast7d: String(h.activeLast7d),
    medianScore: String(h.medianScore),
    meanScore: String(h.meanScore),
    stateDistribution: JSON.stringify(h.stateDistribution),
    healthIndex: String(h.healthIndex),
    drift30d: String(h.drift30d),
    history: JSON.stringify(h.history),
  });

  // History sorted set is also written so we can compute drift cheaply.
  await redis.zAdd(Keys.communityHistory(), {
    member: `${h.computedAt}|${h.healthIndex.toFixed(2)}`,
    score: h.computedAt,
  });
  await redis.zRemRangeByScore(
    Keys.communityHistory(),
    0,
    h.computedAt - COMMUNITY_HISTORY_DAYS * DAY_MS,
  );
}

/** Compute the median of an unsorted array. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/**
 * Derive a 0-100 community health index from the user-score distribution.
 *
 *   healthIndex = 100 · (1 − median_score) · (1 − share_in_ELEVATED_or_above)
 *
 * Median (not mean) so a few CRITICAL outliers don't dominate; share-in-bad-states
 * so even a low-median subreddit with a small persistent toxic cohort scores lower.
 */
export function computeHealthIndex(
  scores: readonly number[],
  distribution: Readonly<Record<UserState, number>>,
): number {
  const m = median(scores);
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  const shareBad =
    total === 0 ? 0 : (distribution.ELEVATED + distribution.CRITICAL + distribution.BANNED) / total;
  const idx = (1 - m) * (1 - shareBad) * 100;
  if (idx < 0) return 0;
  if (idx > 100) return 100;
  return idx;
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
