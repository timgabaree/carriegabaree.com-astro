# Five-site monitoring runbook

## Scope and ownership

UptimeRobot Solo 50, annual subscription confirmed October 29, 2026. This setup covers Tim, RGE, Carrie, Finn, and Clint only. The monitoring receiver and fleet configuration are maintained in this repository. No GoDaddy files, website routes, email DNS, or website content changes are needed to manage these checks.

Alerts go to **tim@timgabaree.com**, corrected by Tim on October 29. Account login remains **timgabaree@gmail.com**. Email sends both DOWN and recovery notifications; unresolved failures repeat hourly. Tim's existing homepage SMS/voice recipients are retained on its replacement homepage monitor; no additional SMS/voice subscriptions were added.

The separate personal email contact is ID `8977973`, managed through UptimeRobot's documented `/v3/alert-contacts` API. On October 29 the newer dashboard's team-contact picker showed only the login-linked Gmail contact, not this additional API-created contact. Do not save notification assignments from that incomplete picker; use the fleet script and verify the saved assignments. No paid notify-only seat was purchased. Routine account reports remain tied to the login email. After the routing change, Tim confirmed receiving the manual UptimeRobot test for `carriegabaree.com | Email delivery failures` at **tim@timgabaree.com**. This confirms delivery to the corrected address, separately from the earlier automatic failure/recovery tests sent to Gmail.

There are **23 active checks** plus **six paused historical checks**: 29 of 50 slots, 21 spare. Each site has its own group. The old HTTP homepage checks and Tim contact-page check are paused under `Retired - history only`, not deleted. New content-aware replacements were UP before the older checks were paused. No duplicate endpoints remain actively monitored.

## Checks and troubleshooting

| Check | Coverage | Interval | What a failure means |
| --- | --- | --- | --- |
| Website content + TLS | All five sites | 1 minute | Homepage is unavailable, returns the wrong status/title, or has a TLS problem. Check Cloudflare routing, deployment, and DNS. |
| WWW redirect + TLS | All five sites | 5 minutes | The www hostname fails HTTPS or no longer returns 308 to the exact HTTPS apex. Redirects are not followed. |
| Contact page | Tim, RGE, Carrie | 5 minutes | The contact page or expected form markup is missing. |
| Contact form readiness | Tim, RGE, Carrie | 5 minutes | GET `/contact-token` fails, lacks a nonempty string token, or is in test mode. Check the contact Worker/session storage. No form submission or email is sent. |
| Email delivery failures | Tim, RGE, Carrie separately | 1 minute | An unresolved send/provider failure is recorded, or the status store cannot be read. Investigate before acknowledging. |
| Email receiver health | Tim | 1 minute | Tim's webhook receiver/configuration is unavailable. This is separate from its delivery-failure latch. |
| RGE + Carrie email monitor health | Shared services | 1 minute | Shared receiver configuration/storage is unhealthy, or a monitoring-infrastructure incident remains unresolved. Site email failures do not trigger this check. |
| PDF download | Tim and Carrie | 15 minutes | A representative publication PDF is unavailable. HEAD checks avoid repeatedly downloading large files; this is not a full-file integrity check. |

All checks validate TLS and use explicit success statuses. Content checks use GET plus an expected title/form marker, not just a successful HTTP response. The redirect checks validate the `Location` header. Requests time out after 30 seconds; application errors receive two UptimeRobot retries before alerting. Homepage and email checks are one-minute checks, not a promise of instant alerts: confirmation retries and mail transport add delay.

Certificate expiry reminders at 30/14/7/0 days are enabled once per monitored hostname (apex, www, and receiver hosts), not on every page. Domain-expiry reminders are enabled only on apex checks. The tim@timgabaree.com alert contact's certificate notification switch is enabled too; enabling only the individual monitor is insufficient. Existing Cloudflare certificate notifications/logging are unchanged.

## Monitor IDs

| Site | Homepage | WWW | Contact page | Form readiness | Email failures | Other |
| --- | --- | --- | --- | --- | --- | --- |
| Tim | 804475314 | 804475315 | 804475327 | 804475328 | 804451162 | Receiver 804451011; PDF 804450935 |
| RGE | 804475316 | 804475319 | 804475329 | 804475330 | 804475333 | — |
| Carrie | 804475320 | 804475322 | 804475331 | 804475332 | 804475334 | PDF 804475339 |
| Finn | 804475323 | 804475324 | — | — | — | No contact-mail backend |
| Clint | 804475325 | 804475326 | — | — | — | No contact-mail backend |
| Shared services | — | — | — | — | — | Receiver/storage health 804464267 |

