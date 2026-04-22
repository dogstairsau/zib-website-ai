/**
 * Local dev server — serves index.html + handles /api/audit.
 * Mirrors the Vercel edge function so you can demo without `vercel dev`.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-... HF_CREDENTIALS=KEY_ID:KEY_SECRET node dev-server.mjs
 *   open http://localhost:3000
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico":  "image/x-icon",
};

// ──────────────────────────────────────────────────────────────────
// Server-only prompts (with first-class SEO section)
// ──────────────────────────────────────────────────────────────────
const AUDIT_SYSTEM_PROMPT = `
You are a senior digital strategist at Zib Digital, Australia's first digital agency, est. 2009. You operate as a hybrid agent: senior human judgement, AI leverage. A prospect has just dropped their URL into the homepage audit. You have 30 seconds to give them a tight, commercial read.

Voice rules, non-negotiable:
- Confident, not boastful. No agency jargon. No "thrilled", "leverage" (as a verb), "synergies", "unlock", "elevate".
- Commercial-first language: revenue, leads, pipeline, ROAS, conversion, cost-per-acquisition. Not "engagement", "presence", "awareness".
- Australian English (optimisation, organisation, behaviour, colour).
- Direct. "Black and white, no grey areas." Tell them what's wrong and what to do about it.
- First-person plural ("we") when prescribing what Zib would do.
- NEVER use em-dashes (—). They read as AI-generated. Use commas, periods, colons, or parentheses instead. This rule is absolute.

Output structure (markdown, render exactly these headings):

## Positioning read
One paragraph (2 to 3 sentences max). What are they trying to be? Is it clear from the homepage? What's the commercial promise, and does the page actually deliver it?

## SEO snapshot
Two short paragraphs. First paragraph: read the technical foundation. Title length and quality, meta description, H1 hierarchy, schema/structured data, image alt coverage, internal linking, mobile/canonical signals. Second paragraph: read the content and topical positioning. Is the keyword intent on the page commercial or informational? Does the page deserve to rank for what it's targeting? Reference specific signals from the SEO data block, not generic advice.

## Three commercial opportunities
Numbered list. Three items. Each is **one bold title** followed by 1–2 sentences explaining the commercial cost of leaving it as-is. Be specific to their site, never generic. At least one must be SEO-related.

## Quick wins this week
Bulleted list. Three items. Each is concrete, specific, and could be shipped in five working days.

## What we'd do first
One sentence. The single highest-leverage move if they only had one shot.

Hard constraints:
- 450 words max total.
- Reference specifics from the page content + SEO signals you were given. Naming a real product/service from their site beats generic advice every time.
- No closing pitch. The homepage CTA does that work. End on the recommendation.
`.trim();

const auditUserPrompt = (url, content, seo) => `
Prospect URL: ${url}

Page content extracted from their site (title, meta, headings, body text):

"""
${content.slice(0, 7000)}
"""

SEO signals scraped from the page:

\`\`\`
${seo}
\`\`\`

Run the read.
`.trim();

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────
const decode = (s) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

const matchAll = (re, src) => {
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
};

function normaliseUrl(raw) {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const p = new URL(u);
    if (!p.hostname.includes(".")) return null;
    return p.href;
  } catch { return null; }
}

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((e || "").trim());

async function fetchSiteContent(rawUrl) {
  const url = normaliseUrl(rawUrl);
  if (!url) throw new Error("Invalid URL");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ZibAudit/1.0 (+https://zibdigital.com.au/audit)",
      "Accept": "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Site responded ${res.status}`);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) throw new Error("Not an HTML page");

  const html = await res.text();
  const finalUrl = res.url || url;
  const parsed = new URL(finalUrl);

  // ── Basic content ────────────────────────────────
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const description = decode((
    html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] ||
    html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1] ||
    ""
  ).trim());
  const h1All = matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, html)
    .map((s) => decode(s.replace(/<[^>]+>/g, "").trim())).filter(Boolean);
  const h1 = h1All[0] || "";
  const h2s = matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, html)
    .map((s) => decode(s.replace(/<[^>]+>/g, "").trim()))
    .filter(Boolean).slice(0, 12);
  const h3s = matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, html)
    .map((s) => decode(s.replace(/<[^>]+>/g, "").trim()))
    .filter(Boolean).slice(0, 10);

  // ── SEO signals ──────────────────────────────────
  const canonical = (html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)/i)?.[1] || "").trim();
  const robots = (html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']+)/i)?.[1] || "").trim();
  const viewport = (html.match(/<meta\s+name=["']viewport["']\s+content=["']([^"']+)/i)?.[1] || "").trim();
  const langAttr = (html.match(/<html[^>]*\slang=["']([^"']+)/i)?.[1] || "").trim();
  const ogTitle = (html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)/i)?.[1] || "").trim();
  const ogImage = (html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)/i)?.[1] || "").trim();
  const twitterCard = (html.match(/<meta\s+name=["']twitter:card["']\s+content=["']([^"']+)/i)?.[1] || "").trim();

  // Schema.org JSON-LD
  const ldBlocks = matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi, html);
  const schemaTypes = [];
  for (const block of ldBlocks) {
    try {
      const json = JSON.parse(block.trim());
      const arr = Array.isArray(json) ? json : [json];
      for (const item of arr) {
        if (item?.["@type"]) {
          schemaTypes.push(Array.isArray(item["@type"]) ? item["@type"].join(",") : item["@type"]);
        }
        if (Array.isArray(item?.["@graph"])) {
          for (const g of item["@graph"]) if (g?.["@type"]) schemaTypes.push(g["@type"]);
        }
      }
    } catch { /* ignore */ }
  }

  // Images + alt coverage
  const imgTags = matchAll(/<img\b([^>]*)>/gi, html);
  const imgCount = imgTags.length;
  const imgWithAlt = imgTags.filter((attrs) => /\salt=["'][^"']/.test(" " + attrs)).length;

  // Links
  const linkTags = matchAll(/<a\s+[^>]*href=["']([^"']+)["']/gi, html);
  let internalLinks = 0, externalLinks = 0;
  for (const href of linkTags) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const target = new URL(href, finalUrl);
      if (target.hostname === parsed.hostname) internalLinks++;
      else externalLinks++;
    } catch { /* ignore */ }
  }

  // ── Brand colours — theme-color + CSS vars + frequency ──
  const themeColor = (html.match(/<meta\s+name=["']theme-color["']\s+content=["']([^"']+)/i)?.[1] || "").trim().toUpperCase();
  const styleBlocks = matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi, html);
  const inlineStyles = matchAll(/\sstyle=["']([^"']+)["']/gi, html);

  const colorFreq = {};
  const cssVarHits = [];
  const hexRe = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const isFiller = (c) => ["#FFFFFF","#FFF","#000000","#000","#FAFAFA","#F5F5F5","#EEE","#EEEEEE","#FEFEFE","#F0F0F0"].includes(c);

  const considerColor = (raw) => {
    if (!raw) return;
    let c = raw.trim().toUpperCase();
    if (c.length === 4) c = "#" + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    if (!/^#[0-9A-F]{6}$/.test(c)) return;
    if (isFiller(c)) return;
    colorFreq[c] = (colorFreq[c] || 0) + 1;
  };

  for (const block of styleBlocks) {
    for (const m of block.matchAll(hexRe)) considerColor("#" + m[1]);
    // CSS vars likely brand-named
    for (const m of block.matchAll(/--(?:brand|primary|accent|main|theme|color)[a-z0-9-]*\s*:\s*(#[0-9a-fA-F]{3,8})/gi)) {
      cssVarHits.push(m[1].toUpperCase());
    }
  }
  for (const block of inlineStyles) {
    for (const m of block.matchAll(hexRe)) considerColor("#" + m[1]);
  }
  if (themeColor) considerColor(themeColor);

  // CSS vars get heavy weight + theme-color is canonical → put them first
  const ranked = Object.entries(colorFreq).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const seen = new Set();
  const brandColors = [];
  for (const c of [...cssVarHits, ...(themeColor ? [themeColor] : []), ...ranked]) {
    const cc = c.toUpperCase();
    if (seen.has(cc) || isFiller(cc)) continue;
    seen.add(cc);
    brandColors.push(cc);
    if (brandColors.length >= 4) break;
  }

  // Body text + word count
  const bodyText = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  return {
    url: finalUrl,
    title,
    description,
    h1, h1Count: h1All.length,
    h2s, h3s,
    bodyText: bodyText.slice(0, 5500),
    seo: {
      isHttps: parsed.protocol === "https:",
      titleLength: title.length,
      descriptionLength: description.length,
      hasCanonical: !!canonical,
      canonical,
      robots: robots || "(none — defaults to index,follow)",
      hasViewport: !!viewport,
      lang: langAttr || "(missing)",
      ogTitle: !!ogTitle,
      ogImage: !!ogImage,
      twitterCard: twitterCard || "(none)",
      schemaTypes: schemaTypes.length ? [...new Set(schemaTypes)].slice(0, 8) : [],
      imageCount: imgCount,
      imagesWithAlt: imgWithAlt,
      altCoveragePct: imgCount ? Math.round((imgWithAlt / imgCount) * 100) : null,
      internalLinks, externalLinks,
      wordCount,
      brandColors,
    },
    socialLinks: extractSocialLinks(html),
  };
}

// ──────────────────────────────────────────────────────────────────
// Social link extraction + Social strategist read
// ──────────────────────────────────────────────────────────────────
function extractSocialLinks(html) {
  const patterns = {
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._-]+)/gi,
    facebook:  /https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9.-]+)/gi,
    linkedin:  /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in|school)\/([a-zA-Z0-9.-]+)/gi,
    tiktok:    /https?:\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/gi,
    twitter:   /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9_]+)/gi,
    youtube:   /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|channel\/|@|user\/)([a-zA-Z0-9._-]+)/gi,
  };
  const noise = /\/(sharer|share|intent|dialog|popup|plugins|tr)\b/i;
  const found = {};
  for (const [platform, pattern] of Object.entries(patterns)) {
    const matches = [...html.matchAll(pattern)].map(m => m[0]).filter(u => !noise.test(u));
    const unique = [...new Set(matches)];
    if (unique.length) found[platform] = unique[0];
  }
  return found;
}

