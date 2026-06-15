/**
 * Best-effort rate limiter using Vercel KV / Upstash Redis REST API.
 * Fails open if KV env vars aren't set, so deploys keep working before
 * the user has provisioned a KV store. Once KV is connected, this
 * blocks abusive bursts on the audit + blog endpoints.
 *
 * Enable: Vercel dashboard → Storage → Create → KV → connect to project.
 * That auto-injects KV_REST_API_URL and KV_REST_API_TOKEN.
 */

type RateResult = { allowed: boolean; retryAfter: number };

export async function checkRateLimit(
  req: Request,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  // Fail open if KV isn't configured
  if (!url || !token) return { allowed: true, retryAfter: 0 };

  const ip = getIp(req);
  const bucketKey = `rl:${key}:${ip}`;
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const incrRes = await fetch(`${url}/incr/${encodeURIComponent(bucketKey)}`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(2_000),
    });
    if (!incrRes.ok) throw new Error(`KV incr ${incrRes.status}`);
    const incr = (await incrRes.json()) as { result: number };
    const count = incr.result;

    if (count === 1) {
      // First hit in this window — set TTL so the counter expires
      await fetch(`${url}/expire/${encodeURIComponent(bucketKey)}/${windowSeconds}`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(2_000),
      }).catch(() => undefined);
    }

    if (count > limit) {
      const ttlRes = await fetch(`${url}/ttl/${encodeURIComponent(bucketKey)}`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      }).catch(() => null);
      const ttl = ttlRes && ttlRes.ok ? ((await ttlRes.json()) as { result: number }).result : windowSeconds;
      return { allowed: false, retryAfter: Math.max(1, ttl) };
    }

    return { allowed: true, retryAfter: 0 };
  } catch (e) {
    console.warn("[rateLimit]", (e as Error).message);
    return { allowed: true, retryAfter: 0 };
  }
}

function getIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

/** Client IP from proxy headers. Exposed for logging so abusive IPs can be
 *  identified in the function logs and added to BLOCKED_IPS. */
export function clientIp(req: Request): string {
  return getIp(req);
}

/**
 * Hard IP denylist via the BLOCKED_IPS env var (comma-separated). Works
 * WITHOUT Vercel KV — checked in-process — so a single abuser can be blocked
 * immediately by adding their IP in the Vercel dashboard and redeploying.
 */
export function isIpBlocked(req: Request): boolean {
  const raw = process.env.BLOCKED_IPS;
  if (!raw) return false;
  const ip = getIp(req);
  if (ip === "unknown") return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).includes(ip);
}

export function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: `Slow down. Try again in ${retryAfter}s.` }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
