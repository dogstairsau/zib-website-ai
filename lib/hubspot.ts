/**
 * Lead capture. HubSpot first, Slack notification optional.
 * Both stub to console if env vars are missing — safe to ship without keys.
 *
 * When auditContext is supplied, a HubSpot note is attached to the contact
 * record so partners see the strategist read + SEO snapshot
 * when they open the contact in HubSpot — e.g. just before a meeting.
 */

import { submitHubSpotForm } from "./hubspotForms";

export type Lead = {
  email: string;
  firstname?: string;
  company?: string;
  phone?: string;
  website: string;
  source?: string;
  /** Qualification tier from lib/qualify.ts — "qualified" | "review" | "nurture". */
  tier?: string;
  /** 0-100 opportunity score, same scale as the /start pre-discovery qualifier. */
  score?: number;
  /**
   * Ad click ids captured on landing (gclid / fbclid / utm_*). Stored on the
   * contact so HubSpot outcomes — SQL, closed-won — can be uploaded back to
   * Google Ads and Meta later. See docs/offline-conversions.md.
   */
  clickIds?: Record<string, string>;
};

/**
 * Contact properties beyond the always-present set. They're sent separately
 * because a HubSpot portal that hasn't had them created yet rejects the whole
 * request with a 400 — see pushToHubSpot's retry.
 */
function optionalProperties(lead: Lead): Record<string, string> {
  const props: Record<string, string> = {};
  if (lead.tier) props.lead_tier = lead.tier;
  if (typeof lead.score === "number") props.lead_score = String(lead.score);
  for (const [k, v] of Object.entries(lead.clickIds || {})) {
    if (!v) continue;
    // Only the keys we document as properties — an unexpected query param
    // shouldn't become a write to an arbitrary field.
    if (!/^(gclid|wbraid|gbraid|fbclid|msclkid|utm_source|utm_medium|utm_campaign|utm_content|utm_term)$/.test(k)) continue;
    props[k] = String(v).slice(0, 512);
  }
  return props;
}

export type AuditContext = {
  url: string;
  strategistText?: string;
  overallScore?: number;
  passed?: number;
  issues?: number;
  pagesCrawled?: number;
};

export async function captureLead(lead: Lead, auditContext?: AuditContext): Promise<void> {
  const [hubspotResult] = await Promise.allSettled([
    pushToHubSpot(lead),
    notifySlack(lead),
    // Forms path: no token needed, native workflow triggers. Routed per
    // tool by the source string; no-op until the form env vars are set.
    submitHubSpotForm(lead.source || "Zib website", {
      email: lead.email,
      firstname: lead.firstname,
      phone: lead.phone,
      website: lead.website,
      lead_source: lead.source,
    }),
  ]);

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

  const base: Record<string, string> = {
    email: lead.email,
    firstname: lead.firstname || "",
    company: lead.company || "",
    ...(lead.phone ? { phone: lead.phone } : {}),
    website: lead.website,
    lifecyclestage: "lead",
    hs_lead_status: "NEW",
    lead_source: lead.source || "Homepage audit",
  };
  const extra = optionalProperties(lead);

  const post = (properties: Record<string, string>) =>
    fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
      signal: AbortSignal.timeout(10_000),
    });

  let res = await post({ ...base, ...extra });

  // The tier, score and click-id properties have to be created in the portal
  // before HubSpot will accept them, and it rejects the entire contact if any
  // one of them is missing. Losing the lead over a property that hasn't been
  // set up yet is the worse failure, so drop the extras and try once more —
  // they start populating on their own the moment the portal has them.
  if (!res.ok && res.status === 400 && Object.keys(extra).length) {
    const detail = await res.text().catch(() => "");
    console.warn("[hubspot] retrying without optional properties:", detail.slice(0, 300));
    res = await post(base);
  }

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
  await attachNote(contactId, buildNoteHtml(ctx));
}

async function attachNote(contactId: string, noteBody: string): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) return;

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

export type QuizLead = {
  email: string;
  firstname?: string;
  /** Winning segment name, present on the completion call. */
  segment?: string;
  /** Question/answer pairs collected so far. */
  answers?: { q: string; a: string }[];
};

/**
 * Growth-quiz lead capture. Called twice per prospect: once at the mid-quiz
 * email gate (creates the contact, so abandoners are still leads) and once on
 * completion (attaches a note with the full answers + winning segment).
 */
