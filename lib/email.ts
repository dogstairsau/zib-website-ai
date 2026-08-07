/**
 * Resend-backed lead notification email.
 * Fails open if RESEND_API_KEY / LEAD_NOTIFY_EMAIL aren't set, so the
 * audit endpoint keeps working before Resend is configured.
 *
 * Setup:
 *   1. Sign up at https://resend.com (free tier: 3k emails/month).
 *   2. Verify a sending domain (or use onboarding@resend.dev for testing).
 *   3. Create an API key.
 *   4. Add to Vercel env vars (all 3 environments):
 *        RESEND_API_KEY        = re_...
 *        LEAD_NOTIFY_FROM      = audits@yourdomain.com (must be verified)
 *        LEAD_NOTIFY_EMAIL     = where to send notifications
 */

export type LeadEmailCheck = {
  title: string;
  status: "pass" | "warn" | "fail";
  value: string;
};

export type LeadEmailCategory = {
  label: string;
  score: number;
  checks?: LeadEmailCheck[];
};

export type LeadEmail = {
  url: string;
  email: string;
  phone?: string;
  source?: string;
  strategistText?: string;
  discoveryQuestion?: string;
  jsRendered?: { signals: string[] };
  audit?: {
    overallScore?: number;
    passed?: number;
    issues?: number;
    pagesCrawled?: number;
    categories?: LeadEmailCategory[];
  };
};

export async function sendLeadEmail(payload: LeadEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev";
  const to = process.env.LEAD_NOTIFY_EMAIL;

  if (!apiKey || !to) {
    console.log("[email:stub]", { url: payload.url, email: payload.email });
    return;
  }

  let host = "";
  try { host = new URL(payload.url).hostname; } catch { host = payload.url; }

  const subject = `New Zib audit · ${host} · ${payload.email}`;
  const html = renderHtml(payload, host);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[email] Resend error:", res.status, body.slice(0, 200));
    }
  } catch (e) {
    console.warn("[email] fetch failed:", (e as Error).message);
  }
}

export type LabQuizEmail = {
  email: string;
  url: string;
  lab: string;
  answers: { q: string; a: string }[];
};

/**
 * Internal notification with the ads-lab quiz answers (budget + goal),
 * sent to LEAD_NOTIFY_EMAIL so the strategist is briefed for the 24h call
 * even before HubSpot is connected.
 */
export async function sendLabQuizEmail(p: LabQuizEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev";
  const to = process.env.LEAD_NOTIFY_EMAIL;
  if (!apiKey || !to) {
    console.log("[email:lab-quiz stub]", { email: p.email, answers: p.answers });
    return;
  }

  let host = "";
  try { host = new URL(p.url).hostname; } catch { host = p.url; }

  const rows = p.answers.map((x) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:220px;">${esc(x.q)}</td><td style="padding:6px 0;font-weight:600;">${esc(x.a)}</td></tr>`).join("");
  const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:680px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin:0 0 4px;">${esc(p.lab)} · quiz answers</h1>
  <p style="color:#6B6B6B;margin:0 0 24px;">Answered while their pack generated. Read before the 24h call.</p>
  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;font-size:14px;">
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:220px;">Prospect</td><td style="padding:6px 0;"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Site</td><td style="padding:6px 0;"><a href="${esc(p.url)}">${esc(host)}</a></td></tr>
    ${rows}
  </table>
</body></html>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: `${p.lab} quiz · ${host} · ${p.email}`, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[email:lab-quiz] Resend error:", res.status, body.slice(0, 200));
    }
  } catch (e) {
    console.warn("[email:lab-quiz] fetch failed:", (e as Error).message);
  }
}

