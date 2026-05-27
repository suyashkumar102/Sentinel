/**
 * State machine with hysteresis.
 *
 * A score crossing a threshold does NOT immediately transition the state. The
 * pending state has to persist past the threshold for `escalateAfterDays`
 * before promotion, or stay BELOW for `deescalateAfterDays` before demotion.
 * This prevents the entire system from thrashing on a single bad post.
 *
 * The mechanism is straightforward control engineering:
 *
 *   - On every score update we compute the "naive" state for the current
 *     score (the band the score is currently inside).
 *   - If naive == current, clear any pending transition and we're stable.
 *   - If naive != current, we're "pending": a candidate transition has
 *     started. The pending state is overwritten if a new candidate appears.
 *   - The pending transition COMMITS when its dwell time exceeds the
 *     direction-appropriate window (longer to de-escalate than to escalate,
 *     because false-negatives are cheaper than false-positives when removing
 *     a flag is concerned, but more costly when raising one).
 */
import {
  DEFAULT_THRESHOLD_CRITICAL,
  DEFAULT_THRESHOLD_ELEVATED,
  DEFAULT_THRESHOLD_WATCHING,
  DEFAULT_ESCALATE_DAYS,
  DEFAULT_DEESCALATE_DAYS,
} from "../../shared/constants.ts";
import type { UserState } from "../../shared/types.ts";
import { STATE_RANK } from "../../shared/types.ts";
import { MS_PER_DAY } from "./decay.ts";

export type StateThresholds = {
  readonly watching: number;
  readonly elevated: number;
  readonly critical: number;
};

export type HysteresisConfig = {
  readonly escalateDays: number;
  readonly deescalateDays: number;
};

export const DEFAULT_THRESHOLDS: StateThresholds = {
  watching: DEFAULT_THRESHOLD_WATCHING,
  elevated: DEFAULT_THRESHOLD_ELEVATED,
  critical: DEFAULT_THRESHOLD_CRITICAL,
};

export const DEFAULT_HYSTERESIS: HysteresisConfig = {
  escalateDays: DEFAULT_ESCALATE_DAYS,
  deescalateDays: DEFAULT_DEESCALATE_DAYS,
};

/** Map a raw score to the band it falls into. BANNED is set externally. */
export function bandFor(score: number, t: StateThresholds = DEFAULT_THRESHOLDS): UserState {
  if (score >= t.critical) return "CRITICAL";
  if (score >= t.elevated) return "ELEVATED";
  if (score >= t.watching) return "WATCHING";
  return "HEALTHY";
}

export type StateInput = {
  readonly currentState: UserState;
  readonly pendingState: UserState | null;
  readonly pendingSince: number | null;
  readonly score: number;
  readonly nowMs: number;
};

export type StateDecision = {
  readonly nextState: UserState;
  readonly pendingState: UserState | null;
  readonly pendingSince: number | null;
  readonly transitioned: boolean;
};

/**
 * Compute the next state given a score and current pending status.
 *
 * The decision is pure: same inputs always produce the same outputs, no I/O,
 * no clock dependency beyond the passed-in `nowMs`. This is what makes the
 * state machine testable.
 */
export function decide(
  input: StateInput,
  thresholds: StateThresholds = DEFAULT_THRESHOLDS,
  hysteresis: HysteresisConfig = DEFAULT_HYSTERESIS,
): StateDecision {
  // BANNED is sticky — only an explicit unban transitions out of it.
  if (input.currentState === "BANNED") {
    return {
      nextState: "BANNED",
      pendingState: null,
      pendingSince: null,
      transitioned: false,
    };
  }

  const naive = bandFor(input.score, thresholds);

  // No candidate — same band, no pending transition.
  if (naive === input.currentState) {
    return {
      nextState: input.currentState,
      pendingState: null,
      pendingSince: null,
      transitioned: false,
    };
  }

  // Direction of the proposed transition.
  const escalating = STATE_RANK[naive] > STATE_RANK[input.currentState];
  const dwellRequiredDays = escalating ? hysteresis.escalateDays : hysteresis.deescalateDays;
  const dwellRequiredMs = dwellRequiredDays * MS_PER_DAY;

  if (dwellRequiredMs === 0) {
    return {
      nextState: naive,
      pendingState: null,
      pendingSince: null,
      transitioned: true,
    };
  }

  // If the pending candidate matches what we'd propose now AND has dwelled
  // long enough, commit. Otherwise update / start the pending window.
  if (input.pendingState === naive && input.pendingSince !== null) {
    const dwell = input.nowMs - input.pendingSince;
    if (dwell >= dwellRequiredMs) {
      return {
        nextState: naive,
        pendingState: null,
        pendingSince: null,
        transitioned: true,
      };
    }
    return {
      nextState: input.currentState,
      pendingState: naive,
      pendingSince: input.pendingSince,
      transitioned: false,
    };
  }

  // Pending candidate changed direction or doesn't exist yet — start new window.
  return {
    nextState: input.currentState,
    pendingState: naive,
    pendingSince: input.nowMs,
    transitioned: false,
  };
}
