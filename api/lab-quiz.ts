/**
 * Ads-lab qualifying quiz capture.
 *
 * These questions used to run while the pack generated, which made answering
 * optional — the pack arrived either way. They now run before the gate, so
 * every lab lead carries a budget and a goal, and this endpoint records the
 * tier alongside them. The tier decides whether the lead reaches a human at
 * all, so it is the most important field in the payload.
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
  budget?: string;
  dealValue?: string;
  goal?: string;
  /** Stable keys — what the scoring reads. */
  spendKey?: string;
  dealValueKey?: string;
  goalKey?: string;
  /** The browser sends its own tier so it can branch instantly. Declared so
   *  the payload shape is documented, but deliberately never read — the tier
   *  is re-scored below from the keys above. */
  tier?: string;
  score?: number | null;
  /** Ad click ids, for offline conversion import. */
  clickIds?: Record<string, string>;
  lab?: string;
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

  // A quiz is one submit per run — allow a little headroom over the
  // generation limit but keep abuse out.
  const blocked = await guard(req, "lab-quiz", [
    { limit: 4, windowSeconds: 600, suffix: "10m" },
    { limit: 20, windowSeconds: 86400, suffix: "1d" },
  ]);
  if (blocked) return blocked;

  const answers: { q: string; a: string }[] = [];
  if (body.budget) answers.push({ q: "Monthly ad spend", a: clip(body.budget) });
  if (body.dealValue) answers.push({ q: "What a new customer is worth", a: clip(body.dealValue) });
  if (body.goal) answers.push({ q: "What matters most right now", a: clip(body.goal) });
  if (!answers.length) return json({ error: "No answers" }, 400);

  // Re-score server-side rather than trusting the browser's tier. The page
  // computes it too (so it can branch instantly), but this is a public
  // endpoint and the tier drives who sales calls — it shouldn't be settable
  // by whoever is posting.
  const scored = qualify({
    spend: clip(body.spendKey, 40),
    dealValue: clip(body.dealValueKey, 40),
    goal: clip(body.goalKey, 40),
  });

  const quiz = {
    email,
    url: clip(body.url, 300),
    lab: clip(body.lab) || "Ads Lab",
    answers,
    tier: scored.tier,
    score: scored.score,
    clickIds: body.clickIds,
  };
  // Three best-effort paths: Resend notification works today; the Forms
  // submission lights up with HUBSPOT_PORTAL_ID + form GUIDs (routed to the
  // lab's own form); the private-app note with HUBSPOT_PRIVATE_APP_TOKEN.
  await Promise.all([
    sendLabQuizEmail(quiz).catch((e) => console.warn("[lab-quiz email]", e?.message)),
    submitHubSpotForm(quiz.lab, {
      email,
      website: quiz.url,
      lead_source: quiz.lab,
      monthly_ad_spend: clip(body.budget),
      primary_goal: clip(body.goal),
      customer_value: clip(body.dealValue),
      // Dropped automatically on retry if the form doesn't carry them yet.
      lead_tier: scored.tier,
      lead_score: String(scored.score),
      ...clickIdFields(body.clickIds),
    }).catch((e) => console.warn("[lab-quiz form]", e?.message)),
    captureLabQuiz(quiz).catch((e) => console.warn("[lab-quiz hubspot]", e?.message)),
  ]);

  return json({ ok: true });
}
