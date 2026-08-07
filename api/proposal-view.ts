import { guard, type RateTier } from "../lib/rateLimit";
import { lookupRecipient, type Recipient } from "../lib/proposalRecipients";
import { sendProposalViewEmail } from "../lib/email";
import { attachNote, findContactIdByEmail } from "../lib/hubspot";

export const config = { runtime: "edge" };

/**
 * Proposal engagement beacon.
 *
 * assets/proposal-track.js posts here every ~20s while a tokened proposal
 * page is visible, and once more on pagehide with final:true. The client
 * sends CUMULATIVE totals for the session rather than deltas, so a dropped
 * or duplicated batch costs nothing — the last one to land wins.
 *
 * One notification email per reading session, not per batch. The send is
 * gated on an atomic INCR so a duplicated final beacon can't double-send.
 *
 * Fails open and quiet at every step. This is a sales nicety attached to a
 * client-facing page: a KV outage, an unset token or a Resend error must
 * never surface an error to the person reading the proposal.
 */

type Body = {
  k?: unknown;
  slug?: unknown;
  sid?: unknown;
  final?: unknown;
  seconds?: unknown;
  sections?: unknown;
  expanded?: unknown;
  furthest?: unknown;
  title?: unknown;
};

type SessionState = {
  seconds: number;
  sections: Record<string, number>;
  expanded: string[];
  furthest: string;
  batches: number;
  viewNumber: number;
};

// Generous — a long read legitimately produces a dozen batches — but bounded
// so a stuck or malicious client can't hammer the function indefinitely.
const TIERS: RateTier[] = [
  { limit: 40, windowSeconds: 600, suffix: "10m" },
  { limit: 300, windowSeconds: 86400, suffix: "1d" },
];

const SESSION_TTL = 60 * 60 * 6; // 6h — long enough for a tab left open
const MAX_SECTIONS = 40;
const MAX_LABEL = 80;
const SANE_SECONDS = 60 * 60 * 4; // clamp: 4h of visible time is already absurd

export default async function handler(req: Request): Promise<Response> {
  // The client uses sendBeacon, which cannot read a response. Everything
  // below returns 204 regardless of outcome so a failure is never visible.
  if (req.method !== "POST") return noContent();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return noContent();
  }

  const slug = typeof body.slug === "string" ? body.slug.slice(0, 120) : "";
  const recipient = lookupRecipient(body.k, slug);
  if (!recipient) return noContent(); // unknown/mismatched token — track nothing

  const blocked = await guard(req, "proposal-view", TIERS);
  if (blocked) return blocked;

  const sid = typeof body.sid === "string" && /^[a-z0-9]{8,40}$/.test(body.sid) ? body.sid : "";
  if (!sid) return noContent();

  const incoming = {
    seconds: clampSeconds(body.seconds),
    sections: normaliseSections(body.sections),
    expanded: normaliseLabels(body.expanded),
    furthest: typeof body.furthest === "string" ? body.furthest.slice(0, MAX_LABEL) : "",
    title: typeof body.title === "string" ? body.title.slice(0, 160) : slug,
    final: body.final === true,
  };

  const sessionKey = `pv:s:${slug}:${recipient.token}:${sid}`;
  const countKey = `pv:n:${slug}:${recipient.token}`;
  const firstKey = `pv:f:${slug}:${recipient.token}`;

  const prior = await kvGetJson<SessionState>(sessionKey);

  // First batch of a new session → this is a new view for this recipient.
  let viewNumber = prior?.viewNumber ?? 0;
  if (!prior) {
    viewNumber = (await kvIncr(countKey)) ?? 1;
    // Stamp the first-ever open. NX so later sessions don't overwrite it.
    if (viewNumber === 1) await kvSetNx(firstKey, new Date().toISOString());
  }

  const state: SessionState = {
    seconds: incoming.seconds,
    sections: incoming.sections,
    expanded: incoming.expanded,
    furthest: incoming.furthest,
    batches: (prior?.batches ?? 0) + 1,
    viewNumber,
  };
  await kvSetJson(sessionKey, state, SESSION_TTL);

  // Send when the reader leaves, or after enough batches that we have to
  // assume the pagehide beacon was dropped (backgrounded tab, killed app).
  const shouldSend = incoming.final || state.batches >= 5;
  if (!shouldSend) return noContent();

  // Atomic one-shot: only the caller that takes the counter from 0 to 1 sends.
  // Without KV this returns null and we fall back to sending on final only.
  const claim = await kvIncr(`pv:e:${slug}:${recipient.token}:${sid}`, SESSION_TTL);
  if (claim !== null && claim !== 1) return noContent();
  if (claim === null && !incoming.final) return noContent();

  const firstSeen = viewNumber > 1 ? await kvGetRaw(firstKey) : null;

  await notify(req, recipient, state, incoming.title, slug, firstSeen);
  return noContent();
}

