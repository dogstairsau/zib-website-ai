/**
 * Zib Digital — static build
 *
 * Walks every .html file in the project root, expands `<!-- @include path -->`
 * markers (paths are relative to the project root), and writes the result to
 * /dist/. Static assets (assets/, api/) are copied as-is.
 *
 * Usage: node build.mjs
 */

import { readFile, writeFile, readdir, mkdir, rm, copyFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(ROOT, "dist");

// Canonical host for the new site (replaces the old WP domain).
const HOST = "https://zibdigital.com.au";
const OG_IMAGE = `${HOST}/assets/og-default.png`;

// Cache-bust shared assets that are referenced (not hashed) across every page.
// base.css/fonts.css have stable URLs, so without a version query a browser or
// CDN can keep serving a stale copy after a deploy — which silently breaks
// newer CSS (e.g. the mobile nav dropdown rules). We append ?v=<content-hash>
// so any change to the file produces a fresh URL.
const VERSIONED_ASSETS = ["assets/base.css", "assets/fonts.css", "assets/partners.js"];
const ASSET_VERSIONS = new Map(); // "/assets/base.css" -> "?v=abcd1234"

async function computeAssetVersions() {
  for (const rel of VERSIONED_ASSETS) {
    try {
      const buf = await readFile(join(ROOT, rel));
      const hash = createHash("sha1").update(buf).digest("hex").slice(0, 8);
      ASSET_VERSIONS.set(`/${rel}`, `?v=${hash}`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
}

/** Append ?v=<hash> to references of the versioned assets in a page. */
function bustAssetCache(html) {
  let out = html;
  for (const [path, ver] of ASSET_VERSIONS) {
    // Match href/src="/assets/x.css" that doesn't already carry a query.
    const re = new RegExp(`((?:href|src)=["'])${path.replace(/[.]/g, "\\$&")}(["'?])`, "g");
    out = out.replace(re, (_m, pre, tail) => `${pre}${path}${ver}${tail === "?" ? "&" : tail}`);
  }
  return out;
}

const decode = (s) => s
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'");
const attrEsc = (s) => decode(s)
  .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Map a built file's path (relative to /dist) to its clean canonical URL. */
function canonicalFor(relPath) {
  let p = relPath.replace(/\\/g, "/").replace(/\.html$/, "");
  if (p === "index" || p === "") return `${HOST}/`;
  p = p.replace(/\/index$/, "");
  return `${HOST}/${p}`;
}

/** Clean leaf label for a breadcrumb: the title up to its first separator. */
function leafName(title) {
  return title.split(/\s+[·—–|]\s+|\s+-\s+/)[0].trim() || "Zib Digital";
}

/**
 * Build a BreadcrumbList JSON-LD block for an indexable page. Home is always
 * the root; blog posts nest under Field notes and case studies under Case
 * studies (detected from the page's own BlogPosting/Article schema). Everything
 * else is a flat Home → Page trail. Returns "" when no breadcrumb applies.
 */
function breadcrumbFor(html, relPath, canonical, title) {
  // Home needs no breadcrumb; never add to noindex or already-tagged pages.
  if (canonical === `${HOST}/`) return "";
  if (/name=["']robots["'][^>]*noindex/i.test(html)) return "";
  if (/"BreadcrumbList"/.test(html)) return "";

  const rel = relPath.replace(/\\/g, "/");
  const items = [{ name: "Home", item: `${HOST}/` }];
  if (rel.startsWith("casestudy/") || /"@type":\s*"Article"/.test(html)) {
    items.push({ name: "Case studies", item: `${HOST}/case-studies` });
  } else if (/"@type":\s*"BlogPosting"/.test(html)) {
    items.push({ name: "Field notes", item: `${HOST}/blog` });
  }
  items.push({ name: leafName(title), item: canonical });

  const elements = items.map((it, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: it.name,
    item: it.item,
  }));
  const graph = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: elements,
  };
  return `<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n</script>\n`;
}

const stripTags = (s) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * Auto-generate FAQPage JSON-LD from a page's visible .faq-item markup
 * (button.faq-q holds the question, div.faq-a holds the answer). Skips pages
 * that already declare FAQPage and noindex pages. Returns "" when nothing
 * usable is found.
 */
function faqFor(html) {
  if (/"FAQPage"/.test(html)) return "";
  if (/name=["']robots["'][^>]*noindex/i.test(html)) return "";

  const questions = [...html.matchAll(/<button[^>]*class="[^"]*faq-q[^"]*"[^>]*>\s*<span>([\s\S]*?)<\/span>/g)]
    .map((m) => stripTags(m[1]));
  const answers = [...html.matchAll(/<div class="faq-a">([\s\S]*?)<\/div>/g)]
    .map((m) => stripTags(m[1]));
  if (questions.length < 2 || questions.length !== answers.length) return "";

  const graph = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((q, i) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: answers[i] },
    })),
  };
  return `<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n</script>\n`;
}

/**
 * Server-render the blog index post cards at build time.
 *
 * The grid used to be built entirely in the browser (`grid.innerHTML = ...`),
 * which meant not one blog post URL existed as an <a href> anywhere in the
 * shipped HTML. All 71 posts were orphans: nothing linked to them, so no
 * internal link equity reached them and discovery depended on Google rendering
 * JS. Search Console showed the result — a large "Crawled/Discovered, currently
 * not indexed" bucket.
 *
 * Now every card is emitted statically from the same `allPosts` array the page
 * already declares (single source of truth — the client script reads it too).
 * The client filters by toggling `hidden` on these nodes instead of rebuilding
 * innerHTML, so every post anchor stays in the DOM in both the raw and the
 * rendered HTML.
 */
function renderBlogGrid(html) {
  const GRID_RE = /(<div class="blog-grid reveal-stagger" id="postGrid">)(<\/div>)/;
  if (!GRID_RE.test(html)) return html;

  const m = html.match(/const allPosts = (\[[\s\S]*?\n  \]);/);
  if (!m) return html;

  let posts;
  try {
    posts = JSON.parse(m[1]).filter((p) => p.published);
  } catch {
    return html; // malformed data — leave the page alone rather than ship junk
  }
  if (!posts.length) return html;

  const cards = posts
    .map((p) => {
      const thumb = p.img
        ? `<div class="post-thumb has-img" data-cat="${attrEsc(p.cat)}" aria-hidden="true"><img class="post-thumb-img" src="${attrEsc(p.img)}" alt="" loading="lazy" width="640" height="360"></div>`
        : `<div class="post-thumb" data-cat="${attrEsc(p.cat)}" aria-hidden="true"><div class="post-thumb-mark">${attrEsc(p.title.split(":")[0])}</div></div>`;
      return (
        `<a class="post-card" href="/${attrEsc(p.slug)}" data-cat="${attrEsc(p.cat)}">` +
        thumb +
        `<div class="post-cat">${attrEsc(p.catLabel)}</div>` +
        `<h2 class="post-title">${attrEsc(p.title)}</h2>` +
        `<div class="post-meta">${attrEsc(p.date)} · ${attrEsc(p.author)}</div>` +
        `</a>`
      );
    })
    .join("\n      ");

  return html.replace(GRID_RE, `$1\n      ${cards}\n    $2`);
}

/**
 * Add contextual in-body links from blog posts into the commercial pages.
 *
 * Search Console showed a completely flat internal link graph: almost every URL
 * had an identical 143–144 inbound internal links, i.e. the nav and footer and
 * nothing else. A PDF carried the same count as the top revenue pages, so
 * nothing signalled which pages matter.
 *
 * This links the first plain-text occurrence of a commercial phrase in a blog
 * post to the page that owns that term, with the phrase itself as the anchor.
 * Deliberately conservative:
 *   - blog posts only (detected via BlogPosting schema), never service pages
 *   - inside <p> only, and never in a paragraph that already contains a link
 *   - text nodes only — never inside a tag, attribute or heading
 *   - one link per phrase, MAX_LINKS per page, and never a duplicate of a
 *     target the page already links to
 */
// Ordered by need, not by importance: the first match in a paragraph wins, so
// pages that currently receive no editorial links at all sit at the top. The
// broad service terms at the bottom already have plenty of inbound links and
// only pick up whatever is left.
const LINK_TARGETS = [
  // Commercial pages that had zero body-inbound links.
  ["Shopify SEO", "/shopify-seo"],
  ["Instagram advertising", "/instagram-marketing-melbourne"],
  ["Instagram marketing", "/instagram-marketing-melbourne"],
  ["LinkedIn advertising", "/linkedin-marketing-agency-melbourne"],
  ["LinkedIn marketing", "/linkedin-marketing-agency-melbourne"],
  ["Facebook advertising", "/facebook-marketing-melbourne"],
  ["Facebook marketing", "/facebook-marketing-melbourne"],
  ["ecommerce SEO", "/ecommerce-seo-melbourne"],
  ["real estate marketing", "/real-estate-digital-marketing"],
  ["website development", "/website-development"],
  // Worst click-through ratio on the site — 65,694 impressions, 6 clicks.
  ["Google Ads management", "/google-ads-management-agency-melbourne"],
  ["Google Ads agency", "/google-ads-management-agency-melbourne"],
  // Broad service terms, already well linked.
  ["search engine optimisation", "/seo-agency"],
  ["SEO agency", "/seo-agency"],
  ["SEO services", "/seo-agency"],
  ["Google Ads", "/google-ads"],
  ["social media marketing", "/social-media-marketing"],
  ["content marketing", "/content-marketing"],
  ["email marketing", "/email-marketing"],
  ["digital marketing agency", "/digital-marketing-agency"],
  ["web design", "/web-graphic-design-melbourne"],
];
const MAX_LINKS = 5;

/**
 * Blog post metadata, read once from the blog index's allPosts array so the
 * related-posts blocks and the index grid never drift apart.
 */
let POSTS = [];
async function loadPosts() {
  try {
    const html = await readFile(join(ROOT, "blog.html"), "utf8");
    const m = html.match(/const allPosts = (\[[\s\S]*?\n  \]);/);
    POSTS = m ? JSON.parse(m[1]).filter((p) => p.published) : [];
  } catch {
    POSTS = [];
  }
}

/**
 * Append a "Related reading" block to each blog post.
 *
 * Before this, a post's only inbound internal link was the card on /blog — 71
 * posts sitting on one link each, with no topical clustering at all. Same
 * category first, topped up with the most recent posts, so every post both
 * gives and receives editorial links within its own subject area.
 */
function addRelatedPosts(html, relPath) {
  if (!/"@type":\s*"BlogPosting"/.test(html)) return html;
  if (/class="post-related"/.test(html)) return html;
  if (!POSTS.length) return html;

  const slug = relPath.replace(/\\/g, "/").replace(/\.html$/, "");
  const self = POSTS.find((p) => p.slug === slug);
  if (!self) return html;

  const others = POSTS.filter((p) => p.slug !== slug);
  const picked = [
    ...others.filter((p) => p.cat === self.cat),
    ...others.filter((p) => p.cat !== self.cat),
  ].slice(0, 3);
  if (picked.length < 2) return html;

  const items = picked
    .map(
      (p) =>
        `<li><a href="/${attrEsc(p.slug)}">${attrEsc(p.title)}</a>` +
        `<span class="post-related-meta">${attrEsc(p.catLabel)} · ${attrEsc(p.date)}</span></li>`
    )
    .join("\n        ");

  const block =
    `<section class="post-related">\n` +
    `  <div class="container">\n` +
    `    <h2>Related reading</h2>\n` +
    `    <ul>\n        ${items}\n    </ul>\n` +
    `    <a class="post-related-all" href="/blog">All field notes <span aria-hidden="true">→</span></a>\n` +
    `  </div>\n</section>\n`;

  if (/<section class="post-cta">/.test(html)) {
    return html.replace(/<section class="post-cta">/, `${block}<section class="post-cta">`);
  }
  return html.replace(/<\/main>/i, `${block}</main>`);
}

function addContextualLinks(html) {
  if (!/"@type":\s*"BlogPosting"/.test(html)) return html;

  // Only count links that already exist in the ARTICLE BODY. The footer links
  // every one of these targets on every page, so excluding footer hits would
  // leave nothing to do — and boilerplate template links are exactly what
  // Google discounts. An editorial in-body link with a descriptive anchor is
  // the thing that actually differentiates the graph, and it precedes the
  // footer in the DOM.
  const bodyLinks = new Set(
    [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].flatMap((p) =>
      [...p[1].matchAll(/<a\b[^>]*href=["'](\/[^"'#?]*)["']/gi)].map((m) => m[1].replace(/\/$/, ""))
    )
  );
  const pending = LINK_TARGETS.filter(([, href]) => !bodyLinks.has(href));
  if (!pending.length) return html;

  let added = 0;

  return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner) => {
    if (added >= MAX_LINKS) return full;
    if (/<a\b/i.test(inner)) return full; // never nest a link

    // Walk tags and text separately so we only ever touch text nodes.
    const parts = inner.split(/(<[^>]+>)/);
    let touched = false;

    for (let i = 0; i < parts.length && added < MAX_LINKS; i++) {
      if (parts[i].startsWith("<")) continue;
      for (let t = 0; t < pending.length; t++) {
        const [phrase, href] = pending[t];
        const re = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const m = parts[i].match(re);
        if (!m) continue;
        parts[i] = parts[i].replace(re, `<a href="${href}">${m[0]}</a>`);
        pending.splice(t, 1);
        added++;
        touched = true;
        break;
      }
    }
    if (!touched) return full;
    return full.replace(inner, parts.join(""));
  });
}

