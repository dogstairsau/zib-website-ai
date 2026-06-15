/**
 * Social profile detection + live verification.
 *
 * We extract social profile URLs from a prospect's HTML (their own links to
 * Facebook, Instagram, LinkedIn, etc.), merge in any handles they typed into
 * the form, then verify each one actually resolves with a real fetch. v1 scores
 * PRESENCE, RECENCY-OF-INTENT and COVERAGE — not follower counts (those need
 * platform APIs; that's phase 2). Everything is edge-runtime safe.
 */

import { safeFetch, isSafeFetchUrl } from "../safeUrl";

export type Platform =
  | "facebook"
  | "instagram"
  | "linkedin"
  | "youtube"
  | "tiktok"
  | "x"
  | "pinterest";

// Platforms we expect a serious brand to consider. Coverage is scored against
// this set, but missing niche platforms is never penalised as hard as the core.
export const CORE_PLATFORMS: Platform[] = ["facebook", "instagram", "linkedin"];
export const ALL_PLATFORMS: Platform[] = [
  "facebook",
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "x",
  "pinterest",
];

const HOST_PATTERNS: { platform: Platform; re: RegExp }[] = [
  { platform: "facebook", re: /(?:facebook|fb)\.com/i },
  { platform: "instagram", re: /instagram\.com/i },
  { platform: "linkedin", re: /linkedin\.com/i },
  { platform: "youtube", re: /(?:youtube\.com|youtu\.be)/i },
  { platform: "tiktok", re: /tiktok\.com/i },
  { platform: "x", re: /(?:twitter\.com|x\.com)/i },
  { platform: "pinterest", re: /pinterest\.[a-z.]+/i },
];

// Generic share/intent URLs and bare platform homepages we must NOT treat as a
// brand's own profile.
const NOISE = /\/(sharer|share|intent|plugins|tr\?|login|home|hashtag)\b/i;

export type SocialProfile = {
  platform: Platform;
  url: string;
  source: "site" | "form";
  verified: boolean;
  status: number | null;
};

function platformOf(url: string): Platform | null {
  for (const { platform, re } of HOST_PATTERNS) if (re.test(url)) return platform;
  return null;
}

/** Is this a real profile URL (has a path beyond the bare domain) and not noise? */
function looksLikeProfile(url: string): boolean {
  try {
    const u = new URL(url);
    if (NOISE.test(u.pathname + u.search)) return false;
    const path = u.pathname.replace(/\/+$/, "");
    return path.length > 1; // more than just "/"
  } catch {
    return false;
  }
}

/** Pull every outbound social link out of raw HTML. */
export function extractSocialLinks(html: string): { platform: Platform; url: string }[] {
  const found = new Map<Platform, string>();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    let href = m[1].trim();
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//i.test(href)) continue;
    const platform = platformOf(href);
    if (!platform) continue;
    if (!looksLikeProfile(href)) continue;
    // First real profile per platform wins (usually header/footer brand link).
    if (!found.has(platform)) found.set(platform, href);
  }
  return [...found.entries()].map(([platform, url]) => ({ platform, url }));
}

/** Normalise a handle or partial URL the user typed in the form. */
export function normaliseHandle(raw: string): { platform: Platform; url: string } | null {
  let v = raw.trim();
  if (!v) return null;
  if (v.startsWith("@")) return null; // bare @handle — ambiguous platform, skip in v1
  if (v.startsWith("//")) v = "https:" + v;
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  const platform = platformOf(v);
  if (!platform || !looksLikeProfile(v)) return null;
  return { platform, url: v };
}

/** Verify a single profile resolves. Treats 2xx/3xx as present. */
async function verify(url: string): Promise<{ verified: boolean; status: number | null }> {
  if (!isSafeFetchUrl(url).ok) return { verified: false, status: null };
  try {
    const res = await safeFetch(url, {
      method: "GET",
      headers: { "User-Agent": "ZibBrandScore/1.0 (+https://zibdigital.com.au/brand-score)" },
      signal: AbortSignal.timeout(8_000),
    });
    // Some platforms 200 a "not found" shell, but most 404/410 a dead handle.
    // 999 (LinkedIn bot wall) means the URL is real but gated — count as present.
    const ok = res.status === 999 || (res.status >= 200 && res.status < 400);
    return { verified: ok, status: res.status };
  } catch {
    return { verified: false, status: null };
  }
}

export type SocialAudit = {
  profiles: SocialProfile[];
  present: Platform[]; // verified
  coreCovered: number; // 0..CORE_PLATFORMS.length
  score: number; // 0..100
};

/**
 * Detect (HTML + form) and verify all profiles, then score coverage.
 *
 * Scoring: 70% weight on the three core platforms being present + verified,
 * 30% on breadth across the wider set. A platform that's linked but fails
 * verification counts as "claimed, broken" — present for intent, not for proof.
 */
export async function auditSocials(
  html: string,
  formHandles: string[] = [],
): Promise<SocialAudit> {
  const fromSite = extractSocialLinks(html).map((p) => ({ ...p, source: "site" as const }));
  const fromForm = formHandles
    .map(normaliseHandle)
    .filter((x): x is { platform: Platform; url: string } => !!x)
    .map((p) => ({ ...p, source: "form" as const }));

  // Form-supplied wins over site-scraped for the same platform (user knows best).
  const byPlatform = new Map<Platform, { platform: Platform; url: string; source: "site" | "form" }>();
  for (const p of [...fromSite, ...fromForm]) {
    const existing = byPlatform.get(p.platform);
    if (!existing || (existing.source === "site" && p.source === "form")) {
      byPlatform.set(p.platform, p);
    }
  }

  const candidates = [...byPlatform.values()];
  const verified = await Promise.all(
    candidates.map(async (c) => {
      const v = await verify(c.url);
      return { ...c, verified: v.verified, status: v.status } as SocialProfile;
    }),
  );

  const present = verified.filter((p) => p.verified).map((p) => p.platform);
  const presentSet = new Set(present);

  const coreCovered = CORE_PLATFORMS.filter((p) => presentSet.has(p)).length;
  const coreScore = (coreCovered / CORE_PLATFORMS.length) * 70;

  const breadthCount = ALL_PLATFORMS.filter((p) => presentSet.has(p)).length;
  const breadthScore = Math.min(1, breadthCount / 5) * 30;

  const score = Math.round(coreScore + breadthScore);

  return { profiles: verified, present, coreCovered, score };
}
