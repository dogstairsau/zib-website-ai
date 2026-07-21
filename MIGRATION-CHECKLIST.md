# Migration / Go-Live Checklist — Zib Digital

Single source of truth for the cutover from the old WordPress site
(`zibdigital.com.au`) to this Vercel project (currently previewed at
`ziboutreach.com.au` + `zib-website-ai.vercel.app`).

**Cutover = DNS flip + merge PR #156, together.** Work the sections top to bottom.

---

## 0. Before the flip (can do now, no impact on live)

- [ ] Confirm `OPENAI_API_KEY` is set in **Vercel → Production** env (Ads Lab images; text packs work without it).
- [ ] Confirm `ANTHROPIC_API_KEY` is set in Production (all AI tools). _Already in use._
- [ ] **HubSpot Private App**: create it (HubSpot → Settings → Integrations → Private Apps). Scopes: `crm.objects.contacts.read` + `write`, `crm.objects.notes.write`, `forms`.
- [ ] **HubSpot custom property** `lead_source` (single-line text) — the `/api` lead writes to it; without it the contact write errors.
- [ ] Add `HUBSPOT_PRIVATE_APP_TOKEN` to **Vercel → Production** env (flips `/api` lead capture stub → live).
- [ ] (Optional) `RESEND_API_KEY` + `LEAD_NOTIFY_FROM` + `LEAD_NOTIFY_EMAIL` for lead/pack emails.

## 1. DNS cutover (the flip)

- [ ] Add `zibdigital.com.au` (and `www`) as a domain on the Vercel project.
- [ ] Point `zibdigital.com.au` DNS at the Vercel project.
- [ ] **Merge PR #156** (`claude/go-live-cutover`) — retires the ziboutreach staging
      redirects, replaces them with a single permanent `ziboutreach → zibdigital` 301.
      ⛔ Do NOT merge before DNS points at this project (it would 301 the live
      ziboutreach preview to the OLD WordPress site).
- [ ] Confirm `https://zibdigital.com.au` loads this project and `X-Robots-Tag: noindex`
      is **absent** there (the noindex is host-scoped to `*.vercel.app` and auto-lifts).

## 2. Analytics & tags (verify on the live domain — GTM-first)

Tags live in `_partials/head.html` (GTM ×2, HubSpot, CallRail, Clarity, GA4) +
`_partials/nav.html` (GTM noscript). After the flip:

- [ ] **Meta Pixel Helper** → confirm Pixel `275858389552736` ("Zib Digital's Pixel") fires a PageView via GTM-TB6Q2RM. If it does NOT fire, ask to hardcode the base pixel + `<noscript>` fallback.
- [ ] **Google Tag Assistant** → confirm GTM-M9RNXQCV + GTM-TB6Q2RM, GA4 `G-LQDQEYFP98`, and old GA4 `G-ZFY5YFEP68` fire.
- [ ] Confirm **Microsoft Clarity** (`wtv7n8ywyl`) is recording. _(Clarity replaces Hotjar — Hotjar intentionally not carried over.)_
- [ ] Confirm **HubSpot** (`14539048`) + **CallRail** (`501276477`) load.

## 3. Search Console & sitemap

- [ ] Verify `zibdigital.com.au` in Google Search Console.
- [ ] Submit `https://zibdigital.com.au/sitemap.xml`.
- [ ] Confirm sitemap lists ~160 URLs, all on the `zibdigital.com.au` host.
- [ ] Confirm `https://zibdigital.com.au/robots.txt` is correct and points to the sitemap.

## 4. Post-cutover smoke test

- [ ] Canonicals resolve to live 200s (no `.html`, no trailing slash).
- [ ] Spot-check legacy 301s: `/get-in-touch`, `/team/marty-tucker`, `/casestudy-category/x`, `/category/x`.
- [ ] `https://ziboutreach.com.au/seo-melbourne` → 301 → `https://zibdigital.com.au/seo-melbourne`.
- [ ] Submit the contact form + one partner form → contact appears in HubSpot.
- [ ] Confirm a Vercel preview (`*.vercel.app`) still returns `X-Robots-Tag: noindex`.
- [ ] Run a real Ads Lab + audit on a live client URL end to end.

## 5. Decommission the old site

- [ ] Once stable, redirect / retire the old WordPress install.

---

## Open follow-ups (not blocking go-live)

- [ ] **Author/org `sameAs`** — supply LinkedIn URLs for the org + bylined authors
      (e.g. Chris Knights) so the entity `sameAs` graph is complete. Wire into
      `_partials/head.html` (`#org`) + `author/chris-knights.html`.
- [ ] **Meta Ads Lab + homepage/audit forms** — optionally apply the built-in
      `https://` prefix used on the Google Ads Lab field, for consistency.
- [ ] Tool-page hero spacing sweep (`/audit`, `/roi-calculator`, etc.).
- [ ] HubSpot forms for the 30-sec audit + growth quiz (audit currently on Resend).

## Reference
- `GO-LIVE.md` — original cutover notes.
- `DEPLOYMENT.md` — host/indexing model (staging noindex is host-scoped + auto-lifts).
