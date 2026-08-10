import Anthropic from "@anthropic-ai/sdk";
import { isValidEmail, normaliseUrl } from "../lib/site";
import { captureLead } from "../lib/hubspot";
import { sendStudioPack, type MetaAdsPackAd } from "../lib/email";
import { guard, type RateTier } from "../lib/rateLimit";
import { submitHubSpotForm } from "../lib/hubspotForms";
import {
  META_ADS_STUDIO_SYSTEM_PROMPT,
  metaAdsStudioUserText,
  STUDIO_FORMATS,
  STUDIO_TEMPLATES,
  type StudioFormat,
  type StudioTemplate,
} from "../lib/prompts/meta-ads-studio";

export const config = { runtime: "edge" };

type Body = {
  runId?: string;
  business?: {
    name?: string;
    about?: string;
    offer?: string;
    website?: string;
    audienceHint?: string;
  };
  colors?: string[];
  headingFont?: string;
  bodyFont?: string;
  photos?: string[]; // data URIs, downscaled client-side for analysis
  hasLogo?: boolean;
  assetUrls?: string[]; // where the original kit landed in Blob storage
  email?: string;
  firstname?: string;
  phone?: string;
  notes?: string;
  sourceTag?: string;
};

type StudioAd = {
  platform: string;
  format: StudioFormat;
  angle: string;
  audience: string;
  template: StudioTemplate;
  image_index: number;
  kicker: string;
  headline: string;
  body: string;
  cta: string;
  visual_word?: string;
};

type StrategyItem = { title: string; detail: string };
type ClaudeResponse = {
  brand: { name: string; tagline: string; category: string; domain: string };
  audience: string;
  image_read?: { index: number; subject: string; best_use: string }[];
  strategy?: {
    audiences: StrategyItem[];
    angles: StrategyItem[];
    cadence: StrategyItem[];
  };
  ads: StudioAd[];
};

// Internal-first tool: slightly looser than the public lab's 2/10min, still
// tight enough that a leaked URL can't burn the Anthropic budget.
const STUDIO_TIERS: RateTier[] = [
  { limit: 4, windowSeconds: 600, suffix: "10m" },
  { limit: 30, windowSeconds: 86400, suffix: "1d" },
];

