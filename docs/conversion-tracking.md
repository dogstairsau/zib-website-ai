# Conversion tracking — the tools

How the Meta pixel (and GA4, and Google Ads) counts a lead from the website
audit and the two ad labs.

## Why there's no thank-you page

All three tools capture the lead and then **stream the result into the same
page** — watching the audit score build, or the ads generate, is the product.
Sending someone to a thank-you page after submit would throw that away, and
it's also the moment they're most engaged.

So there's no second page load for the pixel to hang a conversion off. Instead
the conversion fires at the point the lead is genuinely captured: the server
has accepted the submission and is pushing it to HubSpot.

If you specifically want a URL-based conversion, you've got one — see
**Option B** below. It doesn't need a page load.

## What fires, and where from

`assets/conversion.js` defines `window.zibLead()`, loaded sitewide from
`_partials/scripts.html`. It's called from four places:

| Surface | File | Tool name sent |
|---|---|---|
| `/audit` | `audit.html` | `Website Audit` |
| Audit widget (home, SEO + location pages, partner pages — 20+ placements) | `assets/audit-widget.js` | `Website Audit` |
| `/meta-ads-lab` | `meta-ads-lab.html` | `Meta Ads Lab` |
| `/google-ads-lab` | `google-ads-lab.html` | `Google Ads Lab` |

Each call fires four things:

1. **Meta pixel** — `fbq('track', 'Lead', { content_name: <tool>, content_category: 'Tool' }, { eventID })`
2. **GTM dataLayer** — `{ event: 'zib_lead', zib_tool, zib_placement, zib_event_id }`
3. **GA4** — `gtag('event', 'generate_lead', { method: <tool>, placement })`
4. **URL hash** — `#lead` via `replaceState` (no reload, no scroll)

`zib_placement` comes from each page's `<meta name="zib:source-tag">`, so the
audit widget's 20+ placements are separable — you can tell an audit lead from
the Melbourne SEO page apart from one off the homepage.

A tool fires at most once per page load.

---

## ⚠️ The one way to break this

`conversion.js` fires the Meta **Lead** event **directly**.

**Do not** also create a GTM tag that fires Meta `Lead` off the `zib_lead`
dataLayer event. That counts every lead twice, and Meta's campaign
optimisation will be training on numbers that are 2× reality.

In GTM, use `zib_lead` for **GA4 and Google Ads conversions only**.

---

## Meta setup

### Prerequisite: confirm the pixel actually loads

`_partials/head.html` expects pixel **1417344755743451** to fire via GTM, but
that was never verified after the migration — the comment in that file says
as much. Check it before anything else:

1. Install the **Meta Pixel Helper** Chrome extension.
2. Open `https://zibdigital.com.au/audit`.
3. The helper should show pixel `1417344755743451` with a PageView.

If it doesn't, no Lead event will fire either, and the fix is upstream: either
add the Meta Pixel tag to GTM (container `GTM-M9RNXQCV`), triggered on All
Pages, or hardcode the base pixel into `_partials/head.html`.

### Option A — custom conversion on the Lead event (recommended)

**Events Manager → Data sources → the pixel → Custom Conversions → Create.**

- **Data source:** the pixel
- **Event:** `Lead`
- **Rule:** `content_name` **equals** `Meta Ads Lab`
  *(or `Google Ads Lab`, or `Website Audit` — one custom conversion each)*
- **Category:** Lead

That gives three separately optimisable conversions, plus the raw `Lead`
event if you want all tool leads together.

### Option B — URL-based, if you'd rather

Every successful capture appends `#lead` to the URL. Meta can't trigger on a
hash by itself, so this runs through GTM:

1. GTM → **Triggers → New → History Change**, with condition
   *New History Fragment* **contains** `lead`.
2. Fire a **Meta Pixel — Lead** tag on it.
3. **Then remove the direct fbq call from `assets/conversion.js`**, or you'll
   double-count — see the warning above.

Option A is less machinery. Option B only earns its keep if the person
managing conversions works in GTM and never in the codebase.

---

## Google Ads / GA4 setup

GTM → **Triggers → New → Custom Event**, event name `zib_lead`. Then:

- **GA4 event tag** on that trigger — though `gtag` already sends
  `generate_lead` directly, so this is only needed if you want the extra
  parameters (`zib_placement`, `zib_tool`) in GA4.
- **Google Ads Conversion tag** on that trigger. Use `{{zib_tool}}` as a
  dataLayer variable if you want to split conversions per tool.

Mark `generate_lead` as a **key event** in GA4 (Admin → Events) so it shows up
in reporting and can be imported into Google Ads.

---

## Verifying it works

1. Open `https://zibdigital.com.au/meta-ads-lab` with Pixel Helper open and
   the GTM preview connected.
2. Run the tool with a real URL and a test email.
3. The moment the gate submits and the stages start, you should see:
   - Pixel Helper: a **Lead** event with `content_name: Meta Ads Lab`
   - GTM preview: a `zib_lead` event in the left-hand event list
   - The URL gains `#lead`
   - Events Manager → **Test Events** shows the Lead within ~30s
4. Repeat on `/audit` and on the homepage audit widget (the widget is the
   highest-volume surface — don't skip it).

If the pixel event doesn't appear but `zib_lead` does, the pixel isn't loading
— go back to the prerequisite step.

---

## The AI services page is different

`/ai-services` runs paid traffic, so its form is a plain page form posting to
`/api/contact` — not a streaming tool. It **does** redirect, to
`/ai-services-thank-you`, which is a real page load the pixel already sees.

That gives a URL-based conversion with no extra work:

- **Meta:** Events Manager → Custom Conversions → URL **contains**
  `ai-services-thank-you` → category Lead.
- **Google Ads:** a destination-URL conversion on the same path.

The page has its own thank-you URL rather than sharing `/thank-you` precisely
so this conversion counts AI services leads only, and ad optimisation isn't
trained on traffic from other forms.

`zibLead` is deliberately **not** called on this form — the page load is the
signal. Don't add both.

⚠️ Leads from this form arrive as an **email** (via Resend to
`LEAD_NOTIFY_EMAIL`), not in HubSpot — `/api/contact` doesn't push to the CRM.
Same as the `/ai-for-trades` landing page. If these leads need to land in
HubSpot for nurture or reporting, the fix is either wiring `captureLead` into
`api/contact.ts` or swapping the markup for a HubSpot embedded form.

## Not covered

- **`cheeks.html` and `jacqui.html`** carry their own copies of the audit code
  (private client pitch pages, excluded from the sitemap). They don't fire
  `zibLead`. Say the word if you want them tracked.
- **HubSpot forms** (contact, referral) aren't wired to `zibLead`. They don't
  need to be — HubSpot's embed posts an `hsFormCallback` / `onFormSubmitted`
  message that GTM can trigger on natively, and the referral form redirects to
  `/referral-thank-you`, which is a real page load the pixel already sees.
- **Conversions API** (server-side). `zibLead` already mints an `eventID` and
  passes it to the pixel, so a server-side event sent with the same id would
  deduplicate correctly — but nothing sends one yet. Worth doing if iOS
  signal loss starts showing up in the numbers.
