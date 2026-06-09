/**
 * Zero-dependency local preview for the built site.
 *
 * Serves /dist with the same clean-URL rules as production (cleanUrls: true,
 * trailingSlash: false) so /seo-melbourne resolves to dist/seo-melbourne.html.
 * No npm install needed — pure Node builtins.
 *
 * Usage:
 *   node build.mjs                      # build dist/
 *   node migration/preview-server.mjs   # serve at http://localhost:3000
 *   PORT=4000 node migration/preview-server.mjs
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT) || 3000;
const MIME = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"application/javascript; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png",
  ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".avif":"image/avif",
  ".ico":"image/x-icon", ".xml":"application/xml", ".txt":"text/plain; charset=utf-8",
  ".json":"application/json", ".woff":"font/woff", ".woff2":"font/woff2" };

async function tryFiles(p) {
  const cands = [];
  if (p.endsWith("/")) cands.push(join(p, "index.html"));
  cands.push(p);
  if (!extname(p)) { cands.push(p + ".html"); cands.push(join(p, "index.html")); }
  for (const c of cands) {
    try { const s = await stat(join(ROOT, c)); if (s.isFile()) return c; } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = await tryFiles(url === "/" ? "/index.html" : url);
    if (!file) { res.writeHead(404, {"content-type":"text/html"}); return res.end("<h1>404</h1><p>"+url+"</p>"); }
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, {"content-type": MIME[extname(file)] || "application/octet-stream"});
    res.end(body);
  } catch (e) { res.writeHead(500); res.end(String(e)); }
}).listen(PORT, () => console.log(`Preview serving /dist at http://localhost:${PORT}`));