The old combined RGE/Carrie monitor `804464267` now checks shared infrastructure, retaining its incident history. It no longer mixes the sites' delivery failures.

## Receiver endpoints

Base: `https://family-sites-email-monitor.timgabaree-com-astro.workers.dev`

- `/delivery-status/rgesol`: only RGE's primary/fallback incidents.
- `/delivery-status/carrie`: only Carrie's primary/fallback incidents.
- `/monitor-status`: configuration, readability of every site's primary/fallback store, and the monitoring-infrastructure incident latch. Stored site delivery failures do not make this endpoint fail.
- `/delivery-status`: compatibility aggregate, retained but no longer polled by UptimeRobot.
- `/health`: lightweight configuration probe, retained but superseded for shared-service monitoring by the deeper `/monitor-status` check.

Public probes return empty 200/503 responses, no incident details, with `Cache-Control: no-store`. They accept GET/HEAD only and reject query parameters. The receiver uses three bounded read attempts with fresh Durable Object stubs; exhaustion remains fail-closed and latched. Writes retain three attempts plus an independent fallback object. This is redundancy within Cloudflare, not a separate storage provider.

## Incident response

1. Read the alert's site and check name. A shared-service alert is not evidence that Carrie or RGE email bounced.
2. Read private incident details using the admin script below. Never publish message bodies, addresses, tokens, or raw provider errors in public monitoring responses.
3. For delivery incidents, inspect Resend and the recipient's mail security logs as needed. A newer signed delivery confirmation for the same site/environment/recipient now clears the failure automatically. If manual recovery is needed, fix the cause before acknowledging an exact revision.
4. For shared-service trouble, check Worker logs and all status stores. Retries address recoverable reads but do not prove the cause of any earlier outage.
5. Confirm UptimeRobot resolves the incident and sends recovery notification. Never reset monitoring history to make uptime appear green.

```sh
node scripts/email-monitor-admin.mjs status
node scripts/email-monitor-admin.mjs history
node scripts/email-monitor-admin.mjs acknowledge <reviewed-revision>
# Only with approval: generates an alert, never a contact inquiry.
node scripts/email-monitor-admin.mjs test carrie
node scripts/email-monitor-admin.mjs test rgesol
```

The admin/verification secrets remain in Cloudflare and macOS Keychain service `family-sites-email-monitor`. Tim continues to use a separate receiver; all existing secrets are unchanged.

## Automatic recovery — October 30, 2026

The shared receiver and Tim's separate receiver now support automatic recovery:

- Signed `email.delivered` events clear delivery failures only for their matching
  site/environment/recipient and only if their event timestamp is later than the
  incident's detection. Old, missing and future timestamps cannot clear a newer
  failure. Staging cannot clear production; RGE cannot clear Carrie.
- Every minute, a Cloudflare Cron Trigger verifies all six shared status stores
  can be read and written. Runtime incidents recover after at least three spaced
  healthy checks over two minutes and a minimum incident age of three minutes.
  Failed checks create a fresh runtime incident; gaps over 150 seconds reset
  the streak. Public probes cannot advance recovery.
- Separate active incidents preserve environment and delivery/runtime/test
  boundaries. Explicit diagnostic test incidents still require acknowledgement.
- Each store retains the last 100 resolved/superseded operational records via
  authenticated `/admin/history`; no message bodies, recipient addresses or
  provider IDs are stored. UptimeRobot's existing history is untouched.
- Both existing Resend webhooks retain all five failure subscriptions and add
  `email.delivered`. Secrets, sending keys, recipients and DNS stay unchanged.
- A thank-you page or `email.sent` is not delivery confirmation. Recipient-server
  acceptance still cannot prove inbox placement or detect downstream quarantine.

Shared monitor-only release: `e8b19da1-ff69-4567-a456-a3ea23503e5d`;
previous version `3d5f0f84-96cf-47a9-b845-8a86188461fe`.
Tim monitor-only release: `8a50dacb-3ae0-4015-82b4-bcbd020b5423`.
No website was deployed and no new contact inquiry was sent.
Validation: Tim's 83 tests and 28 local runtime checks passed; the shared receiver's
79 tests and 39 local runtime checks passed. Worker TypeScript checks and deployment
dry runs passed for both. Local workerd tests verified signed failure/delivery
recovery and persistence across restart; unit tests verified timed runtime recovery.
Live private stores were empty and all five email-related UptimeRobot monitors
were UP after deployment. No synthetic live outage or recovery email was generated
for this release, and inbox receipt is not established by these checks.
Schema caution: old receiver code only understands a single summary incident;
retain the multi-incident reader/writer when repairing rather than blindly
rolling back to an old version.

