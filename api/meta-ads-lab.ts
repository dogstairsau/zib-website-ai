import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, normaliseUrl, isValidEmail } from "../lib/site";
import { captureLead } from "../lib/hubspot";
import { sendMetaAdsPack, type MetaAdsPackAd } from "../lib/email";
import { checkRateLimit, rateLimitResponse } from "../lib/rateLimit";
import { META_ADS_SYSTEM_PROMPT, metaAdsUserPrompt } from "../lib/prompts/meta-ads";
import { isSafeFetchUrl } from "../lib/safeUrl";

export const config = { runtime: "edge" };

type Body = {
  url?: string;
  email?: string;
  firstname?: string;
  phone?: string;
  notes?: string;
  sourceTag?: string;
};

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

type StrategyItem = { title: string; detail: string };
type Strategy = {
  audiences: StrategyItem[];
  angles: StrategyItem[];
  cadence: StrategyItem[];
};
type ClaudeResponse = {
  brand: { name: string; tagline: string; category: string; domain: string };
  audience: string;
  strategy?: Strategy;
  hero_ads: AdConcept[];
  variation_ads: AdConcept[];
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
  const email = (body.email || "").trim();
  const firstname = (body.firstname || "").trim();
  if (!url) return json({ error: "Enter a valid website URL." }, 400);
  if (!isSafeFetchUrl(url).ok) return json({ error: "That URL can't be processed." }, 400);
  if (!isValidEmail(email)) return json({ error: "Enter a valid email." }, 400);

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

      // Capture the lead in HubSpot immediately (parallel with generation).
      // The pack email is sent at the END once the 12 concepts are ready.
      const phone = (body.phone || "").trim();
      const notes = (body.notes || "").trim();
      const sourceTag = (body.sourceTag || "").trim();
      const source = sourceTag ? `Meta Ads Lab · ${sourceTag}` : "Meta Ads Lab";
      const hubspotPromise = captureLead(
        { email, firstname, company: "", website: url, source },
        { url, strategistText: notes ? `Notes from prospect:\n${notes}` : "" },
      ).catch((e) => console.warn("[meta-ads lead]", e?.message));

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
          max_tokens: 6000,
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
        const stopReason = claudeResp.stop_reason;
        console.log("[meta-ads-lab] claude raw", {
          length: txt.length,
          stopReason,
          first200: txt.slice(0, 200),
          last200: txt.slice(-200),
        });

        // Robust JSON extraction — handles markdown fences, leading prose,
        // trailing commentary. If Claude truncated, parse still fails and we
        // surface a clear error.
        let cleaned = txt.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) {
          cleaned = cleaned.slice(firstBrace, lastBrace + 1);
        }
        let parsed: ClaudeResponse;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e: any) {
          console.warn("[meta-ads-lab] JSON parse failed", {
            stopReason,
            length: txt.length,
            cleanedStart: cleaned.slice(0, 200),
            cleanedEnd: cleaned.slice(-200),
            parseError: e?.message,
          });
          throw new Error(
            stopReason === "max_tokens"
              ? "Claude response truncated — try a shorter URL or contact support."
              : "Failed to parse generated ads JSON",
          );
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

        // Stage 3 — strategist review + image gen for all 12 in parallel
        send("stage", { idx: 3, status: "active", message: "Generating 12 creatives…" });

        const heroAds = parsed.hero_ads || [];
        const variationAds = parsed.variation_ads || [];

        console.log("[meta-ads-lab] claude parsed", {
          topLevelKeys: Object.keys(parsed),
          brandName: parsed.brand?.name,
          heroAdsCount: heroAds.length,
          variationAdsCount: variationAds.length,
          firstHeroHeadline: heroAds[0]?.headline,
          firstVariationHeadline: variationAds[0]?.headline,
        });
        const allAds = [...heroAds, ...variationAds];

        // Render the 12 cards immediately with gradient placeholders so the
        // frontend has something to show even if image gen later times out.
        const placeholderAds: RenderedAd[] = allAds.map((ad, i) => ({
          ...ad,
          image_url: null,
          id: `ad-${i + 1}`,
        }));
        send("ads", {
          brand: parsed.brand,
          audience: parsed.audience,
          strategy: parsed.strategy || null,
          ads: placeholderAds,
        });

        const apiKey = process.env.OPENAI_API_KEY;
        const rendered: RenderedAd[] = [...placeholderAds];
        await Promise.all(
          allAds.map(async (ad, i) => {
            const size = SIZE_FOR_FORMAT[ad.format] || "1024x1024";
            if (!apiKey || !ad.image_prompt) return;
            try {
              const image_url = await generateAdImage(parsed.brand.name, ad.image_prompt, size, apiKey);
              rendered[i] = { ...rendered[i], image_url };
              // Stream each image as it finishes so the frontend can drop
              // it onto the right card without waiting for the slowest one.
              send("ad-image", { idx: i, image_url });
            } catch (e: any) {
              console.warn(`[image ${i}]`, e?.message);
            }
          })
        );

        send("stage", { idx: 3, status: "done" });

        // Email pack ships text descriptions for all 12 (split into hero +
        // additional in the email template, but every variation now also has
        // its own visual on the page itself).
        const stripForEmail = (ad: AdConcept): MetaAdsPackAd => ({
          platform: ad.platform,
          format: ad.format,
          angle: ad.angle,
          audience: ad.audience,
          headline: ad.headline,
          body: ad.body,
          cta: ad.cta,
        });
        const emailPromise = sendMetaAdsPack({
          url,
          email,
          firstname,
          phone: phone || undefined,
          brand: parsed.brand,
          audience: parsed.audience,
          heroAds: heroAds.map(stripForEmail),
          variationAds: variationAds.map(stripForEmail),
        }).catch((e) => console.warn("[meta-ads pack email]", e?.message));

        // Ensure lead capture + pack email finish before the response closes
        // (edge runtime kills in-flight promises when the stream ends).
        await Promise.all([hubspotPromise, emailPromise]);
        send("done", {});
      } catch (err: any) {
        console.warn("[meta-ads-lab]", err?.message, err?.stack);
        send("error", { message: err?.message || "Generation failed" });
        await hubspotPromise.catch(() => {});
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