/**
 * Cross-link service hubs to their specialist pages.
 *
 * Blog copy alone never mentions the narrow specialisms often enough to reach
 * them — /shopify-seo, /ecommerce-seo-melbourne and /real-estate-digital-marketing
 * still had zero editorial inbound links after the contextual pass. These are
 * curated hub → specialist links with descriptive anchors, which is also how a
 * crawler learns the hierarchy: hub owns the head term, specialists own the
 * long tail beneath it.
 */
const RELATED_SERVICES = {
  "seo-agency": [
    ["/shopify-seo", "Shopify SEO", "Collection and product search demand for Shopify stores."],
    ["/ecommerce-seo-melbourne", "Ecommerce SEO", "Category-level search for online retailers."],
    ["/seo-melbourne", "SEO Melbourne", "Our home market, and the one we prove ourselves in."],
  ],
  "seo-melbourne": [
    ["/ecommerce-seo-melbourne", "Ecommerce SEO Melbourne", "Search for Melbourne online retailers."],
    ["/shopify-seo", "Shopify SEO", "Built around collection and product search demand."],
    ["/digital-marketing-agency-melbourne", "Digital marketing Melbourne", "Every channel as one commercial system."],
  ],
  "social-media-marketing": [
    ["/instagram-marketing-melbourne", "Instagram advertising", "Managed against cost per acquisition, not reach."],
    ["/facebook-marketing-melbourne", "Facebook advertising", "Meta campaigns measured on pipeline."],
    ["/linkedin-marketing-agency-melbourne", "LinkedIn marketing", "B2B demand generation for considered buyers."],
  ],
  "google-ads": [
    ["/google-ads-management-agency-melbourne", "Google Ads management Melbourne", "Local PPC managed on return, not clicks."],
    ["/google-shopping-agency-melbourne", "Google Shopping", "Feed and campaign management for retailers."],
  ],
  "digital-marketing-agency": [
    ["/real-estate-digital-marketing", "Real estate marketing", "Listings, agents and vendor lead generation."],
    ["/website-development", "Website development", "Sites built to convert the traffic you earn."],
    ["/web-graphic-design-melbourne", "Web design Melbourne", "Design measured on enquiries, not awards."],
  ],
  "website-development": [
    ["/web-graphic-design-melbourne", "Web design Melbourne", "The design layer on top of the build."],
    ["/shopify-developer-melbourne", "Shopify developers", "Ecommerce builds on Shopify."],
  ],
  "content-marketing": [
    ["/content-marketing-agency-melbourne", "Content marketing Melbourne", "Local content mapped to commercial search."],
  ],
};

