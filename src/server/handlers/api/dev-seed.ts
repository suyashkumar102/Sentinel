/**
 * `POST /internal/dev/seed` — run a high-fidelity subreddit simulation.
 *
 * Simulates a chronological event timeline over the past 30 days. Rather than generating
 * static database records, events (submissions, warnings, removals) are passed directly through
 * the production `ingest` pipeline. The core engines compute exponential decay, TF-IDF
 * character n-gram cosine similarities, and state transitions dynamically.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { context, redis } from "@devvit/web/server";
import { writeJson } from "../../http.ts";
import type {
  CommunityHealth,
  EvaderFingerprint,
  FeatureVector,
  UserState,
  Alert,
} from "../../../shared/types.ts";
import { Keys } from "../../storage/keys.ts";
import { putUser, getUser } from "../../storage/user.ts";
import { saveFingerprint } from "../../storage/evaders.ts";
import { writeHealth, computeHealthIndex, median, mean } from "../../storage/community.ts";
import { ingest } from "../../ingest.ts";
import type { SentinelEvent, EventKind } from "../../core/features.ts";
import { appendPoint } from "../../storage/trajectory.ts";
import { recordAlert } from "../../storage/alerts.ts";
import { clamp01 } from "../../core/decay.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export async function onDevSeed(_req: IncomingMessage, rsp: ServerResponse): Promise<void> {
  try {
    await runSeed(rsp);
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    writeJson(500, { type: "dev-seed-error", message: msg }, rsp);
  }
}

async function runSeed(rsp: ServerResponse): Promise<void> {
  const subreddit = context.subredditName ?? "simulation";
  const now = Date.now();

  // ── 1. Wipe existing simulation records first to ensure a pristine simulation ──
  const watchEntries = await redis.zRange(Keys.watchlist(), 0, -1, { by: "rank" });
  for (const e of watchEntries ?? []) {
    await redis.del(Keys.user(e.member));
    await redis.del(Keys.userTrajectory(e.member));
  }
  await redis.del(Keys.watchlist());
  await redis.del(Keys.activeIndex());
  await redis.del(Keys.community());
  await redis.del(Keys.communityHistory());

  const alertEntries = await redis.zRange(Keys.alertFeed(), 0, -1, { by: "rank" });
  for (const e of alertEntries ?? []) {
    await redis.del(Keys.alert(e.member));
  }
  await redis.del(Keys.alertFeed());

  const evaderEntries = await redis.zRange(Keys.evaderIndex(), 0, -1, { by: "rank" });
  for (const e of evaderEntries ?? []) {
    await redis.del(Keys.evader(e.member));
  }
  await redis.del(Keys.evaderIndex());

  // ── 2. Generate and sort the entire historical event timeline ───────
  const events = generateSimulationEvents(now);
  events.sort((a, b) => a.tMs - b.tMs);

  // ── 3. Chronological ingestion loop ───────────────────────────────────
  for (const ev of events) {
    await ingest(ev);
  }

  // ── 4. Manually ban the BannedUser and record fingerprint ─────────────
  const bannedName = "BannedUser";
  const bannedId = `t2_${slug(bannedName)}`;
  const bannedUser = await getUser(bannedId);
  if (bannedUser) {
    const updatedBannedUser = {
      ...bannedUser,
      state: "BANNED" as UserState,
      score: 0.92,
    };
    await putUser(updatedBannedUser);

    // Append BANNED trajectory point at 0.92 score to correct the graph
    await appendPoint(bannedId, { t: now - 5 * DAY_MS, score: 0.92, state: "BANNED" });

    // Seed BANNED transition alert to correct the escalations feed
    const banAlert: Alert = {
      id: `alert_${bannedId}_${now - 5 * DAY_MS}`,
      userId: bannedId,
      username: bannedName,
      createdAt: now - 5 * DAY_MS,
      fromState: "WATCHING",
      toState: "BANNED",
      score: 0.92,
      drivers: [
        { feature: "removalRate", value: 0.95, weight: 0.35, contribution: 0.3325 },
        { feature: "velocity", value: 0.60, weight: 0.15, contribution: 0.09 },
      ],
      rationale: "Removal rate 95/100 climbing · Spam-like posting velocity",
      contextLink: null,
    };
    await recordAlert(banAlert);

    const bannedHist = buildHourHistogram("nocturnal");
    const bannedNgrams = buildNgrams(["spam", "tobacc", "click", "free", "earn", "money"]);
    const fp: EvaderFingerprint = {
      userId: bannedUser.userId,
      username: bannedUser.username,
      bannedAt: now - 5 * DAY_MS,
      hourHistogram: bannedHist,
      ngramCounts: bannedNgrams,
      finalScore: 0.92,
    };
    await saveFingerprint(fp);

    // Give Suspicious_Alt its matching fingerprint
    const candidateName = "Suspicious_Alt";
    const candidateId = `t2_${slug(candidateName)}`;
    const candidateUser = await getUser(candidateId);
    if (candidateUser) {
      const updatedCandidateUser = {
        ...candidateUser,
        hourHistogram: jitterHistogram(bannedHist, 0.08),
        ngramCounts: jitterNgrams(bannedNgrams),
      };
      await putUser(updatedCandidateUser);
    }
  }

  // ── 5. Fetch final scores and build dynamically aligned history ───────
  const finalWatchEntries = await redis.zRange(Keys.watchlist(), 0, -1, { by: "rank" });
  const seededScores: number[] = [];
  const distribution: Record<UserState, number> = {
    HEALTHY: 0,
    WATCHING: 0,
    ELEVATED: 0,
    CRITICAL: 0,
    BANNED: 0,
  };

  for (const entry of finalWatchEntries ?? []) {
    const user = await getUser(entry.member);
    if (!user) continue;
    seededScores.push(user.score);
    distribution[user.state]++;
  }

  const computedHealth = computeHealthIndex(seededScores, distribution);
  const history = synthesizeCommunityHistory(now, computedHealth);

  const community: CommunityHealth = {
    subreddit,
    computedAt: now,
    populationSize: finalWatchEntries.length,
    activeLast7d: finalWatchEntries.length,
    medianScore: median(seededScores),
    meanScore: mean(seededScores),
    stateDistribution: distribution,
    healthIndex: computedHealth,
    drift30d: computedHealth - (history[history.length - 31]?.health ?? computedHealth),
    history,
  };
  await writeHealth(community);

  writeJson(200, {
    type: "dev-seed",
    inserted: finalWatchEntries.length,
    bannedUsers: 1,
    evaderCandidates: 1,
  }, rsp);
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Timeline Event Simulation Generator                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function generateSimulationEvents(now: number): SentinelEvent[] {
  const events: SentinelEvent[] = [];

  // Archetype 1: Healthy Regulars (35 users)
  const HEALTHY_USERNAMES = [
    "FifthUser", "GoodUser", "RegularRoy", "Bookworm88", "CoffeeBean",
    "QuietQuasar", "Garden_Ghost", "ModFan_99", "Smoothie", "PixelPainter",
    "OceanBreeze", "MountainClimber", "SkyGazer", "forest_hiker", "DesertRunner",
    "river_flow", "StarLight", "moon_walker", "SunnyDay", "WindChaser",
    "RainDrop", "SnowFlake", "CloudNine", "StormChaser", "LightningBug",
    "ThunderRoll", "FireFly", "EarthQuake", "VolcanoVent", "TornadoTwist",
    "HurricaneHero", "BlizzardBrave", "AvalancheActive", "GaleForce", "BreezeBeautiful"
  ];

  for (const name of HEALTHY_USERNAMES) {
    const userId = `t2_${slug(name)}`;
    events.push({
      kind: "submission",
      userId,
      username: name,
      tMs: now - 25 * DAY_MS - Math.random() * HOUR_MS,
      body: "This is a really nice and positive post about our favorite subreddit topics.",
    });
    events.push({
      kind: "submission",
      userId,
      username: name,
      tMs: now - 15 * DAY_MS - Math.random() * HOUR_MS,
      body: "Just wanted to share this beautiful photo and say hope everyone has a wonderful day!",
    });
    events.push({
      kind: "submission",
      userId,
      username: name,
      tMs: now - 5 * DAY_MS - Math.random() * HOUR_MS,
      body: "Here is a helpful tip that I found very useful for beginners in our hobby. Enjoy!",
    });
  }

  // Archetype 2: The Toxic Escalator (ExampleUser1)
  const u1 = "ExampleUser1";
  const id1 = `t2_${slug(u1)}`;
  events.push(
    { kind: "submission", userId: id1, username: u1, tMs: now - 28 * DAY_MS, body: "Hello everyone, glad to join this sub!" },
    { kind: "submission", userId: id1, username: u1, tMs: now - 20 * DAY_MS, body: "What are your thoughts on this common question?" },
    { kind: "submission", userId: id1, username: u1, tMs: now - 12 * DAY_MS, body: "Mods are absolute trash, this sub has gone to the dogs." },
    { kind: "warning", userId: id1, username: u1, tMs: now - 12 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: id1, username: u1, tMs: now - 10 * DAY_MS, body: "I don't care about your warning, I will post whatever I want." },
    { kind: "removal", userId: id1, username: u1, tMs: now - 10 * DAY_MS + 10 * 60 * 1000 },
    { kind: "submission", userId: id1, username: u1, tMs: now - 5 * DAY_MS, body: "Unbelievable power-tripping mods removing my posts again." },
    { kind: "removal", userId: id1, username: u1, tMs: now - 5 * DAY_MS + 10 * 60 * 1000 },
    { kind: "submission", userId: id1, username: u1, tMs: now - 2 * DAY_MS, body: "Scam free money click this sketchy link now!" },
    { kind: "removal", userId: id1, username: u1, tMs: now - 2 * DAY_MS + 10 * 60 * 1000 }
  );

  // Archetype 3: RagebaitGuy (Controversial to Critical)
  const u2 = "RagebaitGuy";
  const id2 = `t2_${slug(u2)}`;
  events.push(
    { kind: "submission", userId: id2, username: u2, tMs: now - 25 * DAY_MS, body: "Let's discuss something positive." },
    { kind: "submission", userId: id2, username: u2, tMs: now - 15 * DAY_MS, body: "You all are completely stupid and wrong about everything." },
    { kind: "removal", userId: id2, username: u2, tMs: now - 15 * DAY_MS + 10 * 60 * 1000 },
    { kind: "warning", userId: id2, username: u2, tMs: now - 14 * DAY_MS },
    { kind: "submission", userId: id2, username: u2, tMs: now - 8 * DAY_MS, body: "Shut up, your rules don't apply to me at all." },
    { kind: "removal", userId: id2, username: u2, tMs: now - 8 * DAY_MS + 10 * 60 * 1000 },
    { kind: "submission", userId: id2, username: u2, tMs: now - 3 * DAY_MS, body: "Ranting angrily and calling people names in every comment." },
    { kind: "removal", userId: id2, username: u2, tMs: now - 3 * DAY_MS + 10 * 60 * 1000 }
  );

  // Archetype 4: The Spammer (Spam_Sandbox)
  const u3 = "Spam_Sandbox";
  const id3 = `t2_${slug(u3)}`;
  events.push(
    { kind: "submission", userId: id3, username: u3, tMs: now - 15 * DAY_MS, body: "buy cheap luxury watches click link free shipping" },
    { kind: "removal", userId: id3, username: u3, tMs: now - 15 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: id3, username: u3, tMs: now - 12 * DAY_MS, body: "earn money from home fast online survey" },
    { kind: "removal", userId: id3, username: u3, tMs: now - 12 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: id3, username: u3, tMs: now - 9 * DAY_MS, body: "free gift cards for everyone click here now" },
    { kind: "removal", userId: id3, username: u3, tMs: now - 9 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: id3, username: u3, tMs: now - 6 * DAY_MS, body: "lose weight miracle pills order online today" },
    { kind: "removal", userId: id3, username: u3, tMs: now - 6 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: id3, username: u3, tMs: now - 3 * DAY_MS, body: "cheap airfares flights vacation discount" },
    { kind: "removal", userId: id3, username: u3, tMs: now - 3 * DAY_MS + 5 * 60 * 1000 }
  );

  // Archetype 5: The Reformed User (AnotherUser) — de-escalating beautifully
  const u4 = "AnotherUser";
  const id4 = `t2_${slug(u4)}`;
  events.push(
    { kind: "submission", userId: id4, username: u4, tMs: now - 28 * DAY_MS, body: "angry toxic rant post" },
    { kind: "removal", userId: id4, username: u4, tMs: now - 28 * DAY_MS + 10 * 60 * 1000 },
    { kind: "submission", userId: id4, username: u4, tMs: now - 24 * DAY_MS, body: "second toxic rant about things" },
    { kind: "removal", userId: id4, username: u4, tMs: now - 24 * DAY_MS + 10 * 60 * 1000 },
    { kind: "warning", userId: id4, username: u4, tMs: now - 22 * DAY_MS },
    // Reforming: posts clean content now!
    { kind: "submission", userId: id4, username: u4, tMs: now - 15 * DAY_MS, body: "I am sorry for my previous rants, will be better." },
    { kind: "submission", userId: id4, username: u4, tMs: now - 10 * DAY_MS, body: "Here is a really cool article about space exploration." },
    { kind: "submission", userId: id4, username: u4, tMs: now - 5 * DAY_MS, body: "Hope everyone has a safe and happy weekend!" }
  );

  // Archetype 6: Watching User (ThirdUser)
  const u5 = "ThirdUser";
  const id5 = `t2_${slug(u5)}`;
  events.push(
    { kind: "submission", userId: id5, username: u5, tMs: now - 20 * DAY_MS, body: "Let's check this interesting subject out." },
    { kind: "submission", userId: id5, username: u5, tMs: now - 12 * DAY_MS, body: "This is slightly controversial but let's talk about it." },
    { kind: "removal", userId: id5, username: u5, tMs: now - 12 * DAY_MS + 30 * 60 * 1000 },
    { kind: "submission", userId: id5, username: u5, tMs: now - 5 * DAY_MS, body: "Thanks for the feedback, hope we can stay civil." }
  );

  // Archetype 7: The Banned User (BannedUser)
  const ub = "BannedUser";
  const idb = `t2_${slug(ub)}`;
  events.push(
    { kind: "submission", userId: idb, username: ub, tMs: now - 25 * DAY_MS, body: "spam spam luxury watches click here free watches" },
    { kind: "removal", userId: idb, username: ub, tMs: now - 25 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: idb, username: ub, tMs: now - 20 * DAY_MS, body: "free money earn cash fast sketch link" },
    { kind: "removal", userId: idb, username: ub, tMs: now - 20 * DAY_MS + 5 * 60 * 1000 },
    { kind: "submission", userId: idb, username: ub, tMs: now - 15 * DAY_MS, body: "tobacco smoke click here free shipping tobacco" },
    { kind: "removal", userId: idb, username: ub, tMs: now - 15 * DAY_MS + 5 * 60 * 1000 }
  );

  // Archetype 8: The Evader Alt (Suspicious_Alt)
  const ua = "Suspicious_Alt";
  const ida = `t2_${slug(ua)}`;
  events.push(
    { kind: "submission", userId: ida, username: ua, tMs: now - 4 * DAY_MS, body: "hello, new account here happy to join!" },
    { kind: "submission", userId: ida, username: ua, tMs: now - 3 * DAY_MS, body: "tobacco free watches spam click money" },
    { kind: "removal", userId: ida, username: ua, tMs: now - 3 * DAY_MS + 10 * 60 * 1000 },
    { kind: "submission", userId: ida, username: ua, tMs: now - 2 * DAY_MS, body: "another post sharing cool ideas" }
  );

  return events;
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

function synthesizeCommunityHistory(now: number, endHealth: number): { t: number; health: number }[] {
  // Build backwards from endHealth to 90 days ago.
  // We want the health to rise moving forward (which means decreasing moving backward).
  const out: { t: number; health: number }[] = [];
  let h = endHealth;
  for (let i = 0; i < 90; i++) {
    const t = now - i * DAY_MS;
    out.push({ t, health: Math.round(h) });
    // Random walk backwards: positive bias means h decreases moving backward in time.
    const bias = i < 30 ? 0.15 : 0.08;
    h -= (Math.random() - 0.5 + bias) * 1.8;
    if (h < 55) h = 55;
    if (h > 98) h = 98;
  }
  return out.reverse();
}

function buildHourHistogram(profile: "diurnal" | "nocturnal" | "office"): number[] {
  const arr = new Array<number>(24).fill(0);
  if (profile === "nocturnal") {
    for (let h = 22; h < 24; h++) arr[h] = 4 + Math.random();
    for (let h = 0; h < 5; h++)   arr[h] = 5 + Math.random();
    for (let h = 5; h < 22; h++)  arr[h] = 0.4 + Math.random() * 0.5;
  } else if (profile === "office") {
    for (let h = 9; h < 18; h++)  arr[h] = 3 + Math.random();
    for (let h = 0; h < 24; h++)  if (arr[h] === 0) arr[h] = 0.3 + Math.random() * 0.4;
  } else {
    for (let h = 8; h < 23; h++)  arr[h] = 1 + Math.random() * 1.5;
    for (let h = 0; h < 24; h++)  if (arr[h] === 0) arr[h] = 0.1 + Math.random() * 0.2;
  }
  return arr;
}

function jitterHistogram(src: readonly number[], noise: number): number[] {
  return src.map((v) => Math.max(0, v + (Math.random() - 0.5) * noise * 2));
}

function buildNgrams(seeds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of seeds) {
    for (let i = 0; i + 2 <= s.length; i++) {
      const bg = s.slice(i, i + 2);
      counts[bg] = (counts[bg] ?? 0) + 1 + Math.floor(Math.random() * 3);
    }
    for (let i = 0; i + 3 <= s.length; i++) {
      const tg = s.slice(i, i + 3);
      counts[tg] = (counts[tg] ?? 0) + 1 + Math.floor(Math.random() * 2);
    }
  }
  return counts;
}

function jitterNgrams(src: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = Math.max(1, Math.round(v * (0.7 + Math.random() * 0.5)));
  }
  out["xy"] = 2;
  out["xyz"] = 1;
  return out;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
