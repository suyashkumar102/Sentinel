/**
 * `onPostReport` trigger.
 *
 * A report is a weak signal — Sentinel records it on the AUTHOR's controversy
 * axis (and the reporter is left alone; reporters aren't tracked). False
 * reports are common enough that we down-weight reports vs removals.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";

type PostReportPayload = {
  readonly post?: {
    readonly authorId?: string;
    readonly createdAt?: string | number;
  };
  readonly reason?: string;
};

export async function onPostReport(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<PostReportPayload>(req, {});
  const userId = payload.post?.authorId;
  if (!userId) {
    writeJson(200, { ok: true, skipped: "missing author", payload }, rsp);
    return;
  }
  const tMs = coerceTimestamp(payload.post?.createdAt);
  const result = await ingest({
    kind: "report",
    userId,
    username: "", // Pass empty username so it defaults to the existing record's username
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