async function generateSocialRead(site, socialLinks, anthropic, onChunk) {
  const linkSummary = Object.keys(socialLinks).length
    ? Object.entries(socialLinks).map(([p, u]) => `${p}: ${u}`).join("\n")
    : "No social profiles linked from the site.";

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-5",
    max_tokens: 1500,
    system: `You are a senior social media strategist at Zib Digital. A prospect just dropped their URL into the audit. You have their website content and the public social profile links their site links to. Deliver a tight commercial read on their social presence.

Voice rules, non-negotiable:
- Confident, commercial. No agency jargon. Banned words: "thrilled", "leverage" (verb), "synergies", "unlock", "elevate", "engagement", "awareness", "presence".
- Commercial language: revenue, leads, conversion, CPA, attention, trust, pipeline.
- Australian English (optimisation, behaviour, colour).
- Direct. "Black and white, no grey areas."
- NEVER use em-dashes (—). Use commas, periods, colons, or parentheses. Absolute rule.

You cannot see their actual posts or ad accounts (Instagram/Facebook/LinkedIn block scraping). Work from: which platforms they link to, which they don't, and what their website positioning implies about where commercial attention should be focused. Be upfront that this is a strategic read, not a metric analysis. That honesty IS the pitch for a full paid-social audit in phase 2.

Output structure (markdown, render exactly these headings):

## Social footprint
One short paragraph. What's linked from their site? What's missing? What does the gap say about where they are spending attention vs where their buyers are?

## Three commercial opportunities
Numbered list. Three items. Each one **bold title** followed by 1 or 2 sentences on the commercial cost of leaving it as-is. Be specific to their category.

## What a full audit would surface
One or two sentences. What we would pull from their ad accounts if they plugged them in: creative performance, CPA by audience, spend leakage, unused formats. This is the phase-2 pitch.

Hard constraints: 300 words max. Reference their actual category from the site content.`,
    messages: [{
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
    }],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      onChunk(event.delta.text);
    }
  }
}

