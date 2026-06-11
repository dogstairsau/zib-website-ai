# Deployment & cutover notes

This one Vercel project serves multiple hosts:

| Host | Role | Indexable? |
|------|------|-----------|
| `zib-website-ai.vercel.app` (+ `*.vercel.app` previews) | Staging / review | **No** — `X-Robots-Tag: noindex` |
| `ziboutreach.com.au` | Outreach domain (302s `/` → `/audit`, funnels other paths to zibdigital.com.au, serves prospect/proposal pages) | Yes |
| `zibdigital.com.au` | Final production home (after DNS cutover) | Yes |

## Indexing control

- **Staging noindex is host-scoped**, set in `vercel.json` → `headers` with a
  `has` host condition matching `.*\.vercel\.app`. It applies **only** to the
  Vercel preview hosts. It does **not** touch `ziboutreach.com.au` and will
  **not** affect `zibdigital.com.au` once DNS points there — so there is no
  "remember to remove the noindex" step. It auto-lifts at cutover.
- `robots.txt` stays `Allow: /` on purpose: crawlers must be able to fetch the
  staging URL to *see* the `X-Robots-Tag: noindex` header.
- Canonicals are injected at build time (`build.mjs`) and always point at
  `https://zibdigital.com.au` — correct cross-domain signal while on staging,
  and correct self-reference after cutover.

## Cutover checklist (when pointing zibdigital.com.au at this project)

1. Add `zibdigital.com.au` as a domain on the Vercel project and point DNS.
2. Confirm the site loads on `https://zibdigital.com.au` (the `*.vercel.app`
   noindex header does NOT apply to it — verify `X-Robots-Tag` is absent there).
3. Verify `https://zibdigital.com.au/sitemap.xml` resolves (146 URLs) and
   `https://zibdigital.com.au/robots.txt` shows the correct `Sitemap:` line.
4. Add + verify `zibdigital.com.au` in Google Search Console; submit the sitemap.
5. Spot-check canonicals resolve to live 200 pages (no `.html`, no trailing slash).
6. Confirm legacy 301s from the old WordPress URLs land correctly.
7. Decommission / redirect the old WordPress site to the new pages.
