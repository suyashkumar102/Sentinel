/**
 * Banned-user fingerprint store.
 *
 * When a user reaches BANNED state, their hourHistogram + ngramCounts are
 * frozen into an immutable `EvaderFingerprint`. On every new account's early
 * activity, we cosine-similarity-match against this set; matches above
 * threshold surface in the mod dashboard as a "possible ban evader".
 */
import { redis } from "@devvit/web/server";
import type { EvaderFingerprint } from "../../shared/types.ts";
import { Keys } from "./keys.ts";

export async function saveFingerprint(fp: EvaderFingerprint): Promise<void> {
  await redis.set(Keys.evader(fp.userId), JSON.stringify(fp));
  // Index keyed by bannedAt timestamp so we can enumerate "newest first" without
  // a follow-up sort, and so range queries can target recent bans.
  await redis.zAdd(Keys.evaderIndex(), { member: fp.userId, score: fp.bannedAt });
}

export async function getFingerprint(userId: string): Promise<EvaderFingerprint | null> {
  const raw = await redis.get(Keys.evader(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EvaderFingerprint;
  } catch {
    return null;
  }
}

export async function deleteFingerprint(userId: string): Promise<void> {
  await redis.del(Keys.evader(userId));
  await redis.zRem(Keys.evaderIndex(), [userId]);
}

export async function listFingerprints(limit: number = 100): Promise<EvaderFingerprint[]> {
  const entries = await redis.zRange(Keys.evaderIndex(), 0, limit - 1, {
    by: "rank",
    reverse: true,
  });
  if (!entries || entries.length === 0) return [];
  const out: EvaderFingerprint[] = [];
  for (const entry of entries) {
    const fp = await getFingerprint(entry.member);
    if (fp) out.push(fp);
  }
  return out;
}
