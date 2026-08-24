#!/usr/bin/env node
/**
 * Create the HubSpot contact properties the website tools write to.
 *
 * The same job as docs/hubspot-properties-brief.md, done through the API
 * instead of the UI. Roughly ten seconds rather than half an hour of
 * clicking, and it can't fat-finger an internal name — which is the one way
 * the manual route goes wrong, because HubSpot auto-generates the internal
 * name from the label and "GCLID" can land as `gclid_`.
 *
 * Idempotent: it reads what already exists first, creates only what's
 * missing, and reports anything present with a type that won't hold the
 * value the site sends. Safe to run again after a partial run.
 *
 *   HUBSPOT_PRIVATE_APP_TOKEN=pat-xxx node scripts/hubspot-properties.mjs
 *   node scripts/hubspot-properties.mjs --dry-run     # show the plan only
 *
 * The token needs `crm.schemas.contacts.write`, which is a different scope
 * from the `crm.objects.contacts.write` the site itself uses. If the private
 * app doesn't have it the call 403s and this says so — add the scope in
 * Settings → Integrations → Private Apps, or create the properties by hand.
 *
 * Nothing here touches forms. The private-app path writes these properties
 * to the contact directly, so the tools start storing them the moment this
 * finishes. Adding the same fields to the five forms (Part C of the brief)
 * only affects form-level analytics and can wait.
 */

import { readFileSync } from "node:fs";

const API = "https://api.hubapi.com/crm/v3/properties/contacts";
const GROUP = "contactinformation";
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * Everything the site writes. `type`/`fieldType` follow HubSpot's pairing
 * rules: string+text, number+number, enumeration+select.
 */
const PROPERTIES = [
  // Qualification — lib/qualify.ts
  { name: "lead_tier", label: "Lead tier", type: "string", fieldType: "text",
    description: "qualified / review / nurture, scored from the pre-payoff quiz. Deliberately text: the site writes exact lowercase values and a dropdown whose options differ by case would make HubSpot reject the whole contact." },
  { name: "lead_score", label: "Lead score", type: "number", fieldType: "number",
    description: "0-100 opportunity score, same scale as the /start pre-discovery qualifier." },
  { name: "customer_value", label: "Customer value", type: "string", fieldType: "text",
    description: "What a new customer is worth to the prospect. Heaviest weight in the qualification score." },

  // Ad click IDs — the prerequisite for offline conversion import.
  { name: "gclid", label: "GCLID", type: "string", fieldType: "text",
    description: "Google click ID. Required to upload offline conversions back to Google Ads — it cannot be backfilled once lost." },
  { name: "wbraid", label: "WBRAID", type: "string", fieldType: "text",
    description: "Google click ID for iOS web-to-app journeys." },
  { name: "gbraid", label: "GBRAID", type: "string", fieldType: "text",
    description: "Google click ID for iOS app-to-web journeys." },
  { name: "fbclid", label: "FBCLID", type: "string", fieldType: "text",
    description: "Meta click ID. Used for Conversions API matching." },
  { name: "msclkid", label: "MSCLKID", type: "string", fieldType: "text",
    description: "Microsoft Advertising click ID." },

  // Campaign attribution
  { name: "utm_source", label: "UTM source", type: "string", fieldType: "text" },
  { name: "utm_medium", label: "UTM medium", type: "string", fieldType: "text" },
  { name: "utm_campaign", label: "UTM campaign", type: "string", fieldType: "text" },
  { name: "utm_content", label: "UTM content", type: "string", fieldType: "text" },
  { name: "utm_term", label: "UTM term", type: "string", fieldType: "text" },

  // Set by the sales team, never by the site. This is the one that makes
  // "which ad source produces good leads" answerable at all.
  {
    name: "lead_outcome",
    label: "Lead outcome",
    type: "enumeration",
    fieldType: "select",
    description: "Set by the sales team after contact. The only way to measure which source produces real opportunities rather than form fills.",
    options: ["Qualified", "Booked", "Wrong fit", "No budget", "Unresponsive", "Won", "Lost"]
      .map((label, displayOrder) => ({ label, value: label, displayOrder, hidden: false })),
  },
];

