/**
 * Wire blog.html's client-side index to the real migrated posts.
 *
 * blog.html ships a hardcoded placeholder `allPosts` array and links cards to
 * `/blog-<slug>.html`. This replaces the array with every published post from
 * the WP export and fixes the card href to `/<slug>` (where the posts live).
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, decodeEntities } from "./lib.mjs";

const CAT_LABEL = {
  seo: "SEO", "search-engine-optimisation": "SEO",
  social: "Social media", "social-media": "Social media",
  "paid-advertising": "Paid advertising", ppc: "Paid advertising",
  "digital-marketing": "Digital marketing", news: "Digital marketing",
  "web-design": "Web design", "content-marketing": "Content marketing",
};
const CAT_FILTER = { // map to blog.html's filter chips
  "SEO": "seo", "Social media": "social", "Paid advertising": "paid-advertising",
  "Digital marketing": "digital-marketing", "Web design": "digital-marketing", "Content marketing": "digital-marketing",
};

const xmlPath = process.argv[2];
const xml = await readFile(xmlPath, "utf8");
const items = xml.split("<item>").slice(1);

const posts = [];
for (const raw of items) {
  const type = (raw.match(/<wp:post_type><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
  const status = (raw.match(/<wp:status><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
  if (type !== "post" || status !== "publish") continue;
  const slug = (raw.match(/<wp:post_name><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
  const title = decodeEntities((raw.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") || "");
  const date = (raw.match(/<wp:post_date><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
  // first category nicename
  const cat = (raw.match(/<category domain="category" nicename="([^"]+)"/) || [])[1] || "digital-marketing";
  const catLabel = CAT_LABEL[cat] || "Digital marketing";
  posts.push({
    slug, title,
    cat: CAT_FILTER[catLabel] || "digital-marketing",
    catLabel,
    date: date ? new Date(date.replace(" ", "T")).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "",
    author: "Zib Digital",
    published: true,
    _sort: date,
  });
}
posts.sort((a, b) => b._sort.localeCompare(a._sort));
posts.forEach((p) => delete p._sort);

const arrayLiteral = "const allPosts = " + JSON.stringify(posts, null, 2).replace(/\n/g, "\n  ") + ";";

let html = await readFile(join(ROOT, "blog.html"), "utf8");
const before = html;
html = html.replace(/const allPosts = \[[\s\S]*?\n  \];/, arrayLiteral);
html = html.replace(/href="\/blog-\$\{escape\(p\.slug\)\}\.html"/, 'href="/${escape(p.slug)}"');
if (html === before) { console.error("  ✗ no replacement made — check anchors in blog.html"); process.exit(1); }
await writeFile(join(ROOT, "blog.html"), html, "utf8");
console.log(`  ✓ blog.html wired to ${posts.length} real posts; card href fixed to /<slug>`);
