# Industry pages — build notes

Built from the *Zib Digital — Industry Page Build Pack* (27 Aug 2026), companion to the website
& marketing brief. This note records what shipped, what is deliberately held back, and the
decisions taken where the brief left an open question.

## What shipped

Nine pages under `/industries/`, all cloning the `/seo-for-real-estate-agents` structure
(thesis H1 → audit widget → three pain points → why-generic-fails → AEO/GEO → proof block →
service mix → FAQs → rep-routed CTA):

| URL | Copy source | CTA routes to |
|---|---|---|
| `/industries` | new (directory page) | `/partners` |
| `/industries/trades-and-home-services` | pack §1, verbatim | Corrine · Marty · Matt · Chelsea |
| `/industries/roofing-and-restoration` | pack §2, verbatim | Matt |
| `/industries/tree-and-grounds-care` | pack §5, verbatim | Corrine · Matt |
| `/industries/pool-and-outdoor-living` | pack §6, verbatim | Marty · Corrine |
| `/industries/industrial-and-b2b-supply` | pack §9, verbatim | Chelsea · Corrine · Matt |
| `/industries/automotive` | pack §10, verbatim | Matt · Jacquie (via form) |
| `/industries/dealerships` | derived from pack §10 + brief Tier 2 | Matt · Jacquie (via form) |
| `/industries/aftermarket-and-specialist-automotive` | derived from pack §10 + brief Tier 2 | Matt · Jacquie (via form) |

Wiring: **Industries** dropdown in the primary nav (between Locations and Reviews), an
Industries column in the footer, an Industries section in `llms.txt`, and `sitemap.xml`
regenerated. Each page sets `<meta name="zib:source-tag">` so audit runs and leads arrive
tagged with the vertical — the closest thing the current audit stack has to "pre-filtered
to the vertical" (there is no per-industry audit parameter today).

Every page carries `Article` + `BreadcrumbList` JSON-LD in-page; `FAQPage` and the canonical
are injected by `build.mjs` from the FAQ markup. The in-page `BreadcrumbList` is required:
without it the build's auto-breadcrumb would file any `Article` page under *Case studies*.

## Proof provenance — every number is sourced

No client names, no contract values anywhere. Each proof line traces to an existing published
asset or the brief's publishable list:

| Proof line | Source |
|---|---|
| Roofing contractor, Melbourne — 410% organic traffic, 27 leads/day | `casestudy/assured-roofing.html` |
| Roof restoration, Brisbane — $2.8M → $5.3M forecast, 2,671 conversions | `_partials/case-studies/roof-restoration.html` |
| Pool fencing — 418 enquiries, 11.17% CR, <$45/lead | `_partials/case-studies/pool-fencing.html` |
| Tree services, Melbourne — 540% traffic, 20 leads/day, client since 2012 | `casestudy/procut.html` |
| Bayside electrical — client since 2023, third year (tenure, no number) | brief, publishable-without-a-number list |
| Trampoline retailer, VIC — $638K organic revenue | `_partials/case-studies/trampoline-seo.html` |
| Door & shutter manufacturer — 1,867 enquiries / 18 months, 76% organic | `_partials/case-studies/commercial-door.html` |
| Custom trailer manufacturer — 86 leads, $400K+ product, +226% | `_partials/case-studies/custom-trailer.html` |
| 4x4 accessories, Perth — 1,368 leads at $9.96 | `_partials/case-studies/4x4-automotive.html` |
| Car subscription, Melbourne — 53 → 110 leads/month, 6-year partnership | `_partials/case-studies/car-subscription.html` |
| Panel beater — organic traffic nearly tripled in 12 months | `casestudy/rj-don-panelbeaters.html` |

Every proof block closes with the escape hatch: *"Client names withheld on request —
references available on a discovery call."*

## Held back on purpose (per the pack's build sequence)

These pages are **not** built because their proof doesn't exist yet. Do not publish them
until the results pull lands:

- `/industries/construction-and-building` — one publishable proof point (kitchen manufacturer);
  needs 2–3 construction results pulled.
- `/industries/cleaning-and-property-maintenance` — adjacent proof only; needs the national
  cleaning group's LinkedIn result (highest-priority pull).
- `/industries/electrical-and-solar` — tenure only; needs the electrical contractor and solar
  installer results.
- `/industries/plumbing-and-drainage` — no publishable plumbing result exists.
- `/industries/legal` — no publishable legal result exists.

The trades hub and `/industries` mention these verticals in prose without linking, so nothing
404s. When a page ships, add its row to: the trades hub spokes list (or `/industries` list),
the nav dropdown, the footer column, and `llms.txt`.

## Decisions taken on the brief's open questions

1. **URL structure** — `/industries/<vertical>` (the pack's own URLs), not flat
   `/<vertical>-marketing`. Spokes sit flat under `/industries/` (matching how the pack
   addresses roofing etc.), with hierarchy expressed in breadcrumbs. Canonicals have no
   trailing slash (vercel `trailingSlash: false`).
2. **Automotive spokes** — the pack provides full copy only for the hub, but its build
   sequence ships "hub + 2 spokes". The spoke copy is derived from the pack + brief Tier 2
   angles, with distinct theses so the three pages don't duplicate each other. Both spokes use
   the agency-level automotive proof, which the brief explicitly sanctions for these pages.
3. **Jacquie Leopardi routing** — she has no partner page yet (that's a rep-page workstream
   item). Automotive CTAs name her and route SA enquiries to the on-page contact form, which
   carries the page's source tag. Swap to her partner page link once it exists.
4. **Sibling links** — the pack's internal-link spec names some gated pages (plumbing,
   cleaning, construction). Links substitute the nearest *live* sibling instead, so no page
   links to a URL that doesn't exist.

## Still open (needs Michael / the team)

- The results pull (GA4, Google Ads, Search Console, GBP) for the accounts named in the brief —
  the critical path for the five held-back pages, the rep-page rewrites and the LinkedIn
  Receipts posts.
- Rep page fixes + Jacquie's page (separate workstream in the brief).
- `/case-studies` industry filter + rewriting the 33 existing studies to the anonymised
  standard. Note the existing `casestudy/*` pages carry client brand names; the industry pages
  deliberately do not link to individual named studies, only to `/case-studies`.
- Consent check on the named client quote on Corrine's page and client logos on rep pages.
- Which Matt Arnot URL is canonical (`/matt-arnot` is used everywhere here; the brief mentions
  a duplicate `/team/matthew-arnot/`, and `vercel.json` already 301s `/team/:slug*`).
- City intersections (`/industries/roofing-and-restoration/melbourne`) only for pages that
  prove out, per the pack.
