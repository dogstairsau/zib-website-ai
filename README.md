# Zib Digital — Homepage + Live Audit

Static homepage with a server-side AI audit endpoint. When a prospect drops their URL into the audit form, the server fetches the site, runs Lighthouse, and streams a Claude-generated commercial read back to the browser. Lead is pushed to HubSpot.

## Architecture

```
[Static index.html]                    [Vercel Edge function]               [Claude]
   audit form  ──URL+email──▶  /api/audit  ──prompts──▶  Anthropic
                              │                          (streaming)
                              ◀──── SSE events ─────────┘
                              │
                              ├─ pushes lead to HubSpot
                              └─ posts to Slack (optional)
```

**Why this shape:** prompts and tool logic live server-side only. Frontend ships nothing sensitive — just the form and a streaming renderer. Anyone can open DevTools and they'll see no orchestration, no model name, no system prompt.

## Files

```
├── index.html               static homepage
├── api/audit.ts             edge function: streams AI audit
├── lib/
│   ├── prompts/audit.ts     server-only system + user prompts
│   ├── site.ts              URL fetch + content extraction
│   ├── psi.ts               PageSpeed Insights wrapper
│   └── hubspot.ts           lead capture (HubSpot + Slack)
├── package.json
├── vercel.json              edge function config (60s timeout)
└── .env.example             required + optional env vars
```

## Local dev

```bash
npm install
cp .env.example .env.local        # then fill in ANTHROPIC_API_KEY
npx vercel dev
# → opens http://localhost:3000
```

## Required env

| Var | What | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key | https://console.anthropic.com |
| `PSI_API_KEY` | (optional) PageSpeed key — without it, requests are rate-limited | https://developers.google.com/speed/docs/insights/v5/get-started |
| `HUBSPOT_PRIVATE_APP_TOKEN` | (optional) HubSpot lead capture — without it, leads log to function console | HubSpot → Settings → Integrations → Private Apps |
| `SLACK_WEBHOOK_URL` | (optional) Posts lead notification to Slack | Slack → Apps → Incoming Webhooks |

## Deploy

```bash
npm install
npx vercel link
npx vercel env add ANTHROPIC_API_KEY production
npx vercel deploy --prod
```

## Tuning the strategist read

Voice and structure are in `lib/prompts/audit.ts`. Edit there. Push. Done.

## What's stubbed for the pitch

- HubSpot is real-API-ready but no-ops cleanly without the token
- Slack notifications are optional
- Logo bar is type-only (drop SVG client logos in)
- Reviews are placeholder copy (swap with Google Places API output)
- The brand wordmark in the header is type-only (drop in the SVG brandmark)

## Next phases

- **Phase 2:** Generate sample assets per prospect (a social post, ad headline set, blog outline) — multi-call Claude flow, render in expandable panels.
- **Phase 3:** Schedule follow-up "tasks" — recurring weekly audit emails, content briefs delivered to inbox. Needs a scheduling service (Vercel Cron or external).

Both phases reuse the same prompt-on-server pattern. Frontend stays thin.
