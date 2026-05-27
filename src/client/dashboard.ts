/**
 * Mod dashboard — SPA router + view layer.
 *
 * Routes (left nav): overview, users, escalations, evaders, community, settings.
 * Each route is a render function that builds DOM from a fetched payload.
 * No framework: the data is small and mostly static, so a few render functions
 * beat the complexity cost of React.
 */
import { Api } from "./api.ts";
import { areaChart, sparkline, trajectoryChart } from "./charts.ts";
import {
  avatarColor,
  avatarInitial,
  featureColor,
  featureLabel,
  fmtAgo,
  fmtCompact,
  fmtScore,
  fmtShortDate,
  fmtSignedScore,
  fmtTime,
  stateColor,
} from "./format.ts";
import type {
  AttentionRow,
  DevSeedResponse,
  EscalationEvent,
  OverviewResponse,
  TopDriversBreakdown,
} from "../shared/api.ts";
import type { FeatureVector, UserState } from "../shared/types.ts";

type Route = "overview" | "users" | "escalations" | "evaders" | "community" | "settings";

const main = document.getElementById("main") as HTMLElement;
const toast = document.getElementById("toast") as HTMLDivElement;
const nav = document.getElementById("nav") as HTMLElement;
const escBadge = document.getElementById("nav-esc-badge") as HTMLSpanElement;

let current: Route = "overview";
let cachedOverview: OverviewResponse | null = null;

/* ────────────────────────────────────────────────────────────────────────── */
/* Router                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

nav.addEventListener("click", (ev) => {
  const t = ev.target as HTMLElement;
  const btn = t.closest<HTMLButtonElement>("[data-route]");
  if (!btn) return;
  const route = btn.dataset["route"] as Route;
  if (!route || route === current) return;
  goTo(route);
});

function goTo(route: Route): void {
  current = route;
  for (const item of nav.querySelectorAll<HTMLButtonElement>(".nav-item")) {
    item.classList.toggle("active", item.dataset["route"] === route);
  }
  // Always clear the overview cache when navigating so the next render
  // fetches fresh data from the server.
  if (route === "overview") cachedOverview = null;
  render();
}

async function render(): Promise<void> {
  try {
    switch (current) {
      case "overview":    await renderOverview(); break;
      case "users":       await renderUsers();    break;
      case "escalations": await renderEscalations(); break;
      case "evaders":     await renderEvaders();  break;
      case "community":   await renderCommunity(); break;
      case "settings":    renderSettings();       break;
    }
  } catch (err) {
    console.error("[sentinel] render failed", err);
    showToast(`Render failed: ${(err as Error).message ?? err}`, "err");
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Toast                                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

let toastTimer = 0;
function showToast(text: string, kind: "ok" | "err" = "ok"): void {
  toast.textContent = text;
  toast.className = `toast show ${kind}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.className = "toast";
  }, 2800);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Reusable DOM helpers                                                      */
/* ────────────────────────────────────────────────────────────────────────── */

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) {
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function icon(svg: string, cls = ""): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = cls;
  span.innerHTML = svg;
  return span;
}

function badge(state: UserState): HTMLSpanElement {
  return h("span", { class: `badge ${state}` }, [state]);
}

function avatar(username: string): HTMLDivElement {
  const a = h("div", { class: "avatar" }, [avatarInitial(username)]);
  a.style.background = avatarColor(username);
  return a;
}

function mainHead(title: string, sub: string, subreddit: string, updatedAt: number): HTMLElement {
  return h("div", { class: "main-head" }, [
    h("div", {}, [
      h("h1", {}, [title]),
      h("div", { class: "sub" }, [sub]),
    ]),
    h("div", { class: "head-meta" }, [
      h("span", { class: "pill" }, [
        icon(`<svg width="14" height="14" viewBox="0 0 24 24" fill="#ff4500"><circle cx="12" cy="12" r="12"/></svg>`),
        `r/${subreddit}`,
      ]),
      h("span", { class: "updated" }, [
        icon(`<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>`),
        `Updated ${fmtTime(updatedAt)}`,
      ]),
    ]),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Overview                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

async function renderOverview(): Promise<void> {
  main.replaceChildren(skeleton());
  const o = await Api.overview();
  cachedOverview = o;

  if (escBadge) {
    const n = o.escalations.length;
    if (n > 0) {
      escBadge.hidden = false;
      escBadge.textContent = String(n);
    } else {
      escBadge.hidden = true;
    }
  }

  main.replaceChildren();
  main.appendChild(mainHead("Overview", "Real-time community & risk overview", o.subreddit, o.updatedAt));
  if (o.you) main.appendChild(youCard(o));
  main.appendChild(metricsGrid(o));
  main.appendChild(contentGrid(o));
  main.appendChild(recentActivityCard(o));
  main.appendChild(lowerGrid(o));
}

function youCard(o: OverviewResponse): HTMLElement {
  const you = o.you!;
  const card = h("div", { class: "card", style: "background: linear-gradient(135deg, rgba(79,127,255,0.10), rgba(79,127,255,0.02)); border-color: rgba(79,127,255,0.25)" });
  card.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Your record"]),
      h("div", { class: "sub" }, [
        `Signed in as u/${o.username}. Your activity is being tracked by Sentinel like any other user.`,
      ]),
    ]),
    badge(you.state),
  ]));
  const stats = h("div", { class: "metrics-grid", style: "grid-template-columns: repeat(4, 1fr); margin-top: 0" }, [
    miniStat("Score", fmtScore(you.score), stateColor(you.state)),
    miniStat("Submissions", String(you.submissions), "var(--text)"),
    miniStat("Removals", String(you.removals), "var(--text)"),
    miniStat("Last activity", fmtAgo(you.lastEventAt), "var(--text-muted)"),
  ]);
  card.appendChild(stats);
  return card;
}

