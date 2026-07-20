import Anthropic from "@anthropic-ai/sdk";
import { fetchSiteContent, normaliseUrl, isValidEmail } from "../lib/site";
import { captureLead } from "../lib/hubspot";
import { sendGoogleAdsPack } from "../lib/email";
import { guard } from "../lib/rateLimit";
import { GOOGLE_ADS_SYSTEM_PROMPT, googleAdsUserPrompt } from "../lib/prompts/google-ads";
import { isSafeFetchUrl } from "../lib/safeUrl";
import { auditTransparency, transparencyUrl } from "../lib/adsTransparency";
import { submitHubSpotForm } from "../lib/hubspotForms";
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

type AuditItem = { title: string; detail: string };
type KeywordTheme = { theme: string; examples: string };
type Sitelink = { text: string; desc: string };
type PmaxImage = { ratio: string; concept: string; image_prompt: string };

type ClaudeResponse = {
  brand: { name: string; tagline: string; category: string; domain: string };
  audit: AuditItem[];
  search: { headlines: string[]; descriptions: string[]; paths: string[] };
  keywordThemes: KeywordTheme[];
  pmax: {
    businessName: string;
    shortHeadlines: string[];
    longHeadlines: string[];
    descriptions: string[];
    callouts: string[];
    sitelinks: Sitelink[];
    images: PmaxImage[];
  };
};

type RenderedImage = PmaxImage & { image_url: string | null; id: string };

// OpenAI gpt-image supported sizes mapped to Google PMAX ratios.
const SIZE_FOR_RATIO: Record<string, string> = {
  "1.91:1 · Landscape": "1536x1024",
  "1:1 · Square": "1024x1024",
  "4:5 · Portrait": "1024x1536",
};

