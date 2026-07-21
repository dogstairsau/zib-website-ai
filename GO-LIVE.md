# Go-Live Checklist — Zib Digital new site

The new site (this repo, currently previewed at **ziboutreach.com.au**) replaces
the old WordPress site at **zibdigital.com.au**. Cutover = point `zibdigital.com.au`
DNS at this Vercel deployment **and** ship the `vercel.json` change in step 1,
together.

---

## 1. Retire the ziboutreach.com.au staging domain  ⚠️ do AT cutover, with the DNS flip

Right now ziboutreach.com.au is how the new pages are previewed, so this can't
change before launch (it would redirect to the *old* site until DNS flips).

**At cutover**, in `vercel.json`, REMOVE the three host-scoped staging rules:
- `/` (ziboutreach) → `/audit`
- the big allowlist catch-all `/:path((?!audit$|...).+)` (ziboutreach) → `zibdigital.com.au`
- `/commercial-cleaning` (zibdigital) → ziboutreach

…and REPLACE them with a single permanent redirect:

```json
{
  "source": "/:path*",
  "has": [{ "type": "host", "value": "(www\\.)?ziboutreach\\.com\\.au" }],
  "destination": "https://zibdigital.com.au/:path*",
  "permanent": true
}
```

Keep the old-URL 301 map (the ~35 redirects) — it's host-agnostic and needed at launch.

---

## 2. HubSpot — make lead capture live

- [ ] Create a **Private App** (HubSpot → Settings → Integrations → Private Apps).
      Scopes: `crm.objects.contacts.read` + `write`, `crm.objects.notes.write`, `forms`.
- [ ] Create a custom contact property **`lead_source`** (single-line text) — the
      `/api` lead writes to it; without it the contact write errors.
- [ ] Add the token to **Vercel → Settings → Environment Variables (Production)**
      as `HUBSPOT_PRIVATE_APP_TOKEN`. This flips `/api` lead capture from stub → live.

Native embedded forms (contact + service pages, 5 partner pages, partner-opportunity)
submit straight to HubSpot and need **no** token — already live once deployed.

---

## 3. Analytics & tags — verify (GTM-first)

Tags live in `_partials/head.html` (GTM ×2, HubSpot pixel, CallRail) + `_partials/nav.html`
(GTM noscript). After deploy:
- [ ] Run **Google Tag Assistant** + **Meta Pixel Helper** to confirm Meta Pixel
      (`275858389552736`, carried by GTM-TB6Q2RM), Hotjar, and old GA4 (`G-ZFY5YFEP68`)
      fire via the GTM containers. Hardcode only any tag GTM does NOT carry.
- [ ] Existing GA4 `G-LQDQEYFP98` + Microsoft Clarity already present (both GA4
      properties run during transition — by design).

---

## 4. Forms

- Live now (native HubSpot embeds): contact + 29 service/location pages, 5 partner
  pages, partner-opportunity on `partner.html`.
- [ ] Confirm HubSpot form **redirect URLs** point at `zibdigital.com.au/...thank-you/`
      (they do — and those pages exist on the new site, so they resolve post-cutover).
- **Deferred (not blocking go-live):** build HubSpot forms for the 30-sec audit +
  growth quiz, then wire `submitHubSpotForm` (Forms API) into `api/audit.ts` +
  `api/start.ts`. Audit stays on Resend until then; quiz currently emails only.
- **Parked:** quote form (`8be7372a`) + book-a-call (`9ab459ab`) — only if those funnels happen.

---

## 5. Post-cutover smoke test

- [ ] `https://zibdigital.com.au/sitemap.xml` loads, lists ~160 URLs, host correct.
- [ ] `https://zibdigital.com.au/robots.txt` correct, points to the sitemap.
- [ ] Spot-check a few 301s: `/get-in-touch`, `/dylan-jake`, `/team/matt-jackson`, `/casestudy-category/x`.
- [ ] `https://ziboutreach.com.au/seo-melbourne` → 301 → `https://zibdigital.com.au/seo-melbourne`.
- [ ] Submit the contact form + one partner form → contact appears in HubSpot.
- [ ] Confirm Vercel preview (`*.vercel.app`) still returns `X-Robots-Tag: noindex`.

---

## SEO migration — signed off ✅ (2026-06-23)
- All 56 indexable old URLs resolve (50 live pages + 6 explicit 301s); 0 would 404.
- All previously-missing pages built; slug-change/removed-page 301s in place.
- Every indexable page has a unique title, description, and canonical.
- sitemap.xml correct (host, inclusions, private/personalised pages excluded).