function miniStat(label: string, value: string, color: string): HTMLElement {
  const wrap = h("div", { class: "metric", style: "padding: 14px 16px; background: var(--bg-elev-2);" });
  wrap.appendChild(h("div", { class: "label" }, [label]));
  const v = h("div", { class: "value", style: `font-size: 22px; color: ${color}` }, [value]);
  wrap.appendChild(v);
  return wrap;
}

function recentActivityCard(o: OverviewResponse): HTMLElement {
  const card = h("div", { class: "card" });
  card.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Recent activity"]),
      h("div", { class: "sub" }, ["Users with the most recent ingested events"]),
    ]),
  ]));
  if (o.recentActivity.length === 0) {
    card.appendChild(emptyState("No recent activity.", "Submit a post or comment in this subreddit — it will appear here within seconds."));
    return card;
  }
  const table = h("table", { class: "attention-table" });
  table.appendChild(h("thead", {}, [
    h("tr", {}, [
      h("th", {}, ["User"]),
      h("th", {}, ["State"]),
      h("th", {}, ["Score"]),
      h("th", {}, ["Subs"]),
      h("th", {}, ["Removals"]),
      h("th", {}, ["Last event"]),
    ]),
  ]));
  const tbody = h("tbody", {});
  for (const r of o.recentActivity) {
    const tr = h("tr", {});
    tr.appendChild(h("td", {}, [
      h("div", { class: "user-cell" }, [
        avatar(r.username),
        h("span", { class: "user-name" }, [`u/${r.username}`]),
      ]),
    ]));
    tr.appendChild(h("td", {}, [badge(r.state)]));
    tr.appendChild(h("td", { class: "mono", style: "font-weight:600" }, [fmtScore(r.score)]));
    tr.appendChild(h("td", { class: "mono" }, [String(r.submissions)]));
    tr.appendChild(h("td", { class: "mono" }, [String(r.removals)]));
    tr.appendChild(h("td", { class: "muted" }, [fmtAgo(r.lastEventAt)]));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  card.appendChild(table);
  return card;
}

