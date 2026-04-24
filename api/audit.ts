import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, formatForPrompt, normaliseUrl, isValidEmail, type SiteContent } from "../lib/site";
import { captureLead } from "../lib/hubspot";
import { AUDIT_SYSTEM_PROMPT, auditUserPrompt } from "../lib/prompts/audit";
import { fetchSupporting, crawlSite, buildAudit } from "../lib/seoChecks";

export const config = { runtime: "edge" };

type Body = {
  url?: string;
  email?: string;
  firstname?: string;
  company?: string;
  phone?: string;
  mode?: string;
};

type Brief = {
  headline?: string;
  subhead?: string;
  art_direction?: string;
};

// ──────────────────────────────────────────────────────────────────
// Image brief — Claude drafts headline + art direction for the ad
// ──────────────────────────────────────────────────────────────────
async function generateImageBrief(site: SiteContent, anthropic: Anthropic): Promise<Brief | null> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: `You are an art director at Zib Digital generating a single Instagram ad mockup based on a prospect's website. Output ONLY valid JSON in this exact shape. No markdown fences, no commentary:

{
  "headline": "3 to 6 word punchy ad copy. Pulls from the brand's strongest value prop. Title Case.",
  "subhead": "8 to 14 word supporting line. Creates curiosity, urgency, or names a specific outcome. Sentence case.",
  "art_direction": "One sentence describing the visual scene/composition that fits this brand's category. Be concrete about what's literally in the photo. Avoid abstract words like 'modern' or 'premium'."
}

Voice rules:
- Confident, commercial. No agency jargon. Banned: "unlock", "elevate", "leverage", "synergy".
- Australian English where applicable (optimisation, colour).
- Match the brand's tone. Luxury brands get aspirational, B2B brands get direct.
- NEVER use em-dashes. Use commas, periods, or colons instead.
- The headline should make a stranger stop scrolling. The subhead should make them tap.`,
    messages: [
      {
        role: "user",
        content: `Generate the ad brief for this brand:

URL: ${site.url}
Title: ${site.title}
Description: ${site.description}
H1: ${site.h1}
H2s: ${site.h2s.slice(0, 6).join(" | ")}
Body excerpt: ${site.bodyText.slice(0, 1800)}

Return only the JSON object.`,
      },
    ],
  });

  const text = message.content?.[0]?.type === "text" ? message.content[0].text : "";
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.warn("[brief] failed to parse JSON");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Image generation — OpenAI (default: gpt-image-2)
// ──────────────────────────────────────────────────────────────────
async function generateImage(
  site: SiteContent,
  brief: Brief | null,
): Promise<{ url: string; prompt: string; source: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("[image] skipped — OPENAI_API_KEY not set");
    return null;
  }

  const brand = site.title.split(/[|—–\-]/)[0].trim() || new URL(site.url).hostname;
  const artDir = brief?.art_direction?.trim();

  const prompt = [
    `Premium editorial photograph for ${brand}.`,
    artDir || `Magazine-quality lifestyle scene. Soft natural lighting, confident composition, plenty of negative space.`,
    `Format: vertical 9:16, Instagram Story aspect ratio.`,
    `Style: editorial, magazine-quality, restrained. NOT stock-photo. NO TEXT, NO LOGOS, NO TYPOGRAPHY of any kind. Pure photographic composition.`,
  ].join("\n\n");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1536";
  const quality = process.env.OPENAI_IMAGE_QUALITY || "medium";

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt, size, quality, n: 1 }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI ${res.status}`);
  }

  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return { url: `data:image/png;base64,${b64}`, prompt, source: `openai/${model}` };
}

// ──────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const url = normaliseUrl(body.url || "");
  const email = (body.email || "").trim();
  const mode = (body.mode || "").trim(); // "seo" → skip image generation
  if (!url) return json({ error: "Enter a valid website URL." }, 400);
  if (!isValidEmail(email)) return json({ error: "Enter a valid work email." }, 400);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }, 500);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        send("status", { phase: "fetch", message: "Reading the site…" });
        const site = await fetchSiteContent(url);

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // Kick off supporting fetches + (unless mode=seo) image brief in parallel.
        send("status", { phase: "discover", message: "Discovering pages · robots.txt + sitemap…" });
        const supportingPromise = fetchSupporting(url).catch((e) => {
          console.warn("[supporting]", e.message);
          return {
            robotsStatus: 0, robotsText: "",
            sitemapDiscovered: false, sitemapStatus: 0, sitemapUrl: `${new URL(url).origin}/sitemap.xml`,
            mainStatus: 200, redirected: false, redirectHops: 0,
            finalUrl: url,
          };
        });
        const briefPromise = mode === "seo"
          ? Promise.resolve(null)
          : generateImageBrief(site, anthropic).catch((e) => {
              console.warn("[brief]", e.message);
              return null;
            });

        // Deterministic checks — runs in parallel with the strategist read below.
        const checksPromise = (async () => {
          try {
            const support = await supportingPromise;
            send("status", { phase: "crawl", message: "Crawling up to 10 pages…" });
            const pages = await crawlSite(site.url, site.rawHtml, support, 10).catch((e) => {
              console.warn("[crawl]", e?.message);
              return [{ url: site.url, status: 200, html: site.rawHtml }];
            });
            send("crawl-progress", { done: pages.length, total: Math.max(pages.length, 10) });
            send("status", { phase: "score", message: "Scoring 7 categories · 25 checks…" });
            const audit = buildAudit({ url: site.url, pages, support });
            console.log("[checks]", { overall: audit.overallScore, passed: audit.passed, issues: audit.issues, pagesCrawled: audit.pagesCrawled });
            send("checks", audit);
          } catch (e: any) {
            console.warn("[checks] ERROR", e?.message, e?.stack);
          }
        })();

        send("status", { phase: "think", message: "Senior strategist read…" });

        const messageStream = anthropic.messages.stream({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          system: AUDIT_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: auditUserPrompt(url, formatForPrompt(site)),
            },
          ],
        });

        for await (const event of messageStream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            send("chunk", { text: event.delta.text });
          }
        }

        if (mode !== "seo") {
          // Image generation last (slowest, happens after text is fully rendered)
          send("status", { phase: "image", message: "Generating sample creative…" });
          const brief = await briefPromise;
          const image = await generateImage(site, brief).catch((e) => {
            const msg = e?.message || String(e);
            console.warn("[image]", msg);
            send("image-error", { message: msg });
            return null;
          });
          if (image) send("image", image);
        }

        // Make sure the deterministic checks SSE event was flushed before closing
        await checksPromise;

        // Capture lead AFTER analysis completes (failures don't block UX)
        captureLead({
          email,
          firstname: body.firstname?.trim() || "",
          company: body.company?.trim() || "",
          website: url,
          source: mode === "seo" ? "SEO page audit" : "Homepage audit",
        }).catch((e) => console.warn("[lead]", e.message));

        send("done", { url: site.url });
      } catch (err: any) {
        send("error", { message: err?.message || "Audit failed." });
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
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
