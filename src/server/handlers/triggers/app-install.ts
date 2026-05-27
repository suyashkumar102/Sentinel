/**
 * App install trigger.
 *
 * Fires once when a moderator installs Sentinel into a subreddit. We:
 *   1. Persist the default settings into our own hash (so the dashboard can
 *      read them without going through Devvit settings every time).
 *   2. Submit a single dashboard post into the subreddit, pinned to the top of
 *      the mod queue so the team has a single landing place.
 *   3. Stamp the schema version into Redis for future migrations.
 */
import type { ServerResponse } from "node:http";
import { reddit, context } from "@devvit/web/server";
import { redis } from "@devvit/web/server";
import { writeJson } from "../../http.ts";
import { SCHEMA_VERSION } from "../../../shared/constants.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../storage/settings.ts";
import { Keys } from "../../storage/keys.ts";

export async function onAppInstall(_req: unknown, rsp: ServerResponse): Promise<void> {
  await writeSettings(DEFAULT_SETTINGS);
  await redis.set(Keys.schemaVersion(), String(SCHEMA_VERSION));

  try {
    await reddit.submitCustomPost({
      title: "Sentinel — moderator dashboard",
      subredditName: context.subredditName ?? undefined,
      postData: { kind: "dashboard" },
    });
  } catch (err) {
    console.error("[sentinel] dashboard post creation failed", err);
  }

  writeJson(200, { ok: true, schema: SCHEMA_VERSION }, rsp);
}