function addRelatedServices(html, relPath) {
  const slug = relPath.replace(/\\/g, "/").replace(/\.html$/, "");
  const items = RELATED_SERVICES[slug];
  if (!items || /class="svc-related"/.test(html)) return html;

  const cards = items
    .map(
      ([href, label, blurb]) =>
        `<a class="svc-related-card" href="${href}">` +
        `<span class="svc-related-name">${attrEsc(label)}</span>` +
        `<span class="svc-related-desc">${attrEsc(blurb)}</span></a>`
    )
    .join("\n        ");

  const block =
    `<section class="svc-related">\n  <div class="container">\n` +
    `    <h2>Related services</h2>\n    <div class="svc-related-grid">\n        ${cards}\n    </div>\n` +
    `  </div>\n</section>\n`;

  return /<\/main>/i.test(html) ? html.replace(/<\/main>/i, `${block}</main>`) : html;
}

/**
 * Link matching case studies from the service pages they prove.
 *
 * Case studies averaged 1.5 editorial inbound links each — effectively just
 * their card on /case-studies — so the proof assets carried no weight and the
 * service pages never pointed at their own evidence. Cards are read from
 * /case-studies at build time (single source of truth) and matched on the
 * service prefix in their tag.
 *
 * The selection ROTATES by page so sibling city pages cite different case
 * studies. Linking the same three from all fifteen SEO pages would just rebuild
 * the flat footer pattern this is meant to fix.
 */
