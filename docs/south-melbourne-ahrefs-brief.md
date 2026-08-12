# South Melbourne page — Ahrefs keyword brief (Claude in Chrome)

Companion to `/digital-marketing-agency-south-melbourne`. The page is live-ready
without keyword data — this brief is how we get the numbers that decide the final
H1, meta description, H2s and FAQ wording, plus whether the page should target
"digital marketing agency south melbourne" or something with more real demand.

Run it in Claude in Chrome with an Ahrefs session already logged in. Claude drives
Keywords Explorer and Site Explorer in your tab; it can read the numbers on screen
but cannot export CSVs, so the brief asks for tables back in chat.

---

## 1. The prompt to paste into Claude in Chrome

> You have access to my logged-in Ahrefs account in this browser. I need keyword
> data for a new local landing page targeting South Melbourne, Victoria, Australia
> (postcode 3205). We're a digital marketing agency headquartered there.
>
> Work through these steps and report back in markdown tables. Don't summarise —
> I want the raw numbers.
>
> **Step 1 — Seed volumes.** Open Ahrefs Keywords Explorer, set country to
> **Australia**. Enter this seed list and give me a table of: Keyword, Volume,
> Keyword Difficulty, Global volume, CPC, Parent Topic, and SERP features present.
>
> ```
> digital marketing agency south melbourne
> digital marketing south melbourne
> seo south melbourne
> seo agency south melbourne
> google ads south melbourne
> ppc agency south melbourne
> social media agency south melbourne
> web design south melbourne
> marketing agency south melbourne
> advertising agency south melbourne
> digital agency south melbourne
> digital marketing agency melbourne
> seo melbourne
> marketing agency near me
> digital marketing agency near me
> ```
>
> **Step 2 — Suburb variants.** Repeat the volume check for the surrounding
> suburbs we name on the page, using the pattern `digital marketing agency
> {suburb}` AND `seo {suburb}`: Albert Park, Middle Park, Port Melbourne,
> Southbank, Melbourne CBD, Docklands, South Yarra, Prahran, Windsor, St Kilda,
> Elwood, Richmond, Cremorne, Toorak, Brighton. Give me one table sorted by volume
> descending, and flag any suburb where volume is 0 for both patterns.
>
> **Step 3 — Matching terms.** In Keywords Explorer, run **"south melbourne"** as a
> single seed with the **Matching terms** report, country Australia. Filter to
> keywords containing any of: marketing, seo, advertising, agency, google ads,
> ppc, social media, web design, website. Return the top 40 by volume with Volume,
> KD, and Parent Topic. This is where the unexpected demand usually hides.
>
> **Step 4 — Questions.** Same seed, **Questions** report. Return anything with
> volume ≥ 10 that a local business would plausibly ask. These become FAQ entries.
>
> **Step 5 — Competitor gap.** In Site Explorer, check who currently ranks for
> "digital marketing agency south melbourne" in Australia (look at the SERP
> overview). For the top 3 ranking domains, report: domain, DR, referring domains,
> estimated organic traffic, and the URL that ranks (is it a dedicated suburb page
> or a generic city page?). Then tell me which of those pages has the weakest
> backlink profile — that's our realistic entry point.
>
> **Step 6 — Verdict.** Based on all of the above, tell me:
> a) the single best primary keyword for this page and why,
> b) 3–5 secondary keywords worth working into H2s and body copy,
> c) whether the suburb-level demand justifies separate pages for any neighbouring
>    suburb, or whether one South Melbourne page covering them all is correct,
> d) an honest read on whether ranking here is winnable inside 6 months.
>
> If a number looks implausible (Ahrefs local suburb data is often thin), say so
> rather than reporting it straight — I'd rather know a keyword has unreliable
> data than build a page around a phantom 200 searches a month.

---

## 2. Where each answer lands on the page

| Ahrefs output | What it changes | File location |
|---|---|---|
| Step 1 winner (highest volume + winnable KD) | `<title>`, H1, meta description, hero eyebrow | top of `digital-marketing-agency-south-melbourne.html` |
| Step 3 matching terms | H2 wording in the services + local-search sections | `.services-h`, `.local-h` |
| Step 2 suburb volumes | Which suburbs stay in the grid, and their ordering (highest demand first) | `.sm-suburb-grid` |
| Step 4 questions | FAQ questions — these auto-generate `FAQPage` schema at build time | `#faqList` |
| Step 5 competitor gap | Whether we need supporting content/links before this page can rank | strategy, not markup |
| Step 6c | Whether we build Albert Park / Port Melbourne pages next | new files, same template |

Note on the FAQ: `build.mjs` reads the visible `.faq-item` markup and generates
`FAQPage` JSON-LD automatically. Phrase FAQ questions as the actual query from
Step 4 and the schema inherits it for free — no separate schema edit.

---

## 3. Two things to sanity-check before acting on the data

**Suburb keyword volumes are noisy.** Ahrefs frequently reports 0–10/mo for
suburb-level commercial terms that genuinely convert, because clickstream samples
are thin at that granularity. Cross-check the shortlist in Google Keyword Planner
and, more usefully, against our own Search Console data — if we already get
impressions for "digital marketing south melbourne", that beats any third-party
estimate.

**Volume is the wrong metric for a local page anyway.** Map pack visibility for
"marketing agency near me" from a 3205 IP is worth more than any suburb keyword's
reported volume. Use Step 5 (who ranks, how strong) to set expectations, and treat
Steps 1–3 as the copy brief rather than the business case.

---

## 4. Optional follow-up prompt (once data is in)

> Here's the Ahrefs data from the brief. Rewrite the `<title>`, meta description
> and H1 of `/digital-marketing-agency-south-melbourne` around the primary keyword
> you recommended. Keep the title under 60 characters, keep the brand at the end,
> keep the tone: plain, commercial, no superlatives. Give me three options for each
> and tell me which you'd ship.
