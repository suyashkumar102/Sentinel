/**
 * Tiny HTTP plumbing shared by every route handler.
 *
 * Devvit's web actor speaks plain Node `http` (`IncomingMessage`, `ServerResponse`).
 * We keep the wiring deliberately minimal — no Express, no middleware stack —
 * because every dependency we add is a moving part Devvit reviewers have to
 * trust during install review.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";

export type ErrorBody = { readonly error: string; readonly status: number };

/**
 * Write a JSON body. We intentionally accept `unknown` rather than narrowing to
 * `PartialJsonValue`: our shared API types use `readonly` everywhere for
 * immutability, but `PartialJsonValue` requires mutable arrays. JSON.stringify
 * itself doesn't care.
 */
export function writeJson(status: number, body: unknown, rsp: ServerResponse): void {
  const payload = JSON.stringify(body);
  const len = Buffer.byteLength(payload);
  rsp.writeHead(status, {
    "Content-Length": len,
    "Content-Type": "application/json",
  });
  rsp.end(payload);
}

export function writeError(status: number, message: string, rsp: ServerResponse): void {
  writeJson(status, { error: message, status } satisfies ErrorBody, rsp);
}

export async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Uint8Array[] = [];
  req.on("data", (chunk) => chunks.push(chunk));
  await once(req, "end");
  if (chunks.length === 0) return {} as T;
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw.length === 0) return {} as T;
  return JSON.parse(raw) as T;
}

export async function readJsonOr<T>(req: IncomingMessage, fallback: T): Promise<T> {
  try {
    const v = await readJson<T>(req);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
