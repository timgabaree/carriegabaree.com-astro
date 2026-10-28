# Carrie Gabaree — Astro

Separate Astro/Cloudflare implementation of carriegabaree.com. The original GoDaddy checkout and hosting account are preserved. See [LAUNCH.md](LAUNCH.md) for deployment status, verification, and rollback.

## Development

Use Node from `.nvmrc`, then `npm ci`, `npm run dev`, `npm run check`, and `npm test`. Build staging with `npm run build:staging`; preview its Worker with `npm run preview`. Build production with `npm run build:production`; run `npm run test:site` for content, links, structure, and download checks against the sibling original checkout.

## Modular structure

- `src/data/`: site identity/navigation, page metadata, contact topics, media catalog, and legacy redirects.
- `src/layouts/BaseLayout.astro`: shared document, navigation, footer, security-compatible scripts, and privacy controls.
- `src/components/`: SEO, navigation, footer, page headings, content/citation cards, transcript entries, video player, contact form, and analytics choices.
- `src/content/pages/`: page content only; 24 source pages, including all five transcripts.
- `src/pages/`: data-driven routes, useful 404, image-inclusive HTML/XML sitemaps, and robots rules.
- `public/`: unchanged publications/transcript PDFs and original/optimized media. Twelve PDF paths include two compatibility aliases for ten distinct originals.
- `worker/`: staging authentication, production gate, redirects/security headers, contact validation, CSRF/session/rate-limit state, Resend delivery, and privacy-preserving error logging.
- `tests/` and `scripts/`: security/privacy unit tests and deployed/content verification.

To add a page, add its content component and a matching metadata entry in `src/data/pages.json`. Add navigation in `site.json` only when appropriate. Reuse cards, transcript entries, and video components. Keep archival text verbatim; document intentional editorial changes separately. A future archival database is a separate project, not a hidden dependency of this site.

## Email and analytics

Production inquiries go to `carrie@carriegabaree.com`; staging tests go to `tim@timgabaree.com`. Resend uses `website@forms.carriegabaree.com`, enforced TLS, and separate sending-only domain-restricted keys. Secrets live only in Cloudflare and macOS Keychain, never Git.

Google Analytics property `G-39QGYP8FPR` requires opt-in through a small dismissible notice. Advertising signals/personalization stay off. Staging/local builds never load Google Analytics. Cloudflare Web Analytics remains dashboard-managed with automatic injection and the existing EU exclusion. Live browser checks confirmed one Cloudflare beacon and Google loading only after consent; do not add a duplicate manual beacon.

## Deploy safely

Staging: `npm run deploy:staging`. Its Basic authentication must protect every page, asset, and endpoint. Production uses `wrangler.production.jsonc`, with workers.dev and preview URLs disabled. Website routes are dashboard-managed because the existing CLI authorization cannot manage zone routes. Once routes are attached, use Wrangler versions upload/deploy rather than ordinary deploy to avoid reconciling route settings.

Never deploy the PHP checkout, alter GoDaddy files, replace email records, or use broad wildcard routes. Intended website routes are only `carriegabaree.com/*` and `www.carriegabaree.com/*`. Monitoring rollout is deferred until the family-site migrations finish.
