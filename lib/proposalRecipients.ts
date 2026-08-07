/**
 * Per-recipient tracking tokens for proposal / audit pages.
 *
 * HOW IT WORKS
 *   Every person who receives a proposal gets their own link:
 *       https://zibdigital.com.au/boothalicious-seo-audit?k=<token>
 *   The token maps to the entry below, which is what turns anonymous
 *   analytics into "Sarah opened it three times". Without a token the page
 *   still works — it just tracks nothing at all.
 *
 * THIS FILE NEVER REACHES THE BROWSER. It's imported only by
 * api/proposal-view.ts (a serverless function). build.mjs only ever emits
 * .html pages, so nothing under lib/ is published to /dist.
 *
 * ADDING A RECIPIENT
 *   1. Generate a token:  openssl rand -hex 4
 *   2. Add an entry below, commit, deploy.
 *   3. Send them <page-url>?k=<token>
 *   Give each PERSON their own token, not each company — the point is to
 *   tell the decision-maker apart from the person who forwarded it.
 *
 * A token is not a password. It gates attribution, not access: the page is
 * readable by anyone with the URL either way. Keep tokens dull and short so
 * a recipient glancing at the address bar reads it as a link ID, and note
 * that the client script strips ?k= from the URL on arrival.
 */

export type Recipient = {
  /** Token from the ?k= parameter. Unique per person. */
  token: string;
  /** Display name used in the notification subject line. */
  name: string;
  /** Company, for the subject line. */
  company: string;
  /**
   * Recipient's email. Used to look them up in HubSpot so the session
   * summary lands on their contact timeline. Optional — without it the
   * notification email still sends, it just isn't written to the CRM.
   */
  email?: string;
  /** Page slugs this token is valid for. Guards against token reuse across proposals. */
  slugs: string[];
  /** Optional free-text note shown in the notification (e.g. "CFO, signs off"). */
  context?: string;
};

/**
 * Live recipients. Prune entries once a deal closes — a token left active
 * keeps emailing you every time someone re-reads an old proposal.
 */
export const RECIPIENTS: Recipient[] = [
  // Example — replace with real recipients. Left in place (with a token that
  // is not in circulation) so the shape is obvious when adding the next one.
  // {
  //   token: "a7f3c9d1",
  //   name: "Sarah",
  //   company: "Boothalicious",
  //   email: "sarah@boothalicious.com.au",
  //   slugs: ["boothalicious-seo-audit"],
  //   context: "Owner — makes the call",
  // },
];

/** Tokens are compared case-insensitively and trimmed; anything else is rejected. */
const TOKEN_RE = /^[a-z0-9]{6,32}$/;

/**
 * Pure form, so the matching rules can be tested without touching the live
 * recipient list. Returns null for anything that isn't an exact, in-date
 * token/slug pair — the endpoint treats null as "track nothing".
 */
export function matchRecipient(
  recipients: Recipient[],
  rawToken: unknown,
  slug: unknown,
): Recipient | null {
  if (typeof rawToken !== "string" || typeof slug !== "string" || !slug) return null;
  const token = rawToken.trim().toLowerCase();
  if (!TOKEN_RE.test(token)) return null;

  const hit = recipients.find((r) => r.token.trim().toLowerCase() === token);
  if (!hit) return null;
  // A token issued for one proposal must not silently track another.
  if (!hit.slugs.includes(slug)) return null;
  return hit;
}

export function lookupRecipient(rawToken: unknown, slug: string): Recipient | null {
  return matchRecipient(RECIPIENTS, rawToken, slug);
}
