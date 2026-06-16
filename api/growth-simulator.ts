import { sendLeadEmail } from "../lib/email";
import { captureLead } from "../lib/hubspot";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type Inputs = {
  leads?: number;
  conv?: number;
  deal?: number;
  cost?: number;
  aiLeads?: number;
  aiConv?: number;
  aiCost?: number;
  aiHours?: number;
  aiSpend?: number;
  aiSetup?: number;
  hourRate?: number;
};

type Results = {
  curRevenue?: number;
  curProfit?: number;
  curCustomers?: number;
  optRevenue?: number;
  optProfit?: number;
  optCustomers?: number;
  profitUplift?: number;
  annualNet?: number;
  roi?: number | null;
  payback?: number | null;
  hoursYear?: number;
  timeValue?: number;
};

type Body = {
  firstname?: string;
  email?: string;
  company?: string;
  phone?: string;
  intent?: string;
  inputs?: Inputs;
  results?: Results;
  shareUrl?: string;
  partner?: string;
  partnerName?: string;
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

  const blocked = await guard(req, "growth-simulator");
  if (blocked) return blocked;

  const tag = (body.sourceTag || "AI Growth Simulator").trim();
  const intent = body.intent === "book" ? "Book a call" : "Email scenario";
  const partnerName = (body.partnerName || "").trim();
  const source = [tag, intent, partnerName && `Partner: ${partnerName}`]
    .filter(Boolean)
    .join(" · ");

  const summary = buildScenarioSummary(body);

  // Fire both — captureLead is HubSpot+Slack, sendLeadEmail is Resend.
  // Awaited so the edge worker doesn't terminate before delivery.
  await Promise.all([
    captureLead({
      email,
      firstname,
      company: (body.company || "").trim(),
      website: "",
      source,
    }).catch((e) => console.warn("[growth:lead]", (e as Error).message)),

    sendLeadEmail({
      url: "(AI Growth Simulator — no URL audited)",
      email,
      phone: (body.phone || "").trim() || undefined,
      source,
      strategistText: summary,
    }).catch((e) => console.warn("[growth:email]", (e as Error).message)),
  ]);

  return json({ ok: true });
}

function buildScenarioSummary(b: Body): string {
  const i = b.inputs || {};
  const r = b.results || {};
  const lines: string[] = [];

  lines.push(`Intent: ${b.intent === "book" ? "Book a commercial conversation" : "Email scenario"}`);
  if (b.partnerName) lines.push(`Routed to partner: ${b.partnerName}`);
  if (b.company) lines.push(`Company: ${b.company}`);
  if (b.phone) lines.push(`Phone: ${b.phone}`);
  lines.push("");

  lines.push("BUSINESS TODAY");
  lines.push(`  Monthly leads: ${num(i.leads)}`);
  lines.push(`  Conversion rate: ${num(i.conv)}%`);
  lines.push(`  Average deal value: $${num(i.deal)}`);
  lines.push(`  Monthly costs to deliver: $${num(i.cost)}`);
  lines.push("");

  lines.push("AI EFFICIENCY GAINS");
  lines.push(`  More leads: +${num(i.aiLeads)}%`);
  lines.push(`  Better conversion: +${num(i.aiConv)}%`);
  lines.push(`  Costs reduced: -${num(i.aiCost)}%`);
  lines.push(`  Time saved: ${num(i.aiHours)} hrs/mo`);
  lines.push("");

  lines.push("AI INVESTMENT");
  lines.push(`  Monthly AI cost: $${num(i.aiSpend)}`);
  lines.push(`  One-time setup: $${num(i.aiSetup)}`);
  lines.push(`  Value of an hour: $${num(i.hourRate)}`);
  lines.push("");

  lines.push("PROJECTED RESULTS (current → AI-optimised)");
  lines.push(`  Monthly revenue: $${money(r.curRevenue)} → $${money(r.optRevenue)}`);
  lines.push(`  Monthly profit: $${money(r.curProfit)} → $${money(r.optProfit)}`);
  lines.push(`  Customers/month: ${dec(r.curCustomers)} → ${dec(r.optCustomers)}`);
  lines.push("");

  lines.push("HEADLINE");
  lines.push(`  Monthly profit uplift: $${money(r.profitUplift)}`);
  lines.push(`  Extra annual profit (net of setup): $${money(r.annualNet)}`);
  lines.push(`  Year-1 ROI on AI: ${r.roi == null ? "n/a" : Math.round(r.roi) + "%"}`);
  lines.push(`  Payback period: ${r.payback == null ? "no payback" : r.payback.toFixed(1) + " months"}`);
  lines.push(`  Hours reclaimed/year: ${num(r.hoursYear)} (≈ $${money(r.timeValue)} of capacity)`);

  if (b.shareUrl) {
    lines.push("");
    lines.push(`Shareable scenario: ${b.shareUrl}`);
  }

  return lines.join("\n");
}

function num(n?: number): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("en-AU", { maximumFractionDigits: 2 });
}
function money(n?: number): string {
  if (n == null || isNaN(n)) return "0";
  return Math.round(n).toLocaleString("en-AU");
}
function dec(n?: number): string {
  if (n == null || isNaN(n)) return "0";
  return n.toLocaleString("en-AU", { maximumFractionDigits: 1 });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
