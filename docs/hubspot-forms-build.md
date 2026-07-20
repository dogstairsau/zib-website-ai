# HubSpot Forms build — instructions for Claude in Chrome

**Goal:** create the contact properties and forms that the Zib website tools
submit to, then report back the portal ID and form GUIDs so they can be added
to Vercel. Follow the steps in order; exact names matter — the website's
submissions are rejected if a field name doesn't match.

You are working inside the Zib Digital HubSpot portal (app.hubspot.com),
already logged in. Do not delete or modify anything that already exists.

---

## Part A — Create 3 custom contact properties

Go to: **Settings (gear icon) → Data Management → Properties**, with object
type **Contact** selected. For each property below, click **Create property**:

| # | Label | Internal name (MUST match exactly) | Group | Field type |
|---|-------|-----------------------------------|-------|-----------|
| 1 | Lead source (website) | `lead_source` | Contact information | Single-line text |
| 2 | Monthly ad spend | `monthly_ad_spend` | Contact information | Single-line text |
| 3 | Primary goal | `primary_goal` | Contact information | Single-line text |

Notes:
- HubSpot auto-generates the internal name from the label — **check it and
  edit it if needed** so it matches the table exactly (no portal prefix
  concerns for contact properties; it must be the bare name shown above).
- If a property with that internal name already exists, skip creating it.
- Single-line text is deliberate (values come from fixed website buttons, so
  no dropdown maintenance needed). They can be converted to dropdowns later.

## Part B — Create 5 forms

Go to: **Marketing → Forms → Create form → Embedded form** (regular form,
not pop-up). For **each** of the five forms below:

1. Name the form exactly as listed.
2. Add **the same seven fields to every form** (search each by name in the
   left field panel and drag it on):
   - Email (required — the only required field)
   - First name (NOT required)
   - Phone number (NOT required)
   - Website URL — the standard `website` contact property (NOT required)
   - Lead source (website) (NOT required)
   - Monthly ad spend (NOT required)
   - Primary goal (NOT required)
3. In the form's **Options** tab: turn OFF any "Pre-populate fields with
   known values" and leave "Always create contact for new email address" ON
   (default). No follow-up email. No redirect needed.
4. **Publish** the form.

The five forms to create:

| # | Form name |
|---|-----------|
| 1 | Zib Tools — General |
| 2 | Meta Ads Lab |
| 3 | Google Ads Lab |
| 4 | Website Audit |
| 5 | Growth Quiz |

Every form carries the identical field set on purpose — the website decides
which values to send, and a shared superset means a submission can never be
rejected for a missing field.

## Part C — Collect the IDs and report back

1. **Portal ID**: it's the number in the browser URL, e.g.
   `app.hubspot.com/contacts/XXXXXXX/…` → `XXXXXXX`. (Also shown under
   Settings → Account Defaults → Account Information as "Hub ID".)
2. **Form GUIDs**: for each of the 5 forms, open it → **Share** (or Embed) →
   in the embed code find `formId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"`.
   Copy that GUID. (It's also the last UUID segment of the form's editor URL.)
3. Report the results as this exact table so it can be pasted straight into
   Vercel:

```
HUBSPOT_PORTAL_ID            = <portal id>
HUBSPOT_FORM_DEFAULT_GUID    = <GUID of "Zib Tools — General">
HUBSPOT_FORM_META_ADS_LAB    = <GUID of "Meta Ads Lab">
HUBSPOT_FORM_GOOGLE_ADS_LAB  = <GUID of "Google Ads Lab">
HUBSPOT_FORM_AUDIT           = <GUID of "Website Audit">
HUBSPOT_FORM_GROWTH_QUIZ     = <GUID of "Growth Quiz">
```

## Part D — (For the human) Vercel + verification

1. Add the six env vars above in Vercel → Settings → Environment Variables
   (Production + Preview), then **redeploy**.
2. Run any lab with a test email and answer the two quiz questions.
3. Verify in HubSpot: Marketing → Forms → "Meta Ads Lab" shows a submission;
   the contact exists with lead source, monthly ad spend and primary goal
   filled; Contacts timeline shows the form submission event.
4. If a submission is missing, Vercel function logs show a `[hubspot-form]`
   warning naming the rejected field or the error.

## How the website routes submissions (context, no action needed)

Every lead-capturing tool on the site (Meta Ads Lab, Google Ads Lab, website
audit, growth quiz, ROI calculator, AI readiness, automation map, growth
simulator, partner contact, and the mid-generation quiz) submits server-side
to these forms. Meta/Google/Audit/Growth-quiz traffic goes to its named form;
everything else goes to "Zib Tools — General". Any tool whose specific form
GUID isn't configured falls back to the General form, so setting only
`HUBSPOT_PORTAL_ID` + `HUBSPOT_FORM_DEFAULT_GUID` already captures everything.
"Submitted form X" is then available as a native workflow trigger — e.g.
enrol on "Meta Ads Lab" form submission → create the 24h strategist call task.