## Configuration and verification

The approved UptimeRobot main API key is stored only in macOS Keychain, service `uptimerobot-fleet-monitoring`, account `main`. It can manage the UptimeRobot account; do not export it, put it in a URL, print it, or add it to Git.

```sh
node scripts/fleet-monitoring.mjs inspect # read only
node scripts/fleet-monitoring.mjs verify # compare desired/live settings; local report
# These mutate UptimeRobot; run only for an approved monitoring change:
node scripts/fleet-monitoring.mjs sync
node scripts/fleet-monitoring.mjs retire
```

`sync` updates only the defined fleet monitors, creates missing checks in the established groups, and saves sanitized before-state evidence under ignored `.local/monitoring/`. Missing/duplicate groups stop the script for inspection. It does not delete/reset monitors. `retire` requires the replacement to be UP before pausing its exact predecessor. `verify` distinguishes configuration validation from the current UP/DOWN state. Review the manifest before reuse after deliberate future changes.

Local validation: `npm run check`, `npm test`, and `node scripts/test-monitor-runtime.mjs`. No email is sent by those tests. Shared receiver deployment uses `wrangler.monitoring.jsonc`; do not deploy the website merely to update monitoring.

## Known limitations and October 29 incident

- Carrie reported missing form messages were actually accepted by her mail server and then quarantined by Advanced Security Cloud Protect. Tim added an exception and confirmed a subsequent form test reached the inbox. This was not a wrong-recipient or website-send failure. Do not broaden mail-security exceptions without review.
- Resend delivery means recipient-server acceptance, not inbox placement. These monitors cannot detect downstream quarantine, mailbox rules, or a webhook never received. No recurring synthetic contact inquiries or mailbox-reading access were added.
- At 10:26 a.m. Central the shared monitor latched `monitor_runtime_error` during GET `/delivery-status`; the stored log did not identify the underlying cause. All stores subsequently read successfully. The exact reviewed revision `07980de3-0041-4fe6-b1d7-f08a16eabb08` was acknowledged with explicit approval. No delivery-failure incident was cleared in that action.
- Setup briefly produced assertion-failure incidents for the new form-readiness checks: UptimeRobot's `length_equals` comparison did not accept the string token. The final checks use string/nonempty validation and `test_mode: false`; local endpoint checks additionally confirmed the expected 64-character token. Retain these setup incidents rather than resetting history.
- Website uptime is not a complete accessibility, performance, SEO, analytics, form-submission, or archive-integrity audit. Keep those release-time checks separate.

## Verification record

October 29 receiver release `3d5f0f84-96cf-47a9-b845-8a86188461fe`: clean type checks, 57 unit tests and 33 local runtime checks passed, including isolated site alerts, retry exhaustion, fallback persistence, restart and exact-revision acknowledgement. Website deployments/content, GoDaddy, DNS, existing Resend keys, and webhook subscriptions were not changed.

Final live verification: **all 23 active monitors UP**, six predecessors PAUSED, private incident stores empty, and **327 configuration checks passed**. These validate seven unique groups, exact endpoints/types/intervals/statuses/assertions, exclusive tim@timgabaree.com routing across active and paused checks, and TLS/reminder settings. Six empty duplicate group shells created during an interrupted setup were removed; no monitor or incident history was deleted. Sanitized settings snapshots remain under ignored `.local/monitoring/`.

- Carrie fallback test revision `d74e81bf-3770-4c4d-b4a9-549ea9d75bac`: incident `374275364771085262`; automatic DOWN email dispatched successfully at 14:16:42 Central and recovery email at 14:18:52. RGE and shared-service checks remained UP while Carrie failed.
- RGE fallback test revision `d778025f-562c-4379-85c8-a7a4ffe1b570`: incident `374276166240307792`; automatic DOWN email dispatched successfully at 14:19:53 Central and recovery email at 14:23:06. Carrie and shared-service checks remained UP while RGE failed. Only that exact reviewed test revision was acknowledged afterward.
- Both test revisions were acknowledged only after UptimeRobot recorded successful alert dispatch. Tim subsequently confirmed receiving both automatic DOWN alerts. Those tests were sent to the then-configured Gmail address; recovery inbox receipt was not separately confirmed. Alert routing was then corrected to tim@timgabaree.com on all 29 checks (including six paused predecessors), with DOWN/recovery and certificate notifications enabled. Gmail remains the account login, not an assigned monitor email recipient. No new contact inquiry was sent.
