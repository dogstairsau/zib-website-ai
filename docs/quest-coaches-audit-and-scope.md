# Quest Coaches — audit record & scope mapping

Companion to `/quest-coaches` (the client-facing scope page). This file is the working
record: where every number on that page came from, what is still unverified, and which
section of the scope each finding drives. Update this file when new data lands, then
update the page.

**Client:** Quest Coaches / Pharoahs Services Pty Ltd, ABN 85 109 647 476
**Domain:** questcoaches.com.au · **Depot:** 17 Thomas St, Ferntree Gully VIC 3156
**Phone:** 1300 255 287 · **Email:** charter@questcoaches.com.au
**Trading since:** 1989 (as All Bus Rentals)
**Booking portal:** portal.questcoaches.com.au — Coach Manager by Distinctive Systems

---

## 1. Ahrefs audit (Australian market, September 2026)

Source: Ahrefs Site Explorer + Keywords Explorer, Australia. All figures are estimates.
At four visits a month they are noisy — Search Console access from the client replaces
them as the source of truth.

| Metric | Now | A year ago |
|---|---|---|
| Ranking keywords | 1 | 61 (peak ~65–70, Aug 2025) |
| Organic traffic / mo | 4 | peak ~25–28 (Apr–May 2025) |
| Traffic value / mo | $5 | — |
| Domain Rating | 0.3 | — |
| Referring domains | 3 live (12 ever) | — |
| Backlinks | 4 live (85 ever), all UR <10 | — |
| Pages crawled | 8 | — |
| Brand-name rankings | 0 | 11 |

**Shape of the decline.** Sharp fall September–October 2025, partial recovery to ~20
terms January 2026, faded to almost nothing by May 2026. Timing lines up roughly with
Google's August 2025 spam update, but there is no penalty signal. The likelier cause is
a thin site losing contested terms to stronger competitors.

**The one keyword left:** `coach charter` — 150/mo, position 9, up from 58.

**Lost keywords (volume, best prior position):**

| Keyword | Vol/mo | Was | Owner page in new architecture |
|---|---|---|---|
| bus charter | 300 | — | /bus-coach-hire-melbourne |
| coach hire | 250 | — | /bus-coach-hire-melbourne |
| bus charter melbourne | 200 | 31 | / |
| charter bus melbourne | 200 | 21 | / |
| chartered bus | 200 | 30 | /bus-coach-hire-melbourne |
| corporate bus hire melbourne | 150 | 18 | /corporate-bus-hire-melbourne |
| charter bus hire melbourne | 150 | 24 | / |
| mini bus charter melbourne | 150 | 40 | /13-seat-minibus-hire |
| melbourne bus hire | 150 | 44 | / |
| melbourne bus charter | — | 23 | / |

**Size-based demand (weak historical rankings, no page exists):** 25-seater bus hire,
30-seater bus hire, coaster bus hire. → Template C pages.

**Regional demand (weak historical rankings, no page exists):** Shepparton, Traralgon,
Pakenham, Echuca. → Template B pages, and the reason area pages are regional-inclusive
rather than metro-only.

**Backlinks.** Three live referring domains: busaustralia.com (DR 35 — the one genuine
link, worth building on), c99.nl and urlm.com (low-value directories). Lost intently.co
in August 2026.

**Ahrefs-listed competitors:** coachhire.com.au (527 keywords), austwidecoaches.com.au
(103 keywords).

---

## 2. Live crawl (18 September 2026)

Run against all reachable URLs plus each competitor. Reconciliation note: Ahrefs crawls
8 pages; 11 URLs respond 200. The extras are `/testimonials`,
`/itinerary-forms` and `/itinerary-for-direct-transfer`.

**Critical**
- Viewport is `width=550` on every page — the site is not responsive.
- `format-detection: telephone=no` sitewide and zero `tel:` links. The 1300 number
  cannot be tapped on a phone.
- No service pages and no area pages at all.
- Analytics: Universal Analytics `UA-90737186-1` via `analytics.js` only. No GA4, no
  GTM, no Ads conversion tag, no Meta pixel. UA stopped processing July 2023.
- Quoting is offsite on portal.questcoaches.com.au with no cross-domain measurement.
- Zero structured data on all pages.
- `/terms-and-conditions` is titled "Crown Bus Charter" — a competitor's brand. Source
  of the `crown buses` / `crown coaches bus` rankings. `quinces coaches` also ranks:
  **ask the client why.**

