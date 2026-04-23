import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, formatForPrompt, normaliseUrl, isValidEmail, type SiteContent } from "../lib/site";
import { runPsi } from "../lib/psi";
import { captureLead } from "../lib/hubspot";
import { AUDIT_SYSTEM_PROMPT, auditUserPrompt } from "../lib/prompts/audit";

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
// Social link extraction (runs off the raw HTML fetched by lib/site)
// ──────────────────────────────────────────────────────────────────
async function extractSocialLinks(url: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "ZibAudit/1.0", Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return {};
    const html = await res.text();
    const patterns: Record<string, RegExp> = {
      instagram: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._-]+)/gi,
      facebook: /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9.-]+)/gi,
      linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in|school)\/([a-zA-Z0-9.-]+)/gi,
      tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/gi,
      twitter: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/gi,
      youtube: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@|user\/)([a-zA-Z0-9._-]+)/gi,
    };
    const noise = /\/(sharer|share|intent|dialog|popup|plugins|tr)\b/i;
    const found: Record<string, string> = {};
    for (const [platform, pattern] of Object.entries(patterns)) {
      const matches = [...html.matchAll(pattern)].map((m) => m[0]).filter((u) => !noise.test(u));
      const unique = [...new Set(matches)];
      if (unique.length) found[platform] = unique[0];
    }
    return found;
  } catch {
    return {};
  }
}

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
// Social strategist read — streams as a second block
// ──────────────────────────────────────────────────────────────────
async function generateSocialRead(
  site: SiteContent,
  socialLinks: Record<string, string>,
  anthropic: Anthropic,
  onChunk: (text: string) => void,
): Promise<void> {
  const linkSummary = Object.keys(socialLinks).length
    ? Object.entries(socialLinks).map(([p, u]) => `${p}: ${u}`).join("\n")
    : "No social profiles linked from the site.";

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: `You are a senior social media strategist at Zib Digital. A prospect just dropped their URL into the audit. You have their website content and the public social profile links their site links to. Deliver a tight commercial read on their social presence.

Voice rules, non-negotiable:
- Confident, commercial. No agency jargon. Banned: "thrilled", "leverage" (verb), "synergies", "unlock", "elevate", "engagement", "awareness", "presence".
- Commercial language: revenue, leads, conversion, CPA, attention, trust, pipeline.
- Australian English (optimisation, behaviour, colour).
- Direct. "Black and white, no grey areas."
- NEVER use em-dashes. Use commas, periods, colons, or parentheses. Absolute rule.

You cannot see their actual posts or ad accounts. Work from: which platforms they link to, which they don't, and what their website positioning implies about where commercial attention should be focused. Be upfront that this is a strategic read, not a metric analysis. That honesty IS the pitch for a full paid-social audit in phase 2.

Output structure (markdown, render exactly these headings):

## Social footprint
One short paragraph. What's linked from their site? What's missing? What does the gap say about where they are spending attention vs where their buyers are?

## Three commercial opportunities
Numbered list. Three items. Each one **bold title** followed by 1 or 2 sentences on the commercial cost of leaving it as-is. Be specific to their category.

## What a full audit would surface
One or two sentences. What we would pull from their ad accounts if they plugged them in: creative performance, CPA by audience, spend leakage, unused formats.

Hard constraints: 300 words max. Reference their actual category from the site content.`,
    messages: [
      {
        role: "user",
        content: `Prospect URL: ${site.url}
Site title: ${site.title}
Site description: ${site.description}
H2s: ${site.h2s.slice(0, 8).join(" | ")}
Body excerpt:
"""
${site.bodyText.slice(0, 2500)}
"""

Social profiles discovered:
${linkSummary}

Run the social read.`,
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onChunk(event.delta.text);
    }
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

        send("status", { phase: "parallel", message: "Lighthouse + strategist read in parallel…" });
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

        // Kick off PSI, social link scrape, and (unless mode=seo) image brief in parallel
        const psiPromise = runPsi(url).catch((e) => {
          console.warn("[psi]", e.message);
          return null;
        });
        const socialLinksPromise = extractSocialLinks(url);
        const briefPromise = mode === "seo"
          ? Promise.resolve(null)
          : generateImageBrief(site, anthropic).catch((e) => {
              console.warn("[brief]", e.message);
              return null;
            });

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

        const psi = await psiPromise;
        if (psi) send("psi", psi);

        if (mode !== "seo") {
          // Social read as a second streamed block
          const socialLinks = await socialLinksPromise;
          send("status", { phase: "social", message: "Social strategist read…" });
          try {
            await generateSocialRead(site, socialLinks, anthropic, (text) => {
              send("social-chunk", { text });
            });
            send("social-done", { socialLinks });
          } catch (e: any) {
            console.warn("[social]", e?.message);
          }

          // Image generation last (slowest, happens after text is fully rendered)
          send("status", { phase: "image", message: "Generating sample social ad creative…" });
          const brief = await briefPromise;
          const image = await generateImage(site, brief).catch((e) => {
            const msg = e?.message || String(e);
            console.warn("[image]", msg);
            send("image-error", { message: msg });
            return null;
          });
          if (image) send("image", image);
        }

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
