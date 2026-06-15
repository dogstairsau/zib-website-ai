/**
 * Deterministic Brand Score model.
 *
 * Same input → same output. The AI never touches the number — it only writes
 * the read (see lib/prompts/brand.ts). This module turns assembled signals
 * (PageSpeed, social verification, Google Trends, a site snapshot and an
 * AI-supplied positioning-clarity score) into six pillars, the headline Brand
 * Score, and the Value Creation overlay (velocity, capture split, posture,
 * lever). Every signal degrades gracefully: unavailable signals are dropped
 * from their pillar's mean and flagged rather than failing the run.
 *
 * See BRAND-SCORE.md for the model rationale.
 */

import type { PsiResult } from "../psi";
import type { SocialAudit } from "./socials";
import type { TrendSeries } from "./trends";
import type { NewsSignal } from "./news";
import type { RedditSignal } from "./reddit";

export type LlmVisibilitySignal = { available: boolean; score: number; label?: string };

export type PillarKey =
  | "visibility"
  | "clarity"
  | "social"
  | "competitive"
  | "momentum"
  | "experience";

export const PILLAR_META: Record<
  PillarKey,
  { label: string; weight: number; lever: string }
> = {
  visibility: { label: "Market Visibility", weight: 0.22, lever: "Get seen by the people that matter" },
  clarity: { label: "Brand Clarity", weight: 0.18, lever: "Sharpen the positioning and promise" },
  social: { label: "Social Presence & Proof", weight: 0.16, lever: "Show up where buyers check, with proof" },
  competitive: { label: "Competitive Position", weight: 0.18, lever: "Take share from the competitors that matter" },
  momentum: { label: "Demand Momentum", weight: 0.13, lever: "Turn the trend line back up" },
  experience: { label: "Experience & Conversion", weight: 0.13, lever: "Stop value leaking before you get paid" },
};

export type SiteSnapshot = {
  title: string;
  description: string;
  h1: string;
  h2s: string[];
};

export type TargetSignals = {
  url: string;
  label: string;
  psi?: PsiResult | null;
  social?: SocialAudit | null;
  brandTrend?: TrendSeries | null;
  site?: SiteSnapshot | null;
  clarityScore?: number | null; // AI-supplied, main target only
  // Extended reputation signals — main target only, all optional.
  news?: NewsSignal | null;
  reddit?: RedditSignal | null;
  llmVisibility?: LlmVisibilitySignal | null;
};

export type Pillar = {
  key: PillarKey;
  label: string;
  weight: number;
  score: number;
  available: boolean;
  note: string;
  lever: string;
};

export type BrandScoreResult = {
  brandScore: number;
  pillars: Pillar[];
  velocity: { slope: number; direction: "rising" | "flat" | "cooling"; label: string };
  capture: { create: number; capture: number; ratio: number; leak: boolean; note: string };
  posture: {
    mode: "compounding" | "investing" | "extraction" | "rebuild";
    headline: string;
    detail: string;
  };
  lever: { key: PillarKey; label: string; headline: string };
  competitors: CompetitorStanding[];
};

export type CompetitorStanding = {
  label: string;
  url: string;
  liteScore: number; // comparable score from shared pillars only
  deltaVsYou: number; // your liteScore − theirs (positive = you ahead)
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));
const round = (n: number) => Math.round(n);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// Map a Google Trends slope (~ -1..+1) to a 0..100 momentum score.
const slopeToScore = (slope: number) => clamp(50 + slope * 60);

