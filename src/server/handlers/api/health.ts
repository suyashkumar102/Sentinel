/**
 * `GET /api/health` — current community health snapshot.
 *
 * If the drift job hasn't run yet (fresh install), we compute synchronously
 * so the first dashboard view still shows real data.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context } from "@devvit/web/server";
import { writeJson } from "../../http.ts";
import type { HealthResponse } from "../../../shared/api.ts";
import { readHealth } from "../../storage/community.ts";
import { runCommunityDrift } from "../jobs/community-drift.ts";

export async function onHealth(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const subreddit = context.subredditName ?? "unknown";
  let health = await readHealth(subreddit);
  if (!health) {
    await runCommunityDrift(Date.now());
    health = await readHealth(subreddit);
  }
  if (!health) {
    writeJson(200, { type: "health", health: null as unknown }, rsp);
    return;
  }
  const body: HealthResponse = { type: "health", health };
  writeJson(200, body, rsp);
}
