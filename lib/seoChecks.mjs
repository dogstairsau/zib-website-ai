/**
 * Deterministic SEO / AEO audit checks (multi-page, up to 10 URLs).
 * Pure regex over HTML we crawl. Edge-runtime safe. Zero third-party SEO APIs.
 *
 * Flow:
 *   1. fetchSupporting(url)  → robots.txt + sitemap + redirect chain for the main URL
 *   2. crawlSite(url, html, support, limit) → fetches up to N pages in parallel
 *   3. buildAudit({ url, pages, support, psi }) → 8 categories, ~28 checks, aggregated
 */

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

const metaContent = (html, name) => {
  const byName = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"));
  if (byName) return byName[1];
  const rev = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${name}["']`, "i"));
  return rev ? rev[1] : null;
};

const ogContent = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]*property=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"));
  if (m) return m[1];
  const rev = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${prop}["']`, "i"));
  return rev ? rev[1] : null;
};

const categoryScore = (checks) => {
  if (!checks.length) return 100;
  const w = (c) => c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0;
  return Math.round((checks.reduce((a, c) => a + w(c), 0) / checks.length) * 100);
};

const ok = (id, title, value) => ({ id, title, status: "pass", value });
const warn = (id, title, value) => ({ id, title, status: "warn", value });
const bad = (id, title, value) => ({ id, title, status: "fail", value });

// ──────────────────────────────────────────────────────────────────
// Supporting fetches (robots.txt + sitemap pointer + redirect chain)
// ──────────────────────────────────────────────────────────────────

