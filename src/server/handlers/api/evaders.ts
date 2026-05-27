/**
 * `GET /api/evaders` — list of saved ban-evader fingerprints with optional
 *                       similarity match against a candidate userId.
 *
 * If `candidateUserId` is given, we also compute cosine similarities and
 * return them inline so the dashboard can highlight likely matches.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { writeJson } from "../../http.ts";
import type { EvadersResponse } from "../../../shared/api.ts";
import { listFingerprints } from "../../storage/evaders.ts";
import { getUser } from "../../storage/user.ts";
import { cosineDense, cosineSparse } from "../../core/cosine.ts";
import type { EvaderFingerprint } from "../../../shared/types.ts";

export async function onEvaders(req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "", "http://sentinel/");
  const candidate = url.searchParams.get("candidateUserId") ?? "";
  const evaders = await listFingerprints(100);

  if (candidate.length > 0) {
    const candidateUser = await getUser(candidate);
    if (candidateUser) {
      const ranked: (EvaderFingerprint & { similarity?: number })[] = evaders.map((e) => {
        const hourSim = cosineDense(candidateUser.hourHistogram, e.hourHistogram);
        const vocabSim = cosineSparse(candidateUser.ngramCounts, e.ngramCounts);
        const similarity = 0.4 * hourSim + 0.6 * vocabSim;
        return { ...e, similarity };
      });
      ranked.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
      writeJson(200, { type: "evaders", evaders: ranked }, rsp);
      return;
    }
  }

  const body: EvadersResponse = { type: "evaders", evaders };
  writeJson(200, body, rsp);
}
