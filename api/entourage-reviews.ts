export const config = { runtime: "edge" };

/**
 * Entourage landing page — live Google reviews.
 *
 * Feeds the review wall on /entourage-home-loans-melbourne. The page already
 * renders verifiable facts from entourage.com.au, so this endpoint is pure
 * progressive enhancement: it either returns real Google review text or says
 * `live: false` and the page keeps what it has. It never invents a review.
 *
 * Requires GOOGLE_PLACES_API_KEY and ENTOURAGE_PLACE_ID. Without either it
 * returns `live: false` immediately rather than failing — the concept build
 * runs fine with no credentials at all.
 *
 * Find the place ID once via the Places Text Search endpoint, e.g.
 *   places.googleapis.com/v1/places:searchText  { textQuery: "Entourage Cremorne" }
 * and set it as an env var. Resolving it per request would double the quota
 * cost for a value that never changes.
 */

type PlacesReview = {
  rating?: number;
  text?: { text?: string };
  originalText?: { text?: string };
  authorAttribution?: { displayName?: string };
  relativePublishTimeDescription?: string;
};

type PlacesResponse = {
  rating?: number;
  userRatingCount?: number;
  reviews?: PlacesReview[];
};

const FIELDS = "rating,userRatingCount,reviews";

export default async function handler(): Promise<Response> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = process.env.ENTOURAGE_PLACE_ID;

  if (!key || !placeId) return json({ live: false, reason: "not_configured" });

  try {
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
      {
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELDS,
        },
      },
    );

    if (!res.ok) return json({ live: false, reason: `places_${res.status}` });

    const data = (await res.json()) as PlacesResponse;

    // Only 5-star reviews with real text reach a lead-capture page. A 3-star
    // review is legitimate feedback, but this block is social proof next to a
    // form — the honest version of that is "these are our five-star ones",
    // which is exactly what the heading above it already claims.
    const reviews = (data.reviews || [])
      .filter((r) => (r.rating ?? 0) >= 5)
      .map((r) => ({
        rating: r.rating ?? 5,
        text: trim(r.text?.text || r.originalText?.text || ""),
        author: r.authorAttribution?.displayName || "Google reviewer",
        when: r.relativePublishTimeDescription || "Google review",
      }))
      .filter((r) => r.text.length > 40)
      .slice(0, 3);

    if (!reviews.length) return json({ live: false, reason: "no_usable_reviews" });

    return json({
      live: true,
      rating: data.rating ?? 5,
      total: data.userRatingCount ?? null,
      reviews,
    });
  } catch {
    return json({ live: false, reason: "fetch_failed" });
  }
}

/** Keep cards an even height — long reviews get cut at a sentence boundary. */
function trim(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= 240) return clean;
  const cut = clean.slice(0, 240);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "));
  return (stop > 120 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…");
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
      // Places quota is per-request billable and reviews move slowly. One
      // upstream call an hour, served stale for a day while it refreshes.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
