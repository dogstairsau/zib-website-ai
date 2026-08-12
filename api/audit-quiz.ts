/**
 * Audit wait-time qualifying quiz. Fired while the /audit crawl + strategist
 * read streams — who-runs-marketing / budget / timeline / best call time land
 * as a HubSpot note on the contact plus an internal notification email, so
 * the Growth team calls briefed instead of cold.
 */

import { isValidEmail } from "../lib/site";
import { captureLabQuiz } from "../lib/hubspot";
import { submitHubSpotForm } from "../lib/hubspotForms";
import { sendLabQuizEmail } from "../lib/email";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type Body = {
  email?: string;
  url?: string;
  marketing?: string;
  budget?: string;
  timeline?: string;
  callTime?: string;
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
  if (body.timeline) answers.push({ q: "How soon they want help", a: clip(body.timeline) });
  if (body.callTime) answers.push({ q: "Best time for the Growth team to call", a: clip(body.callTime) });
  if (!answers.length) return json({ error: "No answers" }, 400);

  const quiz = {
    email,
    url: clip(body.url, 300),
    lab: "Website Audit",
    answers,
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
      },
      { pageName: "Website Audit quiz", pageUri: "https://zibdigital.com.au/audit" },
    ).catch((e) => console.warn("[audit-quiz form]", e?.message)),
    captureLabQuiz(quiz).catch((e) => console.warn("[audit-quiz hubspot]", e?.message)),
  ]);

  return json({ ok: true });
}
