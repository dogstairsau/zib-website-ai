import Anthropic from "@anthropic-ai/sdk";
import { guard } from "../lib/rateLimit";
import { sendQualifierEmail, type QualifierLead } from "../lib/email";
import { TEASER_SYSTEM_PROMPT, teaserUserPrompt } from "../lib/prompts/start";

export const config = { runtime: "edge" };

/**
 * Pre-discovery qualifier (/start). The front door to the audit system.
 *
 * Does two jobs on submit:
 *   1) Prospect-facing teaser — an indicative "size of the opportunity" read,
 *      grounded with Claude + web search. Fails open to a qualitative read so
 *      the prospect always sees something.
 *   2) Internal qualification — RAG status, opportunity + confidence scores and
 *      a recommended next action, emailed to the partner via Resend. No
 *      HubSpot for now; the partner gets the lead in their inbox.
 *
 * Thresholds are deliberately conservative and a human still makes the call —
 * nothing here auto-declines anyone.
 */

const MODEL = process.env.START_MODEL || "claude-sonnet-4-6";
const SEARCH_TOOL = process.env.START_SEARCH_TOOL || "web_search_20250305";
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Body = {
  business?: string; website?: string; name?: string; email?: string;
  phone?: string; locations?: string; industry?: string; keywords?: string;
  frustration?: string; extra?: string;
  goal?: string; channel?: string; urgency?: string;
  dealValue?: string; spend?: string; running?: string;
  partner?: string; partnerName?: string; prospectFor?: string;
  sourceTag?: string;
};

type Teaser = {
  volume: number;
  volumeNote: string;
  channelRead: string;
  nextSteps: string[];
  confidence: "low" | "medium" | "high";
};

// ─── Banded inputs → numeric signal (0-100) ─────────────────────────
const DEAL_SCORE: Record<string, number> = {
  lt500: 10, "500-2k": 35, "2k-10k": 60, "10k-50k": 85, gt50k: 100, unsure: 30,
};
const SPEND_SCORE: Record<string, number> = {
  "0": 10, lt1k: 30, "1-5k": 55, "5-20k": 80, gt20k: 100,
};
const URGENCY_SCORE: Record<string, number> = { asap: 100, "1-3m": 60, exploring: 20 };

const DEAL_LABEL: Record<string, string> = {
  lt500: "Under $500", "500-2k": "$500–$2k", "2k-10k": "$2k–$10k",
  "10k-50k": "$10k–$50k", gt50k: "$50k+", unsure: "Not sure",
};
const SPEND_LABEL: Record<string, string> = {
  "0": "$0 / not sure", lt1k: "Under $1k", "1-5k": "$1k–$5k",
  "5-20k": "$5k–$20k", gt20k: "$20k+",
};
const GOAL_LABEL: Record<string, string> = {
  leads: "More leads", sales: "More online sales", awareness: "More brand awareness", unsure: "Not sure yet",
};
const CHANNEL_LABEL: Record<string, string> = {
  "google-ads": "Google Ads", seo: "SEO", social: "Social", unsure: "Not sure",
};
const URGENCY_LABEL: Record<string, string> = {
  asap: "ASAP", "1-3m": "1–3 months", exploring: "Just exploring",
};

const clip = (s: string | undefined, n: number) => (s || "").trim().slice(0, n);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const business = clip(body.business, 120);
  const name = clip(body.name, 80);
  const email = clip(body.email, 160);
  if (!business) return json({ error: "Enter your business name." }, 400);
  if (!name) return json({ error: "Enter your name." }, 400);
  if (!emailRe.test(email)) return json({ error: "Enter a valid email." }, 400);

  const blocked = await guard(req, "start");
  if (blocked) return blocked;

  const lead: QualifierLead = {
    business,
    website: clip(body.website, 160),
    name,
    email,
    phone: clip(body.phone, 40),
    locations: clip(body.locations, 80),
    industry: clip(body.industry, 120),
    keywords: clip(body.keywords, 400),
    frustration: clip(body.frustration, 600),
    extra: clip(body.extra, 800),
    goal: GOAL_LABEL[body.goal || ""] || "—",
    channel: CHANNEL_LABEL[body.channel || ""] || "—",
    urgency: URGENCY_LABEL[body.urgency || ""] || "—",
    dealValue: DEAL_LABEL[body.dealValue || ""] || "—",
    spend: SPEND_LABEL[body.spend || ""] || "—",
    running: { yes: "Yes", no: "No", unsure: "Not sure" }[body.running || ""] || "—",
    partnerName: clip(body.partnerName, 80),
    prospectFor: clip(body.prospectFor, 60),
    sourceTag: clip(body.sourceTag, 60) || "Pre-discovery Qualifier",
  };

  // 1) Teaser — grounded, fails open to a qualitative read.
  const teaser = await buildTeaser(body).catch((e) => {
    console.warn("[start:teaser]", (e as Error).message);
    return null;
  });

  // 2) Qualification — rule-based, transparent, conservative.
  const qualification = qualify(body, teaser);

  // 3) Notify the partner via Resend (no HubSpot for now).
  await sendQualifierEmail({ lead, qualification, teaser }).catch((e) =>
    console.warn("[start:email]", (e as Error).message),
  );

  // Only the teaser ever goes back to the browser — qualification stays internal.
  return json({ ok: true, teaser });
}

