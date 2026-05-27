/**
 * Per-user trajectory store (the sparkline data behind the dashboard).
 *
 * A point is written every time the state machine commits a transition AND
 * on each state-recompute job tick when the score moves more than a small
 * delta. We cap to MAX_TRAJECTORY_POINTS per user so the sparkline always
 * loads instantly and Redis pressure stays bounded.
 */
import { redis } from "@devvit/web/server";
import { MAX_TRAJECTORY_POINTS } from "../../shared/constants.ts";
import type { TrajectoryPoint, UserState } from "../../shared/types.ts";
import { Keys } from "./keys.ts";

export async function appendPoint(userId: string, point: TrajectoryPoint): Promise<void> {
  await redis.zAdd(Keys.userTrajectory(userId), {
    member: encodePoint(point),
    score: point.t,
  });
  // Trim by rank to retain only the most recent MAX_TRAJECTORY_POINTS.
  await redis.zRemRangeByRank(
    Keys.userTrajectory(userId),
    0,
    -1 - MAX_TRAJECTORY_POINTS,
  );
}

export async function readTrajectory(userId: string): Promise<TrajectoryPoint[]> {
  const entries = await redis.zRange(Keys.userTrajectory(userId), 0, -1, {
    by: "rank",
  });
  if (!entries || entries.length === 0) return [];
  const out: TrajectoryPoint[] = [];
  for (const e of entries) {
    const p = decodePoint(e.member);
    if (p) out.push(p);
  }
  return out;
}

function encodePoint(p: TrajectoryPoint): string {
  return `${p.t}|${p.score.toFixed(5)}|${p.state}`;
}

function decodePoint(s: string): TrajectoryPoint | null {
  const parts = s.split("|");
  if (parts.length !== 3) return null;
  const t = Number(parts[0]);
  const score = Number(parts[1]);
  const state = parts[2] as UserState;
  if (!Number.isFinite(t) || !Number.isFinite(score)) return null;
  return { t, score, state };
}
