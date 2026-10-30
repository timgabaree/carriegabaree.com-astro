# Migration status — 2026-10-30

## Current state

Live on Cloudflare at https://carriegabaree.com/. Exact-host routes `carriegabaree.com/*` and `www.carriegabaree.com/*` serve the production Astro Worker. HTTPS and the apex hostname are canonical. Existing website DNS still points to the preserved GoDaddy origin; no existing DNS records were replaced.

Production version: `2e8a930e-932e-4f6b-b997-867ed186f439` (October 28 footer/sitemap style release, source commit `d294c33`). Protected staging version: `c7dffb4b-c0a5-4f88-b586-d3290abb5793` (unchanged). Production workers.dev and preview URLs remain disabled. Routes are dashboard-managed: use versions upload/deploy for subsequent production releases, not ordinary deploy.

Private repository: https://github.com/timgabaree/carriegabaree.com-astro

Staging: https://carriegabaree-com-astro-staging.timgabaree-com-astro.workers.dev/

## Verified

- October 28 style release: Privacy choices matches the adjacent footer links; all 51 sitemap page/media links render white without underlines, with explicit matching visited styling. Live Enter/Escape controls and visible keyboard focus verified. Clean type checks, 55 unit tests, production build, 1,059 local content/link checks, and 231 live checks across 25 pages passed. The www redirect preserves path/query. Monitoring, staging, GoDaddy, and all DNS were unchanged; no email was sent.
- Original GoDaddy web files archived and independently extracted/hashed: 81 files unchanged before/after backup.
- Second ordinary ZIP saved in the requested Dropbox Archive folder; ZIP integrity and hashes verified. Off-device Dropbox sync is not verified.
- All 24 current source pages match live source text. Local fixes to three old citation links retained.
- Production build generates 26 pages. Structural/link/content checks: 1,058 passed; 12 PDF paths hash-match originals; all five transcripts preserved.
- Type checking: zero errors/warnings/hints. Security/privacy tests: 31 passed.
- Protected staging: 236 deployed checks across 25 valid pages, legacy redirects, security headers, private-path blocking, and downloaded PDF hashes.
- Sending domain `forms.carriegabaree.com` verified with only three new sender records: TXT `resend._domainkey.forms`, DNS-only CNAMEs `rsend.forms` and `send.forms`. No existing email record changed.
- Resend TLS enforced. The first two unused credentials were revoked with explicit approval; replacement staging/production keys are sending-only and domain-restricted, saved in Keychain/Cloudflare. Do not reuse earlier keys.
- Staging form test to Tim: Resend Delivered, ID `01a184cb-f655-7e3a-9d3e-ebb745001c5d`.
- Private production adapter test to Tim: Resend Delivered, ID `01a184cc-6343-7aaf-8902-b3cb4f5f7876`. This test did not open production or change its intended Carrie recipient. Tim confirmed both test emails arrived. Production inquiries remain addressed to `carrie@carriegabaree.com`; no test was sent to Carrie.
- Website minimum TLS changed from 1.0 to 1.2; TLS 1.3 remains enabled. Universal certificate active, managed expiry 2026-12-01.
- Responsive checks: eight representative pages at 320, 768, and 1440px (24 checks), no horizontal overflow; one main landmark/primary heading and image alternatives verified. Homepage/publications visually reviewed at 390px.
- Mobile navigation Escape-key behavior and citation copying verified. All five video URLs preserved; one embedded video played successfully in the in-app browser. Some Chrome previews showed a blank third-party player, including on the original site; this was not reproduced in the in-app browser.
- Live deployment: 231 checks across 25 valid pages, including redirects, security headers, private-path blocking, and downloaded PDF hashes. HTTPS/www redirects preserve queries. Empty live contact form correctly blocks submission; no additional email was sent.
- Google Analytics `G-39QGYP8FPR` absent before consent and loaded once after Allow. Existing automatic Cloudflare beacon loaded once, retaining the dashboard's EU exclusion. This verifies browser integration, not arrival in analytics reports.

## PageSpeed lab checks

All four categories are green on the three tested page types, on mobile and desktop. Scores are snapshots, not a guarantee for every page or a complete accessibility certification. Field data was unavailable at launch.

