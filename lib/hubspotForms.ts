/**
 * HubSpot Forms Submission API — the no-token integration path.
 *
 * Submissions go to the public endpoint with just a portal ID + form GUID
 * (no private app, no scopes). HubSpot treats each one like a form fill:
 * contact auto-created/updated, submission visible in form analytics, and
 * "submitted form" available as a native workflow trigger.
 *
 * Form routing: each tool family can have its own form (per-form analytics
 * and workflows); anything unmatched falls back to the default form. Start
 * with just HUBSPOT_FORM_DEFAULT_GUID set and everything flows to one form;
 * add the per-tool GUIDs whenever finer routing is wanted.
 *
 * Every form must carry the same field set (only email required):
 *   email, firstname, phone, website, lead_source,
 *   monthly_ad_spend, primary_goal
 * The API rejects fields that aren't on the target form and names them in
 * the function logs, so a missing field is easy to spot.
 *
 * Fails open when env vars are missing, like every other integration here.
 * Build steps for the forms live in docs/hubspot-forms-build.md.
 */

const FORM_ROUTES: [RegExp, string][] = [
  [/meta ads lab/i, "HUBSPOT_FORM_META_ADS_LAB"],
  [/google ads lab/i, "HUBSPOT_FORM_GOOGLE_ADS_LAB"],
  [/audit/i, "HUBSPOT_FORM_AUDIT"],
  [/growth quiz/i, "HUBSPOT_FORM_GROWTH_QUIZ"],
];

function resolveFormGuid(source: string): string | undefined {
  for (const [pattern, envKey] of FORM_ROUTES) {
    if (pattern.test(source)) {
      const guid = process.env[envKey];
      if (guid) return guid;
      break; // matched a tool but its form isn't configured — use default
    }
  }
  return process.env.HUBSPOT_FORM_DEFAULT_GUID;
}

export async function submitHubSpotForm(
  source: string,
  fields: Record<string, string | undefined>,
  context?: { pageName?: string; pageUri?: string },
): Promise<void> {
  const portalId = process.env.HUBSPOT_PORTAL_ID;
  const formGuid = resolveFormGuid(source);

  const cleaned = Object.entries(fields)
    .filter(([, v]) => (v || "").trim().length > 0)
    .map(([name, value]) => ({ objectTypeId: "0-1", name, value: (value as string).trim() }));
  if (!cleaned.length) return;

  if (!portalId || !formGuid) {
    console.log("[hubspot-form:stub]", source, Object.fromEntries(cleaned.map((f) => [f.name, f.value])));
    return;
  }

  try {
    const res = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${encodeURIComponent(portalId)}/${encodeURIComponent(formGuid)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: cleaned,
          context: {
            pageName: context?.pageName || source,
            pageUri: context?.pageUri || "https://zibdigital.com.au",
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[hubspot-form]", source, res.status, body.slice(0, 300));
    }
  } catch (e) {
    console.warn("[hubspot-form] fetch failed:", (e as Error).message);
  }
}
