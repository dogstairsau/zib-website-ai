# Referral form build — instructions for Claude in Chrome

**Goal:** build the "Submit a referral" form in HubSpot that
`https://zibdigital.com.au/submit-a-referral` embeds, then report back the form
GUID so it can be dropped into the page.

You are working inside the Zib Digital HubSpot portal (`app.hubspot.com`,
portal **14539048**), already logged in. **Do not delete or modify anything
that already exists** — if a property or form below already exists with the
same internal name, skip creating it and note that in your report.

---

## How this form is meant to work (read first)

A referral form has two people in it, and only one of them can be the HubSpot
contact. **The contact is the referrer** — the person filling in the form.

That's deliberate:

- The browser submitting the form belongs to the referrer, so HubSpot's
  tracking cookie (`hubspotutk`) is theirs. If we made the *referred* person
  the contact, the referrer's entire browsing history would be stitched onto
  the prospect's record and the source attribution would be wrong for both.
- Referrers are usually existing clients. Putting the submission on their
  record means "who refers us business" is answerable in one report.

The referred person's details land in `referral_*` properties on that
submission. Sales then creates the prospect record properly, or Part D
automates it. Every submission is retained on the referrer's timeline
forever, so a second referral from the same person is never lost — but the
`referral_*` properties themselves show only the **most recent** referral.
That's the reason Part D matters if referral volume picks up.

---

## Part A — Create the custom contact properties

Go to: **Settings (gear) → Data Management → Properties**, object type
**Contact**. Create a property group called **Referrals** first
(Create property → the group dropdown lets you add a new group), then create
each property below into that group.

⚠️ HubSpot auto-generates the internal name from the label. **Check it and
edit it** so it matches the middle column exactly — the website's hidden-field
script targets these names.

| # | Label | Internal name (MUST match exactly) | Field type |
|---|-------|-----------------------------------|-----------|
| 1 | Referral — first name | `referral_first_name` | Single-line text |
| 2 | Referral — last name | `referral_last_name` | Single-line text |
| 3 | Referral — company | `referral_company` | Single-line text |
| 4 | Referral — email | `referral_email` | Single-line text |
| 5 | Referral — phone | `referral_phone` | Single-line text |
| 6 | Referral — what they need | `referral_service` | Dropdown select |
| 7 | Referral — notes | `referral_notes` | Multi-line text |
| 8 | Referral — OK to name referrer | `referral_intro_consent` | Single checkbox |
| 9 | Referral — source page | `referral_source_page` | Single-line text |

Dropdown options for `referral_service` (in this order, labels exactly as
written — they mirror the service chips on the page):

```
SEO
Google Ads
Paid social
Social media management
Website design & build
eCommerce & Shopify
Content marketing
Email marketing
AI & automation
Not sure — help us work it out
```

**Also check these three exist** (they're standard campaign fields many
portals already have — search Properties for them before creating). If any is
missing, create it as **Single-line text** in the Referrals group:

- `utm_source`
- `utm_medium`
- `utm_campaign`

Note 4 and 5 are single-line text, not the Email/Phone field types, on
purpose: HubSpot's email/phone types carry validation and de-duplication
behaviour meant for the contact's own details, and this is somebody else's.

---

## Part B — Build the form

**Marketing → Forms → Create form → Embedded form** (regular form, not
pop-up). Start from a blank form. Name it exactly:

```
Submit a referral
```

Add fields in this order. Where the "Label on form" column differs from the
property's own label, edit the label **on the form** (click the field →
Label) — the page's copy reads as a conversation, so the form should too.

### Group 1 — Who you're introducing

| Field (property) | Label on form | Required | Placeholder |
|---|---|---|---|
| `referral_first_name` | Their first name | ✅ Yes | |
| `referral_last_name` | Their last name | No | |
| `referral_company` | Their business | No | |
| `referral_email` | Their email | ✅ Yes | |
| `referral_phone` | Their mobile | No | |
| `referral_service` | What do they need? | No | Placeholder option: "Select one — or leave it blank" |
| `referral_notes` | Anything we should know? | No | e.g. "Their site's slow and they've just been burnt by another agency." |

### Group 2 — Who we should thank

| Field (property) | Label on form | Required |
|---|---|---|
| `firstname` (First name) | Your first name | ✅ Yes |
| `lastname` (Last name) | Your last name | No |
| `email` (Email) | Your email | ✅ Yes |
| `phone` (Phone number) | Your mobile | No |
| `referral_intro_consent` | Happy for us to mention you introduced them? | No |

### Hidden fields (set each to **Hidden**, no default value)