| Page | Device | Performance | Accessibility | Best practices | SEO |
| --- | --- | ---: | ---: | ---: | ---: |
| Home | Mobile | 99 | 100 | 100 | 100 |
| Home | Desktop | 100 | 100 | 100 | 100 |
| Publications | Mobile | 98 | 100 | 96 | 100 |
| Publications | Desktop | 100 | 100 | 100 | 100 |
| Contact | Mobile | 99 | 100 | 100 | 100 |
| Contact | Desktop | 100 | 100 | 100 | 100 |

Reports: [home](https://pagespeed.web.dev/analysis/https-carriegabaree-com/svc2xg1762?form_factor=mobile), [publications](https://pagespeed.web.dev/analysis/https-carriegabaree-com-publications/08wmg0ianq?form_factor=mobile). Publications' mobile best-practices deduction concerns low-resolution images; its score remains green.

## Follow-up

- October 30 monitoring-only release `e8b19da1-ff69-4567-a456-a3ea23503e5d` adds automatic recovery and private resolution history; see [MONITORING.md](MONITORING.md). Signed delivery recovery and timed runtime recovery passed local tests. All five email-related UptimeRobot checks were UP after deployment; no new inquiry or live synthetic alert was sent.

- October 29 monitoring reorganization: see [MONITORING.md](MONITORING.md). Solo 50 annual, 23 active checks and six paused predecessors; alerts to `tim@timgabaree.com` per Tim's clarification; Gmail remains the account login. New site-specific email-failure checks replace the combined failure check; `804464267` now monitors shared infrastructure. Shared receiver version `3d5f0f84-96cf-47a9-b845-8a86188461fe`, 57 unit tests, 33 local runtime checks and clean type checks. Website/staging deployments were not changed.
- October 29 Carrie inbox issue: Tim located form emails in Advanced Security Cloud Protect quarantine, added an exception himself, and confirmed a subsequent form message arrived. Recipient remained `carrie@carriegabaree.com`. Resend acceptance alone cannot detect downstream quarantine.
- Historical October 28 monitoring release passed 55 unit tests, 22 local runtime tests, clean type checks, 231 live and 236 protected-staging checks. Page assets were unchanged on both uploads.
- Hosted alert test: Carrie fallback `monitor_self_test` and a synthetic signed RGE staging `email.failed` event persisted independently. UptimeRobot incident `373980481164829341` began at 18:44:54 Central and recorded successful email dispatch at 18:44:57. Tim confirmed the automatic DOWN alert arrived. Only the two reviewed synthetic revisions were acknowledged: clearing RGE alone left the probe at 503; clearing Carrie then restored 200 with no incidents. UptimeRobot resolved the incident at 18:48:08 and recorded successful recovery-email dispatch at 18:48:11. Recovery inbox receipt was not separately confirmed. No contact inquiry was sent and neither website was taken down.
- Historical October 28 receiver version after secret configuration: `2d76d1bf-d093-44ab-9e85-fa7db79687bb` (superseded by the October 29 monitoring-only release above). TLS verification accepted the served certificates for all five sites. No expired-certificate simulation was performed.
- Review Search Console indexing and analytics report arrival after launch; browser integration alone does not prove reporting.
- Confirm Dropbox's off-device archive sync when convenient.

## Archives and rollback

Primary archive: `/Volumes/StudioStack NVMe/Website Archives/carriegabaree.com/2026-10-28-pre-cutover/godaddy-carriegabaree.com.tar.gz`

SHA-256: `b9cce9a80839f33876c9e5ba520776bc5ab3fa077ef18595dd4d6376847cd634`

Second copy: `/Volumes/StudioStack NVMe/Dropbox/Work Files/Websites/Archive/carriegabaree.com-GoDaddy-2026-10-28/godaddy-carriegabaree.com-backup.zip`

SHA-256: `c39113e4901b8d1fc32f4cb87d9b10dc5dea097f8dbfb595cbf0917aa146daa5`

Use `dns-pre-migration-2026-10-28.txt` and `dns-ready-for-cutover-2026-10-28.txt` in the primary archive folder, with restore-check manifests and ignored `.local/` evidence. The older file named `dns-pre-cutover.txt` is a September historical export, not the current rollback baseline. The fresh post-launch comparison confirms existing DNS records unchanged, only the three approved sender-verification additions, and all 81 GoDaddy file hashes unchanged.

For rollback, remove only the two Carrie website Worker routes; unchanged DNS then returns traffic to the preserved GoDaddy origin. Never remove sender verification/email records as part of website rollback. No GoDaddy hosting cancellation: rgesol.com remains the shared account's primary domain.
