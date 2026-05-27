/**
 * Alert emission.
 *
 * Whenever the state machine commits a transition UPWARD into WATCHING /
 * ELEVATED / CRITICAL we emit an alert. The alert is:
 *   - persisted to the alert feed (for the dashboard)
 *   - delivered via the configured channel (modmail / modnote / both)
 *   - throttled via TTL dedup so a thrashing user can't spam the queue
 *
 * Drivers attribution & rationale string come from `core/score.ts` so mods
 * see "WHY did the score jump" not just a number.
 */
import { reddit, context, settings as _devvitSettings } from "@devvit/web/server";
import { alertDrivers, rationale } from "./core/score.ts";
import { STATE_RANK } from "../shared/types.ts";
import type { Alert, UserRecord, UserState } from "../shared/types.ts";
import { recordAlert, shouldFire } from "./storage/alerts.ts";
import { readSettings } from "./storage/settings.ts";

void _devvitSettings; // imported for side-effect availability; not used directly here

export type TransitionAlertInput = {
  readonly previous: UserRecord;
  readonly after: UserRecord;
  readonly contextLink: string | null;
};

/**
 * Emit an alert for a transition, returning true if anything was sent.
 *
 * Only UPWARD transitions into WATCHING/ELEVATED/CRITICAL produce alerts;
 * downward de-escalations are logged in the trajectory but don't page mods.
 */
export async function emitTransitionAlert(input: TransitionAlertInput): Promise<boolean> {
  const { previous, after, contextLink } = input;
  if (STATE_RANK[after.state] <= STATE_RANK[previous.state]) return false;
  if (after.state === "HEALTHY") return false;

  const settings = await readSettings();
  const kind = `${previous.state}->${after.state}`;
  if (!(await shouldFire(after.userId, kind))) return false;

  const alert: Alert = {
    id: `alert_${after.userId}_${after.stateSince}`,
    userId: after.userId,
    username: after.username,
    createdAt: after.stateSince,
    fromState: previous.state,
    toState: after.state,
    score: after.score,
    drivers: alertDrivers(after.features),
    rationale: rationale(after.features),
    contextLink,
  };

  await recordAlert(alert);

  const channel = settings.alertChannel;
  if (channel === "modmail" || channel === "both") {
    await sendModmail(alert, after.state);
  }
  if (channel === "modnote" || channel === "both") {
    await sendModNote(alert);
  }

  return true;
}

async function sendModmail(alert: Alert, state: UserState): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  const subject = `Sentinel — ${state}: u/${alert.username}`;
  const body = renderAlertBody(alert);
  try {
    await reddit.modMail.createModInboxConversation({
      subredditId: context.subredditId ?? "",
      subject,
      bodyMarkdown: body,
    });
  } catch (err) {
    console.error(`[sentinel] modmail send failed`, err);
  }
}

async function sendModNote(alert: Alert): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  try {
    await reddit.addModNote({
      subreddit: subredditName,
      user: alert.username,
      label: alert.toState === "CRITICAL" ? "ABUSE_WARNING" : "HELPFUL_USER",
      note: `Sentinel: ${alert.toState} @ ${alert.score.toFixed(2)} · ${alert.rationale}`,
    });
  } catch (err) {
    console.error(`[sentinel] mod note add failed`, err);
  }
}

function renderAlertBody(alert: Alert): string {
  const dt = new Date(alert.createdAt).toISOString();
  const driverLines = alert.drivers
    .slice(0, 5)
    .map(
      (d) =>
        `- **${d.feature}**: value=${d.value.toFixed(2)}  weight=${d.weight.toFixed(2)}  contribution=${d.contribution.toFixed(3)}`,
    )
    .join("\n");
  return [
    `**Sentinel alert** — u/${alert.username}`,
    "",
    `**Transition:** ${alert.fromState} → ${alert.toState}`,
    `**Score:** ${alert.score.toFixed(3)}`,
    `**At:** ${dt}`,
    "",
    `**Rationale:** ${alert.rationale}`,
    "",
    "**Top drivers (sorted by contribution):**",
    driverLines,
    "",
    alert.contextLink ? `**Most recent triggering content:** ${alert.contextLink}` : "",
    "",
    "---",
    "Open the Sentinel dashboard from the moderation menu to view the full trajectory.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}
