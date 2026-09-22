/**
 * Competitor Google Ads footprint, by name.
 *
 * The Growth Audit asks for competitors while the three main audits are
 * already running, so this is a small side call rather than part of that
 * flow. It resolves each name against Google's Ads Transparency Center and
 * returns the live ad volume, which is what makes the report's comparison
 * table real data rather than an estimate.
 *
 * Deliberately cheap and forgiving: no model call, a hard cap of three
 * names, and every failure degrades to found:false rather than an error.
 * The report is already rendered by the time this returns — it appends a
 * section or it doesn't, and it must never take the page down with it.
 */
import { lookupCompetitor } from "../lib/adsTransparency";
import { guard } from "../lib/rateLimit";

export const config = { runtime: "edge" };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const names: string[] = Array.isArray(body?.names)
    ? body.names.map((n: unknown) => String(n || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!names.length) return json({ results: [] });

  const blocked = await guard(req, "competitor-ads");
  if (blocked) return blocked;

  const region = typeof body?.region === "string" && body.region ? body.region : "AU";

  // One slow lookup shouldn't hold up the other two — each already has its
  // own 7s timeout inside the RPC call.
  const results = await Promise.all(
    names.map((n) =>
      lookupCompetitor(n, region).catch(() => ({
        query: n,
        found: false,
        advertiser: null,
        adCountLabel: "",
        url: `https://adstransparency.google.com/?region=${encodeURIComponent(region)}`,
      })),
    ),
  );

  return json({
    results: results.map((r) => ({
      query: r.query,
      found: r.found,
      name: r.advertiser?.name || null,
      adCountLabel: r.adCountLabel || null,
      adCountMax: r.advertiser?.adCountMax ?? 0,
      region: r.advertiser?.region || null,
      verified: r.advertiser?.verified || false,
      url: r.url,
    })),
  });
}