function metricsGrid(o: OverviewResponse): HTMLElement {
  const grid = h("div", { class: "metrics-grid" });

  // Card 1 — Community Health (with sparkline)
  const healthCard = h("div", { class: "metric community" });
  healthCard.appendChild(h("div", { class: "label" }, [
    "Community Health ",
    icon(`<svg class="icon-info" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`),
  ]));
  const healthVal = h("div", { class: "value" });
  healthVal.appendChild(document.createTextNode(String(Math.round(o.metrics.healthIndex))));
  healthVal.appendChild(h("span", { class: "unit" }, [`/100`]));
  healthCard.appendChild(healthVal);
  const deltaH = h("div", { class: `delta ${o.metrics.healthDelta7d >= 0 ? "up" : "down"}` }, [
    o.metrics.healthDelta7d >= 0
      ? "▲ " + Math.abs(o.metrics.healthDelta7d).toFixed(0) + " pts this week"
      : "▼ " + Math.abs(o.metrics.healthDelta7d).toFixed(0) + " pts this week",
  ]);
  healthCard.appendChild(deltaH);
  const spark = h("div", { class: "spark-wrap" });
  spark.appendChild(sparkline(o.metrics.healthSpark, {
    width: 320, height: 64, color: "#22c55e", showFill: true, min: 0, max: 100,
  }));
  spark.appendChild(h("div", { class: "axis-y" }, [
    h("span", {}, ["100"]),
    h("span", {}, ["50"]),
    h("span", {}, ["0"]),
  ]));
  healthCard.appendChild(spark);
  grid.appendChild(healthCard);

  // Card 2 — Users monitored
  grid.appendChild(metricCard({
    label: "Users Monitored",
    value: fmtCompact(o.metrics.populationSize),
    delta: o.metrics.populationDelta7d,
    deltaUnit: "this week",
    corner: { cls: "users", svg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>` },
  }));
  // Card 3 — Watching
  grid.appendChild(metricCard({
    label: "Watching",
    value: String(o.metrics.watchingCount),
    delta: o.metrics.watchingDelta7d,
    deltaUnit: "vs last 7 days",
    corner: { cls: "watching", svg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>` },
    deltaInverted: true,
  }));
  // Card 4 — Elevated
  grid.appendChild(metricCard({
    label: "Elevated",
    value: String(o.metrics.elevatedCount),
    delta: o.metrics.elevatedDelta7d,
    deltaUnit: "vs last 7 days",
    corner: { cls: "elevated", svg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>` },
    deltaInverted: true,
  }));
  // Card 5 — Critical
  grid.appendChild(metricCard({
    label: "Critical",
    value: String(o.metrics.criticalCount),
    delta: o.metrics.criticalDelta7d,
    deltaUnit: "vs last 7 days",
    corner: { cls: "critical", svg: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>` },
    deltaInverted: true,
  }));
  return grid;
}

function metricCard(opts: {
  label: string;
  value: string;
  delta: number;
  deltaUnit: string;
  corner: { cls: string; svg: string };
  deltaInverted?: boolean;
}): HTMLElement {
  const c = h("div", { class: "metric" });
  c.appendChild(h("div", { class: "label" }, [opts.label]));
  c.appendChild(h("div", { class: "value" }, [opts.value]));
  let cls: "up" | "down" | "warn";
  if (opts.delta === 0) cls = "warn";
  else if (opts.deltaInverted) cls = opts.delta > 0 ? "down" : "up";
  else cls = opts.delta >= 0 ? "up" : "down";
  const arrow = opts.delta > 0 ? "▲" : opts.delta < 0 ? "▼" : "■";
  c.appendChild(h("div", { class: `delta ${cls}` }, [
    `${arrow} ${Math.abs(opts.delta)} ${opts.deltaUnit}`,
  ]));
  const corner = h("div", { class: `corner ${opts.corner.cls}` });
  corner.innerHTML = opts.corner.svg;
  c.appendChild(corner);
  return c;
}

function contentGrid(o: OverviewResponse): HTMLElement {
  const grid = h("div", { class: "content-grid" });

  // ── Attention table ────────────────────────────────────────────────────
  const attn = h("div", { class: "card" });
  const attnHead = h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Users requiring attention"]),
      h("div", { class: "sub" }, ["Sorted by risk score (high to low)"]),
    ]),
    h("button", { class: "view-all" }, ["View all users"]),
  ]);
  attn.appendChild(attnHead);
  attnHead.querySelector(".view-all")?.addEventListener("click", () => goTo("users"));

  if (o.attention.length === 0) {
    attn.appendChild(emptyState("No users above the WATCHING threshold yet.", "Activity will appear here as the score machinery accumulates events."));
  } else {
    attn.appendChild(attentionTable(o.attention));
    const foot = h("div", { class: "attention-foot" });
    const link = h("a", { href: "#" }, ["View all users  →"]);
    link.addEventListener("click", (ev) => { ev.preventDefault(); goTo("users"); });
    foot.appendChild(link);
    attn.appendChild(foot);
  }
  grid.appendChild(attn);

  // ── Escalations panel ──────────────────────────────────────────────────
  const esc = h("div", { class: "card" });
  esc.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Escalations"]),
      h("div", { class: "sub" }, ["Recent state changes & important events"]),
    ]),
    h("button", { class: "view-all" }, ["View all"]),
  ]));
  esc.querySelector(".view-all")?.addEventListener("click", () => goTo("escalations"));
  esc.appendChild(escalationsList(o.escalations.slice(0, 5)));
  const escFoot = h("div", { class: "card-foot-link" });
  const escLink = h("a", { href: "#" }, ["View all escalations  →"]);
  escLink.addEventListener("click", (ev) => { ev.preventDefault(); goTo("escalations"); });
  escFoot.appendChild(escLink);
  esc.appendChild(escFoot);
  grid.appendChild(esc);

  return grid;
}