// ─── Qualification logic (master brief §11.1) ───────────────────────
function qualify(b: Body, teaser: Teaser | null) {
  const deal = DEAL_SCORE[b.dealValue || ""] ?? 25;
  const spend = SPEND_SCORE[b.spend || ""] ?? 10;
  const urgency = URGENCY_SCORE[b.urgency || ""] ?? 20;

  // Volume signal from the teaser (log-scaled so a few hundred still counts).
  const vol = teaser && teaser.volume > 0 ? teaser.volume : 0;
  const volumeScore = vol > 0 ? Math.max(0, Math.min(100, Math.round((Math.log10(vol) / 5) * 100))) : 0;

  // Opportunity = size of the prize. Weighted toward deal value + spend.
  const opportunityScore = Math.round(
    deal * 0.35 + spend * 0.3 + urgency * 0.2 + volumeScore * 0.15,
  );

  // Confidence = how complete + clear their answers are.
  const goalClear = b.goal && b.goal !== "unsure";
  const channelClear = b.channel && b.channel !== "unsure";
  const filled = [
    b.website, b.locations, b.industry, b.keywords, b.frustration,
    b.dealValue, b.spend, b.running, b.goal, b.urgency,
  ].filter((x) => x && String(x).trim()).length;
  const completeness = Math.round((filled / 10) * 100);
  const confidence = Math.round(completeness * 0.6 + (goalClear ? 20 : 0) + (channelClear ? 20 : 0));

  // RAG + next action. Conservative — flag for a human, never hard-decline.
  let rag: "green" | "yellow" | "red";
  let nextAction: string;
  const lowFit = (b.dealValue === "lt500" || !b.dealValue) && b.spend === "0" && b.urgency === "exploring";
  if (lowFit || opportunityScore < 30) {
    rag = "red";
    nextAction = "Politely decline / nurture (human check first)";
  } else if (opportunityScore >= 62 && b.urgency !== "exploring" && b.dealValue !== "lt500") {
    rag = "green";
    nextAction = "Pursue & audit";
  } else {
    rag = "yellow";
    nextAction = "Clarify priorities first";
  }

  const reasons: string[] = [];
  reasons.push(`Deal value: ${DEAL_LABEL[b.dealValue || ""] || "—"}`);
  reasons.push(`Monthly spend: ${SPEND_LABEL[b.spend || ""] || "—"}`);
  reasons.push(`Urgency: ${URGENCY_LABEL[b.urgency || ""] || "—"}`);
  reasons.push(`Goal clarity: ${goalClear ? "clear" : "unclear"} · Channel fit: ${channelClear ? "stated" : "unsure"}`);
  if (vol > 0) reasons.push(`Indicative monthly demand: ~${vol.toLocaleString("en-AU")}`);
  reasons.push(`Engagement: completed the qualifier${completeness >= 70 ? " in full (warm signal)" : ""}`);

  return { rag, opportunityScore, confidence, nextAction, completeness, reasons };
}

// ─── Teaser generation (Claude + web search) ────────────────────────
async function buildTeaser(b: Body): Promise<Teaser | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const services = clip(b.keywords, 300) || clip(b.industry, 120);
  if (!services) return null;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const user = teaserUserPrompt({
    services,
    location: clip(b.locations, 60),
    channel: CHANNEL_LABEL[b.channel || ""] || "Not sure",
    industry: clip(b.industry, 120),
    goal: GOAL_LABEL[b.goal || ""] || "Not sure yet",
  });

  const tools = [{ type: SEARCH_TOOL, name: "web_search", max_uses: 4 }] as any;
  const messages: any[] = [{ role: "user", content: user }];

  let text = "";
  for (let i = 0; i < 5; i++) {
    const msg: any = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: TEASER_SYSTEM_PROMPT,
      tools,
      messages,
    } as any);
    text = (msg.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n")
      .trim();
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    break;
  }
  return parseTeaser(text);
}

function parseTeaser(text: string): Teaser | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: any;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  let volume = Number(obj.volume);
  if (!isFinite(volume) || volume < 0 || volume > 5_000_000) volume = 0;
  const steps = Array.isArray(obj.nextSteps)
    ? obj.nextSteps.filter((s: any) => typeof s === "string").map((s: string) => s.slice(0, 160)).slice(0, 3)
    : [];
  return {
    volume: Math.round(volume),
    volumeNote: typeof obj.volumeNote === "string" ? obj.volumeNote.slice(0, 160) : "",
    channelRead: typeof obj.channelRead === "string" ? obj.channelRead.slice(0, 320) : "",
    nextSteps: steps,
    confidence: ["low", "medium", "high"].includes(obj.confidence) ? obj.confidence : "medium",
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
