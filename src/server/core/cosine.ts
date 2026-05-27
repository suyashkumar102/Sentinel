/**
 * Cosine similarity over sparse and dense vectors.
 *
 * Used in two distinct places:
 *   - Ban-evader matching:   cosine(hourHistogram_new, hourHistogram_banned)
 *   - Vocabulary matching:   cosine(ngramTfIdf_new, ngramTfIdf_banned)
 *
 * Both vectors are sparse maps; both produce a value in [0, 1] (we clamp
 * negatives to 0 since our coordinates are non-negative).
 */

/** Cosine similarity over equal-length dense vectors. Returns 0 for zero vectors. */
export function cosineDense(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(sim)) return 0;
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}

/** Cosine similarity over sparse {feature → weight} maps. Returns 0 for empty inputs. */
export function cosineSparse(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): number {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length === 0 || bKeys.length === 0) return 0;

  // Iterate the smaller map for the dot product.
  const [small, large] = aKeys.length <= bKeys.length ? [a, b] : [b, a];
  let dot = 0;
  for (const key of Object.keys(small)) {
    const sv = small[key];
    const lv = large[key];
    if (sv !== undefined && lv !== undefined) dot += sv * lv;
  }
  if (dot === 0) return 0;

  let na = 0;
  for (const key of aKeys) {
    const v = a[key] ?? 0;
    na += v * v;
  }
  let nb = 0;
  for (const key of bKeys) {
    const v = b[key] ?? 0;
    nb += v * v;
  }
  if (na === 0 || nb === 0) return 0;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  if (!Number.isFinite(sim)) return 0;
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}