let CASE_STUDIES = [];
async function loadCaseStudies() {
  try {
    const html = await readFile(join(ROOT, "case-studies.html"), "utf8");
    CASE_STUDIES = [
      ...html.matchAll(
        /<a class="ch-card" href="(\/casestudy\/[^"]+)">\s*<div class="ch-tag mono">([^<]*)<\/div>\s*<h2>([^<]*)<\/h2>/g
      ),
    ].map((m) => ({
      href: m[1],
      tag: m[2].trim(),
      // 20 of the 33 cards lead with "<Client> Digital Marketing Case Study"
      // rather than a result. Strip that boilerplate so the anchor reads as the
      // client name; the 13 cards that do carry a metric are left untouched.
      result: m[3].trim().replace(/\s*Digital Marketing Case Study\s*$/i, "").replace(/\s*Case Study\s*$/i, ""),
    }));
  } catch {
    CASE_STUDIES = [];
  }
}

/** Which case-study service tag a given page should cite, if any. */
function serviceFor(slug) {
  if (/^seo-|^ecommerce-seo|^shopify-seo/.test(slug)) return /SEO/i;
  if (/google-ads|google-shopping/.test(slug)) return /Google Ads|Google Business/i;
  if (/^social-media|instagram|facebook|linkedin/.test(slug)) return /Social media|Meta/i;
  if (/web-graphic|website-development|shopify-developer/.test(slug)) return /Web & design/i;
  return null;
}

