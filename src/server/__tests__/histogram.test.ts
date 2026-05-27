/**
 * Hour-of-day histogram operations.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { addEvent, emptyHistogram, ensureLength, normalize, tightness } from "../core/histogram.ts";

describe("emptyHistogram", () => {
  it("length 24, all zeros", () => {
    const h = emptyHistogram();
    assert.equal(h.length, 24);
    assert.ok(h.every((v) => v === 0));
  });
});

describe("ensureLength", () => {
  it("pads short inputs to length 24", () => {
    assert.equal(ensureLength([1, 2, 3]).length, 24);
  });
  it("truncates long inputs", () => {
    assert.equal(ensureLength(new Array(48).fill(1)).length, 24);
  });
});

describe("addEvent", () => {
  it("returns a fresh array (no mutation)", () => {
    const prev = emptyHistogram();
    const next = addEvent(prev, Date.parse("2025-06-15T12:00:00Z"), 0, 30);
    assert.notEqual(prev, next);
    assert.ok(prev.every((v) => v === 0), "input must not be mutated");
  });

  it("increments the correct UTC hour", () => {
    const h = addEvent(emptyHistogram(), Date.parse("2025-06-15T03:30:00Z"), 0, 30);
    assert.ok((h[3] ?? 0) > 0);
    for (let i = 0; i < 24; i++) {
      if (i === 3) continue;
      assert.equal(h[i], 0);
    }
  });

  it("decays prior buckets when time has elapsed", () => {
    const start = addEvent(emptyHistogram(), Date.parse("2025-06-15T03:00:00Z"), 0, 30);
    // Advance 60 days (two half-lives), then add an event at hour 5.
    const later = addEvent(start, Date.parse("2025-08-14T05:00:00Z"), 60, 30);
    const hour3 = later[3] ?? 0;
    assert.ok(hour3 < (start[3] ?? 0) / 3, "expected significant decay over 2 half-lives");
  });
});

describe("normalize", () => {
  it("sums to 1 for non-empty histograms", () => {
    const h = emptyHistogram();
    h[5] = 3;
    h[7] = 1;
    const n = normalize(h);
    const total = n.reduce((p, c) => p + c, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });
  it("returns zeros for an all-zero histogram", () => {
    const n = normalize(emptyHistogram());
    assert.ok(n.every((v) => v === 0));
  });
});

describe("tightness", () => {
  it("uniform distribution → 0", () => {
    const h = new Array(24).fill(1);
    assert.ok(tightness(h) < 1e-9);
  });
  it("single-bucket spike → 1", () => {
    const h = emptyHistogram();
    h[0] = 100;
    assert.ok(tightness(h) > 0.99);
  });
  it("empty histogram → 0", () => {
    assert.equal(tightness(emptyHistogram()), 0);
  });
});
