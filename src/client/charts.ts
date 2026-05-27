/**
 * SVG chart primitives — vanilla, no dependencies.
 *
 * Each function returns an SVG element you can append to the DOM. Pure: no
 * event handlers, no animation loop. Re-call to redraw.
 */
import type { TrajectoryPoint } from "../shared/types.ts";
import { stateColor } from "./format.ts";

export type Pt = { readonly x: number; readonly y: number };

const SVG = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const n = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}

/** Build a smoothed cubic-Bezier path through points. */
export function smoothPath(points: readonly Pt[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0]!.x},${points[0]!.y}`;
  const parts: string[] = [`M${points[0]!.x},${points[0]!.y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    
    let cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    let cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    
    // Clamp control point X coordinates to segment range to prevent loops/overshoots
    if (cp1x < p1.x) cp1x = p1.x;
    if (cp1x > p2.x) cp1x = p2.x;
    if (cp2x < p1.x) cp2x = p1.x;
    if (cp2x > p2.x) cp2x = p2.x;
    
    parts.push(`C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`);
  }
  return parts.join(" ");
}

/**
 * Sparkline used inside the per-row attention table and the metric headers.
 * Values are normalized to [0, 1] internally.
 */
export function sparkline(
  values: readonly number[],
  opts: {
    width: number;
    height: number;
    color: string;
    fillColor?: string | undefined;
    showFill?: boolean;
    strokeWidth?: number;
    padding?: number;
    min?: number;
    max?: number;
  },
): SVGSVGElement {
  const { width, height, color } = opts;
  const padding = opts.padding ?? 2;
  const sw = opts.strokeWidth ?? 1.6;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height });
  if (values.length < 2) return svg;
  const min = opts.min ?? Math.min(...values);
  const max = opts.max ?? Math.max(...values);
  const span = max - min || 1;
  const stepX = (width - padding * 2) / (values.length - 1);
  const points: Pt[] = values.map((v, i) => ({
    x: padding + i * stepX,
    y: padding + (1 - (v - min) / span) * (height - padding * 2),
  }));
  const d = smoothPath(points);
  if (opts.showFill !== false) {
    const fillD = `${d} L${points[points.length - 1]!.x},${height} L${points[0]!.x},${height} Z`;
    const fill = el("path", { d: fillD, fill: opts.fillColor ?? color, "fill-opacity": "0.15" });
    svg.appendChild(fill);
  }
  const stroke = el("path", { d, fill: "none", stroke: color, "stroke-width": sw, "stroke-linecap": "round" });
  svg.appendChild(stroke);
  return svg;
}

/** Larger area chart used for the 90-day community trend. */
export function areaChart(
  data: readonly { readonly t: number; readonly v: number }[],
  opts: { width: number; height: number; color: string; min?: number; max?: number },
): { svg: SVGSVGElement; xTicks: { x: number; t: number }[] } {
  const { width, height, color } = opts;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 22;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height });

  if (data.length < 2) return { svg, xTicks: [] };

  const min = opts.min ?? Math.min(...data.map((d) => d.v));
  const max = opts.max ?? Math.max(...data.map((d) => d.v));
  const span = max - min || 1;
  const stepX = (width - padL - padR) / (data.length - 1);
  const points: Pt[] = data.map((d, i) => ({
    x: padL + i * stepX,
    y: padT + (1 - (d.v - min) / span) * (height - padT - padB),
  }));

  // Light horizontal gridlines.
  for (let g = 0; g <= 4; g++) {
    const y = padT + (g / 4) * (height - padT - padB);
    svg.appendChild(
      el("line", {
        x1: padL, x2: width - padR,
        y1: y, y2: y,
        stroke: "rgba(148,163,184,0.08)",
        "stroke-dasharray": "2,4",
      }),
    );
  }

  const d = smoothPath(points);
  const fillD = `${d} L${points[points.length - 1]!.x},${height - padB} L${points[0]!.x},${height - padB} Z`;
  // Subtle filled gradient under the line.
  const gradId = `g-${Math.random().toString(36).slice(2, 8)}`;
  const defs = el("defs", {});
  const lg = el("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "0", y2: "1" });
  lg.appendChild(el("stop", { offset: "0%", "stop-color": color, "stop-opacity": "0.35" }));
  lg.appendChild(el("stop", { offset: "100%", "stop-color": color, "stop-opacity": "0" }));
  defs.appendChild(lg);
  svg.appendChild(defs);

  svg.appendChild(el("path", { d: fillD, fill: `url(#${gradId})` }));
  svg.appendChild(
    el("path", { d, fill: "none", stroke: color, "stroke-width": 2, "stroke-linecap": "round" }),
  );

  // Final point marker.
  const last = points[points.length - 1]!;
  svg.appendChild(el("circle", { cx: last.x, cy: last.y, r: 3.5, fill: color }));

  // X tick positions returned so the caller can print date labels.
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => {
    const i = Math.round(p * (data.length - 1));
    return { x: padL + i * stepX, t: data[i]!.t };
  });

  return { svg, xTicks };
}

/** Trajectory chart used in the user-detail view. Plots a score line over time
 *  with band overlays for WATCHING / ELEVATED / CRITICAL thresholds. */
export function trajectoryChart(
  points: readonly TrajectoryPoint[],
  thresholds: { watching: number; elevated: number; critical: number },
  opts: { width: number; height: number },
): SVGSVGElement {
  const { width, height } = opts;
  const padL = 10;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height });

  // Threshold band overlays.
  const yFor = (v: number) => padT + (1 - v) * (height - padT - padB);
  const drawBand = (lo: number, hi: number, color: string) => {
    const y1 = yFor(hi);
    const y2 = yFor(lo);
    svg.appendChild(
      el("rect", {
        x: padL,
        y: y1,
        width: width - padL - padR,
        height: Math.max(0, y2 - y1),
        fill: color,
        "fill-opacity": "0.06",
      }),
    );
  };
  drawBand(thresholds.critical, 1, "#ef4444");
  drawBand(thresholds.elevated, thresholds.critical, "#f97316");
  drawBand(thresholds.watching, thresholds.elevated, "#facc15");
  drawBand(0, thresholds.watching, "#22c55e");

  // Threshold dashed lines.
  for (const [name, v] of [["watching", thresholds.watching], ["elevated", thresholds.elevated], ["critical", thresholds.critical]] as const) {
    void name;
    const y = yFor(v);
    svg.appendChild(
      el("line", {
        x1: padL, x2: width - padR,
        y1: y, y2: y,
        stroke: "rgba(148,163,184,0.18)",
        "stroke-dasharray": "3,4",
      }),
    );
  }

  if (points.length === 0) return svg;

  const min = Math.min(...points.map((p) => p.t));
  const max = Math.max(...points.map((p) => p.t));
  const span = Math.max(1, max - min);
  const pts: Pt[] = points.map((p) => ({
    x: padL + ((p.t - min) / span) * (width - padL - padR),
    y: yFor(Math.min(1, Math.max(0, p.score))),
  }));

  if (pts.length >= 2) {
    svg.appendChild(
      el("path", { d: smoothPath(pts), fill: "none", stroke: "#4f7fff", "stroke-width": 2 }),
    );
  }

  // Dots colored by state.
  for (let i = 0; i < points.length; i++) {
    svg.appendChild(
      el("circle", { cx: pts[i]!.x, cy: pts[i]!.y, r: 3, fill: stateColor(points[i]!.state) }),
    );
  }

  return svg;
}