function resolveToken() {
  const fromEnv = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (fromEnv) return fromEnv.trim();
  // Convenience: the repo's own .env.local, so this can be run the same way
  // as `npm run dev`.
  try {
    const line = readFileSync(".env.local", "utf8")
      .split("\n")
      .find((l) => l.startsWith("HUBSPOT_PRIVATE_APP_TOKEN="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "";
}

async function listExisting(token) {
  const res = await fetch(`${API}?archived=false`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 400) {
    throw new Error(
      `HubSpot rejected the token (${res.status}). Check it starts with "pat-" and was ` +
      "copied whole — Settings → Integrations → Private Apps → your app → Auth.",
    );
  }
  if (res.status === 403) {
    throw new Error(
      "HubSpot returned 403. The token is missing the `crm.schemas.contacts.write` scope, " +
      "which is a different scope from the `crm.objects.contacts.write` the site itself uses. " +
      "Add it under Settings → Integrations → Private Apps → your app → Scopes, or create " +
      "the properties by hand with docs/hubspot-properties-brief.md.",
    );
  }
  if (!res.ok) throw new Error(`Listing properties failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  return new Map((body.results || []).map((p) => [p.name, p]));
}

async function createProperty(token, prop) {
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...prop, groupName: GROUP, hasUniqueValue: false, hidden: false, formField: true }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const created = [], skipped = [], mismatched = [], failed = [];

const token = resolveToken();
if (!token && !DRY_RUN) {
  console.error(
    "No HUBSPOT_PRIVATE_APP_TOKEN found (checked the environment and .env.local).\n" +
    "Run:  HUBSPOT_PRIVATE_APP_TOKEN=pat-xxx node scripts/hubspot-properties.mjs\n" +
    "Or preview what it would do:  node scripts/hubspot-properties.mjs --dry-run",
  );
  process.exit(1);
}

if (DRY_RUN && !token) {
  console.log(`Would create ${PROPERTIES.length} contact properties in group "${GROUP}":\n`);
  for (const p of PROPERTIES) {
    console.log(`  ${p.name.padEnd(16)} ${p.label.padEnd(16)} ${p.type}/${p.fieldType}` +
      (p.options ? `  [${p.options.map((o) => o.label).join(", ")}]` : ""));
  }
  console.log("\n(no token — nothing was contacted)");
  process.exit(0);
}

let existing;
try {
  existing = await listExisting(token);
} catch (e) {
  console.error(`\n${e.message}\n`);
  process.exit(1);
}

for (const prop of PROPERTIES) {
  const found = existing.get(prop.name);
  if (found) {
    // A property that exists but can't hold what we send is worse than a
    // missing one: it looks configured and silently mangles values.
    if (found.type !== prop.type) {
      mismatched.push(`${prop.name}: exists as ${found.type}/${found.fieldType}, site sends ${prop.type}`);
    } else {
      skipped.push(prop.name);
    }
    continue;
  }
  if (DRY_RUN) { created.push(`${prop.name} (dry run)`); continue; }
  try {
    await createProperty(token, prop);
    created.push(prop.name);
  } catch (e) {
    failed.push(`${prop.name}: ${e.message}`);
  }
}

const section = (title, items) => {
  if (!items.length) return;
  console.log(`\n${title} (${items.length})`);
  items.forEach((i) => console.log(`  ${i}`));
};

console.log(DRY_RUN ? "\nDRY RUN — nothing was written" : "\nHubSpot contact properties");
section("Created", created);
section("Already existed, left alone", skipped);
section("⚠ Wrong type — fix by hand, the site's values will not store correctly", mismatched);
section("✗ Failed", failed);

if (!failed.length && !mismatched.length) {
  console.log(
    "\nAll set. The tools start storing tier, score and click IDs on the next lead —\n" +
    "no redeploy needed. Verify with a live run:\n" +
    "  /audit?gclid=TEST123 with a throwaway email, then open the contact.",
  );
}
process.exit(failed.length || mismatched.length ? 1 : 0);
