/**
 * `onPostSubmit` trigger.
 *
 * Payload contains the author + post body. We construct a `SentinelEvent`
 * of kind `submission` and hand it to the ingest pipeline.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";

type PostSubmitPayload = {
  readonly post?: {
    readonly id?: string;
    readonly authorId?: string;
    readonly title?: string;
    readonly selftext?: string;
    readonly createdAt?: string | number;
  };
  readonly author?: {
    readonly id?: string;
    readonly name?: string;
  };
};

export async function onPostSubmit(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  return handlePost(req, rsp);
}

/** `onPostCreate` shares its payload shape with `onPostSubmit` and fires for
 *  Devvit-app-authored custom posts. We route both through the same pipeline so
 *  the dashboard sees activity regardless of which event Reddit dispatched. */
export async function onPostCreate(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  return handlePost(req, rsp);
}

async function handlePost(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<PostSubmitPayload>(req, {});
  const post = payload.post;
  const author = payload.author;
  const userId = author?.id ?? post?.authorId;
  const username = author?.name;
  if (!post || !userId || !username) {
    writeJson(200, { ok: true, skipped: "missing author", payload }, rsp);
    return;
  }

  const tMs = coerceTimestamp(post.createdAt);
  const body = [post.title ?? "", post.selftext ?? ""].join("\n").trim();

  const result = await ingest({
    kind: "submission",
    userId,
    username,
    tMs,
    body,
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

function coerceTimestamp(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
