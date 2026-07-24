# Marketing Squad page — build brief for squadhq.com.au

Handoff for the Claude Code session on the SquadHQ repo. Implement as a new
page at **`/marketing-squad`**, matching the existing site system: numbered
sections (01, 02…), monochrome minimalist design, direct tone, "Book a demo"
CTA convention.

**Editorial rules (carry over from the Zib house style):** Australian English
(optimise, colour). No em-dashes anywhere; use commas, colons or full stops.
Confident and commercial; no "unlock/elevate/leverage/synergy".

**The one non-negotiable:** this page claims Zib Digital's track record, so it
must carry the lineage sentence (Section 04) verbatim or near-verbatim. Proof
with attribution is honest inheritance; proof without attribution is a new
brand claiming another company's history. Do not ship the proof without the
lineage line.

---

## Head / meta

- **URL:** `/marketing-squad`
- **Title:** `Marketing Squad · Agent-native marketing | SquadHQ`
- **Meta description:** `A full marketing function, run agent-native. Specialist agents handle the scale, senior marketers own the judgement. Built by the team behind Zib Digital, on the platform that powers it.`

## Hero

- Eyebrow: `MARKETING SQUAD`
- H1: `A full marketing function, run agent-native.`
- Sub: `SEO, Google Ads, paid social, content and web, delivered as one commercial system. Specialist agents handle the monitoring, iteration and reporting. Senior marketers own the strategy, the judgement and the result.`
- CTAs: `Book a demo` (primary) · `See it in production` (anchors to Section 04)

## 01 — What it is

`Marketing Squad is the marketing arm of SquadHQ: the agent-native way to run
your marketing. Instead of a retainer of disconnected tasks, you get one
commercial system. Agents watch your search demand, iterate your creative,
triage your leads and assemble your reporting, every day. Senior marketers
decide what deserves money, what gets scaled and what gets stopped.`

`It is not software you learn. It is a marketing function you run, or we run
for you.`

## 02 — How it works

Four steps, matching the Squad numbered-block style:

1. **Diagnose.** `We read your business against real search demand and your
   commercial reality: where the money is, where you leak it, what your
   competitors take.`
2. **Plan.** `A plan built around your pipeline and capacity, sequenced by
   commercial impact. The fast wins fund the compounding ones.`
3. **Execute.** `Agents monitor queries, pace campaigns, draft variants and
   flag exceptions daily. A senior marketer reviews, applies commercial
   context and approves what changes.`
4. **Report.** `A short weekly brief in commercial language: what changed,
   what it cost, what entered the pipeline, what was won, what needs a
   decision.`

## 03 — Agents do the scale. Humans make the call.

