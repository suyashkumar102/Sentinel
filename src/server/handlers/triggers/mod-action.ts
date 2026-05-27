/**
 * `onModAction` trigger.
 *
 * The richest trigger in the system — every action a mod takes in the queue
 * (approval, removal, ban, warn, distinguish, lock, etc.) flows here. We
 * route the relevant subset into the ingest pipeline:
 *
 *   removelink / removecomment       → `removal`     (drives removalRate)
 *   approvelink / approvecomment     → `approval`    (drives removalRate down)
 *   banuser                          → `ban`         (terminal: BANNED + save fingerprint)
 *   unbanuser                        → reset (move out of BANNED)
 *   muteuser / acceptmoderatorinvite → ignored
 *   distinguish                      → ignored
 *
 * Anything else is logged for audit but not folded into features.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonOr, writeJson } from "../../http.ts";
import { ingest } from "../../ingest.ts";
import { getUser, putUser } from "../../storage/user.ts";
import { saveFingerprint, deleteFingerprint } from "../../storage/evaders.ts";
import { SCHEMA_VERSION } from "../../../shared/constants.ts";

type ModActionPayload = {
  readonly action?: string;
  readonly actionedAt?: string | number;
  readonly moderator?: { readonly id?: string; readonly name?: string };
  readonly targetUser?: { readonly id?: string; readonly name?: string };
  // Devvit populates targetPost for removelink/approvelink actions.
  // authorId is always present; authorName may be absent in some payload versions.
  readonly targetPost?: {
    readonly id?: string;
    readonly authorId?: string;
    readonly authorName?: string;
    // Some Devvit versions nest author info here instead
    readonly author?: { readonly id?: string; readonly name?: string };
  };
  readonly targetComment?: {
    readonly id?: string;
    readonly author?: string;
    readonly authorId?: string;
    // Some Devvit versions nest author info here instead
    readonly authorInfo?: { readonly id?: string; readonly name?: string };
  };
};

export async function onModAction(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const payload = await readJsonOr<ModActionPayload>(req, {});
  const action = (payload.action ?? "").toLowerCase();
  console.log("[sentinel] onModAction action:", action, "payload:", JSON.stringify(payload));

  // userId: check every possible location Devvit might put it
  const userId =
    payload.targetUser?.id ??
    payload.targetPost?.author?.id ??
    payload.targetPost?.authorId ??
    payload.targetComment?.authorInfo?.id ??
    payload.targetComment?.authorId ??
    "";

  // username: check every possible location Devvit might put it
  const username =
    payload.targetUser?.name ??
    payload.targetPost?.author?.name ??
    payload.targetPost?.authorName ??
    payload.targetComment?.authorInfo?.name ??
    payload.targetComment?.author ??
    "";

  // If we have a userId but no username, use userId as a fallback so the
  // event is not silently dropped — the username will be corrected on the
  // next submission event from that user.
  const effectiveUsername = username || userId;

  if (!userId) {
    writeJson(200, { ok: true, action, skipped: "no target user", payload }, rsp);
    return;
  }

  const tMs = coerceTimestamp(payload.actionedAt);

  switch (action) {
    case "removelink":
    case "removecomment":
    case "spamlink":
    case "spamcomment": {
      const result = await ingest({ kind: "removal", userId, username: effectiveUsername, tMs });
      writeJson(200, { ok: true, action, state: result.userAfter.state }, rsp);
      return;
    }
    case "approvelink":
    case "approvecomment": {
      const result = await ingest({ kind: "approval", userId, username: effectiveUsername, tMs });
      writeJson(200, { ok: true, action, state: result.userAfter.state }, rsp);
      return;
    }
    case "warning":
    case "addremovalreason": {
      const result = await ingest({ kind: "warning", userId, username: effectiveUsername, tMs });
      writeJson(200, { ok: true, action, state: result.userAfter.state }, rsp);
      return;
    }
    case "banuser": {
      const after = await markBanned(userId, effectiveUsername, tMs);
      writeJson(200, { ok: true, action, state: after.state }, rsp);
      return;
    }
    case "unbanuser": {
      const after = await unbanUser(userId, effectiveUsername, tMs);
      writeJson(200, { ok: true, action, state: after.state }, rsp);
      return;
    }
    default:
      writeJson(200, { ok: true, action, skipped: "not scored" }, rsp);
  }
}

async function markBanned(userId: string, username: string, tMs: number) {
  const previous = await getUser(userId);
  if (!previous) {
    // Even ungrabbed users get a tombstone so re-bans don't duplicate fingerprints.
    return {
      state: "BANNED" as const,
    };
  }
  const after = {
    ...previous,
    username,
    state: "BANNED" as const,
    stateSince: tMs,
    pendingState: null,
    pendingSince: null,
    schema: SCHEMA_VERSION,
  };
  await putUser(after);
  await saveFingerprint({
    userId,
    username,
    bannedAt: tMs,
    hourHistogram: previous.hourHistogram,
    ngramCounts: previous.ngramCounts,
    finalScore: previous.score,
  });
  return after;
}

async function unbanUser(userId: string, username: string, tMs: number) {
  const previous = await getUser(userId);
  if (!previous) return { state: "HEALTHY" as const };
  const after = {
    ...previous,
    username,
    state: "WATCHING" as const,
    stateSince: tMs,
    pendingState: null,
    pendingSince: null,
    schema: SCHEMA_VERSION,
  };
  await putUser(after);
  await deleteFingerprint(userId);
  return after;
}

function coerceTimestamp(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}
