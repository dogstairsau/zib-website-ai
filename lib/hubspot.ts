/**
 * Lead capture. HubSpot first, Slack notification optional.
 * Both stub to console if env vars are missing — safe to ship without keys.
 */

export type Lead = {
  email: string;
  firstname?: string;
  company?: string;
  website: string;
  source?: string;
};

export async function captureLead(lead: Lead): Promise<void> {
  await Promise.allSettled([pushToHubSpot(lead), notifySlack(lead)]);
}

async function pushToHubSpot(lead: Lead): Promise<void> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) {
    console.log("[hubspot:stub]", lead);
    return;
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

  // 409 = contact already exists; treat as success
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => "");
    throw new Error(`HubSpot ${res.status}: ${body.slice(0, 200)}`);
  }
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
