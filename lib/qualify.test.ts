/**
 * The qualification rules live in two places — lib/qualify.ts (server) and a
 * mirrored copy inside assets/conversion.js (browser, so the page can branch
 * without a round-trip at the exact moment someone is waiting for their pack).
 *
 * Two copies of a business rule drift. This runs the real browser file in a
 * sandbox and asserts it agrees with the server on every combination of
 * answers, so a threshold changed in one place fails the build rather than
 * quietly sending qualified leads to the nurture list.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import {
  qualify, DEAL_LABEL, SPEND_LABEL, TIMELINE_LABEL, RUNNING_LABEL, MARKETING_LABEL,
} from "./qualify.ts";

const here = dirname(fileURLToPath(import.meta.url));

/** Load assets/conversion.js in a sandbox and hand back its window.zibQualify. */
function loadBrowserQualify(): (a: Record<string, string>) => {
  tier: string;
  score: number;
  salesReady: boolean;
} {
  const src = readFileSync(join(here, "..", "assets", "conversion.js"), "utf8");
  const store = new Map<string, string>();
  const sandbox: Record<string, unknown> = {
    document: { querySelector: () => null, title: "test" },
    location: { search: "", pathname: "/", hash: "" },
    history: { state: null, replaceState: () => {} },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    URLSearchParams,
    setInterval: () => 0,
    clearInterval: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const fn = (sandbox as { zibQualify?: unknown }).zibQualify;
  assert.equal(typeof fn, "function", "assets/conversion.js must define window.zibQualify");
  return fn as ReturnType<typeof loadBrowserQualify>;
}

const DEALS = [...Object.keys(DEAL_LABEL), "", "bogus"];
const SPENDS = [...Object.keys(SPEND_LABEL), "", "bogus"];
const TIMELINES = [...Object.keys(TIMELINE_LABEL), ""];
const RUNNINGS = [...Object.keys(RUNNING_LABEL), ""];
const MARKETINGS = [...Object.keys(MARKETING_LABEL), ""];

test("browser and server qualification agree on every answer combination", () => {
  const browserQualify = loadBrowserQualify();
  let checked = 0;

  for (const dealValue of DEALS) {
    for (const spend of SPENDS) {
      for (const timeline of TIMELINES) {
        for (const running of RUNNINGS) {
          for (const marketing of MARKETINGS) {
            const answers = { dealValue, spend, timeline, running, marketing };
            const server = qualify(answers);
            const browser = browserQualify(answers);
            const where = JSON.stringify(answers);

            assert.equal(browser.tier, server.tier, `tier mismatch for ${where}`);
            assert.equal(browser.score, server.score, `score mismatch for ${where}`);
            assert.equal(browser.salesReady, server.salesReady, `salesReady mismatch for ${where}`);
            checked++;
          }
        }
      }
    }
  }

  assert.ok(checked > 1000, `expected a real sweep, only checked ${checked}`);
});

test("the labs' three questions score on the same scale as the audit's five", () => {
  // Renormalisation means a lab lead isn't penalised for the two dimensions
  // it never asks about. Strong answers should qualify either way.
  const lab = qualify({ spend: "10k-plus", dealValue: "10k-50k", goal: "more-leads" });
  const audit = qualify({
    spend: "10k-plus", dealValue: "10k-50k", timeline: "asap",
    running: "yes", marketing: "agency",
  });
  assert.equal(lab.tier, "qualified", `lab lead should qualify, scored ${lab.score}`);
  assert.equal(audit.tier, "qualified", `audit lead should qualify, scored ${audit.score}`);
  assert.ok(
    Math.abs(lab.score - audit.score) < 20,
    `scales should be comparable, got lab ${lab.score} vs audit ${audit.score}`,
  );
});

test("deal value carries real weight, not just spend", () => {
  const tiny = qualify({ spend: "3k-10k", dealValue: "lt500" });
  const large = qualify({ spend: "3k-10k", dealValue: "gt50k" });
  assert.ok(large.score > tiny.score + 30, `expected a wide gap, got ${tiny.score} vs ${large.score}`);
});

test("a sub-$500 customer value caps a lead at review, it doesn't sink it", () => {
  // Mirrors /start, where lt500 blocks green but isn't on its own a red.
  const result = qualify({
    spend: "10k-plus", dealValue: "lt500", timeline: "asap",
    running: "yes", marketing: "agency",
  });
  assert.equal(result.tier, "review");
  assert.equal(result.salesReady, true);
  assert.ok(result.reasons.some((r) => /under \$500/i.test(r)), "the reason should say why");
});

test("already running ads lifts a lead over not running", () => {
  const base = { spend: "1k-3k", dealValue: "2k-10k", timeline: "1-3-months", marketing: "in-house" };
  assert.ok(
    qualify({ ...base, running: "yes" }).score > qualify({ ...base, running: "no" }).score,
    "running ads should score higher than not",
  );
});

test("no budget never reaches sales, whatever else they answered", () => {
  for (const spend of ["none", "under-1k"]) {
    const result = qualify({ spend, dealValue: "gt50k", timeline: "asap", marketing: "agency" });
    assert.equal(result.tier, "nurture", `${spend} + $50k deals + ASAP should still be nurture`);
    assert.equal(result.salesReady, false);
  }
});

test("a stated researcher is nurture even on the top budget", () => {
  const result = qualify({ spend: "10k-plus", dealValue: "gt50k", timeline: "researching", marketing: "agency" });
  assert.equal(result.tier, "nurture");
  assert.ok(
    result.reasons.some((r) => /researching/i.test(r)),
    "the reason should say why, so sales isn't left guessing",
  );
});

test("real budget with real intent qualifies", () => {
  assert.equal(qualify({ spend: "10k-plus", timeline: "asap" }).tier, "qualified");
  assert.equal(qualify({ spend: "3k-10k", timeline: "1-3-months" }).tier, "qualified");
  // Labs ask spend, deal value and goal but no timeline.
  assert.equal(qualify({ spend: "3k-10k", dealValue: "2k-10k", goal: "more-leads" }).tier, "qualified");
});

test("a mid-budget lead lands in review rather than either extreme", () => {
  const result = qualify({ spend: "1k-3k", dealValue: "500-2k", timeline: "1-3-months" });
  assert.equal(result.tier, "review");
  assert.equal(result.salesReady, true);
});

test("an unanswered quiz cannot pass as qualified", () => {
  const result = qualify({});
  assert.equal(result.tier, "nurture");
  assert.equal(result.score, 0);
});
