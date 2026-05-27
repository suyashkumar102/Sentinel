/**
 * Sentinel server entry.
 *
 * Devvit Web spins us up as a CommonJS Node actor. We register a single
 * request handler and route everything through `router.ts`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, getServerPort } from "@devvit/web/server";
import { dispatch } from "./router.ts";
import { writeError } from "./http.ts";

const server = createServer(async (req: IncomingMessage, rsp: ServerResponse) => {
  try {
    await dispatch(req, rsp);
  } catch (err) {
    const stack = err instanceof Error ? err.stack : String(err);
    console.error(`[sentinel] uncaught error in ${req.url}\n${stack}`);
    if (!rsp.headersSent) writeError(500, "internal error", rsp);
  }
});

const port: number = getServerPort();
server.on("error", (err) => console.error(`[sentinel] server error: ${err.stack ?? err}`));
server.listen(port);
