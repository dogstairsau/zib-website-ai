/**
 * Ads-lab micro-quiz capture. Fired while a prospect's pack generates —
 * budget + goal answers land as a HubSpot note on their contact record so
 * the strategist is briefed before the 24h follow-up call.
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
  budget?: string;
  goal?: string;
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
  if (body.goal) answers.push({ q: "What matters most right now", a: clip(body.goal) });
  if (!answers.length) return json({ error: "No answers" }, 400);

  const quiz = {
    email,
    url: clip(body.url, 300),
    lab: clip(body.lab) || "Ads Lab",
    answers,
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
    }).catch((e) => console.warn("[lab-quiz form]", e?.message)),
    captureLabQuiz(quiz).catch((e) => console.warn("[lab-quiz hubspot]", e?.message)),
  ]);

  return json({ ok: true });
}
