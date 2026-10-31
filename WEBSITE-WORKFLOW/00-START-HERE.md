# carriegabaree.com — Website update buttons

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

- Repository: `timgabaree/carriegabaree.com-astro`; release branch: `main`.
- Production Worker: `carriegabaree-com-astro-production`; account: `7459bd2037d71d23fd030e3542b9df61`.
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
