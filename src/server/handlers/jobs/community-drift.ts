/**
 * Daily community drift job.
 *
 * Computes:
 *   - median + mean score across users with >MIN_EVENTS_FOR_SCORING events
 *   - state distribution
 *   - health index (0–100, higher = healthier)
 *   - 30-day drift (Δ health vs 30 days ago)
 *
 * Reads everything from the watchlist sorted-set so we don't have to scan the
 * full keyspace. The watchlist already contains every user we've ever scored;
 * the score-field acts as a built-in iterator.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context, redis } from "@devvit/web/server";
import type { UserState } from "../../../shared/types.ts";
import { Keys } from "../../storage/keys.ts";
import { computeHealthIndex, mean, median, readHealth, writeHealth } from "../../storage/community.ts";
import { getUser } from "../../storage/user.ts";
import { COMMUNITY_HISTORY_DAYS } from "../../../shared/constants.ts";
import { writeJson } from "../../http.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export async function onCommunityDrift(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const result = await runCommunityDrift(Date.now());
  writeJson(200, { ok: true, ...result }, rsp);
}

export async function runCommunityDrift(nowMs: number): Promise<{
  populationSize: number;
  activeLast7d: number;
  healthIndex: number;
  drift30d: number;
}> {
  const subreddit = context.subredditName ?? "unknown";

  // 1. iterate watchlist for the population sample
  const entries = await redis.zRange(Keys.watchlist(), 0, -1, { by: "rank" });
  const scores: number[] = [];
  const distribution: Record<UserState, number> = {
    HEALTHY: 0,
    WATCHING: 0,
    ELEVATED: 0,
    CRITICAL: 0,
    BANNED: 0,
  };
  let activeLast7d = 0;
  const sevenDaysAgo = nowMs - WEEK_MS;

  for (const entry of entries ?? []) {
    const user = await getUser(entry.member);
    if (!user) continue;
    scores.push(user.score);
    distribution[user.state] = (distribution[user.state] ?? 0) + 1;
    if (user.lastEventAt >= sevenDaysAgo) activeLast7d += 1;
  }

  const populationSize = scores.length;
  const med = median(scores);
  const mn = mean(scores);
  const healthIndex = computeHealthIndex(scores, distribution);

  // 2. compute 30-day drift from history
  const cutoff = nowMs - COMMUNITY_HISTORY_DAYS * DAY_MS;
  const historyEntries = await redis.zRange(Keys.communityHistory(), cutoff, "+inf", { by: "score" });
  const history: { t: number; health: number }[] = [];
  for (const e of historyEntries ?? []) {
    const parts = e.member.split("|");
    const t = Number(parts[0]);
    const h = Number(parts[1]);
    if (Number.isFinite(t) && Number.isFinite(h)) history.push({ t, health: h });
  }
  history.sort((a, b) => a.t - b.t);

  const drift30d = history.length > 0 ? healthIndex - (history[0]?.health ?? healthIndex) : 0;

  await writeHealth({
    subreddit,
    computedAt: nowMs,
    populationSize,
    activeLast7d,
    medianScore: med,
    meanScore: mn,
    stateDistribution: distribution,
    healthIndex,
    drift30d,
    history: [...history, { t: nowMs, health: healthIndex }],
  });

  // Touch in case readHealth wasn't called pre-write
  void (await readHealth(subreddit));

  return { populationSize, activeLast7d, healthIndex, drift30d };
}
