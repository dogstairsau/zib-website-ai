# Entourage — paid-media landing page (concept)

`/entourage-home-loans-melbourne` · `noindex, nofollow` · built alongside the
August 2026 Google and Meta audit.

## Why it exists

The audit found A$24,686 of spend across 101 days, 123 platform-reported
"leads", and zero closed deals — because neither platform tracks anything past
the form submit, so a A$1m+ investor enquiry and an unemployed applicant look
identical to Google and Meta. Entourage's own read was that ~80% of leads were
either uncontactable or unhelpable.

This page is the answer to that on the landing-page side: it grades the enquiry
before a broker's phone rings, routes people Entourage can't serve somewhere
genuinely useful instead of into the call list, and sends a graded, valued
conversion back to the platforms.

**Scope note.** The proposal explicitly excludes landing pages from the
engagement ("we write the website recommendations — you or your web person
build them"). This is a demonstration and a spec, not a scope change. It shows
the client what the recommendation actually looks like.

## Lane

Core finance / upgraders — the 40% lane in the proposed budget split:

- 35+ upgraders (second or third home, real equity)
- Portfolio investors
- Strained refinancers

The shell is built to clone for the other three lanes. Buyers advocacy needs the
location question hard-locked to Victoria and the value bands lifted to A$1m+.
Asset finance needs the capacity cap in the proposal reflected as a throttle.

## What's real and what's stubbed

| Element | State |
|---|---|
| Brand, fonts, palette, wordmark | Real — pulled from entourage.com.au |
| Stats, awards, licensing, addresses | Real — Entourage's own published figures |
| Client stories | Real — published on entourage.com.au (see rights note) |
| Qualifying form, routing, grading | Real, working, client-side |
| Tracking events | Real event names and payloads; fire into `dataLayer` / `fbq` / `gtag` when tags are present |
| Form submission | **Stubbed** — nothing is posted or stored |
| Google reviews wall | 36 verbatim reviews from the Cremorne listing; `/api/entourage-reviews` refreshes the rating and count |
| Award badges | 23 real seals (2013-2026) pulled from entourage.com.au |
| Lead dollar values | **Illustrative placeholders** — must be rebuilt from real commission data |

## The measurement panel

The floating **Measurement** button (or `?debug=1`) opens a live event stream
showing exactly what the platforms would receive. It is the demo instrument —
it renders the same payload that goes out, nothing invented for the panel.

Opening it shifts the page left rather than overlaying it, so the form and the
event stream are visible together at ≥1100px.

### Events

| Event | When | Goes to |
|---|---|---|
| `page_view` | Load | GA4 · Meta |
| `zib_form_start` | First answer | GA4 · Google Ads |
| `zib_form_step` | Every answer | GA4 (micro-conversion) |
| `zib_lead_routed` | Routed away | GA4 only — **not** a conversion, carries `reason_code` |
| `generate_lead` | Qualified submit | Google Ads · Meta CAPI · GA4 · CRM |

`generate_lead` carries `lane`, `lead_grade`, `qualification_points`, `value`,
`currency`, `service_line`, `goal`, `owns`, `loan_band`, `timeframe`,
`location`, `preferred_contact_time`, `time_to_complete_s` and `crm_stage`.

⚠️ This page fires the Meta `Lead` event directly, the same as
`assets/conversion.js`. Do **not** also build a GTM tag firing Meta `Lead` off
`generate_lead` — that double-counts and corrupts optimisation. Use the
dataLayer event for GA4 and Google Ads only.

## Grading

Two independent axes, deliberately:

- **Value** — `LOAN_VALUE × TIMING_MULT × OWNER_MULT`, rounded to A$50. What
  the deal is worth.
- **Grade (A–D)** — qualification points from ownership, timeframe, loan band
  and goal. Whether the person is worth calling.

Keeping them separate stops a small refinance from a ready owner-occupier
being scored like a tyre-kicker. **Both tables are placeholders.** Per the
proposal, they get rebuilt with Entourage from their own close rates and
commission — not from our benchmarks.

## Routing

Nobody is rejected; they're redirected, with a reason code from the seven
agreed in the proposal.

| Answer | Routed to | `reason_code` |
|---|---|---|
| "Buy my first home" (Q1), or "this would be my first" (Q2) | First Home Buyer Guide | `wrong_service` |
| "Finance a vehicle, equipment or business" (Q1) | Entourage Asset | `wrong_service` |
| "Just doing my research" (Q4) | Calculators and guides | `not_ready_or_timing` |

This is the audit's "get first home buyers out of the main lane" fix expressed
at the page level, and it's why routed outcomes are tracked but explicitly not
counted as conversions.

## To take this to production

1. **Fonts.** Domaine Text is a commercial Klim face licensed to Entourage. The
   files here were subset from entourage.com.au for the concept. Production
   must serve them under Entourage's own licence, on their domain.
2. **Client-story rights.** Named talent (Josh & Nick Daicos, Genevieve
   Gregson) appears on Entourage's website. Confirm the talent agreements cover
   **paid advertising** use before this runs behind ad spend — website consent
   often doesn't extend to it. Swap for the unnamed journey stories if not.
3. **Form endpoint.** Point the submit at Gravity Forms (their current stack) or
   HubSpot. The payload is already assembled in the submit handler.
4. **Meta special ad category.** Finance may sit in the credit category, which
   removes age, gender and detailed targeting. The page and its questions do the
   qualifying instead — that's by design, and it's why this page matters more
   than usual on Meta. Check the category flag on every finance ad set.
5. **Real values.** Replace `LOAN_VALUE` and the multipliers with Entourage's
   upfront and trail commission, and the grade thresholds with their actual
   qualification bar.
6. **Review count.** The Google listing states **544** reviews; the website
   claims 1,500+ (plausibly aggregating the Mornington, Geelong, Brisbane and
   Byron Bay listings). Anything on this page sitting beside actual review
   content cites 544, because that is what the source verifiably says. Confirm
   with Entourage which figure they want used where.
7. **Reviews.** Set `GOOGLE_PLACES_API_KEY` and `ENTOURAGE_PLACE_ID`. Without
   them `/api/entourage-reviews` returns `live: false` and the wall keeps its
   placeholder cards — it never invents a review.
8. **Consent and compliance.** Add the cookie/consent layer for the pixels, and
   have Entourage's compliance sign off the general-advice wording in the
   footer.

## Layout notes

Content caps at `100rem`/1600px with gutters stepping 20 → 40 → 80px, matching
their `.grid-container`. **Everything shares that one container** — header,
sections, and both marquees — so the wordmark, every section label and the
first review card sit on a single left edge. Their own site runs the nav wider
(2560px, 60px gutters), which is faithful but puts three different left edges
on screen; the single edge was the deliberate call.

Two traps worth knowing:

- A `padding` shorthand on a `.wrap` co-class (`padding:76px 0 84px`) resets the
  inline gutter to zero. Use `padding-block`.
- `text-wrap:nowrap` on a heading must be scoped to a min-width. Unscoped on the
  awards heading it forced a 444px line onto a 390px phone.

On phones the hero reorders to headline → form → supporting detail, and the
hero's two buttons are hidden because the sticky bottom bar already carries
both.

## Files

```
entourage-home-loans-melbourne.html   the page (self-contained)
api/entourage-reviews.ts              Places API reviews, graceful fallback
assets/entourage/                     fonts, wordmark, hero, story
assets/entourage/awards/              23 award badges
```
