# Deploy workflow: Build from `gates` and publish to repository root

This repository is configured to serve GitHub Pages from the `main` branch root. The workflow below helps build the site from a separate source repository (for example `mmongan/gates`) and copy the built artifacts into this repo root so Pages serves the latest output.

IMPORTANT — DO NOT USE `gh-pages` BRANCH ⚠️
- This repository must serve GitHub Pages from the `main` branch root. Do **not** create or push a `gh-pages` branch in this repo — it will confuse Pages and can cause stale content to be served.
- If a `gh-pages` branch exists, the automated workflow will fail and notify you so you can remove the `gh-pages` branch and continue with `main`-root deployment.

Files and purpose:
- `.github/workflows/deploy-from-gates.yml` — GitHub Actions workflow which can be triggered manually (Workflow Dispatch). It checks out the source repo, builds it, verifies the token, copies built files to this repo root, updates a cache-bust stamp in `index.html`, and commits the result.
- `scripts/publish-to-root.ps1` — local helper to clone a source repo, run its build, validate the build contains an expected token (default `menuDebugTex`), copy `index.html` and `assets/` into this repo root, and commit the changes.

Usage (manual):
- Run locally: `pwsh .\scripts\publish-to-root.ps1 -SourceRepo "mmongan/gates" -SourcePath "." -BuildDir "dist"`

If you want the workflow to trigger automatically on pushes to `main` in the source repo, configure the workflow inputs or adjust the trigger in the workflow YAML. If the source repo is private, create a secret `SOURCE_REPO_TOKEN` with a Personal Access Token that can read the source repo.

Notes:
- The workflow intentionally checks for an existing `gh-pages` branch and will fail early if it detects one. This prevents accidental double-deploy workflows that publish outdated content to GitHub Pages.
- Commits made by the workflow include `[skip ci]` in the commit message to avoid CI loops when the workflow writes build artifacts back to `main`.
