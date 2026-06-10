/**
 * SEO migration generator.
 *
 * Emits location pages, case studies, a case-studies hub, and blog posts from
 * the old WordPress site into the new static shell. SEO metadata (title, meta
 * description, H1, H2) is sourced from the Screaming Frog exports where the URL
 * was crawled, falling back to the WP Yoast fields / post title. Body copy is
 * the ported (rough) text from migration/content/*.txt — refine per page later.
 *
 * Priorities: exact titles/metas/H1/H2 + dense internal linking. Copy is rough.
 *
 * Usage: node migration/generate.mjs <path-to-wordpress-export.xml>
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT, esc, decodeEntities, loadSf, loadWp, loadCopy } from "./lib.mjs";

const OLD = "https://zibdigital.com.au";

// ───────────────────────── internal-link maps ─────────────────────────
const HUBS = {
  seo:    { label: "SEO",                 href: "/seo-agency" },
  ppc:    { label: "Google Ads",          href: "/google-ads" },
  social: { label: "Social media",        href: "/social-media-marketing" },
  web:    { label: "Web & design",        href: "/web-graphic-design-melbourne" },
  content:{ label: "Content marketing",    href: "/content-marketing-agency-melbourne" },
};
// Core service hubs used for cross-linking rows on every location page.
const CORE = ["seo", "ppc", "social", "web"];
const DM_CITY = {
  "Melbourne": "/digital-marketing-agency-melbourne", "Sydney": "/digital-marketing-agency-sydney",
  "Brisbane": "/digital-marketing-agency-brisbane", "Adelaide": "/digital-marketing-adelaide",
  "Gold Coast": "/digital-marketing-agency-gold-coast", "Geelong": "/digital-marketing-geelong",
  "Canberra": "/digital-marketing-agency-canberra",
};

// ───────────────────────── page configs ─────────────────────────
const LOCATIONS = [
  { service: "seo", city: "Sydney", slug: "seo-sydney" },
  { service: "seo", city: "Brisbane", slug: "seo-brisbane" },
  { service: "seo", city: "Adelaide", slug: "seo-adelaide" },
  { service: "seo", city: "Canberra", slug: "seo-canberra" },
  { service: "seo", city: "Geelong", slug: "seo-geelong" },
  { service: "seo", city: "Gold Coast", slug: "seo-gold-coast" },
  { service: "social", city: "Melbourne", slug: "social-media-marketing-agency-melbourne" },
  { service: "social", city: "Sydney", slug: "social-media-marketing-agency-sydney" },
  { service: "social", city: "Brisbane", slug: "social-media-marketing-agency-brisbane" },
  { service: "social", city: "Adelaide", slug: "social-media-marketing-agency-adelaide" },
  { service: "social", city: "Canberra", slug: "social-media-marketing-agency-canberra" },
  { service: "social", city: "Gold Coast", slug: "social-media-marketing-agency-gold-coast" },
  { service: "web", city: "Melbourne", slug: "web-graphic-design-melbourne" },
  { service: "web", city: "Adelaide", slug: "web-graphic-design-adelaide" },
  { service: "ppc", city: "Melbourne", slug: "google-ads-management-agency-melbourne" },
  { service: "content", city: "Melbourne", slug: "content-marketing-agency-melbourne" },
];
// SEO Melbourne already exists (hand-built); include in sibling link sets only.
const SIBLINGS = {
  seo: [["Melbourne", "/seo-melbourne"], ...LOCATIONS.filter((l) => l.service === "seo").map((l) => [l.city, "/" + l.slug])],
  social: LOCATIONS.filter((l) => l.service === "social").map((l) => [l.city, "/" + l.slug]),
  web: LOCATIONS.filter((l) => l.service === "web").map((l) => [l.city, "/" + l.slug]),
  ppc: [["Melbourne", "/google-ads-management-agency-melbourne"]],
  content: [["Melbourne", "/content-marketing-agency-melbourne"]],
};

// Standalone service / vertical pages that rank on the old site but were missing
// from the first migration (not in the Screaming Frog crawl). Ported from WP.
const SERVICE_PAGES = [
  { slug: "linkedin-marketing-agency-melbourne", label: "LinkedIn marketing", city: "Melbourne", hub: "social" },
  { slug: "email-marketing", label: "Email marketing", city: null, hub: "social" },
  { slug: "facebook-marketing-melbourne", label: "Facebook marketing", city: "Melbourne", hub: "social" },
  { slug: "instagram-marketing-melbourne", label: "Instagram marketing", city: "Melbourne", hub: "social" },
  { slug: "shopify-seo", label: "Shopify SEO", city: null, hub: "seo" },
  { slug: "google-shopping-agency-melbourne", label: "Google Shopping", city: "Melbourne", hub: "ppc" },
  { slug: "ecommerce-seo-melbourne", label: "eCommerce SEO", city: "Melbourne", hub: "seo" },
  { slug: "shopify-developer-melbourne", label: "Shopify development", city: "Melbourne", hub: "web" },
  { slug: "woocommerce-seo", label: "WooCommerce SEO", city: null, hub: "seo" },
  { slug: "real-estate-digital-marketing", label: "Real estate digital marketing", city: null, hub: "seo" },
];

const CASE_STUDIES = [
  { slug: "amazing-graze", services: ["seo", "social"] },
  { slug: "assured-roofing", services: ["seo", "ppc"] },
  { slug: "liberty-financial", services: ["ppc"] },
  { slug: "ncc", services: ["social", "ppc"] },
  { slug: "port-melbourne-containers", services: ["web", "seo"] },
  { slug: "procut", services: ["seo", "ppc"] },
  { slug: "puma", services: ["social"] },
  { slug: "the-fruit-box-group", services: ["seo", "ppc"] },
  { slug: "twelve-board-store", services: ["ppc", "social"] },
  { slug: "wicked-sista", services: ["social", "ppc"] },
];

// Keyword-variant sentence woven into each page so it covers the synonyms it
// already ranks for (optimisation, AdWords, consultants, management, packages…).
const SYNONYMS = {
  seo: (c) => `Whether you're after SEO consultants, search engine optimisation packages, or simply the best SEO company ${c ? "in " + c : "in Australia"}, that's exactly what we do.`,
  social: (c) => `From social media management to paid social advertising and content, we run the full social stack ${c ? "for " + c + " businesses" : "across Australia"}.`,
  ppc: (c) => `Google Ads (formerly AdWords) and PPC management, structured around the searches that convert${c ? " in " + c : ""}.`,
  web: (c) => `Website design, web development and responsive, conversion-first builds${c ? " for " + c : " across Australia"}.`,
  content: () => "",
};

// Brand-voice lead copy per service, anchored to "Human first. Commercially
// driven. AI enhanced." Used to re-voice the hero + proof intro of generated pages.
const PITCH = {
  seo:     { metric: "rankings, traffic and revenue", h2: `Rankings that compound. <em>Revenue that follows.</em>`, sub: (c) => `We treat ${c ? c + " " : ""}SEO as a commercial channel, not a vanity one. Technical foundations, content that earns its place, and authority built to last, all measured against leads and revenue.` },
  ppc:     { metric: "leads, CPA and ROAS", h2: `Spend that's accountable. <em>To the dollar.</em>`, sub: (c) => `Google Ads built around buying intent, optimised daily by our agent stack and reviewed weekly by a senior human. Reported in ${c ? c + " " : ""}leads, CPA and ROAS.` },
  social:  { metric: "reach, leads and ROAS", h2: `Social that sells. <em>Not just posts.</em>`, sub: (c) => `Paid and organic social engineered for pipeline. We scale what converts and kill what doesn't, and report in ${c ? c + " " : ""}leads and ROAS, not likes.` },
  web:     { metric: "conversion and revenue", h2: `Sites that rank. <em>And convert.</em>`, sub: (c) => `Conversion-first web and design for ${c || "Australian"} businesses. Built to be found, built to sell, measured against the number that matters.` },
  content: { metric: "rankings and pipeline", h2: `Content with a commercial job. <em>Done.</em>`, sub: (c) => `Content and copy that earns rankings and moves buyers, planned around ${c ? c + " " : ""}search demand and your pipeline.` },
};
const pitchFor = (k) => PITCH[k] || PITCH.seo;

// Scannable coverage points per service — replaces the rough ported "slab" copy.
const POINTS = (city) => ({
  seo: [
    ["Technical SEO & site audits", "Crawlability, speed, structure and Core Web Vitals, fixed at the foundation."],
    ["Content that ranks and converts", "Original, search-led content mapped to real buyer intent."],
    ["Authority & link building", `Quality backlinks that move competitive ${city} keywords.`],
    ["Local SEO", `Google Business Profile, local packs and suburb-level visibility across ${city}.`],
    ["Transparent reporting", "Monthly reviews in rankings, traffic and revenue, not vanity metrics."],
  ],
  social: [
    ["Content & creative", "Scroll-stopping monthly creative built for your brand, voice and channels."],
    ["Paid social", "Meta, Instagram and TikTok ads engineered for leads and ROAS, not vanity reach."],
    ["Community management", "We engage your audience and manage conversations, positive and negative."],
    ["Social strategy", "A clear channel-by-channel plan tied to commercial goals, refreshed monthly."],
    ["Transparent reporting", "Monthly reviews in leads, engagement and ROAS you can act on."],
  ],
  ppc: [
    ["Campaign architecture", "Account structure built around buying intent and your margins."],
    ["Daily optimisation", "Bids, budgets and creative tuned daily by our agent stack, reviewed weekly by a human."],
    ["Google Ads & Performance Max", "Search, PMax, Shopping and remarketing (formerly AdWords), run end to end."],
    ["Conversion tracking", "Proper tracking and landing-page advice so spend becomes leads, not just clicks."],
    ["Transparent reporting", "Monthly reviews in leads, CPA and ROAS, not impressions."],
  ],
  web: [
    ["Conversion-first design", "Sites designed to convert, mapped to how buyers actually decide."],
    ["Built to be found", "SEO-ready builds with clean structure, speed and Core Web Vitals from day one."],
    ["Brand & UX", "Cohesive brand, messaging and UX that reflects the business you're running."],
    ["Development", "Responsive, standards-compliant builds across Shopify, WordPress, Webflow and custom."],
    ["Measured", "Analytics and conversion tracking so the site is accountable to a number."],
  ],
  content: [
    ["Search-led content", "Content planned around real search demand and buyer questions."],
    ["Editorial & copy", "Original articles and copy, AI-augmented, always human-edited."],
    ["Authority building", "Content engineered to earn rankings, links and citations."],
    ["Content strategy", "A roadmap tied to pipeline, not a calendar for its own sake."],
    ["Reporting", "Tracked against rankings, traffic and leads."],
  ],
});
const pointsList = (service, city) => {
  const pts = POINTS(city)[service];
  if (!pts) return null;
  return `    <ul class="seo-points reveal">\n${pts.map(([l, d]) => `      <li><strong>${esc(l)}.</strong> ${esc(d)}</li>`).join("\n")}\n    </ul>`;
};

// One-line cross-link descriptions (better than "Pair X with Y…").
const HUB_DESC = {
  seo: "Rank for the commercial terms your buyers actually search. Technical, content and authority work tied to pipeline, not vanity positions.",
  ppc: "Premier Partner Google Ads built around your cost per acquisition. Optimised daily, reported in ROAS, never set and forget.",
  social: "Paid and organic social that builds the brand and scales what already converts. Creative, targeting and spend run as one system.",
  web: "Conversion-first websites and design engineered to turn the traffic you earn into revenue, on Shopify, WordPress or a custom build.",
  content: "Search-led content that earns rankings, citations and buyer trust, mapped to real intent rather than keyword counts.",
};

// H1 with an orange <em> accent (on the city if present, else the last word).
function emH1(h1, city) {
  const e = esc(decodeEntities(h1));
  if (city && e.includes(esc(city))) return e.replace(esc(city), `<em>${esc(city)}</em>`);
  const parts = e.trim().split(/\s+/);
  return parts.length > 1 ? `${parts.slice(0, -1).join(" ")} <em>${parts[parts.length - 1]}</em>` : e;
}

// ───────────────────────── shared fragments ─────────────────────────
const HEAD = (title, desc, extraCss = "") => {
  const links = (Array.isArray(extraCss) ? extraCss : [extraCss]).filter(Boolean)
    .map((h) => `<link rel="stylesheet" href="${h}">`).join("\n");
  return `<!doctype html>
<html lang="en-AU">
<head>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<!-- @include _partials/head.html -->${links ? `\n${links}` : ""}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<!-- @include _partials/nav.html -->
<main id="main">`;
};

const FOOT = `</main>
<!-- @include _partials/footer.html -->
<!-- @include _partials/scripts.html -->
</body>
</html>
`;

const FAQ_JS = `<script>
(() => { const l = document.getElementById('faqList'); if (!l) return;
  l.addEventListener('click', (e) => { const b = e.target.closest('.faq-q'); if (!b) return;
    const i = b.parentElement; const o = i.classList.toggle('open'); b.setAttribute('aria-expanded', o ? 'true':'false'); }); })();
</script>`;

const para = (lines) => lines.map((l) => `      <p>${esc(decodeEntities(l))}</p>`).join("\n");

// ───────────────────────── LOCATION template ─────────────────────────
function locationPage({ slug, service, city, sf, wp, copy }) {
  const hub = HUBS[service];
  const isSeo = service === "seo";
  const title = sf.title || wp?.seoTitle || `${hub.label} ${city} | Zib Digital`;
  const desc = sf.metadesc || wp?.metadesc || `${hub.label} services in ${city} from Zib Digital, Australia's digital marketing agency since 2009.`;
  const h1 = sf.h1 || `${hub.label} ${city}`;
  const h2a = sf.h2_1 || `Our approach to ${hub.label} in ${city}`;
  const h2b = sf.h2_2 || `Why ${city} businesses choose Zib`;
  const body = copy.slice(1, 4);
  const syn = SYNONYMS[service]?.(city);
  const h1html = emH1(h1, city);

  // internal links: every other service hub + this city's digital-marketing page
  const serviceRows = CORE
    .map((k, i) => { const h = HUBS[k]; return `      <a class="service-row" href="${h.href}">
        <span class="service-num mono">0${i + 1}</span>
        <span class="service-name">${h.label}</span>
        <span class="service-desc">${k === service ? `Our core ${h.label} practice for ${city}, the discipline this page is built around and the same senior team behind it.` : HUB_DESC[k]}</span>
        <span class="service-arrow">→</span>
      </a>`; }).join("\n") +
    `\n      <a class="service-row" href="${DM_CITY[city] || "/"}">
        <span class="service-num mono">05</span>
        <span class="service-name">Full digital marketing · ${city}</span>
        <span class="service-desc">Every channel that matters for ${city}, planned and run as one commercial system rather than disconnected retainers.</span>
        <span class="service-arrow">→</span>
      </a>`;

  const locLinks = SIBLINGS[service].filter(([c]) => c !== city)
    .map(([c, href]) => `        <a class="loc-link" href="${href}">${hub.label} ${c} <span aria-hidden="true">→</span></a>`).join("\n");

  const ld = { "@context": "https://schema.org", "@type": "Service", serviceType: `${hub.label} ${city}`, name: decodeEntities(h1), description: decodeEntities(desc), provider: { "@id": "https://zibdigital.com.au/#org" }, areaServed: { "@type": "City", name: city } };

  // SEO city pages use the shared live-audit hero component (matches /seo-agency + /seo-melbourne)
  const heroSection = isSeo ? `<section class="loc-hero" id="audit-top">
  <div class="container">
    <div class="audit-hero-intro reveal">
      <div class="eyebrow mono"><span>SEO Agency · ${esc(city)}</span></div>
      <h1 class="hero-h">${h1html}</h1>
      <p class="audit-hero-sub"><strong>${esc(city)}'s SEO agency since 2009. First to hybrid agents today.</strong> Drop your URL below and a senior strategist reads your positioning, technical SEO and commercial opportunities in 30 seconds. Search engine optimisation tied to revenue, for ${esc(city)} businesses.</p>
    </div>
    <!-- @include _partials/audit-embed.html -->
  </div>
</section>` : `<section class="loc-hero">
  <div class="container">
    <div class="mono eyebrow reveal">${hub.label} · ${city}</div>
    <h1 class="hero-h reveal">${h1html}</h1>
    <div class="loc-hero-row">
      <p class="hero-sub reveal"><strong>${esc(hub.label)} in ${esc(city)}, built around your commercial number.</strong> Human first, commercially driven, AI enhanced: senior strategists own the thinking, AI handles the scale.</p>
      <div class="hero-ctas reveal">
        <a class="btn btn-primary" href="/audit">Run a free audit <span class="arr">→</span></a>
        <a class="btn btn-outline" href="mailto:hello@zibdigital.com.au?subject=${encodeURIComponent(hub.label + " " + city)}">Talk to a strategist</a>
      </div>
    </div>
    <div class="hero-meta reveal">
      <span><span class="dot" aria-hidden="true"></span>Premier Google Partner</span>
      <span><span class="dot" aria-hidden="true"></span>Meta Business Partner</span>
      <span><span class="dot" aria-hidden="true"></span>Senior on every account</span>
      <span><span class="dot" aria-hidden="true"></span>800+ clients since 2009</span>
    </div>
  </div>
</section>`;

  // Scannable dot-points (per service) replace the rough ported "slab" copy.
  const proofBody = pointsList(service, city) || (body.length ? para(body) : "");
  const synLine = syn ? `\n    <p class="proof-sub reveal" style="margin-top:24px; max-width:64ch;">${esc(syn)}</p>` : "";

  return `${HEAD(title, desc, isSeo ? ["/assets/location.css", "/assets/audit-widget.css", "/assets/contact-form.css"] : ["/assets/location.css", "/assets/contact-form.css"])}
<script type="application/ld+json">${JSON.stringify(ld)}</script>

${heroSection}

<section class="loc-proof">
  <div class="container">
    <div class="loc-proof-head">
      <div><div class="mono proof-eyebrow reveal">${esc(hub.label)} · ${esc(city)}</div>
      <h2 class="proof-h reveal">${pitchFor(service).h2}</h2></div>
      <p class="proof-sub reveal">${esc(pitchFor(service).sub(city))}</p>
    </div>
${proofBody}${synLine}
  </div>
</section>

<section class="loc-services">
  <div class="container">
    <div class="services-head reveal">
      <div class="mono services-eyebrow">What we do for ${city}</div>
      <h2 class="services-h">Every channel that matters. <em>Linked, not siloed.</em></h2>
    </div>
    <div class="service-list reveal">
${serviceRows}
    </div>
  </div>
</section>

<section class="loc-stats">
  <div class="container">
    <div class="mono stats-eyebrow reveal">Sixteen years on the record</div>
    <h2 class="stats-h reveal">The compound interest of <em>doing this since 2009.</em></h2>
    <div class="stats-grid reveal-stagger">
      <div class="stat-cell"><div class="stat-value"><span data-count="100">0</span><span class="suf">+</span></div><div class="stat-label">Digital specialists across AU &amp; NZ</div></div>
      <div class="stat-cell"><div class="stat-value"><span data-count="800">0</span><span class="suf">+</span></div><div class="stat-label">Australian brands since 2009</div></div>
      <div class="stat-cell"><div class="stat-value"><span data-count="97">0</span><span class="suf">%</span></div><div class="stat-label">Year-on-year retention</div></div>
      <div class="stat-cell"><div class="stat-value"><span data-count="8">0</span><span class="suf">:1</span></div><div class="stat-label">Average ROAS on paid retainers, 2025</div></div>
    </div>
  </div>
</section>

<section class="loc-local">
  <div class="container">
    <div class="reveal">
      <div class="mono local-eyebrow">${hub.label} across Australia</div>
      <h2 class="local-h">${hub.label} where <em>your customers search.</em></h2>
      <div class="loc-link-grid" style="margin-top:28px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0;border-top:1px solid var(--rule-2);">
${locLinks}
      </div>
      <p style="margin-top:24px;"><a class="loc-link" href="/case-studies">See the results we get clients →</a></p>
    </div>
  </div>
</section>

${isSeo ? "<!-- @include _partials/aeo-geo.html -->\n" : ""}
<section class="cta-section" id="audit">
  <div class="container">
    <div class="mono cta-eyebrow reveal">Talk to a senior strategist</div>
    <h2 class="cta-title reveal">Drop the URL. <em>We'll tell you the truth.</em></h2>
    <p class="cta-sub reveal">Thirty minutes with a senior strategist on your ${city} ${hub.label}. We read your business, flag where we'd move first, and give you the unvarnished version.</p>
    <div class="cta-buttons reveal">
      <a class="btn btn-primary" href="/audit">Run the free audit <span class="arr">→</span></a>
      <a class="btn btn-outline" href="mailto:hello@zibdigital.com.au?subject=${encodeURIComponent(hub.label + " " + city + " - discovery call")}">Book a discovery call</a>
    </div>
  </div>
</section>

<style>.loc-link{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 4px;border-bottom:1px solid var(--rule-2);color:var(--ink);text-decoration:none;font-weight:500;font-size:clamp(16px,1.4vw,19px);transition:color .2s,padding-left .2s}.loc-link:hover{color:var(--accent);padding-left:10px}</style>
<!-- @include _partials/contact-form.html -->
<script src="/assets/contact-form.js" defer></script>
${isSeo ? '<script src="/assets/audit-widget.js" defer></script>\n' : ""}${FOOT}`;
}

// ───────────────────────── SERVICE page template ─────────────────────────
function servicePage({ slug, label, city, hub, sf, wp, copy }) {
  const where = city || "Australia";
  const title = sf.title || wp?.seoTitle || `${label} ${city || "Agency Australia"} | Zib Digital`;
  const desc = sf.metadesc || wp?.metadesc || `${label} services from Zib Digital${city ? " in " + city : " across Australia"}. Commercial outcomes, senior strategy, AI-augmented execution since 2009.`;
  const h1 = sf.h1 || wp?.title || `${label}${city ? " " + city : ""}`;
  const sub = copy[0] || `Zib Digital delivers commercial ${label.toLowerCase()}${city ? " for " + city + " businesses" : " across Australia"}. Senior strategists, AI-augmented execution, since 2009.`;
  const body = copy.slice(1, 4);
  const syn = SYNONYMS[hub]?.(city);
  const h1html = emH1(h1, city);
  const proofBody = pointsList(hub, where) || (body.length ? para(body) : "");
  const synLine = syn ? `\n    <p class="proof-sub reveal" style="margin-top:24px; max-width:64ch;">${esc(syn)}</p>` : "";
  const ld = { "@context": "https://schema.org", "@type": "Service", serviceType: label, name: decodeEntities(h1), description: decodeEntities(desc), provider: { "@id": "https://zibdigital.com.au/#org" }, areaServed: { "@type": city ? "City" : "Country", name: where } };
  const serviceRows = CORE.map((k, i) => { const hh = HUBS[k]; return `      <a class="service-row" href="${hh.href}">
        <span class="service-num mono">0${i + 1}</span>
        <span class="service-name">${hh.label}</span>
        <span class="service-desc">${k === hub ? `The wider ${hh.label} practice ${label.toLowerCase()} sits inside, owned by senior strategists end to end.` : HUB_DESC[k]}</span>
        <span class="service-arrow">→</span>
      </a>`; }).join("\n");

  return `${HEAD(title, desc, ["/assets/location.css", "/assets/orange-stats.css", "/assets/contact-form.css"])}
<script type="application/ld+json">${JSON.stringify(ld)}</script>

<section class="loc-hero">
  <div class="container">
    <div class="mono eyebrow reveal">${esc(label)}${city ? " · " + esc(city) : " · Australia"}</div>
    <h1 class="hero-h reveal">${h1html}</h1>
    <div class="loc-hero-row">
      <p class="hero-sub reveal"><strong>${esc(label)}${city ? " in " + esc(city) : ""}, built around your commercial number.</strong> Human first, commercially driven, AI enhanced: senior strategists own the thinking, AI handles the scale.</p>
      <div class="hero-ctas reveal">
        <a class="btn btn-primary" href="/audit">Run a free audit <span class="arr">→</span></a>
        <a class="btn btn-outline" href="mailto:hello@zibdigital.com.au?subject=${encodeURIComponent(label + (city ? " " + city : ""))}">Talk to a strategist</a>
      </div>
    </div>
    <div class="hero-meta reveal">
      <span><span class="dot" aria-hidden="true"></span>Premier Google Partner</span>
      <span><span class="dot" aria-hidden="true"></span>Meta Business Partner</span>
      <span><span class="dot" aria-hidden="true"></span>Senior on every account</span>
      <span><span class="dot" aria-hidden="true"></span>800+ clients since 2009</span>
    </div>
  </div>
</section>

<section class="loc-proof">
  <div class="container">
    <div class="loc-proof-head">
      <div><div class="mono proof-eyebrow reveal">${esc(label)}</div>
      <h2 class="proof-h reveal">${esc(label)} that moves <em>your number.</em></h2></div>
      <p class="proof-sub reveal">${esc(pitchFor(hub).sub(city))}</p>
    </div>
${proofBody}${synLine}
  </div>
</section>

<section class="loc-services">
  <div class="container">
    <div class="services-head reveal">
      <div class="mono services-eyebrow">Every channel that matters</div>
      <h2 class="services-h">${esc(label)} works best <em>linked, not siloed.</em></h2>
    </div>
    <div class="service-list reveal">
${serviceRows}
    </div>
  </div>
</section>

<!-- @include _partials/orange-stats.html -->

<section class="cta-section" id="audit">
  <div class="container">
    <div class="mono cta-eyebrow reveal">Talk to a senior strategist</div>
    <h2 class="cta-title reveal">Drop the URL. <em>We'll tell you the truth.</em></h2>
    <p class="cta-sub reveal">Thirty minutes with a senior strategist on your ${esc(label.toLowerCase())}. We read your business, flag where we'd move first, and give you the unvarnished version.</p>
    <div class="cta-buttons reveal">
      <a class="btn btn-primary" href="/audit">Run the free audit <span class="arr">→</span></a>
      <a class="btn btn-outline" href="/case-studies">See the results we get</a>
    </div>
  </div>
</section>

<!-- @include _partials/contact-form.html -->
<script src="/assets/contact-form.js" defer></script>
${FOOT}`;
}

// ───────────────────────── CASE STUDY template ─────────────────────────
function caseStudyPage({ slug, services, sf, wp, copy }) {
  const title = sf.title || wp?.seoTitle || `${wp?.title || slug} | Zib Case Study`;
  const desc = sf.metadesc || wp?.metadesc || "";
  const h1 = sf.h1 || wp?.title || slug;
  const intro = copy.find((l) => l.length > 80) || desc;
  const body = copy.filter((l) => l.length > 60).slice(0, 6);
  const serviceLinks = [...new Set(services)].map((s) => `<a href="${HUBS[s].href}">${HUBS[s].label}</a>`).join(" · ");

  return `${HEAD(title, desc)}
<article class="cs">
  <header class="cs-hero">
    <div class="container">
      <a class="cs-back" href="/case-studies">← All case studies</a>
      <div class="cs-tags mono">${serviceLinks}</div>
      <h1>${esc(decodeEntities(h1))}</h1>
      ${desc ? `<p class="cs-lede">${esc(decodeEntities(desc))}</p>` : ""}
    </div>
  </header>
  <div class="container cs-body">
${para(body.length ? body : [intro].filter(Boolean))}
  </div>
  <section class="cs-cta">
    <div class="container">
      <h2>Want results like this?</h2>
      <p>Thirty minutes with a senior strategist. We'll tell you where we'd move first.</p>
      <a class="btn btn-primary" href="/audit">Run a free audit <span class="arr">→</span></a>
      <a class="btn btn-outline" href="/case-studies">More case studies</a>
    </div>
  </section>
</article>
<style>
.cs-hero{padding:clamp(120px,14vw,180px) 0 clamp(40px,5vw,64px);border-bottom:1px solid var(--rule)}
.cs-back{color:var(--muted);text-decoration:none;font-size:14px}.cs-back:hover{color:var(--accent)}
.cs-tags{margin:20px 0 14px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;font-size:13px}
.cs-tags a{color:inherit}
.cs h1{font-family:var(--display);font-weight:500;font-size:clamp(34px,5vw,72px);line-height:1.02;letter-spacing:-0.03em;max-width:18ch}
.cs-lede{margin-top:24px;color:var(--muted);font-size:clamp(17px,1.6vw,21px);line-height:1.5;max-width:60ch}
.cs-body{padding:clamp(40px,6vw,80px) 0;max-width:760px}
.cs-body p{color:var(--ink);font-size:clamp(16px,1.4vw,18px);line-height:1.7;margin:0 0 20px}
.cs-cta{background:var(--ink);color:#fff;padding:clamp(56px,7vw,96px) 0;text-align:center}
.cs-cta h2{font-family:var(--display);font-size:clamp(28px,3.4vw,44px);font-weight:500}
.cs-cta p{color:rgba(255,255,255,.7);margin:16px 0 28px}
.cs-cta .btn{margin:0 6px}
.cs-cta .btn-outline{border-color:rgba(255,255,255,.36);color:#fff}
</style>
${FOOT}`;
}

// ───────────────────────── BLOG template ─────────────────────────
function blogPage({ slug, sf, wp, copy }) {
  const title = sf?.title || wp?.seoTitle || `${wp?.title || slug} | Zib Digital`;
  const desc = sf?.metadesc || wp?.metadesc || (copy[0] || "").slice(0, 155);
  const h1 = sf?.h1 || wp?.title || slug;
  const date = wp?.date ? new Date(wp.date.replace(" ", "T")).toLocaleDateString("en-AU", { year: "numeric", month: "long", day: "numeric" }) : "";
  const blocks = copy.map((l) => (l.length <= 70 && !/[.!?]$/.test(l)) ? `      <h2>${esc(decodeEntities(l))}</h2>` : `      <p>${esc(decodeEntities(l))}</p>`).join("\n");
  const ld = { "@context": "https://schema.org", "@type": "BlogPosting", headline: decodeEntities(h1), description: decodeEntities(desc || h1), datePublished: wp?.date ? new Date(wp.date.replace(" ", "T")).toISOString() : undefined, author: { "@type": "Organization", name: "Zib Digital" }, publisher: { "@id": "https://zibdigital.com.au/#org" }, mainEntityOfPage: `https://zibdigital.com.au/${slug}` };

  return `${HEAD(title, desc || h1)}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<article class="post">
  <header class="post-hero">
    <div class="container">
      <a class="post-back" href="/blog">← All articles</a>
      ${date ? `<div class="post-date mono">${date}</div>` : ""}
      <h1>${esc(decodeEntities(h1))}</h1>
    </div>
  </header>
  <div class="container post-body">
${blocks}
  </div>
  <section class="post-cta">
    <div class="container">
      <h2>Put this to work on your site</h2>
      <p>Drop your URL in and a senior strategist gives you a 30-second commercial read.</p>
      <a class="btn btn-primary" href="/audit">Run a free audit <span class="arr">→</span></a>
      <a class="btn btn-outline" href="/seo-agency">Our SEO services</a>
    </div>
  </section>
</article>
<style>
.post-hero{padding:clamp(120px,14vw,180px) 0 clamp(32px,4vw,52px);border-bottom:1px solid var(--rule)}
.post-back{color:var(--muted);text-decoration:none;font-size:14px}.post-back:hover{color:var(--accent)}
.post-date{margin:20px 0 12px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;font-size:13px}
.post h1{font-family:var(--display);font-weight:500;font-size:clamp(30px,4.4vw,60px);line-height:1.04;letter-spacing:-0.03em;max-width:22ch}
.post-body{padding:clamp(40px,6vw,72px) 0;max-width:720px}
.post-body p{color:var(--ink);font-size:clamp(16px,1.4vw,18px);line-height:1.75;margin:0 0 22px}
.post-body h2{font-family:var(--display);font-weight:500;font-size:clamp(22px,2.4vw,30px);margin:40px 0 14px}
.post-cta{background:var(--ink);color:#fff;padding:clamp(56px,7vw,96px) 0;text-align:center}
.post-cta h2{font-family:var(--display);font-size:clamp(26px,3.2vw,40px);font-weight:500}
.post-cta p{color:rgba(255,255,255,.7);margin:16px 0 28px}
.post-cta .btn{margin:0 6px}.post-cta .btn-outline{border-color:rgba(255,255,255,.36);color:#fff}
</style>
${FOOT}`;
}

// ───────────────────────── CASE STUDIES hub ─────────────────────────
function caseHub(cards) {
  const grid = cards.map((c) => `      <a class="ch-card" href="/casestudy/${c.slug}">
        <div class="ch-tag mono">${c.tag}</div>
        <h2>${esc(decodeEntities(c.h1))}</h2>
        <p>${esc(decodeEntities(c.desc))}</p>
        <span class="ch-arr" aria-hidden="true">↗</span>
      </a>`).join("\n");
  return `${HEAD("Case Studies | Zib Digital", "Real clients, real results. See how Zib Digital grows Australian businesses through SEO, Google Ads, paid social and web.")}
<section class="ch-hero"><div class="container">
  <div class="mono eyebrow">Case studies</div>
  <h1>Real clients. Real results. <em>No fluff.</em></h1>
  <p>No matter the industry or the size of your business, we get you the commercial outcome. Here's the proof.</p>
</div></section>
<section class="ch-grid-sec"><div class="container"><div class="ch-grid">
${grid}
</div></div></section>
<section class="cs-cta"><div class="container">
  <h2>Your business next?</h2>
  <p>Run a free audit and see where we'd move first.</p>
  <a class="btn btn-primary" href="/audit">Run a free audit <span class="arr">→</span></a>
</div></section>
<style>
.ch-hero{padding:clamp(130px,15vw,200px) 0 clamp(30px,4vw,50px)}
.ch-hero .eyebrow{color:var(--accent)}
.ch-hero h1{font-family:var(--display);font-weight:500;font-size:clamp(40px,7vw,104px);line-height:.98;letter-spacing:-0.04em;margin-top:16px}
.ch-hero h1 em{font-style:italic;color:var(--accent);font-weight:400}
.ch-hero p{margin-top:24px;color:var(--muted);font-size:clamp(17px,1.6vw,21px);max-width:60ch}
.ch-grid-sec{padding:clamp(40px,5vw,72px) 0}
.ch-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)}
.ch-card{position:relative;background:var(--bg,#fff);padding:clamp(28px,3vw,40px);text-decoration:none;color:var(--ink);transition:background .2s}
.ch-card:hover{background:#faf7f3}
.ch-tag{color:var(--accent);text-transform:uppercase;letter-spacing:.08em;font-size:12px}
.ch-card h2{font-family:var(--display);font-weight:500;font-size:clamp(22px,2.2vw,30px);line-height:1.08;margin:14px 0 12px}
.ch-card p{color:var(--muted);font-size:15px;line-height:1.55}
.ch-arr{position:absolute;top:clamp(28px,3vw,40px);right:clamp(28px,3vw,40px);color:var(--accent)}
.cs-cta{background:var(--ink);color:#fff;padding:clamp(56px,7vw,96px) 0;text-align:center}
.cs-cta h2{font-family:var(--display);font-size:clamp(28px,3.4vw,44px);font-weight:500}
.cs-cta p{color:rgba(255,255,255,.7);margin:16px 0 28px}
</style>
${FOOT}`;
}

// ───────────────────────── PARTNER case studies (from partials) ─────────────────────────
const PARTNER_CS = ["4x4-automotive", "car-subscription", "commercial-door", "custom-trailer", "golf-club", "licensed-club-gbp", "licensed-club-seo", "photo-booth", "plant-hire", "pool-fencing", "refrigerated-transport", "roof-restoration", "trampoline-seo"];

async function parsePartial(slug) {
  const html = await readFile(join(ROOT, "_partials/case-studies", `${slug}.html`), "utf8");
  const eyebrow = (html.match(/<div class="case-card-eyebrow[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
  const tags = [...eyebrow.matchAll(/<span>([^<]*)<\/span>/g)].map((m) => decodeEntities(m[1].trim()));
  const stat = decodeEntities(((html.match(/<div class="case-card-stat">([\s\S]*?)<\/div>/) || [])[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const blurb = decodeEntities(((html.match(/<p class="case-card-blurb">([\s\S]*?)<\/p>/) || [])[1] || "").trim());
  const title = decodeEntities(((html.match(/<h4>([\s\S]*?)<\/h4>/) || [])[1] || "").replace(/\s+/g, " ").trim());
  let sections = (html.match(/<div class="case-card-body">([\s\S]*?)<\/div>\s*<\/details>/) || [])[1] || "";
  sections = sections.replace(/<h4>[\s\S]*?<\/h4>/, "").replace(/^\s+/gm, "  ").trim();
  return { slug, tags, stat, blurb, title, sections };
}

function partnerCaseStudyPage({ slug, tags, stat, blurb, title, sections }) {
  const pageTitle = `${title} | Zib Digital Case Study`;
  const desc = `${stat}. ${blurb}`.replace(/\s+/g, " ").slice(0, 200);
  const ld = { "@context": "https://schema.org", "@type": "Article", headline: `${title} case study`, description: desc, author: { "@type": "Organization", name: "Zib Digital" }, publisher: { "@id": "https://zibdigital.com.au/#org" }, mainEntityOfPage: `https://zibdigital.com.au/casestudy/${slug}` };
  return `${HEAD(pageTitle, desc)}
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<article class="cs">
  <header class="cs-hero">
    <div class="container">
      <a class="cs-back" href="/case-studies">← All case studies</a>
      <div class="cs-tags mono">${tags.map(esc).join(" · ")}</div>
      <h1 class="cs-stat">${esc(stat)}</h1>
      <p class="cs-lede">${esc(blurb)}</p>
      <div class="cs-sub mono">${esc(title)}</div>
    </div>
  </header>
  <div class="container cs-body cs-structured">
${sections}
  </div>
  <section class="cs-cta">
    <div class="container">
      <h2>Want results like this?</h2>
      <p>Thirty minutes with a senior strategist. We'll tell you where we'd move first.</p>
      <a class="btn btn-primary" href="/audit">Run a free audit <span class="arr">→</span></a>
      <a class="btn btn-outline" href="/case-studies">More case studies</a>
    </div>
  </section>
</article>
<style>
.cs-hero{padding:clamp(120px,14vw,180px) 0 clamp(40px,5vw,64px);border-bottom:1px solid var(--rule)}
.cs-back{color:var(--muted);text-decoration:none;font-size:14px}.cs-back:hover{color:var(--accent)}
.cs-tags{margin:20px 0 18px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;font-size:13px}
.cs-stat{font-family:var(--display);font-weight:500;font-size:clamp(40px,7vw,92px);line-height:.98;letter-spacing:-0.03em}
.cs-lede{margin-top:20px;color:var(--muted);font-size:clamp(17px,1.6vw,21px);line-height:1.5;max-width:60ch}
.cs-sub{margin-top:14px;color:var(--ink);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.cs-body{padding:clamp(40px,6vw,80px) 0;max-width:760px}
.cs-structured .case-section{margin:0 0 32px}
.cs-structured h5{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin:0 0 10px}
.cs-structured p{color:var(--ink);font-size:clamp(16px,1.4vw,18px);line-height:1.7;margin:0}
.cs-structured ul{margin:0;padding-left:20px;color:var(--ink);font-size:clamp(16px,1.4vw,18px);line-height:1.85}
.cs-structured .case-quote{font-style:italic;color:var(--muted);border-left:2px solid var(--accent);padding-left:16px}
.cs-structured .case-quote-author{display:block;font-style:normal;font-size:14px;margin-top:8px;color:var(--ink)}
.cs-cta{background:var(--ink);color:#fff;padding:clamp(56px,7vw,96px) 0;text-align:center}
.cs-cta h2{font-family:var(--display);font-size:clamp(28px,3.4vw,44px);font-weight:500}
.cs-cta p{color:rgba(255,255,255,.7);margin:16px 0 28px}
.cs-cta .btn{margin:0 6px}.cs-cta .btn-outline{border-color:rgba(255,255,255,.36);color:#fff}
</style>
${FOOT}`;
}

// ───────────────────────── run ─────────────────────────
const xmlPath = process.argv[2];
if (!xmlPath) { console.error("Usage: node migration/generate.mjs <export.xml>"); process.exit(1); }

const [titleMap, descMap, h1Map, h2Map, wp] = await Promise.all([
  loadSf("page_titles_all.csv", ["Title 1"]),
  loadSf("meta_description_all.csv", ["Meta Description 1"]),
  loadSf("h1_all.csv", ["H1-1", "H1-2"]),
  loadSf("h2_all.csv", ["H2-1", "H2-2"]),
  loadWp(xmlPath),
]);
const sfFor = (url) => {
  const k = url.replace(/\/$/, "");
  return {
    title: titleMap.get(k)?.["Title 1"] || "",
    metadesc: descMap.get(k)?.["Meta Description 1"] || "",
    h1: (h1Map.get(k)?.["H1-1"] || h1Map.get(k)?.["H1-2"] || "").trim(),
    h2_1: (h2Map.get(k)?.["H2-1"] || "").trim(),
    h2_2: (h2Map.get(k)?.["H2-2"] || "").trim(),
  };
};

let n = 0;
const log = (f) => { console.log("  ✓ " + f); n++; };

// Location pages
for (const cfg of LOCATIONS) {
  const sf = sfFor(`${OLD}/${cfg.slug}`);
  const copy = await loadCopy(cfg.slug, { min: 40 });
  await writeFile(join(ROOT, `${cfg.slug}.html`), locationPage({ ...cfg, sf, wp: wp.get(cfg.slug), copy }), "utf8");
  log(`${cfg.slug}.html`);
}

// Standalone service / vertical pages (ported from WP, were missing)
for (const cfg of SERVICE_PAGES) {
  const sf = sfFor(`${OLD}/${cfg.slug}`);
  const copy = await loadCopy(cfg.slug, { min: 40 });
  await writeFile(join(ROOT, `${cfg.slug}.html`), servicePage({ ...cfg, sf, wp: wp.get(cfg.slug), copy }), "utf8");
  log(`${cfg.slug}.html (service)`);
}

// Case studies + hub
await mkdir(join(ROOT, "casestudy"), { recursive: true });
const hubCards = [];
for (const cfg of CASE_STUDIES) {
  const sf = sfFor(`${OLD}/casestudy/${cfg.slug}`);
  const copy = await loadCopy(cfg.slug, { min: 40 });
  await writeFile(join(ROOT, "casestudy", `${cfg.slug}.html`), caseStudyPage({ ...cfg, sf, wp: wp.get(cfg.slug), copy }), "utf8");
  hubCards.push({ slug: cfg.slug, tag: cfg.services.map((s) => HUBS[s].label).join(" · "), h1: sf.h1 || wp.get(cfg.slug)?.title || cfg.slug, desc: sf.metadesc || "" });
  log(`casestudy/${cfg.slug}.html`);
}

// Partner (franchise) case studies — sourced from the curated partials
for (const slug of PARTNER_CS) {
  const cs = await parsePartial(slug);
  await writeFile(join(ROOT, "casestudy", `${slug}.html`), partnerCaseStudyPage(cs), "utf8");
  hubCards.push({ slug, tag: cs.tags.join(" · "), h1: cs.stat, desc: cs.blurb });
  log(`casestudy/${slug}.html (partner)`);
}

await writeFile(join(ROOT, "case-studies.html"), caseHub(hubCards), "utf8");
log("case-studies.html (hub)");

// Blog posts — every published post in the export
const posts = [...wp.entries()].filter(([, p]) => p.type === "post" && p.status === "publish");
for (const [slug, p] of posts) {
  const sf = sfFor(`${OLD}/${slug}`);
  const copy = await loadCopy(slug, { min: 40 });
  if (!copy.length) { console.log(`  · skipped ${slug} (no content)`); continue; }
  await writeFile(join(ROOT, `${slug}.html`), blogPage({ slug, sf, wp: p, copy }), "utf8");
  log(`${slug}.html`);
}

console.log(`\n  Generated ${n} pages.`);
