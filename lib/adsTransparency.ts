/**
 * Google Ads Transparency Center integration.
 *
 * There is no official API. The Transparency Center web UI is backed by an
 * internal RPC (adstransparency.google.com/anji/_/rpc/...). We use the
 * SearchSuggestions RPC, which reliably resolves a brand/advertiser query to a
 * real advertiser record: name, advertiser ID, region, verified status and the
 * total number of ads they are running. That is the live "audit the account"
 * signal — confirmation they advertise on Google and at what scale.
 *
 * Everything is best-effort with a tight timeout. On any failure we fall back
 * to a clean deep-link so the Google Ads Lab run is never blocked.
 */

const RPC_BASE = "https://adstransparency.google.com/anji/_/rpc";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export type Advertiser = {
  name: string;
  advertiserId: string;
  region: string;
  adCountMin: number;
  adCountMax: number;
  verified: boolean;
};

export type TransparencyResult = {
  /** Deep-link to the advertiser (or domain search) in the Transparency Center. */
  url: string;
  /** Matched advertiser, when the lookup succeeds. */
  advertiser: Advertiser | null;
  /** Human-friendly ad-count label, e.g. "~10,000–20,000". */
  adCountLabel: string;
  /** One-line note fed to the model. */
  note: string;
};

/** Bare registrable domain, e.g. "www.foo.com.au/bar" -> "foo.com.au". */
export function bareDomain(input: string): string {
  let host = input;
  try {
    host = new URL(input.startsWith("http") ? input : `https://${input}`).hostname;
  } catch {
    /* fall through */
  }
  return host.replace(/^www\./, "").toLowerCase();
}

/** Domain-search deep-link (always valid, even with no advertiser match). */
export function transparencyUrl(domain: string, region = "AU"): string {
  return `https://adstransparency.google.com/?region=${encodeURIComponent(region)}&domain=${encodeURIComponent(bareDomain(domain))}`;
}

/** Precise advertiser deep-link once we have an advertiser ID. */
function advertiserUrl(advertiserId: string, region: string): string {
  return `https://adstransparency.google.com/advertiser/${encodeURIComponent(advertiserId)}?region=${encodeURIComponent(region || "AU")}`;
}

/** Call the SearchSuggestions RPC for one query string. Returns raw advertisers. */
async function searchSuggestions(query: string): Promise<Advertiser[]> {
  const res = await fetch(`${RPC_BASE}/SearchService/SearchSuggestions?authuser=0`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: `f.req=${encodeURIComponent(JSON.stringify({ 1: query, 2: 6 }))}`,
    signal: AbortSignal.timeout(7_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as any;
  const rows: any[] = Array.isArray(data?.["1"]) ? data["1"] : [];
  return rows
    .map((r) => r?.["1"])
    .filter(Boolean)
    .map((a) => ({
      name: String(a["1"] || ""),
      advertiserId: String(a["2"] || ""),
      region: String(a["3"] || ""),
      adCountMin: Number(a["4"]?.["2"]?.["1"] || 0),
      adCountMax: Number(a["4"]?.["2"]?.["2"] || 0),
      verified: Boolean(a["5"]),
    }))
    .filter((a) => a.advertiserId);
}

/** Clean a site title/H1 into a likely advertiser-name query. */
function nameCandidates(opts: { domain: string; title?: string; h1?: string }): string[] {
  const fromText = (t?: string) =>
    (t || "")
      .split(/\s+[|·\-–—:]\s+/)[0] // first segment before a separator
      .replace(/[®™©]/g, "")
      .replace(/\b(home|official site|australia|au)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

  const core = opts.domain.replace(/\.(com\.au|com|net\.au|net|org|au|co)$/i, "").replace(/[.-]/g, " ").trim();
  const cands = [fromText(opts.title), fromText(opts.h1), core, opts.domain].filter(Boolean);
  // De-dupe, drop very short/very long noise.
  return [...new Set(cands)].filter((c) => c.length >= 3 && c.length <= 60).slice(0, 4);
}

/** Pick the best advertiser match: prefer AU + the highest ad volume. */
function pickBest(list: Advertiser[]): Advertiser | null {
  if (!list.length) return null;
  return [...list].sort((a, b) => {
    const au = (x: Advertiser) => (x.region === "AU" ? 1 : 0);
    if (au(b) !== au(a)) return au(b) - au(a);
    return b.adCountMax - a.adCountMax;
  })[0];
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU");
}

/**
 * Resolve the client's domain/brand to a live advertiser in the Transparency
 * Center and summarise the account. Always returns a usable result.
 */
export async function auditTransparency(opts: {
  url: string;
  title?: string;
  h1?: string;
  region?: string;
}): Promise<TransparencyResult> {
  const domain = bareDomain(opts.url);
  const fallbackUrl = transparencyUrl(domain, opts.region);
  try {
    const candidates = nameCandidates({ domain, title: opts.title, h1: opts.h1 });
    let best: Advertiser | null = null;
    for (const q of candidates) {
      const matches = await searchSuggestions(q);
      const pick = pickBest(matches);
      if (pick) { best = pick; break; }
    }

    if (!best) {
      return {
        url: fallbackUrl,
        advertiser: null,
        adCountLabel: "",
        note: `Transparency Center checked for ${domain}: no clearly matching advertiser found. They may not be running Google Ads, or advertise under a different legal name. Base the audit on the site read and frame Google Ads as an untapped channel. Deep-link: ${fallbackUrl}`,
      };
    }

    const label =
      best.adCountMax <= 0
        ? "unknown"
        : best.adCountMin === best.adCountMax
          ? `~${fmt(best.adCountMax)}`
          : `~${fmt(best.adCountMin)}–${fmt(best.adCountMax)}`;
    const url = advertiserUrl(best.advertiserId, best.region);
    return {
      url,
      advertiser: best,
      adCountLabel: label,
      note: `Transparency Center match: advertiser "${best.name}" (region ${best.region}${best.verified ? ", verified" : ""}) is running ${label} ads right now. This is their LIVE Google Ads footprint. Use it in the audit: comment on whether that volume fits a business their size, what it implies about their current strategy, and where a Premier Partner would tighten it. Advertiser page: ${url}`,
    };
  } catch {
    return {
      url: fallbackUrl,
      advertiser: null,
      adCountLabel: "",
      note: `Transparency Center deep-link prepared for ${domain} (${fallbackUrl}). Live lookup unavailable in this run; base the audit on the site read.`,
    };
  }
}
