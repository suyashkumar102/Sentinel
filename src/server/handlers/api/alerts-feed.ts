/**
 * `GET /api/alerts` — most recent alerts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../../http.ts";
import type { AlertsFeedResponse } from "../../../shared/api.ts";
import { recentAlerts } from "../../storage/alerts.ts";

export async function onAlertsFeed(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "", "http://sentinel/");
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const alerts = await recentAlerts(Math.min(200, Math.max(1, limit)));
  const body: AlertsFeedResponse = { type: "alerts", alerts };
  writeJson(200, body, rsp);
}
