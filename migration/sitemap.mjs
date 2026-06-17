/**
 * Generate sitemap.xml from the built /dist tree.
 *
 * Canonical host: https://zibdigital.com.au (new site replaces the old WP site).
 * Includes every built .html page EXCEPT those marked noindex or on the
 * private-client exclude list. Run after `node build.mjs`; writes sitemap.xml to
 * the project root (the next build copies it into /dist).
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const HOST = "https://zibdigital.com.au";

// Private client pitches / drafts that must never be indexed even if the
// robots meta is missing.
const EXCLUDE = new Set([
  "alchemy-construct", "archer-scott-lawyers", "australian-infinity-hospitality-solutions",
  "Mad-Mex-SEO-GEO-Opportunity", "sandra", "prompt-research", "meta-ads-lab", "roi-calculator",
  "ai-growth-simulator", "zib-os", "ai-readiness", "automation-map", "audit", "ai-partner", "p/matt/apiam-animal-health",
]);

async function walk(dir) {
  let out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(await walk(p));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const files = await walk(DIST);
const today = new Date().toISOString().slice(0, 10);
const urls = [];

for (const f of files) {
  const rel = relative(DIST, f).replace(/\\/g, "/");
  const slug = rel.replace(/\.html$/, "").replace(/\/index$/, "");
  if (EXCLUDE.has(slug)) continue;
  const html = await readFile(f, "utf8");
  if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) continue;
  const loc = slug === "index" ? `${HOST}/` : `${HOST}/${slug}`;
  // priority heuristic: home 1.0, hubs/locations .9, case studies/blog .6
  let priority = "0.7";
  if (slug === "index") priority = "1.0";
  else if (/^(seo|google-ads|social-media|web-graphic|digital-marketing|content-marketing|ai-)/.test(slug)) priority = "0.9";
  else if (slug.startsWith("casestudy/") || /^(20|how|why|what|when)/.test(slug)) priority = "0.6";
  urls.push({ loc, priority });
}

urls.sort((a, b) => a.loc.localeCompare(b.loc));
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${today}</lastmod>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
await writeFile(join(ROOT, "sitemap.xml"), xml, "utf8");
console.log(`  ✓ sitemap.xml — ${urls.length} URLs on ${HOST}`);