// ──────────────────────────────────────────────────────────────────
// Sample blog post — Claude writes a brand-specific SEO article
// ──────────────────────────────────────────────────────────────────
async function generateBlogPost(site, anthropic) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2000,
    system: `You are a senior content strategist at Zib Digital. A prospect just submitted their URL for an instant audit — write a sample SEO-optimised blog post that demonstrates what we'd produce for them. This appears alongside a creative mockup, proving we don't just talk strategy, we ship assets.

Output ONLY valid JSON, no markdown fences:

{
  "title": "Article title — 60 chars max. SEO-aware. Specific to brand's category. Title Case.",
  "metaDescription": "140-160 chars. Compelling. Includes target keyword naturally. Sentence case.",
  "targetKeyword": "the primary keyword this post is optimised for (2-4 words)",
  "body": "Markdown body, 500-650 words. Use ## for section headings (3-4 sections). Open with a strong hook, deliver real insight tied to the brand's commercial reality, close with a soft CTA paragraph. Use Australian English (optimisation, organisation)."
}

Voice rules — non-negotiable:
- Confident, commercial. No agency jargon ("unlock", "elevate", "leverage", "synergy", "thrilled" — banned).
- Commercial-first language: revenue, leads, conversion, ROI, customers, pipeline. Not "engagement", "presence", "awareness".
- Real value — never a thin SEO shell padded with filler. The post should be genuinely useful.
- Specific to the brand's actual offering. Don't write generic industry copy.
- Reference signals from the page when natural (their service, audience, location).`,
    messages: [{
      role: "user",
      content: `Write the sample blog post for this brand:

URL: ${site.url}
Title: ${site.title}
Description: ${site.description}
H1: ${site.h1}
H2s: ${site.h2s.slice(0, 8).join(" | ")}
Body excerpt: ${site.bodyText.slice(0, 2500)}

Return only the JSON object.`,
    }],
  });

  const text = message.content?.[0]?.type === "text" ? message.content[0].text : "";
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.warn("[blog] failed to parse JSON");
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────
// Image brief — Claude generates structured ad copy + art direction
// ──────────────────────────────────────────────────────────────────
async function generateImageBrief(site, anthropic) {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 500,
    system: `You are an art director at Zib Digital generating a single Instagram ad mockup based on a prospect's website. Output ONLY valid JSON in this exact shape. No markdown fences, no commentary:

{
  "headline": "3 to 6 word punchy ad copy. Pulls from the brand's strongest value prop. Title Case.",
  "subhead": "8 to 14 word supporting line. Creates curiosity, urgency, or names a specific outcome. Sentence case.",
  "art_direction": "One sentence describing the visual scene/composition that fits this brand's category. Be concrete about what's literally in the photo. Avoid abstract words like 'modern' or 'premium'."
}

Voice rules:
- Confident, commercial. No agency jargon. Banned words: "unlock", "elevate", "leverage", "synergy".
- Australian English where applicable (optimisation, colour).
- Match the brand's tone. Luxury brands get aspirational, B2B brands get direct.
- NEVER use em-dashes (—). Use commas, periods, or colons instead.
- The headline should make a stranger stop scrolling. The subhead should make them tap.`,
    messages: [{
      role: "user",
      content: `Generate the ad brief for this brand:

URL: ${site.url}
Title: ${site.title}
Description: ${site.description}
H1: ${site.h1}
H2s: ${site.h2s.slice(0, 6).join(" | ")}
Body excerpt: ${site.bodyText.slice(0, 1800)}

Return only the JSON object.`,
    }],
  });

  const text = message.content?.[0]?.type === "text" ? message.content[0].text : "";
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.warn("[brief] failed to parse JSON, falling back");
    return null;
  }
}

