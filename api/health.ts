export const config = { runtime: "edge" };

/**
 * Diagnostic endpoint — reports only whether each required env var is present
 * ("set" / "missing"). It deliberately does NOT expose value length, prefix,
 * or the commit SHA: this endpoint is public and unauthenticated, so it must
 * not hand out recon about the running deploy's secrets.
 */
export default async function handler(): Promise<Response> {
  const env = {
    ANTHROPIC_API_KEY: keyState(process.env.ANTHROPIC_API_KEY),
    OPENAI_API_KEY: keyState(process.env.OPENAI_API_KEY),
    OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL ? "set" : "default",
    HUBSPOT_PRIVATE_APP_TOKEN: keyState(process.env.HUBSPOT_PRIVATE_APP_TOKEN),
    HUBSPOT_PORTAL_ID: keyState(process.env.HUBSPOT_PORTAL_ID),
    HUBSPOT_FORM_DEFAULT_GUID: keyState(process.env.HUBSPOT_FORM_DEFAULT_GUID),
    HUBSPOT_FORM_META_ADS_LAB: keyState(process.env.HUBSPOT_FORM_META_ADS_LAB),
    HUBSPOT_FORM_GOOGLE_ADS_LAB: keyState(process.env.HUBSPOT_FORM_GOOGLE_ADS_LAB),
    HUBSPOT_FORM_AUDIT: keyState(process.env.HUBSPOT_FORM_AUDIT),
    HUBSPOT_FORM_GROWTH_QUIZ: keyState(process.env.HUBSPOT_FORM_GROWTH_QUIZ),
    PSI_API_KEY: keyState(process.env.PSI_API_KEY),
    SLACK_WEBHOOK_URL: keyState(process.env.SLACK_WEBHOOK_URL),
    RESEND_API_KEY: keyState(process.env.RESEND_API_KEY),
    KV: keyState(process.env.KV_REST_API_URL),
    VERCEL_ENV: process.env.VERCEL_ENV || "(unset)",
  };

  return new Response(JSON.stringify(env, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}

function keyState(v: string | undefined): "set" | "missing" {
  return v ? "set" : "missing";
}
