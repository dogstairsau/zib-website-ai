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

export type LeadEmail = {
  url: string;
  email: string;
  phone?: string;
  source?: string;
  strategistText?: string;
  audit?: {
    overallScore?: number;
    passed?: number;
    issues?: number;
    pagesCrawled?: number;
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

  ${p.strategistText ? `
  <h2 style="font-size:16px;margin:0 0 8px;">Strategist read</h2>
  <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:#1A1A1A;background:#FAFAF8;border:1px solid #E8E5DD;border-radius:8px;padding:16px;">${safe(p.strategistText)}</div>
  ` : ""}
</body></html>`;
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
