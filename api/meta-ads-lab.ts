import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, normaliseUrl, isValidEmail } from "../lib/site";
import { captureLead } from "../lib/hubspot";
import { sendMetaAdsPack, type MetaAdsPackAd } from "../lib/email";
import { guard } from "../lib/rateLimit";
import { META_ADS_SYSTEM_PROMPT, metaAdsUserPrompt } from "../lib/prompts/meta-ads";
import { isSafeFetchUrl } from "../lib/safeUrl";
import {
  extractBrandAssetRefs,
  extractStylesheetUrls,
  isOpenAiUsableMime,
} from "../lib/brandAssets";
import {
  fetchColorsFromStylesheets,
  fetchImageAsset,
} from "../lib/brandAssetFetch";
import {
  generateBrandedImageWithFallback,
  mapWithConcurrency,
  type BrandReference,
} from "../lib/adImage";

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
  const blocked = await guard(req, "meta-ads-lab");
  if (blocked) return blocked;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      // Keep-alive: image generation can run minutes between events, and a
      // silent SSE stream risks being dropped by intermediaries.
      const heartbeat = setInterval(() => {
        try { send("ping", { t: Date.now() }); } catch { /* stream closed */ }
      }, 15_000);

      // Capture the lead in HubSpot immediately (parallel with generation).
      // The pack email is sent at the END once the 12 concepts are ready.
      const phone = (body.phone || "").trim();
      const notes = (body.notes || "").trim();
      const sourceTag = (body.sourceTag || "").trim();
      const source = sourceTag ? `Meta Ads Lab · ${sourceTag}` : "Meta Ads Lab";
      const hubspotPromise = captureLead(
        { email, firstname, company: "", phone: phone || undefined, website: url, source },
        { url, strategistText: notes ? `Notes from prospect:\n${notes}` : "" },
      ).catch((e) => console.warn("[meta-ads lead]", e?.message));

      try {
        // Stage 0 — fetch
        send("stage", { idx: 0, status: "active", message: "Reading the site…" });
        const site = await fetchSiteContent(url);

        // Brand assets: logo + og:image + palette from the crawled HTML.
        // Fetched in parallel with the Claude call (which is the long pole);
        // best-effort, never blocks or fails the run.
        const assetRefs = extractBrandAssetRefs(site.rawHtml, site.url);
        const assetsPromise = (async () => {
          const [logo, ogImage, cssColors] = await Promise.all([
            // Size caps keep the edits-endpoint uploads fast — an oversized
            // og:image makes every referenced render slow enough to time out.
            assetRefs.logoUrl ? fetchImageAsset(assetRefs.logoUrl, 1_000_000) : null,
            assetRefs.ogImageUrl ? fetchImageAsset(assetRefs.ogImageUrl, 1_200_000) : null,
            // Colour fallback: many sites keep all styling in external CSS.
            assetRefs.colors.length
              ? Promise.resolve([] as string[])
              : fetchColorsFromStylesheets(extractStylesheetUrls(site.rawHtml, site.url)),
          ]);
          return {
            logo,
            ogImage,
            colors: assetRefs.colors.length ? assetRefs.colors : cssColors,
          };
        })();
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
              brandColors: assetRefs.colors,
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

        // Brand assets resolved by now (fetched in parallel with Claude).
        // The frontend uses these to put the real logo + palette on the
        // ad cards; image gen uses them as reference inputs.
        const assets = await assetsPromise;
        const logoForClient =
          assets.logo && assets.logo.dataUri.length < 300_000
            ? assets.logo.dataUri
            : assetRefs.logoUrl?.startsWith("https://")
              ? assetRefs.logoUrl
              : null;
        send("brand-assets", { logo: logoForClient, colors: assets.colors });
        console.log("[meta-ads-lab] brand assets", {
          logoUrl: assetRefs.logoUrl,
          logoFetched: !!assets.logo,
          logoMime: assets.logo?.mime,
          ogImageUrl: assetRefs.ogImageUrl,
          ogFetched: !!assets.ogImage,
          colors: assets.colors,
        });

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

        // Reference images for the edits endpoint (png/jpeg/webp only —
        // SVG logos still reach the frontend but can't go to OpenAI).
        const references: BrandReference[] = [];
        if (assets.logo && isOpenAiUsableMime(assets.logo.mime)) {
          references.push({ image: assets.logo, kind: "logo" });
        }
        if (assets.ogImage && isOpenAiUsableMime(assets.ogImage.mime)) {
          references.push({ image: assets.ogImage, kind: "site" });
        }

        // Heroes render at high quality, variations at medium. Both
        // env-overridable; heroes reuse the historical var name.
        const heroQuality = process.env.META_ADS_IMAGE_QUALITY || "medium";
        const variationQuality = process.env.META_ADS_IMAGE_QUALITY_VARIATION || "medium";

        // Bounded concurrency: firing all 12 at once trips OpenAI's
        // images-per-minute limits and most creatives silently fail.
        // Heroes sit first in allAds, so they render first.
        const imageConcurrency = Math.max(1, parseInt(process.env.META_ADS_IMAGE_CONCURRENCY || "4", 10) || 4);
        await mapWithConcurrency(allAds, imageConcurrency, async (ad, i) => {
            const size = SIZE_FOR_FORMAT[ad.format] || "1024x1024";
            if (!apiKey || !ad.image_prompt) return;
            const quality = i < heroAds.length ? heroQuality : variationQuality;
            try {
              const image_url = await generateBrandedImageWithFallback(
                parsed.brand.name, ad.image_prompt, size, apiKey,
                { quality, references, colors: assets.colors },
                `meta-ads image ${i}`,
              );
              rendered[i] = { ...rendered[i], image_url };
              // Stream each image as it finishes so the frontend can drop
              // it onto the right card without waiting for the slowest one.
              send("ad-image", { idx: i, image_url });
            } catch (e: any) {
              console.warn(`[image ${i}]`, e?.message);
            }
          });

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
        clearInterval(heartbeat);
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
