/**
 * Google Trends — keyless, free.
 *
 * Google Trends has no official API. The public site uses a two-step dance:
 *   1) GET /api/explore  → returns widget tokens
 *   2) GET /api/widgetdata/multiline?token=...&req=...  → the time series
 * Both are unauthenticated. Responses are prefixed with anti-JSON-hijack junk
 * (")]}',\n") which we strip. This is best-effort: if Google rate-limits or
 * changes shape, every function degrades to `available: false` and the score
 * model drops the signal rather than failing the run.
 */

const EXPLORE = "https://trends.google.com/trends/api/explore";
const MULTILINE = "https://trends.google.com/trends/api/widgetdata/multiline";

const stripPrefix = (t: string) => t.replace(/^\)\]\}',?\s*/, "");

type Point = { time: string; value: number[] };

export type TrendSeries = {
  term: string;
  available: boolean;
  points: number[]; // weekly interest 0..100
  latest: number;
  average: number;
  slope: number; // normalised trend direction, ~ -1..+1
};

async function tokenFor(
  terms: string[],
  geo: string,
  timeframe: string,
): Promise<{ token: string; req: string } | null> {
  const comparisonItem = terms.map((t) => ({ keyword: t, geo, time: timeframe }));
  const reqObj = { comparisonItem, category: 0, property: "" };
  const params = new URLSearchParams({
    hl: "en-AU",
    tz: "-600",
    req: JSON.stringify(reqObj),
  });

  const res = await fetch(`${EXPLORE}?${params}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-AU,en;q=0.9",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const data = JSON.parse(stripPrefix(await res.text()));
  const widget = (data.widgets || []).find((w: any) => w.id === "TIMESERIES");
  if (!widget?.token || !widget?.request) return null;
  return { token: widget.token, req: JSON.stringify(widget.request) };
}

/** Least-squares slope of the series, normalised by its own mean → ~ -1..+1. */
function trendSlope(values: number[]): number {
  const n = values.length;
  if (n < 4) return 0;
  const xs = values.map((_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (values[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  const rawSlope = num / den; // interest points per week
  // Project across the full window, normalise by mean level → relative growth.
  const projected = (rawSlope * (n - 1)) / Math.max(meanY, 1);
  return Math.max(-1, Math.min(1, projected));
}

/**
 * Fetch interest-over-time for up to 5 terms in one comparison call.
 * geo: ISO country (default AU). timeframe: Google Trends syntax (default 12m).
 */
export async function fetchTrends(
  terms: string[],
  geo = "AU",
  timeframe = "today 12-m",
): Promise<TrendSeries[]> {
  const clean = terms.map((t) => t.trim()).filter(Boolean).slice(0, 5);
  const empty = (term: string): TrendSeries => ({
    term,
    available: false,
    points: [],
    latest: 0,
    average: 0,
    slope: 0,
  });
  if (clean.length === 0) return [];

  try {
    const tok = await tokenFor(clean, geo, timeframe);
    if (!tok) return clean.map(empty);

    const params = new URLSearchParams({ hl: "en-AU", tz: "-600", req: tok.req, token: tok.token });
    const res = await fetch(`${MULTILINE}?${params}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-AU,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return clean.map(empty);

    const data = JSON.parse(stripPrefix(await res.text()));
    const timeline: Point[] = data.default?.timelineData || [];
    if (timeline.length === 0) return clean.map(empty);

    return clean.map((term, idx) => {
      const points = timeline.map((p) => p.value?.[idx] ?? 0);
      const latest = points[points.length - 1] ?? 0;
      const average = points.reduce((a, b) => a + b, 0) / Math.max(points.length, 1);
      return {
        term,
        available: true,
        points,
        latest,
        average: Math.round(average),
        slope: trendSlope(points),
      };
    });
  } catch {
    return clean.map(empty);
  }
}

/** Derive a brand-search term from a domain ("acme-coffee.com.au" → "acme coffee"). */
export function brandTermFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const root = host.split(".")[0];
    return root.replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}