function addCaseStudyProof(html, relPath) {
  const slug = relPath.replace(/\\/g, "/").replace(/\.html$/, "");
  const re = serviceFor(slug);
  if (!re || !CASE_STUDIES.length || /class="svc-proof"/.test(html)) return html;

  const pool = CASE_STUDIES.filter((c) => re.test(c.tag));
  if (pool.length < 2) return html;

  // Location-aware selection: a city page should cite same-city work before
  // anything else — "418 enquiries for a Melbourne pool fencing company" on
  // /seo-melbourne is proof; the same study on /seo-adelaide is trivia. The 13
  // newer study cards carry "Service · Industry · Location" tags; match the
  // page's city against that, then the state, then national work. Rotation
  // still spreads the remainder so sibling pages don't all cite the same set.
  const CITY_MATCH = {
    melbourne: /Melbourne/i,
    sydney: /Sydney/i,
    brisbane: /Brisbane|QLD/i,
    "gold-coast": /Gold Coast|QLD/i,
    adelaide: /Adelaide|South Australia/i,
    canberra: /Canberra|ACT/i,
    geelong: /Geelong|Melbourne/i, // nearest market with citable work
    perth: /Perth|WA/i,
  };
  const cityKey = Object.keys(CITY_MATCH).find((c) => slug.includes(c));
  const cityRe = cityKey ? CITY_MATCH[cityKey] : null;
  // Vertical pages match on industry before geography — an ecommerce result is
  // better proof on /shopify-seo than a same-city service business.
  const industryRe = /shopify|ecommerce|woocommerce/.test(slug) ? /Ecommerce/i : null;

  let seed = 0;
  for (const ch of slug) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rotate = (arr) => arr.map((_, i) => arr[(seed + i) % arr.length]);

  const taken = new Set();
  const take = (re) => (re ? pool.filter((c) => !taken.has(c) && re.test(c.tag) && taken.add(c)) : []);
  const industry = take(industryRe);
  const local = take(cityRe);
  const national = take(/National|Australia/i);
  const rest = pool.filter((c) => !taken.has(c));
  const picked = [...industry, ...local, ...rotate(national), ...rotate(rest)].slice(0, 3);

  const cards = picked
    .map(
      (c) =>
        `<a class="svc-proof-card" href="${c.href}">` +
        `<span class="svc-proof-result">${attrEsc(c.result)}</span>` +
        `<span class="svc-proof-tag">${attrEsc(c.tag)}</span></a>`
    )
    .join("\n        ");

  const block =
    `<section class="svc-proof">\n  <div class="container">\n` +
    `    <h2>Proof</h2>\n    <div class="svc-proof-grid">\n        ${cards}\n    </div>\n` +
    `    <a class="svc-proof-all" href="/case-studies">All case studies <span aria-hidden="true">→</span></a>\n` +
    `  </div>\n</section>\n`;

  return /<\/main>/i.test(html) ? html.replace(/<\/main>/i, `${block}</main>`) : html;
}

