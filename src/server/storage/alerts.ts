/**
 * Alert persistence + dedup.
 *
 * Each alert is stored by ID, indexed by timestamp in a sorted-set feed, and
 * deduplicated by a TTL key so the same (user, transition) combo doesn't
 * spam the queue if a score oscillates near a threshold.
 */
import { redis } from "@devvit/web/server";
import { ALERT_DEDUP_SECONDS } from "../../shared/constants.ts";
import type { Alert } from "../../shared/types.ts";
import { Keys } from "./keys.ts";

const ALERT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export async function recordAlert(alert: Alert): Promise<void> {
  await redis.set(Keys.alert(alert.id), JSON.stringify(alert), {
    expiration: new Date(alert.createdAt + ALERT_RETENTION_MS),
  });
  await redis.zAdd(Keys.alertFeed(), {
    member: alert.id,
    score: alert.createdAt,
  });
  // Trim the feed index to one year — TTL on individual alerts handles the rest.
  await redis.zRemRangeByScore(
    Keys.alertFeed(),
    0,
    alert.createdAt - 365 * 24 * 60 * 60 * 1000,
  );
}

export async function recentAlerts(limit: number = 20): Promise<Alert[]> {
  const entries = await redis.zRange(Keys.alertFeed(), 0, limit - 1, {
    by: "rank",
    reverse: true,
  });
  if (!entries || entries.length === 0) return [];
  const out: Alert[] = [];
  for (const e of entries) {
    const raw = await redis.get(Keys.alert(e.member));
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as Alert);
    } catch {
      // skip malformed alert
    }
  }
  return out;
}

/**
 * Atomic dedup gate. Returns `true` if the caller should proceed with sending
 * the alert; `false` if a duplicate was suppressed inside the TTL window.
 */
export async function shouldFire(userId: string, kind: string): Promise<boolean> {
  const key = Keys.alertDedup(userId, kind);
  const existing = await redis.get(key);
  if (existing) return false;
  await redis.set(key, "1", { expiration: new Date(Date.now() + ALERT_DEDUP_SECONDS * 1000) });
  return true;
}
