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

function renderHtml(p: LeadEmail, host: string): string {
  const safe = (s: string | undefined) => esc(s || "");
  const a = p.audit || {};

  return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:680px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin:0 0 4px;">New audit submission</h1>
  <p style="color:#6B6B6B;margin:0 0 24px;">${safe(host)}</p>

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
