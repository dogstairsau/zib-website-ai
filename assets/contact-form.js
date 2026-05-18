/**
 * Shared contact form submit handler — used by partner pages.
 * Expects a <form id="contactForm"> with #contactSubmit + #contactStatus,
 * plus a hidden partnerName input so the success message reads
 * "Thanks. [Partner] will be in touch shortly." without hard-coding.
 *
 * If #contactForm is absent, the script is a no-op (safe to include on any page).
 */
(() => {
  const form = document.getElementById('contactForm');
  if (!form) return;
  const btn = document.getElementById('contactSubmit');
  const status = document.getElementById('contactStatus');
  if (!btn || !status) return;

  const partnerName = (form.querySelector('input[name="partnerName"]')?.value || 'the team').trim();
  const firstName = partnerName.split(/\s+/)[0] || 'the team';

  const setStatus = (msg, mode) => {
    status.className = 'contact-status mono' + (mode ? ' is-' + mode : '');
    status.innerHTML = mode === 'loading'
      ? `<span class="spinner" aria-hidden="true"></span>${msg}`
      : msg;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    btn.disabled = true;
    setStatus('Sending…', 'loading');
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setStatus(`Thanks. ${firstName} will be in touch shortly.`, 'success');
      form.reset();
    } catch (err) {
      setStatus(err.message || `Submission failed. Please call ${firstName} directly.`, 'error');
    } finally {
      btn.disabled = false;
    }
  });
})();
