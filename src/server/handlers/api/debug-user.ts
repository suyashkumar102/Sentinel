/**
 * `GET /api/debug/user?username=<name>` — dump the raw stored record for a
 * user so you can verify events are being received and scored correctly.
 *
 * Returns the full UserRecord plus the trajectory points. Mod-only endpoint
 * (only reachable from inside Devvit's authenticated runtime).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { reddit } from "@devvit/web/server";
import { writeJson, writeError } from "../../http.ts";
import { getUser } from "../../storage/user.ts";
import { readTrajectory } from "../../storage/trajectory.ts";

export async function onDebugUser(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "", "http://sentinel/");
  const username = url.searchParams.get("username") ?? "";
  const userId = url.searchParams.get("userId") ?? "";

  if (!username && !userId) {
    writeError(400, "provide ?username=<name> or ?userId=<id>", rsp);
    return;
  }

  // Resolve userId from username if needed
  let resolvedId = userId;
  let resolvedName = username;
  if (!resolvedId && username) {
    try {
      const user = await reddit.getUserByUsername(username);
      resolvedId = user?.id ?? "";
      resolvedName = user?.username ?? username;
    } catch {
      // fall through — try username as id directly
      resolvedId = username;
    }
  }

  const record = await getUser(resolvedId);
  const trajectory = record ? await readTrajectory(resolvedId) : [];

  writeJson(200, {
    type: "debug-user",
    queried: { username: resolvedName, userId: resolvedId },
    found: record !== null,
    record,
    trajectory,
    trajectoryLength: trajectory.length,
  }, rsp);
}
