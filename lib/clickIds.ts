/**
 * Ad click ids, flattened for the HubSpot Forms API.
 *
 * The browser captures gclid / fbclid / utm_* on the landing page (see
 * assets/conversion.js) and posts them as a nested object. HubSpot forms take
 * a flat field list, and will reject a submission outright over a field the
 * form doesn't carry — so this allow-lists the keys we document as properties
 * and drops anything else. An unexpected query parameter should never become
 * a write to an arbitrary HubSpot field.
 *
 * See docs/offline-conversions.md for what these are for.
 */

const ALLOWED = new Set([
  "gclid", "wbraid", "gbraid", "fbclid", "msclkid",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

export function clickIdFields(clickIds?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(clickIds || {})) {
    if (!ALLOWED.has(k)) continue;
    const value = String(v ?? "").trim();
    if (value) out[k] = value.slice(0, 512);
  }
  return out;
}
