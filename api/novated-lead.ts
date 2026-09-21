import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

/**
 * Novated Choice landing-page lead capture (/novated-choice).
 *
 * The quiz promises a written quote the same day, so a lead that lands
 * nowhere is worse than no form at all. This endpoint therefore never drops
 * one silently: every submission is logged, and delivery is attempted to
 * whichever destinations are configured.
 *
 *   NOVATED_LEAD_WEBHOOK  — where the lead actually goes. Point it at the
 *                           client's CRM, a Zapier/Make hook, or an inbox
 *                           relay. Unset, the lead is still logged and still
 *                           posted to Slack.
 *   SLACK_WEBHOOK_URL     — optional; puts the lead in front of a human
 *                           immediately, ranked by intent.
 *
 * Both are best-effort and run in parallel: a failure in one must not stop
 * the other, and neither can fail the request. The browser already has the
 * prospect's answers on screen — re-prompting them because a downstream
 * service is down would lose the lead for good.
 */

type Body = {
  /**
   * "lead"     — captured at the contact step, before the optional detail.
   *              Someone who stops right here is still a lead.
   * "enriched" — the same person came back and answered employment and
   *              salary. Match on email and update rather than create.
   */
  stage?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  car?: string;
  budget?: string;
  phase?: string;
  timing?: string;
  employment?: string;
  salary?: string;
  is_ev?: boolean;
  eligible?: boolean;
  intent_score?: number;
  estimated_saving?: number;
  source?: string;
  page?: string;
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown, max = 120) => String(v ?? "").trim().slice(0, max);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const email = str(body.email, 160).toLowerCase();
  const firstname = str(body.firstname, 80);
  const phone = str(body.phone, 40);

  if (!firstname) return json({ error: "Enter your first name." }, 400);
  if (!emailRe.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (phone.replace(/\D/g, "").length < 8) return json({ error: "Enter a valid mobile number." }, 400);

  const blocked = await guard(req, "novated-lead");
  if (blocked) return blocked;

  const lead = {
    stage: body.stage === "enriched" ? "enriched" : "lead",
    firstname,
    lastname: str(body.lastname, 80),
    email,
    phone,
    car: str(body.car),
    budget: str(body.budget, 60),
    phase: str(body.phase, 80),
    timing: str(body.timing, 60),
    employment: str(body.employment, 80),
    salary: str(body.salary, 40),
    is_ev: body.is_ev === true,
    eligible: body.eligible === true,
    // 2 = just curious, 8 = ready to transact. Set by the two qualifying
    // questions, so sales can triage before the first call.
    intent_score: Number.isFinite(body.intent_score) ? Number(body.intent_score) : 0,
    estimated_saving: Number.isFinite(body.estimated_saving) ? Number(body.estimated_saving) : 0,
    source: str(body.source, 60) || "novated-leasing-lp",
    page: str(body.page, 200),
    received_at: new Date().toISOString(),
  };

  // Logged first and unconditionally: whatever happens downstream, the lead
  // is recoverable from the function logs.
  console.log("[novated-lead]", JSON.stringify(lead));

  await Promise.allSettled([forward(lead), notifySlack(lead)]);

  return json({ ok: true });
}

async function forward(lead: Record<string, unknown>): Promise<void> {
  const url = process.env.NOVATED_LEAD_WEBHOOK;
  if (!url) {
    console.warn("[novated-lead] NOVATED_LEAD_WEBHOOK unset — lead logged only");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lead),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`webhook ${res.status}`);
}

async function notifySlack(lead: Record<string, unknown>): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  const score = Number(lead.intent_score) || 0;
  // 7+ means they named a car and want it soon — worth calling today.
  const heat = score >= 7 ? ":fire: HOT" : score >= 5 ? ":zap: Warm" : ":snowflake: Early";

  const lines = [
    lead.stage === "enriched"
      ? `:heavy_plus_sign: Extra detail — *${lead.firstname} ${lead.lastname}* (same lead, now with salary)`
      : `${heat} novated lead — *${lead.firstname} ${lead.lastname}*`,
    `:car: ${lead.car || "—"}  ·  ${lead.budget || "—"}${lead.is_ev ? "  ·  EV" : ""}`,
    `:dart: ${lead.phase || "—"}  ·  ${lead.timing || "—"}`,
    `:office: ${lead.employment || "not given"}  ·  ${lead.salary || "not given"}`,
    `:telephone_receiver: ${lead.phone}  ·  ${lead.email}`,
  ];
  if (lead.stage === "enriched" && !lead.eligible) {
    lines.push(":warning: Not permanent PAYG — check what's possible");
  }

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
    signal: AbortSignal.timeout(5_000),
  }).catch((e) => console.warn("[slack]", (e as Error).message));
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