const formatContentForPrompt = (s) => [
  `URL: ${s.url}`,
  `Title: ${s.title}`,
  `Meta description: ${s.description}`,
  `H1: ${s.h1}`,
  `H2s: ${s.h2s.join(" | ")}`,
  s.h3s.length ? `H3s: ${s.h3s.join(" | ")}` : "",
  ``,
  `Body text:`,
  s.bodyText,
].filter(Boolean).join("\n");

const formatSeoForPrompt = (s) => {
  const seo = s.seo;
  return [
    `Protocol: ${seo.isHttps ? "HTTPS ✓" : "HTTP — insecure"}`,
    `<title>: ${seo.titleLength} chars  ${seo.titleLength < 30 ? "(too short)" : seo.titleLength > 65 ? "(too long, will truncate in SERPs)" : "(within ideal 30–65)"}`,
    `<meta description>: ${seo.descriptionLength ? `${seo.descriptionLength} chars ${seo.descriptionLength < 80 ? "(too short)" : seo.descriptionLength > 160 ? "(too long, will truncate)" : "(within ideal 80–160)"}` : "MISSING"}`,
    `H1 tags found: ${s.h1Count} ${s.h1Count === 0 ? "(missing!)" : s.h1Count > 1 ? "(multiple H1s — pick one)" : "✓"}`,
    `Lang attribute: ${seo.lang}`,
    `Viewport meta: ${seo.hasViewport ? "✓" : "MISSING"}`,
    `Canonical: ${seo.hasCanonical ? seo.canonical : "(none)"}`,
    `Robots: ${seo.robots}`,
    `Open Graph: title=${seo.ogTitle ? "✓" : "missing"}, image=${seo.ogImage ? "✓" : "missing"}`,
    `Twitter card: ${seo.twitterCard}`,
    `Schema.org JSON-LD types: ${seo.schemaTypes.length ? seo.schemaTypes.join(", ") : "(none — no structured data)"}`,
    `Images: ${seo.imageCount} total, ${seo.imagesWithAlt} with alt text${seo.altCoveragePct !== null ? ` (${seo.altCoveragePct}% coverage)` : ""}`,
    `Links: ${seo.internalLinks} internal, ${seo.externalLinks} external`,
    `Word count on page: ${seo.wordCount}`,
  ].join("\n");
};