function renderHtml(p: LeadEmail, host: string): string {
  const safe = (s: string | undefined) => esc(s || "");
  const a = p.audit || {};

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:680px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin:0 0 4px;">New audit submission</h1>
  <p style="color:#6B6B6B;margin:0 0 24px;">${safe(host)}</p>

  ${p.jsRendered ? `
  <div style="margin:0 0 24px;padding:14px 18px;background:#FFF6E5;border:1px solid #FFD79A;border-left:4px solid #FF9D00;border-radius:8px;">
    <div style="font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#A86200;margin-bottom:6px;">Heads up · JS-rendered site</div>
    <div style="font-size:13.5px;line-height:1.5;color:#1A1A1A;">
      Our crawler reads static HTML only — the audit below is based on what we could see without running JavaScript. If the prospect pushes back on a finding ("we have that on the page"), they may be right and the content hydrates client-side. Signals detected: <strong>${safe(p.jsRendered.signals.join(", "))}</strong>.
    </div>
  </div>
  ` : ""}

  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;font-size:14px;">
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:140px;">Email</td><td style="padding:6px 0;"><a href="mailto:${safe(p.email)}">${safe(p.email)}</a></td></tr>
    ${p.phone ? `<tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Phone</td><td style="padding:6px 0;"><a href="tel:${safe(p.phone)}">${safe(p.phone)}</a></td></tr>` : ""}
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Site audited</td><td style="padding:6px 0;"><a href="${safe(p.url)}">${safe(p.url)}</a></td></tr>
    ${p.source ? `<tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Source</td><td style="padding:6px 0;">${safe(p.source)}</td></tr>` : ""}
  </table>

  ${a.overallScore !== undefined ? `
  <h2 style="font-size:16px;margin:0 0 8px;">Audit scores</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;font-size:14px;">
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:140px;">Overall</td><td style="padding:6px 0;font-weight:600;">${a.overallScore}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Passed</td><td style="padding:6px 0;">${a.passed ?? "-"}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Issues</td><td style="padding:6px 0;">${a.issues ?? "-"}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Pages crawled</td><td style="padding:6px 0;">${a.pagesCrawled ?? "-"}</td></tr>
  </table>
  ` : ""}

  ${renderSeoSummary(a.categories)}

  ${p.strategistText ? `
  <h2 style="font-size:16px;margin:0 0 8px;">Strategist read</h2>
  <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1A1A1A;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;padding:16px;">${safe(p.strategistText)}</div>
  ` : ""}

  ${p.discoveryQuestion ? `
  <div style="margin-top:32px;padding-top:24px;border-top:2px solid #0F0F0F;">
    <h2 style="font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.08em;color:#FF6200;">Ask the prospect this question</h2>
    <p style="font-size:17px;line-height:1.45;color:#0F0F0F;margin:0;font-weight:500;">${safe(p.discoveryQuestion)}</p>
    <p style="font-size:12px;color:#9C9C9C;margin:14px 0 0;font-style:italic;">Generated from this prospect's audit. Use as the conversation opener — don't lead with "what did you think of the audit?"</p>
  </div>
  ` : ""}
</body></html>`;
}

function renderSeoSummary(categories: LeadEmailCategory[] | undefined): string {
  if (!categories || categories.length === 0) return "";

  const statusEmoji = { pass: "✓", warn: "!", fail: "✗" } as const;
  const statusColor = { pass: "#0BAB6E", warn: "#FF9D00", fail: "#E03A3A" } as const;
  const scoreColor = (s: number) => (s >= 80 ? "#0BAB6E" : s >= 60 ? "#FF9D00" : "#E03A3A");

  const rows = categories
    .slice()
    .sort((a, b) => a.score - b.score)
    .map((c) => `
      <tr>
        <td style="padding:8px 12px 8px 0;color:#1A1A1A;font-weight:500;">${esc(c.label)}</td>
        <td style="padding:8px 0;text-align:right;font-weight:600;color:${scoreColor(c.score)};">${c.score}<span style="color:#9C9C9C;font-weight:400;">/100</span></td>
      </tr>
    `).join("");

  // Top 5 failing / warning checks, lowest-scoring categories first
  const failingChecks = categories
    .slice()
    .sort((a, b) => a.score - b.score)
    .flatMap((c) =>
      (c.checks || [])
        .filter((ch) => ch.status === "fail" || ch.status === "warn")
        .map((ch) => ({ ...ch, category: c.label })),
    )
    .slice(0, 5);

  const issueRows = failingChecks.length
    ? failingChecks.map((ch) => `
      <tr>
        <td style="padding:6px 10px 6px 0;vertical-align:top;width:24px;color:${statusColor[ch.status]};font-weight:700;">${statusEmoji[ch.status]}</td>
        <td style="padding:6px 0;font-size:13px;color:#1A1A1A;">
          <span style="font-weight:500;">${esc(ch.title)}</span>
          <span style="color:#9C9C9C;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;margin-left:6px;">${esc(ch.category)}</span>
          ${ch.value ? `<br><span style="color:#6B6B6B;font-size:12px;">${esc(ch.value)}</span>` : ""}
        </td>
      </tr>
    `).join("")
    : "";

  return `
  <h2 style="font-size:16px;margin:0 0 8px;">SEO summary</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:16px;font-size:14px;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;overflow:hidden;">
    <tbody>
      ${rows}
    </tbody>
  </table>

  ${issueRows ? `
  <p style="font-size:13px;color:#6B6B6B;margin:0 0 8px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Top issues to talk to about</p>
  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
    <tbody>${issueRows}</tbody>
  </table>
  ` : ""}
  `;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── Pre-discovery qualifier email (/start) ─────────────────────────
// Internal notification to the partner. Carries the prospect's answers, the
// indicative teaser they saw, and the behind-the-scenes qualification (RAG,
// opportunity + confidence scores, recommended next action). No HubSpot for
// now — the partner gets the lead straight to their inbox.

export type QualifierLead = {
  business: string;
  website: string;
  name: string;
  email: string;
  phone: string;
  locations: string;
  industry: string;
  keywords: string;
  frustration: string;
  extra: string;
  goal: string;
  channel: string;
  urgency: string;
  dealValue: string;
  spend: string;
  running: string;
  partnerName: string;
  prospectFor: string;
  sourceTag: string;
};

export type QualifierQualification = {
  rag: "green" | "yellow" | "red";
  opportunityScore: number;
  confidence: number;
  nextAction: string;
  completeness: number;
  reasons: string[];
};

export type QualifierTeaser = {
  volume: number;
  volumeNote: string;
  channelRead: string;
  nextSteps: string[];
  confidence: string;
} | null;

export async function sendQualifierEmail(payload: {
  lead: QualifierLead;
  qualification: QualifierQualification;
  teaser: QualifierTeaser;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev";
  const to = process.env.LEAD_NOTIFY_EMAIL;

  if (!apiKey || !to) {
    console.log("[qualifier:stub]", {
      business: payload.lead.business,
      email: payload.lead.email,
      rag: payload.qualification.rag,
      opportunity: payload.qualification.opportunityScore,
    });
    return;
  }

  const { lead, qualification } = payload;
  const ragWord = { green: "GREEN", yellow: "YELLOW", red: "RED" }[qualification.rag];
  const subject = `Pre-discovery · ${ragWord} · ${lead.business} · ${lead.email}`;
  const html = renderQualifierHtml(payload);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const b = await res.text().catch(() => "");
      console.warn("[qualifier] Resend error:", res.status, b.slice(0, 200));
    }
  } catch (e) {
    console.warn("[qualifier] fetch failed:", (e as Error).message);
  }
}

function renderQualifierHtml(p: {
  lead: QualifierLead;
  qualification: QualifierQualification;
  teaser: QualifierTeaser;
}): string {
  const { lead: l, qualification: q, teaser: t } = p;
  const safe = (s: string | undefined) => esc(s || "");
  const ragColor = { green: "#0BAB6E", yellow: "#FF9D00", red: "#E03A3A" }[q.rag];
  const ragLabel = { green: "Green · strong fit", yellow: "Yellow · needs clarifying", red: "Red · low fit" }[q.rag];

  const row = (k: string, v: string, link?: string) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:150px;vertical-align:top;">${k}</td><td style="padding:6px 0;">${link ? `<a href="${link}">${v}</a>` : v}</td></tr>`;

  const teaserBlock = t
    ? `
  <h2 style="font-size:16px;margin:24px 0 8px;">Teaser the prospect saw</h2>
  <div style="font-size:14px;line-height:1.6;color:#1A1A1A;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;padding:16px;">
    <div style="font-weight:600;margin-bottom:6px;">Indicative monthly demand: ${t.volume > 0 ? `~${t.volume.toLocaleString("en-AU")}` : "n/a"}${t.volumeNote ? ` <span style="color:#6B6B6B;font-weight:400;">(${safe(t.volumeNote)})</span>` : ""}</div>
    ${t.channelRead ? `<div style="margin-bottom:8px;">${safe(t.channelRead)}</div>` : ""}
    ${t.nextSteps && t.nextSteps.length ? `<ul style="margin:6px 0 0;padding-left:18px;">${t.nextSteps.map((s) => `<li>${safe(s)}</li>`).join("")}</ul>` : ""}
    <div style="font-size:11px;color:#9C9C9C;margin-top:10px;text-transform:uppercase;letter-spacing:0.06em;">Teaser confidence: ${safe(t.confidence)}</div>
  </div>`
    : `<p style="font-size:13px;color:#9C9C9C;margin:18px 0;">No teaser generated (lookup unavailable). Prospect saw the qualitative fallback.</p>`;

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:680px;margin:0 auto;padding:24px;">
  <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#FF6200;font-weight:600;margin-bottom:8px;">Zib Digital · Pre-discovery qualifier</div>
  <h1 style="font-size:22px;margin:0 0 4px;">${safe(l.business)}</h1>
  <p style="color:#6B6B6B;margin:0 0 20px;">${safe(l.industry) || "New pre-discovery lead"}</p>

  <div style="display:inline-block;padding:8px 16px;border-radius:999px;background:${ragColor};color:#fff;font-weight:600;font-size:13px;letter-spacing:0.04em;margin-bottom:18px;">${ragLabel}</div>

  <table style="border-collapse:collapse;width:100%;margin-bottom:20px;font-size:14px;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;overflow:hidden;">
    ${row("Recommended action", `<strong>${safe(q.nextAction)}</strong>`)}
    ${row("Opportunity score", `${q.opportunityScore}/100`)}
    ${row("Confidence score", `${q.confidence}/100`)}
    ${row("Completeness", `${q.completeness}%`)}
  </table>

  <h2 style="font-size:16px;margin:0 0 8px;">Why</h2>
  <ul style="margin:0 0 20px;padding-left:18px;font-size:13.5px;color:#1A1A1A;">
    ${q.reasons.map((r) => `<li>${safe(r)}</li>`).join("")}
  </ul>
  <p style="font-size:12px;color:#9C9C9C;margin:-10px 0 24px;font-style:italic;">RAG + scores are indicative — a human still makes the call. Nothing here auto-declines anyone.</p>

  <h2 style="font-size:16px;margin:0 0 8px;">Contact</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:8px;font-size:14px;">
    ${row("Name", safe(l.name))}
    ${row("Email", safe(l.email), `mailto:${safe(l.email)}`)}
    ${l.phone ? row("Phone", safe(l.phone), `tel:${safe(l.phone)}`) : ""}
    ${l.website ? row("Website", safe(l.website), safe(l.website)) : ""}
    ${l.locations ? row("Target locations", safe(l.locations)) : ""}
    ${l.partnerName ? row("Routed to partner", safe(l.partnerName)) : ""}
    ${l.prospectFor ? row("Personalised for", safe(l.prospectFor)) : ""}
  </table>

  <h2 style="font-size:16px;margin:24px 0 8px;">What they want</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:8px;font-size:14px;">
    ${row("Primary goal", safe(l.goal))}
    ${row("Channel interest", safe(l.channel))}
    ${row("Timeframe", safe(l.urgency))}
    ${l.keywords ? row("Wants to be found for", safe(l.keywords)) : ""}
  </table>

  <h2 style="font-size:16px;margin:24px 0 8px;">Fit &amp; scale</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:8px;font-size:14px;">
    ${row("Avg deal value", safe(l.dealValue))}
    ${row("Monthly spend", safe(l.spend))}
    ${row("Running ads/SEO now", safe(l.running))}
  </table>

  ${l.frustration ? `<h2 style="font-size:16px;margin:24px 0 8px;">Biggest frustration</h2><div style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;padding:14px;">${safe(l.frustration)}</div>` : ""}
  ${l.extra ? `<h2 style="font-size:16px;margin:24px 0 8px;">Anything else</h2><div style="white-space:pre-wrap;font-size:14px;line-height:1.6;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;padding:14px;">${safe(l.extra)}</div>` : ""}

  ${teaserBlock}

  <p style="margin-top:32px;font-size:11px;color:#9C9C9C;text-align:center;">Zib Digital · Pre-discovery qualifier · ${safe(l.sourceTag)}</p>
</body></html>`;
}

// ─── Meta Ads Lab pack email ────────────────────────────────────────
// Sent to the prospect (the actual pack) AND to the internal team
// (so partners can see what the prospect saw). Same HTML body, different
// recipients + subject lines.

export type MetaAdsPackAd = {
  platform: string;
  format: string;
  angle: string;
  audience: string;
  headline: string;
  body: string;
  cta: string;
};

export type MetaAdsPack = {
  url: string;
  email: string;
  firstname: string;
  phone?: string;
  brand: { name: string; tagline: string; category: string; domain: string };
  audience: string;
  heroAds: MetaAdsPackAd[];      // shown on the page with images
  variationAds: MetaAdsPackAd[]; // text-only, additional 8
};

export async function sendMetaAdsPack(pack: MetaAdsPack): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev";
  const internalTo = process.env.LEAD_NOTIFY_EMAIL;

  console.log("[meta-ads pack] sending", {
    hasApiKey: !!apiKey,
    from,
    prospectTo: pack.email,
    internalTo: internalTo || "(not set)",
    heroCount: pack.heroAds?.length || 0,
    variationCount: pack.variationAds?.length || 0,
  });

  if (!apiKey) {
    console.log("[meta-ads pack:stub] no RESEND_API_KEY", { url: pack.url, email: pack.email });
    return;
  }

  const html = renderMetaAdsPackHtml(pack);
  const brandName = pack.brand?.name || "your brand";
  const prospectSubject = `Your Meta ads pack — ${brandName}`;
  const internalSubject = `New Meta Ads Lab lead · ${brandName} · ${pack.email}`;

  const sendTo = async (to: string, subject: string, label: string) => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, html }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text().catch(() => "");
      if (!res.ok) {
        console.warn(`[meta-ads pack:${label}] Resend ${res.status}`, body.slice(0, 300));
      } else {
        console.log(`[meta-ads pack:${label}] sent ok`, { status: res.status, htmlLength: html.length });
      }
    } catch (e) {
      console.warn(`[meta-ads pack:${label}] fetch failed`, (e as Error).message);
    }
  };

  const sends: Promise<void>[] = [];
  if (pack.email) sends.push(sendTo(pack.email, prospectSubject, "prospect"));
  if (internalTo) sends.push(sendTo(internalTo, internalSubject, "internal"));
  await Promise.all(sends);
}

function renderMetaAdsPackHtml(pack: MetaAdsPack): string {
  const safe = (s: string | undefined) => esc(s || "");
  const all = [...pack.heroAds, ...pack.variationAds];
  const totalCount = all.length;

  const adCard = (ad: MetaAdsPackAd, i: number, isHero: boolean) => `
    <div style="margin:0 0 14px;padding:18px 20px;background:#FAFAF8;border:1px solid #E8E5DD;border-left:4px solid ${isHero ? "#FF6200" : "#0F0F0F"};border-radius:8px;">
      <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9C9C9C;font-weight:600;">
        <span>${isHero ? "Hero" : "Variation"} ${String(i).padStart(2, "0")} · ${safe(ad.angle)}</span>
        <span>${safe(ad.format)}</span>
      </div>
      <div style="font-size:17px;font-weight:500;line-height:1.25;color:#0F0F0F;margin-bottom:8px;">${safe(ad.headline)}</div>
      <div style="font-size:14px;line-height:1.55;color:#1A1A1A;margin-bottom:14px;">${safe(ad.body)}</div>
      <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:#6B6B6B;">
        <span>${safe(ad.platform)} · ${safe(ad.audience)}</span>
        <span style="background:#0F0F0F;color:#fff;padding:3px 10px;border-radius:4px;font-weight:500;">${safe(ad.cta)}</span>
      </div>
    </div>`;

  let i = 0;
  const heroBlock = pack.heroAds.map((ad) => adCard(ad, ++i, true)).join("");
  const variationBlock = pack.variationAds.map((ad) => adCard(ad, ++i, false)).join("");

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:720px;margin:0 auto;padding:24px;background:#fff;">
  <div style="text-align:center;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #0F0F0F;">
    <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#FF6200;font-weight:600;margin-bottom:10px;">Zib Digital · Meta Ads Lab</div>
    <h1 style="font-size:28px;margin:0 0 8px;line-height:1.1;letter-spacing:-0.02em;">Your ${totalCount} Meta ads, ${safe(pack.firstname) || "ready"}.</h1>
    <p style="color:#6B6B6B;margin:0;font-size:14px;">Drafted for ${safe(pack.brand?.name || pack.url)} — strategy call within 24h.</p>
  </div>

  <table style="border-collapse:collapse;width:100%;margin-bottom:28px;font-size:13.5px;">
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:120px;">Brand</td><td style="padding:6px 0;font-weight:500;">${safe(pack.brand?.name)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Category</td><td style="padding:6px 0;">${safe(pack.brand?.category)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Audience</td><td style="padding:6px 0;">${safe(pack.audience)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Site</td><td style="padding:6px 0;"><a href="${safe(pack.url)}" style="color:#FF6200;">${safe(pack.url)}</a></td></tr>
  </table>

  <h2 style="font-size:18px;margin:0 0 6px;letter-spacing:-0.01em;">Hero ads</h2>
  <p style="font-size:13px;color:#6B6B6B;margin:0 0 16px;">The 4 we previewed on the page — fully designed visuals + copy.</p>
  ${heroBlock}

  <h2 style="font-size:18px;margin:28px 0 6px;letter-spacing:-0.01em;">Additional concepts</h2>
  <p style="font-size:13px;color:#6B6B6B;margin:0 0 16px;">8 more concepts across retargeting, lookalikes and video hooks. Copy is ready — happy to mock the visuals on the strategy call.</p>
  ${variationBlock}

  <div style="margin-top:36px;padding:24px;background:#0F0F0F;color:#fff;border-radius:12px;text-align:center;">
    <h3 style="margin:0 0 8px;font-size:18px;letter-spacing:-0.01em;">Want a second pair of eyes on this?</h3>
    <p style="margin:0 0 14px;font-size:14px;color:rgba(255,255,255,0.72);line-height:1.5;">A senior Meta strategist will reach out within 24 hours to walk through the brief, sharpen the angles and answer any questions on targeting.</p>
    <a href="mailto:michael.glasser@zibdigital.com.au?subject=Meta%20Ads%20Lab%20-%20${encodeURIComponent(pack.brand?.name || pack.url)}" style="display:inline-block;padding:12px 24px;background:#FF6200;color:#fff;text-decoration:none;border-radius:999px;font-weight:500;font-size:14px;">Reply to talk to a strategist →</a>
  </div>

  <p style="margin-top:36px;font-size:11px;color:#9C9C9C;text-align:center;line-height:1.6;">
    Zib Digital · Australian digital agency, est. 2009 · Meta Business Partner<br/>
    This pack was drafted from a one-shot read of ${safe(new URL(pack.url).hostname.replace(/^www\./, ""))}. Real campaign work involves deeper customer research and creative iteration.
  </p>
</body></html>`;
}