function attentionTable(rows: readonly AttentionRow[]): HTMLElement {
  const table = h("table", { class: "attention-table" });
  const thead = h("thead", {}, [
    h("tr", {}, [
      h("th", {}, ["User"]),
      h("th", {}, ["Risk"]),
      h("th", {}, ["Trend (7d)"]),
      h("th", {}, ["Top drivers"]),
      h("th", { style: "text-align:right" }, ["Score"]),
      h("th", {}, [""]),
    ]),
  ]);
  table.appendChild(thead);
  const tbody = h("tbody", {});
  for (const row of rows) {
    const tr = h("tr", {});
    tr.appendChild(h("td", {}, [
      h("div", { class: "user-cell" }, [
        avatar(row.username),
        h("span", { class: "user-name" }, [`u/${row.username}`]),
      ]),
    ]));
    tr.appendChild(h("td", {}, [badge(row.state)]));
    const trendTd = h("td", { class: "spark-mini" });
    trendTd.appendChild(sparkline(row.spark, {
      width: 110, height: 32, color: stateColor(row.state), showFill: false, min: 0, max: 1,
    }));
    tr.appendChild(trendTd);
    tr.appendChild(h("td", {}, [driversList(row.topDrivers)]));
    const scoreTd = h("td", { style: "text-align:right; font-family: var(--mono); font-weight:600;" }, [fmtScore(row.score)]);
    tr.appendChild(scoreTd);
    tr.appendChild(h("td", { class: "chev", style: "text-align:right" }, [
      icon(`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`),
    ]));
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

function driversList(
  drivers: readonly { readonly feature: keyof FeatureVector; readonly delta: number }[],
): HTMLElement {
  const wrap = h("div", { class: "drivers" });
  for (const d of drivers) {
    const row = h("div", { class: "driver" });
    const dot = h("span", { class: "dot" });
    dot.style.background = featureColor(d.feature);
    row.appendChild(dot);
    row.appendChild(document.createTextNode(featureLabel(d.feature)));
    row.appendChild(h("span", { class: "delta" }, [fmtSignedScore(d.delta)]));
    wrap.appendChild(row);
  }
  return wrap;
}

function escalationsList(events: readonly EscalationEvent[]): HTMLElement {
  const list = h("div", { class: "escalations" });
  if (events.length === 0) {
    list.appendChild(emptyState("No recent escalations.", "State changes will appear here when users cross thresholds."));
    return list;
  }
  for (const e of events) {
    const item = h("div", { class: "escalation" });
    item.appendChild(escalationIcon(e));
    const body = h("div", { class: "esc-body" });
    body.appendChild(h("div", { class: "when" }, [fmtAgo(e.t)]));

    if (e.kind === "evader") {
      body.appendChild(h("div", { class: "title" }, [
        h("strong", {}, ["Potential ban evader detected"]),
      ]));
      body.appendChild(h("div", { class: "sub" }, [
        `${Math.round((e.similarity ?? 0) * 100)}% fingerprint similarity with u/${e.evaderMatchUsername ?? "?"}`,
      ]));
      const reviewBtn = h("button", { class: "esc-action" }, ["Review match"]);
      item.appendChild(body);
      item.appendChild(reviewBtn);
      list.appendChild(item);
      continue;
    }

    const titleParts: (Node | string)[] = [
      h("span", { class: "who" }, [`u/${e.username}`]),
      ` ${e.kind === "returned" ? "returned to" : "entered"} `,
      h("span", { style: `color:${stateColor(e.toState)}; font-weight:600` }, [e.toState]),
    ];
    body.appendChild(h("div", { class: "title" }, titleParts));
    if (e.drivers.length > 0) {
      const subParts = e.drivers
        .map((d) => `${featureLabel(d.feature)} ${fmtSignedScore(d.delta)}`)
        .join(" • ");
      body.appendChild(h("div", { class: "sub" }, [subParts]));
    } else if (e.kind === "returned") {
      body.appendChild(h("div", { class: "sub" }, ["Score decreased below threshold"]));
    }
    item.appendChild(body);
    list.appendChild(item);
  }
  return list;
}

function escalationIcon(e: EscalationEvent): HTMLElement {
  if (e.kind === "evader") {
    return h("div", { class: "esc-icon evader", html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>` });
  }
  if (e.kind === "returned") {
    return h("div", { class: "esc-icon down healthy", html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>` });
  }
  const dirCls = e.toState === "HEALTHY" ? "down healthy"
    : e.toState === "CRITICAL" ? "up critical"
    : e.toState === "ELEVATED" ? "up elevated"
    : "up watching";
  return h("div", { class: `esc-icon ${dirCls}`, html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>` });
}

function lowerGrid(o: OverviewResponse): HTMLElement {
  const grid = h("div", { class: "lower-grid" });

  // 90-day community risk trend
  const trend = h("div", { class: "card trend-card" });
  trend.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, [
        "Community risk trend (90 days) ",
        icon(`<svg class="icon-info" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/></svg>`),
      ]),
    ]),
    h("select", { class: "timeframe-select" }, [
      h("option", {}, ["90 days"]),
    ]),
  ]));
  const body = h("div", { class: "body" });
  if (o.communityTrend.length >= 2) {
    const { svg, xTicks } = areaChart(
      o.communityTrend.map((p) => ({ t: p.t, v: p.health })),
      { width: 540, height: 220, color: "#4f7fff", min: 0, max: 100 },
    );
    body.appendChild(svg);
    const yAxis = h("div", { class: "trend-yaxis" }, [
      h("span", {}, ["100"]),
      h("span", {}, ["75"]),
      h("span", {}, ["50"]),
      h("span", {}, ["25"]),
      h("span", {}, ["0"]),
    ]);
    body.appendChild(yAxis);
    const axis = h("div", { class: "trend-axis" });
    for (const t of xTicks) axis.appendChild(h("span", {}, [fmtShortDate(t.t)]));
    body.appendChild(axis);
  } else {
    body.appendChild(emptyState("Not enough history yet.", "Run the seed action or wait for the community-drift cron."));
  }
  trend.appendChild(body);
  grid.appendChild(trend);

  // Top risk drivers
  const drivers = h("div", { class: "card" });
  drivers.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Top risk drivers ", icon(`<svg class="icon-info" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`)]),
      h("div", { class: "sub" }, ["Impact on community risk"]),
    ]),
  ]));
  drivers.appendChild(topDriversBars(o.topDrivers));
  grid.appendChild(drivers);

  // System status
  const sys = h("div", { class: "card system-status" });
  sys.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["System status ", icon(`<svg class="icon-info" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`)]),
    ]),
  ]));
  const ok = h("div", { class: "ok" }, [
    h("div", { class: "ok-mark", html: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><polyline points="20 6 9 17 4 12"/></svg>` }),
    h("div", { class: "ok-body" }, [
      h("strong", {}, ["All systems operational"]),
      h("div", { class: "sub" }, [`Last event processed ${fmtAgo(o.updatedAt)}`]),
    ]),
  ]);
  sys.appendChild(ok);
  const metricsBtn = h("button", { class: "view-all metrics-btn" }, ["View system metrics"]);
  metricsBtn.addEventListener("click", () => showToast("System metrics view coming soon", "ok"));
  sys.appendChild(metricsBtn);
  grid.appendChild(sys);

  return grid;
}

