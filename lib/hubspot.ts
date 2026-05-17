/**
 * Lead capture. HubSpot first, Slack notification optional.
 * Both stub to console if env vars are missing — safe to ship without keys.
 *
 * When auditContext is supplied, a HubSpot note is attached to the contact
 * record so partners (Brad et al) see the strategist read + SEO snapshot
 * when they open the contact in HubSpot — e.g. just before a meeting.
 */

export type Lead = {
  email: string;
  firstname?: string;
  company?: string;
  website: string;
  source?: string;
};

export type AuditContext = {
  url: string;
  strategistText?: string;
  overallScore?: number;
  passed?: number;
  issues?: number;
  pagesCrawled?: number;
};

export async function captureLead(lead: Lead, auditContext?: AuditContext): Promise<void> {
  const [hubspotResult] = await Promise.allSettled([pushToHubSpot(lead), notifySlack(lead)]);

  if (!auditContext) return;
  if (hubspotResult.status !== "fulfilled") return;
  const contactId = hubspotResult.value;
  if (!contactId) return;

  await attachAuditNote(contactId, auditContext).catch((e) =>
    console.warn("[hubspot:note]", (e as Error).message),
  );
}

async function pushToHubSpot(lead: Lead): Promise<string | null> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.log("[hubspot:stub]", lead);
    return null;
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        email: lead.email,
        firstname: lead.firstname || "",
        company: lead.company || "",
        website: lead.website,
        lifecyclestage: "lead",
        hs_lead_status: "NEW",
        lead_source: lead.source || "Homepage audit",
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (res.ok) {
    const body = await res.json().catch(() => ({}));
    return body?.id || null;
  }

  // 409 = contact already exists — look it up by email so we can still attach the note
  if (res.status === 409) {
    return findContactIdByEmail(token, lead.email);
  }

  const body = await res.text().catch(() => "");
  throw new Error(`HubSpot ${res.status}: ${body.slice(0, 200)}`);
}

async function findContactIdByEmail(token: string, email: string): Promise<string | null> {
  const res = await fetch(
    `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(email)}?idProperty=email`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!res.ok) return null;
  const body = await res.json().catch(() => ({}));
  return body?.id || null;
}

async function attachAuditNote(contactId: string, ctx: AuditContext): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return;

  const noteBody = buildNoteHtml(ctx);

  // associationTypeId 202 = note → contact (HUBSPOT_DEFINED)
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/notes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        hs_timestamp: new Date().toISOString(),
        hs_note_body: noteBody,
      },
      associations: [
        {
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot note ${res.status}: ${body.slice(0, 200)}`);
  }
}

function buildNoteHtml(ctx: AuditContext): string {
  const safe = (s: string | undefined | null) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const score = ctx.overallScore !== undefined ? String(ctx.overallScore) : "—";
  const stats = `<p><b>Audited:</b> ${safe(ctx.url)}<br/>` +
    `<b>Overall score:</b> ${score} &nbsp; | &nbsp; ` +
    `<b>Passed:</b> ${ctx.passed ?? "—"} &nbsp; | &nbsp; ` +
    `<b>Issues:</b> ${ctx.issues ?? "—"} &nbsp; | &nbsp; ` +
    `<b>Pages crawled:</b> ${ctx.pagesCrawled ?? "—"}</p>`;

  const review = ctx.strategistText
    ? `<p><b>Strategist read:</b></p><div style="white-space:pre-wrap;">${safe(ctx.strategistText)}</div>`
    : "";

  return `<p><b>Zib audit context</b> · auto-attached from the audit form</p>${stats}${review}`;
}

async function notifySlack(lead: Lead): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `:zap: New audit lead — *${lead.email}* ran an audit on <${lead.website}|${lead.website}>${lead.company ? ` (${lead.company})` : ""}`,
    }),
    signal: AbortSignal.timeout(5_000),
  }).catch((e) => console.warn("[slack]", e.message));
}