// ──────────────────────────────────────────────────────────────────
// PageSpeed Insights
// ──────────────────────────────────────────────────────────────────
async function runPsi(url) {
  const params = new URLSearchParams({ url, strategy: "mobile" });
  ["performance", "accessibility", "best-practices", "seo"].forEach((c) => params.append("category", c));
  if (process.env.PSI_API_KEY) params.set("key", process.env.PSI_API_KEY);
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, {
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error?.message || `PSI failed (${res.status})`);
  }
  const data = await res.json();
  const lh = data.lighthouseResult;
  if (!lh) throw new Error("PSI returned no Lighthouse result");
  const score = (k) => Math.round(((lh.categories?.[k]?.score) || 0) * 100);
  const opportunities = Object.values(lh.audits || {})
    .filter((a) => a?.details?.type === "opportunity" && a.score !== null && a.score < 0.9)
    .sort((a, b) => a.score - b.score).slice(0, 4)
    .map((a) => ({
      title: a.title,
      description: (a.description || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
      savingsMs: a.details?.overallSavingsMs,
    }));
  return {
    url: lh.finalDisplayedUrl || lh.finalUrl || url,
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
    },
    opportunities,
  };
}

// ──────────────────────────────────────────────────────────────────
// Image generation — OpenAI gpt-image-1-mini (b64 → data URL)
// ──────────────────────────────────────────────────────────────────
async function generateImage(site, brief) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("[image] skipped — OPENAI_API_KEY not set");
    return null;
  }

  const brand = site.title.split(/[|—–\-]/)[0].trim() || new URL(site.url).hostname;
  const colors = site.seo.brandColors?.length ? site.seo.brandColors.slice(0, 3).join(", ") : "";
  const artDir = brief?.art_direction?.trim();

  const prompt = [
    `Premium editorial photograph for ${brand}.`,
    artDir || `Magazine-quality lifestyle scene. Soft natural lighting, confident composition, plenty of negative space.`,
    colors ? `Brand colour palette woven into the scene (props, lighting, surfaces, wardrobe): ${colors}.` : "",
    `Format: vertical 9:16, Instagram Story aspect ratio.`,
    `Style: editorial, magazine-quality, restrained. NOT stock-photo. NO TEXT, NO LOGOS, NO TYPOGRAPHY of any kind. Pure photographic composition.`,
  ].filter(Boolean).join("\n\n");

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini";
  const size = process.env.OPENAI_IMAGE_SIZE || "1024x1536";
  const quality = process.env.OPENAI_IMAGE_QUALITY || "medium";

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
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
// Twilio SMS — sends "audit received" confirmation
// ──────────────────────────────────────────────────────────────────
function normalisePhoneAU(raw) {
  if (!raw) return null;
  let p = raw.replace(/[^\d+]/g, "");
  if (p.startsWith("+")) return p;                    // already E.164
  if (p.startsWith("00")) return "+" + p.slice(2);    // international
  if (p.startsWith("0") && p.length === 10) return "+61" + p.slice(1); // AU mobile/landline
  if (p.startsWith("61")) return "+" + p;             // missing leading +
  if (p.length >= 8) return "+61" + p;                // assume AU if no country code
  return null;
}

