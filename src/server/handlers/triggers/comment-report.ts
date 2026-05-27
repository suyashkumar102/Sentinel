/**
 * `onCommentReport` trigger.
 *
 * Mirror of `post-report` for comments.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { reddit } from "@devvit/web/server";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";

type CommentReportPayload = {
  readonly comment?: {
    readonly author?: string;
    readonly createdAt?: string | number;
  };
  readonly reason?: string;
};

export async function onCommentReport(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<CommentReportPayload>(req, {});
  const author = payload.comment?.author;
  if (!author) {
    writeJson(200, { ok: true, skipped: "missing author", payload }, rsp);
    return;
  }

  const cleanAuthor = author.replace(/^u\//, "");
  let userId = cleanAuthor;
  let username = cleanAuthor;
  try {
    const user = await reddit.getUserByUsername(cleanAuthor);
    if (user?.id) {
      userId = user.id;
      username = user.username || cleanAuthor;
    }
  } catch {
    // fallback
  }

  const tMs = coerceTimestamp(payload.comment?.createdAt);
  const result = await ingest({
    kind: "report",
    userId,
    username,
    tMs,
    onFlaggedThread: true,
  });
  writeJson(200, { ok: true, state: result.userAfter.state, score: result.userAfter.score }, rsp);
}

function coerceTimestamp(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
