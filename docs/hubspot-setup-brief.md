# Brief: Connect the Ads Labs to HubSpot

**Audience:** whoever runs this setup (paste this whole file into a Claude Code
session or follow it by hand). Est. 30–45 minutes.

## Context — what the code already does

The zib-website-ai repo (deployed on Vercel) has full HubSpot integration
**already written** in `lib/hubspot.ts`. It just needs a token and two small
things created in the HubSpot portal. Nothing here replaces Resend — Resend
keeps sending the transactional pack emails (`lib/email.ts`, `RESEND_API_KEY`);
HubSpot is the CRM layer.

When `HUBSPOT_PRIVATE_APP_TOKEN` is set, every lab run does this:

1. **Creates/finds a contact** (`POST /crm/v3/objects/contacts`, 409 → lookup
   by email) with properties: `email`, `firstname`, `website`,
   `lifecyclestage=lead`, `hs_lead_status=NEW`, and **`lead_source`** — a
   custom property the code writes with values like `Meta Ads Lab`,
   `Google Ads Lab`, `Meta Ads Lab · <sourceTag>`, `Homepage audit`.
2. **Attaches notes to the contact** (`POST /crm/v3/objects/notes`, association
   type 202):
   - the lab lead context (URL + any prospect notes),
   - the **mid-generation quiz answers** from `/api/lab-quiz` — monthly ad
     spend + primary goal, captured while their pack generates. This is the
     note your strategists should read before the 24h call.
3. Optionally pings Slack (`SLACK_WEBHOOK_URL`) on each new lead.

Until the token is set, the HubSpot side silently no-ops (logs
`[hubspot:stub]` in Vercel function logs). **The quiz answers are not lost in
the meantime**: `/api/lab-quiz` also emails them to `LEAD_NOTIFY_EMAIL` via
Resend ("<lab> quiz · <site> · <email>"), so strategists are briefed today.
HubSpot setup upgrades that from an inbox email to a note on the CRM record.

## Task 1 — HubSpot portal setup

1. **Create a private app**: Settings → Integrations → Private Apps → Create.
   Name it `Zib Website Labs`. Scopes (CRM):
   - `crm.objects.contacts.read` + `crm.objects.contacts.write`
   - the Notes/engagements object read + write scopes (HubSpot lists notes
     under CRM object scopes — tick both read and write for Notes)
   Copy the access token (starts `pat-`).
2. **Create the custom contact property** `lead_source` (the API call fails
   without it): Settings → Properties → Contact properties → Create.
   - Label: `Lead source (website)`, internal name **exactly** `lead_source`
   - Type: single-line text (or dropdown seeded with: `Meta Ads Lab`,
     `Google Ads Lab`, `Homepage audit`, `Growth quiz` — but keep it text if
     unsure, the code appends `· <sourceTag>` variants)
3. **(Recommended) Workflow for the 24h call promise**: contact-based
   workflow, enrolment: `lead_source` contains `Ads Lab` → create a Task
   ("Strategy call within 24h — read the quiz note on the record") assigned
   to the strategist rotation, and send an internal email/Slack notification.
4. **(Recommended) A "Lab leads" view/list** filtered on `lead_source`
   contains `Ads Lab`, sorted by create date, for the sales team.

## Task 2 — Vercel env

In the Vercel project (zib website) → Settings → Environment Variables:

- `HUBSPOT_PRIVATE_APP_TOKEN` = the `pat-...` token (Production + Preview)
- `SLACK_WEBHOOK_URL` = optional, a Slack incoming-webhook URL for lead pings

Then **redeploy** (env changes only apply to new deployments).

## Task 3 — Verify end-to-end

1. Run a lab (zibdigital.com.au/meta-ads-lab) with a test email you control;
   answer the two quiz questions while it generates.
2. In HubSpot: confirm the contact exists with `lead_source = Meta Ads Lab`,
   and has **two notes** — the lab lead context and the quiz answers
   ("Meta Ads Lab quiz · answered while their pack generated").
3. `https://zibdigital.com.au/api/health` should show
   `HUBSPOT_PRIVATE_APP_TOKEN: set`.
4. If anything's off, Vercel function logs show `[hubspot:...]` warnings with
   the HubSpot error body (a 400 mentioning `lead_source` means the custom
   property from Task 1.2 is missing or misnamed).

## Out of scope / don't touch

- Resend stays as the transactional email sender — no HubSpot marketing
  emails needed for the pack delivery.
- No code changes are required for any of the above. If HubSpot rejects the
  Notes scopes or the property name has to differ, that's the one case where
  `lib/hubspot.ts` needs a matching tweak.
