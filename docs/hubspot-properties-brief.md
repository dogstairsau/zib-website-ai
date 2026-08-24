# HubSpot properties build — instructions for Claude in Chrome

**Goal:** create the contact properties that carry lead qualification and ad
click IDs, then add them to the five existing website forms.

You are working inside the Zib Digital HubSpot portal (app.hubspot.com),
already logged in. **Do not delete or modify anything that already exists** —
if a property or form already has the internal name listed here, skip it and
note that you skipped it.

Est. 25–35 minutes. Exact internal names matter: the website's submissions are
rejected if a name doesn't match.

---

## Context — what this is for (no action needed)

The website tools now ask a prospect for their budget and timeline **before**
generating their pack or audit, score the answers into a tier
(`qualified` / `review` / `nurture`), and send that tier with the lead. They
also capture the Google/Meta ad click ID from the landing page URL.

Neither can be stored until these properties exist. The code is already live
with a fallback: if a property is missing, the submission is retried without
it rather than failing, so **nothing is broken right now — the data is just
being dropped.** The moment these exist, they start populating on their own.
No redeploy needed.

---

## Part A — Create 13 contact properties

Go to: **Settings (gear icon) → Data Management → Properties**, with object
type **Contact** selected. For each row, click **Create property**.

| # | Label | Internal name (MUST match exactly) | Group | Field type |
|---|-------|-----------------------------------|-------|-----------|
| 1 | Lead tier | `lead_tier` | Contact information | Single-line text |
| 2 | Lead score | `lead_score` | Contact information | **Number** |
| 3 | Customer value | `customer_value` | Contact information | Single-line text |
| 4 | GCLID | `gclid` | Contact information | Single-line text |
| 5 | WBRAID | `wbraid` | Contact information | Single-line text |
| 6 | GBRAID | `gbraid` | Contact information | Single-line text |
| 7 | FBCLID | `fbclid` | Contact information | Single-line text |
| 8 | MSCLKID | `msclkid` | Contact information | Single-line text |
| 9 | UTM source | `utm_source` | Contact information | Single-line text |
| 10 | UTM medium | `utm_medium` | Contact information | Single-line text |
| 11 | UTM campaign | `utm_campaign` | Contact information | Single-line text |
| 12 | UTM content | `utm_content` | Contact information | Single-line text |
| 13 | UTM term | `utm_term` | Contact information | Single-line text |

### Critical notes

- **HubSpot auto-generates the internal name from the label. Check it and edit
  it.** "GCLID" may become `gclid_` or similar. It must be the bare lowercase
  name in the table, with no prefix and no trailing characters. This is the
  single most common way this task goes wrong.
- `lead_score` is the only **Number** field. The rest are single-line text.
- `customer_value` holds what a new customer is worth to the prospect —
  the question with the heaviest weight in the scoring, and the one the
  old quiz never asked.
- **`lead_tier` is deliberately text, not a dropdown.** The website writes the
  exact strings `qualified`, `review` and `nurture`. A dropdown whose internal
  values differ by even a capital letter would cause HubSpot to reject the
  whole contact. Once you can see real values landing on records, converting
  it to a dropdown is safe — do that later, not now.
- If a property with that internal name already exists, **skip it** and say so
  in your report.

---

## Part B — Create the outcome field

This one is different: **the website never writes it.** It's the field the
sales team sets by hand, and it's the only way to answer "which ad source
actually produces good leads" — right now that can't be measured at all.

Create it the same way, object type **Contact**:

| Label | Internal name | Field type |
|---|---|---|
| Lead outcome | `lead_outcome` | **Dropdown select** |

Dropdown options, in this order:

| Label |
|---|
| Qualified |
| Booked |
| Wrong fit |
| No budget |
| Unresponsive |
| Won |
| Lost |

Because nothing automated writes this field, the internal values HubSpot
generates for these options don't matter — leave whatever it creates.

---

## Part C — Add the new fields to the five forms

Go to **Marketing → Forms**. These five forms already exist:

| # | Form name |
|---|-----------|
| 1 | Zib Tools — General |
| 2 | Meta Ads Lab |
| 3 | Google Ads Lab |
| 4 | Website Audit |
| 5 | Growth Quiz |

For **each** of the five, open it and add these fields from the left-hand
field panel:

- Lead tier
- Lead score
- Customer value
- GCLID
- WBRAID
- GBRAID
- FBCLID
- MSCLKID
- UTM source
- UTM medium
- UTM campaign
- UTM content
- UTM term

Then:

1. **None of them are required.** Email stays the only required field.
2. Do **not** add `Lead outcome` to any form — it's set by humans in the CRM,
   not submitted by the website.
3. Leave every other form setting exactly as it is.
4. **Publish** each form after editing.

All five forms carry the identical field set on purpose — the website decides
which values to send, and a shared superset means a submission can never be
rejected for a missing field.

---

## Part D — Report back

Reply with:

1. **Created** — the list of properties you created.
2. **Skipped** — any that already existed, with their existing field type
   (this matters: an existing `lead_score` that is text rather than number is
   worth flagging).
3. **Internal names** — paste the exact internal name of all 14 properties as
   HubSpot saved them, so any auto-generated mismatch can be spotted.
4. **Forms** — confirm all five were updated and republished, or name any that
   weren't and why.

---

## Part E — (For the human) Verification

1. Run any lab or `/audit` with a test email, answering with a real budget
   (`$3k – $10k`) and `ASAP`.
2. Open the contact in HubSpot. It should carry `lead_tier = qualified` and
   `lead_score` around 85.
3. To test click-ID capture, visit the tool with `?gclid=TEST123` on the URL
   first, then run it. The contact should carry `gclid = TEST123`.
4. If a value is missing, the Vercel function logs show either
   `[hubspot] retrying without optional properties` (the CRM property name
   doesn't match) or `[hubspot-form] retrying with core fields only` (the form
   field is missing) — both name the offending field.
5. Then make `lead_outcome` part of the sales routine. Four weeks of it, by
   source, is what tells you whether Google Ads Lab's higher CPL is actually
   buying better leads.

See `docs/offline-conversions.md` for what these properties feed into.
