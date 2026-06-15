/**
 * Google reviews via the Places API (v1 searchText). Returns the business's
 * star rating and review count — the single strongest trust signal — and folds
 * into the Social Presence & Proof pillar.
 *
 * Needs GOOGLE_PLACES_API_KEY (Places API enabled). Fails closed (available:
 * false) without a key or on any error, so the score model just drops it.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export type ReviewSignal = {
  available: boolean;
  rating: number; // 0..5
  count: number;
  name: string;
  score: number; // 0..100
};

const unavailable: ReviewSignal = { available: false, rating: 0, count: 0, name: "", score: 50 };

export async function fetchReviews(businessName: string): Promise<ReviewSignal> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !businessName.trim()) return unavailable;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount",
      },
      body: JSON.stringify({ textQuery: businessName, regionCode: "AU", maxResultCount: 1 }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return unavailable;

    const data: any = await res.json();
    const place = data.places?.[0];
    const rating = Number(place?.rating) || 0;
    const count = Number(place?.userRatingCount) || 0;
    if (!rating || !count) return unavailable;

    // Rating drives the score; review volume builds confidence in it.
    const ratingScore = (rating / 5) * 100;
    const confidence = Math.min(1, count / 40);
    const score = Math.round(ratingScore * (0.65 + 0.35 * confidence));

    return {
      available: true,
      rating,
      count,
      name: place?.displayName?.text || businessName,
      score: Math.max(0, Math.min(100, score)),
    };
  } catch {
    return unavailable;
  }
}
