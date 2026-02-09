# mmongan.github.io

[![Build and publish](https://github.com/mmongan/mmongan.github.io/actions/workflows/build-and-publish.yml/badge.svg?branch=main)](https://github.com/mmongan/mmongan.github.io/actions/workflows/build-and-publish.yml)

A small demo site that provides a Babylon WebXR floating menu. The repository publishes compiled `dist` assets to the repository root (main) so the site can be served by GitHub Pages as a user/org site.

## Quick workflows

- Build locally and copy compiled files into the repo root:

```bash
npm run build:publish-local
```

- Trigger a manual build on GitHub Actions: open the workflow run page and click `Run workflow` (or push to `main` to auto-trigger).

## Notes

- The build-and-publish GitHub Actions workflow runs on pushes to `main` (source file changes) and on manual dispatch. It builds, copies `dist/index.html` and `dist/assets/*` to the repository root, commits them and pushes back to `main`.
