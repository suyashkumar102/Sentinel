/**
 * Menu item: add the author of the current post to Sentinel's exempt list.
 *
 * Mods, regulars, partner accounts, etc. should never be scored. Adding to
 * the exempt set is reversible from the dashboard.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { writeJson } from "../../http.ts";
import { addExempt } from "../../storage/settings.ts";

export async function onExemptFromPost(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const postId = context.postId;
  if (!postId) {
    writeJson(400, { showToast: { text: "No post in context", appearance: "neutral" } }, rsp);
    return;
  }
  try {
    const post = await reddit.getPostById(postId);
    if (!post) {
      writeJson(404, { showToast: { text: "Post not found", appearance: "neutral" } }, rsp);
      return;
    }
    const authorName = post.authorName ?? "unknown";
    const user = await reddit.getUserByUsername(authorName).catch(() => null);
    const userId = user?.id ?? authorName;
    await addExempt(userId);
    writeJson(
      200,
      { showToast: { text: `u/${authorName} exempted from Sentinel`, appearance: "success" } },
      rsp,
    );
  } catch (err) {
    console.error("[sentinel] exempt-user failed", err);
    writeJson(500, { showToast: { text: "Exempt failed", appearance: "neutral" } }, rsp);
  }
}
