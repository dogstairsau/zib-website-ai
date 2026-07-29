# Zib Digital — SEO Migration Tracker

Old site: `https://zibdigital.com.au/` (WordPress, trailing-slash clean URLs)
New site: `https://www.ziboutreach.com.au/` (static HTML, `.html` extensions)

Source files (Screaming Frog + WordPress export, 2026-06-09):
- `url_all.csv` — 431 crawled URLs (pages + assets), status codes, canonicals
- `page_titles_all.csv` — title tags
- `meta_description_all.csv` — meta descriptions
- `meta_keywords_all.csv` — legacy meta keywords (mostly empty)
- WordPress XML export — 151 pages, 70 posts, 32 case studies, 10 team, 1873 attachments

> **Phase 1 (this migration):** every indexable old URL resolves on the new site
> (live page or 301). **Phase 2:** integrate AI copy / new positioning into ported pages.

---

## Status legend
- ✅ **Live** — page exists on new site
- 🔁 **Slug change** — exists but at a different URL → needs 301
- ❌ **Missing** — indexable on old site, not yet built
- ⛔ **Noindex/Drop** — `noindex` on old site; no SEO equity to preserve

---

## 1. Pages that already exist (verify content + add 301 from old URL)

| Old URL | New file | Status | Notes |
|---|---|---|---|
| `/` | `index.html` | ✅ | Home |
| `/blog/` | `blog.html` | ✅ | |
| `/seo-agency/` | `seo-agency.html` | ✅ | |
| `/google-ads/` | `google-ads.html` | ✅ | |
| `/social-media-marketing/` | `social-media-marketing.html` | ✅ | |
| `/meet-the-team/` | `meet-the-team.html` | ✅ | |
| `/digital-marketing-adelaide/` | `digital-marketing-adelaide.html` | ✅ | |
| `/digital-marketing-agency-brisbane/` | `digital-marketing-agency-brisbane.html` | ✅ | |
| `/digital-marketing-agency-canberra/` | `digital-marketing-agency-canberra.html` | ✅ | |
| `/digital-marketing-agency-gold-coast/` | `digital-marketing-agency-gold-coast.html` | ✅ | |
| `/digital-marketing-agency-melbourne/` | `digital-marketing-agency-melbourne.html` | ✅ | |
| `/digital-marketing-agency-sydney/` | `digital-marketing-agency-sydney.html` | ✅ | |
| `/digital-marketing-geelong/` | `digital-marketing-geelong.html` | ✅ | |
| `/corrine-chalmers/` | `corrine-chalmers.html` | ✅ | Old Zib staff page — confirm still relevant |
| `/daniel-harris/` | `daniel-harris.html` | ✅ | |
| `/marty-tucker/` | `marty-tucker.html` | ✅ | |
| `/dylan-jake/` | `dylan-and-jake.html` | 🔁 | Slug changed → 301 `/dylan-jake/` → `/dylan-and-jake` |

---

## 2. Missing — indexable on old site, NOT yet built

### SEO location pages (7)
| Old URL | Old title |
|---|---|
| `/seo-adelaide/` | SEO Adelaide – Trusted SEO Agency and Services |
| `/seo-brisbane/` | SEO Brisbane \| Trusted SEO Company \| SEO Services |
| `/seo-canberra/` | SEO Canberra \| Expert SEO Services \| SEO Agency \| Zib Digital |
| `/seo-geelong/` | SEO Geelong \| ROI Driven SEO Marketing Agency |
| `/seo-gold-coast/` | SEO Gold Coast \| Expert SEO Agency - Zib Digital |
| `/seo-melbourne/` | SEO Melbourne: Data-Driven SEO Services \| Zib Digital |
| `/seo-sydney/` | SEO Sydney \| Best SEO Agency \| Expert SEO Services |

### Social media location pages (6)
| Old URL | Old title |
|---|---|
| `/social-media-marketing-agency-adelaide/` | Social Media Marketing Adelaide \| Social Media Agency Adelaide |
| `/social-media-marketing-agency-brisbane/` | Social Media Marketing Brisbane \| Social Media Agency Brisbane |
| `/social-media-marketing-agency-canberra/` | Social Media Marketing Canberra \| Social Media Agency Canberra |
| `/social-media-marketing-agency-gold-coast/` | Social Media Marketing Gold Coast \| Social Media Agency Gold Coast |
| `/social-media-marketing-agency-melbourne/` | Social Media Agency Melbourne \| Social Media Marketing Melbourne |
| `/social-media-marketing-agency-sydney/` | Social Media Marketing Agency Sydney \| Zib Digital |

### Web design + Google Ads location (3)
| Old URL | Old title | Notes |
|---|---|---|
| `/web-graphic-design-melbourne/` | Web Design Melbourne \| Graphic Website Design Melbourne | ⚠️ Already linked from city pages + in sitemap.xml, but file does not exist (broken link now) |
| `/web-graphic-design-adelaide/` | Web Design Adelaide \| Website Graphic Design Adelaide | |
| `/google-ads-management-agency-melbourne/` | Google Ads Agency Melbourne, PPC Management Agency Melbourne | |

