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

## 4. What the data came back with (13 Aug 2026) and what we changed

Run complete. The load-bearing findings, and the edits they produced:

**Primary keyword unchanged.** `digital marketing agency south melbourne` (30/mo,
KD 56) stays as title/H1 target. It's the only term in the set with a crawled
SERP, so difficulty and competitors are observable rather than modelled. The
higher-volume suburb terms (150s) all returned KD/CPC/Traffic Potential as N/A —
Ahrefs has never crawled those SERPs — and their internal ordering inverts normal
head-vs-modifier behaviour, so they're not safe to build an H1 on. Justify this
page on local-pack relevance and as the GBP/citation landing target, not volume.

**Web outranks SEO in this postcode.** The website cluster (website design 150,
web design 80, website development 60, plus variants) totals ~320/mo against ~190
for SEO and ~100 for anything containing "digital marketing". So: services H2 now
reads "SEO, website design and paid media", and Website design & development moved
from position 04 to 02 in the services list.

**Suburb grid reordered** to the Step 2 volumes, with Richmond, Windsor and
Brighton demoted to the end — all three have larger overseas namesakes (Brighton
UK, Windsor Ontario, Richmond Virginia) plus other Australian ones, so their
reported volume isn't Melbourne-specific. St Kilda, Elwood, Prahran, Windsor,
Toorak and Brighton were split out of their combined cells so the ordering could
follow demand.

**No sibling suburb pages.** Strongest candidate (South Yarra, 250 combined) rests
on a 150 that first appeared in Dec 2024 and is 5x the South Melbourne equivalent
— not a credible market signal. Every page-one competitor ranks a homepage;
fragmenting into thin suburb pages is the doorway pattern. Concentrate authority
here.

**FAQ rebuilt from real queries.** The "south melbourne" questions report is
entirely market hours and dim sims — nothing commercial at any volume. So the FAQ
now uses the live PAA box on the target SERP verbatim ("What is the average fee
for a digital marketing agency?", "Is it worth it to hire a digital marketing
agency?", "Which digital marketing agency in Melbourne is the best?") plus two
localised from the national questions report. `build.mjs` carries that wording
into FAQPage schema automatically.

**Competitive read.** Nobody on page one has a dedicated suburb page. Position 1
(synq.com.au) holds it at DR 1.2 with 16 followed referring domains and 5 organic
visits a month. The quoted ~108 referring domains to rank is inflated by
directories that aren't competing for suburb intent. Organic position is winnable
inside 6 months.

**The thing this page can't do.** Position 1 on that SERP is the map pack, and no
amount of page content gets you into it. That's Google Business Profile category
and proximity work, review velocity and citation consistency. If the goal is calls
from 3205, sequence the GBP work first — this page is the landing target for it,
not a substitute.

**Still worth doing:** cross-check the shortlist against Search Console. Existing
impressions for `digital marketing south melbourne` or the website-design cluster
outweigh every modelled figure in Steps 1–3.

---

## 5. Optional follow-up prompt (once data is in)

> Here's the Ahrefs data from the brief. Rewrite the `<title>`, meta description
> and H1 of `/digital-marketing-agency-south-melbourne` around the primary keyword
> you recommended. Keep the title under 60 characters, keep the brand at the end,
> keep the tone: plain, commercial, no superlatives. Give me three options for each
> and tell me which you'd ship.