export async function fetchSupporting(url) {
  const origin = new URL(url).origin;

  let robotsStatus = 0, robotsText = "";
  try {
    const r = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": "ZibAudit/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    robotsStatus = r.status;
    if (r.ok) robotsText = (await r.text()).slice(0, 8000);
  } catch {}

  let sitemapDiscovered = false, sitemapStatus = 0, sitemapUrl = "";
  const sitemapLine = robotsText.match(/^\s*sitemap:\s*(\S+)/im);
  sitemapUrl = sitemapLine?.[1] || `${origin}/sitemap.xml`;
  try {
    const s = await fetch(sitemapUrl, {
      method: "GET",
      headers: { "User-Agent": "ZibAudit/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    sitemapStatus = s.status;
    sitemapDiscovered = s.ok;
  } catch {}

  let mainStatus = 0, redirected = false, finalUrl = url, redirectHops = 0;
  try {
    let current = url;
    for (let i = 0; i < 3; i++) {
      const r = await fetch(current, {
        method: "GET",
        headers: { "User-Agent": "ZibAudit/1.0", Accept: "text/html" },
        redirect: "manual",
        signal: AbortSignal.timeout(6_000),
      });
      mainStatus = r.status;
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) break;
        redirected = true;
        redirectHops++;
        current = new URL(loc, current).href;
      } else {
        finalUrl = current;
        break;
      }
    }
  } catch {
    mainStatus = 200;
  }

  return { robotsStatus, robotsText, sitemapDiscovered, sitemapStatus, sitemapUrl, mainStatus, redirected, redirectHops, finalUrl };
}

// ──────────────────────────────────────────────────────────────────
// URL discovery — sitemap first, internal links as fallback
// ──────────────────────────────────────────────────────────────────

async function fetchSitemapUrls(sitemapUrl, origin, depth = 0) {
  if (depth > 1) return []; // prevent infinite sitemap-index recursion
  try {
    const res = await fetch(sitemapUrl, {
      headers: { "User-Agent": "ZibAudit/1.0", Accept: "application/xml,text/xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const xml = (await res.text()).slice(0, 400_000);

    // Sitemap index? Fetch the first nested sitemap and recurse.
    if (/<sitemapindex/i.test(xml)) {
      const firstLoc = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
        .map((m) => m[1])
        .filter((u) => u.startsWith(origin))[0];
      return firstLoc ? fetchSitemapUrls(firstLoc, origin, depth + 1) : [];
    }

    // Regular urlset
    return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]
      .map((m) => m[1])
      .filter((u) => u.startsWith(origin));
  } catch {
    return [];
  }
}

function extractInternalLinks(html, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const urls = [];
  const seen = new Set();
  for (const href of hrefs) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    try {
      const abs = new URL(href, baseUrl);
      if (abs.origin !== origin) continue;
      // Skip assets and weird extensions
      if (/\.(?:pdf|zip|jpg|jpeg|png|gif|svg|webp|mp4|mov|avi|mp3|doc|docx|xls|xlsx|css|js|ico)(?:$|\?)/i.test(abs.pathname)) continue;
      const canonical = abs.origin + abs.pathname.replace(/\/$/, "");
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      urls.push(abs.href);
    } catch {}
  }
  return urls;
}

// ──────────────────────────────────────────────────────────────────
// Crawler — fetch up to N pages in parallel
// ──────────────────────────────────────────────────────────────────

export async function crawlSite(mainUrl, mainHtml, support, limit = 10) {
  const origin = new URL(mainUrl).origin;
  const urls = new Set([mainUrl]);

  // 1. Sitemap-discovered URLs (preferred — represents what the site WANTS crawled)
  if (support.sitemapDiscovered) {
    const sitemapUrls = await fetchSitemapUrls(support.sitemapUrl, origin);
    for (const u of sitemapUrls) {
      urls.add(u);
      if (urls.size >= limit * 2) break;
    }
  }

  // 2. Fall back to internal links from the main page
  if (urls.size < limit) {
    const linkUrls = extractInternalLinks(mainHtml, mainUrl);
    for (const u of linkUrls) {
      urls.add(u);
      if (urls.size >= limit * 2) break;
    }
  }

  const targets = [...urls].slice(0, limit);

  // Main URL already fetched — reuse its HTML
  const mainPage = { url: mainUrl, status: 200, html: mainHtml };

  const fetchOne = async (u) => {
    try {
      const r = await fetch(u, {
        headers: { "User-Agent": "ZibAudit/1.0", Accept: "text/html" },
        redirect: "follow",
        signal: AbortSignal.timeout(8_000),
      });
      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("html")) return { url: u, status: r.status, html: "" };
      const html = await r.text();
      return { url: r.url || u, status: r.status, html };
    } catch {
      return { url: u, status: 0, html: "" };
    }
  };

  const others = targets.filter((u) => u !== mainUrl);
  const fetched = await Promise.all(others.map(fetchOne));
  return [mainPage, ...fetched.filter((p) => p.html.length > 0)];
}

// ──────────────────────────────────────────────────────────────────
// Per-page parsing
// ──────────────────────────────────────────────────────────────────

function parsePage(url, html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const metaDesc = metaContent(html, "description") || "";
  const ogTitle = ogContent(html, "og:title");
  const ogDesc = ogContent(html, "og:description");
  const ogImage = ogContent(html, "og:image");
  const twitterCard = metaContent(html, "twitter:card");
  const twitterImage = metaContent(html, "twitter:image");
  const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1] || null;
  const metaRobots = metaContent(html, "robots") || "";
  const isNoindex = /noindex/i.test(metaRobots);

  const cleanedText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleanedText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const sentences = cleanedText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const avgSentenceLen = sentences.length ? words.length / sentences.length : 0;

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const h2Count = (html.match(/<h2\b/gi) || []).length;
  const h3Count = (html.match(/<h3\b/gi) || []).length;
  const h4Count = (html.match(/<h4\b/gi) || []).length;

  const imgTags = [...html.matchAll(/<img\b([^>]*)>/gi)].map((m) => m[1]);
  const imgsWithoutAlt = imgTags.filter((attrs) => !/\balt=["']/i.test(attrs)).length;

  const hasFavicon = /<link[^>]*rel=["'][^"']*(icon|shortcut icon)[^"']*["']/i.test(html);
  const hasDoctype = /^\s*<!doctype\s+html/i.test(html);

  const jsonldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const schemaTypes = new Set();
  let hasFaqSchema = false;
  for (const m of jsonldBlocks) {
    try {
      const parsed = JSON.parse(m[1]);
      const push = (obj) => {
        const t = obj?.["@type"];
        if (typeof t === "string") schemaTypes.add(t);
        if (Array.isArray(t)) t.forEach((x) => typeof x === "string" && schemaTypes.add(x));
        if (t === "FAQPage" || (Array.isArray(t) && t.includes("FAQPage"))) hasFaqSchema = true;
      };
      if (Array.isArray(parsed)) parsed.forEach(push);
      else if (parsed?.["@graph"]) parsed["@graph"].forEach(push);
      else push(parsed);
    } catch {}
  }

  const origin = new URL(url).origin;
  const allLinks = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  let internalLinks = 0, externalLinks = 0, genericAnchors = 0;
  const generic = /^(click here|read more|learn more|here|more|view|see more)$/i;
  for (const m of allLinks) {
    const href = m[1];
    if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    try {
      const abs = new URL(href, url);
      if (abs.origin === origin) internalLinks++;
      else externalLinks++;
      const anchorText = m[2].replace(/<[^>]+>/g, "").trim();
      if (anchorText && generic.test(anchorText)) genericAnchors++;
    } catch {}
  }

  return {
    url, title, metaDesc, ogTitle, ogDesc, ogImage, twitterCard, twitterImage, canonical,
    isNoindex, isHttps: url.startsWith("https://"),
    wordCount, avgSentenceLen,
    h1Count, h2Count, h3Count, h4Count,
    imgCount: imgTags.length, imgsWithoutAlt,
    hasFavicon, hasDoctype,
    jsonldCount: jsonldBlocks.length, schemaTypes: [...schemaTypes], hasFaqSchema,
    internalLinks, externalLinks, genericAnchors,
  };
}

// ──────────────────────────────────────────────────────────────────
// Aggregator — builds the 8-category audit across N pages
// ──────────────────────────────────────────────────────────────────

export function buildAudit({ url, pages, support }) {
  const parsed = pages.map((p) => parsePage(p.url, p.html));
  const N = parsed.length;

  // Utility: count pages where predicate is true
  const countWhere = (pred) => parsed.filter(pred).length;

  // --- FOUNDATION ---
  const httpsCount = countWhere((p) => p.isHttps);
  const foundation = [
    httpsCount === N
      ? ok("https", "HTTPS coverage", `${N}/${N} crawled page(s) are HTTPS`)
      : httpsCount === 0
      ? bad("https", "HTTPS coverage", `0/${N} pages on HTTPS`)
      : warn("https", "HTTPS coverage", `${httpsCount}/${N} pages on HTTPS`),
    support.robotsStatus === 200
      ? ok("robots_txt", "robots.txt", "robots.txt discovered and reachable")
      : bad("robots_txt", "robots.txt", support.robotsStatus ? `robots.txt returned ${support.robotsStatus}` : "robots.txt not found"),
    support.sitemapDiscovered
      ? ok("sitemap", "XML sitemap", "Sitemap discovered in crawl signals")
      : warn("sitemap", "XML sitemap", "No XML sitemap detected at /sitemap.xml or in robots.txt"),
  ];

  // --- CRAWL & INDEX ---
  const noindexPages = countWhere((p) => p.isNoindex);
  const crawl = [
    noindexPages === 0
      ? ok("indexable", "Non-indexable pages", `${N}/${N} page(s) indexable`)
      : noindexPages < N / 3
      ? warn("indexable", "Non-indexable pages", `${noindexPages} non-indexable page(s) found`)
      : bad("indexable", "Non-indexable pages", `${noindexPages}/${N} pages non-indexable`),
    support.mainStatus >= 200 && support.mainStatus < 400
      ? ok("status", "4xx/5xx status pages", `0 page(s) return 4xx/5xx in crawl`)
      : bad("status", "4xx/5xx status pages", `Main URL returned ${support.mainStatus}`),
    support.redirectHops <= 1
      ? ok("redirect", "Redirect integrity", "0 redirect loop/chain issue(s)")
      : warn("redirect", "Redirect integrity", `${support.redirectHops} redirect hop(s) detected`),
  ];

  // --- CONTENT SEO ---
  const missingMeta = countWhere((p) => !p.metaDesc);
  const shortLongMeta = countWhere((p) => p.metaDesc && (p.metaDesc.length < 70 || p.metaDesc.length > 160));
  const missingH1 = countWhere((p) => p.h1Count === 0);
  const multiH1 = countWhere((p) => p.h1Count > 1);
  const thinPages = countWhere((p) => p.wordCount < 250);
  const avgWords = Math.round(parsed.reduce((a, p) => a + p.wordCount, 0) / N);
  const content = [
    missingMeta === 0 && shortLongMeta === 0
      ? ok("meta_desc", "Meta description coverage", `${N}/${N} pages have a well-sized meta description`)
      : missingMeta === 0
      ? warn("meta_desc", "Meta description coverage", `${shortLongMeta} page(s) outside ideal 70–160 chars`)
      : bad("meta_desc", "Meta description coverage", `${missingMeta} page(s) missing meta description`),
    missingH1 === 0 && multiH1 === 0
      ? ok("h1", "Heading structure (H1)", `${N}/${N} pages have exactly 1 H1`)
      : missingH1 > 0
      ? bad("h1", "Heading structure (H1)", `${missingH1} page(s) missing H1`)
      : warn("h1", "Heading structure (H1)", `${multiH1} page(s) with multiple H1s`),
    thinPages === 0
      ? ok("thin", "Thin content signals", `Avg ${avgWords} words/page — healthy`)
      : thinPages < N / 3
      ? warn("thin", "Thin content signals", `${thinPages} thin page(s) (<250 words)`)
      : bad("thin", "Thin content signals", `${thinPages}/${N} pages thin (<250 words)`),
  ];

  // --- METADATA & CANONICAL ---
  const missingTitle = countWhere((p) => !p.title);
  const badTitleLen = countWhere((p) => p.title && (p.title.length < 30 || p.title.length > 60));
  // Duplicate titles / descriptions across pages
  const titleCounts = {};
  const descCounts = {};
  for (const p of parsed) {
    if (p.title) titleCounts[p.title.toLowerCase()] = (titleCounts[p.title.toLowerCase()] || 0) + 1;
    if (p.metaDesc) descCounts[p.metaDesc.toLowerCase()] = (descCounts[p.metaDesc.toLowerCase()] || 0) + 1;
  }
  const dupeTitles = Object.values(titleCounts).filter((c) => c > 1).reduce((a, c) => a + c, 0);
  const dupeDescs = Object.values(descCounts).filter((c) => c > 1).reduce((a, c) => a + c, 0);

  const missingCanonical = countWhere((p) => !p.canonical);
  const socialMissingCount = countWhere((p) => !(p.ogTitle && p.ogDesc && (p.ogImage || p.twitterImage) && p.twitterCard));

  const meta = [
    missingTitle === 0 && badTitleLen === 0
      ? ok("title_tag", "Missing title tags", `${N}/${N} pages have a well-sized title`)
      : missingTitle === 0
      ? warn("title_tag", "Missing title tags", `${badTitleLen} title(s) outside ideal 30–60 chars`)
      : bad("title_tag", "Missing title tags", `${missingTitle} page(s) missing title tag`),
    dupeTitles === 0 && dupeDescs === 0
      ? ok("dup", "Duplicate title/description", "0 duplicate title/description issue(s) across crawl")
      : warn("dup", "Duplicate title/description", `${dupeTitles + dupeDescs} duplicate title/description issue(s) across crawl`),
    missingCanonical === 0
      ? ok("canonical", "Canonical conflicts", `${N}/${N} pages declare a canonical`)
      : missingCanonical < N / 2
      ? warn("canonical", "Canonical conflicts", `${missingCanonical} page(s) missing canonical`)
      : bad("canonical", "Canonical conflicts", `${missingCanonical}/${N} pages missing canonical`),
    socialMissingCount === 0
      ? ok("social_card", "Social card baseline", `${N}/${N} pages have complete social meta`)
      : socialMissingCount < N / 2
      ? warn("social_card", "Social card baseline", `${socialMissingCount} page(s) missing some social meta (og:title/og:description/og:image/twitter:card)`)
      : bad("social_card", "Social card baseline", `${socialMissingCount}/${N} pages missing social meta`),
  ];

  // --- MEDIA & UX ---
  const totalImgs = parsed.reduce((a, p) => a + p.imgCount, 0);
  const totalAltMissing = parsed.reduce((a, p) => a + p.imgsWithoutAlt, 0);
  const faviconCount = countWhere((p) => p.hasFavicon);
  const socialImageMissing = countWhere((p) => !p.ogImage && !p.twitterImage);
  const doctypeMissing = countWhere((p) => !p.hasDoctype);

  const media = [
    totalAltMissing === 0
      ? ok("alt", "Image alt coverage", `All ${totalImgs} image(s) across crawl have alt text`)
      : totalAltMissing <= Math.max(2, Math.floor(totalImgs * 0.1))
      ? warn("alt", "Image alt coverage", `${totalAltMissing} image-alt issue(s) across ${N} pages`)
      : bad("alt", "Image alt coverage", `${totalAltMissing} image-alt issue(s) across ${N} pages`),
    faviconCount === N
      ? ok("favicon", "Favicon presence", `${N}/${N} pages have a favicon`)
      : warn("favicon", "Favicon presence", `${N - faviconCount} page(s) without favicon`),
    socialImageMissing === 0
      ? ok("social_image", "Social preview image", `${N}/${N} pages have og:image/twitter:image`)
      : socialImageMissing < N / 2
      ? warn("social_image", "Social preview image", `${socialImageMissing} page(s) missing og:image/twitter:image`)
      : bad("social_image", "Social preview image", `${socialImageMissing}/${N} pages missing og:image`),
    doctypeMissing === 0
      ? ok("doctype", "Markup baseline", `0 encoding/doctype issue(s)`)
      : bad("doctype", "Markup baseline", `${doctypeMissing} page(s) missing HTML5 doctype`),
  ];

  // --- ARCHITECTURE & LINKS ---
  const totalInternal = parsed.reduce((a, p) => a + p.internalLinks, 0);
  const totalExternal = parsed.reduce((a, p) => a + p.externalLinks, 0);
  const totalGeneric = parsed.reduce((a, p) => a + p.genericAnchors, 0);
  const shallowPages = countWhere((p) => p.internalLinks < 5);

  const architecture = [
    shallowPages === 0
      ? ok("internal_links", "Internal linking", `${totalInternal} internal link(s) discovered in crawled pages`)
      : warn("internal_links", "Internal linking", `${shallowPages} shallow page(s) (<5 internal links) · ${totalInternal} total`),
    totalExternal >= N
      ? ok("external_links", "Outbound references", `${totalExternal} external link(s) across ${N} pages`)
      : warn("external_links", "Outbound references", `Only ${totalExternal} external link(s) across ${N} pages`),
    totalGeneric === 0
      ? ok("anchor_quality", "Anchor text quality", "No generic anchor text detected")
      : totalGeneric <= 3 * N
      ? warn("anchor_quality", "Anchor text quality", `${totalGeneric} generic anchor(s) ("click here"/"read more") across crawl`)
      : bad("anchor_quality", "Anchor text quality", `${totalGeneric} generic anchor(s) — SEO value loss`),
  ];

  // --- GEO / AEO AUDIT · AI-search readiness ---
  const jsonldPages = countWhere((p) => p.jsonldCount > 0);
  const hasOrgOrSite = parsed.some((p) =>
    p.schemaTypes.includes("Organization") ||
    p.schemaTypes.includes("LocalBusiness") ||
    p.schemaTypes.includes("WebSite"),
  );
  const avgLen = parsed.reduce((a, p) => a + (p.avgSentenceLen || 0), 0) / Math.max(1, N);
  const hierarchySkipped = countWhere((p) => (p.h3Count > 0 && p.h2Count === 0) || (p.h4Count > 0 && p.h3Count === 0));
  const hasFaq = parsed.some((p) => p.hasFaqSchema);
  const allSchemaTypes = [...new Set(parsed.flatMap((p) => p.schemaTypes))].slice(0, 6);

  const geo = [
    jsonldPages === N
      ? ok("entity", "Entity Clarity", `JSON-LD on ${N}/${N} pages: ${allSchemaTypes.join(", ") || "generic"}`)
      : jsonldPages > 0
      ? warn("entity", "Entity Clarity", `${jsonldPages}/${N} pages with JSON-LD structured data`)
      : bad("entity", "Entity Clarity", "No JSON-LD structured data found on any crawled page"),
    hasOrgOrSite
      ? ok("citability", "Citability & Facts", `Organization/WebSite schema detected`)
      : warn("citability", "Citability & Facts", "No Organization/WebSite schema — harder for LLMs to cite you"),
    avgLen === 0
      ? warn("readability", "Readability signals", "Not enough text to measure")
      : avgLen < 22
      ? ok("readability", "Readability signals", `Avg ${avgLen.toFixed(1)} words/sentence across crawl — scannable`)
      : avgLen < 30
      ? warn("readability", "Readability signals", `Avg ${avgLen.toFixed(1)} words/sentence — dense`)
      : bad("readability", "Readability signals", `Avg ${avgLen.toFixed(1)} words/sentence — AI-unfriendly`),
    hierarchySkipped === 0
      ? ok("hierarchy", "Semantic depth", `Clean heading hierarchy across ${N} pages`)
      : warn("hierarchy", "Semantic depth", `${hierarchySkipped} page(s) with skipped heading levels`),
    hasFaq
      ? ok("faq", "FAQ schema", "FAQPage schema detected — AI citation friendly")
      : warn("faq", "FAQ schema", "No FAQPage schema — missed citation opportunity"),
  ];

  const categories = [
    { id: "foundation", label: "Foundation", score: categoryScore(foundation), checks: foundation },
    { id: "crawl", label: "Crawl & Index", score: categoryScore(crawl), checks: crawl },
    { id: "content", label: "Content SEO", score: categoryScore(content), checks: content },
    { id: "meta", label: "Metadata & Canonical", score: categoryScore(meta), checks: meta },
    { id: "media", label: "Media & UX", score: categoryScore(media), checks: media },
    { id: "architecture", label: "Architecture & Links", score: categoryScore(architecture), checks: architecture },
    { id: "geo", label: "GEO / AEO Audit", score: categoryScore(geo), checks: geo },
  ];

  const allChecks = categories.flatMap((c) => c.checks);
  const passed = allChecks.filter((c) => c.status === "pass").length;
  const issues = allChecks.filter((c) => c.status !== "pass").length;
  const overallScore = Math.round(categories.reduce((a, c) => a + c.score, 0) / categories.length);

  return {
    overallScore,
    passed,
    issues,
    pagesCrawled: N,
    categories,
    crawledUrls: parsed.map((p) => p.url),
  };
}
