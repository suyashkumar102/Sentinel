/**
 * Composite scoring & alert-driver attribution.
 *
 * Six features → one scalar in [0, 1]. The weights are chosen so that:
 *   1. No single feature can pin the score (max single-feature contribution
 *      is removalRate · 0.3 = 0.3, well below the WATCHING threshold).
 *   2. The two most predictive features (removalRate trend, warningResponse)
 *      together account for >50% of the score.
 *   3. The "scaffolding" features (velocity, timeSignature) are low-weight —
 *      they tip a borderline case but cannot drive an alert alone.
 *
 * This matches the 2024 academic literature on community-level moderation
 * predictors (post-removal response & moderator-warning compliance dominate;
 * activity-cadence shifts are secondary).
 */
import type { AlertDriver, FeatureVector } from "../../shared/types.ts";
import { FEATURE_KEYS } from "../../shared/types.ts";
import { FEATURE_WEIGHTS } from "../../shared/constants.ts";
import { clamp01 } from "./decay.ts";

export function compositeScore(features: FeatureVector): number {
  let s = 0;
  for (const key of FEATURE_KEYS) {
    s += clamp01(features[key]) * FEATURE_WEIGHTS[key];
  }
  return clamp01(s);
}

/**
 * Per-feature attribution for an alert. Returned drivers are sorted by
 * absolute contribution descending — the most explanatory feature first.
 *
 * This is what mods see in the alert ("the score jumped because the removal
 * rate is climbing AND the warning didn't change behavior") — without that
 * explanation, an alert is just an opaque number and mods won't trust it.
 */
export function alertDrivers(features: FeatureVector): AlertDriver[] {
  const drivers: AlertDriver[] = FEATURE_KEYS.map((key) => {
    const value = clamp01(features[key]);
    const weight = FEATURE_WEIGHTS[key];
    return {
      feature: key,
      value,
      weight,
      contribution: value * weight,
    };
  });
  drivers.sort((a, b) => b.contribution - a.contribution);
  return drivers;
}

/**
 * Build a human-readable rationale string describing the top drivers of an alert.
 * Mods see this in modmail / modnotes; it's the front-of-house explanation.
 */
export function rationale(features: FeatureVector): string {
  const drivers = alertDrivers(features);
  const top = drivers.slice(0, 3).filter((d) => d.contribution > 0.01);
  if (top.length === 0) return "Score crossed threshold without a dominant driver.";
  const phrases = top.map(describeDriver);
  return phrases.join(" · ");
}

function describeDriver(d: AlertDriver): string {
  const pct = Math.round(d.value * 100);
  switch (d.feature) {
    case "velocity":
      return `Activity velocity ${pct}/100`;
    case "removalRate":
      return `Removal rate ${pct}/100 (trending up)`;
    case "controversyAffinity":
      return `Engages on flagged threads ${pct}/100`;
    case "warningResponse":
      return `Defiant response to recent warnings ${pct}/100`;
    case "timeSignature":
      return `Unusual posting rhythm ${pct}/100`;
    case "vocabularyFingerprint":
      return `Distinctive vocabulary ${pct}/100`;
    default:
      d.feature satisfies never;
      return "";
  }
}
