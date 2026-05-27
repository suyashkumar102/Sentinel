/**
 * State machine behavior — the hysteresis guarantee Sentinel makes to mods.
 *
 * A single bad post must NOT escalate a user. The pending state has to dwell
 * across `escalateDays` before committing. Likewise, a single good post must
 * not de-escalate someone — the dwell has to span `deescalateDays`.
 *
 * Without these properties mods stop trusting the alerts within a week.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { bandFor, decide } from "../core/state.ts";
import { MS_PER_DAY } from "../core/decay.ts";

const T = { watching: 0.2, elevated: 0.45, critical: 0.7 };
const H = { escalateDays: 3, deescalateDays: 7 };

describe("bandFor", () => {
  it("HEALTHY just below WATCHING threshold", () => {
    assert.equal(bandFor(0.199), "HEALTHY");
  });
  it("WATCHING at watching threshold inclusive", () => {
    assert.equal(bandFor(0.2), "WATCHING");
  });
  it("ELEVATED at elevated threshold inclusive", () => {
    assert.equal(bandFor(0.45), "ELEVATED");
  });
  it("CRITICAL at critical threshold inclusive", () => {
    assert.equal(bandFor(0.7), "CRITICAL");
  });
});

describe("decide — escalation hysteresis", () => {
  it("does not promote on first observation above threshold", () => {
    const d = decide(
      {
        currentState: "HEALTHY",
        pendingState: null,
        pendingSince: null,
        score: 0.5,
        nowMs: 1000,
      },
      T,
      H,
    );
    assert.equal(d.nextState, "HEALTHY");
    assert.equal(d.pendingState, "ELEVATED");
    assert.equal(d.transitioned, false);
  });

  it("promotes immediately on first observation if escalateDays is 0", () => {
    const d = decide(
      {
        currentState: "HEALTHY",
        pendingState: null,
        pendingSince: null,
        score: 0.5,
        nowMs: 1000,
      },
      T,
      { escalateDays: 0, deescalateDays: 7 },
    );
    assert.equal(d.nextState, "ELEVATED");
    assert.equal(d.pendingState, null);
    assert.equal(d.transitioned, true);
  });

  it("does not promote while still inside the escalate window", () => {
    const start = 1000;
    const d = decide(
      {
        currentState: "HEALTHY",
        pendingState: "ELEVATED",
        pendingSince: start,
        score: 0.55,
        nowMs: start + 2 * MS_PER_DAY, // 2 days only, need 3
      },
      T,
      H,
    );
    assert.equal(d.nextState, "HEALTHY");
    assert.equal(d.transitioned, false);
  });

  it("promotes after the escalate window elapses", () => {
    const start = 1000;
    const d = decide(
      {
        currentState: "HEALTHY",
        pendingState: "ELEVATED",
        pendingSince: start,
        score: 0.55,
        nowMs: start + 4 * MS_PER_DAY,
      },
      T,
      H,
    );
    assert.equal(d.nextState, "ELEVATED");
    assert.equal(d.transitioned, true);
    assert.equal(d.pendingState, null);
  });

  it("resets the pending window if the candidate band changes mid-dwell", () => {
    const start = 1000;
    const d = decide(
      {
        currentState: "HEALTHY",
        pendingState: "ELEVATED",
        pendingSince: start,
        score: 0.75, // bumped up — pending should change to CRITICAL with new clock
        nowMs: start + 1 * MS_PER_DAY,
      },
      T,
      H,
    );
    assert.equal(d.pendingState, "CRITICAL");
    assert.equal(d.pendingSince, start + 1 * MS_PER_DAY);
    assert.equal(d.transitioned, false);
  });
});

describe("decide — de-escalation hysteresis", () => {
  it("does not demote on first observation below threshold", () => {
    const d = decide(
      {
        currentState: "ELEVATED",
        pendingState: null,
        pendingSince: null,
        score: 0.1,
        nowMs: 1000,
      },
      T,
      H,
    );
    assert.equal(d.nextState, "ELEVATED");
    assert.equal(d.pendingState, "HEALTHY");
    assert.equal(d.transitioned, false);
  });

  it("requires the longer deescalate dwell to demote", () => {
    const start = 1000;
    const inside = decide(
      {
        currentState: "ELEVATED",
        pendingState: "HEALTHY",
        pendingSince: start,
        score: 0.05,
        nowMs: start + 4 * MS_PER_DAY, // 4 < 7 days
      },
      T,
      H,
    );
    assert.equal(inside.transitioned, false);

    const outside = decide(
      {
        currentState: "ELEVATED",
        pendingState: "HEALTHY",
        pendingSince: start,
        score: 0.05,
        nowMs: start + 8 * MS_PER_DAY,
      },
      T,
      H,
    );
    assert.equal(outside.transitioned, true);
    assert.equal(outside.nextState, "HEALTHY");
  });
});

describe("decide — BANNED is sticky", () => {
  it("never leaves BANNED automatically", () => {
    const d = decide(
      {
        currentState: "BANNED",
        pendingState: null,
        pendingSince: null,
        score: 0,
        nowMs: 1000,
      },
      T,
      H,
    );
    assert.equal(d.nextState, "BANNED");
    assert.equal(d.transitioned, false);
  });
});

describe("decide — anti-thrash on borderline oscillation", () => {
  it("score bouncing across a threshold does not cause transitions", () => {
    let cur = "WATCHING" as const;
    let pendingState: "WATCHING" | "HEALTHY" | "ELEVATED" | "CRITICAL" | "BANNED" | null = null;
    let pendingSince: number | null = null;
    let transitions = 0;
    for (let i = 0; i < 10; i++) {
      const score = i % 2 === 0 ? 0.21 : 0.19;
      const d = decide(
        {
          currentState: cur,
          pendingState,
          pendingSince,
          score,
          nowMs: i * 1000, // sub-second deltas
        },
        T,
        H,
      );
      if (d.transitioned) transitions += 1;
      cur = d.nextState as typeof cur;
      pendingState = d.pendingState;
      pendingSince = d.pendingSince;
    }
    assert.equal(transitions, 0, "borderline oscillation should not transition");
  });
});
