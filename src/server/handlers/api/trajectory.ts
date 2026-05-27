/**
 * `GET /api/trajectory?userId=…` — full record + trajectory points for a user.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeError, writeJson } from "../../http.ts";
import type { TrajectoryResponse } from "../../../shared/api.ts";
import { getUser } from "../../storage/user.ts";
import { readTrajectory } from "../../storage/trajectory.ts";

export async function onTrajectory(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "", "http://sentinel/");
  const userId = url.searchParams.get("userId") ?? "";
  if (!userId) {
    writeError(400, "missing userId", rsp);
    return;
  }
  const user = await getUser(userId);
  const points = await readTrajectory(userId);
  const body: TrajectoryResponse = {
    type: "trajectory",
    user,
    points,
  };
  writeJson(200, body, rsp);
}
