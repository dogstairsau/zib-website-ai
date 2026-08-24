/**
 * Audit qualifying quiz.
 *
 * This used to run while the crawl streamed, which made answering optional —
 * the report arrived either way. It now runs before the crawl starts, so every
 * audit lead carries who-runs-marketing, budget and timeline, and this
 * endpoint records the tier alongside them. Best call time is only present for
 * leads a human will actually ring; a nurture-tier lead is never asked.
 */

import { isValidEmail } from "../lib/site";
import { captureLabQuiz } from "../lib/hubspot";
import { submitHubSpotForm } from "../lib/hubspotForms";
import { sendLabQuizEmail } from "../lib/email";
import { guard } from "../lib/rateLimit";
import { qualify } from "../lib/qualify";
import { clickIdFields } from "../lib/clickIds";

export const config = { runtime: "edge" };

type Body = {
  email?: string;
  url?: string;
  /** Display labels — what sales reads in HubSpot. */
  marketing?: string;
  budget?: string;
  dealValue?: string;
  running?: string;
  timeline?: string;
  callTime?: string;
  /** Stable keys — what the scoring reads. */
  marketingKey?: string;
  spendKey?: string;
  dealValueKey?: string;
  runningKey?: string;
  timelineKey?: string;
  /** The browser sends its own tier so it can branch instantly. Declared so
   *  the payload shape is documented, but deliberately never read — the tier
   *  is re-scored below from the keys above. */
  tier?: string;
  score?: number | null;
  /** Ad click ids, for offline conversion import. */
  clickIds?: Record<string, string>;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const clip = (s: string | undefined, max = 120) => (s || "").trim().slice(0, max);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const email = clip(body.email);
  if (!isValidEmail(email)) return json({ error: "Invalid email" }, 400);

  // One submit per audit run — partial flushes on page-leave can add a
  // second, so allow headroom over the audit's own limit.
  const blocked = await guard(req, "audit-quiz", [
    { limit: 4, windowSeconds: 600, suffix: "10m" },
    { limit: 20, windowSeconds: 86400, suffix: "1d" },
  ]);
  if (blocked) return blocked;

  const answers: { q: string; a: string }[] = [];
  if (body.marketing) answers.push({ q: "Who looks after marketing today", a: clip(body.marketing) });
  if (body.budget) answers.push({ q: "Monthly marketing budget", a: clip(body.budget) });
  if (body.dealValue) answers.push({ q: "What a new customer is worth", a: clip(body.dealValue) });
  if (body.running) answers.push({ q: "Running ads right now", a: clip(body.running) });
  if (body.timeline) answers.push({ q: "How soon they want help", a: clip(body.timeline) });
  if (body.callTime) answers.push({ q: "Best time for the Growth team to call", a: clip(body.callTime) });
  if (!answers.length) return json({ error: "No answers" }, 400);

  // Re-score server-side rather than trusting the browser's tier. The page
  // computes it too (so it can branch instantly), but this is a public
  // endpoint and the tier drives who sales calls — it shouldn't be settable
  // by whoever is posting.
  const scored = qualify({
    spend: clip(body.spendKey, 40),
    dealValue: clip(body.dealValueKey, 40),
    running: clip(body.runningKey, 40),
    timeline: clip(body.timelineKey, 40),
    marketing: clip(body.marketingKey, 40),
  });

  const quiz = {
    email,
    url: clip(body.url, 300),
    lab: "Website Audit",
    answers,
    tier: scored.tier,
    score: scored.score,
    clickIds: body.clickIds,
  };
  // Same three best-effort paths as the ads-lab quiz: Resend notification,
  // HubSpot Forms submission (routes to HUBSPOT_FORM_AUDIT via /audit/i),
  // and the private-app note on the contact record.
  await Promise.all([
    sendLabQuizEmail(quiz).catch((e) => console.warn("[audit-quiz email]", e?.message)),
    submitHubSpotForm(
      "Website Audit quiz",
      {
        email,
        website: quiz.url,
        lead_source: "Website Audit quiz",
        monthly_ad_spend: clip(body.budget),
        customer_value: clip(body.dealValue),
        // Dropped automatically on retry if the form doesn't carry them yet.
        lead_tier: scored.tier,
        lead_score: String(scored.score),
        ...clickIdFields(body.clickIds),
      },
      { pageName: "Website Audit quiz", pageUri: "https://zibdigital.com.au/audit" },
    ).catch((e) => console.warn("[audit-quiz form]", e?.message)),
    captureLabQuiz(quiz).catch((e) => console.warn("[audit-quiz hubspot]", e?.message)),
  ]);

  return json({ ok: true });
}
