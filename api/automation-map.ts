import { sendLeadEmail } from "../lib/email";
import { captureLead } from "../lib/hubspot";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type Opp = { area?: string; task?: string; effort?: string; hours?: number; dollars?: number };
type Body = {
  firstname?: string;
  email?: string;
  company?: string;
  phone?: string;
  intent?: string;
  rate?: number;
  hoursPerWeek?: number;
  dollarsPerYear?: number;
  opportunities?: Opp[];
  startHere?: string[];
  partner?: string;
  partnerName?: string;
  shareUrl?: string;
  sourceTag?: string;
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-AU");

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

  const blocked = await guard(req, "automation-map");
  if (blocked) return blocked;

  const tag = (body.sourceTag || "Automation Map").trim();
  const intent = body.intent === "book" ? "Book a call" : "Email map";
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
    }).catch((e) => console.warn("[automap:lead]", (e as Error).message)),

    sendLeadEmail({
      url: "(Automation Map — no URL audited)",
      email,
      phone: (body.phone || "").trim() || undefined,
      source,
      strategistText: summary,
    }).catch((e) => console.warn("[automap:email]", (e as Error).message)),
  ]);

  return json({ ok: true });
}

function buildSummary(b: Body): string {
  const lines: string[] = [];
  lines.push(`Intent: ${b.intent === "book" ? "Book a commercial conversation" : "Email automation map"}`);
  if (b.partnerName) lines.push(`Routed to partner: ${b.partnerName}`);
  if (b.company) lines.push(`Company: ${b.company}`);
  if (b.phone) lines.push(`Phone: ${b.phone}`);
  lines.push("");

  lines.push(`HEADLINE — at $${Math.round(b.rate ?? 0)}/hr blended cost:`);
  lines.push(`  ~${(b.hoursPerWeek ?? 0).toFixed(1)} hrs/week reclaimed`);
  lines.push(`  ~${money(b.dollarsPerYear ?? 0)}/year of time cost freed up`);
  lines.push("");

  if (Array.isArray(b.startHere) && b.startHere.length) {
    lines.push("START HERE (highest value vs effort)");
    b.startHere.forEach((s, i) => lines.push(`  ${i + 1}. ${s}`));
    lines.push("");
  }

  if (Array.isArray(b.opportunities) && b.opportunities.length) {
    lines.push("FULL MAP (ranked by annual value)");
    for (const o of b.opportunities) {
      lines.push(`  • [${o.area}] ${o.task} — ${money(o.dollars ?? 0)}/yr · ${(o.hours ?? 0).toFixed(1)} hrs/wk · ${o.effort}`);
    }
    lines.push("");
  }

  if (b.shareUrl) lines.push(`Shareable map: ${b.shareUrl}`);
  return lines.join("\n");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
