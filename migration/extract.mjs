/**
 * SEO migration — content extractor for the old WordPress export.
 *
 * The old zibdigital.com.au site was built with WPBakery/Visual Composer. Page
 * copy is buried in [vc_*] shortcodes, and the differentiated copy (FAQ answers,
 * section intros) is stored as base64-encoded, URL-encoded HTML "islands". This
 * script decodes the islands, strips shortcodes + builder chrome, and writes a
 * readable, de-duplicated copy dump per slug to migration/content/<slug>.txt.
 *
 * Those dumps are the source copy for Phase-1 page porting (verbatim, then
 * re-voiced in Phase 2). Some shared template blocks (process steps, team bios,
 * footer) bleed into the dump — curate per page when assembling the new shell.
 *
 * Usage:
 *   node migration/extract.mjs <path-to-wordpress-export.xml> <slug> [slug2 ...]
 *   node migration/extract.mjs <path-to-wordpress-export.xml> --all   (dumps every page/post/casestudy)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "content");

function clean(contentEncoded) {
  let c = contentEncoded;
  // Decode base64 islands → URL-decoded HTML, inline them.
  c = c.replace(/[A-Za-z0-9+/]{80,}={0,2}/g, (b64) => {
    try {
      const dec = Buffer.from(b64, "base64").toString("utf8");
      if (dec.includes("%3C") || dec.includes("%3E")) return " " + decodeURIComponent(dec) + " ";
    } catch {}
    return b64;
  });
  c = c.replace(/\[[^\]]*\]/g, "");                          // strip VC shortcodes
  c = c.replace(/<ul class="menu-items"[\s\S]*?<\/ul>/g, ""); // old inline nav
  c = c.replace(/<(script|style|iframe)[\s\S]*?<\/\1>/g, "");
  c = c.replace(/<\/(p|h1|h2|h3|h4|h5|li|div)>/gi, "\n");
  c = c.replace(/<br\s*\/?>/gi, "\n");
  c = c.replace(/<[^>]+>/g, "");
  c = c.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
       .replace(/&#8217;|&#039;|&rsquo;/g, "'").replace(/&#8211;|&ndash;/g, "-");
  const seen = new Set();
  return c.split("\n").map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 2 && !seen.has(s) && seen.add(s)).join("\n");
}

const [xmlPath, ...slugs] = process.argv.slice(2);
if (!xmlPath || slugs.length === 0) {
  console.error("Usage: node migration/extract.mjs <export.xml> <slug...|--all>");
  process.exit(1);
}
const xml = await readFile(xmlPath, "utf8");
const items = xml.split("<item>").slice(1);
const all = slugs[0] === "--all";
await mkdir(OUT_DIR, { recursive: true });

let n = 0;
for (const raw of items) {
  const slug = (raw.match(/<wp:post_name><!\[CDATA\[([^\]]*)\]\]><\/wp:post_name>/) || [])[1] || "";
  const type = (raw.match(/<wp:post_type><!\[CDATA\[([^\]]*)\]\]><\/wp:post_type>/) || [])[1] || "";
  const status = (raw.match(/<wp:status><!\[CDATA\[([^\]]*)\]\]><\/wp:status>/) || [])[1] || "";
  if (!slug) continue;
  if (all) {
    if (!["page", "post", "casestudy"].includes(type) || status !== "publish") continue;
  } else if (!slugs.includes(slug)) continue;
  const content = (raw.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/) || [])[1] || "";
  const text = clean(content);
  await writeFile(join(OUT_DIR, `${slug}.txt`), text, "utf8");
  console.log(`  ✓ ${slug}.txt (${type}, ${text.split("\n").length} lines)`);
  n++;
}
console.log(`\n  Extracted ${n} page(s) → migration/content/`);
