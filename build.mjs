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
const LINK_TARGETS = [
  ["search engine optimisation", "/seo-agency"],
  ["SEO agency", "/seo-agency"],
  ["SEO services", "/seo-agency"],
  ["Google Ads", "/google-ads"],
  ["social media marketing", "/social-media-marketing"],
  ["content marketing", "/content-marketing"],
  ["email marketing", "/email-marketing"],
  ["digital marketing agency", "/digital-marketing-agency"],
  ["web design", "/web-graphic-design-melbourne"],
  ["website development", "/website-development"],
];
const MAX_LINKS = 4;

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
    const withHead = bustAssetCache(injectHead(addContextualLinks(renderBlogGrid(expanded)), rel));
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
