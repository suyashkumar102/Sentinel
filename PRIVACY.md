# Sentinel — Privacy

Sentinel is built on a single principle: **only aggregate signals that moderators can already see**, and store as little of them as possible.

## What Sentinel reads

- Post and comment metadata for posts in subreddits where Sentinel is installed (timestamps, authorship, mod actions taken).
- Mod actions visible in the public mod log (removals, approvals, warnings, reports, bans).
- Comment / post bodies, but **only** at the moment the trigger fires — they are passed through `core/ngrams.normalizeText` and reduced to character-n-gram counts on the spot. Raw text is never written to storage.

All of these are signals a moderator has direct access to via the standard Reddit moderation interface. Sentinel does not read user history outside the subreddit, does not call external services, and does not subscribe to anything beyond what is required by its triggers.

## What Sentinel stores

| Stored                                       | Why                                               |
|----------------------------------------------|---------------------------------------------------|
| Username + per-user `score`, `state`         | Powers the dashboard + alerts                     |
| Six-dimensional feature vector (EMA values)  | The behavioral trajectory                         |
| Submission / removal counters                | Auxiliary signal                                  |
| Hour-of-day histogram (24 numbers)           | Posting-time signature (used in evader matching)  |
| N-gram counts (max 50 per user)              | Vocabulary fingerprint (used in evader matching)  |
| 90-day trajectory points                     | Dashboard visualization                           |
| Subreddit-wide n-gram document-frequency map | TF-IDF baseline                                   |

## What Sentinel does NOT store

- **Raw post or comment bodies.** Text is reduced to n-gram counts at ingest time. The original is discarded.
- **IP addresses, device fingerprints, browser metadata.** Sentinel does not have access to these and would not store them if it did.
- **Cross-subreddit history.** Sentinel is per-install; one subreddit's data is never combined with another's. Each installation has its own Redis namespace.
- **PII beyond the username.** Usernames are public on Reddit; no email, real name, or contact data is collected.

## Mod controls

- **Kill switch** (`killSwitch` setting). Halts scoring and alerting without uninstalling the app. New events are dropped; existing data is preserved for reactivation.
- **Exempt list** (`exemptList` setting). Usernames in this list are excluded from scoring. Used for mods, well-known regulars, or anyone who's opted out.
- **"Exempt from monitoring" menu item.** One-click opt-out from any post or comment.
- **Right-to-be-forgotten.** A mod-menu action calls `deleteUser(userId)` which removes the user's hash, trajectory, and watchlist entry. The corpus DF map is *not* updated (it would require a full recomputation), but it contains no user-identifying information — only n-gram → integer counts.

## Permissions

`devvit.json` declares the minimum permissions necessary:

```json
"permissions": {
  "reddit": { "asUser": ["SUBMIT_POST"], "enable": true },
  "http":   { "enable": false }
}
```

`http.enable: false` is the structural guarantee that Sentinel cannot make outbound HTTP calls. No LLM, no third-party API, no telemetry. The only network egress is to Devvit-provided services (Reddit API and Redis), which are sandboxed by the Devvit platform.

## Transparency

Every alert ships with a per-feature contribution breakdown. The dashboard shows the 90-day score trajectory of any user. There are no hidden scores; every number a mod sees can be traced back to the events that produced it. This is intentional: an opaque "trust this number" system would be misused and rightly mistrusted.

## Data retention

- User records: retained while the app is installed. Deleted on uninstall or via the exempt-user menu.
- Trajectory points: capped at 90 days (`MAX_TRAJECTORY_POINTS`).
- Alerts feed: capped at the most recent 200 alerts.
- Community health snapshots: 30-day rolling window.

## Updates to this policy

This file lives in the repo. Any change to what Sentinel stores or how it stores it requires a corresponding change here, gated by code review.
