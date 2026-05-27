/**
 * Properties of EMA temporal decay.
 *
 * These tests pin the BEHAVIOR we promise mods. If any of them break we have
 * regressed on the central design promise of Sentinel: trajectory, not state.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  alphaFromHalfLife,
  clamp01,
  daysBetween,
  decayForward,
  emaUpdate,
  emaUpdateBounded,
  MS_PER_DAY,
} from "../core/decay.ts";

describe("alphaFromHalfLife", () => {
  it("at half-life one observation contributes exactly 0.5 weight after one step", () => {
    const a = alphaFromHalfLife(30);
    const oneStep = Math.pow(1 - a, 30);
    assert.ok(Math.abs(oneStep - 0.5) < 1e-9, "half-life→α inversion off");
  });

  it("degenerate inputs are bounded", () => {
    assert.equal(alphaFromHalfLife(0), 1);
    assert.equal(alphaFromHalfLife(-5), 1);
  });
});

describe("decayForward", () => {
  it("decays exactly by half after one half-life", () => {
    const out = decayForward(1, 30, 30);
    assert.ok(Math.abs(out - 0.5) < 1e-9);
  });

  it("is monotone non-increasing over time", () => {
    let prev = 1;
    for (let t = 1; t <= 365; t++) {
      const next = decayForward(1, t, 30);
      assert.ok(next <= prev, `not monotone at t=${t}: ${next} > ${prev}`);
      prev = next;
    }
  });

  it("preserves zero", () => {
    assert.equal(decayForward(0, 7, 30), 0);
  });

  it("returns 0 when half-life is 0", () => {
    assert.equal(decayForward(1, 1, 0), 0);
  });
});

describe("emaUpdate", () => {
  it("with no elapsed time and full observation tends to the observation as α grows", () => {
    // Half-life 0.5 days → α = 1 − 2^(−2) = 0.75; folding 1.0 into prev=0 gives 0.75.
    const a = emaUpdate(0, 1, 0, 0.5);
    assert.ok(a > 0.5);
  });

  it("with no observation and infinite elapsed time tends to 0", () => {
    const a = emaUpdate(0.7, 0, 1000, 30);
    assert.ok(a < 1e-6, `expected ~0, got ${a}`);
  });

  it("recent observations dominate ancient ones (trajectory not state)", () => {
    // Ancient 1.0 observation 365 days ago.
    let v = emaUpdate(0, 1, 0, 30);
    // 365 days of no events.
    v = decayForward(v, 365, 30);
    // Recent 0.0 observation today.
    const finalScore = emaUpdate(v, 0, 0, 30);
    assert.ok(finalScore < 0.05, `ancient observation should fade, got ${finalScore}`);
  });

  it("recent rise overcomes long-clean history", () => {
    // Clean for a year.
    let v = 0;
    for (let d = 0; d < 365; d++) v = emaUpdate(v, 0, 1, 30);
    // Two weeks of removals daily — closed-form analysis gives v ≈ 0.24 (climbing
    // toward the steady-state 0.506 at one-per-day with halfLife=30).
    for (let d = 0; d < 14; d++) v = emaUpdate(v, 1, 1, 30);
    assert.ok(v > 0.2, `expected rising score after 2 weeks of events, got ${v}`);
  });
});

describe("emaUpdateBounded", () => {
  it("never exceeds 1 even with constant 1.0 observation", () => {
    let v = 0;
    for (let d = 0; d < 1000; d++) v = emaUpdateBounded(v, 1, 1, 30);
    assert.ok(v <= 1 + 1e-9, `bounded EMA exceeded 1: ${v}`);
  });
  it("never drops below 0", () => {
    let v = 0;
    for (let d = 0; d < 1000; d++) v = emaUpdateBounded(v, 0, 1, 30);
    assert.ok(v >= 0);
  });
});

describe("clamp01", () => {
  it("NaN→0, +Infinity→1, -Infinity→0", () => {
    assert.equal(clamp01(NaN), 0);
    assert.equal(clamp01(Infinity), 1);
    assert.equal(clamp01(-Infinity), 0);
  });
  it("clamps the range", () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(0.5), 0.5);
  });
});

describe("daysBetween", () => {
  it("zero for equal timestamps", () => {
    assert.equal(daysBetween(0, 0), 0);
  });
  it("never negative", () => {
    assert.equal(daysBetween(1_000, 0), 0);
  });
  it("scales to days correctly", () => {
    assert.equal(daysBetween(0, MS_PER_DAY * 30), 30);
  });
});
