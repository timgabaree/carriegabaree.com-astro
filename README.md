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

Never deploy the PHP checkout, alter GoDaddy files, replace email records, or use broad wildcard routes. Intended website routes are only `carriegabaree.com/*` and `www.carriegabaree.com/*`.

## Coordinated monitoring

The existing UptimeRobot Solo 10 plan covers all five sites without an upgrade. All checks run every minute and alert `tim@timgabaree.com`. Tim's five existing monitors are unchanged. Four new homepage checks cover RGE (`804464221`), Finn (`804464232`), Clint (`804464241`), and Carrie (`804464246`). They accept 2xx only, do not follow redirects, and check certificate errors with expiry reminders at 30/14/7/0 days. External certificate checks cover the served certificates; Cloudflare's advanced/custom-certificate notification types are not a substitute for Universal SSL expiry monitoring.

The tenth monitor, **RGE + Carrie - Contact email failures** (`804464267`), checks `https://family-sites-email-monitor.timgabaree-com-astro.workers.dev/delivery-status`. This separate Worker is maintained here through `wrangler.monitoring.jsonc`. Its probe returns an empty 200 only when configuration and all incident stores are readable and clear; failures return 503. It does not send contact inquiries or expose incident details publicly.

- Both RGE and Carrie production/staging Workers write immediate send failures through a private cross-Worker Durable Object binding. Fixed site prefixes isolate their primary and fallback records.
- Resend webhook `1cc0646f-2501-41a8-bda3-c52ed934987d` listens only for failed, bounced, delayed, suppressed, and complained email events. Svix signatures/timestamps, bounded bodies, application/environment tags, and expected recipients are checked. RGE uses `timgabaree@rgesol.com` in both environments; Carrie uses `carrie@carriegabaree.com` in production and `tim@timgabaree.com` in staging.
- Stored incidents contain site, environment, fixed issue code, detection time, and revision, never message contents or visitor details. Event IDs are hashed for seven-day deduplication. Successful emails never clear incidents. Writes retry and have a separate fallback; this is object-level redundancy, not a second storage provider.
- A healthy status means no unresolved reported failure, not proof that every email reached its inbox. Missing provider events and a simultaneous storage outage ending between polls remain limitations. No recurring paid test emails or customer-facing form submissions are configured.
- Verification and admin secrets are in Cloudflare and macOS Keychain service `family-sites-email-monitor` (accounts `resend-webhook` and `admin`), not Git or URLs. Tim's existing receiver and secrets remain separate.

Incident response, from this checkout with the required Node version:

```sh
node scripts/email-monitor-admin.mjs status
# Investigate first, then acknowledge only an exact reviewed revision:
node scripts/email-monitor-admin.mjs acknowledge <reviewed-revision>
```

Each incident requires its own acknowledgement. Revision matching prevents accidentally clearing a newer failure. Only with explicit approval, `node scripts/email-monitor-admin.mjs test carrie` (or `rgesol`) injects a labeled fallback failure and sends a real UptimeRobot alert, not an inquiry. Confirm the alert and acknowledge the test revision afterward. Local tests are safe: `npm test` and `node scripts/test-monitor-runtime.mjs` never send email.
