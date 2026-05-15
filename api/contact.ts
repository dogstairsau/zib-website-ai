import { checkRateLimit, rateLimitResponse } from "../lib/rateLimit";
import { sendLeadEmail } from "../lib/email";

export const config = { runtime: "edge" };

type Body = {
  firstname?: string;
  lastname?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  website?: string;
  partnerEmail?: string;
  partnerName?: string;
  source?: string;
};

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const firstname = (body.firstname || "").trim();
  const lastname = (body.lastname || "").trim();
  const email = (body.email || "").trim();
  const phone = (body.phone || "").trim();
  const jobTitle = (body.jobTitle || "").trim();
  const website = (body.website || "").trim();
  const partnerEmail = (body.partnerEmail || "").trim();
  const partnerName = (body.partnerName || "your Zib partner").trim();
  const source = (body.source || "Partner page contact form").trim();

  if (!firstname) return json({ error: "Enter your first name." }, 400);
  if (!lastname) return json({ error: "Enter your last name." }, 400);
  if (!emailRe.test(email)) return json({ error: "Enter a valid email." }, 400);
  if (phone.replace(/\D/g, "").length < 6) return json({ error: "Enter a valid phone number." }, 400);
  if (!emailRe.test(partnerEmail)) return json({ error: "Configuration error · invalid partner email." }, 500);

  const rl = await checkRateLimit(req, "contact", 5, 600);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  // Build the email payload — reuse the lead-email infrastructure but with a custom subject.
  const summary = [
    `From: ${firstname} ${lastname} <${email}>`,
    `Phone: ${phone}`,
    jobTitle ? `Job title: ${jobTitle}` : null,
    website ? `Website: ${website}` : null,
    `Source: ${source}`,
  ].filter(Boolean).join("\n");

  try {
    await sendLeadEmail({
      url: website || "(no website provided)",
      email,
      phone,
      source: `${source} → ${partnerName}`,
      strategistText: `New contact form submission from a partner landing page.\n\n${summary}`,
      // Force notification to the partner's address by temporarily overriding LEAD_NOTIFY_EMAIL
      // — sendLeadEmail reads it from env, so we send a second copy directly via Resend below.
    });

    // Direct send to the partner (since sendLeadEmail uses env-configured recipient)
    await sendDirectToPartner({
      partnerEmail,
      partnerName,
      firstname,
      lastname,
      email,
      phone,
      jobTitle,
      website,
      source,
    });

    return json({ ok: true });
  } catch (e: any) {
    console.warn("[contact]", e?.message || e);
    return json({ error: "Submission failed. Please try again or call the partner directly." }, 500);
  }
}

async function sendDirectToPartner(p: {
  partnerEmail: string;
  partnerName: string;
  firstname: string;
  lastname: string;
  email: string;
  phone: string;
  jobTitle: string;
  website: string;
  source: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.LEAD_NOTIFY_FROM || "onboarding@resend.dev";
  if (!apiKey) {
    console.log("[contact:stub]", p);
    return;
  }

  const subject = `New enquiry · ${p.firstname} ${p.lastname} · ${p.source}`;
  const html = `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.55;color:#0F0F0F;max-width:680px;margin:0 auto;padding:24px;">
  <h1 style="font-size:22px;margin:0 0 4px;">New enquiry from your Zib partner page</h1>
  <p style="color:#6B6B6B;margin:0 0 24px;">${esc(p.source)}</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px;">
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;width:140px;">Name</td><td style="padding:6px 0;">${esc(p.firstname)} ${esc(p.lastname)}</td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Email</td><td style="padding:6px 0;"><a href="mailto:${esc(p.email)}">${esc(p.email)}</a></td></tr>
    <tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Phone</td><td style="padding:6px 0;"><a href="tel:${esc(p.phone)}">${esc(p.phone)}</a></td></tr>
    ${p.jobTitle ? `<tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Job title</td><td style="padding:6px 0;">${esc(p.jobTitle)}</td></tr>` : ""}
    ${p.website ? `<tr><td style="padding:6px 12px 6px 0;color:#6B6B6B;">Website</td><td style="padding:6px 0;"><a href="${esc(p.website)}">${esc(p.website)}</a></td></tr>` : ""}
  </table>
</body></html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: p.partnerEmail, subject, html, reply_to: p.email }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[contact] Resend error:", res.status, body.slice(0, 200));
  }
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
