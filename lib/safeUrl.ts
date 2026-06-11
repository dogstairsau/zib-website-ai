/**
 * SSRF guard for user-supplied fetch targets.
 *
 * Edge-runtime safe: no DNS module is available on the edge, so we cannot
 * resolve hostnames. This blocks the reachable-from-a-string attack surface:
 *   - non-http(s) schemes
 *   - credentials embedded in the URL (user:pass@host)
 *   - localhost / single-label / *.local / *.internal hostnames
 *   - private, loopback, link-local (incl. cloud metadata 169.254.169.254),
 *     CGNAT and reserved IPv4/IPv6 literals
 *
 * Redirects are followed manually (safeFetch) so every hop is re-validated,
 * which closes the "public URL 302s to 127.0.0.1" trick.
 *
 * Residual risk: DNS rebinding (a public hostname that resolves to a private
 * IP) cannot be caught without DNS resolution. Accepted on edge; documented.
 */

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const oct = m.slice(1).map(Number);
  if (oct.some((o) => o > 255)) return true; // malformed → treat as unsafe
  const [a, b] = oct;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(raw: string): boolean {
  let h = raw.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (/^f[cd][0-9a-f]{2}:/.test(h) || h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // link-local fe80::/10
  if (h.startsWith("::ffff:")) return isPrivateIPv4(h.split(":").pop() || ""); // IPv4-mapped
  return false;
}

export function isSafeFetchUrl(raw: string): { ok: boolean; reason?: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "only http(s) is allowed" };
  }
  if (u.username || u.password) {
    return { ok: false, reason: "credentials in URL are not allowed" };
  }

  const host = u.hostname.toLowerCase();

  // IPv6 literal (URL.hostname keeps the brackets, e.g. "[::1]")
  if (host.includes(":") || host.startsWith("[")) {
    return isPrivateIPv6(host) ? { ok: false, reason: "private IPv6 address" } : { ok: true };
  }
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: "loopback host" };
  if (isPrivateIPv4(host)) return { ok: false, reason: "private IPv4 address" };
  if (
    !host.includes(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { ok: false, reason: "non-public host" };
  }
  return { ok: true };
}

/**
 * fetch() with an SSRF guard and manual redirect re-validation. Drop-in
 * replacement for fetch() when the URL came from user input.
 */
export async function safeFetch(rawUrl: string, init: RequestInit = {}, maxHops = 5): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxHops; hop++) {
    const check = isSafeFetchUrl(current);
    if (!check.ok) throw new Error(`Refusing to fetch unsafe URL (${check.reason})`);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400 && res.headers.has("location")) {
      current = new URL(res.headers.get("location") as string, current).href;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
