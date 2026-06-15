import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBrandScore, type TargetSignals } from "./score.ts";
import type { PsiResult } from "../psi.ts";
import type { SocialAudit } from "./socials.ts";
import type { TrendSeries } from "./trends.ts";

const psi = (seo: number, perf = 70, a11y = 80, bp = 80): PsiResult => ({
  url: "https://x.test",
  scores: { performance: perf, accessibility: a11y, bestPractices: bp, seo },
  opportunities: [],
});

const social = (score: number, present: SocialAudit["present"] = ["facebook"]): SocialAudit => ({
  profiles: [],
  present,
  coreCovered: present.length,
  score,
});

const trend = (slope: number, latest = 60): TrendSeries => ({
  term: "acme",
  available: true,
  points: [50, 55, 58, latest],
  latest,
  average: 55,
  slope,
});

const base = (over: Partial<TargetSignals> = {}): TargetSignals => ({
  url: "https://acme.test",
  label: "acme",
  psi: psi(80),
  social: social(70),
  brandTrend: trend(0.2),
  site: { title: "Acme widgets", description: "Acme makes widgets", h1: "Acme widgets", h2s: [] },
  clarityScore: 80,
  ...over,
});

test("brand score is 0-100 and deterministic", () => {
  const a = computeBrandScore(base());
  const b = computeBrandScore(base());
  assert.equal(a.brandScore, b.brandScore);
  assert.ok(a.brandScore >= 0 && a.brandScore <= 100);
  assert.equal(a.pillars.length, 6);
});

test("rising trend with healthy capture reads as compounding", () => {
  const r = computeBrandScore(base({ brandTrend: trend(0.4), social: social(85), psi: psi(85, 85, 85, 85) }));
  assert.equal(r.velocity.direction, "rising");
  assert.equal(r.posture.mode, "compounding");
});

test("cooling trend flags a non-compounding posture", () => {
  const r = computeBrandScore(base({ brandTrend: trend(-0.3) }));
  assert.equal(r.velocity.direction, "cooling");
  assert.notEqual(r.posture.mode, "compounding");
});

test("unavailable signals are flagged and weights renormalise", () => {
  const r = computeBrandScore(base({ psi: null, brandTrend: null }));
  const exp = r.pillars.find((p) => p.key === "experience")!;
  assert.equal(exp.available, false);
  // Score still sits in range despite missing signals.
  assert.ok(r.brandScore >= 0 && r.brandScore <= 100);
});

test("competitor head-to-head produces a delta vs you", () => {
  const weakComp = base({ url: "https://rival.test", label: "rival", psi: psi(30, 30, 40, 40), social: social(20, []), brandTrend: trend(-0.2, 20) });
  const r = computeBrandScore(base(), [weakComp]);
  assert.equal(r.competitors.length, 1);
  assert.ok(r.competitors[0].deltaVsYou > 0, "stronger brand should lead a weak competitor");
  const competitive = r.pillars.find((p) => p.key === "competitive")!;
  assert.equal(competitive.available, true);
});

test("the lever picks an available pillar with a real shortfall", () => {
  const r = computeBrandScore(base({ social: social(10, []) }));
  assert.ok(r.lever.key);
  assert.equal(r.pillars.find((p) => p.key === r.lever.key)!.available, true);
});
