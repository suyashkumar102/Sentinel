/**
 * Composite scoring + alert driver attribution.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { alertDrivers, compositeScore, rationale } from "../core/score.ts";
import type { FeatureVector } from "../../shared/types.ts";

const zero: FeatureVector = {
  velocity: 0,
  removalRate: 0,
  controversyAffinity: 0,
  warningResponse: 0,
  timeSignature: 0,
  vocabularyFingerprint: 0,
};

describe("compositeScore", () => {
  it("zero vector → 0", () => {
    assert.equal(compositeScore(zero), 0);
  });

  it("max vector clamps at 1", () => {
    const all1: FeatureVector = {
      velocity: 1,
      removalRate: 1,
      controversyAffinity: 1,
      warningResponse: 1,
      timeSignature: 1,
      vocabularyFingerprint: 1,
    };
    assert.ok(compositeScore(all1) <= 1);
    assert.ok(compositeScore(all1) > 0.95);
  });

  it("no single feature drives the score above the WATCHING threshold (0.2) alone", () => {
    for (const k of Object.keys(zero) as (keyof FeatureVector)[]) {
      const isolated: FeatureVector = { ...zero, [k]: 1 } as FeatureVector;
      const s = compositeScore(isolated);
      assert.ok(
        s < 0.45,
        `feature ${k} alone produced score ${s}, should be below ELEVATED threshold`,
      );
    }
  });

  it("removalRate + warningResponse together cross the ELEVATED threshold", () => {
    const v: FeatureVector = { ...zero, removalRate: 0.9, warningResponse: 0.9 };
    assert.ok(compositeScore(v) >= 0.45);
  });
});

describe("alertDrivers", () => {
  it("returns one driver per feature", () => {
    const drivers = alertDrivers({ ...zero, removalRate: 0.5 });
    assert.equal(drivers.length, 6);
  });

  it("sorted by contribution descending", () => {
    const v: FeatureVector = { ...zero, removalRate: 0.9, warningResponse: 0.5 };
    const drivers = alertDrivers(v);
    for (let i = 1; i < drivers.length; i++) {
      assert.ok((drivers[i - 1]?.contribution ?? 0) >= (drivers[i]?.contribution ?? 0));
    }
    assert.equal(drivers[0]?.feature, "removalRate");
  });
});

describe("rationale", () => {
  it("returns a non-empty string for a non-zero vector", () => {
    const v: FeatureVector = { ...zero, removalRate: 0.6 };
    const r = rationale(v);
    assert.ok(r.length > 0);
    assert.ok(r.toLowerCase().includes("removal"));
  });
  it("falls back when no driver is meaningful", () => {
    const r = rationale(zero);
    assert.ok(r.toLowerCase().includes("threshold") || r.toLowerCase().includes("dominant"));
  });
});
