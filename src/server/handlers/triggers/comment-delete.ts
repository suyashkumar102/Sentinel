/**
 * `onCommentDelete` trigger.
 *
 * Same taxonomy as post-delete:
 *   source = "USER" / 1   → self_delete (weak signal, obs=0.3 on removalRate)
 *   source = 0 / undefined → mod_secondary, skip (onModAction already handled it)
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";

type CommentDeletePayload = {
  readonly commentId?: string;
  readonly author?: { readonly id?: string; readonly name?: string };
  readonly source?: number | string;
  readonly deletedAt?: string | number;
  readonly createdAt?: string | number;
};

function classifySource(src: number | string | undefined): "self_delete" | "mod_secondary" {
  if (src === 1 || src === "USER" || src === "user") return "self_delete";
  return "mod_secondary";
}

export async function onCommentDelete(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<CommentDeletePayload>(req, {});
  console.log("[sentinel] onCommentDelete payload:", JSON.stringify(payload));

  const userId = payload.author?.id;
  const username = payload.author?.name;
  if (!userId || !username) {
    writeJson(200, { ok: true, skipped: "missing author", payload }, rsp);
    return;
  }

  const sourceKind = classifySource(payload.source);

  if (sourceKind === "mod_secondary") {
    writeJson(200, { ok: true, skipped: "mod_secondary_dedup", source: payload.source }, rsp);
    return;
  }

  const tMs = coerceTimestamp(payload.deletedAt ?? payload.createdAt);
  const result = await ingest({
    kind: "self_delete",
    userId,
    username,
    tMs,
  });

  writeJson(200, {
    ok: true,
    source: payload.source,
    kind: "self_delete",
    transitioned: result.transitioned,
    state: result.userAfter.state,
    score: result.userAfter.score,
    submissions: result.userAfter.submissions,
    removals: result.userAfter.removals,
  }, rsp);
}

function coerceTimestamp(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
