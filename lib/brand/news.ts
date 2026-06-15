/**
 * News mentions + tone via GDELT (free, keyless). Answers "are you in the
 * press, and is the coverage positive?" — catches the macro/micro events that
 * move brand perception. Volume folds into Market Visibility; tone folds into
 * Social Presence & Proof.
 *
 * Best-effort: any failure (or a noisy/empty result) degrades to available:
 * false and the score model drops it.
 */

const DOC = "https://api.gdeltproject.org/api/v2/doc/doc";

export type NewsSignal = {
  available: boolean;
  articleCount: number;
  avgTone: number; // ~ -10..+10
  volumeScore: number; // 0..100
  toneScore: number; // 0..100
};

const unavailable: NewsSignal = {
  available: false,
  articleCount: 0,
  avgTone: 0,
  volumeScore: 50,
  toneScore: 50,
};

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

async function gdelt(params: Record<string, string>): Promise<any | null> {
  const qs = new URLSearchParams({ format: "json", ...params });
  try {
    const res = await fetch(`${DOC}?${qs}`, {
      headers: { "User-Agent": "ZibBrandScore/1.0 (+https://zibdigital.com.au/brand-score)" },
      signal: AbortSignal.timeout(9_000),
    });
    if (!res.ok) return null;
    // GDELT occasionally returns HTML/error text with a 200; guard the parse.
    const text = await res.text();
    if (!text.trim().startsWith("{")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param brand quoted exact-phrase brand name (caller passes the plain name).
 */
export async function fetchNews(brand: string): Promise<NewsSignal> {
  const name = brand.trim();
  if (name.length < 3) return unavailable;
  const query = `"${name}"`;

  const [artlist, tone] = await Promise.all([
    gdelt({ query, mode: "artlist", maxrecords: "75", timespan: "3m", sort: "datedesc" }),
    gdelt({ query, mode: "timelinetone", timespan: "3m" }),
  ]);

  if (!artlist && !tone) return unavailable;

  const articleCount = Array.isArray(artlist?.articles) ? artlist.articles.length : 0;

  // Average tone across the timeline (GDELT tone runs roughly -10..+10).
  let avgTone = 0;
  const series = tone?.timeline?.[0]?.data;
  if (Array.isArray(series) && series.length) {
    const vals = series.map((d: any) => Number(d.value) || 0);
    avgTone = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
  }

  // Volume on a gentle log curve: a handful of articles already signals presence.
  const volumeScore = clamp(articleCount === 0 ? 12 : 30 + 22 * Math.log10(articleCount + 1) * 1.6);
  const toneScore = clamp(50 + avgTone * 5);

  return {
    available: true,
    articleCount,
    avgTone: Number(avgTone.toFixed(2)),
    volumeScore: Math.round(volumeScore),
    toneScore: Math.round(toneScore),
  };
}
