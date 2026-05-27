/**
 * `onPostDelete` trigger.
 *
 * Devvit fires this for BOTH user self-deletes AND as a secondary event when
 * a mod removes a post via the queue. The mod-removal case is already handled
 * by `onModAction` → `removelink`, so we must NOT double-count it here.
 *
 * Signal taxonomy:
 *   source = "USER" / 1   → user self-deleted their own post
 *                           → ingest as `self_delete` (weak signal, obs=0.3)
 *   source = 0 / undefined → Devvit secondary event fired alongside removelink
 *                           → SKIP to avoid double-counting the mod removal
 *
 * Why self-deletes matter at all:
 *   A user who repeatedly posts and then quickly self-deletes is exhibiting
 *   a pattern — testing the waters, evading mod attention, or cleaning up
 *   after rule-breaking. It's a weaker signal than a mod removal but not zero.
 *   We weight it at 0.3 on the removalRate EMA vs 1.0 for a mod removal.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";

type PostDeletePayload = {
  readonly postId?: string;
  readonly author?: { readonly id?: string; readonly name?: string };
  readonly source?: number | string;
  readonly createdAt?: string | number;
  readonly deletedAt?: string | number;
};

function classifySource(src: number | string | undefined): "self_delete" | "mod_secondary" {
  // Devvit sends source=1 or source="USER"/"user" for user-initiated deletes.
  // source=0, null, or undefined means this is the secondary event from a mod removal.
  if (src === 1 || src === "USER" || src === "user") return "self_delete";
  return "mod_secondary";
}

export async function onPostDelete(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<PostDeletePayload>(req, {});
  console.log("[sentinel] onPostDelete payload:", JSON.stringify(payload));

  const userId = payload.author?.id;
  const username = payload.author?.name;
  if (!userId || !username) {
    writeJson(200, { ok: true, skipped: "missing author", payload }, rsp);
    return;
  }

  const sourceKind = classifySource(payload.source);

  // Skip the secondary mod-removal event — onModAction already handled it.
  if (sourceKind === "mod_secondary") {
    writeJson(200, { ok: true, skipped: "mod_secondary_dedup", source: payload.source }, rsp);
    return;
  }

  // User self-deleted — ingest as weak removal signal.
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
