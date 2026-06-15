import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, normaliseUrl, isValidEmail, type SiteContent } from "../lib/site";
import { isSafeFetchUrl, safeFetch } from "../lib/safeUrl";
import { runPsi, type PsiResult } from "../lib/psi";
import { auditSocials, type SocialAudit } from "../lib/brand/socials";
import { fetchTrends, brandTermFromUrl, type TrendSeries } from "../lib/brand/trends";
import { fetchNews } from "../lib/brand/news";
import { fetchReddit } from "../lib/brand/reddit";
import { computeBrandScore, type TargetSignals, type LlmVisibilitySignal } from "../lib/brand/score";
import {
  CLARITY_SYSTEM_PROMPT,
  clarityUserPrompt,
  LLM_VISIBILITY_SYSTEM_PROMPT,
  llmVisibilityUserPrompt,
  BRAND_READ_SYSTEM_PROMPT,
  brandReadUserPrompt,
  LEVER_SYSTEM_PROMPT,
  leverUserPrompt,
  BRAND_DISCOVERY_SYSTEM_PROMPT,
  brandDiscoveryUserPrompt,
} from "../lib/prompts/brand";
import { captureLead } from "../lib/hubspot";
import { sendLeadEmail } from "../lib/email";
import { checkRateLimit, rateLimitResponse } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type Body = {
  url?: string;
  email?: string;
  firstname?: string;
  company?: string;
  phone?: string;
  socials?: string[];
  competitors?: string[];
  sourceTag?: string;
};

type Clarity = { clarity: number; promise?: string; for_whom?: string; weakness?: string };
type Horizons = { week: string; month: string; year: string };

// Parse a strict-JSON Claude reply, tolerating accidental ```json fences.
function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim()) as T;
  } catch {
    return null;
  }
}