/**
 * Inject a self-referencing canonical + Open Graph / Twitter Card tags before
 * </head>. Canonical is added only if absent; the OG block only if the page
 * doesn't already declare its own (so bespoke pages keep theirs).
 */
function injectHead(html, relPath) {
  if (!/<\/head>/i.test(html)) return html;
  const canonical = canonicalFor(relPath);
  const titleM = html.match(/<title>([\s\S]*?)<\/title>/i);
  const descM = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i);
  const title = titleM ? decode(titleM[1].trim()) : "Zib Digital";
  const desc = descM ? decode(descM[1].trim()) : "";
  let tags = breadcrumbFor(html, relPath, canonical, title) + faqFor(html);
  if (!/rel=["']canonical["']/i.test(html)) {
    tags += `<link rel="canonical" href="${canonical}">\n`;
  }
  if (!/property=["']og:title["']/i.test(html)) {
    tags +=
      `<meta property="og:type" content="website">\n` +
      `<meta property="og:site_name" content="Zib Digital">\n` +
      `<meta property="og:locale" content="en_AU">\n` +
      `<meta property="og:title" content="${attrEsc(title)}">\n` +
      (desc ? `<meta property="og:description" content="${attrEsc(desc)}">\n` : "") +
      `<meta property="og:url" content="${canonical}">\n` +
      `<meta property="og:image" content="${OG_IMAGE}">\n` +
      `<meta name="twitter:card" content="summary_large_image">\n` +
      `<meta name="twitter:title" content="${attrEsc(title)}">\n` +
      (desc ? `<meta name="twitter:description" content="${attrEsc(desc)}">\n` : "") +
      `<meta name="twitter:image" content="${OG_IMAGE}">\n`;
  }
  return tags ? html.replace(/<\/head>/i, `${tags}</head>`) : html;
}

// <!-- @include _partials/nav.html -->  (non-global; matchAll uses /g locally)
const INCLUDE_RE_SRC = "<!--\\s*@include\\s+([^\\s]+?)\\s*-->";

/** Recursively expand @include markers. Paths resolve from project root. */
async function expand(html, depth = 0) {
  if (depth > 12) throw new Error("Include depth exceeded — possible cycle");
  // Materialise matches up front so recursion can't disturb regex state.
  const matches = [...html.matchAll(new RegExp(INCLUDE_RE_SRC, "g"))];
  if (matches.length === 0) return html;
  let out = "";
  let last = 0;
  for (const m of matches) {
    out += html.slice(last, m.index);
    const partialPath = resolve(ROOT, m[1]);
    if (!partialPath.startsWith(ROOT)) {
      throw new Error(`Refusing to read outside project root: ${m[1]}`);
    }
    let content;
    try {
      content = await readFile(partialPath, "utf8");
    } catch (e) {
      throw new Error(`Missing partial: ${m[1]} (${e.code || e.message})`);
    }
    out += await expand(content, depth + 1);
    last = m.index + m[0].length;
  }
  out += html.slice(last);
  return out;
}

async function copyDir(src, dest) {
  let entries;
  try {
    entries = await readdir(src, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return; // skip missing dirs
    throw e;
  }
  await mkdir(dest, { recursive: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(s, d);
    else await copyFile(s, d);
  }
}

// Directories that should never be traversed for HTML processing.
const SKIP_DIRS = new Set(["dist", "node_modules", "assets", "api", "lib", ".git", ".claude", ".vercel"]);

async function processHtmlTree(srcDir, destDir, counter) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    // Skip hidden + underscore-prefixed (partials/drafts/templates)
    if (entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const subDest = join(destDir, entry.name);
      await mkdir(subDest, { recursive: true });
      await processHtmlTree(join(srcDir, entry.name), subDest, counter);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".html")) continue;
    const html = await readFile(join(srcDir, entry.name), "utf8");
    const expanded = await expand(html);
    const rel = join(destDir, entry.name).slice(OUT.length + 1);
    const linked = addCaseStudyProof(
      addRelatedServices(addRelatedPosts(addContextualLinks(renderBlogGrid(expanded)), rel), rel),
      rel
    );
    const withHead = bustAssetCache(injectHead(linked, rel));
    await writeFile(join(destDir, entry.name), withHead, "utf8");
    counter.count++;
    console.log(`  ✓ ${rel}`);
  }
}