function topDriversBars(drivers: readonly TopDriversBreakdown[]): HTMLElement {
  const wrap = h("div", { class: "drivers-bars" });
  if (drivers.length === 0) {
    wrap.appendChild(emptyState("No drivers yet.", "Seed data or live events will populate this."));
    return wrap;
  }
  const maxContrib = Math.max(...drivers.map((d) => d.contribution), 0.01);
  for (const d of drivers) {
    const row = h("div", { class: "drv-row" });
    row.appendChild(h("span", { class: "name" }, [featureLabel(d.feature)]));
    const bar = h("div", { class: "bar" });
    const fill = h("i", {});
    fill.style.width = `${(d.contribution / maxContrib) * 100}%`;
    fill.style.background = featureColor(d.feature);
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(h("span", { class: "delta" }, [fmtSignedScore(d.contribution)]));
    wrap.appendChild(row);
  }
  return wrap;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Users tab                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

async function renderUsers(): Promise<void> {
  main.replaceChildren(skeleton());
  const [over, wl] = await Promise.all([
    cachedOverview ? Promise.resolve(cachedOverview) : Api.overview(),
    Api.watchlist("HEALTHY", 100),
  ]);
  cachedOverview = over;
  main.replaceChildren();
  main.appendChild(mainHead("Users", `${wl.users.length} users monitored, sorted by score`, over.subreddit, over.updatedAt));

  const card = h("div", { class: "card" });
  if (wl.users.length === 0) {
    card.appendChild(emptyState("No users monitored yet.", "Seed data or live activity will populate this list."));
  } else {
    const rows: AttentionRow[] = wl.users.map((u) => ({
      userId: u.userId,
      username: u.username,
      state: u.state,
      score: u.score,
      spark: [u.score * 0.6, u.score * 0.7, u.score * 0.8, u.score * 0.75, u.score * 0.9, u.score * 0.95, u.score],
      topDrivers: [
        { feature: "removalRate", delta: u.removalRate },
        { feature: "velocity", delta: u.velocity },
      ],
    }));
    card.appendChild(attentionTable(rows));
  }
  main.appendChild(card);

  // user trajectory panel below
  if (wl.users.length > 0) {
    await renderUserTrajectory(wl.users[0]!.userId);
  }
}

async function renderUserTrajectory(userId: string): Promise<void> {
  const r = await Api.trajectory(userId);
  const card = h("div", { class: "card" });
  card.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, [`Trajectory: u/${r.user?.username ?? "?"}`]),
      h("div", { class: "sub" }, [`90-day score history · current ${fmtScore(r.user?.score ?? 0)}`]),
    ]),
    r.user ? badge(r.user.state) : h("span", {}, [""]),
  ]));
  if (r.points.length >= 2) {
    card.appendChild(trajectoryChart(r.points, {
      watching: 0.2, elevated: 0.45, critical: 0.7,
    }, { width: 880, height: 260 }));
  } else {
    card.appendChild(emptyState("Not enough trajectory points yet.", "Will populate as events accumulate."));
  }
  main.appendChild(card);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Escalations tab                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

