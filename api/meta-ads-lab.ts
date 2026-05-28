import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, normaliseUrl } from "../lib/site";
import { checkRateLimit, rateLimitResponse } from "../lib/rateLimit";
import { META_ADS_SYSTEM_PROMPT, metaAdsUserPrompt } from "../lib/prompts/meta-ads";

export const config = { runtime: "edge" };

type Body = { url?: string };

type AdConcept = {
  platform: string;
  format: string;
  angle: string;
  audience: string;
  headline: string;
  body: string;
  cta: string;
  visual_word?: string;
  image_prompt: string;
};

type ClaudeResponse = {
  brand: { name: string; tagline: string; category: string; domain: string };
  audience: string;
  ads: AdConcept[];
};

type RenderedAd = AdConcept & {
  image_url: string | null;
  id: string;
};

const SIZE_FOR_FORMAT: Record<string, string> = {
  "1:1 · Feed": "1024x1024",
  "9:16 · Story": "1024x1536",
  "4:5 · Carousel": "1024x1024",
  "9:16 · Reel": "1024x1536",
};

async function generateAdImage(
  brand: string,
  imagePrompt: string,
  size: string,
  apiKey: string,
): Promise<string | null> {
  const prompt = [
    `Editorial photograph for ${brand}.`,
    imagePrompt,
    `Style: editorial, magazine-quality, restrained. NOT stock-photo. NO TEXT, NO LOGOS, NO TYPOGRAPHY of any kind. Pure photographic composition.`,
  ].join("\n\n");

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
      prompt,
      size,
      quality: process.env.META_ADS_IMAGE_QUALITY || "low",
      n: 1,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI ${res.status}`);
  }
  const data = await res.json();
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("No image data");
  return `data:image/png;base64,${b64}`;
}

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  if (!url) return json({ error: "Enter a valid website URL." }, 400);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }, 500);
  }

  // Rate limit: 2 generations per 10 min per IP
  const rl = await checkRateLimit(req, "meta-ads-lab", 2, 600);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        // Stage 0 — fetch
        send("stage", { idx: 0, status: "active", message: "Reading the site…" });
        const site = await fetchSiteContent(url);
        send("stage", { idx: 0, status: "done" });

        // Stage 1 — audience analysis (begins, Claude runs)
        send("stage", { idx: 1, status: "active", message: "Mapping the buyer…" });

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const claudeResp = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 2400,
          system: META_ADS_SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: metaAdsUserPrompt({
              url: site.url,
              title: site.title,
              description: site.description,
              h1: site.h1,
              h2s: site.h2s,
              bodyText: site.bodyText,
            }),
          }],
        });

        const txt = claudeResp.content?.[0]?.type === "text" ? claudeResp.content[0].text : "";
        const cleaned = txt.replace(/^```json\s*|\s*```$/g, "").trim();
        let parsed: ClaudeResponse;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error("Failed to parse generated ads JSON");
        }

        // Ensure domain is set from URL if Claude didn't include it
        if (!parsed.brand.domain) {
          try { parsed.brand.domain = new URL(site.url).hostname.replace(/^www\./, ""); }
          catch { parsed.brand.domain = site.url; }
        }

        send("brand", parsed.brand);
        send("stage", { idx: 1, status: "done" });

        // Stage 2 — draft (already done by Claude, beat for UX)
        send("stage", { idx: 2, status: "active", message: "Drafting 4 concepts…" });
        await new Promise(r => setTimeout(r, 1000));
        send("stage", { idx: 2, status: "done" });

        // Stage 3 — strategist review + image gen (parallel images)
        send("stage", { idx: 3, status: "active", message: "Generating creatives…" });

        const apiKey = process.env.OPENAI_API_KEY;
        const rendered: RenderedAd[] = await Promise.all(
          parsed.ads.map(async (ad, i): Promise<RenderedAd> => {
            const size = SIZE_FOR_FORMAT[ad.format] || "1024x1024";
            let image_url: string | null = null;
            if (apiKey) {
              try {
                image_url = await generateAdImage(parsed.brand.name, ad.image_prompt, size, apiKey);
                send("ad-image", { idx: i });
              } catch (e: any) {
                console.warn(`[image ${i}]`, e?.message);
              }
            }
            return { ...ad, image_url, id: `ad-${i + 1}` };
          })
        );

        send("stage", { idx: 3, status: "done" });
        send("ads", { brand: parsed.brand, audience: parsed.audience, ads: rendered });
        send("done", {});
      } catch (err: any) {
        console.warn("[meta-ads-lab]", err?.message, err?.stack);
        send("error", { message: err?.message || "Generation failed" });
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
