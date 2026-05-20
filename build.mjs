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

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const OUT = join(ROOT, "dist");

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
    await writeFile(join(destDir, entry.name), expanded, "utf8");
    counter.count++;
    const rel = join(destDir, entry.name).slice(OUT.length + 1);
    console.log(`  ✓ ${rel}`);
  }
}

async function build() {
  const start = Date.now();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

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
export { expand };

// Run build() when invoked directly (e.g. `node build.mjs`).
// We detect this by checking the entry script's resolved path against this module's URL.
const entry = process.argv[1] ? new URL(process.argv[1], `file://${process.cwd()}/`).href : "";
if (entry === import.meta.url) {
  build().catch((e) => {
    console.error("\n  Build failed:", e.message);
    process.exit(1);
  });
}
