/**
 * Reddit / forum mentions via the public search JSON (free, no key). Mention
 * volume plus a light lexicon sentiment read. Folds into Social Presence &
 * Proof.
 *
 * Reddit often rate-limits or 403s datacenter IPs — every failure degrades to
 * available: false so the score model just drops it. Noisy for small B2B
 * brands, strong for consumer ones.
 */

const SEARCH = "https://www.reddit.com/search.json";

export type RedditSignal = {
  available: boolean;
  mentionCount: number;
  sentiment: number; // -1..+1
  score: number; // 0..100
};

const unavailable: RedditSignal = { available: false, mentionCount: 0, sentiment: 0, score: 50 };

const POS = ["love", "great", "best", "recommend", "amazing", "excellent", "happy", "good", "reliable", "trust", "quality", "helpful", "awesome"];
const NEG = ["scam", "avoid", "terrible", "worst", "bad", "poor", "rip off", "ripoff", "disappointed", "awful", "rude", "overpriced", "warning", "fraud", "horrible"];

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

function scoreSentiment(text: string): number {
  const t = ` ${text.toLowerCase()} `;
  let pos = 0;
  let neg = 0;
  for (const w of POS) if (t.includes(w)) pos++;
  for (const w of NEG) if (t.includes(w)) neg++;
  if (pos + neg === 0) return 0;
  return (pos - neg) / (pos + neg);
}

export async function fetchReddit(brand: string): Promise<RedditSignal> {
  const name = brand.trim();
  if (name.length < 3) return unavailable;

  const qs = new URLSearchParams({ q: `"${name}"`, limit: "50", sort: "relevance", t: "year" });
  try {
    const res = await fetch(`${SEARCH}?${qs}`, {
      headers: {
        "User-Agent": "ZibBrandScore/1.0 (by /u/zibdigital; +https://zibdigital.com.au/brand-score)",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return unavailable;

    const data: any = await res.json();
    const posts = data?.data?.children;
    if (!Array.isArray(posts)) return unavailable;

    const mentionCount = posts.length;
    const corpus = posts
      .map((p: any) => `${p?.data?.title || ""} ${p?.data?.selftext || ""}`)
      .join(" ");
    const sentiment = scoreSentiment(corpus);

    // Volume → presence. Sentiment shifts it up or down.
    const volumeScore = mentionCount === 0 ? 25 : clamp(40 + 20 * Math.log10(mentionCount + 1));
    const sentimentScore = clamp(50 + sentiment * 35);
    const score = Math.round(volumeScore * 0.55 + sentimentScore * 0.45);

    return { available: true, mentionCount, sentiment: Number(sentiment.toFixed(2)), score };
  } catch {
    return unavailable;
  }
}
