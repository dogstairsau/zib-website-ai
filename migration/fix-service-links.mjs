/**
 * Repoint the service-row links on the existing digital-marketing-* location
 * pages to their real destination pages (they previously went to mailto: or to
 * the not-yet-built web-design page). Only touches href on <a class="service-row">.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOCIAL = new Set(["melbourne", "sydney", "brisbane", "adelaide", "canberra", "gold-coast"]);
const WEB = new Set(["melbourne", "adelaide"]);

const citySlug = (file) =>
  file.replace(/^digital-marketing-(agency-)?/, "").replace(/\.html$/, ""); // → melbourne, gold-coast, ...

function destFor(name, slug) {
  if (/strategy/i.test(name)) return null;                       // leave mailto
  if (/seo|search/i.test(name)) return `/seo-${slug}`;           // all SEO cities exist
  if (/google ads|ppc/i.test(name)) return slug === "melbourne" ? "/google-ads-management-agency-melbourne" : "/google-ads";
  if (/social|meta/i.test(name)) return SOCIAL.has(slug) ? `/social-media-marketing-agency-${slug}` : "/social-media-marketing";
  if (/web|ux|design/i.test(name)) return WEB.has(slug) ? `/web-graphic-design-${slug}` : "/web-graphic-design-melbourne";
  return null;
}

const files = (await readdir(ROOT)).filter((f) => /^digital-marketing-.*\.html$/.test(f));
let total = 0;
for (const file of files) {
  const slug = citySlug(file);
  let html = await readFile(join(ROOT, file), "utf8");
  let changed = 0;
  // Match each service-row anchor + the service-name inside it; rewrite href.
  html = html.replace(
    /(<a class="service-row" href=")([^"]*)("[^>]*>[\s\S]*?<span class="service-name">)([^<]*)(<\/span>)/g,
    (m, p1, oldHref, p3, name, p5) => {
      const dest = destFor(name, slug);
      if (!dest || dest === oldHref) return m;
      changed++;
      return p1 + dest + p3 + name + p5;
    }
  );
  if (changed) { await writeFile(join(ROOT, file), html, "utf8"); console.log(`  ✓ ${file}: ${changed} link(s) repointed`); total += changed; }
  else console.log(`  · ${file}: no change`);
}
console.log(`\n  Repointed ${total} service-row links.`);