// ─── Google Ads Lab pack email ──────────────────────────────────────
// Sent to the prospect (the actual pack) AND the internal team. Same body,
// different recipients + subject lines. Mirrors the Meta Ads Lab pack.

export type GoogleAdsPack = {
  url: string;
  email: string;
  firstname: string;
  phone?: string;
  brand: { name: string; tagline: string; category: string; domain: string };
  transparencyUrl: string;
  audit: { title: string; detail: string }[];
  search: { headlines: string[]; descriptions: string[]; paths: string[] };
  keywordThemes: { theme: string; examples: string }[];
  pmax: {
    businessName: string;
    shortHeadlines: string[];
    longHeadlines: string[];
    descriptions: string[];
    callouts: string[];
    sitelinks: { text: string; desc: string }[];
  };
};

export async function sendGoogleAdsPack(pack: GoogleAdsPack): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev";
  const internalTo = process.env.LEAD_NOTIFY_EMAIL;

  if (!apiKey) {
    console.log("[google-ads pack:stub] no RESEND_API_KEY", { url: pack.url, email: pack.email });
    return;
  }

  const html = renderGoogleAdsPackHtml(pack);
  const brandName = pack.brand?.name || "your brand";
  const prospectSubject = `Your Google Ads pack — ${brandName}`;
  const internalSubject = `New Google Ads Lab lead · ${brandName} · ${pack.email}`;

  const sendTo = async (to: string, subject: string, label: string) => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, html }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.text().catch(() => "");
      if (!res.ok) console.warn(`[google-ads pack:${label}] Resend ${res.status}`, body.slice(0, 300));
    } catch (e) {
      console.warn(`[google-ads pack:${label}] fetch failed`, (e as Error).message);
    }
  };

  const sends: Promise<void>[] = [];
  if (pack.email) sends.push(sendTo(pack.email, prospectSubject, "prospect"));
  if (internalTo) sends.push(sendTo(internalTo, internalSubject, "internal"));
  await Promise.all(sends);
}

