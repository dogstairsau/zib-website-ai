/**
 * Meta Ads Studio — brand asset storage.
 *
 * The Studio composites ads client-side, but the team wants every run's kit
 * (photos, logo, fonts) and finished creatives kept for internal use. The
 * page uploads each file here individually; we forward it to Vercel Blob
 * under studio/<runId>/<name>. Fails open (stored:false) until a Blob store
 * is connected — the tool itself never depends on storage succeeding.
 *
 * Enable: Vercel dashboard → Storage → Create → Blob → connect to project.
 * That auto-injects BLOB_READ_WRITE_TOKEN.
 */

import { guard, type RateTier } from "../lib/rateLimit";

export const config = { runtime: "edge" };

// A single run uploads up to ~20 files (6 photos, logo, 2 fonts, 12 finals),
// so the default 2-per-10-min tiers would break the first run. Generation
// itself is still guarded by the main endpoint's tight tiers.
const ASSET_TIERS: RateTier[] = [
  { limit: 80, windowSeconds: 600, suffix: "10m" },
  { limit: 400, windowSeconds: 86400, suffix: "1d" },
];

const MAX_BYTES = 4_000_000; // stays under the edge request body cap
const RUN_RE = /^[a-zA-Z0-9-]{8,64}$/;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml",
  "font/ttf", "font/otf", "font/woff", "font/woff2",
  "application/octet-stream", // font files often arrive as this
  "application/json", // the run's concept deck
]);

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const blocked = await guard(req, "studio-assets", ASSET_TIERS);
  if (blocked) return blocked;

  const u = new URL(req.url);
  const run = u.searchParams.get("run") || "";
  const name = u.searchParams.get("name") || "";
  if (!RUN_RE.test(run)) return json({ error: "Bad run id" }, 400);
  if (!NAME_RE.test(name) || name.includes("..")) return json({ error: "Bad file name" }, 400);

  const contentType = req.headers.get("content-type") || "application/octet-stream";
  if (!ALLOWED_TYPES.has(contentType)) return json({ error: "Unsupported file type" }, 415);

  const bytes = await req.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "Empty body" }, 400);
  if (bytes.byteLength > MAX_BYTES) return json({ error: "File too large" }, 413);

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    console.log("[studio-assets:stub] no BLOB_READ_WRITE_TOKEN", { run, name, size: bytes.byteLength });
    return json({ stored: false });
  }

  try {
    const res = await fetch(`https://blob.vercel-storage.com/studio/${run}/${name}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-version": "7",
        "x-content-type": contentType,
        // The run id is a UUID, so the prefix is already unguessable —
        // predictable names inside it let the team browse a run's files.
        "x-add-random-suffix": "0",
      },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[studio-assets] blob PUT failed", res.status, errBody.slice(0, 300));
      return json({ stored: false });
    }
    const data = (await res.json()) as { url?: string };
    return json({ stored: true, url: data.url || null });
  } catch (e) {
    console.warn("[studio-assets]", (e as Error).message);
    return json({ stored: false });
  }
}
