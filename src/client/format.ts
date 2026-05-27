/**
 * Small formatting helpers used across the dashboard.
 */
import type { FeatureVector, UserState } from "../shared/types.ts";

export function fmtScore(s: number): string {
  return s.toFixed(2);
}

export function fmtSignedScore(s: number): string {
  return `${s >= 0 ? "+" : ""}${s.toFixed(2)}`;
}

export function fmtPercent(v: number, digits: number = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-US").format(n);
}

export function fmtAgo(tMs: number): string {
  const delta = Date.now() - tMs;
  if (delta < 0) return "just now";
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function fmtTime(tMs: number): string {
  return new Date(tMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtShortDate(tMs: number): string {
  return new Date(tMs).toLocaleDateString([], { month: "short", day: "numeric" });
}

const FEATURE_LABELS: Record<keyof FeatureVector, string> = {
  velocity: "Posting velocity",
  removalRate: "Removal rate",
  controversyAffinity: "Controversy affinity",
  warningResponse: "Warning response",
  timeSignature: "Time signature",
  vocabularyFingerprint: "Vocabulary fingerprint",
};

const FEATURE_COLORS: Record<keyof FeatureVector, string> = {
  velocity: "#facc15",
  removalRate: "#ef4444",
  controversyAffinity: "#f97316",
  warningResponse: "#4f7fff",
  timeSignature: "#a855f7",
  vocabularyFingerprint: "#22c55e",
};

export function featureLabel(f: keyof FeatureVector): string {
  return FEATURE_LABELS[f];
}

export function featureColor(f: keyof FeatureVector): string {
  return FEATURE_COLORS[f];
}

export function stateClass(state: UserState): string {
  return `state state-${state.toLowerCase()}`;
}

export function stateColor(state: UserState): string {
  switch (state) {
    case "HEALTHY":  return "#22c55e";
    case "WATCHING": return "#facc15";
    case "ELEVATED": return "#f97316";
    case "CRITICAL": return "#ef4444";
    case "BANNED":   return "#7f1d1d";
    default:
      state satisfies never;
      return "#8b949e";
  }
}

export function healthColor(health: number): string {
  if (health >= 80) return "#22c55e";
  if (health >= 60) return "#facc15";
  if (health >= 40) return "#f97316";
  return "#ef4444";
}

export function clampNumber(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/* Deterministic avatar color from a username — feels stable across reloads. */
export function avatarColor(username: string): string {
  const palette = [
    "#ef4444", "#f97316", "#facc15", "#22c55e",
    "#10b981", "#06b6d4", "#3b82f6", "#6366f1",
    "#a855f7", "#ec4899", "#f43f5e", "#84cc16",
  ];
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) & 0xffffff;
  return palette[h % palette.length]!;
}

export function avatarInitial(username: string): string {
  return username.charAt(0).toUpperCase();
}
