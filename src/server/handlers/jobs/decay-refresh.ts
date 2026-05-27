/**
 * Hourly decay refresh.
 *
 * Walks the active index (users with activity in the last 30 days) and runs a
 * no-op `refreshUser()` on each. This keeps the score moving for users who
 * haven't done anything recently — a user who's been clean for two months
 * should drift back toward HEALTHY even without new events.
 *
 * Bounded to MAX_PER_TICK users per run so we never spend more than a few
 * hundred ms of CPU per scheduler invocation.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../../http.ts";
import { activeSince } from "../../storage/user.ts";
import { refreshUser } from "../../ingest.ts";

const MAX_PER_TICK = 250;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 60 * DAY_MS;

export async function onDecayRefresh(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const now = Date.now();
  const result = await runDecayRefresh(now);
  writeJson(200, { ok: true, ...result }, rsp);
}

export async function runDecayRefresh(nowMs: number): Promise<{ processed: number; transitions: number }> {
  const sinceMs = nowMs - WINDOW_MS;
  const ids = await activeSince(sinceMs, MAX_PER_TICK);
  let processed = 0;
  let transitions = 0;
  for (const id of ids) {
    const r = await refreshUser(id, nowMs);
    if (r) {
      processed += 1;
      if (r.transitioned) transitions += 1;
    }
  }
  return { processed, transitions };
}
