/**
 * `POST /internal/dev/reset` — wipe all Sentinel data for this subreddit.
 *
 * Settings are preserved (they live behind Devvit's first-class settings,
 * which we mirror but don't blow away). Everything else — user records,
 * trajectories, alerts, evader fingerprints, community history — is dropped.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { redis } from "@devvit/web/server";
import { writeJson } from "../../http.ts";
import { Keys } from "../../storage/keys.ts";

export async function onDevReset(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  let deleted = 0;

  // 1. Watchlist + active index — get every userId, then delete each user's
  //    hash + trajectory zset.
  const watchEntries = await redis.zRange(Keys.watchlist(), 0, -1, { by: "rank" });
  const activeEntries = await redis.zRange(Keys.activeIndex(), 0, -1, { by: "rank" });
  const userIds = new Set<string>();
  for (const e of watchEntries ?? []) userIds.add(e.member);
  for (const e of activeEntries ?? []) userIds.add(e.member);
  for (const userId of userIds) {
    await redis.del(Keys.user(userId));
    await redis.del(Keys.userTrajectory(userId));
    deleted += 2;
  }
  await redis.del(Keys.watchlist());
  await redis.del(Keys.activeIndex());
  deleted += 2;

  // 2. Evader fingerprints — zset index + per-evader hash.
  const evaderEntries = await redis.zRange(Keys.evaderIndex(), 0, -1, { by: "rank" });
  for (const e of evaderEntries ?? []) {
    await redis.del(Keys.evader(e.member));
    deleted++;
  }
  await redis.del(Keys.evaderIndex());
  deleted++;

  // 3. Alerts feed.
  const alertEntries = await redis.zRange(Keys.alertFeed(), 0, -1, { by: "rank" });
  for (const e of alertEntries ?? []) {
    await redis.del(Keys.alert(e.member));
    deleted++;
  }
  await redis.del(Keys.alertFeed());
  deleted++;

  // 4. Community + DF corpus + exempt list.
  await redis.del(Keys.community());
  await redis.del(Keys.communityHistory());
  await redis.del(Keys.documentFrequencies());
  await redis.del(Keys.documentFrequencyTotal());
  await redis.del(Keys.exempt());
  deleted += 5;

  writeJson(200, { type: "dev-reset", deletedKeys: deleted }, rsp);
}
