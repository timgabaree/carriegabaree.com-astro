# carriegabaree.com — Website update buttons

Account identifiers in this guide are placeholders. The workflow reads actual values from its configuration; do not replace working configuration values to match these examples.

Open **Run → Run… → WEBSITE WORKFLOW** in WebStorm. Choose a numbered action and click Run. You can also expand `package.json` in the npm tool window and run a `site:` action, or open this folder's numbered `.command` files. Every action prints its description before doing anything. Prompts appear in the Run console; click there to type your answer and press Enter. If your console cannot accept input, use the matching `npm run site:...` command in WebStorm Terminal after `nvm use`.

| Step | Action | Effect |
| --- | --- | --- |
| 00 | `npm run site:help` — START HERE - Instructions | Print the workflow guide; no changes. |
| 01 | `npm run site:preview` — Preview on this Mac | Local preview only. Stop with Control+C or the red Stop button. |
| 02 | `npm run site:check` — Check and build - No upload | Code checks, tests, production build and dry run. No upload. |
| 03 | `npm run site:commit` — Save changes in Git - Local only | Review and commit ALL listed changes after confirmation. No push. |
| 04 | `npm run site:push` — Send commits to GitHub - Not live | Push the clean release branch after confirmation. No website deployment. |
| 05 | `npm run site:upload` — Upload to Cloudflare - NOT LIVE | Check and upload the GitHub-saved revision after confirmation. Live traffic stays unchanged. |
| 06 | `npm run site:publish` — PUBLISH LIVE WEBSITE | Publish the saved version at 100 percent after explicit confirmation. |
| 07 | `npm run site:verify` — Verify the live website | Check live pages and assets. No contact email. |
| 08 | `npm run site:login` — Sign in to Cloudflare if needed | Normal browser sign-in only. No deployment. |
| 09 | `npm run site:search-records` — SEARCH RECORDS ONLY - Add, change or remove (not live) | Optional guided import: instructions, fresh export path, change summary and confirmation. Prepares local data only. |
| 10 | `npm run archive:preview` — Preview approved archive search (local only) | Optional review of the prepared records at the printed `/search` URL. No upload. |
| 11 | `npm run site:search-sync` — SEARCH SOURCES - Scan, review and optionally publish | Scan live content, review selected database updates, then optionally continue through the normal release confirmations. |

## Normal update

1. Edit and save the Astro files in this project, not the PHP project.
2. Run **01** and inspect your changes in the printed local URL. Stop the preview when finished.
3. Run **02**. Fix any failed check before proceeding.
4. Run **03**. Review the file list and actual differences in WebStorm first. This action commits **all listed non-ignored changes**, including new files and previously staged files. Enter a short message, then type `COMMIT carriegabaree.com`. To select only some files, cancel and use WebStorm's Commit window instead.
5. Run **04**, then type `PUSH carriegabaree.com`. Confirm the commit appears on GitHub. This does not publish the website.
6. Run **05**, then type `UPLOAD carriegabaree.com`. It requires a clean project matching GitHub, rechecks the build, and saves the uploaded version ID. It does not make that version live.
7. Run **06** only when ready to go live. It displays the Worker, commit and version. Type `PUBLISH carriegabaree.com`. It publishes **only the version saved by step 05** at 100% traffic, not an arbitrary latest version.
8. Run **07**, then review the changed pages in your browser. Automated checks are not a full visual, accessibility or performance audit. They do not send contact inquiries.

Each step is separate. Clicking a step does not automatically execute later steps. Blank or incorrect approval cancels the action. If you change source files after step 05, commit and push them and repeat step 05 before publishing. If a step fails, stop and inspect the output; there is no force push or automatic rollback.

## Setup and boundaries

### Archive content updates

**Use 09 only when adding, changing or removing Search records. Skip it for normal website edits.** It prints quick instructions in the Run console; no separate popup is needed.

1. In the private editor, approve additions/edits or withdraw website approval for removals.
2. Download fresh **approved website data** after the changes. Use the complete approved collection, not a database backup.
3. Run **09 - SEARCH RECORDS ONLY - Add, change or remove (not live)**. Paste the download's full path; quotes, spaces and numbered download filenames are supported.
4. Review the added, changed, removed and unchanged record counts. Confirm with the phrase shown. Blank input or a different phrase cancels without changing either snapshot. An empty export requires a separate remove-all confirmation.
5. Optionally run **10** to review Search locally. Step 09 prepares both the preview data and the website snapshot from the same file.
6. Run **02 → 03 → 04 → 05 → 06 → 07**. Only **06** makes the change live. Review all files shown by 03; it can include other website edits too.

