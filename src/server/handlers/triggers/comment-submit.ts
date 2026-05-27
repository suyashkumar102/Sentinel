/**
 * `onCommentSubmit` trigger.
 *
 * Same shape as post-submit, but the body is the comment body and (importantly)
 * we mark the engagement as on-flagged-thread if the parent post has been
 * removed or locked. The parent-thread check is best-effort — if Reddit's API
 * fails or rate-limits we fall back to treating the engagement as neutral.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { reddit } from "@devvit/web/server";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";

type CommentSubmitPayload = {
  readonly comment?: {
    readonly id?: string;
    readonly body?: string;
    readonly createdAt?: string | number;
    readonly parentId?: string;
    readonly postId?: string;
  };
  readonly author?: {
    readonly id?: string;
    readonly name?: string;
  };
};

export async function onCommentSubmit(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<CommentSubmitPayload>(req, {});
  const c = payload.comment;
  const author = payload.author;
  if (!c || !author?.id || !author?.name) {
    writeJson(200, { ok: true, skipped: "missing author", payload }, rsp);
    return;
  }

  const tMs = coerceTimestamp(c.createdAt);
  const onFlaggedThread = c.postId ? await isFlaggedThread(c.postId) : false;

  const result = await ingest({
    kind: "submission",
    userId: author.id,
    username: author.name,
    tMs,
    body: c.body ?? "",
    onFlaggedThread,
  });

  writeJson(
    200,
    {
      ok: true,
      transitioned: result.transitioned,
      state: result.userAfter.state,
      score: result.userAfter.score,
    },
    rsp,
  );
}

async function isFlaggedThread(postId: string): Promise<boolean> {
  const tid: `t3_${string}` = postId.startsWith("t3_")
    ? (postId as `t3_${string}`)
    : (`t3_${postId}` as `t3_${string}`);
  try {
    const post = await reddit.getPostById(tid);
    if (!post) return false;
    if (post.locked === true) return true;
    if (post.removed === true) return true;
    if (post.spam === true) return true;
    const reports = typeof post.numberOfReports === "number" ? post.numberOfReports : 0;
    if (reports >= 3) return true;
    return false;
  } catch {
    return false;
  }
}

function coerceTimestamp(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
