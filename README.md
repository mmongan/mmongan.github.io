# Babylon WebXR AR Menu

Minimal Vite + TypeScript demo that starts a Babylon.js WebXR AR session and shows a floating menu to spawn shapes.

Quick start

1. Install:

```bash
npm install
```

1. Run dev server:

```bash
npm run dev
```

1. Open the served page on an AR-capable device (HTTPS or via localhost) and start an AR session.

Notes

- You need a device and browser with WebXR AR support (e.g., recent Chrome on Android with ARCore, served over HTTPS).
- This project uses Babylon.js WebXR hit-test to place items on surfaces. If hit-test is unavailable the menu will spawn objects in front of the camera.

Deployment to GitHub Pages

- To publish to `https://mmongan.github.io`, create a repository named `mmongan.github.io` and push this project to it, or configure Pages on an existing repo.
- Quick deploy using `gh-pages` (pushes build to `gh-pages` branch):

```bash
npm install --save-dev gh-pages
npm run predeploy
npm run deploy
```

- Or use the included GitHub Actions workflow: push to `main` (or `master`) and the workflow will build and publish `dist` to GitHub Pages. Ensure the repository is `mmongan.github.io` or configure Pages accordingly in repository settings.
