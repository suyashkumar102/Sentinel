/**
 * Pure UserRecord factory + field parsers, decoupled from Redis.
 *
 * Splitting these out of `user.ts` keeps the algorithmic test suite free of
 * the `@devvit/web` runtime import: tests can construct a fresh record without
 * touching the Redis client.
 */
import { SCHEMA_VERSION } from "../../shared/constants.ts";
import type { FeatureVector, UserRecord, UserState, UserSummary } from "../../shared/types.ts";

export function emptyFeatureVector(): FeatureVector {
  return {
    velocity: 0,
    removalRate: 0,
    controversyAffinity: 0,
    warningResponse: 0,
    timeSignature: 0,
    vocabularyFingerprint: 0,
  };
}

export function newUserRecord(userId: string, username: string, nowMs: number): UserRecord {
  return {
    userId,
    username,
    features: emptyFeatureVector(),
    score: 0,
    state: "HEALTHY",
    stateSince: nowMs,
    pendingState: null,
    pendingSince: null,
    submissions: 0,
    removals: 0,
    lastEventAt: nowMs,
    firstSeenAt: nowMs,
    lastWarningAt: null,
    removalRateAtWarning: null,
    hourHistogram: new Array<number>(24).fill(0),
    ngramCounts: {},
    schema: SCHEMA_VERSION,
  };
}

export function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export function parseNullableNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === "null" || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function parseState(raw: string | undefined): UserState {
  switch (raw) {
    case "HEALTHY":
    case "WATCHING":
    case "ELEVATED":
    case "CRITICAL":
    case "BANNED":
      return raw;
    default:
      return "HEALTHY";
  }
}

export function parsePendingState(raw: string | undefined): UserState | null {
  if (raw === undefined || raw === "null" || raw === "") return null;
  return parseState(raw);
}

export function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function toSummary(record: UserRecord): UserSummary {
  return {
    userId: record.userId,
    username: record.username,
    score: record.score,
    state: record.state,
    stateSince: record.stateSince,
    velocity: record.features.velocity,
    removalRate: record.features.removalRate,
    lastEventAt: record.lastEventAt,
  };
}
