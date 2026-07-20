/**
 * Brand asset extraction from crawled HTML.
 * Edge-runtime safe (regex only, no DOM).
 *
 * Pulls the assets the ad labs need to make output look like the client's
 * brand instead of generic AI stock:
 *   - logo (JSON-LD Organization logo → header <img> → apple-touch-icon → icon)
 *   - og:image (hero/product scene, used as a style reference for image gen)
 *   - brand colours (theme-color meta + most-used non-grey hexes in CSS)
 *
 * Deliberately import-free so the node test runner can load it directly
 * (ESM needs explicit file extensions, but a ".ts" import specifier breaks
 * Vercel's edge bundle). The fetch helpers live in brandAssetFetch.ts.
 */

export type BrandAssetRefs = {
  logoUrl: string | null;
  ogImageUrl: string | null;
  colors: string[]; // hex, most confident first, max 3
};

const resolveUrl = (raw: string, base: string): string | null => {
  const cleaned = raw.trim().replace(/&amp;/g, "&");
  if (!cleaned || cleaned.startsWith("data:")) return null;
  try {
    const u = new URL(cleaned, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  } catch {
    return null;
  }
};

const attr = (tag: string, name: string): string | null => {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, "i")) ||
    tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']+)'`, "i"));
  return m ? m[1] : null;
};

// ─── Logo ────────────────────────────────────────────────────────────

function jsonLdLogo(html: string): string | null {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    // "logo": "https://…"  or  "logo": { …, "url": "https://…" }
    const direct = block.match(/"logo"\s*:\s*"([^"]+)"/);
    if (direct) return direct[1];
    const nested = block.match(/"logo"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/);
    if (nested) return nested[1];
  }
  return null;
}

function headerImgLogo(html: string): string | null {
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgs) {
    const src = attr(tag, "src") || attr(tag, "data-src");
    if (!src) continue;
    const haystack = [src, attr(tag, "class"), attr(tag, "id"), attr(tag, "alt")]
      .filter(Boolean)
      .join(" ");
    if (/logo/i.test(haystack)) return src;
  }
  return null;
}

function linkIcon(html: string, relPattern: RegExp): string | null {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  let best: { href: string; size: number } | null = null;
  for (const tag of links) {
    const rel = attr(tag, "rel") || "";
    if (!relPattern.test(rel)) continue;
    const href = attr(tag, "href");
    if (!href || /\.ico(\?|$)/i.test(href)) continue; // .ico too small to be useful
    const sizes = attr(tag, "sizes") || "";
    const size = parseInt(sizes, 10) || 0;
    if (!best || size > best.size) best = { href, size };
  }
  return best?.href || null;
}

// ─── Colours ─────────────────────────────────────────────────────────

const expandHex = (h: string): string =>
  h.length === 3 ? h.split("").map((c) => c + c).join("") : h;

/** Reject whites, blacks and greys — useless as a brand accent. */
export function isUsableBrandColor(hex: string): boolean {
  const h = expandHex(hex.replace(/^#/, "").toLowerCase());
  if (!/^[0-9a-f]{6}$/.test(h)) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (min > 235) return false; // near-white
  if (max < 30) return false; // near-black
  if (max - min < 20) return false; // grey
  return true;
}

/** Most-used usable hexes in a blob of CSS, most frequent first. */
export function rankCssColors(css: string): string[] {
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const norm = "#" + expandHex(m[1].toLowerCase());
    if (!isUsableBrandColor(norm)) continue;
    counts.set(norm, (counts.get(norm) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);
}

function extractColors(html: string): string[] {
  const out: string[] = [];
  const push = (hex: string | null) => {
    if (!hex) return;
    const norm = "#" + expandHex(hex.replace(/^#/, "").toLowerCase());
    if (isUsableBrandColor(norm) && !out.includes(norm)) out.push(norm);
  };

  // Declared brand colours first — highest confidence.
  push(html.match(/<meta\s+name=["']theme-color["']\s+content=["'](#[0-9a-fA-F]{3,6})/i)?.[1] || null);
  push(html.match(/<meta\s+name=["']msapplication-TileColor["']\s+content=["'](#[0-9a-fA-F]{3,6})/i)?.[1] || null);

  // Then the most-used hexes across <style> blocks and inline styles.
  const cssSources = [
    ...(html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []),
    ...(html.match(/\bstyle\s*=\s*"[^"]*"/gi) || []),
  ].join("\n");
  for (const hex of rankCssColors(cssSources)) push(hex);

  return out.slice(0, 3);
}

/** First few same-page stylesheet URLs, for colour mining when the HTML has none inline. */
export function extractStylesheetUrls(html: string, baseUrl: string, max = 2): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, "rel") || "";
    if (!/stylesheet/i.test(rel)) continue;
    const href = attr(tag, "href");
    const resolved = href ? resolveUrl(href, baseUrl) : null;
    if (resolved) out.push(resolved);
    if (out.length >= max) break;
  }
  return out;
}


// ─── Public API ──────────────────────────────────────────────────────

export function extractBrandAssetRefs(html: string, baseUrl: string): BrandAssetRefs {
  const logoRaw =
    jsonLdLogo(html) ||
    headerImgLogo(html) ||
    linkIcon(html, /apple-touch-icon/i) ||
    linkIcon(html, /^icon$|\bicon\b/i);

  const ogRaw =
    html.match(/<meta\s+property=["']og:image(?::secure_url)?["']\s+content=["']([^"']+)/i)?.[1] ||
    html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:image["']/i)?.[1] ||
    null;

  return {
    logoUrl: logoRaw ? resolveUrl(logoRaw, baseUrl) : null,
    ogImageUrl: ogRaw ? resolveUrl(ogRaw, baseUrl) : null,
    colors: extractColors(html),
  };
}

/** OpenAI's image edits endpoint only accepts these input formats. */
export function isOpenAiUsableMime(mime: string): boolean {
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp";
}
