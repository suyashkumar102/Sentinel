/**
 * Cosine similarity: bedrock for ban-evader matching.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { cosineDense, cosineSparse } from "../core/cosine.ts";

describe("cosineDense", () => {
  it("identical vectors → 1", () => {
    assert.ok(Math.abs(cosineDense([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
  });
  it("orthogonal vectors → 0", () => {
    assert.equal(cosineDense([1, 0], [0, 1]), 0);
  });
  it("zero vectors → 0 (not NaN)", () => {
    assert.equal(cosineDense([0, 0], [0, 0]), 0);
    assert.equal(cosineDense([0, 0], [1, 1]), 0);
  });
  it("symmetric", () => {
    const a = [0.1, 0.2, 0.3];
    const b = [0.4, 0.5, 0.6];
    assert.ok(Math.abs(cosineDense(a, b) - cosineDense(b, a)) < 1e-12);
  });
  it("scale invariant", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    assert.ok(Math.abs(cosineDense(a, b) - 1) < 1e-9);
  });
});

describe("cosineSparse", () => {
  it("identical maps → 1", () => {
    assert.ok(Math.abs(cosineSparse({ a: 1, b: 2 }, { a: 1, b: 2 }) - 1) < 1e-9);
  });
  it("disjoint maps → 0", () => {
    assert.equal(cosineSparse({ a: 1 }, { b: 1 }), 0);
  });
  it("empty inputs → 0", () => {
    assert.equal(cosineSparse({}, {}), 0);
    assert.equal(cosineSparse({}, { a: 1 }), 0);
  });
  it("scale invariant", () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 2, y: 4, z: 6 };
    assert.ok(Math.abs(cosineSparse(a, b) - 1) < 1e-9);
  });
});
