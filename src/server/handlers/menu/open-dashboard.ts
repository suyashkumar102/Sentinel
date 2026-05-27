/**
 * Menu item: open Sentinel dashboard.
 *
 * Creates (or reuses) a custom post with the `dashboard` entrypoint, then
 * navigates the moderator to it. We always create a fresh post so the mod
 * gets a private, lightweight view without polluting the subreddit feed —
 * Devvit hides these from the user-visible new/hot listings when authored by
 * the app account.
 */
import type { ServerResponse } from "node:http";
import { context, reddit } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { writeJson } from "../../http.ts";

export async function onOpenDashboard(_req: unknown, rsp: ServerResponse): Promise<void> {
  const subredditName = context.subredditName ?? "this subreddit";
  try {
    const post = await reddit.submitCustomPost({
      title: `Sentinel — dashboard (${new Date().toISOString().slice(0, 10)})`,
      subredditName: context.subredditName ?? undefined,
      postData: { kind: "dashboard" },
    });
    const body: UiResponse = {
      navigateTo: post.url,
      showToast: { text: `Sentinel dashboard ready for ${subredditName}`, appearance: "success" },
    };
    writeJson(200, body, rsp);
  } catch (err) {
    console.error("[sentinel] open-dashboard failed", err);
    writeJson(
      500,
      {
        showToast: { text: "Could not open dashboard. Check mod log.", appearance: "neutral" },
      },
      rsp,
    );
  }
}