async function notify(
  req: Request,
  recipient: Recipient,
  state: SessionState,
  title: string,
  slug: string,
  firstSeen: string | null,
): Promise<void> {
  const sections = Object.entries(state.sections)
    .map(([label, seconds]) => ({ label, seconds }))
    .sort((a, b) => b.seconds - a.seconds);

  const origin = safeOrigin(req) || "https://zibdigital.com.au";

  const payload = {
    name: recipient.name,
    company: recipient.company,
    context: recipient.context,
    recipientEmail: recipient.email,
    pageTitle: title,
    pageUrl: `${origin}/${slug}`,
    viewNumber: Math.max(1, state.viewNumber),
    sessionSeconds: state.seconds,
    sections,
    expanded: state.expanded,
    furthest: state.furthest,
    device: deviceFrom(req.headers.get("user-agent") || ""),
    firstSeen: firstSeen ? fmtDate(firstSeen) : undefined,
  };

  // Email and CRM are independent — one failing must not take out the other.
  await Promise.allSettled([
    sendProposalViewEmail(payload),
    writeHubSpotNote(recipient, payload),
  ]);
}

async function writeHubSpotNote(
  recipient: Recipient,
  p: { viewNumber: number; sessionSeconds: number; sections: { label: string; seconds: number }[]; expanded: string[]; furthest: string; pageTitle: string },
): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token || !recipient.email) return;
  try {
    const contactId = await findContactIdByEmail(token, recipient.email);
    if (!contactId) return;

    const top = p.sections
      .filter((s) => s.seconds >= 2)
      .slice(0, 5)
      .map((s) => `<li>${escHtml(s.label)} — ${Math.round(s.seconds)}s</li>`)
      .join("");

    await attachNote(
      contactId,
      `<p><strong>Opened “${escHtml(p.pageTitle)}”</strong> — view ${p.viewNumber}, ${Math.round(p.sessionSeconds)}s on page.</p>` +
        (top ? `<p>Time by section:</p><ul>${top}</ul>` : "") +
        (p.expanded.length ? `<p>Expanded: ${escHtml(p.expanded.join(", "))}</p>` : "") +
        (p.furthest ? `<p>Read as far as: ${escHtml(p.furthest)}</p>` : ""),
    );
  } catch (e) {
    console.warn("[proposal] HubSpot note failed:", (e as Error).message);
  }
}

// ─── input normalisation ────────────────────────────────────────────
// A valid token makes this body attacker-controllable, so everything is
// clamped by count, length and range before it reaches an email template.

function clampSeconds(v: unknown): number {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return 0;
  return Math.min(Math.round(n), SANE_SECONDS);
}

function normaliseSections(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [rawLabel, rawSecs] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_SECTIONS) break;
    const label = String(rawLabel).slice(0, MAX_LABEL).trim();
    if (!label) continue;
    out[label] = clampSeconds(rawSecs);
  }
  return out;
}

function normaliseLabels(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  for (const item of v) {
    if (seen.size >= MAX_SECTIONS) break;
    const s = String(item).slice(0, MAX_LABEL).trim();
    if (s) seen.add(s);
  }
  return [...seen];
}

function deviceFrom(ua: string): string {
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|Android|iPhone/i.test(ua)) return "Mobile";
  if (!ua) return "Unknown";
  return "Desktop";
}

function safeOrigin(req: Request): string | null {
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-AU", {
      timeZone: "Australia/Melbourne",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── KV (Upstash / Vercel KV REST) — same store as the rate limiter ──
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const kvOn = () => Boolean(KV_URL && KV_TOKEN);

async function kvGetRaw(key: string): Promise<string | null> {
  if (!kvOn()) return null;
  try {
    const r = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: string | null };
    return j.result ?? null;
  } catch {
    return null;
  }
}

async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGetRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function kvSetJson(key: string, val: unknown, ttlSeconds: number): Promise<void> {
  if (!kvOn()) return;
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "text/plain" },
      body: JSON.stringify(val),
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    /* fail open — losing a batch costs one session's detail, not the page */
  }
}

async function kvSetNx(key: string, val: string): Promise<void> {
  if (!kvOn()) return;
  try {
    await fetch(`${KV_URL}/set/${encodeURIComponent(key)}?NX=true`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "text/plain" },
      body: val,
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    /* fail open */
  }
}

/** Returns the value after increment, or null when KV isn't configured. */
async function kvIncr(key: string, ttlSeconds?: number): Promise<number | null> {
  if (!kvOn()) return null;
  try {
    const r = await fetch(`${KV_URL}/incr/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      signal: AbortSignal.timeout(2_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { result?: number };
    const n = typeof j.result === "number" ? j.result : null;
    if (n === 1 && ttlSeconds) {
      await fetch(`${KV_URL}/expire/${encodeURIComponent(key)}/${ttlSeconds}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KV_TOKEN}` },
        signal: AbortSignal.timeout(2_000),
      }).catch(() => {});
    }
    return n;
  } catch {
    return null;
  }
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}
