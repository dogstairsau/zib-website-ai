/**
 * Server-side URL fetch + content extraction.
 * Edge-runtime safe (no jsdom, just regex).
 */

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

export type SiteContent = {
  url: string;
  title: string;
  description: string;
  h1: string;
  h2s: string[];
  bodyText: string;
  rawHtml: string;
};

export async function fetchSiteContent(rawUrl: string): Promise<SiteContent> {
  const url = normaliseUrl(rawUrl);
  if (!url) throw new Error("Invalid URL");

  const res = await fetch(url, {
    headers: {
      "User-Agent": "ZibAudit/1.0 (+https://zibdigital.com.au/audit)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Site responded ${res.status}`);
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

  return { url, title, description, h1, h2s, bodyText, rawHtml: html };
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