/** Trim to a Google asset char limit at a word boundary where possible. */
function clamp(s: string, max: number): string {
  const t = (s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

function json(data: unknown, status = 200): Response {
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
  const blocked = await guard(req, "google-ads-lab");
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

      const phone = (body.phone || "").trim();
      const notes = (body.notes || "").trim();
      const sourceTag = (body.sourceTag || "").trim();
      const source = sourceTag ? `Google Ads Lab · ${sourceTag}` : "Google Ads Lab";
      const hubspotPromise = captureLead(
        { email, firstname, company: "", phone: phone || undefined, website: url, source },
        { url, strategistText: notes ? `Notes from prospect:\n${notes}` : "" },
      ).catch((e) => console.warn("[google-ads lead]", e?.message));

      try {
        // Stage 0 — read the site, then resolve the advertiser in the
        // Transparency Center using the brand name from the site.
        send("stage", { idx: 0, status: "active", message: "Reading the site + Transparency Center…" });
        const site = await fetchSiteContent(url);

        // Brand assets: logo + og:image + palette, fetched in parallel with
        // the Claude call. Best-effort — never blocks or fails the run.
        const assetRefs = extractBrandAssetRefs(site.rawHtml, site.url);
        const assetsPromise = (async () => {
          const [logo, ogImage, cssColors] = await Promise.all([
            // Size caps keep the edits-endpoint uploads fast — an oversized
            // og:image makes every referenced render slow enough to time out.
            assetRefs.logoUrl ? fetchImageAsset(assetRefs.logoUrl, 1_000_000) : null,
            assetRefs.ogImageUrl ? fetchImageAsset(assetRefs.ogImageUrl, 1_200_000) : null,
            assetRefs.colors.length
              ? Promise.resolve([] as string[])
              : fetchColorsFromStylesheets(extractStylesheetUrls(site.rawHtml, site.url)),
          ]);
          return { logo, ogImage, colors: assetRefs.colors.length ? assetRefs.colors : cssColors };
        })();

        const transparency = await auditTransparency({ url, title: site.title, h1: site.h1 }).catch(() => ({
          url: transparencyUrl(url),
          advertiser: null,
          adCountLabel: "",
          note: "Transparency Center deep-link prepared; base the audit on the site read.",
        }));
        send("transparency", {
          url: transparency.url,
          found: !!transparency.advertiser,
          advertiserName: transparency.advertiser?.name || null,
          adCountLabel: transparency.adCountLabel || null,
          region: transparency.advertiser?.region || null,
          verified: transparency.advertiser?.verified || false,
        });
        send("stage", { idx: 0, status: "done" });

        // Stage 1 — audit + asset generation (Claude)
        send("stage", { idx: 1, status: "active", message: "Auditing the account opportunity…" });
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const claudeResp = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 6000,
          system: GOOGLE_ADS_SYSTEM_PROMPT,
          messages: [{
            role: "user",
            content: googleAdsUserPrompt({
              url: site.url,
              title: site.title,
              description: site.description,
              h1: site.h1,
              h2s: site.h2s,
              bodyText: site.bodyText,
              transparencyNote: transparency.note,
            }),
          }],
        });

        const txt = claudeResp.content?.[0]?.type === "text" ? claudeResp.content[0].text : "";
        const stopReason = claudeResp.stop_reason;

        let cleaned = txt.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace >= 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1);

        let parsed: ClaudeResponse;
        try {
          parsed = JSON.parse(cleaned);
        } catch (e: any) {
          console.warn("[google-ads-lab] JSON parse failed", { stopReason, parseError: e?.message });
          throw new Error(
            stopReason === "max_tokens"
              ? "Response truncated — try a shorter URL or contact support."
              : "Failed to parse generated ads JSON",
          );
        }

        if (!parsed.brand?.domain) {
          try { parsed.brand.domain = new URL(site.url).hostname.replace(/^www\./, ""); }
          catch { parsed.brand.domain = site.url; }
        }

        // Backstop: enforce Google's asset character limits.
        const s = parsed.search || ({} as ClaudeResponse["search"]);
        s.headlines = (s.headlines || []).slice(0, 15).map((h) => clamp(h, 30));
        s.descriptions = (s.descriptions || []).slice(0, 4).map((d) => clamp(d, 90));
        s.paths = (s.paths || []).slice(0, 2).map((p) => clamp(p, 15).toLowerCase().replace(/\s+/g, "-"));
        const px = parsed.pmax || ({} as ClaudeResponse["pmax"]);
        px.businessName = clamp(px.businessName || parsed.brand.name, 25);
        px.shortHeadlines = (px.shortHeadlines || []).slice(0, 5).map((h) => clamp(h, 30));
        px.longHeadlines = (px.longHeadlines || []).slice(0, 5).map((h) => clamp(h, 90));
        px.descriptions = (px.descriptions || []).slice(0, 4).map((d, i) => clamp(d, i === 0 ? 60 : 90));
        px.callouts = (px.callouts || []).slice(0, 6).map((c) => clamp(c, 25));
        px.sitelinks = (px.sitelinks || []).slice(0, 4).map((sl) => ({
          text: clamp(sl.text, 25),
          desc: clamp(sl.desc, 35),
        }));
        const images = (px.images || []).slice(0, 4);

        send("brand", parsed.brand);

        const assets = await assetsPromise;
        const logoForClient =
          assets.logo && assets.logo.dataUri.length < 300_000
            ? assets.logo.dataUri
            : assetRefs.logoUrl?.startsWith("https://")
              ? assetRefs.logoUrl
              : null;
        send("brand-assets", { logo: logoForClient, colors: assets.colors });
        console.log("[google-ads-lab] brand assets", {
          logoUrl: assetRefs.logoUrl,
          logoFetched: !!assets.logo,
          ogFetched: !!assets.ogImage,
          colors: assets.colors,
        });

        send("stage", { idx: 1, status: "done" });

        // Stage 2 — assemble the pack (beat for UX)
        send("stage", { idx: 2, status: "active", message: "Building the campaign…" });
        const renderedImages: RenderedImage[] = images.map((img, i) => ({
          ...img,
          image_url: null,
          id: `img-${i + 1}`,
        }));
        send("pack", {
          brand: parsed.brand,
          audit: parsed.audit || [],
          transparency: { url: transparency.url },
          search: s,
          keywordThemes: parsed.keywordThemes || [],
          pmax: { ...px, images: renderedImages },
        });
        await new Promise((r) => setTimeout(r, 800));
        send("stage", { idx: 2, status: "done" });

        // Stage 3 — render the PMAX image assets
        send("stage", { idx: 3, status: "active", message: "Generating image assets…" });
        const apiKey = process.env.OPENAI_API_KEY;
        const references: BrandReference[] = [];
        if (assets.logo && isOpenAiUsableMime(assets.logo.mime)) {
          references.push({ image: assets.logo, kind: "logo" });
        }
        if (assets.ogImage && isOpenAiUsableMime(assets.ogImage.mime)) {
          references.push({ image: assets.ogImage, kind: "site" });
        }
        const quality = process.env.META_ADS_IMAGE_QUALITY || "medium";
        await mapWithConcurrency(images, 3, async (img, i) => {
          if (!apiKey || !img.image_prompt) return;
          const size = SIZE_FOR_RATIO[img.ratio] || "1024x1024";
          try {
            const image_url = await generateBrandedImageWithFallback(
              parsed.brand.name, img.image_prompt, size, apiKey,
              { quality, references, colors: assets.colors },
              `google-ads image ${i}`,
            );
            send("pmax-image", { idx: i, image_url });
          } catch (e: any) {
            console.warn(`[google-ads image ${i}]`, e?.message);
          }
        });
        send("stage", { idx: 3, status: "done" });

        // Email pack to prospect + internal team
        const emailPromise = sendGoogleAdsPack({
          url,
          email,
          firstname,
          phone: phone || undefined,
          brand: parsed.brand,
          transparencyUrl: transparency.url,
          audit: parsed.audit || [],
          search: { headlines: s.headlines, descriptions: s.descriptions, paths: s.paths },
          keywordThemes: parsed.keywordThemes || [],
          pmax: {
            businessName: px.businessName,
            shortHeadlines: px.shortHeadlines,
            longHeadlines: px.longHeadlines,
            descriptions: px.descriptions,
            callouts: px.callouts,
            sitelinks: px.sitelinks,
          },
        }).catch((e) => console.warn("[google-ads pack email]", e?.message));

        // The generated pack, as text, onto the HubSpot contact record.
        const packDigest = [
          `AUDIT:\n${(parsed.audit || []).map((a) => `- ${a.title}: ${a.detail}`).join("\n")}`,
          `RSA HEADLINES: ${s.headlines.join(" | ")}`,
          `RSA DESCRIPTIONS: ${s.descriptions.join(" | ")}`,
          `KEYWORD THEMES: ${(parsed.keywordThemes || []).map((k) => k.theme).join(" | ")}`,
          `PMAX SHORT: ${px.shortHeadlines.join(" | ")}`,
          `PMAX LONG: ${px.longHeadlines.join(" | ")}`,
          `PMAX DESCRIPTIONS: ${px.descriptions.join(" | ")}`,
          `CALLOUTS: ${px.callouts.join(" | ")}`,
        ].join("\n\n").slice(0, 30_000);
        const packFormPromise = submitHubSpotForm(source, {
          email,
          website: url,
          lead_source: source,
          ads_pack_summary: packDigest,
        }).catch((e) => console.warn("[google-ads pack form]", e?.message));

        await Promise.all([hubspotPromise, emailPromise, packFormPromise]);
        send("done", {});
      } catch (err: any) {
        console.warn("[google-ads-lab]", err?.message, err?.stack);
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