**Major**
- robots.txt and sitemap.xml both 404.
- Two `<title>` tags per page; the second contains the typo "Mebourne".
- `meta keywords` tag still present.
- www and non-www both return 200, no canonical anywhere, `http` → `https` is a 302.
- PHP 5.6.40 (EOL Dec 2018), jQuery 1.11.0, HTML served `no-store`.
- COVID-19 banner on every page, its own page still linked, footer reads © 2021.
- No Open Graph tags, no `lang` attribute.
- Missing titles/descriptions on /covid-19 and both terms pages; quote page has two H1s.

**Moderate**
- Homepage H1 reads "Reliable and ProfessionalBus Charter Service" (missing space from a
  `<br/>` inside the heading).
- Largest asset is a 418 KB JPEG. Load time is otherwise ~2s.

**Word counts (incl. nav/footer):** / 349 · /our-fleet 196 · /about-us 215 · /faqs 541 ·
/testimonials 572 · /contact-us 211 · /itinerary-for-direct-transfer 307. Homepage body
copy alone is ~296 words.

**Existing content worth keeping:** 8 written testimonials (unmarked), 9 commercial FAQs
(cancellation tiers, credit card fees, no alcohol, no onboard toilets), fleet of 13 / 24
/ 27 / 48–57 seats, office hours, depot address.

---

## 3. Competitor benchmark (live, 18 September 2026)

| Operator | Pages (own sitemap) | Words, main page | Schema | Responsive | tel: links |
|---|---|---|---|---|---|
| Ventura Charter | 45 | 869 | Organization, WebPage, Breadcrumb | Yes | 2 |
| Crown Coaches | 35 | 1,789–2,276 | 11 types incl. LocalBusiness, Service, FAQPage, Review, AggregateRating | Yes | 2 |
| Nuline Charter | 15 | 127 | LocalBusiness, WebSite | Yes | 0 |
| McKenzie's | 9 | 487 | WebSite only | Yes | 1 |
| **Quest Coaches** | **11** | **296** | **None** | **No (550px)** | **0** |

- **Crown** is the execution benchmark, strongest on schools: 150+ schools, 75 daily
  runs, 1,500 students, parent tracking app, named camp/excursion venues, size-to-group
  table, 6 schema'd FAQs, plus safety/child-safety/bus-safety/climate policy pages.
- **Ventura** is the architecture benchmark: 4 service hubs × 5–8 child pages.
- **Open lanes:** sporting clubs (nobody has a page), winery transport from the venue's
  side (B2B, uncontested), area-level search, vehicle-size search.

---

## 4. Where each finding lands on the client page

`/quest-coaches` is written for the owner of a coach company, not a marketer. No
jargon: "structured data" becomes what Google can read, "domain rating" becomes how
many sites link to yours, templates become "page recipes", ranking positions become
page numbers. Keep it that way when editing.

| Finding | Section on the page | What it drives |
|---|---|---|
| 61 → 1 keywords | Masthead, The short version, What Google sees | The headline diagnosis |
| Lost keyword table | What Google sees | Shown as page numbers, not positions |
| Size-based demand | What Google sees, Bus pages | Four vehicle pages |
| Regional demand | What Google sees, Your new website | Nine area pages, regional included |
| tel: / viewport | Your phone number | Its own section — biggest single loss |
| UA dead + portal gap | The short version, What happens when | Tracking setup, cross-domain |
| No service pages | The short version, Your new website | The 58-page site map tree |
| Crown title, COVID, footer | What Google sees, What happens when | First-fortnight cleanup |
| No accreditation content | The other operators | Three trust pages, stage one |
| Crown's school page depth | The other operators, Trip pages | Page recipe contents |
| Ventura's hub structure | Your new website | Hub-and-child site map |

Page sections, in order: The short version · Your phone number · What Google sees ·
The other operators · Your new website · How pages get built · What happens when ·
What it costs · What we need.

## 5. Still unverified — do not publish claims on these

- Safe Transport Victoria accreditation number.
- Whether all vehicles have seatbelts; accessibility per vehicle.
- Driver Working With Children check policy and child safety policy.
- Real service boundary and out-of-area charges.
- Why the site ranks for `quinces coaches` (former name? partner operator?).
- Revenue split across schools / corporate / clubs / wineries, and spare fleet capacity.
- Client names for the school, club, corporate and winery pages (permission needed).
- Search Console history and portal booking history.

## 6. Commercial figures

The scope page's investment section carries the deliverable counts only. Build fee,
monthly retainer and any ad spend are to be filled in by Zib before the page is sent.
