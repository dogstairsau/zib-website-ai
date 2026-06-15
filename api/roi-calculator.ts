import { sendLeadEmail } from "../lib/email";
import { captureLead } from "../lib/hubspot";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type Product = { sale?: number; margin?: number; pct?: number };
type Body = {
  firstname?: string;
  email?: string;
  channel?: string;
  channelLabel?: string;
  products?: Product[];
  avgSale?: number;
  avgMargin?: number;
  inputs?: Record<string, number>;
  results?: {
    totalInv?: number;
    revenue?: number;
    profit?: number;
    roi?: number;
    sales?: number;
    leads?: number;
    reach?: number;
    traffic?: number;
    extras?: Record<string, number>;
  };
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

  const blocked = await guard(req, "roi-calculator");
  if (blocked) return blocked;

  const channelLabel = (body.channelLabel || body.channel || "Unknown channel").trim();
  const tag = (body.sourceTag || "ROI Calculator").trim();
  const source = `${tag} · ${channelLabel}`;

  // Build the strategist-text payload — reuses the audit email template, but
  // packs the projection into a single readable block so the recipient sees
  // every input and every result without us needing a separate email template.
  const summary = buildProjectionSummary(body);

  // Fire both — captureLead is HubSpot+Slack, sendLeadEmail is Resend.
  // Awaited so the edge worker doesn't terminate before delivery.
  await Promise.all([
    captureLead({
      email,
      firstname,
      company: "",
      website: "",
      source,
    }).catch((e) => console.warn("[roi:lead]", (e as Error).message)),

    sendLeadEmail({
      url: "(ROI Calculator — no URL audited)",
      email,
      source,
      strategistText: summary,
    }).catch((e) => console.warn("[roi:email]", (e as Error).message)),
  ]);

  return json({ ok: true });
}

function buildProjectionSummary(b: Body): string {
  const lines: string[] = [];
  lines.push(`Channel: ${b.channelLabel || b.channel || "Unknown"}`);
  lines.push("");

  // Products / services
  lines.push("PRODUCTS & SERVICES");
  if (Array.isArray(b.products)) {
    b.products.forEach((p, i) => {
      if (!p) return;
      const hasAny = (p.sale || 0) > 0 || (p.margin || 0) > 0 || (p.pct || 0) > 0;
      if (!hasAny) return;
      lines.push(`  Product/service ${i + 1}: $${(p.sale || 0).toLocaleString("en-AU")} avg sale · ${p.margin ?? "—"}% margin · ${p.pct ?? "—"}% of sales`);
    });
  }
  if (b.avgSale) lines.push(`  Weighted avg sale: $${b.avgSale.toLocaleString("en-AU", { maximumFractionDigits: 2 })}`);
  if (b.avgMargin) lines.push(`  Weighted avg margin: ${b.avgMargin.toFixed(1)}%`);
  lines.push("");

  // Campaign inputs
  lines.push("CAMPAIGN INPUTS");
  if (b.inputs) {
    for (const [k, v] of Object.entries(b.inputs)) {
      lines.push(`  ${labelForInput(k)}: ${formatInput(k, v)}`);
    }
  }
  lines.push("");

  // Projected results
  const r = b.results || {};
  lines.push("PROJECTED MONTHLY RESULTS");
  if (r.totalInv != null) lines.push(`  Total investment: $${Math.round(r.totalInv).toLocaleString("en-AU")}`);
  if (r.traffic != null) lines.push(`  Traffic: ${Math.round(r.traffic).toLocaleString("en-AU")}`);
  if (r.reach != null) lines.push(`  Monthly reach: ${Math.round(r.reach).toLocaleString("en-AU")}`);
  if (r.leads != null) lines.push(`  Leads: ${Math.round(r.leads).toLocaleString("en-AU")}`);
  if (r.sales != null) lines.push(`  Sales: ${r.sales.toLocaleString("en-AU", { maximumFractionDigits: 1 })}`);
  if (r.revenue != null) lines.push(`  Sales revenue: $${Math.round(r.revenue).toLocaleString("en-AU")}`);
  if (r.profit != null) lines.push(`  Gross profit: $${Math.round(r.profit).toLocaleString("en-AU")}`);
  if (r.roi != null) lines.push(`  ROI (profit − investment): $${Math.round(r.roi).toLocaleString("en-AU")}`);
  if (r.extras) {
    for (const [k, v] of Object.entries(r.extras)) {
      const isMoney = /cost|cpl|cps/i.test(k);
      lines.push(`  ${k}: ${isMoney ? "$" + v.toLocaleString("en-AU", { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("en-AU")}`);
    }
  }

  return lines.join("\n");
}

function labelForInput(k: string): string {
  const map: Record<string, string> = {
    managementFee: "Management fee",
    adSpend: "Ad spend",
    traffic: "Traffic",
    webConv: "Website conversion rate",
    saleConv: "Sale conversion",
    cpc: "Cost per click",
    cpm: "Cost per CPM",
    reachToLead: "Reach to lead %",
    reachToSale: "Reach to sale %",
  };
  return map[k] || k;
}

function formatInput(k: string, v: number): string {
  if (/(Fee|Spend|cpc|cpm)/i.test(k)) return "$" + v.toLocaleString("en-AU");
  if (/(Conv|reach.*To|pct)/i.test(k)) return v + "%";
  return String(v);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
