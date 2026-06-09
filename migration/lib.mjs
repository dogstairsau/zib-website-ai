/**
 * Shared helpers for the migration generator: CSV parsing, WP XML parsing,
 * content-dump loading, entity decode, and HTML escaping.
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..");

export function decodeEntities(s = "") {
  return s
    .replace(/&#8217;|&#039;|&rsquo;|&#x2019;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "-")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8230;|&hellip;/g, "...")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export function esc(s = "") {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields w/ commas + "" escapes).
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Read an SF export keyed by Address (URL). Returns Map<url, {col:val}>. */
export async function loadSf(file, cols) {
  const rows = parseCsv(await readFile(join(HERE, "source", file), "utf8"));
  const header = rows[0];
  const idx = Object.fromEntries(cols.map((c) => [c, header.indexOf(c)]));
  const map = new Map();
  for (const r of rows.slice(1)) {
    if (!r[0]) continue;
    const o = {};
    for (const c of cols) o[c] = idx[c] >= 0 ? r[idx[c]] : "";
    map.set(r[0].replace(/\/$/, ""), o); // normalise trailing slash
  }
  return map;
}

/** Parse the WP export into Map<slug, {type,status,title,metadesc,seoTitle,date,link}>. */
export async function loadWp(xmlPath) {
  const xml = await readFile(xmlPath, "utf8");
  const items = xml.split("<item>").slice(1);
  const map = new Map();
  for (const raw of items) {
    const slug = (raw.match(/<wp:post_name><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
    if (!slug) continue;
    const type = (raw.match(/<wp:post_type><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
    const status = (raw.match(/<wp:status><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
    const title = decodeEntities((raw.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.replace(/<!\[CDATA\[|\]\]>/g, "") || "");
    const date = (raw.match(/<wp:post_date><!\[CDATA\[([^\]]*)\]\]>/) || [])[1] || "";
    const link = (raw.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
    const metaOf = (key) => {
      const re = new RegExp("<wp:meta_key><!\\[CDATA\\[" + key + "\\]\\]></wp:meta_key>\\s*<wp:meta_value><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></wp:meta_value>");
      const m = raw.match(re); return m ? decodeEntities(m[1]) : "";
    };
    // first publish wins (avoid revisions clobbering)
    if (map.has(slug) && map.get(slug).status === "publish") continue;
    map.set(slug, { type, status, title, metadesc: metaOf("_yoast_wpseo_metadesc"), seoTitle: metaOf("_yoast_wpseo_title"), date, link });
  }
  return map;
}

const NOISE = [
  /^get in touch$/i, /^let.?s chat$/i, /^find out more$/i, /^want to know more/i,
  /^google reviews$/i, /^read more about our thoughts/i, /^our alliances help you/i,
  /^share your details with us/i, /privacy policy \| terms/i, /^©/, /all rights reserved/i,
  /^book a demo of our roi tool/i, /^\*\s*ytd/i, /^\d+(\.\d+)?$/, /^\d+%$/, /^\d+\+$/,
];
const isNoise = (l) => NOISE.some((re) => re.test(l));

/** Load a content dump's substantive lines. */
export async function loadCopy(slug, { min = 0 } = {}) {
  let txt = "";
  try { txt = await readFile(join(HERE, "content", `${slug}.txt`), "utf8"); } catch { return []; }
  return txt.split("\n").map((l) => l.trim()).filter((l) => l.length > min && !isNoise(l));
}
