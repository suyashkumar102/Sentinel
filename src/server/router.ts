/**
 * Central URL router.
 *
 * Single switch statement — keeps the wiring legible and audit-friendly.
 * Anything unmatched returns 404.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeError } from "./http.ts";
import { ApiEndpoint } from "../shared/api.ts";

import { onAppInstall } from "./handlers/triggers/app-install.ts";
import { onAppUpgrade } from "./handlers/triggers/app-upgrade.ts";
import { onPostCreate, onPostSubmit } from "./handlers/triggers/post-submit.ts";
import { onPostDelete } from "./handlers/triggers/post-delete.ts";
import { onPostReport } from "./handlers/triggers/post-report.ts";
import { onCommentSubmit } from "./handlers/triggers/comment-submit.ts";
import { onCommentDelete } from "./handlers/triggers/comment-delete.ts";
import { onCommentReport } from "./handlers/triggers/comment-report.ts";
import { onModAction } from "./handlers/triggers/mod-action.ts";

import { onOpenDashboard } from "./handlers/menu/open-dashboard.ts";
import {
  onInspectPostAuthor,
  onInspectCommentAuthor,
} from "./handlers/menu/inspect-author.ts";
import { onMarkEvaderFromPost } from "./handlers/menu/mark-evader.ts";
import { onExemptFromPost } from "./handlers/menu/exempt-user.ts";
import { onRecompute } from "./handlers/menu/recompute.ts";

import { onCommunityDrift } from "./handlers/jobs/community-drift.ts";
import { onDecayRefresh } from "./handlers/jobs/decay-refresh.ts";
import { onStateRecompute } from "./handlers/jobs/state-recompute.ts";

import { onInit } from "./handlers/api/init.ts";
import { onOverview } from "./handlers/api/overview.ts";
import { onTrajectory } from "./handlers/api/trajectory.ts";
import { onWatchlist } from "./handlers/api/watchlist.ts";
import { onHealth } from "./handlers/api/health.ts";
import { onAlertsFeed } from "./handlers/api/alerts-feed.ts";
import { onEvaders } from "./handlers/api/evaders.ts";
import { onDevSeed } from "./handlers/api/dev-seed.ts";
import { onDevReset } from "./handlers/api/dev-reset.ts";
import { onDebugUser } from "./handlers/api/debug-user.ts";

export async function dispatch(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0] ?? "";
  switch (path) {
    // triggers
    case ApiEndpoint.TriggerAppInstall:
      return onAppInstall(req, rsp);
    case ApiEndpoint.TriggerAppUpgrade:
      return onAppUpgrade(req, rsp);
    case ApiEndpoint.TriggerPostSubmit:
      return onPostSubmit(req, rsp);
    case ApiEndpoint.TriggerPostCreate:
      return onPostCreate(req, rsp);
    case ApiEndpoint.TriggerPostDelete:
      return onPostDelete(req, rsp);
    case ApiEndpoint.TriggerPostReport:
      return onPostReport(req, rsp);
    case ApiEndpoint.TriggerCommentSubmit:
      return onCommentSubmit(req, rsp);
    case ApiEndpoint.TriggerCommentDelete:
      return onCommentDelete(req, rsp);
    case ApiEndpoint.TriggerCommentReport:
      return onCommentReport(req, rsp);
    case ApiEndpoint.TriggerModAction:
      return onModAction(req, rsp);

    // menu
    case ApiEndpoint.MenuOpenDashboard:
      return onOpenDashboard(req, rsp);
    case ApiEndpoint.MenuInspectPostAuthor:
      return onInspectPostAuthor(req, rsp);
    case ApiEndpoint.MenuInspectCommentAuthor:
      return onInspectCommentAuthor(req, rsp);
    case ApiEndpoint.MenuMarkEvaderFromPost:
      return onMarkEvaderFromPost(req, rsp);
    case ApiEndpoint.MenuExemptFromPost:
      return onExemptFromPost(req, rsp);
    case ApiEndpoint.MenuRecompute:
      return onRecompute(req, rsp);

    // scheduler jobs
    case ApiEndpoint.JobCommunityDrift:
      return onCommunityDrift(req, rsp);
    case ApiEndpoint.JobDecayRefresh:
      return onDecayRefresh(req, rsp);
    case ApiEndpoint.JobStateRecompute:
      return onStateRecompute(req, rsp);

    // dashboard data
    case ApiEndpoint.Init:
      return onInit(req, rsp);
    case ApiEndpoint.Overview:
      return onOverview(req, rsp);
    case ApiEndpoint.Trajectory:
      return onTrajectory(req, rsp);
    case ApiEndpoint.Watchlist:
      return onWatchlist(req, rsp);
    case ApiEndpoint.Health:
      return onHealth(req, rsp);
    case ApiEndpoint.AlertsFeed:
      return onAlertsFeed(req, rsp);
    case ApiEndpoint.Evaders:
      return onEvaders(req, rsp);

    // dev seed / reset (mod-only, called from the Settings tab)
    case ApiEndpoint.DevSeed:
      return onDevSeed(req, rsp);
    case ApiEndpoint.DevReset:
      return onDevReset(req, rsp);
    case ApiEndpoint.DebugUser:
      return onDebugUser(req, rsp);

    default:
      writeError(404, `not found: ${path}`, rsp);
      return;
  }
}
