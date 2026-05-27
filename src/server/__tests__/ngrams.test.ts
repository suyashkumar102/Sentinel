/**
 * Tokenization and n-gram extraction.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  capTopK,
  decayCounts,
  extractNgrams,
  foldText,
  normalizeText,
  tfIdf,
  toFrequencies,
} from "../core/ngrams.ts";

describe("normalizeText", () => {
  it("strips URLs and mentions", () => {
    const t = "hello u/foo this is r/bar https://x.com check it out";
    const out = normalizeText(t);
    assert.ok(!out.includes("u/foo"));
    assert.ok(!out.includes("r/bar"));
    assert.ok(!out.includes("https"));
  });
  it("lowercases", () => {
    assert.equal(normalizeText("HELLO World"), "hello world");
  });
  it("collapses whitespace", () => {
    assert.equal(normalizeText("a   b\tc\nd"), "a b c d");
  });
  it("strips quote blocks", () => {
    const t = "okay\n> they said this\nbut I think otherwise";
    const out = normalizeText(t);
    assert.ok(!out.includes("they said this"));
    assert.ok(out.includes("but i think otherwise"));
  });
});

describe("extractNgrams", () => {
  it("bigrams of 'abc' = {ab, bc}", () => {
    assert.deepEqual(extractNgrams("abc", 2), { ab: 1, bc: 1 });
  });
  it("trigrams of 'abcd' = {abc, bcd}", () => {
    assert.deepEqual(extractNgrams("abcd", 3), { abc: 1, bcd: 1 });
  });
  it("empty for n > text length", () => {
    assert.deepEqual(extractNgrams("ab", 3), {});
  });
  it("handles unicode", () => {
    const out = extractNgrams("néé", 2);
    assert.equal(Object.keys(out).length, 2);
  });
});

describe("foldText", () => {
  it("adds counts to an existing map", () => {
    const a = { ab: 1, bc: 1 };
    const out = foldText(a, "abc");
    assert.ok(out["ab"]! >= 2);
    assert.ok(out["bc"]! >= 2);
  });
  it("ignores quoted text", () => {
    const out = foldText({}, "> quoted\nplain text here");
    assert.ok(Object.keys(out).length > 0);
    // Should not contain bigrams from the quoted block.
    assert.equal(out["qu"], undefined);
  });
  it("respects MAX_NGRAMS_PER_USER cap", () => {
    const out = foldText({}, "the quick brown fox jumps over the lazy dog ".repeat(50));
    assert.ok(Object.keys(out).length <= 50);
  });
});

describe("decayCounts", () => {
  it("scales every value", () => {
    const out = decayCounts({ a: 10, b: 2 }, 0.5);
    assert.equal(out["a"], 5);
    assert.equal(out["b"], 1);
  });
  it("drops sub-threshold values", () => {
    const out = decayCounts({ a: 0.001 }, 0.5);
    assert.equal(out["a"], undefined);
  });
});

describe("capTopK", () => {
  it("returns at most k entries", () => {
    const out = capTopK({ a: 1, b: 2, c: 3, d: 4 }, 2);
    assert.equal(Object.keys(out).length, 2);
    assert.ok(out["d"] !== undefined);
    assert.ok(out["c"] !== undefined);
  });
  it("stable on ties", () => {
    const out = capTopK({ b: 1, a: 1, c: 1 }, 2);
    assert.equal(Object.keys(out).length, 2);
    assert.ok("a" in out, "alphabetical tiebreaker");
    assert.ok("b" in out, "alphabetical tiebreaker");
  });
});

describe("toFrequencies", () => {
  it("L1-normalizes", () => {
    const out = toFrequencies({ a: 1, b: 1, c: 2 });
    const sum = Object.values(out).reduce((p, c) => p + c, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });
  it("empty input → empty output", () => {
    assert.deepEqual(toFrequencies({}), {});
  });
});

describe("tfIdf", () => {
  it("falls back to frequencies when DF map is empty", () => {
    const out = tfIdf({ a: 2, b: 1 }, {}, 0);
    const expected = toFrequencies({ a: 2, b: 1 });
    assert.deepEqual(out, expected);
  });
  it("rare terms get higher weight than common ones", () => {
    const out = tfIdf({ rare: 1, common: 1 }, { rare: 1, common: 1000 }, 10000);
    assert.ok((out["rare"] ?? 0) > (out["common"] ?? 0));
  });
});