// ── deterministic message-consistency: do title / H1 / meta tell one story? ──
const STOP = new Set([
  "the", "and", "for", "with", "your", "you", "our", "are", "from", "that",
  "this", "have", "all", "can", "best", "more", "get", "out", "now", "we",
  "to", "of", "in", "on", "a", "is", "at", "by", "or", "an",
]);
const tokens = (s: string) =>
  new Set(
    (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / Math.min(a.size, b.size);
};

function messageConsistency(site?: SiteSnapshot | null): number | null {
  if (!site) return null;
  const t = tokens(site.title);
  const h = tokens(site.h1);
  const d = tokens(site.description);
  if (!t.size && !h.size && !d.size) return null;
  // Pairwise overlap across the three signals; reward a shared vocabulary.
  const pairs = [overlap(t, h), overlap(t, d), overlap(h, d)].filter((x) => x >= 0);
  const base = mean(pairs) * 100;
  // Floor of 30 if at least a title + H1 both exist (some story is present).
  return clamp(Math.max(base, t.size && h.size ? 30 : 0));
}

// ── per-pillar builders. Each returns {score, available, note}. ──
type Built = { score: number; available: boolean; note: string };

// Blend a set of optional sub-signals into one pillar. SEO is weighted highest
// in visibility, but everything averages once present, and missing signals are
// dropped (renormalised) rather than dragging the pillar to a neutral 50.
type Contribution = { label: string; value: number; weight: number; available: boolean };

function blend(contribs: Contribution[], emptyNote: string): Built {
  const avail = contribs.filter((c) => c.available);
  if (!avail.length) return { score: 50, available: false, note: emptyNote };
  const wSum = avail.reduce((a, c) => a + c.weight, 0);
  const score = avail.reduce((a, c) => a + c.value * (c.weight / wSum), 0);
  return { score: clamp(score), available: true, note: avail.map((c) => c.label).join(" · ") };
}

function visibilityPillar(t: TargetSignals): Built {
  return blend(
    [
      { label: `SEO ${t.psi?.scores.seo ?? ""}`, value: t.psi?.scores.seo ?? 0, weight: 0.4, available: !!t.psi },
      { label: `brand interest ${t.brandTrend?.latest ?? ""}/100`, value: t.brandTrend?.latest ?? 0, weight: 0.3, available: !!t.brandTrend?.available },
      { label: `news ${t.news?.articleCount ?? 0} mentions`, value: t.news?.volumeScore ?? 0, weight: 0.18, available: !!t.news?.available },
      { label: `AI visibility ${t.llmVisibility?.label ?? ""}`, value: t.llmVisibility?.score ?? 0, weight: 0.12, available: !!t.llmVisibility?.available },
    ],
    "no visibility signal",
  );
}

function clarityPillar(t: TargetSignals): Built {
  const parts: number[] = [];
  const notes: string[] = [];
  if (typeof t.clarityScore === "number") {
    parts.push(t.clarityScore);
    notes.push(`positioning ${round(t.clarityScore)}`);
  }
  const mc = messageConsistency(t.site);
  if (mc !== null) {
    parts.push(mc);
    notes.push(`message consistency ${round(mc)}`);
  }
  if (!parts.length) return { score: 50, available: false, note: "no clarity signal" };
  return { score: clamp(mean(parts)), available: true, note: notes.join(" · ") };
}

function socialPillar(t: TargetSignals): Built {
  const profilesNote = t.social
    ? t.social.present.length
      ? `${t.social.present.length} profiles · core ${t.social.coreCovered}/3`
      : "no verified profiles"
    : "";
  return blend(
    [
      { label: profilesNote, value: t.social?.score ?? 0, weight: 0.5, available: !!t.social },
      { label: `reddit ${t.reddit?.mentionCount ?? 0} mentions`, value: t.reddit?.score ?? 0, weight: 0.28, available: !!t.reddit?.available },
      { label: `coverage tone ${t.news?.avgTone ?? ""}`, value: t.news?.toneScore ?? 0, weight: 0.22, available: !!t.news?.available },
    ],
    "socials not checked",
  );
}

function momentumPillar(t: TargetSignals): Built {
  if (!t.brandTrend?.available) return { score: 50, available: false, note: "no trend data" };
  return {
    score: clamp(slopeToScore(t.brandTrend.slope)),
    available: true,
    note: `12-mo slope ${t.brandTrend.slope >= 0 ? "+" : ""}${(t.brandTrend.slope * 100).toFixed(0)}%`,
  };
}

function experiencePillar(t: TargetSignals): Built {
  if (!t.psi) return { score: 50, available: false, note: "no PageSpeed data" };
  const s = t.psi.scores;
  const score = mean([s.performance, s.accessibility, s.bestPractices]);
  return {
    score: clamp(score),
    available: true,
    note: `perf ${s.performance} · a11y ${s.accessibility} · best-practice ${s.bestPractices}`,
  };
}

/** A comparable "lite" score from only the pillars we can compute for anyone
 *  (no AI): visibility, social, momentum, experience. Used for head-to-head. */
function liteScore(t: TargetSignals): number {
  const v = visibilityPillar(t);
  const s = socialPillar(t);
  const m = momentumPillar(t);
  const e = experiencePillar(t);
  const w = { visibility: 0.34, social: 0.24, momentum: 0.2, experience: 0.22 };
  return round(
    v.score * w.visibility + s.score * w.social + m.score * w.momentum + e.score * w.experience,
  );
}

function competitivePillar(you: TargetSignals, comps: TargetSignals[]): { built: Built; standings: CompetitorStanding[] } {
  const yourLite = liteScore(you);
  if (!comps.length) {
    return { built: { score: 50, available: false, note: "no competitors named" }, standings: [] };
  }
  const standings: CompetitorStanding[] = comps.map((c) => {
    const cl = liteScore(c);
    return { label: c.label, url: c.url, liteScore: cl, deltaVsYou: yourLite - cl };
  });
  // Score: 50 = level with the field. +/-2.5 pts per point of average advantage.
  const avgComp = mean(standings.map((s) => s.liteScore));
  const score = clamp(50 + (yourLite - avgComp) * 2.5);
  const ahead = standings.filter((s) => s.deltaVsYou > 0).length;
  return {
    built: { score, available: true, note: `ahead of ${ahead}/${standings.length}` },
    standings,
  };
}

export function computeBrandScore(you: TargetSignals, competitors: TargetSignals[] = []): BrandScoreResult {
  const builders: Record<PillarKey, Built> = {
    visibility: visibilityPillar(you),
    clarity: clarityPillar(you),
    social: socialPillar(you),
    competitive: { score: 50, available: false, note: "" }, // filled below
    momentum: momentumPillar(you),
    experience: experiencePillar(you),
  };
  const comp = competitivePillar(you, competitors);
  builders.competitive = comp.built;

  const pillars: Pillar[] = (Object.keys(PILLAR_META) as PillarKey[]).map((key) => ({
    key,
    label: PILLAR_META[key].label,
    weight: PILLAR_META[key].weight,
    lever: PILLAR_META[key].lever,
    score: round(builders[key].score),
    available: builders[key].available,
    note: builders[key].note,
  }));

  // Brand Score: renormalise weights across available pillars so a missing
  // signal doesn't silently drag the number toward a neutral 50.
  const avail = pillars.filter((p) => p.available);
  const usable = avail.length ? avail : pillars;
  const wSum = usable.reduce((a, p) => a + p.weight, 0);
  const brandScore = round(usable.reduce((a, p) => a + p.score * (p.weight / wSum), 0));

  // ── Value Creation overlay ──
  const slope = you.brandTrend?.available ? you.brandTrend.slope : 0;
  const velocity = {
    slope,
    direction: (slope > 0.05 ? "rising" : slope < -0.05 ? "cooling" : "flat") as
      | "rising"
      | "flat"
      | "cooling",
    label:
      slope > 0.05
        ? "Demand for your brand is rising"
        : slope < -0.05
          ? "Demand for your brand is cooling"
          : "Demand for your brand is flat",
  };

  const by = (k: PillarKey) => pillars.find((p) => p.key === k)!.score;
  const create = round(mean([by("visibility"), by("clarity"), by("momentum")]));
  const captureVal = round(mean([by("experience"), by("social")]));
  const ratio = create > 0 ? Number((captureVal / create).toFixed(2)) : 1;
  const leak = create - captureVal > 12;
  const capture = {
    create,
    capture: captureVal,
    ratio,
    leak,
    note: leak
      ? "You're creating more demand than you're capturing — value is leaking before you get paid."
      : "You're capturing most of the value your brand creates.",
  };

  const velocityUp = velocity.direction === "rising";
  const captureHealthy = ratio >= 0.9;
  const posture = (() => {
    if (velocityUp && captureHealthy)
      return {
        mode: "compounding" as const,
        headline: "Compounding advantage",
        detail: "The pie is growing and you're keeping your share. Keep investing in what's working.",
      };
    if (velocityUp && !captureHealthy)
      return {
        mode: "investing" as const,
        headline: "Investing — but plug the leaks",
        detail: "Demand is rising faster than you're capturing it. Fix conversion and proof before you pour in more.",
      };
    if (!velocityUp && captureHealthy)
      return {
        mode: "extraction" as const,
        headline: "Extraction warning",
        detail: "You're efficient, but the pie isn't growing. You're squeezing today's profit at the expense of tomorrow.",
      };
    return {
      mode: "rebuild" as const,
      headline: "Rebuild the engine",
      detail: "Demand is soft and value is leaking. The brand needs a reset before scale.",
    };
  })();

  // Lever: the pillar with the largest weighted shortfall (weight × gap to 100).
  const leverPillar = [...pillars]
    .filter((p) => p.available)
    .sort((a, b) => b.weight * (100 - b.score) - a.weight * (100 - a.score))[0]
    ?? pillars[0];
  const lever = {
    key: leverPillar.key,
    label: leverPillar.label,
    headline: PILLAR_META[leverPillar.key].lever,
  };

  return {
    brandScore,
    pillars,
    velocity,
    capture,
    posture,
    lever,
    competitors: comp.standings,
  };
}
