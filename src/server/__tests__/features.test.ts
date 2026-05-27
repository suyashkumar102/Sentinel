/**
 * Behavioral feature pipeline — `applyEvent` end-to-end.
 *
 * Each test builds a small synthetic sequence of events and asserts the
 * feature vector responds correctly.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyEvent, distinctivenessFromTfIdf } from "../core/features.ts";
import type { SentinelEvent } from "../core/features.ts";
import { newUserRecord } from "../storage/user-record.ts";
import { MS_PER_DAY } from "../core/decay.ts";

const HL = 30;

function step(user: ReturnType<typeof newUserRecord>, event: SentinelEvent) {
  const out = applyEvent(user, event, HL);
  return {
    ...user,
    features: out.features,
    hourHistogram: out.hourHistogram,
    submissions: out.submissions,
    removals: out.removals,
    lastWarningAt: out.lastWarningAt,
    removalRateAtWarning: out.removalRateAtWarning,
    lastEventAt: event.tMs,
  };
}

describe("applyEvent — removal rate", () => {
  it("removals push removalRate up", () => {
    let u = newUserRecord("u1", "u1", 0);
    for (let i = 0; i < 10; i++) {
      u = step(u, { kind: "submission", userId: "u1", username: "u1", tMs: i * MS_PER_DAY });
    }
    const before = u.features.removalRate;
    for (let i = 10; i < 20; i++) {
      u = step(u, { kind: "removal", userId: "u1", username: "u1", tMs: i * MS_PER_DAY });
    }
    assert.ok(u.features.removalRate > before, "removalRate did not climb after removals");
  });

  it("approvals do not increase removalRate", () => {
    let u = newUserRecord("u1", "u1", 0);
    u = step(u, { kind: "removal", userId: "u1", username: "u1", tMs: 0 });
    const peak = u.features.removalRate;
    u = step(u, { kind: "approval", userId: "u1", username: "u1", tMs: 1 * MS_PER_DAY });
    assert.ok(u.features.removalRate <= peak);
  });
});

describe("applyEvent — warning response", () => {
  it("after a warning, sustained removals push warningResponse toward defiant", () => {
    let u = newUserRecord("u1", "u1", 0);
    for (let i = 0; i < 5; i++) {
      u = step(u, { kind: "removal", userId: "u1", username: "u1", tMs: i * MS_PER_DAY });
    }
    u = step(u, { kind: "warning", userId: "u1", username: "u1", tMs: 6 * MS_PER_DAY });
    const baseline = u.features.warningResponse;
    for (let i = 7; i < 14; i++) {
      u = step(u, { kind: "removal", userId: "u1", username: "u1", tMs: i * MS_PER_DAY });
    }
    assert.ok(
      u.features.warningResponse >= baseline,
      `defiance should not decrease warningResponse: ${u.features.warningResponse} vs ${baseline}`,
    );
  });
});

describe("applyEvent — controversy affinity", () => {
  it("engagements on flagged threads push affinity up", () => {
    let u = newUserRecord("u1", "u1", 0);
    for (let i = 0; i < 10; i++) {
      u = step(u, {
        kind: "submission",
        userId: "u1",
        username: "u1",
        tMs: i * MS_PER_DAY,
        onFlaggedThread: true,
      });
    }
    // Closed-form: 10 daily flagged events with halfLife=30 ≈ 0.19 (steady-state 0.506).
    assert.ok(u.features.controversyAffinity > 0.15);
  });
});

describe("distinctivenessFromTfIdf", () => {
  it("empty tfidf → 0", () => {
    assert.equal(distinctivenessFromTfIdf({}), 0);
  });
  it("saturates toward 1 for large magnitudes", () => {
    const v = distinctivenessFromTfIdf({ a: 5, b: 5, c: 5 });
    assert.ok(v > 0.9 && v <= 1);
  });
});