function renderGoogleAdsPackHtml(pack: GoogleAdsPack): string {
  const safe = (s: string | undefined) => esc(s || "");
  const chip = (s: string) =>
    `<span style="display:inline-block;margin:0 6px 6px 0;padding:6px 10px;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:6px;font-size:13px;color:#1A1A1A;">${safe(s)}</span>`;

  const auditBlock = (pack.audit || [])
    .map(
      (a) => `
    <div style="margin:0 0 12px;padding:14px 18px;background:#FAFAF8;border:1px solid #E8E5DD;border-left:4px solid #FF6200;border-radius:8px;">
      <div style="font-weight:600;font-size:14px;color:#0F0F0F;margin-bottom:4px;">${safe(a.title)}</div>
      <div style="font-size:13.5px;line-height:1.55;color:#1A1A1A;">${safe(a.detail)}</div>
    </div>`,
    )
    .join("");

  const kwBlock = (pack.keywordThemes || [])
    .map(
      (k) => `
    <tr>
      <td style="padding:8px 12px 8px 0;font-weight:500;color:#0F0F0F;vertical-align:top;white-space:nowrap;">${safe(k.theme)}</td>
      <td style="padding:8px 0;color:#6B6B6B;font-size:13.5px;">${safe(k.examples)}</td>
    </tr>`,
    )
    .join("");

  const sitelinkBlock = (pack.pmax?.sitelinks || [])
    .map(
      (s) =>
        `<div style="margin:0 0 8px;"><span style="color:#1A56DB;font-weight:500;">${safe(s.text)}</span> <span style="color:#6B6B6B;font-size:13px;">— ${safe(s.desc)}</span></div>`,
    )
    .join("");

  let host = pack.url;
  try { host = new URL(pack.url).hostname.replace(/^www\./, ""); } catch {}

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:720px;margin:0 auto;padding:24px;background:#fff;">
  <div style="text-align:center;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #0F0F0F;">
    <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#FF6200;font-weight:600;margin-bottom:10px;">Zib Digital · Google Ads Lab</div>
    <h1 style="font-size:28px;margin:0 0 8px;line-height:1.1;letter-spacing:-0.02em;">Your Google Ads pack, ${safe(pack.firstname) || "ready"}.</h1>
    <p style="color:#6B6B6B;margin:0;font-size:14px;">Drafted for ${safe(pack.brand?.name || host)} — strategy call within 24h.</p>
  </div>

  <table style="border-collapse:collapse;width:100%;margin-bottom:24px;font-size:13.5px;">
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:120px;">Brand</td><td style="padding:6px 0;font-weight:500;">${safe(pack.brand?.name)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Category</td><td style="padding:6px 0;">${safe(pack.brand?.category)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Site</td><td style="padding:6px 0;"><a href="${safe(pack.url)}" style="color:#FF6200;">${safe(pack.url)}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Transparency Center</td><td style="padding:6px 0;"><a href="${safe(pack.transparencyUrl)}" style="color:#FF6200;">See live ads for ${safe(host)} →</a></td></tr>
  </table>

  <h2 style="font-size:18px;margin:0 0 10px;letter-spacing:-0.01em;">The Google Ads read</h2>
  ${auditBlock}

  <h2 style="font-size:18px;margin:28px 0 6px;letter-spacing:-0.01em;">Responsive Search Ad</h2>
  <p style="font-size:13px;color:#6B6B6B;margin:0 0 12px;">${pack.search?.headlines?.length || 0} headlines, ${pack.search?.descriptions?.length || 0} descriptions. Load straight into a Search campaign.</p>
  <div style="margin-bottom:8px;">${(pack.search?.headlines || []).map(chip).join("")}</div>
  ${(pack.search?.descriptions || [])
    .map((d) => `<div style="margin:0 0 6px;font-size:14px;color:#1A1A1A;">• ${safe(d)}</div>`)
    .join("")}
  <div style="margin-top:8px;font-size:12px;color:#6B6B6B;">Display path: /${safe(pack.search?.paths?.[0] || "")}/${safe(pack.search?.paths?.[1] || "")}</div>

  <h2 style="font-size:18px;margin:28px 0 8px;letter-spacing:-0.01em;">Keyword themes</h2>
  <table style="border-collapse:collapse;width:100%;margin-bottom:8px;">${kwBlock}</table>

  <h2 style="font-size:18px;margin:28px 0 8px;letter-spacing:-0.01em;">Performance Max asset group</h2>
  <p style="font-size:13px;color:#6B6B6B;margin:0 0 8px;font-weight:500;">Short headlines</p>
  <div style="margin-bottom:10px;">${(pack.pmax?.shortHeadlines || []).map(chip).join("")}</div>
  <p style="font-size:13px;color:#6B6B6B;margin:0 0 8px;font-weight:500;">Long headlines</p>
  ${(pack.pmax?.longHeadlines || []).map((h) => `<div style="margin:0 0 6px;font-size:14px;color:#1A1A1A;">• ${safe(h)}</div>`).join("")}
  <p style="font-size:13px;color:#6B6B6B;margin:16px 0 8px;font-weight:500;">Descriptions</p>
  ${(pack.pmax?.descriptions || []).map((d) => `<div style="margin:0 0 6px;font-size:14px;color:#1A1A1A;">• ${safe(d)}</div>`).join("")}
  <p style="font-size:13px;color:#6B6B6B;margin:16px 0 8px;font-weight:500;">Callouts</p>
  <div style="margin-bottom:10px;">${(pack.pmax?.callouts || []).map(chip).join("")}</div>
  <p style="font-size:13px;color:#6B6B6B;margin:16px 0 8px;font-weight:500;">Sitelinks</p>
  ${sitelinkBlock}
  <p style="font-size:12px;color:#6B6B6B;margin:14px 0 0;">Plus image assets in landscape, square and portrait, previewed on the page. The strategist can hand over the source files on the call.</p>

  <div style="margin-top:36px;padding:24px;background:#0F0F0F;color:#fff;border-radius:12px;text-align:center;">
    <h3 style="margin:0 0 8px;font-size:18px;letter-spacing:-0.01em;">Want a Premier Partner to load this for you?</h3>
    <p style="margin:0 0 14px;font-size:14px;color:rgba(255,255,255,0.72);line-height:1.5;">A senior Google Ads strategist will reach out within 24 hours to pressure-test the structure, the keywords and the budget split before anything goes live.</p>
    <a href="mailto:michael.glasser@zibdigital.com.au?subject=Google%20Ads%20Lab%20-%20${encodeURIComponent(pack.brand?.name || host)}" style="display:inline-block;padding:12px 24px;background:#FF6200;color:#fff;text-decoration:none;border-radius:999px;font-weight:500;font-size:14px;">Reply to talk to a strategist →</a>
  </div>

  <p style="margin-top:36px;font-size:11px;color:#9C9C9C;text-align:center;line-height:1.6;">
    Zib Digital · Australian digital agency, est. 2009 · Google Premier Partner<br/>
    This pack was drafted from a one-shot read of ${safe(host)}. Real campaign work involves deeper keyword research, conversion tracking and creative iteration.
  </p>
</body></html>`;
}