const SMS_BODY = "Your Zib audit has been received. Expect a call from one of our senior strategists shortly. — Zib Digital";

async function sendAuditSms(rawPhone) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    console.log(`[twilio:stub] would SMS ${rawPhone}`);
    return;
  }

  const to = normalisePhoneAU(rawPhone);
  if (!to) {
    console.warn(`[twilio] invalid phone: ${rawPhone}`);
    return;
  }

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const body = new URLSearchParams({ To: to, From: from, Body: SMS_BODY });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    console.warn(`[twilio] ${res.status}: ${err.slice(0, 200)}`);
    return;
  }
  const data = await res.json();
  console.log(`[twilio] sent ${data.sid} → ${to}`);
}

// ──────────────────────────────────────────────────────────────────
// Lead capture (stub)
// ──────────────────────────────────────────────────────────────────
async function captureLead(lead) {
  console.log(`[lead] ${lead.email} ${lead.phone || ""} → ${lead.website}`);
  if (process.env.SLACK_WEBHOOK_URL) {
    fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `:zap: New audit lead — *${lead.email}* on <${lead.website}|${lead.website}>` }),
    }).catch(() => {});
  }
}

// ──────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────
async function handleAudit(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const url = normaliseUrl(parsed.url);
  const email = (parsed.email || "").trim();
  const phone = (parsed.phone || "").trim();
  const mode = (parsed.mode || "").trim(); // "seo" → skip image gen
  if (!url) {
    res.writeHead(400, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Enter a valid website URL." }));
    return;
  }
  if (!isValidEmail(email)) {
    res.writeHead(400, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Enter a valid work email." }));
    return;
  }
  if (phone.replace(/\D/g, "").length < 6) {
    res.writeHead(400, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Enter a valid phone number." }));
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Server not configured (ANTHROPIC_API_KEY missing)." }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Fire-and-forget SMS confirmation the moment the form is submitted
  if (phone) sendAuditSms(phone).catch((e) => console.warn("[sms]", e.message));

  try {
    send("status", { phase: "fetch", message: "Reading the site…" });
    const site = await fetchSiteContent(url);

    send("status", { phase: "parallel", message: "Lighthouse + image generation in parallel…" });

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Kick off PSI + (optional) ad brief in parallel
    const psiPromise = runPsi(url).catch((e) => { console.warn("[psi]", e.message); return null; });
    const briefPromise = mode === "seo"
      ? Promise.resolve(null)
      : generateImageBrief(site, anthropic).catch((e) => { console.warn("[brief]", e.message); return null; });

    send("status", { phase: "think", message: "Senior strategist read…" });
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-5",
      max_tokens: 2200,
      system: AUDIT_SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: auditUserPrompt(url, formatContentForPrompt(site), formatSeoForPrompt(site)),
      }],
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        send("chunk", { text: event.delta.text });
      }
    }

    // Strategist read done — settle PSI, then build & generate the image
    const psi = await psiPromise;
    if (psi) send("psi", psi);

    if (mode !== "seo") {
      // Social read streams as a second strategist block
      send("status", { phase: "social", message: "Social strategist read…" });
      try {
        await generateSocialRead(site, site.socialLinks || {}, anthropic, (text) => {
          send("social-chunk", { text });
        });
        send("social-done", { socialLinks: site.socialLinks || {} });
      } catch (e) {
        console.warn("[social]", e.message);
      }

      send("status", { phase: "image", message: "Generating sample social ad creative…" });
      const brief = await briefPromise;
      const image = await generateImage(site, brief).catch((e) => { console.warn("[image]", e.message); return null; });
      if (image) send("image", image);
    }

    captureLead({ email, phone, website: url, source: "Homepage audit (dev)" }).catch(() => {});
    send("done", { url: site.url });
  } catch (err) {
    console.error("[audit]", err);
    send("error", { message: err?.message || "Audit failed." });
  } finally {
    res.end();
  }
}

