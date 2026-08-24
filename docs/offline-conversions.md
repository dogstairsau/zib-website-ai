# Offline conversions — feeding real outcomes back to the ad platforms

The single highest-leverage change available on the current ad budget, and the
one that doesn't depend on volume.

## The problem it solves

Meta and Google can only optimise toward what you tell them happened. Today
the only thing they're told is "someone submitted an email" — the cheapest
action a visitor can take. So they find people who submit emails. Three weeks
of spend produced 76 leads at A$17.57 blended CPL, and the tool with the
*lowest* CPL returned the largest share of unqualified contacts, because the
lowest CPL is what you get when you optimise for the lowest-effort action.

The quality events in `docs/conversion-tracking.md` fix half of this: the
platforms now hear the difference between a qualified lead and a nurture one.
But that's still a judgement made at the moment of capture, from four chip
answers.

What actually settles whether a lead was good is what happens afterwards —
did they answer the phone, did they become an SQL, did they sign. That lives
in HubSpot. Getting it back to Meta and Google is what this document covers.

**Why it matters more than the pixel event at this budget:** an offline
conversion import trains on outcomes that have already been judged by a human,
and it works with dozens of events rather than the hundreds a pixel-side
optimisation needs to exit learning.

## Prerequisite: the click IDs (done)

Google's offline import is keyed on the **GCLID** (or WBRAID / GBRAID for iOS
app traffic). Meta's Conversions API matches on **FBCLID** plus hashed contact
details. Neither was being captured, which is why no outcome could be sent
back even in principle.

`assets/conversion.js` now captures them on the landing page load and persists
them for 90 days (`localStorage`, key `zib_click_ids`), because someone often
lands on an ad page and converts on a different one, or leaves and comes back.
`window.zibClickIds()` returns them, and every tool sends them with the lead.

Captured: `gclid`, `wbraid`, `gbraid`, `fbclid`, `msclkid`, and the five
`utm_*` parameters.

## HubSpot properties to create

Contact properties, all **single-line text** except where noted. Until they
exist, submissions carrying them are retried without them (see
`lib/hubspot.ts` and `lib/hubspotForms.ts`) — so nothing breaks in the
meantime, the data just isn't stored.

| Label | Internal name | Type |
|---|---|---|
| Lead tier | `lead_tier` | Single-line text |
| Lead score | `lead_score` | Number |
| GCLID | `gclid` | Single-line text |
| WBRAID | `wbraid` | Single-line text |
| GBRAID | `gbraid` | Single-line text |
| FBCLID | `fbclid` | Single-line text |
| MSCLKID | `msclkid` | Single-line text |
| UTM source | `utm_source` | Single-line text |
| UTM medium | `utm_medium` | Single-line text |
| UTM campaign | `utm_campaign` | Single-line text |
| UTM content | `utm_content` | Single-line text |
| UTM term | `utm_term` | Single-line text |

Add the same fields to each of the five forms in `docs/hubspot-forms-build.md`
so the Forms path stores them too. Until you do, the private-app path still
writes them to the contact.

## The disposition field — do this first

None of this works without someone recording the outcome. Add one **required**
contact property that the sales team sets on every ad lead:

| Label | Internal name | Type | Options |
|---|---|---|---|
| Lead outcome | `lead_outcome` | Dropdown | Qualified · Booked · Wrong fit · No budget · Unresponsive · Won · Lost |

This is also the only way to answer the question that started all of this —
*which source actually produces good leads*. Right now "a large percentage are
unqualified" isn't a number, and the three tools can't be compared on anything
except CPL. Give it four weeks before making cuts.

**Expect the ranking to change.** Google Ads Lab looks worst on CPL (A$30.17
vs A$14.30) but search intent qualifies in a way interruption doesn't, so it
may well be the cheapest source of *SQLs*. Don't cut it on CPL alone.

## Google Ads — offline conversion import

1. **Tools → Conversions → New conversion action → Import → Other data
   sources → Track conversions from clicks.**
2. Create two actions: `Zib — SQL` and `Zib — Closed won`. Set a realistic
   value on closed-won; leave SQL at a nominal value or use `lead_score`.
3. Set the conversion window to **90 days** to match the stored click ID.
4. Upload from HubSpot on a schedule — either the native HubSpot ↔ Google Ads
   integration, or a scheduled export of `gclid`, conversion name, time and
   value. Weekly is enough.
5. Once ~30 conversions have landed, switch the campaigns to **Maximise
   conversions** targeting those actions rather than the form-fill.

Only rows with a `gclid` can be uploaded — leads from before this change have
none, so the useful history starts now.

## Meta — Conversions API / offline events

1. **Events Manager → Data sources → the pixel (1417344755743451) → Settings →
   Conversions API.** Generate an access token.
2. Send `QualifiedLead`, and then the HubSpot outcomes as custom events
   (`SQL`, `ClosedWon`) with hashed email and the stored `fbclid`.
3. `assets/conversion.js` already mints an `eventID` and passes it to the
   pixel, so a server-side event sent with the same id **deduplicates
   correctly**. Use it — otherwise everything counts twice.
4. Build the audiences that pay off immediately, whatever the volume:
   - **Exclude** everyone who fired `NurtureLead` from prospecting.
   - **Lookalike seed** from `ClosedWon` first, `QualifiedLead` second.

## What "done" looks like

- Every ad lead in HubSpot carries a tier, a score, and a click ID.
- Every ad lead gets a `lead_outcome` set by a human within a week.
- Both platforms receive SQL and closed-won events weekly.
- CPL goes **up**. Cost per SQL is the number that matters, and it should fall.

That last point is worth saying plainly before anyone panics at the dashboard:
this change is supposed to make the headline CPL look worse.
