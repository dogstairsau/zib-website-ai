/**
 * Prefills the HubSpot Meetings iframe with the visitor's email if they've
 * just run an audit. The audit widget stashes the email in sessionStorage
 * under "zib_audit_lead" — we pull it here and add ?email=... to the iframe
 * URL before HubSpot's MeetingsEmbedCode.js boots. Result: HubSpot matches
 * the existing contact (created by /api/audit) so the partner sees the
 * full audit context attached to the booking.
 *
 * Load BEFORE the HubSpot embed script. No-op if no .meeting-embed on page.
 */
(() => {
  const container = document.querySelector('.meeting-embed .meetings-iframe-container');
  if (!container) return;
  try {
    const stored = JSON.parse(sessionStorage.getItem('zib_audit_lead') || '{}');
    if (!stored.email) return;
    const url = new URL(container.dataset.src);
    url.searchParams.set('email', stored.email);
    container.dataset.src = url.toString();
  } catch {}
})();
