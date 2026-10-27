(() => {
  const form = document.getElementById('upgrade-form');
  const button = document.getElementById('submit-application');
  const status = document.getElementById('form-status');
  const startedAt = Date.now();
  let sending = false;
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
    if (form.dataset.preview === 'true') { status.className = ''; status.textContent = 'Your fields are valid. This is a draft preview, so no application has been sent.'; status.focus(); return; }
    sending = true; button.disabled = true; status.className = ''; status.textContent = 'Sending your application…';
    try {
      const response = await fetch('/api/website-upgrade', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, startedAt, attribution: window.zibClickIds?.() || {}, referrer: document.referrer })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'We couldn’t send your application. Please try again.');
      status.className = 'success';
      status.textContent = 'Thanks for your interest. Our team will be in touch to discuss your website and confirm your eligibility.';
      form.querySelectorAll('input, textarea').forEach(input => { input.disabled = true; });
      button.textContent = 'Application received ✓';
      window.zibLead?.({ tool: 'Free Website Upgrade' });
      status.focus();
    } catch (error) {
      status.className = 'error'; status.textContent = error.message;
      button.disabled = false; sending = false;
    }
  });
})();