The database is never edited or deleted by 09. It does not commit, push, upload, publish or change DNS. If the Run console cannot accept input, open WebStorm Terminal, run `nvm use`, then `npm run site:search-records`.

### Scan live source content instead of downloading an export

Use **11 - SEARCH SOURCES - Scan, review and optionally publish** when public pages, PDFs or transcripts have been added or changed. Use **09** for a manually downloaded approved export. Ordinary design/code updates need neither step.

1. Run **11**. It reads the live sitemap, known source URLs and same-site content links. Generated Search results, contact/privacy/utility pages, private endpoints, external hosts and media binaries are excluded. PDFs are supported; this does not transcribe audio/video or perform OCR.
2. Open the printed `review.txt` path in WebStorm. It contains the previous and proposed full text. Review the original PDFs where extraction warnings appear. Linked full magazine issues are not automatically approved merely because a short article excerpt is already approved.
3. Enter only the numbered changes you want (for example `1,3`), or leave blank to skip database updates. Enter your configured editor email for attribution, acknowledge any source warnings, and type the explicit database confirmation. **Selected additions/updates approve their full text for website publication.** Existing titles, descriptions and relationships are retained. Restricted records and ambiguous mappings are blocked. Withdrawals retain the database record and text; a missing link, timeout or server error never deletes a record.
4. Before writes, the workflow rechecks source bytes and downloads a current private database backup. It restores and checks that backup locally. Each record update is transactional and rejects concurrent changes to the reviewed record or text. Multiple selected records are separate transactions: if a later record fails, earlier completed records remain saved. The private receipt shows what completed; do not blindly retry after an uncertain network result.
5. The workflow retrieves a fresh approved-only snapshot and asks before preparing the website files. No manual export handoff is needed. If the snapshot already matches, no release is offered.
6. Optionally type `CONTINUE TO RELEASE`. Steps **02–07** then run in order, retaining their individual Git, upload and live-publication confirmations. The Git step lists **all** non-ignored changes; cancel if unrelated work is present. Blank/cancel stops further actions, not previously completed actions. Database approvals are rechecked during release and immediately after the final publication confirmation; stale data stops the release.

For a read-only discovery run:

```sh
npm run site:search-sync -- --scan-only
```

This writes only private local review files. It does not change D1, website input, Git, Cloudflare deployments or DNS. The workflow is on-demand, not scheduled, and does not deploy the private editor. Public Search remains a static approved snapshot rather than a live database connection.

#### Local prerequisites and recovery

- Use the pinned Node version and installed project dependencies. PDF extraction needs Python with `pypdf` (validated with 6.10.0). The existing bundled Python is detected if available; another computer can use its own Python installation.
- By default the adjacent `carrie-archive-admin` project supplies the private database identity and allowed editor emails from its ignored `wrangler.local.jsonc`. The account must match this site's publishing account. An email entered for the audit trail is attribution, not a substitute for authentication: database access uses the existing scoped Keychain credential.
- To override the admin project/Python paths, copy the structure in `search-sync-settings.example.json` into the ignored `.local/search-sync-settings.json` and enter real local paths. Never put a token into that file. Missing Keychain access stops the process; credentials are never printed, exported or committed.
- Reviews, backups and completion receipts live in ignored `.local/search-sync/<run>/`, with owner-only file permissions. They contain private data. Keep them out of Git and public assets. They are recovery snapshots, not a second editable database.
- Database text can be restored from the verified backup only through a separately reviewed recovery operation; there is no automatic rollback. Previous website versions remain available through the normal release process.
- If a run is interrupted, stop any remaining process first. Inspect `.local/search-sync/running.lock`; remove only that stale lock if no scan is running. Start a fresh scan instead of applying an old plan. Never re-run the initial workbook importer over the live database.

Database operations use the documented [D1 batch-query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), with bound values and bounded text payloads.

The manual import remains available as an alternative:

