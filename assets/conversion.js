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
 * ⚠️ DOUBLE-COUNTING: this file fires the Meta Lead event directly. Do NOT
 * also create a GTM tag that fires Meta "Lead" off the `zib_lead` dataLayer
 * event — that would count every lead twice and corrupt campaign optimisation.
 * Use `zib_lead` in GTM for GA4 / Google Ads conversions only.
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

    // Shared id across the pixel and the dataLayer, so a server-side
    // Conversions API event can be deduplicated against this one later.
    const eventId = 'zib-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

    // Which page/placement produced it — partner pages and location pages all
    // embed the same audit widget, and this is how they're told apart.
    const placement = document.querySelector('meta[name="zib:source-tag"]')?.content || document.title;

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
})();
