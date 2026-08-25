# Autopilot — capability boundary spec

The operating rules for the Autopilot agent: what it may do on a client
account without asking, what it must stop and escalate, and what it may never
do at all.

This is the document everything else falls out of. The build scopes to it, the
contract references it, the escalation roster works from it, and the client
gets a plain-English version of it before they sign. **If an action isn't in
the registry below, the agent may not take it.** Default deny, not default
allow.

Audience: whoever is building the agent, whoever is on escalation duty, and
whoever writes the client agreement.

---

## 1. The three invariants

Everything here serves one of three rules. If a proposed change to this spec
breaks one of them, the answer is no.

**1. We never touch client money.**
Client owns the Google Ads and Meta accounts. Client's card sits on their own
billing. Zib holds access only. We are never a billing contact, never a
payment method, and never on consolidated invoicing — including "temporarily,
just to get them live". If Google or Meta would invoice Zib for a client's
spend, the setup is wrong.

**2. Nothing goes live asserting something we haven't verified.**
The agent may write copy freely. It may not invent facts. Every factual claim
in live copy traces back to a line in that client's claims register, and the
agent cannot write to the register.

**3. Escalation is invisible to the client.**
A human reviews; the answer returns through the agent. The client is never
handed off, never asked to take a call, never told "let me check with the
team". They experience a slower reply, not a different interlocutor.

---

## 2. Tiers

| Tier | Name | Meaning |
|---|---|---|
| **A** | Autonomous | Agent acts immediately. Logged, not reviewed. |
| **B** | Bounded | Agent acts immediately **within numeric limits set at onboarding**. Outside the limit it becomes tier C. |
| **C** | Gated | Agent prepares the change, does not apply it, and escalates to a human reviewer. |
| **D** | Prohibited | Never on Autopilot, regardless of who approves. Requires moving the client to Managed AI. |

Tier B is where most of the risk lives. A bounded action that silently
degrades into an unbounded one is the failure mode to design against — every
tier B action needs its limit checked at execution time, not at planning time.

---

## 3. Action registry

### Budget and spend

| Action | Tier | Bound |
|---|---|---|
| Pause / resume a campaign or ad set | A | — |
| Reallocate budget between campaigns in one channel | B | Within the channel's agreed monthly total |
| Reallocate budget between channels | B | ±25% of each channel's agreed split, per month |
| Adjust daily budgets for pacing | B | Cumulative monthly spend ≤ client ceiling |
| Increase total monthly spend | C | Any increase above the ceiling |
| Change billing details, payment method, invoicing | D | Never — invariant 1 |

The **ceiling** is a hard monthly number set at onboarding. It is checked
before every write that could increase spend, and the agent halts the moment
projected month-end spend crosses it. Pacing anomalies (projected overspend,
or spend >2× the daily average) break the escalation batch and page a human
within the hour.

### Bidding and targeting

| Action | Tier | Bound |
|---|---|---|
| Adjust bid strategy, target CPA / ROAS | B | Toward the client's stated commercial goal, within ±30% of the agreed target |
| Add negative keywords | A | — |
| Add / remove keywords, adjust match types | A | — |
| Adjust audiences, placements, geo within serviced area | A | — |
| Expand geo beyond the client's stated service area | C | — |
| Bid on a competitor's brand name | D | Legal and platform-policy exposure. Managed AI only. |

### Creative and copy

| Action | Tier | Bound |
|---|---|---|
| Write and ship ad copy using only registered claims | A | Must pass the copy check (§5) |
| Rotate, pause or scale existing creative | A | — |
| Generate new creative concepts and angles | A | Must pass the copy check |
| Ship copy asserting a claim **not** in the register | C | Held pending verification |
| Superlatives, guarantees, comparative or pricing claims | C | Blocked by default even if a similar claim is registered |
| Add a new claim to the claims register | D | Humans only. The agent may *propose*, never *write*. |

### Site, content and SEO

| Action | Tier | Bound |
|---|---|---|
| Publish content and service pages | A | Copy check applies |
| Technical SEO fixes, schema, internal linking | A | — |
| Build or rebuild a landing page | B | Within the plan's monthly/quarterly allowance |
| Any change to a page outside the agreed Autopilot scope | C | — |
| Structural changes to the client's primary site nav or CMS templates | C | — |

### Commercial and relationship

| Action | Tier | Bound |
|---|---|---|
| Answer questions about performance, decisions, spend | A | — |
| Recommend a plan change | A | Recommend only; billing changes are tier C |
| Change what the client is billed | C | — |
| Agree a scope change or a new deliverable | C | — |
| Make any representation about future results | D | Invariant 2 and ACL s4. Never, in any channel, including chat. |

### Regulated and excluded

| Category | Tier |
|---|---|
| Health, medical, therapeutic claims | D |
| Financial products, credit, investment returns | D |
| Legal services outcomes | D |
| Anything requiring a licence number to advertise, where we can't verify the licence | D |

Clients whose core offer sits in a tier D category don't belong on Autopilot.
That's a qualification gate at onboarding, not a runtime check.

---

## 4. The dial sheet

Every tier B bound is a number captured at onboarding. No client goes live
with a blank. These are the only inputs that make the boundary real:

| Dial | Example | Used by |
|---|---|---|
| Monthly spend ceiling | $2,500 | All budget actions |
| Channel split | Google 60 / Meta 40 | Cross-channel reallocation |
| Target cost per acquisition | $85 | Bid strategy bounds |
| What a customer is worth | $1,400 first order | Sanity-checking the CPA target |
| Service area | Melbourne metro + Geelong | Geo expansion gate |
| Change requests included | 25/month | Overflow handling |
| Landing page allowance | 1/quarter | Tier B site work |
| Pre-authorised exceptions | free text, signed | Removes specific escalations |

