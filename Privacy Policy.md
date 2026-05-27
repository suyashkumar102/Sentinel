# Privacy Policy

Sentinel is built on a single, privacy-first principle: **only aggregate signals that moderators can already see**, and store as little of those signals as possible. We believe in absolute transparency, absolute local isolation, and zero external egress.

## 1. Scope of Data Ingestion
Sentinel only reads data that is generated within the specific subreddit where it is installed. It does not track users across different subreddits or read any cross-subreddit history. The App ingests:
- **Subreddit Metadata:** Timestamps, authorship, and report counts of posts and comments.
- **Moderator Logs:** Removals, approvals, warnings, and bans executed by the moderator team.
- **Text Characteristics:** Comment and post bodies are temporarily analyzed *in-memory* to extract character-level n-gram structures. **Raw text is never written to persistent storage.**

## 2. Persistent Data Storage
Sentinel persists only the minimum necessary data required to calculate behavioral trajectories and identify ban evaders:
- **User Metadata:** Reddit username, a composite numerical risk score, and current state (e.g., Healthy, Watching, Elevated, Critical).
- **Feature Vector:** Exponentially decayed values tracking removal rates, warning responses, controversy, velocity, and vocabulary signatures.
- **Friction Counters:** Submission and removal counts used for trend calculations.
- **Fingerprints:** Anonymized temporal posting histograms (24-bin density) and character n-gram profiles (capped at 50 per user) for ban-evader matching.
- **Telemetry:** 90-day trajectory scores and community health snapshots.

## 3. Data That Is Never Collected or Stored
Sentinel maintains a strict non-collection policy for:
- **Raw Text:** All text bodies are parsed for n-grams and immediately discarded.
- **Personally Identifiable Information (PII):** Sentinel does not collect emails, real names, or contact data.
- **Network Identifiers:** Sentinel does not have access to, and does not store, IP addresses, device identifiers, or browser metadata.
- **External Transmission:** The App is configured with zero network egress (`permissions.http.enable: false`). It is physically impossible for Sentinel to transmit data outside the Reddit ecosystem.

## 4. Moderator Controls and Right-to-be-Forgotten
Subreddit moderators have direct administrative tools to manage community privacy:
- **Whitelist Exemptions:** Moderators can exempt any username from monitoring and scoring.
- **Data Purging:** Moderators can trigger an immediate delete action that completely purges all stored trajectories, watchlist profiles, and scoring metadata for any user.
- **Global Kill Switch:** The App includes a settings toggle to halt all scoring and database updates immediately without uninstalling.

## 5. Security and Infrastructure
Sentinel operates entirely inside the sandboxed environment of the Reddit Developer Platform ("Devvit"). All data is stored in Reddit-provided, local Redis databases. Access to the Sentinel control panel and dashboard is strictly authenticated via Reddit’s administrative login and is restricted solely to the active moderators of the subreddit.

## 6. Retention Policies
- **User Records:** Retained only while the App is installed on the subreddit. Purged immediately upon App uninstallation or manual exempt actions.
- **Trajectory History:** Truncated automatically after 90 days.
- **Alerts Feed:** Capped to store only the 200 most recent notifications.
- **Community Trends:** Capped to rolling 30-day health summaries.

## 7. Updates to this Policy
Any changes to the Sentinel codebase that alter what data is stored or processed require a corresponding update to this policy. All updates are committed directly to the project's repository.
