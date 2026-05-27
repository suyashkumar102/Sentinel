/**
 * `GET /api/watchlist` — paginated list of users in WATCHING/ELEVATED/CRITICAL.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../../http.ts";
import type { WatchlistResponse } from "../../../shared/api.ts";
import { topByScore } from "../../storage/user.ts";
import type { UserState } from "../../../shared/types.ts";
import { WATCHLIST_LIMIT } from "../../../shared/constants.ts";

export async function onWatchlist(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "", "http://sentinel/");
  const minState = (url.searchParams.get("state") as UserState | null) ?? "WATCHING";
  const limit = Number(url.searchParams.get("limit") ?? WATCHLIST_LIMIT);
  const users = await topByScore(Math.min(WATCHLIST_LIMIT, Math.max(1, limit)), minState);
  const body: WatchlistResponse = { type: "watchlist", users, cursor: null };
  writeJson(200, body, rsp);
}
