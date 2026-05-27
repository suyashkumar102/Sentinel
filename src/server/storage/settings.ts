/**
 * Per-installation settings store.
 *
 * Devvit also exposes a first-class `settings` module; we mirror its values
 * into our own hash so the dashboard can read them without a round-trip to
 * Reddit's settings service, and so we have a single source of truth for our
 * own background jobs.
 */
import { redis } from "@devvit/web/server";
import {
  DEFAULT_DECAY_WINDOW_DAYS,
  DEFAULT_DEESCALATE_DAYS,
  DEFAULT_ESCALATE_DAYS,
  DEFAULT_EVADER_SIMILARITY,
  DEFAULT_THRESHOLD_CRITICAL,
  DEFAULT_THRESHOLD_ELEVATED,
  DEFAULT_THRESHOLD_WATCHING,
} from "../../shared/constants.ts";
import type { SentinelSettings } from "../../shared/types.ts";
import { Keys } from "./keys.ts";

export const DEFAULT_SETTINGS: SentinelSettings = {
  decayWindowDays: DEFAULT_DECAY_WINDOW_DAYS,
  thresholdWatching: DEFAULT_THRESHOLD_WATCHING,
  thresholdElevated: DEFAULT_THRESHOLD_ELEVATED,
  thresholdCritical: DEFAULT_THRESHOLD_CRITICAL,
  escalateAfterDays: DEFAULT_ESCALATE_DAYS,
  deescalateAfterDays: DEFAULT_DEESCALATE_DAYS,
  evaderSimilarityThreshold: DEFAULT_EVADER_SIMILARITY,
  alertChannel: "modmail",
  enabled: true,
  exemptUsers: [],
};

export async function readSettings(): Promise<SentinelSettings> {
  const raw = await redis.hGetAll(Keys.settings());
  if (!raw || Object.keys(raw).length === 0) return { ...DEFAULT_SETTINGS };
  return {
    decayWindowDays: parseNumber(raw["decayWindowDays"], DEFAULT_SETTINGS.decayWindowDays),
    thresholdWatching: parseNumber(raw["thresholdWatching"], DEFAULT_SETTINGS.thresholdWatching),
    thresholdElevated: parseNumber(raw["thresholdElevated"], DEFAULT_SETTINGS.thresholdElevated),
    thresholdCritical: parseNumber(raw["thresholdCritical"], DEFAULT_SETTINGS.thresholdCritical),
    escalateAfterDays: parseNumber(raw["escalateAfterDays"], DEFAULT_SETTINGS.escalateAfterDays),
    deescalateAfterDays: parseNumber(raw["deescalateAfterDays"], DEFAULT_SETTINGS.deescalateAfterDays),
    evaderSimilarityThreshold: parseNumber(
      raw["evaderSimilarityThreshold"],
      DEFAULT_SETTINGS.evaderSimilarityThreshold,
    ),
    alertChannel: parseChannel(raw["alertChannel"]),
    enabled: raw["enabled"] !== "false",
    exemptUsers: parseJson<string[]>(raw["exemptUsers"], []),
  };
}

export async function writeSettings(s: SentinelSettings): Promise<void> {
  await redis.hSet(Keys.settings(), {
    decayWindowDays: String(s.decayWindowDays),
    thresholdWatching: String(s.thresholdWatching),
    thresholdElevated: String(s.thresholdElevated),
    thresholdCritical: String(s.thresholdCritical),
    escalateAfterDays: String(s.escalateAfterDays),
    deescalateAfterDays: String(s.deescalateAfterDays),
    evaderSimilarityThreshold: String(s.evaderSimilarityThreshold),
    alertChannel: s.alertChannel,
    enabled: s.enabled ? "true" : "false",
    exemptUsers: JSON.stringify(s.exemptUsers),
  });
}

// Devvit's Redis client doesn't expose set primitives, so we model the exempt
// list as a hash where each field is a userId. Membership checks via hGet,
// listing via hKeys, mutation via hSet/hDel.
export async function addExempt(userId: string): Promise<void> {
  await redis.hSet(Keys.exempt(), { [userId]: "1" });
}

export async function removeExempt(userId: string): Promise<void> {
  await redis.hDel(Keys.exempt(), [userId]);
}

export async function isExempt(userId: string): Promise<boolean> {
  const v = await redis.hGet(Keys.exempt(), userId);
  return v !== undefined && v !== null;
}

export async function listExempt(): Promise<string[]> {
  const keys = await redis.hKeys(Keys.exempt());
  return keys ?? [];
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

function parseChannel(raw: string | undefined): SentinelSettings["alertChannel"] {
  switch (raw) {
    case "modmail":
    case "modnote":
    case "both":
      return raw;
    default:
      return "modmail";
  }
}

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