Two-column block (mirrors the platform's oversight positioning):

**Agents:** `monitor search demand · iterate creative variants · classify and
route leads · assemble reporting · watch pacing and spend drift`

**Senior humans:** `set commercial priority · verify claims and quality ·
approve what ships · decide scale, wait or stop · own the client
relationship`

Closing line: `The report is not the product. The decision is.`

## 04 — In production, not in a pitch deck  ← THE PROOF + LINEAGE SECTION

Lead: `Marketing Squad is not a launch-day promise. The platform already runs
a full-service agency at national scale.`

**Lineage sentence (required, keep plain):**
`Marketing Squad is built by the same team that founded and runs Zib Digital,
Australia's first hybrid agent agency, and it runs on the same platform that
powers it. The results below were delivered by our team under the Zib Digital
brand.`

Proof tiles (all verified against live Zib case studies; keep attribution):
- `800+ Australian businesses served since 2009`
- `4.8★ average across 90+ Google reviews`
- `$2.8M → $5.3M forecast revenue, Brisbane roof restoration business, driven by paid advertising` → link `zibdigital.com.au/casestudy/roof-restoration`
- `309% growth in ecommerce transactions from organic search, Outback Fencing` → link `zibdigital.com.au/casestudy/outback-fencing`
- `1,368 leads at $9.96 each over ten months, Perth 4x4 specialist` → link `zibdigital.com.au/casestudy/4x4-automotive`

Footer link: `Browse the full case-study library →` (zibdigital.com.au/case-studies)

## 05 — Two ways to run it

Mirror the site's existing engagement models:
- **Managed.** `Our senior marketers and agents run the function end to end.
  You get the weekly brief and the results.`
- **Collaborative.** `Your team runs the system with our platform, playbooks
  and senior oversight. Build the capability in-house without starting from
  zero.`

## 06 — FAQs

Use the standard FAQ component. These four, in this order (the first is the
disclosure workhorse and captures the branded query):

1. **How is this different from Zib Digital?**
   `Same team, same platform, different wrapper. Zib Digital is our
   full-service agency brand, operating since 2009. Marketing Squad is the
   agent-native offering under the SquadHQ umbrella: the same senior people
   and the same production platform, packaged for businesses that want the
   system itself, managed or collaborative.`
2. **Do agents make the decisions?**
   `No. Agents monitor, draft, classify and report. Senior humans set the
   priorities, verify the work and make every commercial call. Every change
   is visible and reviewable.`
3. **What does it cost?**
   `It depends on the scope of the function you want to run. Book a demo and
   we will map it against your current marketing spend, most businesses find
   the comparison is the persuasive part.`
4. **How fast can we start?**
   `The diagnose step takes days, not months. If we are a fit, the system is
   typically live inside your first month.`

## CTA section

- H2: `See your marketing, run agent-native.`
- Sub: `Book a demo and we will map your current marketing function against
  the squad that would replace or augment it.`
- CTAs: `Book a demo` · `Run the automation map` (existing Squad tool)

---

## Schema (JSON-LD) — the entity graph matters as much as the copy

One block on the page. This connects the Squad and Zib entities honestly and
transfers entity equity instead of starting from zero:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Service",
      "@id": "https://www.squadhq.com.au/marketing-squad#service",
      "name": "Marketing Squad",
      "serviceType": "Agent-native digital marketing",
      "description": "A full marketing function run agent-native: SEO, Google Ads, paid social, content and web delivered as one commercial system by specialist agents with senior human oversight.",
      "provider": { "@id": "https://www.squadhq.com.au/#org" },
      "areaServed": { "@type": "Country", "name": "Australia" }
    },
    {
      "@type": "Organization",
      "@id": "https://www.squadhq.com.au/#org",
      "name": "SquadHQ",
      "url": "https://www.squadhq.com.au/",
      "brand": [
        { "@type": "Brand", "name": "Marketing Squad" }
      ],
      "sameAs": ["https://zibdigital.com.au/"],
      "employee": [
        { "@type": "Person", "name": "Chris Knights", "jobTitle": "CEO", "sameAs": ["https://zibdigital.com.au/author/chris-knights"] },
        { "@type": "Person", "name": "Mark James", "jobTitle": "CTO" },
        { "@type": "Person", "name": "Matt Arnot", "jobTitle": "Head of Growth", "sameAs": ["https://zibdigital.com.au/author/matt-arnot"] }
      ]
    }
  ]
}
```

Notes:
- The `sameAs` to zibdigital.com.au plus the shared `Person` entities is the
  machine-readable version of the lineage sentence. Keep them together: the
  copy discloses to humans, the graph discloses to Google. Shipping one
  without the other is half a disclosure.
- If the SquadHQ site already has an Organization block, merge into it (same
  `@id`) rather than duplicating.

## Implementation notes for the Squad session

- Match the existing numbered-section components and monochrome palette; no
  new design system.
- Add `Marketing Squad` to the site nav (under "What we do" or as a top-level
  item, whichever the nav pattern supports).
- Add the page to the sitemap; self-referencing canonical.
- Internal links: hero CTA → existing demo booking; 05 → existing engagement
  model pages if they exist; 04 tiles → the Zib case-study URLs above
  (external links to zibdigital.com.au are correct and intentional).
- Do not copy Zib page copy verbatim anywhere; this page speaks as SquadHQ.

## What this page deliberately does NOT do

- It does not announce any rebrand, rename or transition. It adds an offering.
- It does not change anything on zibdigital.com.au.
- It does not replace the full "Our story" lineage page, which is still the
  required first step of any future migration (see the transition discussion).
