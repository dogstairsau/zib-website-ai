/**
 * Zib Digital — conversion tracking
 *
 * One place that says "a lead just happened", so the ad platforms can count it.
 *
 * WHY THIS EXISTS INSTEAD OF A THANK-YOU PAGE
 * The audit and the two ad labs capture the lead and then stream the result
 * into the same page — watching it build is the product. Redirecting to a
 * thank-you page after submit would throw that away, so there's no page load
 * for the Meta pixel to hang a conversion off. This fires the conversion at
 * the moment the lead is actually captured instead: the server has accepted
 * the submission and the details are on their way to HubSpot.
 *
 * WHAT IT FIRES (each is independent — a missing platform is skipped silently)
 *   1. Meta pixel   fbq('track', 'Lead', …)      — standard event, optimisable
 *   2. dataLayer    { event: 'zib_lead', … }     — for GTM (GA4, Google Ads)
 *   3. gtag         'generate_lead'              — GA4 tag that's on every page
 *   4. URL hash     #lead                        — for GTM's History Change
 *                                                  trigger, if URL-based
 *                                                  conversions are preferred
 *
 * WHY 'Lead' ALONE ISN'T ENOUGH
 * Every tool fires the same undifferentiated `Lead` at the moment an email is
 * captured, which is the cheapest action a visitor can take. Optimise an ad
 * set against it and Meta will faithfully find the people most willing to
 * trade an email for a free thing — which is exactly the lead quality problem
 * it was meant to solve. So the tools now qualify *before* the payoff and
 * report the outcome through the quality events below. `Lead` still fires for
 * everyone, unchanged, so the historical numbers stay comparable.
 *
 *   window.zibQualifiedLead()  → Meta 'QualifiedLead'  + zib_lead_qualified
 *   window.zibNurtureLead()    → Meta 'NurtureLead'    + zib_lead_nurture
 *   window.zibPackDelivered()  → Meta 'PackDelivered'  + zib_pack_delivered
 *   window.zibCallBooked()     → Meta 'CallBooked'     + zib_call_booked
 *
 * At current volumes (~25 leads/week) a qualified-only event is well under
 * Meta's 50-conversions-per-week learning threshold, so don't repoint the ad
 * sets at it on day one — it will starve them. Use it first for audience
 * building (exclude nurture, seed lookalikes from qualified) and let the
 * offline conversion import carry the optimisation. See
 * docs/offline-conversions.md.
 *
 * ⚠️ DOUBLE-COUNTING: this file fires every Meta event directly. Do NOT also
 * create GTM tags that fire Meta events off the matching dataLayer pushes —
 * that would count everything twice and corrupt campaign optimisation.
 * Use the dataLayer events in GTM for GA4 / Google Ads conversions only.
 *
 * USAGE (always guard the call — this file may not be loaded on every page):
 *   window.zibLead && window.zibLead({ tool: 'Website Audit', url, email });
 *
 * See docs/conversion-tracking.md for the GTM / Ads Manager side.
 */
