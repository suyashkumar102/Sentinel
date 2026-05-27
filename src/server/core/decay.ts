/**
 * Temporal decay primitives.
 *
 * Every Sentinel feature is an exponentially weighted moving average. This is
 * THE design insight: the score reflects trajectory, not history. A user toxic
 * a year ago but clean for 90 days converges back to baseline; a user clean
 * for a year but deteriorating for two weeks shows a rising score.
 *
 *   EMA_t = α · x_t + (1 − α) · EMA_{t−1}
 *
 * with α derived from a configurable half-life rather than a fixed window so
 * the same code parameterizes "minutes" or "months".
 */

/** Milliseconds in a day, used everywhere we convert wall-clock to EMA steps. */
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Convert a half-life (in days) to the per-day EMA smoothing factor α.
 *
 * Derivation: after one half-life the contribution of an old observation must
 * equal 0.5, so (1 − α) ^ halfLife = 0.5  ⇒  α = 1 − 2^(−1/halfLife).
 */
export function alphaFromHalfLife(halfLifeDays: number): number {
  if (halfLifeDays <= 0) return 1;
  return 1 - Math.pow(0.5, 1 / halfLifeDays);
}

/**
 * Decay a stored EMA value forward by `deltaDays` of inactivity.
 *
 * Decaying on read (rather than writing zero events every day) keeps Sentinel's
 * Redis footprint independent of the population size — we only pay for users
 * who actually do something, and lazy-decay everyone else.
 */
export function decayForward(prev: number, deltaDays: number, halfLifeDays: number): number {
  if (deltaDays <= 0) return prev;
  if (halfLifeDays <= 0) return 0;
  return prev * Math.pow(0.5, deltaDays / halfLifeDays);
}

/**
 * Fold a new observation into an EMA, given the elapsed days since the last update.
 *
 * Folds two steps into one closed-form update so we don't lose precision to
 * repeated rounding in the lazy-decay path.
 */
export function emaUpdate(
  prev: number,
  observation: number,
  deltaDays: number,
  halfLifeDays: number,
): number {
  const decayed = decayForward(prev, deltaDays, halfLifeDays);
  const alpha = alphaFromHalfLife(halfLifeDays);
  return alpha * observation + (1 - alpha) * decayed;
}

/**
 * Bounded EMA that clamps the result into [0, 1].
 *
 * Every Sentinel feature lives in [0, 1] so they're directly weight-summable
 * without needing per-feature normalization at scoring time.
 */
export function emaUpdateBounded(
  prev: number,
  observation: number,
  deltaDays: number,
  halfLifeDays: number,
): number {
  const v = emaUpdate(prev, observation, deltaDays, halfLifeDays);
  return clamp01(v);
}

export function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Convert two unix-ms timestamps into a positive day delta. */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.max(0, (toMs - fromMs) / MS_PER_DAY);
}