```sh
npm run archive:import -- /ABSOLUTE/PATH/carrie-archive-approved.json --publish
```

Then follow steps **02–07** above. All normal builds include the committed snapshot, so another computer can reproduce the release without access to the private database. Edits or withdrawn approvals reach the public site only after a fresh export, import and release.

### PDF reading-text cleanup — step 12

Use **12 - PDF TEXT ONLY - Clean and review (not live)** only for extracted publication text, not ordinary website edits or oral histories.

1. Choose publication numbers. The tool checks the source PDF checksum and writes private before/after reports plus editable candidate JSON under `.local/pdf-text-review/`.
2. Open those files in WebStorm while the workflow waits. Change only each segment's `content`; keep every segment number and PDF page label. Compare the complete candidate with the original PDF. Layout-based reflow preserves uncertain boundaries; ambiguous hyphenation, headings and reading order still need review. The verified small-cap author-name repair preserves the accent in the printed source.
3. Enter your configured editor email, then type `SAVE REVIEWED PDF TEXT` only when satisfied. A restored-and-verified private backup is made first. Concurrent metadata/source/review changes abort the save.
4. The original extraction remains intact. A separate reading edition and its revision history are saved without changing website approval. Confirm local Search preparation when prompted, preview with step 10, then use the normal checks and steps 03–07 when ready to release. Step 12 itself never publishes or pushes Git.

Setup requires the private archive editor's reviewed-text migration (`0003_reviewed_text.sql`) and matching Worker support. Install them together after a verified backup; the matching schema is included in `scripts/reviewed-text-schema.sql`. The configured Python environment needs `pdfplumber` in addition to `pypdf`. Existing reviewed text is the starting point for future edits. Step 11 leaves unchanged sources alone and blocks changed sources that have reviewed text. A changed PDF needs deliberate source reconciliation and a new review, not rerunning an initial import. The private editor can display both reading text and the preserved original extraction. Export fails closed for stale reviewed editions; it never silently falls back to old raw text.

### Deployment boundaries

- Repository: `timgabaree/carriegabaree.com-astro`; release branch: `main`.
- Production Worker: `carriegabaree-com-astro-production`; account: `YOUR_CLOUDFLARE_ACCOUNT_ID`.
- These WebStorm configurations select Node **24.22.1** from your existing nvm installation. On another computer, install the version in `.nvmrc` and adjust the interpreter if needed.
- For a fresh checkout or changed dependencies, run `nvm use` then `npm ci` in this project's Terminal. Stop if installation fails. Existing dependencies are not automatically reinstalled on every preview.
- Run **08** only if Cloudflare says you need to sign in. Credentials remain in the existing Cloudflare login storage; never enter API keys in these scripts or Git.
- Upload and publish use version-only commands. They do **not** deploy routes, edit DNS or touch GoDaddy. They affect only this website. Changes to bindings, migrations, domains, routes or secrets need a separate reviewed procedure.
- Build files, upload receipts and local evidence are not committed. Receipts are in the ignored `.website-workflow-local/` folder. GitHub gets source files, original assets, scripts and notes—not `node_modules`, generated builds, passwords or API keys. Filename checks are an extra guard, not a complete secret scanner; review all changes yourself.
- Notes-only updates need steps **03–04**, not a website deployment. These buttons intentionally target production, not protected staging.
- Carrie's original `test:site` is a migration parity audit against the old site. It is intentionally not a release gate for future editorial changes. The workflow uses current code/unit tests, build-safety checks and the live verification suite; the legacy audit remains available separately.

## Troubleshooting

- **No buttons yet?** Reopen this project or use `package.json` → the npm tool window. Shared configurations live in `.run/` and are safe to commit.
- **Wrong branch / repository?** Stop and select the correct Astro project. Do not rename a branch or change a remote just to silence the check.
- **Push rejected?** Another revision may be on GitHub. Review and reconcile it normally; never force push to make this workflow pass.
- **Missing saved upload?** Run step 05 again. It must complete before step 06 can publish.
- **Source changed after upload?** Commit, push and upload the updated revision. A newer GitHub commit does not change a saved Cloudflare version.
- **Live check failed?** Record the error and inspect the page. Do not blindly rerun the publishing action. Cloudflare keeps prior versions for a separately reviewed rollback.
