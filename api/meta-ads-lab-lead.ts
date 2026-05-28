import { normaliseUrl, isValidEmail } from "../lib/site";
import { captureLead } from "../lib/hubspot";
import { sendLeadEmail } from "../lib/email";
import { checkRateLimit, rateLimitResponse } from "../lib/rateLimit";

export const config = { runtime: "edge" };

type AdSummary = {
  platform?: string;
  angle?: string;
  headline?: string;
};

type Body = {
  url?: string;
  email?: string;
  name?: string;
  phone?: string;
  notes?: string;
  brand?: string;
  audience?: string;
  ads?: AdSummary[];
};

function json(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildSummary(b: Body): string {
  const lines: string[] = [];
  lines.push(`## Meta Ads Lab lead`);
  lines.push(``);
  if (b.brand) lines.push(`**Brand:** ${b.brand}`);
  if (b.audience) lines.push(`**Audience:** ${b.audience}`);
  if (b.notes) {
    lines.push(``);
    lines.push(`**Notes from prospect:**`);
    lines.push(b.notes);
  }
  if (b.ads && b.ads.length) {
    lines.push(``);
    lines.push(`**Concepts generated (${b.ads.length}):**`);
    for (const ad of b.ads) {
      lines.push(`- *${ad.angle || "—"}* (${ad.platform || "—"}): ${ad.headline || ""}`);
    }
  }
  return lines.join("\n");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const url = normaliseUrl(body.url || "");
  const email = (body.email || "").trim();
  if (!url) return json({ error: "Missing URL" }, 400);
  if (!isValidEmail(email)) return json({ error: "Enter a valid email." }, 400);

  // Rate limit lead submissions: 5 per 10 min per IP
  const rl = await checkRateLimit(req, "meta-ads-lead", 5, 600);
  if (!rl.allowed) return rateLimitResponse(rl.retryAfter);

  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const summary = buildSummary(body);

  await Promise.all([
    captureLead(
      {
        email,
        firstname: name,
        company: body.brand || "",
        website: url,
        source: "Meta Ads Lab",
      },
      { url, strategistText: summary },
    ).catch((e) => console.warn("[meta-ads lead]", e?.message)),

    sendLeadEmail({
      url,
      email,
      phone: phone || undefined,
      source: "Meta Ads Lab",
      strategistText: summary,
    }).catch((e) => console.warn("[meta-ads email]", e?.message)),
  ]);

  return json({ ok: true });
}
