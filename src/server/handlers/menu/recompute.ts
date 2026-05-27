/**
 * Menu item: kick off an immediate state recompute over the active population.
 *
 * Useful after a settings change so mods don't have to wait for the next
 * scheduled tick. The recompute itself is the same body as the scheduled job.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { UiResponse } from "@devvit/web/shared";
import { writeJson } from "../../http.ts";
import { runStateRecompute } from "../jobs/state-recompute.ts";

export async function onRecompute(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const result = await runStateRecompute(Date.now());
  writeJson(
    200,
    {
      showToast: {
        text: `Recompute complete. ${result.processed} users, ${result.transitions} transitions.`,
        appearance: "success",
      },
    },
    rsp,
  );
}
