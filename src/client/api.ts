/**
 * Typed fetch wrappers used by the dashboard client.
 *
 * Endpoints come from the same `ApiEndpoint` constants the server uses, so a
 * rename on either side is a TypeScript error at compile time.
 */
import { ApiEndpoint } from "../shared/api.ts";
import type {
  AlertsFeedResponse,
  DevResetResponse,
  DevSeedResponse,
  EvadersResponse,
  HealthResponse,
  InitResponse,
  OverviewResponse,
  TrajectoryResponse,
  WatchlistResponse,
} from "../shared/api.ts";

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return (await r.json()) as T;
}

async function postJSON<T>(url: string, body: unknown = {}): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = typeof j === "object" && j ? JSON.stringify(j) : "";
    } catch {
      try { detail = await r.text(); } catch { /* ignore */ }
    }
    throw new Error(`${url} → ${r.status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  return (await r.json()) as T;
}

export const Api = {
  init: () => getJSON<InitResponse>(ApiEndpoint.Init),
  overview: () => getJSON<OverviewResponse>(ApiEndpoint.Overview),
  health: () => getJSON<HealthResponse>(ApiEndpoint.Health),
  watchlist: (state: string = "WATCHING", limit: number = 100) =>
    getJSON<WatchlistResponse>(`${ApiEndpoint.Watchlist}?state=${state}&limit=${limit}`),
  trajectory: (userId: string) =>
    getJSON<TrajectoryResponse>(`${ApiEndpoint.Trajectory}?userId=${encodeURIComponent(userId)}`),
  alerts: (limit: number = 50) =>
    getJSON<AlertsFeedResponse>(`${ApiEndpoint.AlertsFeed}?limit=${limit}`),
  evaders: (candidateUserId?: string) =>
    getJSON<EvadersResponse>(
      candidateUserId
        ? `${ApiEndpoint.Evaders}?candidateUserId=${encodeURIComponent(candidateUserId)}`
        : ApiEndpoint.Evaders,
    ),
  devSeed: () => postJSON<DevSeedResponse>(ApiEndpoint.DevSeed),
  devReset: () => postJSON<DevResetResponse>(ApiEndpoint.DevReset),
  debugUser: (username: string) =>
    getJSON<unknown>(`${ApiEndpoint.DebugUser}?username=${encodeURIComponent(username)}`),
} as const;
