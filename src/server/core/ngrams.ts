/**
 * Character n-gram extraction & TF-IDF over n-gram counts.
 *
 * Why character n-grams instead of word n-grams?
 *   1. They survive ROT, leet-speak, deliberate misspellings, and punctuation
 *      tricks far better than word tokens — exactly the obfuscation patterns
 *      ban evaders use.
 *   2. They are language-agnostic; we don't ship a tokenizer per locale.
 *   3. The count vectors stay small enough to fit in a Redis hash without
 *      compression.
 *
 * The pipeline:
 *   normalize → strip URLs / mentions → fold case → extract 2- and 3-grams →
 *   keep top-K by count → store with raw counts (TF-IDF computed at match time
 *   against the subreddit document frequency).
 */
import { MAX_NGRAMS_PER_USER } from "../../shared/constants.ts";

const URL_RE = /https?:\/\/\S+/gu;
const MENTION_RE = /\b(?:u|r)\/[A-Za-z0-9_\-]+/gu;
const QUOTE_RE = /^>.*$/gmu;

/**
 * Strip noise from a body of text BEFORE n-gram extraction.
 *
 * Mentions and URLs are removed so a user's fingerprint isn't dominated by
 * sharing the same links as everyone else in the subreddit. Block quotes are
 * removed because they're someone else's words, not theirs.
 */
export function normalizeText(text: string): string {
  return text
    .replace(QUOTE_RE, " ")
    .replace(URL_RE, " ")
    .replace(MENTION_RE, " ")
    .replace(/\s+/gu, " ")
    .toLowerCase()
    .trim();
}

/**
 * Extract character n-grams of size n from a normalized string.
 *
 * Whitespace-separated word boundaries are preserved by inserting a single
 * sentinel space at the boundary; the n-gram naturally captures word-onset
 * patterns ("how", "wow", " th", " an") that act as a coarse word-level signal
 * without us paying the tokenization cost.
 */
export function extractNgrams(text: string, n: number): Record<string, number> {
  if (n < 1 || text.length < n) return {};
  const out: Record<string, number> = {};
  const limit = text.length - n + 1;
  for (let i = 0; i < limit; i++) {
    const gram = text.slice(i, i + n);
    out[gram] = (out[gram] ?? 0) + 1;
  }
  return out;
}

/**
 * Update a running n-gram count map from a new text body.
 *
 * Caller is responsible for decaying old counts BEFORE calling this — we just
 * fold in fresh observations and cap the map to MAX_NGRAMS_PER_USER by
 * dropping the lowest-count entries.
 */
export function foldText(
  prev: Readonly<Record<string, number>>,
  text: string,
): Record<string, number> {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return { ...prev };

  const out: Record<string, number> = { ...prev };
  const bigrams = extractNgrams(normalized, 2);
  const trigrams = extractNgrams(normalized, 3);
  for (const key of Object.keys(bigrams)) {
    out[key] = (out[key] ?? 0) + (bigrams[key] ?? 0);
  }
  for (const key of Object.keys(trigrams)) {
    out[key] = (out[key] ?? 0) + (trigrams[key] ?? 0);
  }
  return capTopK(out, MAX_NGRAMS_PER_USER);
}

/** Decay every count by a multiplicative factor. Drops zeros. */
export function decayCounts(
  counts: Readonly<Record<string, number>>,
  factor: number,
): Record<string, number> {
  if (factor >= 1) return { ...counts };
  if (factor <= 0) return {};
  const out: Record<string, number> = {};
  for (const key of Object.keys(counts)) {
    const v = (counts[key] ?? 0) * factor;
    if (v > 0.01) out[key] = v;
  }
  return out;
}

/** Keep only the top-K entries by value. Stable on ties (alphabetical fallback). */
export function capTopK(counts: Readonly<Record<string, number>>, k: number): Record<string, number> {
  const entries = Object.entries(counts);
  if (entries.length <= k) {
    const out: Record<string, number> = {};
    for (const [key, value] of entries) out[key] = value;
    return out;
  }
  entries.sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });
  const out: Record<string, number> = {};
  for (let i = 0; i < k; i++) {
    const entry = entries[i];
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}

/** L1-normalize an n-gram count map into a probability distribution. */
export function toFrequencies(counts: Readonly<Record<string, number>>): Record<string, number> {
  let total = 0;
  for (const key of Object.keys(counts)) total += counts[key] ?? 0;
  if (total <= 0) return {};
  const out: Record<string, number> = {};
  for (const key of Object.keys(counts)) {
    out[key] = (counts[key] ?? 0) / total;
  }
  return out;
}

/**
 * TF-IDF weighting using a subreddit-wide document-frequency map.
 *
 *   tfidf(g) = freq(g) · log(N / (1 + df(g)))
 *
 * If we have no DF map yet (first install, cold start), we fall back to raw
 * frequencies, which still produces meaningful cosine similarity.
 */
export function tfIdf(
  counts: Readonly<Record<string, number>>,
  docFrequencies: Readonly<Record<string, number>>,
  totalDocs: number,
): Record<string, number> {
  const freqs = toFrequencies(counts);
  if (totalDocs <= 0 || Object.keys(docFrequencies).length === 0) return freqs;
  const out: Record<string, number> = {};
  for (const key of Object.keys(freqs)) {
    const df = docFrequencies[key] ?? 0;
    const idf = Math.log(totalDocs / (1 + df));
    out[key] = (freqs[key] ?? 0) * idf;
  }
  return out;
}
