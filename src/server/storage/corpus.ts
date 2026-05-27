/**
 * Subreddit-wide n-gram document-frequency table.
 *
 * Stored as a single hash {ngram → df} plus a counter for total documents.
 * Used by `tfIdf()` to weight n-grams against the subreddit baseline so a
 * user who writes like "everyone else" doesn't appear distinctive, and a
 * user who clusters around rare terms does.
 *
 * We keep this lightweight — DF updates only on submission events, and only
 * for the n-grams we'd retain anyway (top-K per body). The corpus is decayed
 * monthly via a tiny multiplier so old vocabulary doesn't dominate forever.
 */
import { redis } from "@devvit/web/server";
import { Keys } from "./keys.ts";

export async function totalDocs(): Promise<number> {
  const v = await redis.get(Keys.documentFrequencyTotal());
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function incrTotalDocs(by: number = 1): Promise<void> {
  await redis.incrBy(Keys.documentFrequencyTotal(), by);
}

export async function bumpFrequencies(ngrams: Readonly<Record<string, number>>): Promise<void> {
  const keys = Object.keys(ngrams);
  if (keys.length === 0) return;
  for (const key of keys) {
    await redis.hIncrBy(Keys.documentFrequencies(), key, 1);
  }
}

/**
 * Fetch the document-frequency map. This is a hot path — the dashboard reads
 * it on init AND every state recompute. In production-grade installations
 * the map can grow to thousands of entries; the caller passes only the keys
 * it actually cares about to avoid a full hash transfer.
 */
export async function frequencies(keys: readonly string[]): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  const out: Record<string, number> = {};
  // The Devvit redis client doesn't expose `HMGET`; iterate one key at a time.
  // The keys list is bounded (cap of MAX_NGRAMS_PER_USER ≈ 50) so this stays cheap.
  for (const key of keys) {
    const raw = await redis.hGet(Keys.documentFrequencies(), key);
    if (raw === undefined || raw === null) continue;
    const v = Number(raw);
    if (Number.isFinite(v) && v > 0) out[key] = v;
  }
  return out;
}
