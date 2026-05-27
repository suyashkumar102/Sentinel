/**
 * App upgrade trigger.
 *
 * Fires when an existing installation upgrades to a newer version. We use this
 * to migrate any schema drift; for v1 this is a no-op past restamping the
 * version key.
 */
import type { ServerResponse } from "node:http";
import { redis } from "@devvit/web/server";
import { writeJson } from "../../http.ts";
import { SCHEMA_VERSION } from "../../../shared/constants.ts";
import { Keys } from "../../storage/keys.ts";

export async function onAppUpgrade(_req: unknown, rsp: ServerResponse): Promise<void> {
  const prior = await redis.get(Keys.schemaVersion());
  const priorN = prior === null || prior === undefined ? 0 : Number(prior);
  // Future migrations branch on priorN here.
  await redis.set(Keys.schemaVersion(), String(SCHEMA_VERSION));
  writeJson(200, { ok: true, from: priorN, to: SCHEMA_VERSION }, rsp);
}