### Case studies — hub + 10 details (11)
| Old URL | Old title |
|---|---|
| `/case-studies/` | Case Studies hub |
| `/casestudy/amazing-graze/` | Amazing Graze Flowers — 600% sales growth |
| `/casestudy/assured-roofing/` | Assured Roofing — 410% organic traffic |
| `/casestudy/liberty-financial/` | Liberty Financial — 80% increase paid leads |
| `/casestudy/ncc/` | National Crime Check — 1200% revenue growth |
| `/casestudy/port-melbourne-containers/` | Port Melbourne Containers — 430% inc. leads |
| `/casestudy/procut/` | Pro Cut Tree Services — 540% traffic growth |
| `/casestudy/puma/` | PUMA — 20x social ROAS |
| `/casestudy/the-fruit-box-group/` | The Fruit Box Group — 250% organic traffic |
| `/casestudy/twelve-board-store/` | Twelve Board Store — 40x advertising ROAS |
| `/casestudy/wicked-sista/` | Wicked Sista — 2x ecommerce transactions |

> Note: `_partials/case-studies/` holds 13 *different* (anonymised) case-study partials.
> The old-site case studies above are named clients — decide whether to port verbatim or anonymise.

### Blog posts (6)
| Old URL | Old title |
|---|---|
| `/google-ads-2025-roas/` | Google Ads in 2025: Why Your ROAS Plateaued |
| `/how-we-delivered-a-record-season-for-an-adventure-tourism-brand/` | How we delivered a record season for an adventure tourism brand |
| `/how_to_align_seo/` | From Clicks to Customers: Align SEO and UX |
| `/the-holidays-go-digital/` | The Holidays Go Digital |
| `/wasting-google-ad-budget/` | Signs You're Wasting Your Google Ad Budget |
| `/why-ppc-is-the-perfect-complement-to-your-seo-strategy/` | Why PPC Is the Perfect Complement to Your SEO Strategy |

### Team / contact / misc (6)
| Old URL | Old title | Decision needed |
|---|---|---|
| `/team/brandon-wood/` | Brandon Wood | Old Zib staff — keep? |
| `/team/matt-jackson/` | Matthew Jackson | |
| `/starsha-green/` | Starsha Green | ✅ Rebuilt as a full partner page (`starsha-green.html`), portrait recovered via Wayback + upscaled |
| `/contact-zibdigital/` | Contact Zib Digital | New site uses `mailto:` + `/audit` — need a real contact page? |
| `/get-in-touch/` | Get a Quote | Map to `/audit` or a quote page? |
| `/new-final-home-page/` | Duplicate home | 301 → `/` |

---

## 3. Noindex on old site — no migration / drop (confirm)
- `/privacy-policy/` — *noindex on old site, but a live site usually needs one* → recommend build + index
- `/zib-partner-opportunity/` — noindex
- `/category/*`, `/casestudy-category/*` — WordPress archives, noindex → drop

---

## Open decisions (blocking page builds)
1. **Voice:** New pages already live (e.g. Adelaide) are *rewritten* in the new "your number / AI-augmented" positioning, NOT the old WP copy. Should the ~33 missing pages follow that new voice, or port the old WP copy first and re-voice in Phase 2?
2. **URL scheme:** Old = trailing-slash clean URLs (`/seo-melbourne/`). New = `.html`. Confirm `vercel.json` rewrites + the 301 map handle both.
3. **Case studies:** named clients (old) vs anonymised partials (new). Port real ones, or keep anonymised?
4. **Old Zib staff pages** (Brandon Wood, Matt Jackson, Starsha Green) — keep, or are the new partner pages (Brad Reece, Chelsea Teelow, etc.) the replacement?

## ⚠️ Current routing reality (`vercel.json`)
- `cleanUrls: true`, `trailingSlash: false` → live URLs are extensionless, no trailing slash
  (so `seo-melbourne.html` serves at `/seo-melbourne`).
- **A catch-all redirect currently sends almost everything on `ziboutreach.com.au` BACK to
  the old site** `https://zibdigital.com.au/:path` (temporary 302). Only a small allowlist
  (audit, meta-ads-lab, partner pages, roi-calculator, a few client pages) is served locally.
- Implication: the location/SEO/service pages already in this repo are **not publicly reachable**
  on the new domain yet — they're shadowed by that redirect. Migrating a page = build it **and**
  add it to the allowlist (or retire the catch-all once enough pages exist).

## SEO must-dos regardless of voice
- 301 redirect map: every old URL → new equivalent (slug + trailing-slash + `.html`).
- Fix broken link: city pages link to `/web-graphic-design-melbourne.html` which doesn't exist.
- Rebuild `sitemap.xml` to include all migrated pages (currently missing most).
- Preserve/port titles + meta descriptions (captured above and in source CSVs).
