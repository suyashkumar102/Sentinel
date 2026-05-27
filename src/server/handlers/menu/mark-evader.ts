/**
 * Menu item: mark the author of the focused post as a ban evader fingerprint.
 *
 * Useful when a mod wants to seed the fingerprint store from a known bad
 * account without waiting for the state machine to escalate them all the way
 * to BANNED on its own.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { writeJson } from "../../http.ts";
import { getUser, newUserRecord } from "../../storage/user.ts";
import { saveFingerprint } from "../../storage/evaders.ts";

export async function onMarkEvaderFromPost(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
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
    const record = (await getUser(userId)) ?? newUserRecord(userId, authorName, Date.now());

    await saveFingerprint({
      userId,
      username: authorName,
      bannedAt: Date.now(),
      hourHistogram: record.hourHistogram,
      ngramCounts: record.ngramCounts,
      finalScore: record.score,
    });

    writeJson(
      200,
      {
        showToast: {
          text: `Fingerprint saved for u/${authorName}`,
          appearance: "success",
        },
      },
      rsp,
    );
  } catch (err) {
    console.error("[sentinel] mark-evader failed", err);
    writeJson(500, { showToast: { text: "Save failed", appearance: "neutral" } }, rsp);
  }
}
