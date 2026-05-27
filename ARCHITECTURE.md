# Sentinel — Architecture

This document describes the algorithms and the runtime that wires them together. It assumes you have read `README.md`.

## 1. The single design insight: trajectory, not state

Every Sentinel feature is an exponentially-weighted moving average (EMA) with a half-life expressed in days.

```
EMA_t = α · x_t + (1 − α) · EMA_{t−1}
α     = 1 − 2^(−1/halfLifeDays)
```

The half-life parameterization (rather than a fixed N-day window) means:

- A removal a year ago contributes `2^(−365/30) ≈ 0.00006` to today's score — effectively zero, without any explicit pruning logic.
- A user clean for a year but with two weeks of fresh removals shows a *rising* score, not a flat one masked by their long-clean history.
- Two weeks of daily removals on a previously-clean user produces a score of ~0.24 toward the steady-state 0.506 (`asserted in src/server/__tests__/decay.test.ts`).

This is the difference between Sentinel and a naïve "removals-in-the-last-N-days" counter: Sentinel detects the *trend*, not the magnitude.

### Decay-on-read

We never run a daily batch job to decay every user. Instead, every read of a user record calls `decayForward(prev, deltaDays, halfLife)` to lazily decay the stored EMA up to "now":

```ts
// src/server/core/decay.ts
export function decayForward(prev: number, deltaDays: number, halfLifeDays: number): number {
  if (deltaDays <= 0) return prev;
  if (halfLifeDays <= 0) return 0;
  return prev * Math.pow(0.5, deltaDays / halfLifeDays);
}
```

This makes Redis cost scale with *active users*, not population. The `state-recompute` job that runs every 15 minutes is the safety net for the inactive-but-still-pending case: it commits hysteresis transitions for users who otherwise went quiet.

## 2. The six-dimensional behavioral vector

Each feature is an independent EMA in `[0, 1]`. They are weight-summable into a single score without per-feature normalization at scoring time, which is the property that makes the alert-rationale code simple.

| Feature                 | Observation per event                                                | Weight |
|-------------------------|----------------------------------------------------------------------|-------:|
| `removalRate`           | 1 on removal, 0 on submission                                        |  0.30  |
| `warningResponse`       | Mapped Δ(removalRate) since last warning, recentered to [0, 1]       |  0.22  |
| `controversyAffinity`   | 1 if event was on a flagged thread, 0 otherwise                      |  0.18  |
| `velocity`              | submissions/week, normalized to [0, 1]                               |  0.12  |
| `vocabularyFingerprint` | Saturating compression of TF-IDF magnitude vs subreddit corpus       |  0.12  |
| `timeSignature`         | Concentration ("tightness") of hour-of-day histogram                 |  0.06  |
| **Total**               |                                                                      | **1.00** |

The weights were chosen so that **no single feature can pin the score above the ELEVATED threshold alone** — max single-feature contribution is `removalRate · 0.30 = 0.30`, well below the 0.45 elevated cutoff. This property is asserted in `score.test.ts`.

### Why these weights

The two highest-weight features (removalRate + warningResponse = 0.52) are the ones with the strongest signal in the academic literature on community moderation: a user's *response* to enforcement is the dominant predictor of future violations. The lower-weight features tip borderline decisions but cannot raise an alert alone.

### Vocabulary fingerprint specifics

- Character n-grams (2-gram + 3-gram), not word tokens. Language-agnostic; robust to leet, misspellings, and Unicode.
- TF-IDF using a subreddit-wide DF corpus maintained in `storage/corpus.ts`.
- Raw text is **never** stored — only the n-gram counts (capped at `MAX_NGRAMS_PER_USER = 50` per user). Quoted blocks and URLs are stripped from the text *before* extraction (`core/ngrams.normalizeText`).

## 3. State machine with hysteresis

`src/server/core/state.ts` is a pure function: same inputs produce the same outputs. The full lifecycle:

```
HEALTHY → WATCHING → ELEVATED → CRITICAL → BANNED (sticky)
        ↑               ↑                ↓
        └── all transitions go through pending dwell ──┘
```

For every score update:

1. Compute the *naive* state — the band the score is currently inside.
2. If it equals the current state: clear any pending transition. Done.
3. Otherwise, determine the direction (escalating vs de-escalating).
4. If a pending transition already exists for this naive band AND has dwelled past the direction-appropriate window (`escalateAfterDays = 3` or `deescalateAfterDays = 7`), commit. Otherwise update the pending window.

The longer de-escalation window encodes the policy that **false-positives are cheaper than premature trust restoration**. A 7-day dwell prevents a momentary score dip from prematurely flipping ELEVATED → WATCHING.

BANNED is sticky — only an explicit `ban` mod action with `outcome.unbanned: false` transitions out (or a mod menu action).

## 4. Ban-evader fingerprint engine

When a user is banned, we save:

1. Their hour-of-day histogram (24 numbers).
2. Their top-K character-n-gram TF-IDF vector (sparse map, capped).

