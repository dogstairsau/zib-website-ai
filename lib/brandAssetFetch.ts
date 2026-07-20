/**
 * Network side of brand asset enrichment — fetching logos, og:images and
 * stylesheets discovered by lib/brandAssets.ts. Split from the extraction
 * logic so that file stays import-free (node's test runner needs explicit
 * import extensions, while a ".ts" specifier breaks Vercel's edge bundle).
 *
 * Everything here is best-effort: any failure returns null/empty — asset
 * enrichment must never break a generation run.
 */

import { safeFetch, isSafeFetchUrl } from "./safeUrl";
import { rankCssColors } from "./brandAssets";

export type FetchedImage = {
  bytes: ArrayBuffer;
  mime: string;
  dataUri: string;
};

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

/** Best-effort fetch of a brand image. Returns null on any failure. */
export async function fetchImageAsset(
  url: string,
  maxBytes = 3_000_000,
): Promise<FetchedImage | null> {
  try {
    if (!isSafeFetchUrl(url).ok) return null;
    const res = await safeFetch(url, {
      headers: { Accept: "image/*", "User-Agent": "ZibAudit/1.0 (+https://zibdigital.com.au/audit)" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    let mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!mime.startsWith("image/")) {
      // Some CDNs serve octet-stream — fall back to extension sniffing.
      const ext = (new URL(url).pathname.match(/\.(\w+)$/)?.[1] || "").toLowerCase();
      mime = MIME_BY_EXT[ext] || "";
      if (!mime) return null;
    }

    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return null;
    return { bytes, mime, dataUri: `data:${mime};base64,${toBase64(bytes)}` };
  } catch {
    return null;
  }
}

/** Best-effort: fetch stylesheets and mine brand colours from them. */
export async function fetchColorsFromStylesheets(urls: string[], maxBytes = 400_000): Promise<string[]> {
  const cssBlobs = await Promise.all(
    urls.map(async (url) => {
      try {
        if (!isSafeFetchUrl(url).ok) return "";
        const res = await safeFetch(url, {
          headers: { Accept: "text/css,*/*" },
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return "";
        return (await res.text()).slice(0, maxBytes);
      } catch {
        return "";
      }
    }),
  );
  return rankCssColors(cssBlobs.join("\n")).slice(0, 3);
}