// ──────────────────────────────────────────────────────────────────
// /api/blog — streams a brand-specific sample blog post
// ──────────────────────────────────────────────────────────────────
async function handleBlog(req, res) {
  if (req.method !== "POST") {
    res.writeHead(405).end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body); } catch {
    res.writeHead(400, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  const url = normaliseUrl(parsed.url);
  if (!url) {
    res.writeHead(400, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Missing URL." }));
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" })
       .end(JSON.stringify({ error: "Server not configured." }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    send("status", { message: "Reading the site…" });
    const site = await fetchSiteContent(url);
    send("status", { message: "Drafting your sample blog post…" });

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const blog = await generateBlogPost(site, anthropic);

    if (!blog) throw new Error("Blog generation failed.");
    send("blog", blog);
    send("done", {});
  } catch (err) {
    console.error("[blog]", err);
    send("error", { message: err?.message || "Blog generation failed." });
  } finally {
    res.end();
  }
}

async function serveStatic(req, res) {
  const urlPath = req.url.split("?")[0];
  let filePath = urlPath === "/" ? "/index.html" : urlPath;
  if (filePath.includes("..")) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(join(ROOT, filePath));
    const mime = MIME[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime }).end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

// ──────────────────────────────────────────────────────────────────
// Server
// ──────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  if (req.url?.startsWith("/api/audit")) return handleAudit(req, res);
  if (req.url?.startsWith("/api/blog")) return handleBlog(req, res);
  return serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n  Zib dev server  →  http://localhost:${PORT}`);
  console.log(`  Anthropic key   →  ${process.env.ANTHROPIC_API_KEY ? "loaded" : "MISSING (set ANTHROPIC_API_KEY)"}`);
  console.log(`  Image gen       →  ${process.env.OPENAI_API_KEY ? `OpenAI ${process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini"}` : "DISABLED"}`);
  console.log(`  PSI key         →  ${process.env.PSI_API_KEY ? "loaded" : "unset (rate-limited)"}`);
  console.log(`  Twilio SMS      →  ${process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER ? "loaded" : "unset (SMS disabled)"}`);
  console.log(`  Slack webhook   →  ${process.env.SLACK_WEBHOOK_URL ? "loaded" : "unset"}\n`);
});
