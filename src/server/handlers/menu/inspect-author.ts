/**
 * Menu items for inspecting the author of a post / comment.
 *
 * Both menu items end up here. Devvit's menu invocation supplies `postId` /
 * `commentId` via the request context; we resolve the author and navigate to
 * a freshly minted dashboard post focused on that user.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context, reddit } from "@devvit/web/server";
import type { UiResponse } from "@devvit/web/shared";
import { writeJson } from "../../http.ts";
import { getUser } from "../../storage/user.ts";

export async function onInspectPostAuthor(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
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
    await navigateToDashboard(authorName, rsp);
  } catch (err) {
    console.error("[sentinel] inspect-post-author failed", err);
    writeJson(500, { showToast: { text: "Inspection failed", appearance: "neutral" } }, rsp);
  }
}

export async function onInspectCommentAuthor(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const commentId = context.commentId;
  if (!commentId) {
    writeJson(400, { showToast: { text: "No comment in context", appearance: "neutral" } }, rsp);
    return;
  }
  try {
    const comment = await reddit.getCommentById(commentId);
    if (!comment) {
      writeJson(404, { showToast: { text: "Comment not found", appearance: "neutral" } }, rsp);
      return;
    }
    const authorName = comment.authorName ?? "unknown";
    await navigateToDashboard(authorName, rsp);
  } catch (err) {
    console.error("[sentinel] inspect-comment-author failed", err);
    writeJson(500, { showToast: { text: "Inspection failed", appearance: "neutral" } }, rsp);
  }
}

async function navigateToDashboard(username: string, rsp: ServerResponse): Promise<void> {
  const user = await reddit.getUserByUsername(username).catch(() => null);
  const userId = user?.id ?? username;
  const record = await getUser(userId);
  const stateLabel = record ? `(${record.state}, ${record.score.toFixed(2)})` : "(no data)";

  const post = await reddit.submitCustomPost({
    title: `Sentinel — u/${username} ${stateLabel}`,
    subredditName: context.subredditName ?? undefined,
    postData: { kind: "dashboard", focusUserId: userId, focusUsername: username },
  });
  writeJson(
    200,
    {
      navigateTo: post.url,
      showToast: { text: `Opening Sentinel for u/${username}`, appearance: "success" },
    },
    rsp,
  );
}