When a new account appears, after enough activity to have a meaningful fingerprint (`MIN_EVENTS_FOR_SCORING`), we compute cosine similarity against every saved evader fingerprint. If the combined similarity (weighted: histogram 0.4, n-grams 0.6) exceeds `evaderSimilarity` (default 0.78), the new account is flagged.

**No IPs. No external lookups. No PII.** The fingerprint is built from the same mod-visible signals that drive the rest of the system.

```ts
// src/server/core/cosine.ts
export function cosineSparse(a: Map<string, number>, b: Map<string, number>): number
export function cosineDense(a: number[], b: number[]): number
```

Both are zero-aware (return 0 instead of NaN for zero vectors) and scale-invariant. See `cosine.test.ts`.

## 5. Community drift layer

`storage/community.ts` maintains a daily snapshot:

- Median score across all users active in the last 7 days.
- State distribution (count of HEALTHY / WATCHING / ELEVATED / CRITICAL).
- A 30-day rolling health index:
  ```
  health = 100 · (1 − median_score) · (1 − share_in_ELEVATED_or_above)
  ```

The `community-drift` scheduler job runs daily at 03:07 UTC (intentionally off-the-hour to avoid colliding with Reddit-side cron crunch). The dashboard plots the 30-day trend so a community can see whether moderation is winning or losing ground.

## 6. Alert engine

`alerts.ts` is dedup-aware: the same user + transition cannot re-alert within `ALERT_DEDUP_SECONDS = 6h`. Each alert includes:

- The state transition (e.g. `WATCHING → ELEVATED`).
- The top three feature drivers sorted by contribution, with a human-readable rationale string.
- A link to the user's 90-day trajectory in the dashboard.

The rationale is built from `core/score.rationale()`, which speaks mod-language ("Defiant response to recent warnings 65/100", "Engages on flagged threads 50/100") rather than algorithm-language. Mods see *why* not just *that*.

## 7. Storage layout

Every Redis key uses a single helper module (`storage/keys.ts`) to prevent string-typo bugs. Hot paths:

| Key                    | Type      | Purpose                                            |
|------------------------|-----------|----------------------------------------------------|
| `s:u:{userId}`         | Hash      | Per-user record (features, state, counters, …)    |
| `s:traj:{userId}`      | Sorted set| 90-day score trajectory                            |
| `s:watchlist`          | Sorted set| Users by score, descending                         |
| `s:active`             | Sorted set| Users by `lastEventAt`, for time-window queries    |
| `s:alerts`             | List      | Recent alerts feed (capped)                        |
| `s:evader:{evaderId}`  | Hash      | Saved fingerprint for ban-evader matching          |
| `s:community:health`   | Sorted set| Daily community health snapshots                   |
| `s:corpus:df`          | Hash      | N-gram document-frequency corpus                   |
| `s:exempt`             | Set       | Opt-out usernames                                  |
| `s:settings`           | Hash      | Mod-configurable settings                          |

Schema migrations are versioned via `SCHEMA_VERSION` (currently `1`). The `app-upgrade` trigger reads each user's stored schema number and migrates forward.

## 8. Runtime topology

```
┌──────────────────────────────────────────────────────────────────┐
│  Devvit triggers   →   POST /internal/triggers/*                 │
│  Devvit menu       →   POST /internal/menu/*                     │
│  Devvit scheduler  →   POST /internal/jobs/*                     │
│  Dashboard SPA     →   GET  /api/*                               │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                       src/server/router.ts
                              │
                              ▼
               src/server/ingest.ts (single chokepoint)
                              │
   ┌──────────────────────────┼──────────────────────────────┐
   ▼                          ▼                              ▼
core/features.applyEvent  storage/user.{get,put}  storage/trajectory.append
   │                          │                              │
   ▼                          ▼                              ▼
core/score.compositeScore  core/state.decide       alerts.maybeEmit
```

All algorithm modules under `src/server/core/` are pure — they take a record and return a new record. No Redis, no clock, no Reddit API. This is what makes the test suite small and fast: 82 tests across 32 suites run in under 400ms.

## 9. Testing strategy

- **Algorithmic tests** under `src/server/__tests__/` cover every `core/*` module. Pure functions; no mocks.
- **Property-style assertions**: monotonicity (decay never increases), bounds (`emaUpdateBounded ∈ [0, 1]` over 1000 iterations), symmetry (cosine), invariants (composite score weights sum to 1 and no single feature drives an alert alone).
- **Anti-thrash regression test**: a score oscillating across the WATCHING threshold every step does *not* cause any state transitions (`state.test.ts`).

Run with `npm test`. Coverage with `npm run test:coverage`.

## 10. Why this is server-side only

Devvit's client (the post UI) cannot:

- Subscribe to mod-action / comment-submit / post-report triggers.
- Run scheduled jobs.
- Persist cross-user state.
- Compose alerts that fire when mods aren't looking at the dashboard.

Sentinel is therefore a *server* app. The dashboard is read-only, a window into the data the server maintains. This is the structural reason no Devvit-blocks app can implement the same feature: blocks are per-render-instance; behavioral trajectory requires *durable, decaying, cross-event* state.