| Field | Why |
|---|---|
| `utm_source` | Which banner/email sent them |
| `utm_medium` | |
| `utm_campaign` | |
| `referral_source_page` | Full landing URL, as a fallback trace |

The website fills all four from the URL query string once the form renders.
They must be **hidden**, not "hidden with default value" — a default would
stop the script overwriting them.

### Layout

Put the two-column fields side by side where it reads naturally (first/last
name pairs, email/mobile pairs). The site's CSS renders HubSpot's
`form-columns-2` rows as a two-up grid and `form-columns-1` rows full width,
so single-column rows are automatically full width — use those for
`referral_notes` and the consent copy.

### Consent (do not skip this)

Add a **checkbox** at the bottom, above the submit button. Use the form's
"Add consent checkbox" / legal consent option if the portal has GDPR features
turned on; otherwise add a single-checkbox custom field named
`referral_permission` (create it in Part A's group if you need it).

- **Required: yes**
- Label: *"I've got their permission to pass on their details."*

Under it, add rich-text small print:

> We'll only use these details for this introduction. Read our
> [privacy policy](https://zibdigital.com.au/privacy-policy).

This is what makes the intro compliant under the Privacy Act and the Spam Act
— an unsolicited call to someone who never agreed to be contacted is the whole
risk in a referral programme. It isn't a nice-to-have.

### Submit button

Button text: `Send the introduction`

---

## Part C — Form options

In the form's **Options** tab:

1. **What should happen after a visitor submits this form?** → **Redirect to
   another page** → `https://zibdigital.com.au/referral-thank-you`
2. **Send follow-up email**: ON. One email to the referrer, subject
   *"Thanks for the introduction"*, body along the lines of: we've got
   {{ referral_first_name }}'s details, a strategist will reach out within one
   business day, and we'll let you know how it goes.
3. **Send form notifications to**: the sales inbox / relevant owners. Notify on
   every submission — these are hot leads and should not wait for a report.
4. **Pre-populate fields with known values**: OFF. Critical — with it on, a
   known contact opening the email banner would get the referrer fields
   auto-filled *and* could see a previous referral's details.
5. Leave **"Always create contact for new email address"** ON (default).
6. **Publish** the form.

---

## Part D — Optional: auto-create the referred contact

Only if the portal has Workflows (Professional+). Skip and note it if not.

**Automation → Workflows → Create workflow → Contact-based → From scratch.**

- **Enrolment trigger:** Form submission → "Submit a referral". Allow
  re-enrolment on every submission (so a second referral from the same client
  still fires).
- **Action 1 — Create record → Contact**, mapping:
  - Email ← `referral_email`
  - First name ← `referral_first_name`
  - Last name ← `referral_last_name`
  - Phone ← `referral_phone`
  - Company name ← `referral_company`
  - Lead source (website) ← set to the static text `Referral`
- **Action 2 — Create task**, assigned to the sales owner:
  *"Referral from {{ contact.firstname }} — call {{ contact.referral_first_name }} within 1 business day"*, due in 1 day.
- **Action 3 — (recommended) Internal Slack/email notification** with the
  referrer's name, the referral's details, and `referral_intro_consent`, so
  whoever calls knows whether they're allowed to say who sent them.

If workflows aren't available, sales creates the prospect manually off the
form notification email — fine at low volume, but revisit it.

---

## Part E — Report back

Report exactly this, so the values can be pasted into the site:

```
HUBSPOT_PORTAL_ID   = 14539048   (confirm from the URL)
REFERRAL_FORM_GUID  = <GUID of "Submit a referral">
```

The GUID is in **Share/Embed** on the published form, as
`formId: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` — also the last UUID segment
of the form editor's URL.

Also report:

- Any property in Part A that already existed (and its existing field type, if
  it differs from the table).
- Whether Part D's workflow was created, or why not.

---

## Part F — (For the human) Wire it up and test

1. In `submit-a-referral.html`, replace `REPLACE_WITH_HUBSPOT_FORM_ID` with the
   GUID from Part E, then commit and deploy.
2. Open the live page with the campaign params attached:
   `https://zibdigital.com.au/submit-a-referral?utm_source=email-banner&utm_medium=email&utm_campaign=client-referrals`
3. Submit a test referral using a real inbox you control for **both** emails.
4. Verify in HubSpot:
   - Your contact record shows the submission, with all four `referral_*`
     detail fields and the three `utm_*` fields populated.
   - `referral_source_page` holds the full URL including the query string.
   - The redirect landed on `/referral-thank-you`.
   - The follow-up email arrived.
   - If Part D ran: a second contact exists for the referred person, and the
     task was created.
5. If the `utm_*` fields come through empty, the usual cause is a hidden field
   with a default value set — clear the default (Part B) and retest.