const MIN_PHOTOS = 3;
const MAX_PHOTOS = 6;
const MAX_PHOTO_CHARS = 900_000; // ~650KB binary per analysis copy
const MAX_TOTAL_CHARS = 3_600_000; // stays under the edge body cap
const DATA_URI_RE = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

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

  const name = (body.business?.name || "").trim().slice(0, 80);
  const about = (body.business?.about || "").trim().slice(0, 400);
  const offer = (body.business?.offer || "").trim().slice(0, 200);
  const audienceHint = (body.business?.audienceHint || "").trim().slice(0, 200);
  const website = normaliseUrl(body.business?.website || "") || "";
  const email = (body.email || "").trim();
  const firstname = (body.firstname || "").trim().slice(0, 80);
  const phone = (body.phone || "").trim().slice(0, 40);
  const notes = (body.notes || "").trim().slice(0, 600);

  if (!name) return json({ error: "Enter the brand name." }, 400);
  if (!about) return json({ error: "Tell us what the brand sells." }, 400);
  if (!isValidEmail(email)) return json({ error: "Enter a valid email." }, 400);

  const photos: { mediaType: string; data: string }[] = [];
  let totalChars = 0;
  for (const raw of body.photos || []) {
    if (typeof raw !== "string" || raw.length > MAX_PHOTO_CHARS) {
      return json({ error: "One of the photos is too large. Re-add it and try again." }, 400);
    }
    totalChars += raw.length;
    const m = raw.match(DATA_URI_RE);
    if (!m) return json({ error: "One of the photos couldn't be read. Use JPG, PNG or WebP." }, 400);
    photos.push({ mediaType: m[1], data: m[2] });
  }
  if (photos.length < MIN_PHOTOS || photos.length > MAX_PHOTOS) {
    return json({ error: `Upload between ${MIN_PHOTOS} and ${MAX_PHOTOS} photos.` }, 400);
  }
  if (totalChars > MAX_TOTAL_CHARS) {
    return json({ error: "The photos are too large in total. Remove one and try again." }, 400);
  }

  const colors = (body.colors || [])
    .filter((c): c is string => typeof c === "string" && HEX_RE.test(c.trim()))
    .map((c) => c.trim().toUpperCase())
    .slice(0, 4);
  const headingFont = (body.headingFont || "").trim().slice(0, 60);
  const bodyFont = (body.bodyFont || "").trim().slice(0, 60);
  const runId = /^[a-zA-Z0-9-]{8,64}$/.test(body.runId || "") ? (body.runId as string) : "";
  const assetUrls = (body.assetUrls || [])
    .filter((u): u is string => typeof u === "string" && u.startsWith("https://"))
    .slice(0, 24);

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }, 500);
  }

  const blocked = await guard(req, "meta-ads-studio", STUDIO_TIERS);
  if (blocked) return blocked;

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const heartbeat = setInterval(() => {
        try { send("ping", { t: Date.now() }); } catch { /* stream closed */ }
      }, 15_000);

      // Lead + kit context into HubSpot immediately, parallel with generation.
      const sourceTag = (body.sourceTag || "").trim();
      const source = sourceTag ? `Meta Ads Studio · ${sourceTag}` : "Meta Ads Studio";
      const kitNoteLines = [
        `Brand kit run${runId ? ` ${runId}` : ""}: ${photos.length} photos, logo ${body.hasLogo ? "yes" : "no"}, colours ${colors.join(" ") || "none"}.`,
      ];
      if (assetUrls.length) kitNoteLines.push(`Stored assets:\n${assetUrls.join("\n")}`);
      if (notes) kitNoteLines.push(`Notes from prospect:\n${notes}`);
      const hubspotPromise = captureLead(
        { email, firstname, company: name, phone: phone || undefined, website, source },
        { url: website || `studio:${name}`, strategistText: kitNoteLines.join("\n\n") },
      ).catch((e) => console.warn("[studio lead]", e?.message));

      try {
        // Stage 0 — kit received (validation already done)
        send("stage", { idx: 0, status: "active", message: "Reading the kit…" });
        await new Promise((r) => setTimeout(r, 600));
        send("stage", { idx: 0, status: "done" });

        // Stage 1 — Claude studies the photos + writes strategy and ads
        send("stage", { idx: 1, status: "active", message: "Studying your photos…" });

        const userText = metaAdsStudioUserText({
          name, about,
          offer: offer || undefined,
          website: website || undefined,
          audienceHint: audienceHint || undefined,
          colors,
          headingFont: headingFont || undefined,
          bodyFont: bodyFont || undefined,
          photoCount: photos.length,
          hasLogo: !!body.hasLogo,
          notes: notes || undefined,
        });

        type ContentPart = Anthropic.TextBlockParam | Anthropic.ImageBlockParam;
        const content: ContentPart[] = [{ type: "text", text: userText }];
        photos.forEach((p, i) => {
          content.push({ type: "text", text: `Photo ${i + 1} (image_index ${i}):` });
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: p.mediaType as Anthropic.ImageBlockParam.Source["media_type"],
              data: p.data,
            },
          });
        });

        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const claudeResp = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 6500,
          system: META_ADS_STUDIO_SYSTEM_PROMPT,
          messages: [{ role: "user", content }],
        });

        const txt = claudeResp.content?.[0]?.type === "text" ? claudeResp.content[0].text : "";
        const stopReason = claudeResp.stop_reason;

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
          console.warn("[meta-ads-studio] JSON parse failed", {
            stopReason,
            length: txt.length,
            cleanedStart: cleaned.slice(0, 200),
            cleanedEnd: cleaned.slice(-200),
            parseError: e?.message,
          });
          throw new Error(
            stopReason === "max_tokens"
              ? "The response was truncated. Try again with fewer photos."
              : "Failed to parse the generated ads",
          );
        }

        if (!parsed.brand) throw new Error("The model returned no brand read");
        if (!parsed.brand.name) parsed.brand.name = name;
        if (!parsed.brand.domain && website) {
          try { parsed.brand.domain = new URL(website).hostname.replace(/^www\./, ""); }
          catch { parsed.brand.domain = ""; }
        }

        send("brand", parsed.brand);
        if (Array.isArray(parsed.image_read) && parsed.image_read.length) {
          send("image-read", { items: parsed.image_read.slice(0, photos.length) });
        }
        send("stage", { idx: 1, status: "done" });

        // Stage 2 — the copy deck (written in the same call; beat for UX)
        send("stage", { idx: 2, status: "active", message: "Writing 12 ads…" });
        await new Promise((r) => setTimeout(r, 900));

        // Clamp everything the canvas compositor trusts.
        const formats = new Set<string>(STUDIO_FORMATS);
        const templates = new Set<string>(STUDIO_TEMPLATES);
        const ads: StudioAd[] = (parsed.ads || [])
          .slice(0, 12)
          .map((ad, i) => ({
            platform: String(ad.platform || "Instagram · Feed").slice(0, 40),
            format: (formats.has(ad.format) ? ad.format : "1:1 · Feed") as StudioFormat,
            angle: String(ad.angle || "Brand").slice(0, 30),
            audience: String(ad.audience || "Cold · broad interest").slice(0, 40),
            template: (templates.has(ad.template) ? ad.template : "overlay") as StudioTemplate,
            image_index:
              Number.isInteger(ad.image_index) && ad.image_index >= 0 && ad.image_index < photos.length
                ? ad.image_index
                : i % photos.length,
            kicker: String(ad.kicker || "").slice(0, 28),
            headline: String(ad.headline || "").slice(0, 60),
            body: String(ad.body || "").slice(0, 200),
            cta: String(ad.cta || "Learn more").slice(0, 22),
            visual_word: String(ad.visual_word || "").slice(0, 24),
          }))
          .filter((ad) => ad.headline);
        if (ads.length < 4) throw new Error("The model returned too few usable ads");

        send("ads", {
          brand: parsed.brand,
          audience: parsed.audience || "",
          strategy: parsed.strategy || null,
          ads,
        });
        send("stage", { idx: 2, status: "done" });

        // Stage 3 — rendering happens in the browser with the real assets;
        // the client drives this stage's progress and we just mark it open.
        send("stage", { idx: 3, status: "active", message: "Rendering in your browser…" });

        const stripForEmail = (ad: StudioAd): MetaAdsPackAd => ({
          platform: ad.platform,
          format: ad.format,
          angle: ad.angle,
          audience: ad.audience,
          headline: ad.headline,
          body: ad.body,
          cta: ad.cta,
        });
        const emailPromise = sendStudioPack({
          email,
          firstname,
          phone: phone || undefined,
          website: website || undefined,
          brand: parsed.brand,
          audience: parsed.audience || "",
          heroAds: ads.slice(0, 4).map(stripForEmail),
          variationAds: ads.slice(4).map(stripForEmail),
        }).catch((e) => console.warn("[studio pack email]", e?.message));

        // Full copy deck + stored-asset links onto the HubSpot record so a
        // strategist can pick the run up without touching the page.
        const packDigest = [
          assetUrls.length ? `Stored kit + creatives:\n${assetUrls.join("\n")}` : "",
          ads.map((ad, i) =>
            `${i + 1}. [${ad.angle} · ${ad.format} · ${ad.audience}] ${ad.headline}\n${ad.body} (CTA: ${ad.cta})`,
          ).join("\n\n"),
        ].filter(Boolean).join("\n\n").slice(0, 30_000);
        const packFormPromise = submitHubSpotForm(source, {
          email,
          website: website || "",
          lead_source: source,
          ads_pack_summary: packDigest,
        }).catch((e) => console.warn("[studio pack form]", e?.message));

        await Promise.all([hubspotPromise, emailPromise, packFormPromise]);
        send("done", {});
      } catch (err: any) {
        console.warn("[meta-ads-studio]", err?.message, err?.stack);
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