async function renderEscalations(): Promise<void> {
  main.replaceChildren(skeleton());
  const o = cachedOverview ?? await Api.overview();
  cachedOverview = o;
  const alerts = await Api.alerts(50);
  main.replaceChildren();
  main.appendChild(mainHead("Escalations", "Every state transition and important event", o.subreddit, o.updatedAt));

  const card = h("div", { class: "card" });
  if (alerts.alerts.length === 0 && o.escalations.length === 0) {
    card.appendChild(emptyState("No escalations recorded.", "When a user crosses a threshold the event will show here."));
  } else {
    // Merge alerts (state transitions) + evader detections from overview.
    const merged: EscalationEvent[] = [
      ...alerts.alerts.map<EscalationEvent>((a) => ({
        id: a.id,
        t: a.createdAt,
        kind: a.toState === "HEALTHY" ? "returned" : "entered",
        toState: a.toState,
        fromState: a.fromState,
        userId: a.userId,
        username: a.username,
        drivers: a.drivers.slice(0, 2).map((d) => ({ feature: d.feature, delta: d.contribution })),
      })),
      ...o.escalations.filter((e) => e.kind === "evader"),
    ].sort((a, b) => b.t - a.t);
    card.appendChild(escalationsList(merged));
  }
  main.appendChild(card);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Evaders tab                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

async function renderEvaders(): Promise<void> {
  main.replaceChildren(skeleton());
  const o = cachedOverview ?? await Api.overview();
  cachedOverview = o;
  const r = await Api.evaders();
  main.replaceChildren();
  main.appendChild(mainHead("Ban evaders", "Saved fingerprints from banned users", o.subreddit, o.updatedAt));

  const card = h("div", { class: "card" });
  if (r.evaders.length === 0) {
    card.appendChild(emptyState(
      "No fingerprints saved yet.",
      "When a user reaches BANNED their hour-histogram + n-gram fingerprint is captured for future similarity matching.",
    ));
  } else {
    const list = h("div", {});
    for (const e of r.evaders) {
      const row = h("div", { class: "settings-row" });
      row.appendChild(h("div", {}, [
        h("div", { class: "name" }, [`u/${e.username}`]),
        h("div", { class: "desc" }, [`Banned ${fmtAgo(e.bannedAt)} · final score ${fmtScore(e.finalScore)}`]),
      ]));
      row.appendChild(badge("BANNED"));
      list.appendChild(row);
    }
    card.appendChild(list);
  }
  main.appendChild(card);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Community tab                                                             */
/* ────────────────────────────────────────────────────────────────────────── */

async function renderCommunity(): Promise<void> {
  main.replaceChildren(skeleton());
  const o = cachedOverview ?? await Api.overview();
  cachedOverview = o;
  main.replaceChildren();
  main.appendChild(mainHead("Community", "Subreddit-wide health & risk distribution", o.subreddit, o.updatedAt));

  const card = h("div", { class: "card trend-card" });
  card.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Health index · 90 days"]),
      h("div", { class: "sub" }, ["Daily aggregation from the community-drift job"]),
    ]),
  ]));
  const body = h("div", { class: "body" });
  if (o.communityTrend.length >= 2) {
    const { svg, xTicks } = areaChart(
      o.communityTrend.map((p) => ({ t: p.t, v: p.health })),
      { width: 1080, height: 280, color: "#22c55e", min: 0, max: 100 },
    );
    body.appendChild(svg);
    body.appendChild(h("div", { class: "trend-yaxis" }, [
      h("span", {}, ["100"]), h("span", {}, ["75"]), h("span", {}, ["50"]), h("span", {}, ["25"]), h("span", {}, ["0"]),
    ]));
    const ax = h("div", { class: "trend-axis" });
    for (const t of xTicks) ax.appendChild(h("span", {}, [fmtShortDate(t.t)]));
    body.appendChild(ax);
  } else {
    body.appendChild(emptyState("Not enough history yet.", "Will populate as the community-drift job runs."));
  }
  card.appendChild(body);
  main.appendChild(card);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Settings tab (dev seed + reset live here so they're unmistakable)         */
/* ────────────────────────────────────────────────────────────────────────── */

function renderSettings(): void {
  main.replaceChildren();
  const subreddit = cachedOverview?.subreddit ?? "subreddit";
  const updatedAt = cachedOverview?.updatedAt ?? Date.now();
  main.appendChild(mainHead("Settings", "Configure thresholds, exemptions, and subreddit simulation", subreddit, updatedAt));

  const card = h("div", { class: "card" });
  card.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Subreddit Simulator"]),
      h("div", { class: "sub" }, ["Deploy a simulated 30-day timeline to evaluate Sentinel's proactive pathing in real-time."]),
    ]),
  ]));
  const grid = h("div", { class: "settings-grid" });

  const seedRow = h("div", { class: "settings-row" });
  seedRow.appendChild(h("div", {}, [
    h("div", { class: "name" }, ["Generate Simulation Sandbox Data"]),
    h("div", { class: "desc" }, [
      "Runs a high-fidelity chronological event simulation, populating trajectories, alerts, evaders, and community history.",
    ]),
  ]));
  const seedBtn = h("button", { class: "btn btn-primary" }, ["Deploy Simulator"]);
  seedBtn.addEventListener("click", async () => {
    seedBtn.setAttribute("disabled", "true");
    seedBtn.textContent = "Simulating…";
    try {
      const r: DevSeedResponse = await Api.devSeed();
      showToast(`Simulation complete: loaded ${r.inserted} users · ${r.bannedUsers} banned · ${r.evaderCandidates} evader candidate(s)`);
      cachedOverview = null;
      // After seeding, jump back to the overview so the user sees the result.
      goTo("overview");
    } catch (err) {
      showToast(`Simulation failed: ${(err as Error).message ?? err}`, "err");
    } finally {
      seedBtn.removeAttribute("disabled");
      seedBtn.textContent = "Deploy Simulator";
    }
  });
  seedRow.appendChild(seedBtn);
  grid.appendChild(seedRow);

  const resetRow = h("div", { class: "settings-row" });
  resetRow.appendChild(h("div", {}, [
    h("div", { class: "name" }, ["Reset all data"]),
    h("div", { class: "desc" }, [
      "Deletes all user records, trajectories, alerts, evader fingerprints, and community history for this subreddit. Settings are preserved.",
    ]),
  ]));
  const resetBtn = h("button", { class: "btn btn-danger" }, ["Reset"]);
  let resetConfirmPending = false;
  resetBtn.addEventListener("click", async () => {
    // `confirm()` is blocked in Devvit's webview sandbox — use a two-click
    // confirmation pattern instead.
    if (!resetConfirmPending) {
      resetConfirmPending = true;
      resetBtn.textContent = "Tap again to confirm reset";
      resetBtn.style.opacity = "0.75";
      // Auto-cancel after 4 seconds if the user doesn't follow through.
      setTimeout(() => {
        if (resetConfirmPending) {
          resetConfirmPending = false;
          resetBtn.textContent = "Reset";
          resetBtn.style.opacity = "";
        }
      }, 4000);
      return;
    }
    resetConfirmPending = false;
    resetBtn.setAttribute("disabled", "true");
    resetBtn.textContent = "Resetting…";
    resetBtn.style.opacity = "";
    try {
      const r = await Api.devReset();
      showToast(`Reset complete — ${r.deletedKeys} keys removed`);
      cachedOverview = null;
      goTo("overview");
    } catch (err) {
      showToast(`Reset failed: ${(err as Error).message ?? err}`, "err");
    } finally {
      resetBtn.removeAttribute("disabled");
      resetBtn.textContent = "Reset";
    }
  });
  resetRow.appendChild(resetBtn);
  grid.appendChild(resetRow);

  card.appendChild(grid);
  main.appendChild(card);

  // ── Debug lookup card ──────────────────────────────────────────────────────
  const debugCard = h("div", { class: "card" });
  debugCard.appendChild(h("div", { class: "card-head" }, [
    h("div", {}, [
      h("h2", {}, ["Debug: inspect user record"]),
      h("div", { class: "sub" }, ["Look up the raw stored record for any username to verify events are landing."]),
    ]),
  ]));
  const debugGrid = h("div", { class: "settings-grid" });
  const debugRow = h("div", { class: "settings-row" });
  const debugInput = h("input", {
    type: "text",
    placeholder: "Reddit username (without u/)",
    style: "flex:1; padding:8px 12px; background:var(--bg-elev-2); border:1px solid var(--border); border-radius:6px; color:var(--text); font-size:13px;",
  });
  const debugBtn = h("button", { class: "btn btn-primary", style: "margin-left:8px" }, ["Look up"]);
  const debugOut = h("pre", {
    style: "margin-top:12px; padding:12px; background:var(--bg-elev-2); border-radius:6px; font-size:11px; overflow:auto; max-height:320px; white-space:pre-wrap; word-break:break-all; display:none;",
  });
  debugBtn.addEventListener("click", async () => {
    const name = (debugInput as HTMLInputElement).value.trim().replace(/^u\//, "");
    if (!name) return;
    debugBtn.setAttribute("disabled", "true");
    debugBtn.textContent = "Looking up…";
    try {
      const result = await Api.debugUser(name);
      debugOut.style.display = "block";
      debugOut.textContent = JSON.stringify(result, null, 2);
    } catch (err) {
      debugOut.style.display = "block";
      debugOut.textContent = `Error: ${(err as Error).message}`;
    } finally {
      debugBtn.removeAttribute("disabled");
      debugBtn.textContent = "Look up";
    }
  });
  debugRow.appendChild(debugInput);
  debugRow.appendChild(debugBtn);
  debugGrid.appendChild(debugRow);
  debugGrid.appendChild(debugOut);
  debugCard.appendChild(debugGrid);
  main.appendChild(debugCard);

  // Thresholds card (read-only — actual editing goes through Devvit settings UI).
  Api.init().then((init) => {
    const s = init.settings;
    const tcard = h("div", { class: "card" });
    tcard.appendChild(h("div", { class: "card-head" }, [
      h("div", {}, [
        h("h2", {}, ["Thresholds & windows"]),
        h("div", { class: "sub" }, ["Configurable via Devvit's settings panel. Defaults shown."]),
      ]),
    ]));
    const tgrid = h("div", { class: "settings-grid" });
    const rows: [string, string, string][] = [
      ["Decay half-life", `${s.decayWindowDays} days`, "Half-life used by every EMA"],
      ["WATCHING threshold", s.thresholdWatching.toFixed(2), "Lower bound of the WATCHING band"],
      ["ELEVATED threshold", s.thresholdElevated.toFixed(2), "Lower bound of the ELEVATED band"],
      ["CRITICAL threshold", s.thresholdCritical.toFixed(2), "Lower bound of the CRITICAL band"],
      ["Escalate dwell", `${s.escalateAfterDays} days`, "Time required above threshold to promote"],
      ["De-escalate dwell", `${s.deescalateAfterDays} days`, "Time required below threshold to demote"],
      ["Evader similarity", s.evaderSimilarityThreshold.toFixed(2), "Cosine cutoff for ban-evader matching"],
    ];
    for (const [name, val, desc] of rows) {
      const r = h("div", { class: "settings-row" });
      r.appendChild(h("div", {}, [
        h("div", { class: "name" }, [name]),
        h("div", { class: "desc" }, [desc]),
      ]));
      r.appendChild(h("span", { class: "mono" }, [val]));
      tgrid.appendChild(r);
    }
    tcard.appendChild(tgrid);
    main.appendChild(tcard);
  }).catch(() => undefined);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Skeleton / empty state                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

function skeleton(): HTMLElement {
  return h("div", { class: "card empty" }, [
    h("div", { class: "big" }, ["Loading…"]),
    h("div", {}, ["One moment."]),
  ]);
}

function emptyState(big: string, sub: string): HTMLElement {
  return h("div", { class: "empty" }, [
    h("div", { class: "big" }, [big]),
    h("div", {}, [sub]),
  ]);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Bootstrap                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

render().catch((err: unknown) => {
  console.error("[sentinel] dashboard load failed", err);
  showToast(`Failed to load: ${(err as Error).message ?? err}`, "err");
});

// Light auto-refresh on the overview every 30 seconds.
// Also clear the overview cache on every render so navigating back always
// fetches fresh data rather than showing a stale snapshot.
window.setInterval(() => {
  if (current === "overview") {
    cachedOverview = null;
    void render();
  }
}, 30 * 1000);