// Fetch just enough of a competitor's HTML to detect social profiles.
async function fetchHtml(url: string): Promise<string> {
  if (!isSafeFetchUrl(url).ok) return "";
  try {
    const res = await safeFetch(url, {
      headers: { "User-Agent": "ZibBrandScore/1.0 (+https://zibdigital.com.au/brand-score)" },
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return "";
    return await res.text();
  } catch {
    return "";
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const url = normaliseUrl(body.url || "");
  const email = (body.email || "").trim();
  if (!url) return json({ error: "Enter a valid website URL." }, 400);
  if (!isSafeFetchUrl(url).ok) return json({ error: "That URL can't be scored." }, 400);
  if (!isValidEmail(email)) return json({ error: "Enter a valid work email." }, 400);
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }, 500);
  }

  const socials = (body.socials || []).map((s) => String(s).trim()).filter(Boolean).slice(0, 7);
  const competitorUrls = (body.competitors || [])
    .map((c) => normaliseUrl(String(c)))
    .filter((u): u is string => !!u && isSafeFetchUrl(u).ok)
    .slice(0, 3);

  const rl = await checkRateLimit(req, "brand", 3, 600);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // ── 1. Read the site ──
        send("status", { phase: "fetch", message: "Reading your site…" });
        const site = await fetchSiteContent(url);

        // ── 2. Fire every signal in parallel ──
        send("status", { phase: "signals", message: "Pulling signals · PageSpeed, search trends, socials…" });

        const yourBrand = brandTermFromUrl(url);
        const compBrandTerms = competitorUrls.map((u) => brandTermFromUrl(u));
        const trendTerms = [yourBrand, ...compBrandTerms].filter(Boolean);

        // Search-friendly business name for reviews / news / reddit: the lead
        // of the page title (before any separator), falling back to the domain.
        const businessName = (() => {
          const lead = (site.title || "").split(/\s*[|\-–—·:]\s*/)[0].trim();
          return lead.length >= 3 && lead.length <= 60 ? lead : yourBrand;
        })();

        const psiPromise = runPsi(url).catch((e) => {
          console.warn("[psi]", e?.message);
          return null;
        });
        const socialPromise = auditSocials(site.rawHtml, socials).catch((e) => {
          console.warn("[social]", e?.message);
          return null;
        });
        const trendsPromise = trendTerms.length
          ? fetchTrends(trendTerms, "AU").catch((e) => {
              console.warn("[trends]", e?.message);
              return [] as TrendSeries[];
            })
          : Promise.resolve([] as TrendSeries[]);

        const clarityPromise = anthropic.messages
          .create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            system: CLARITY_SYSTEM_PROMPT,
            messages: [{ role: "user", content: clarityUserPrompt(site) }],
          })
          .then((m) => (m.content[0]?.type === "text" ? parseJson<Clarity>(m.content[0].text) : null))
          .catch((e) => {
            console.warn("[clarity]", e?.message);
            return null;
          });

        // Reputation signals — main target only. Each fails closed to null.
        const newsPromise = fetchNews(businessName).catch(() => null);
        const redditPromise = fetchReddit(businessName).catch(() => null);

        // AI visibility depends on the clarity read (category/promise), so it
        // chains off that promise but still runs concurrently with everything else.
        const llmVisPromise: Promise<LlmVisibilitySignal | null> = clarityPromise.then(async (c) => {
          try {
            const m = await anthropic.messages.create({
              model: "claude-haiku-4-5-20251001",
              max_tokens: 200,
              system: LLM_VISIBILITY_SYSTEM_PROMPT,
              messages: [
                {
                  role: "user",
                  content: llmVisibilityUserPrompt({ url, brand: businessName, promise: c?.promise, forWhom: c?.for_whom }),
                },
              ],
            });
            const parsed = m.content[0]?.type === "text"
              ? parseJson<{ visibility: string; category?: string; reason?: string }>(m.content[0].text)
              : null;
            if (!parsed) return null;
            const map: Record<string, number> = { yes: 88, maybe: 55, no: 22 };
            return { available: true, score: map[parsed.visibility] ?? 50, label: parsed.visibility };
          } catch (e: any) {
            console.warn("[llm-visibility]", e?.message);
            return null;
          }
        });

        // Competitor signals: light HTML (for socials) + PSI, in parallel.
        const compSignalPromises = competitorUrls.map(async (cu) => {
          const [html, psi] = await Promise.all([
            fetchHtml(cu),
            runPsi(cu).catch(() => null),
          ]);
          const social = html ? await auditSocials(html).catch(() => null) : null;
          return { url: cu, psi, social };
        });

        const [psi, social, trends, clarity, compSignals, news, reddit, llmVisibility] = await Promise.all([
          psiPromise,
          socialPromise,
          trendsPromise,
          clarityPromise,
          Promise.all(compSignalPromises),
          newsPromise,
          redditPromise,
          llmVisPromise,
        ]);

        // Map trend series back to each brand term.
        const trendFor = (term: string): TrendSeries | null =>
          (term && trends.find((t) => t.term === term && t.available)) || null;

        // Tell the UI which signals actually came back.
        send("signals", {
          psi: !!psi,
          social: !!social,
          trends: trends.some((t) => t.available),
          clarity: !!clarity,
          news: !!news?.available,
          reddit: !!reddit?.available,
          llmVisibility: !!llmVisibility?.available,
          competitors: compSignals.filter((c) => c.psi || c.social).length,
        });

        // ── 3. Deterministic score ──
        send("status", { phase: "score", message: "Scoring six pillars…" });

        const you: TargetSignals = {
          url,
          label: yourBrand || new URL(url).hostname,
          psi: psi as PsiResult | null,
          social: social as SocialAudit | null,
          brandTrend: trendFor(yourBrand),
          site: { title: site.title, description: site.description, h1: site.h1, h2s: site.h2s },
          clarityScore: clarity ? clarity.clarity : null,
          news,
          reddit,
          llmVisibility,
        };

        const competitors: TargetSignals[] = compSignals.map((c, i) => ({
          url: c.url,
          label: compBrandTerms[i] || new URL(c.url).hostname,
          psi: c.psi,
          social: c.social,
          brandTrend: trendFor(compBrandTerms[i]),
          site: null,
          clarityScore: null,
        }));

        const result = computeBrandScore(you, competitors);
        send("score", { ...result, clarity });

        // ── 4. Strategist read (streamed) ──
        send("status", { phase: "read", message: "Senior strategist read…" });
        let readText = "";
        const readStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          system: BRAND_READ_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: brandReadUserPrompt({
                url,
                brandScore: result.brandScore,
                pillars: result.pillars,
                velocity: result.velocity,
                capture: result.capture,
                posture: result.posture,
                lever: result.lever,
                competitors: result.competitors,
                clarity,
                site: { title: site.title, h1: site.h1, bodyText: site.bodyText },
              }),
            },
          ],
        });
        for await (const ev of readStream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            readText += ev.delta.text;
            send("chunk", { text: ev.delta.text });
          }
        }

        // ── 5. The lever, broken into week / month / year ──
        send("status", { phase: "lever", message: "Mapping the lever to pull…" });
        const leverMsg = await anthropic.messages
          .create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 300,
            system: LEVER_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: leverUserPrompt({
                  url,
                  lever: result.lever,
                  brandScore: result.brandScore,
                  site: { h1: site.h1, bodyText: site.bodyText },
                }),
              },
            ],
          })
          .catch((e) => {
            console.warn("[lever]", e?.message);
            return null;
          });
        const horizons = leverMsg?.content[0]?.type === "text" ? parseJson<Horizons>(leverMsg.content[0].text) : null;
        if (horizons) send("lever", horizons);

        // ── 6. Lead capture (internal opener + email + HubSpot/Slack) ──
        const weakest = [...result.pillars].filter((p) => p.available).sort((a, b) => a.score - b.score)[0];
        let discoveryQuestion = "";
        try {
          const dq = await anthropic.messages.create({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 160,
            system: BRAND_DISCOVERY_SYSTEM_PROMPT,
            messages: [
              {
                role: "user",
                content: brandDiscoveryUserPrompt({
                  url,
                  brandScore: result.brandScore,
                  lever: result.lever,
                  weakestPillar: weakest?.label || result.lever.label,
                  posture: result.posture.headline,
                  competitors: result.competitors,
                }),
              },
            ],
          });
          const t = dq.content[0]?.type === "text" ? dq.content[0].text : "";
          discoveryQuestion = t.trim().replace(/^["'`\s]+|["'`\s]+$/g, "");
        } catch (e: any) {
          console.warn("[brand-discovery]", e?.message);
        }

        const sourceTag = (body.sourceTag || "").trim();
        const source = sourceTag ? `Brand Score · ${sourceTag}` : "Brand Score";

        await Promise.all([
          captureLead(
            { email, firstname: body.firstname?.trim() || "", company: body.company?.trim() || "", website: url, source },
            { url, strategistText: readText, overallScore: result.brandScore },
          ).catch((e) => console.warn("[lead]", e?.message)),

          sendLeadEmail({
            url,
            email,
            phone: (body.phone || "").trim() || undefined,
            source,
            strategistText: readText,
            discoveryQuestion: discoveryQuestion || undefined,
            audit: {
              overallScore: result.brandScore,
              categories: result.pillars.map((p) => ({ label: p.label, score: p.score })),
            },
          }).catch((e) => console.warn("[email]", e?.message)),
        ]);

        send("done", { url, brandScore: result.brandScore });
      } catch (err: any) {
        send("error", { message: err?.message || "Brand Score failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}
