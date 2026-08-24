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

import { qualify, SPEND_LABEL, TIMELINE_LABEL, MARKETING_LABEL } from "./qualify.ts";

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

const SPENDS = [...Object.keys(SPEND_LABEL), "", "bogus"];
const TIMELINES = [...Object.keys(TIMELINE_LABEL), ""];
const MARKETINGS = [...Object.keys(MARKETING_LABEL), ""];

test("browser and server qualification agree on every answer combination", () => {
  const browserQualify = loadBrowserQualify();
  let checked = 0;

  for (const spend of SPENDS) {
    for (const timeline of TIMELINES) {
      for (const marketing of MARKETINGS) {
        const answers = { spend, timeline, marketing };
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

  assert.ok(checked > 100, `expected a real sweep, only checked ${checked}`);
});

test("no budget never reaches sales, whatever else they answered", () => {
  for (const spend of ["none", "under-1k"]) {
    const result = qualify({ spend, timeline: "asap", marketing: "agency" });
    assert.equal(result.tier, "nurture", `${spend} + ASAP + agency should still be nurture`);
    assert.equal(result.salesReady, false);
  }
});

test("a stated researcher is nurture even on the top budget", () => {
  const result = qualify({ spend: "10k-plus", timeline: "researching", marketing: "agency" });
  assert.equal(result.tier, "nurture");
  assert.ok(
    result.reasons.some((r) => /researching/i.test(r)),
    "the reason should say why, so sales isn't left guessing",
  );
});

test("real budget with real intent qualifies", () => {
  assert.equal(qualify({ spend: "10k-plus", timeline: "asap" }).tier, "qualified");
  assert.equal(qualify({ spend: "3k-10k", timeline: "1-3-months" }).tier, "qualified");
  // Labs ask spend and goal but no timeline — spend alone has to carry it.
  assert.equal(qualify({ spend: "3k-10k", goal: "more-leads" }).tier, "qualified");
});

test("a mid-budget lead lands in review rather than either extreme", () => {
  const result = qualify({ spend: "1k-3k", timeline: "1-3-months" });
  assert.equal(result.tier, "review");
  assert.equal(result.salesReady, true);
});

test("an unanswered quiz cannot pass as qualified", () => {
  const result = qualify({});
  assert.equal(result.tier, "nurture");
  assert.equal(result.score, 0);
});
