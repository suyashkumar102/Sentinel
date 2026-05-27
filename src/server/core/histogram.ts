/**
 * Hour-of-day histogram operations.
 *
 * Each user's posting schedule is summarized as a length-24 vector, decayed in
 * the same EMA family as every other feature. This is the foundation of:
 *   1. timeSignature drift (sudden schedule shift = possible compromise / sock)
 *   2. ban-evader cosine similarity (a returning banned user often retains a
 *      circadian rhythm even after changing accounts and writing styles).
 *
 * The space is small enough (24 floats) that we can store many of these in
 * Redis without compression.
 */
import { decayForward } from "./decay.ts";

export const HOURS_PER_DAY = 24;

export function emptyHistogram(): number[] {
  return new Array<number>(HOURS_PER_DAY).fill(0);
}

/**
 * Decay each bucket forward by `deltaDays` and increment the bucket for `eventMs`.
 * Returns a NEW array — never mutate the input, which may be a snapshot from Redis.
 */
export function addEvent(
  prev: readonly number[],
  eventMs: number,
  deltaDays: number,
  halfLifeDays: number,
): number[] {
  const out = ensureLength(prev);
  for (let i = 0; i < HOURS_PER_DAY; i++) {
    out[i] = decayForward(out[i] ?? 0, deltaDays, halfLifeDays);
  }
  const hour = new Date(eventMs).getUTCHours();
  out[hour] = (out[hour] ?? 0) + 1;
  return out;
}

/** Coerce to a length-24 array, padding with zeros if short, truncating if long. */
export function ensureLength(src: readonly number[]): number[] {
  const out = new Array<number>(HOURS_PER_DAY).fill(0);
  const n = Math.min(src.length, HOURS_PER_DAY);
  for (let i = 0; i < n; i++) out[i] = src[i] ?? 0;
  return out;
}

/** L1-normalize the histogram so it sums to 1. Empty histograms remain empty. */
export function normalize(hist: readonly number[]): number[] {
  const out = ensureLength(hist);
  let sum = 0;
  for (let i = 0; i < HOURS_PER_DAY; i++) sum += out[i] ?? 0;
  if (sum <= 0) return out;
  for (let i = 0; i < HOURS_PER_DAY; i++) out[i] = (out[i] ?? 0) / sum;
  return out;
}

/**
 * Compute the time signature score — a value in [0, 1] reflecting how
 * "anomalous" the current rhythm is vs a flat baseline.
 *
 * Pattern-seeking bad actors tend to cluster activity into narrow windows
 * (single-region trolling, scripted activity); legitimate users spread their
 * activity more evenly. We measure deviation from uniform as a proxy.
 *
 *   tightness = max(p) − mean(p)   (normalized to [0, 1])
 *
 * A perfectly uniform histogram yields 0 (least anomalous); a single-bucket
 * spike yields ~1 (most anomalous). This is intentionally cheap — it's only
 * one of six features and over-engineering it would overshadow the others.
 */
export function tightness(hist: readonly number[]): number {
  const norm = normalize(hist);
  let max = 0;
  for (let i = 0; i < HOURS_PER_DAY; i++) max = Math.max(max, norm[i] ?? 0);
  const mean = 1 / HOURS_PER_DAY;
  const raw = (max - mean) / (1 - mean);
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}
