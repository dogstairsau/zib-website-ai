# Brand Score — product + scoring spec (v1)

A free, loss-leader diagnostic. A business drops their URL, email, socials and a
couple of competitors, and gets a **Brand Score (0–100)** in ~30 seconds —
streamed live on the page, same shape as `/audit`. Underneath the headline
number sits the **Value Creation** framing from the founder brief: your brand and
digital marketing are the engine that grows the "value pie". The score is the
hook; the levers and the re-engagement loop are the commercial play.

> Scope of v1: **value creation through digital marketing.** The same engine
> generalises to the whole value chain later (see "Long game").

---

## 1. Why this exists

- **Loss leader → pipeline.** Like the audit, every run captures a lead
  (HubSpot + email + Slack) with a tailored partner opener.
- **A score that moves = a permanent reason to re-engage.** The world changes
  (interest rates, a competitor's campaign, a bad-news event in their ecosystem)
  and so does the score. "Connect again, get your latest Brand Score, here's the
  one lever to pull this week." That recurring re-scan is the upsell engine.
- **A data asset over time.** Aggregated, anonymised scores across industries
  become white papers, benchmarks, case studies — the long-term content play.

## 2. The headline: Brand Score (0–100)

One intuitive number. Computed deterministically from six weighted pillars so it
is defensible and repeatable (no AI guessing on the number itself — the AI writes
the *read*, not the score, exactly like `/audit` keeps quantitative claims on the
deterministic side).

| # | Pillar | What it answers | Value-pie lever |
|---|--------|-----------------|-----------------|
| 1 | **Market Visibility** | Are the people that matter seeing you — customers and referrers? | Reach: more of the market sees you → bigger pie |
| 2 | **Brand Clarity** | Is your positioning sharp and your promise legible? | Willingness-to-pay: clear premium positioning lifts the customer-surplus side |
| 3 | **Social Presence & Proof** | Do you show up, recently and credibly, where buyers check? | Trust → conversion → captured value |
| 4 | **Competitive Position** | How do you stack against the competitors you named? | Share of the pie |
| 5 | **Demand Momentum** | Is interest in you / your category rising or falling? | Value velocity: is the pie growing |
| 6 | **Experience & Conversion** | Does operational friction leak value before you get paid? | Plugging the leaks (late delivery / confusing invoice analogue) |

**Brand Score** = weighted mean of the six pillar scores (each 0–100):

```
weights = { visibility:.22, clarity:.18, social:.16, competitive:.18, momentum:.13, experience:.13 }
brandScore = round(Σ pillar.score × pillar.weight)
```

Each pillar is built from one or more **signals**. Every signal degrades
gracefully: if a data source is unreachable, the signal is marked
`unavailable`, dropped from its pillar's average, and the UI says so. A pillar
with no available signals falls back to a neutral 50 and is flagged.

### Signal → pillar map (v1 data sources, all free)

| Signal | Source (free) | Feeds |
|--------|---------------|-------|
| SEO score | PageSpeed Insights (`lib/psi.ts`) | Visibility |
| Branded search interest | Google Trends (keyless endpoint) | Visibility, Momentum |
| Indexability / crawl health | site crawl + `lib/seoChecks.ts` | Visibility |
| Positioning clarity (H1, promise, value prop) | site crawl, AI-scored | Clarity |
| Message consistency (title/meta/H1 alignment) | site crawl, deterministic | Clarity |
| Social profile coverage + reachability | extracted from HTML, verified by fetch | Social |
| Recency / proof signals (reviews, schema) | site crawl | Social |
| Competitor head-to-head (SEO + social + brand interest) | PSI + Trends + crawl per competitor | Competitive |
| Category/brand trend trajectory | Google Trends (slope of last N points) | Momentum |
| Performance + accessibility + best-practices | PageSpeed Insights | Experience |

> "Wire real free data sources first" (the chosen path): v1 ships with PSI,
> Google Trends and live social-profile verification all actually called — not
> AI-estimated. AI is used only for the qualitative *read* and the
> positioning-clarity score, both clearly framed.

## 3. The Value Creation overlay

Below the Brand Score we render the founder's framework, derived from the same
signals — no extra data needed:

- **Value velocity** — direction + magnitude from the Google Trends slope on the
  brand/category terms. Positive = engine strengthening; negative = warning light.
- **Capture vs create (excellence-ratio analogue)** — are you getting *seen*
  (high visibility) but *leaking* at experience/conversion (low experience)? A
  high create-low-capture split is the "value leaking out all over the place"
  story made concrete.
- **The lever** — the single highest-impact move now: the lowest-scoring pillar
  weighted by its importance. Rendered as **this week / this month / this year**
  (quick win → structural fix → strategic bet).
- **Invest / Extract / Compound** — the strategic-posture read, placed on the
  velocity × capture quadrant from the transcript.

## 4. Competitor benchmarking

For each named competitor (cap at 3 in v1) we run a lightweight version of the
same signals — PSI score, social coverage, and a Google Trends head-to-head on
brand terms — and show the prospect's Brand Score against the set: ahead, level,
or behind, per pillar. This is the most visceral part of the result and the
strongest re-engagement hook ("you were 4 points behind them last month").

## 5. The flow (mirrors `/api/audit`)

```
brand-score.html  ──POST {url,email,socials[],competitors[]}──▶  /api/brand-score (edge, SSE)
                                                                    │
   live stages + streaming read  ◀──── SSE events ────────────────┤
                                                                    ├─ crawl site (site.ts)
                                                                    ├─ PSI (psi.ts)            ┐ parallel
                                                                    ├─ Google Trends (trends)  │ per target
                                                                    ├─ verify socials (socials)┘
                                                                    ├─ score (brand/score.ts)  ← deterministic
                                                                    ├─ strategist read (Claude, streamed)
                                                                    ├─ lever + value read (Claude)
                                                                    └─ captureLead + email + Slack
```

SSE events: `status`, `signals` (per-source availability), `score` (the
deterministic payload: pillars, brandScore, velocity, capture, competitors),
`chunk` (streamed read), `lever`, `done`, `error`. The front-end renderer
reuses the audit page's SSE-block parser and stage UI.

### Files

```
api/brand-score.ts          edge SSE orchestrator (mirrors api/audit.ts)
lib/brand/socials.ts        extract + verify social profiles from HTML
lib/brand/trends.ts         Google Trends interest + slope + head-to-head
lib/brand/score.ts          deterministic pillar + Brand Score + overlay model
lib/prompts/brand.ts        server-only strategist read + lever + partner-opener prompts
brand-score.html            front-end page (reuses head/nav/footer partials)
```

Lead capture, rate limiting, SSRF-safe fetch, email and Slack are reused as-is
from the audit stack.

## 6. What's deterministic vs AI (the trust line)

- **Deterministic (the number):** every pillar score, the Brand Score, value
  velocity, capture split, competitor deltas. Same input → same output.
- **AI (the words):** the strategist read, the positioning-clarity sub-score,
  the lever narrative, and the internal partner opener. The AI never invents a
  score or a metric — it explains the numbers it is handed. Same discipline as
  the audit prompt's hard constraint.

## 7. Re-engagement loop (the actual product)

1. First run → score + lever + lead captured.
2. Result page CTA: "Re-scan in 30 days / connect your data for the real number."
3. On re-scan, we diff against the stored prior score and lead with the delta and
   *why* it moved (a competitor moved, your category cooled, you shipped content).
4. Each delta is a reason for a partner to call. Phase 2 wires storage + a
   scheduled monthly re-scan email (Vercel Cron), reusing the audit email stack.

## 8. Phasing

- **v1 (this build):** the page, the endpoint, the six-pillar deterministic
  model wired to PSI + Trends + live social verification, the AI read + lever,
  lead capture. Competitor head-to-head for up to 3 named competitors.
- **Phase 2:** persist scores (Vercel KV) → real deltas + monthly re-scan email.
  Deeper social signals (follower counts via platform APIs), reviews via Google
  Places, SERP share-of-voice.
- **Phase 3 (data connect):** OAuth into GA4 / Meta / Search Console for the
  "real number" tier — the defensible, paid upsell.

## 9. Long game

The Value Creation engine isn't brand-only. The same pillar pattern extends to
the whole value chain — a **Business Strength Score** — and the aggregated,
anonymised dataset becomes Zib's industry benchmark content (white papers,
trend reports, case studies). Businesses using AI to *cut costs* score and
narrate differently from those using AI to *create value*; the read leans into
the latter.
