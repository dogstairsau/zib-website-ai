import Anthropic from "@anthropic-ai/sdk";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

/**
 * Industry benchmark lookup for the AI Growth Simulator.
 *
 * Given an industry + region, uses Claude with web search to fetch current,
 * credible benchmark figures (conversion rate, deal value, best-practice lead
 * response time), then caches the result per industry+region so every prospect
 * who picks the same combination sees the SAME numbers — consistency matters
 * for a credibility tool — and we only pay for the lookup once per combo.
 *
 * Fails open at every step: if the key, KV, model or parsing is unavailable it
 * returns { ok: false } and the client silently keeps its built-in placeholder
 * benchmark. It never throws the tool a hard error.
 */

type Body = { industry?: string; region?: string };
type Benchmark = { conv: number; deal: number; responseMins: number; note: string; confidence?: string };

const MODEL = process.env.BENCH_MODEL || "claude-sonnet-4-6";
// Stable web-search tool version; overridable if the account is on a newer one.
const SEARCH_TOOL = process.env.BENCH_SEARCH_TOOL || "web_search_20250305";
const CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
const CACHE_VERSION = "v1";

// Allow-list so a caller can't make us search arbitrary attacker-chosen text.
const INDUSTRIES = new Set([
  "accounting", "legal", "trades", "realestate", "health",
  "hospitality", "ecommerce", "proservices", "homeservices", "other",
]);
const INDUSTRY_LABEL: Record<string, string> = {
  accounting: "accounting / bookkeeping firms",
  legal: "legal services firms",
  trades: "trades & construction businesses",
  realestate: "real estate agencies",
  health: "health & allied-health clinics",
  hospitality: "hospitality venues",
  ecommerce: "ecommerce / online retail stores",
  proservices: "professional services firms",
  homeservices: "home-services businesses",
  other: "small-to-medium businesses",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const industry = (body.industry || "").trim().toLowerCase();
  const region = (body.region || "").trim().slice(0, 40);
  if (!INDUSTRIES.has(industry) || !region) {
    return json({ ok: false, error: "Unknown industry or region" }, 200);
  }

  // Rate-limit abusive bursts (fails open if KV isn't configured).
  const blocked = await guard(req, "growth-benchmarks");
  if (blocked) return blocked;

  const cacheKey = `bench:${CACHE_VERSION}:${industry}:${region.toLowerCase()}`;

  // 1) Serve from cache when we have it.
  const cached = await kvGet(cacheKey);
  if (cached) return json({ ok: true, benchmark: cached, cached: true });

  // 2) No key → fail open, client keeps its placeholder.
  if (!process.env.ANTHROPIC_API_KEY) return json({ ok: false, error: "not configured" }, 200);

  // 3) Live lookup.
  const benchmark = await lookup(industry, region).catch((e) => {
    console.warn("[bench:lookup]", (e as Error).message);
    return null;
  });
  if (!benchmark) return json({ ok: false, error: "lookup failed" }, 200);

  await kvSet(cacheKey, benchmark, CACHE_TTL);
  return json({ ok: true, benchmark, cached: false });
}

async function lookup(industry: string, region: string): Promise<Benchmark | null> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const label = INDUSTRY_LABEL[industry] || INDUSTRY_LABEL.other;

  const system =
    "You are a marketing-analytics research analyst for an Australian digital agency. " +
    "Use web search to find current, credible benchmark figures, preferring Australian " +
    "and region-specific sources. Be conservative and realistic — never inflate numbers. " +
    "Respond with ONLY a single minified JSON object, no prose, no markdown fences.";

  const user =
    `Find typical benchmarks for ${label} in ${region}, Australia. Return JSON with:\n` +
    `{"conv": <average enquiry/lead-to-customer conversion rate as a percentage, e.g. 8>,` +
    `"deal": <average deal or transaction value in AUD>,` +
    `"responseMins": <best-practice lead response time in minutes>,` +
    `"note": "<one short sentence (<140 chars) citing the basis>",` +
    `"confidence": "low|medium|high"}\n` +
    `Use realistic ranges. conv is 0.1–60, deal is 10–1000000, responseMins is 1–1440.`;

  // Server-side web search runs in a loop; handle pause_turn up to a few times.
  // Tool/params cast to any to stay compatible with the pinned SDK types.
  const tools = [{ type: SEARCH_TOOL, name: "web_search", max_uses: 4 }] as any;
  const messages: any[] = [{ role: "user", content: user }];

  let text = "";
  for (let i = 0; i < 5; i++) {
    const msg: any = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system,
      tools,
      messages,
    } as any);
    text = (msg.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n")
      .trim();
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    break;
  }

  return parseBenchmark(text);
}

function parseBenchmark(text: string): Benchmark | null {
  if (!text) return null;
  // Tolerant extraction: strip fences, grab the first {...} block.
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: any;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const conv = Number(obj.conv);
  const deal = Number(obj.deal);
  const responseMins = Number(obj.responseMins);
  if (!isFinite(conv) || conv < 0.1 || conv > 60) return null;
  if (!isFinite(deal) || deal < 10 || deal > 1_000_000) return null;
  if (!isFinite(responseMins) || responseMins < 1 || responseMins > 1440) return null;
  return {
    conv: Math.round(conv * 10) / 10,
    deal: Math.round(deal),
    responseMins: Math.round(responseMins),
    note: typeof obj.note === "string" ? obj.note.slice(0, 160) : "",
    confidence: ["low", "medium", "high"].includes(obj.confidence) ? obj.confidence : "medium",
  };
}

// ─── KV (Upstash / Vercel KV REST) — same store as the rate limiter ──
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kvGet(key: string): Promise<Benchmark | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: string | null };
    return j.result ? (JSON.parse(j.result) as Benchmark) : null;
  } catch {
    return null;
  }
}

async function kvSet(key: string, val: Benchmark, ttlSeconds: number): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "text/plain" },
      body: JSON.stringify(val),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    /* fail open — uncached is fine */
  }
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
