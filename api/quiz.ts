import { guard } from "../lib/rateLimit";
import { captureQuizLead } from "../lib/hubspot";

export const config = { runtime: "edge" };

/**
 * Growth-quiz lead capture (/growth-quiz).
 *
 * Called twice per prospect:
 *   stage "gate"     — mid-quiz email capture. Creates the HubSpot contact
 *                      immediately, so someone who bails at question 5 is
 *                      still a lead.
 *   stage "complete" — quiz finished. Attaches a note with the full answers
 *                      and the winning segment to the same contact.
 *
 * Both writes are best-effort: HubSpot stubs to console without a token, and
 * the front-end never blocks the quiz on this endpoint.
 */

type Body = {
  stage?: string;
  email?: string;
  firstname?: string;
  segment?: string;
  answers?: { q?: string; a?: string }[];
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const stage = body.stage === "complete" ? "complete" : "gate";
  const email = (body.email || "").trim().toLowerCase();
  const firstname = (body.firstname || "").trim().slice(0, 80);
  const segment = (body.segment || "").trim().slice(0, 60);

  if (!emailRe.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (stage === "complete" && !segment) return json({ error: "Missing segment." }, 400);

  const answers = Array.isArray(body.answers)
    ? body.answers
        .slice(0, 10)
        .map((p) => ({ q: String(p?.q || "").slice(0, 200), a: String(p?.a || "").slice(0, 200) }))
        .filter((p) => p.q && p.a)
    : [];

  const blocked = await guard(req, "quiz");
  if (blocked) return blocked;

  try {
    await captureQuizLead({
      email,
      firstname,
      segment: stage === "complete" ? segment : undefined,
      answers,
    });
  } catch (e) {
    console.error("[quiz]", (e as Error).message);
    // Lead capture must never break the quiz experience.
  }

  return json({ ok: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