async function build() {
  const start = Date.now();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  // Hash shared assets up front so every page can reference a versioned URL.
  await computeAssetVersions();

  // Blog + case-study metadata for the related/proof blocks.
  await loadPosts();
  await loadCaseStudies();

  // Copy static asset folders
  await copyDir(join(ROOT, "assets"), join(OUT, "assets"));

  // Copy root-level static files that aren't .html (robots.txt, llms.txt,
  // sitemap.xml, favicon.ico, etc). Silently skip any that don't exist.
  for (const name of ["robots.txt", "llms.txt", "sitemap.xml", "favicon.ico"]) {
    try {
      await copyFile(join(ROOT, name), join(OUT, name));
      console.log(`  ✓ ${name} (static)`);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }

  // Process every .html file, recursing into non-skipped subdirectories
  const counter = { count: 0 };
  await processHtmlTree(ROOT, OUT, counter);

  const ms = Date.now() - start;
  console.log(`\n  Built ${counter.count} pages in ${ms}ms → /dist`);
}

// Allow this module to be imported (used by dev-server) AND run directly
export { expand, renderBlogGrid };

// Run build() when invoked directly (e.g. `node build.mjs`).
// We detect this by checking the entry script's resolved path against this module's URL.
const entry = process.argv[1] ? new URL(process.argv[1], `file://${process.cwd()}/`).href : "";
if (entry === import.meta.url) {
  build().catch((e) => {
    console.error("\n  Build failed:", e.message);
    process.exit(1);
  });
}
