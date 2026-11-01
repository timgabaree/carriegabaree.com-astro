# Carrie Gabaree — Astro

Professional portfolio and digital archive featuring publications, oral histories, transcripts, citations, video, and downloadable documents.

Live site: [carriegabaree.com](https://carriegabaree.com/).

## How it is built

Astro generates static HTML and assets. A TypeScript Cloudflare Worker serves those assets and handles redirects, security headers, and protected staging. Small browser scripts provide interactive behavior; there is no PHP runtime in the deployed site.

Data-driven page routing, reusable archive components, keyboard-accessible navigation, a contact form, and HTML/XML sitemaps with media entries.

The toolchain uses Node.js (version pinned in `.nvmrc`), npm, TypeScript, and Wrangler. `package-lock.json` pins dependency versions.

## Project structure

- `src/content/pages/` — individual page content.
- `src/data/` — site identity, page metadata, navigation, contact topics, media, and legacy redirects.
- `src/pages/[...path].astro` — routes generated from page data.
- `src/layouts/`, `src/components/` — shared shell, cards, citations, transcripts, video, and forms.
- `src/styles/`, `public/` — styles, browser scripts, images, and downloadable documents.
- `worker/` — access control, redirects, contact validation, and persistent form-security state.
- `scripts/`, `tests/` — build and deployment checks.

Add a content component under `src/content/pages/` and its entry in `src/data/pages.json`. Update navigation in `src/data/site.json` as needed. Reuse the archive components and preserve source transcripts and citations when changing presentation.

## Local development

Install the Node version in `.nvmrc`, then run:

```sh
nvm use
npm ci
npm run dev
```

Astro's development server previews page content. To test Worker routing and form handling locally:

```sh
npm run build:staging
npm run preview -- --var CONTACT_MODE:dry-run
```

Use the local URL printed by each server. The command above uses no-email mode; a successful local form test does not send a message.

## Validation

```sh
npm run check
npm test
npm run build:production
```

`node scripts/verify-deployment.mjs production` checks deployed pages and assets. `npm run test:site` is a legacy migration comparison requiring the original sibling checkout; it is not a general release gate for new content.

## Cloudflare deployment

Staging and production use separate Workers:

- `wrangler.jsonc` — staging configuration; assets built to `dist/`.
- `wrangler.production.jsonc` — production configuration; assets built to `dist-production/`.

Staging uses HTTP Basic authentication with `STAGING_USER` and `STAGING_PASSWORD` stored as Cloudflare secrets. It is excluded from indexing and does not load Google Analytics. After configuring credentials and infrastructure, `npm run deploy:staging` builds and publishes staging.

Production redirects HTTP and `www` to the HTTPS apex. Public production `workers.dev` and version-preview URLs are disabled. Apex and www use exact-host Worker routes. Keep route management separate from content releases.

For an **existing, configured production Worker**, run validation, commit and push the source, then:

```sh
npx wrangler versions upload --config wrangler.production.jsonc
# Replace VERSION_ID with the version returned by the upload.
npx wrangler versions deploy VERSION_ID@100 --config wrangler.production.jsonc
```

Upload does not shift traffic; the deployment command does. Verify the published pages, redirects, assets, and privacy controls afterward. Git pushes do not deploy the website. Keep the previous version available for a reviewed rollback.

The optional [WebStorm workflow](WEBSITE-WORKFLOW/00-START-HERE.md) provides separate check, commit, push, upload, publish, and verification actions.

## Contact email

The Worker validates submissions, applies CSRF/replay and rate-limit protection, and sends through Resend. Cloudflare Durable Objects hold temporary form-security state. Configure `RESEND_API_KEY`, `CONTACT_FROM`, and `CONTACT_TO` as secrets in each environment.

Use separate sending-only keys scoped to a verified sender domain. Keep delivery encrypted and open/click tracking disabled. The recipient is server-controlled; visitor email is used only for Reply-To. Provider acceptance or a thank-you page does not prove inbox delivery. Use a controlled end-to-end test when validating email.

## Privacy and analytics

Google Analytics loads only after opt-in on production. Visitors can reopen privacy choices from the footer; dismissal is not consent. Cloudflare Web Analytics is configured separately at the edge; avoid adding a duplicate beacon. Contact message contents are not sent to analytics.

## Adapting this project

This is a site-specific implementation, not an account-neutral starter:

1. Replace content, branding, metadata, domain references, analytics identifiers, and privacy/contact details.
2. Set your own Cloudflare account, Worker names, hostnames, routes, and environment variables. Keep production closed until setup and checks are complete.
3. Provision the resources and bindings referenced by the Worker configurations in your own account, including Durable Objects and any cross-Worker dependencies. Configure secrets outside Git.
4. Update host-specific tests and verification scripts. The optional WebStorm helpers also enforce repository ownership, branch, and account identity; adapt both `WEBSITE-WORKFLOW/site.json` and the guards in `workflow.mjs` before reuse.
5. Establish staging, then production infrastructure and routing separately. The version-upload sequence above is for subsequent releases, not a complete first-time provisioning procedure.

Keep credentials, generated builds, archives, and local reports out of Git and public assets. Use only content and media you have permission to reuse. During a hosting migration, preserve unrelated sites and email DNS.

## Monitoring

Services: UptimeRobot and Cloudflare.

## Public archive search

The private archive editor is the source of truth. Its **Approve for website** action explicitly clears a record's title, description, subjects and all attached text for website use. Approval does not deploy this site. Internal provenance, people/contact tables, file paths and edit history are never part of the website export.

1. Review a real record in the private editor, then choose **Approve for website**. Do not approve text without permission to publish it.
2. Choose **Download approved website data**. This creates an approved-only JSON snapshot, not a database backup.
3. In this project, run `npm run archive:import -- /ABSOLUTE/PATH/carrie-archive-approved.json`.
4. Run `npm run archive:preview`, or WebStorm's **10 - Preview approved archive search (local only)**. Open the printed localhost URL to review the candidate snapshot.
5. When ready to publish, download a fresh approved export and run `npm run archive:import -- /ABSOLUTE/PATH/carrie-archive-approved.json --publish`. This replaces `src/data/archive-approved.json`, the versioned public-content snapshot. It does not deploy anything.
6. Follow the normal check, commit, push, upload, publish and verify workflow. Production builds generate both the record pages and Pagefind search index from the same versioned snapshot. Missing or invalid input fails the build.

After building, run `npm run archive:verify` to compare every generated record page and its full text with the approved snapshot, verify the browse links, and check that the search index includes exactly the same records. This also catches missing pages caused by build-time path resolution.

Search-result links retain the query and open a matching-passages section on the record. Excerpts and full text highlight search words and word-prefix variants. Only matching passages appear by default; **Show full document** reveals the rest. The sticky **Back to search results** button restores the query and type filter. Each excerpt links to the corresponding passage and, when available, the original source. PDF links use the physical PDF page number from the imported locator, which can differ from the printed page number; transcript links open the original transcript without inventing a time anchor. Full source text remains readable without JavaScript.

Candidate snapshots stay in ignored `.local/`; preview output stays in `dist-archive-preview/`. Without a candidate snapshot, the local preview is empty. No sample records are supplied. Only the deliberately promoted public snapshot is committed. Pagefind indexes its approved full text and runs search in the browser without database credentials or a public D1 connection. This feature sends no custom search analytics events; normal site analytics and hosting access logs are separate.

The public entry point is `/archive`, linked from the site navigation and HTML sitemap. XML sitemaps include the search page and individual records. Production builds verify exact source-text preservation, approval, record/index parity, canonical links and sitemap inclusion. The Worker permits WebAssembly compilation only on `/archive` and Pagefind's dedicated browser worker; arbitrary JavaScript evaluation remains blocked. Private source files and the editor are not served by the public Worker. Production still rejects the local preview flag. Neither import nor preview commands upload or deploy anything.

Approval is a snapshot workflow, not automatic synchronization. After edits or withdrawal, download a fresh export and rebuild. **Withdrawal does not recall an old downloaded export or an already published copy.** Use a fresh export immediately before any future release; a website rebuild/release is required to remove previously published material. Previously downloaded copies cannot be recalled. Keep private backups out of the public project.
