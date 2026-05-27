/**
 * Splash entry — the first thing a moderator sees inside the custom post.
 *
 * Reads the subreddit + username from Devvit's client context and personalizes
 * the hero. The "Open mod dashboard" button transitions the webview to the
 * dashboard entrypoint via `requestExpandedMode`.
 */
import { context, requestExpandedMode } from "@devvit/web/client";

const subName = context.subredditName ?? "your subreddit";
const username = context.username ?? "moderator";

const subEl = document.getElementById("sub-name");
const titleSub = document.getElementById("title-sub");
const signedAs = document.getElementById("signed-as");
if (subEl) subEl.textContent = `r/${subName}`;
if (titleSub) titleSub.textContent = `r/${subName}`;
if (signedAs) signedAs.textContent = `u/${username}`;

const openBtn = document.getElementById("open-dashboard") as HTMLButtonElement | null;
openBtn?.addEventListener("click", (ev) => {
  requestExpandedMode(ev as MouseEvent, "dashboard");
});

const learnBtn = document.getElementById("learn-more") as HTMLButtonElement | null;
learnBtn?.addEventListener("click", () => {
  // Soft-scroll to the feature cards if present (they're already in view; this
  // is a no-op on most layouts but provides feedback on dense mobile widths).
  document.querySelector(".feature-card")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
});

// Make the feature cards individually clickable so the whole hero feels alive.
document.querySelectorAll<HTMLDivElement>(".feature-card").forEach((card) => {
  card.addEventListener("click", (ev) => {
    requestExpandedMode(ev as MouseEvent, "dashboard");
  });
});
