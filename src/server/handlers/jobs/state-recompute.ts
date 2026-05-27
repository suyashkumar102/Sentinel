/**
 * Frequent state recompute.
 *
 * Runs every 15 minutes. This is the job that COMMITS pending state transitions
 * once their hysteresis dwell time elapses — even for users who didn't post in
 * the meantime. Without this, an escalating user who happened to go quiet right
 * before crossing the threshold would never transition.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../../http.ts";
import { activeSince } from "../../storage/user.ts";
import { refreshUser } from "../../ingest.ts";

const MAX_PER_TICK = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 14 * DAY_MS; // focus on users active in the last two weeks

export async function onStateRecompute(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const result = await runStateRecompute(Date.now());
  writeJson(200, { ok: true, ...result }, rsp);
}

export async function runStateRecompute(nowMs: number): Promise<{ processed: number; transitions: number }> {
  const ids = await activeSince(nowMs - WINDOW_MS, MAX_PER_TICK);
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