**Pre-authorisations are the highest-leverage part of onboarding.** Every one
captured is an escalation that never happens for the life of the account. The
session should be run to harvest them deliberately: "if the agent wanted to do
X, would you want to be asked?"

---

## 5. Claims register and the copy check

### Register

One per client. Created at onboarding, appended to only by a human, with
evidence recorded against every line.

| Field | Notes |
|---|---|
| `claim` | The exact assertion, as it may appear in copy |
| `evidence` | What was sighted — certificate, roster, screenshot, invoice |
| `verified_by` | Human who signed it off |
| `verified_at` | Date |
| `expires_at` | For anything time-bound (awards, review counts, "since 2009") |

An expired claim is treated as unregistered. Review counts and award claims
should always carry an expiry.

### Check pipeline

Runs on every piece of copy before it can go live. Cheapest layer first, and
**any layer can block**.

1. **Deterministic pass.** Blocklist and patterns — superlatives (`#1`,
   `best`, `cheapest`, `fastest`, `leading`), absolutes (`always`, `never`,
   `100%`, `risk-free`), guarantees, pricing promises, competitor names. No
   model call. Catches most of it.
2. **Register check.** Model compares the copy against that client's register
   and returns any assertion not covered. This is set membership against a
   known list, not open-ended truth judgement — the register is what makes it
   tractable.
3. **Platform policy pass.** Separate rulebook: Google trademark rules in ad
   text, Meta personal-attributes and before/after rules, category
   restrictions. Platform review is a useful second net but must not be relied
   on — repeated disapprovals risk account suspension.

Anything flagged goes to tier C escalation with the offending span
highlighted and, where possible, a compliant rewrite attached for the reviewer
to approve in one click.

---

## 6. Escalation

### Routing

| Urgency | Trigger | Path |
|---|---|---|
| **Break-glass** | Spend anomaly, account suspension, platform policy strike, tracking down | Pages the on-duty strategist immediately. Never batched. |
| **Same-day** | New claim verification, blocked copy | Batched, cleared twice daily |
| **Next-day** | Scope, strategy, billing changes | Batched, cleared once daily |

### Batching

The cost of an escalation is the context switch, not the review. Non-urgent
items accumulate and release on a schedule so one reviewer clears many
accounts in a sitting. Target at steady state is **20–40 minutes per client
per month**; anything consistently above that is a signal the client's
register or dials are underspecified, or that they belong on Managed AI.

### What the client sees

The agent replies immediately, always. It states what it has already done,
what it is holding, why, and when it will have an answer — against the
published response times. It never says "I'll get back to you" with no
timeframe, and it never says "I need to check with the team".

---

## 7. Logging

Every action, blocked or applied, writes a log line: timestamp, action, tier,
the bound it was checked against, the reason, and the reviewer if escalated.

This is not diagnostics. It does three jobs:

- **Client-facing evidence.** It's the answer to "what did I get this month",
  and it's the reason they don't cancel in month five.
- **Due-care record.** Under ACL, the demonstrable exercise of care and skill.
  The register plus the log is the file we'd want if the ACCC ever asked.
- **Boundary tuning.** Escalation rates by category tell us which bounds are
  set wrong.

Retention: life of the account plus seven years.

---

## 8. Kill switches

| Switch | Effect | Who |
|---|---|---|
| Client pause | All spend paused, state preserved, billing stops | Client, via agent, immediately |
| Account freeze | Agent read-only on one account | Any Zib strategist |
| Global freeze | Agent read-only across all accounts | On-call, no approval needed |

Global freeze must be reachable in under a minute by whoever is on duty, and
it must not require the agent to be functioning. Test it quarterly.

---

## 9. Go-live checklist

An account may not go live until all of these are true. No exceptions for
someone keen to start.

- [ ] Conversion tracking verified end to end, with a real test conversion
- [ ] What a customer is worth, agreed and recorded
- [ ] Monthly spend ceiling set
- [ ] Channel split and target CPA set
- [ ] Claims register populated, every line with evidence
- [ ] Service area recorded
- [ ] Pre-authorisations captured and signed
- [ ] Client owns the ad accounts; Zib access verified as access-only
- [ ] Client's payment method confirmed on their own billing
- [ ] Not in a tier D category
- [ ] Ad spend clears the plan minimum
- [ ] Client has the plain-English rules summary

Item 1 is the one that will get skipped under commercial pressure. An agent
optimising against broken tracking will confidently drive cost-per-junk-lead
down and churn the client in month four. It is the single highest-value gate
on the list.

---

## 10. Open decisions

Not settled yet — flagging rather than assuming.

1. **Overflow pricing.** Change requests beyond plan: queue to next month, or
   quote? Queueing is simpler and friendlier; quoting protects margin. Current
   page copy says the client chooses.
2. **Chat rate limiting.** Conversation is deliberately unmetered. If token
   cost per account turns out to be material, the lever should be response
   depth, not access.
3. **Tier B drift.** Should repeated bound-adjacent behaviour (an agent
   sitting at 95% of ceiling every month) itself trigger review?
4. **Register portability.** A client leaving takes their accounts and
   content. Do they take the claims register? Probably yes, and it's a good
   retention story either way.
5. **Reviewer qualification.** Who is allowed to approve a new claim? Suggest
   it needs to be someone who can be held to having sighted the evidence.