export async function captureQuizLead(quiz: QuizLead): Promise<void> {
  const lead: Lead = {
    email: quiz.email,
    firstname: quiz.firstname || "",
    website: "",
    source: "Growth quiz",
  };

  const [hubspotResult] = await Promise.allSettled([
    pushToHubSpot(lead),
    notifyQuizSlack(quiz),
    submitHubSpotForm("Growth quiz", {
      email: quiz.email,
      firstname: quiz.firstname,
      lead_source: "Growth quiz",
    }),
  ]);

  if (!quiz.segment) return; // gate stage — contact only
  if (hubspotResult.status !== "fulfilled") return;
  const contactId = hubspotResult.value;
  if (!contactId) return;

  await attachNote(contactId, buildQuizNoteHtml(quiz)).catch((e) =>
    console.warn("[hubspot:quiz-note]", (e as Error).message),
  );
}

function buildQuizNoteHtml(quiz: QuizLead): string {
  const safe = (s: string | undefined | null) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const rows = (quiz.answers || [])
    .map((p) => `<li><b>${safe(p.q)}</b><br/>${safe(p.a)}</li>`)
    .join("");

  return (
    `<p><b>Growth quiz result</b> · auto-attached from /growth-quiz</p>` +
    `<p><b>Segment:</b> ${safe(quiz.segment)}</p>` +
    (rows ? `<ul>${rows}</ul>` : "")
  );
}

async function notifyQuizSlack(quiz: QuizLead): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;
  const label = quiz.segment
    ? `finished the growth quiz — segment *${quiz.segment}*`
    : "hit the growth-quiz email gate";
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `:dart: Quiz lead — *${quiz.email}* ${label}` }),
    signal: AbortSignal.timeout(5_000),
  }).catch((e) => console.warn("[slack]", e.message));
}

export type LabQuiz = {
  email: string;
  url: string;
  lab: string;
  answers: { q: string; a: string }[];
  /** Tier from lib/qualify.ts, so the note leads with the verdict. */
  tier?: string;
  score?: number;
  clickIds?: Record<string, string>;
};

/**
 * Ads-lab micro-quiz capture: attaches budget/goal answers as a note on the
 * contact the lab's lead capture already created, so the strategist walks
 * into the 24h call briefed. Best-effort — creates the contact if the lead
 * capture hasn't landed yet.
 */
export async function captureLabQuiz(quiz: LabQuiz): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.log("[hubspot:lab-quiz stub]", quiz);
    return;
  }
  let contactId = await findContactIdByEmail(token, quiz.email);
  if (!contactId) {
    contactId = await pushToHubSpot({
      email: quiz.email,
      website: quiz.url,
      source: `${quiz.lab} quiz`,
      tier: quiz.tier,
      score: quiz.score,
      clickIds: quiz.clickIds,
    }).catch(() => null);
  }
  if (!contactId) return;

  const safe = (s: string) =>
    String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rows = quiz.answers.map((p) => `<li><b>${safe(p.q)}</b><br/>${safe(p.a)}</li>`).join("");

  // Lead with the verdict. Whoever opens this contact is deciding whether to
  // spend half an hour on the call, and that decision shouldn't require
  // reading four answers and doing the arithmetic themselves.
  const VERDICT: Record<string, string> = {
    qualified: "✅ QUALIFIED — budget and intent both present. Worth the call.",
    review: "🟡 REVIEW — real budget, softer timing. Clarify priorities first.",
    nurture: "⛔ NURTURE — no budget or just researching. Do not call; email only.",
  };
  const verdict = quiz.tier
    ? `<p><b>${safe(VERDICT[quiz.tier] || quiz.tier)}</b>${
        typeof quiz.score === "number" ? ` <span>(score ${quiz.score}/100)</span>` : ""
      }</p>`
    : "";

  const note =
    `<p><b>${safe(quiz.lab)} quiz</b> · answered before their results were generated</p>` +
    verdict +
    `<p><b>Site:</b> ${safe(quiz.url)}</p><ul>${rows}</ul>`;
  await attachNote(contactId, note).catch((e) =>
    console.warn("[hubspot:lab-quiz-note]", (e as Error).message),
  );
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
