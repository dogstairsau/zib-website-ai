/**
 * Server-side URL fetch + content extraction.
 * Edge-runtime safe (no jsdom, just regex).
 */

import { safeFetch } from "./safeUrl";

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

const matchAll = (re: RegExp, src: string): string[] => {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
};

export type JsRenderHint = {
  likely: boolean;
  signals: string[];
};

export type SiteContent = {
  url: string;
  title: string;
  description: string;
  h1: string;
  h2s: string[];
  bodyText: string;
  rawHtml: string;
  jsRendered: JsRenderHint;
};

// WAF/CDN responses that usually mean "we don't like your user-agent",
// not "this page is broken" — worth one retry disguised as a browser.
const BLOCK_STATUSES = new Set([401, 403, 406, 429, 503]);

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
} as const;

export async function fetchSiteContent(rawUrl: string): Promise<SiteContent> {
  const url = normaliseUrl(rawUrl);
  if (!url) throw new Error("Invalid URL");

  // safeFetch validates the host (and every redirect hop) against the SSRF
  // guard before fetching — this is the user-controlled entry point.
  // First attempt identifies honestly; firewalls (Cloudflare, Wordfence,
  // Sucuri) commonly 403 unknown bot UAs, so a blocked response gets one
  // retry with browser headers before we give up.
  let res = await safeFetch(url, {
    headers: {
      "User-Agent": "ZibAudit/1.0 (+https://zibdigital.com.au/audit)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok && BLOCK_STATUSES.has(res.status)) {
    res = await safeFetch(url, {
      headers: { ...BROWSER_HEADERS },
      signal: AbortSignal.timeout(10_000),
    });
  }

  if (!res.ok) {
    throw new Error(
      BLOCK_STATUSES.has(res.status)
        ? `this site's firewall is blocking automated readers (HTTP ${res.status})`
        : `Site responded ${res.status}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("html")) throw new Error("Not an HTML page");

  const html = await res.text();

  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const description = decode(
    (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)/i)?.[1] ||
      html.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)/i)?.[1] ||
      "").trim()
  );
  const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "")
    .replace(/<[^>]+>/g, "")
    .trim());
  const h2s = matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, html)
    .map((s) => decode(s.replace(/<[^>]+>/g, "").trim()))
    .filter(Boolean)
    .slice(0, 12);

  const bodyText = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 6000);

  const jsRendered = detectJsRendered(html, bodyText, h1, h2s);

  return { url, title, description, h1, h2s, bodyText, rawHtml: html, jsRendered };
}

// ─── JS-render detection ────────────────────────────────────────────
// We crawl static HTML only — no browser, no JS execution. Modern sites
// (Next.js, React, Vue, Webflow, Framer) often serve a near-empty shell
// that hydrates client-side. We flag those so the strategist hedges
// and the prospect/partner sees a banner.
function detectJsRendered(html: string, bodyText: string, h1: string, h2s: string[]): JsRenderHint {
  const signals: string[] = [];

  // Framework markers — strong signals
  if (/<div\s+id=["']__next["'][^>]*>(\s|<!--[\s\S]*?-->)*<\/div>/i.test(html) || /__NEXT_DATA__/.test(html)) signals.push("Next.js");
  if (/<div\s+id=["']root["'][^>]*>(\s|<!--[\s\S]*?-->)*<\/div>/i.test(html)) signals.push("React/SPA shell (#root empty)");
  if (/<div\s+id=["']app["'][^>]*>(\s|<!--[\s\S]*?-->)*<\/div>/i.test(html)) signals.push("Vue/SPA shell (#app empty)");
  if (/<div\s+id=["']svelte["']/i.test(html) || /<div\s+id=["']___gatsby["']/i.test(html)) signals.push("Svelte/Gatsby shell");
  if (/framerusercontent\.com|data-framer-/i.test(html)) signals.push("Framer");
  if (/data-wf-page|webflow\.js|cdn\.prod\.website-files\.com/i.test(html)) signals.push("Webflow");
  if (/window\.__NUXT__|<div\s+id=["']__nuxt["']/i.test(html)) signals.push("Nuxt");
  if (/<div\s+id=["']gatsby-focus-wrapper["']/i.test(html)) signals.push("Gatsby");

  // Content-vs-scripts heuristic — many script tags, little text
  const scriptCount = (html.match(/<script\b/gi) || []).length;
  const visibleSignal = bodyText.length + h1.length + h2s.join(" ").length;
  if (visibleSignal < 300 && scriptCount >= 5) {
    signals.push(`thin static HTML (${visibleSignal} chars of content, ${scriptCount} scripts)`);
  }

  // Hard no-content case
  if (!h1 && h2s.length === 0 && bodyText.length < 200) {
    signals.push("no headings, near-empty body");
  }

  return { likely: signals.length > 0, signals };
}

export function formatForPrompt(s: SiteContent): string {
  return [
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    `Meta description: ${s.description}`,
    `H1: ${s.h1}`,
    `H2s: ${s.h2s.join(" | ")}`,
    ``,
    `Body text:`,
    s.bodyText,
  ].join("\n");
}

export function normaliseUrl(raw: string): string | null {
  let u = raw.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes(".")) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function isValidEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
}