(() => {
  // A tool can only convert once per page load. The labs retry on failure and
  // the audit can be re-run, but the person is the same lead either way.
  const fired = new Set();

  /**
   * The Meta pixel is loaded by GTM, which is async — on a fast submit, fbq
   * may not exist yet. Meta's own snippet installs a queueing stub the moment
   * it runs, so as soon as fbq appears the call is safe. Poll briefly, then
   * give up rather than leak a timer.
   */
  const whenFbqReady = (fn) => {
    if (window.fbq) { fn(window.fbq); return; }
    let waited = 0;
    const timer = setInterval(() => {
      waited += 250;
      if (window.fbq) { clearInterval(timer); fn(window.fbq); }
      else if (waited >= 10000) clearInterval(timer);
    }, 250);
  };

  /**
   * Shared id across the pixel and the dataLayer, so a server-side
   * Conversions API event can be deduplicated against this one later.
   */
  const newEventId = () =>
    'zib-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

  /**
   * Which page/placement produced it — partner pages and location pages all
   * embed the same audit widget, and this is how they're told apart.
   */
  const currentPlacement = () =>
    document.querySelector('meta[name="zib:source-tag"]')?.content || document.title;

  /**
   * Record a captured lead.
   *
   * @param {Object}  detail
   * @param {string}  detail.tool   Which tool captured it, e.g. "Meta Ads Lab".
   *                                Becomes the Meta content_name — keep the
   *                                values stable, campaigns get built on them.
   * @param {string} [detail.url]   The website the visitor entered, if any.
   * @param {string} [detail.email] Used only to de-duplicate; never sent.
   * @param {number} [detail.value] Estimated lead value, if the tool knows it.
   */
  window.zibLead = (detail = {}) => {
    const tool = detail.tool || 'Website';
    const key = tool + '|' + (detail.email || '');
    if (fired.has(key)) return;
    fired.add(key);

    const eventId = newEventId();
    const placement = currentPlacement();

    // 1 · Meta pixel
    whenFbqReady((fbq) => {
      try {
        fbq('track', 'Lead', {
          content_name: tool,
          content_category: 'Tool',
          ...(detail.value ? { value: detail.value, currency: 'AUD' } : {}),
        }, { eventID: eventId });
      } catch {}
    });

    // 2 · GTM dataLayer — GA4 and Google Ads conversions trigger off this
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: 'zib_lead',
        zib_tool: tool,
        zib_placement: placement,
        zib_event_id: eventId,
        ...(detail.url ? { zib_target_url: detail.url } : {}),
      });
    } catch {}

    // 3 · GA4 via the page's own gtag
    try {
      window.gtag && window.gtag('event', 'generate_lead', {
        method: tool,
        placement,
      });
    } catch {}

    // 4 · URL-based option. replaceState doesn't reload or scroll the page, but
    // it does fire GTM's History Change trigger and gives a distinct URL to
    // build a conversion on if that's easier to manage than a custom event.
    try {
      if (!location.hash.includes('lead')) {
        history.replaceState(history.state, '', location.pathname + location.search + '#lead');
      }
    } catch {}
  };

  /* ───────────────────────────────────────────────────────────────────────
     CLICK IDS — the prerequisite for offline conversion import

     Google's offline conversion import is keyed on the GCLID (or WBRAID /
     GBRAID on iOS app traffic); Meta's Conversions API matches on FBCLID plus
     hashed contact details. None of that was being captured, which is why
     HubSpot outcomes — SQL, closed-won, the things that actually say a lead
     was good — could never be fed back to either platform.

     Captured on the landing page load and persisted, because the visitor
     often lands on an ad page and converts on a different one. 90 days
     matches Google's import window. localStorage rather than a cookie so it
     survives without touching the consent-managed cookie surface, with an
     in-memory fallback for private browsing.
     ─────────────────────────────────────────────────────────────────────── */
  const CLICK_KEY = 'zib_click_ids';
  const CLICK_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const CLICK_PARAMS = ['gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid',
                        'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  let clickMemory = null;

  const readClickIds = () => {
    try {
      const raw = localStorage.getItem(CLICK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ts && Date.now() - parsed.ts < CLICK_TTL_MS) return parsed;
        localStorage.removeItem(CLICK_KEY);
      }
    } catch {}
    return clickMemory;
  };

  const captureClickIds = () => {
    let params;
    try { params = new URLSearchParams(location.search); } catch { return; }
    const found = {};
    CLICK_PARAMS.forEach((k) => {
      const v = params.get(k);
      if (v) found[k] = v.slice(0, 512);
    });
    // A visit with no ad parameters must not wipe the click id from the visit
    // that brought them in — someone can arrive on an ad, leave, and come back
    // organically before they convert.
    if (!Object.keys(found).length) return;
    const record = { ...found, ts: Date.now(), landing: location.pathname };
    clickMemory = record;
    try { localStorage.setItem(CLICK_KEY, JSON.stringify(record)); } catch {}
  };
  captureClickIds();

  /**
   * The stored ad click ids for this visitor, for sending to the server so
   * they land on the HubSpot contact.
   *
   * @returns {Object} click id map — empty if they never arrived via an ad.
   */
  window.zibClickIds = () => {
    const stored = readClickIds();
    if (!stored) return {};
    const { ts, landing, ...ids } = stored;
    return ids;
  };

  /* ───────────────────────────────────────────────────────────────────────
     QUALIFICATION — mirrored from lib/qualify.ts

     The page needs the tier immediately to decide what to show next (calendar
     vs. email follow-up), and waiting on a round-trip at that moment would put
     a spinner between someone and the thing they just asked for. So the rules
     live in both places and lib/qualify.test.ts asserts they agree.

     ⚠️ Change a number here and you must change it in lib/qualify.ts too.
     ─────────────────────────────────────────────────────────────────────── */
  const DEAL_SCORE = { 'lt500': 5, '500-2k': 35, '2k-10k': 70, '10k-50k': 90, 'gt50k': 100, 'unsure': 40 };
  const SPEND_SCORE = { 'none': 8, 'under-1k': 20, '1k-3k': 50, '3k-10k': 80, '10k-plus': 100 };
  const TIMELINE_SCORE = { 'asap': 100, '1-3-months': 70, 'later-this-year': 30, 'researching': 0 };
  const RUNNING_SCORE = { 'yes': 100, 'no': 40, 'unsure': 50 };
  const MARKETING_SCORE = { 'agency': 100, 'in-house': 70, 'myself': 30, 'no-one': 40 };

  const WEIGHTS = { dealValue: 0.32, spend: 0.32, timeline: 0.18, running: 0.09, marketing: 0.09 };
  const SCORES = {
    dealValue: DEAL_SCORE, spend: SPEND_SCORE, timeline: TIMELINE_SCORE,
    running: RUNNING_SCORE, marketing: MARKETING_SCORE,
  };

  /**
   * Score chip answers into a tier.
   *
   * Only answered dimensions count and the weights are renormalised across
   * them, so the audit's five questions and the labs' three land on the same
   * scale rather than the labs being punished for what they don't ask.
   *
   * @param   {Object}  answers  { dealValue, spend, timeline, running, marketing, goal }
   * @returns {{tier: string, score: number, salesReady: boolean}}
   */
  window.zibQualify = (answers = {}) => {
    let weighted = 0, totalWeight = 0;
    for (const key of Object.keys(WEIGHTS)) {
      const answer = answers[key];
      if (!answer) continue;
      const sub = SCORES[key][answer];
      if (sub === undefined) continue; // unrecognised value — ignore, don't guess
      weighted += sub * WEIGHTS[key];
      totalWeight += WEIGHTS[key];
    }
    const score = totalWeight
      ? Math.max(0, Math.min(100, Math.round(weighted / totalWeight)))
      : 0;

    // Mirrors lib/qualify.ts: three stated facts that beat the arithmetic.
    const noBudget = answers.spend === 'none' || answers.spend === 'under-1k';
    const researching = answers.timeline === 'researching';
    const tinyDeal = answers.dealValue === 'lt500';

    let tier;
    if (noBudget || researching || score < 38) tier = 'nurture';
    else if (score >= 62 && !tinyDeal) tier = 'qualified';
    else tier = 'review';

    return { tier, score, salesReady: tier !== 'nurture' };
  };

  /* ───────────────────────────────────────────────────────────────────────
     QUALITY EVENTS

     One shape for all of them: fire a Meta custom event directly, push a
     matching dataLayer event for GA4 / Google Ads, and never let a failure in
     one break the others or the page.
     ─────────────────────────────────────────────────────────────────────── */
  const track = (metaEvent, dlEvent, detail = {}) => {
    const tool = detail.tool || 'Website';
    const key = dlEvent + '|' + tool + '|' + (detail.email || '');
    if (fired.has(key)) return;
    fired.add(key);

    const eventId = newEventId();
    const placement = currentPlacement();
    const props = {
      content_name: tool,
      content_category: 'Tool',
      ...(detail.tier ? { lead_tier: detail.tier } : {}),
      ...(typeof detail.score === 'number' ? { lead_score: detail.score } : {}),
      // Meta can optimise for value once enough of these have banked. The
      // score doubles as a relative worth — a 70 really is worth more than a 45.
      ...(typeof detail.value === 'number' ? { value: detail.value, currency: 'AUD' } : {}),
    };

    whenFbqReady((fbq) => {
      try { fbq('trackCustom', metaEvent, props, { eventID: eventId }); } catch {}
    });

    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: dlEvent,
        zib_tool: tool,
        zib_placement: placement,
        zib_event_id: eventId,
        ...(detail.tier ? { zib_lead_tier: detail.tier } : {}),
        ...(typeof detail.score === 'number' ? { zib_lead_score: detail.score } : {}),
        ...(detail.url ? { zib_target_url: detail.url } : {}),
      });
    } catch {}
  };

  /**
   * A lead who answered the qualifying questions with real budget and intent.
   * This is the event worth building audiences and value rules on.
   *
   * @param {Object} detail  { tool, url, email, tier, score }
   */
  window.zibQualifiedLead = (detail = {}) =>
    track('QualifiedLead', 'zib_lead_qualified', { value: detail.score, ...detail });

  /**
   * A lead with no budget or no timeline. Fired so they can be *excluded* from
   * prospecting audiences and lookalike seeds — the point is to stop paying to
   * find more people like them, not to count them as a win.
   */
  window.zibNurtureLead = (detail = {}) => track('NurtureLead', 'zib_lead_nurture', detail);

  /**
   * The pack or audit actually finished and rendered. `zibLead` fires when the
   * server accepts the submission, which is a good conversion point but not
   * proof anyone received anything — a run that dies mid-stream still counts
   * as a Lead. This is the honest completion signal.
   */
  window.zibPackDelivered = (detail = {}) => track('PackDelivered', 'zib_pack_delivered', detail);

  /** Booked a call from a tool result — the strongest on-site signal there is. */
  window.zibCallBooked = (detail = {}) => track('CallBooked', 'zib_call_booked', detail);
})();
