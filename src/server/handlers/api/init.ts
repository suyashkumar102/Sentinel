/**
 * `GET /api/init` — single payload that hydrates the dashboard on load.
 *
 * Returns: settings + community health + top watchlist + recent alerts.
 * The dashboard makes ONE round-trip to render the initial view, then polls
 * the focused endpoints (`/api/trajectory?userId=…` etc.) on user interaction.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context } from "@devvit/web/server";
import { writeJson } from "../../http.ts";
import type { InitResponse } from "../../../shared/api.ts";
import { WATCHLIST_LIMIT } from "../../../shared/constants.ts";
import { readSettings } from "../../storage/settings.ts";
import { readHealth } from "../../storage/community.ts";
import { topByScore } from "../../storage/user.ts";
import { recentAlerts } from "../../storage/alerts.ts";

export async function onInit(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const subreddit = context.subredditName ?? "unknown";
  const username = context.username ?? "moderator";
  const settings = await readSettings();
  const health = await readHealth(subreddit);
  const watchlist = await topByScore(WATCHLIST_LIMIT, "WATCHING");
  const alerts = await recentAlerts(20);

  const body: InitResponse = {
    type: "init",
    subreddit,
    username,
    settings,
    health,
    watchlist,
    recentAlerts: alerts,
  };
  writeJson(200, body, rsp);
}
