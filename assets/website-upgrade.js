(() => {
  const form = document.getElementById('upgrade-form');
  const button = document.getElementById('submit-application');
  const status = document.getElementById('form-status');
  const startedAt = Date.now();
  const submissionId = crypto.randomUUID();
  let sending = false;
  // Direct Google Ads tracking for this application only. Do not mirror this
  // destination in GTM; when migrating, remove this block in the same release.
  const adsDestination = 'AW-762912823/zcg6CODO2a0dELfA5OsC';
  let marketingConsent = false;
  let adsConfigured = false;
  let applicationAccepted = false;
  let adsSent = false;
  try {
    const prefs = JSON.parse(localStorage.getItem('zib_consent_v1') || 'null');
    marketingConsent = prefs?.v === 1 && prefs.marketing === true;
  } catch {}
  const syncAds = () => {
    if (!marketingConsent || typeof window.gtag !== 'function') return;
    try {
      if (!adsConfigured) {
        window.gtag('config', 'AW-762912823', { send_page_view: false });
        adsConfigured = true;
      }
      if (applicationAccepted && !adsSent) {
        window.gtag('event', 'conversion', {
          send_to: adsDestination,
          transaction_id: submissionId,
        });
        adsSent = true;
      }
    } catch { /* Tracking must never turn an accepted enquiry into an error. */ }
  };
  document.addEventListener('zib:consent', event => {
    marketingConsent = event.detail?.v === 1 && event.detail.marketing === true;
    syncAds();
  });
  syncAds();
  document.querySelectorAll('[data-cta]').forEach(link => link.addEventListener('click', () => {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: 'website_upgrade_cta_click', placement: link.dataset.cta, campaign: 'free_website_upgrade' });
    window.gtag?.('event', 'website_upgrade_cta_click', { placement: link.dataset.cta, campaign: 'free_website_upgrade' });
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      const url = new URL(/^https?:\/\//i.test(data.website) ? data.website : 'https://' + data.website);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) throw new Error();
      data.website = url.href;
    } catch {
      status.className = 'error'; status.textContent = 'Please enter a valid website address, such as yourbusiness.com.au.';
      document.getElementById('website').focus(); return;
    }
    sending = true; button.disabled = true; status.className = ''; status.textContent = 'Sending your application…';
    try {
      const response = await fetch('/api/website-upgrade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, startedAt, submissionId, attribution: window.zibClickIds?.() || {} })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'We couldn’t send your application. Please try again.');
      status.className = 'success';
      status.textContent = 'Thanks for your interest. Our team will be in touch to discuss your website and confirm your eligibility.';
      form.querySelectorAll('input, textarea').forEach(input => { input.disabled = true; });
      button.textContent = 'Application received ✓';
      applicationAccepted = true;
      syncAds();
      try { window.zibLead?.({ tool: 'Free Website Upgrade' }); } catch {}
      status.focus();
    } catch (error) {
      status.className = 'error'; status.textContent = error.message;
      button.disabled = false; sending = false;
    }
  });
})();
