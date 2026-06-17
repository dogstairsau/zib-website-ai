import { sendLeadEmail } from "../lib/email";
import { captureLead } from "../lib/hubspot";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type Dim = { key?: string; name?: string; score?: number };
type Body = {
  firstname?: string;
  email?: string;
  company?: string;
  phone?: string;
  intent?: string;
  score?: number;
  band?: string;
  dims?: Dim[];
  priorities?: string[];
  answers?: number[];
  partner?: string;
  partnerName?: string;
  shareUrl?: string;
  sourceTag?: string;
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

  const firstname = (body.firstname || "").trim();
  const email = (body.email || "").trim();
  if (!firstname) return json({ error: "Enter your first name." }, 400);
  if (!emailRe.test(email)) return json({ error: "Enter a valid email." }, 400);

  const blocked = await guard(req, "ai-readiness");
  if (blocked) return blocked;

  const tag = (body.sourceTag || "AI Readiness").trim();
  const intent = body.intent === "book" ? "Book a call" : "Email roadmap";
  const partnerName = (body.partnerName || "").trim();
  const source = [tag, intent, partnerName && `Partner: ${partnerName}`].filter(Boolean).join(" · ");

  const summary = buildSummary(body);

  await Promise.all([
    captureLead({
      email,
      firstname,
      company: (body.company || "").trim(),
      website: "",
      source,
    }).catch((e) => console.warn("[readiness:lead]", (e as Error).message)),

    sendLeadEmail({
      url: "(AI Readiness — no URL audited)",
      email,
      phone: (body.phone || "").trim() || undefined,
      source,
      strategistText: summary,
    }).catch((e) => console.warn("[readiness:email]", (e as Error).message)),
  ]);

  return json({ ok: true });
}

function buildSummary(b: Body): string {
  const lines: string[] = [];
  lines.push(`Intent: ${b.intent === "book" ? "Book a commercial conversation" : "Email roadmap"}`);
  if (b.partnerName) lines.push(`Routed to partner: ${b.partnerName}`);
  if (b.company) lines.push(`Company: ${b.company}`);
  if (b.phone) lines.push(`Phone: ${b.phone}`);
  lines.push("");

  lines.push(`AI READINESS SCORE: ${b.score ?? "—"}/100 (${b.band || "—"})`);
  lines.push("");

  if (Array.isArray(b.dims) && b.dims.length) {
    lines.push("DIMENSIONS");
    for (const d of b.dims) lines.push(`  ${d.name ?? d.key}: ${d.score ?? 0}/100`);
    lines.push("");
  }

  if (Array.isArray(b.priorities) && b.priorities.length) {
    lines.push("START HERE (lowest-scoring, highest-leverage)");
    b.priorities.forEach((p, i) => lines.push(`  ${i + 1}. ${p}`));
    lines.push("");
  }

  if (b.shareUrl) lines.push(`Shareable result: ${b.shareUrl}`);
  return lines.join("\n");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
