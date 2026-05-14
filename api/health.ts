export const config = { runtime: "edge" };

/**
 * Diagnostic endpoint — reports whether required env vars are present
 * WITHOUT exposing their values. Hit /api/health in any environment to
 * see what the running deploy can see.
 */
export default async function handler(): Promise<Response> {
  const env = {
    ANTHROPIC_API_KEY: keyState(process.env.ANTHROPIC_API_KEY),
    OPENAI_API_KEY: keyState(process.env.OPENAI_API_KEY),
    OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || "(unset)",
    HUBSPOT_PRIVATE_APP_TOKEN: keyState(process.env.HUBSPOT_PRIVATE_APP_TOKEN),
    PSI_API_KEY: keyState(process.env.PSI_API_KEY),
    SLACK_WEBHOOK_URL: keyState(process.env.SLACK_WEBHOOK_URL),
    VERCEL_ENV: process.env.VERCEL_ENV || "(unset)",
    VERCEL_GIT_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA || "(unset)").slice(0, 7),
  };

  return new Response(JSON.stringify(env, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function keyState(v: string | undefined): string {
  if (!v) return "MISSING";
  if (v.length < 8) return `set (length=${v.length}, suspicious)`;
  return `set (length=${v.length}, prefix=${v.slice(0, 7)}…)`;
}
