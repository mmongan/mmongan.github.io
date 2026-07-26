# Babylon.js WebXR Immersive-AR Boilerplate

A minimal, ready-to-run **Babylon.js + Vite + TypeScript** project for building
WebXR Immersive-AR experiences in the browser.

---

## Features

| Feature | Detail |
|---|---|
| **Immersive-AR session** | Transparent background passthrough |
| **Hit-test** | Requested as an optional XR feature; graceful fallback if unavailable |
| **Tap-to-place** | Coloured glowing spheres placed at the hit-test surface position |
| **Reticle** | Torus indicator aligned to the detected surface normal |
| **HTTPS dev server** | `vite-plugin-mkcert` auto-generates a local trusted certificate |
| **LAN-exposed** | Dev server binds to `0.0.0.0` so a phone/headset on the same Wi-Fi can connect |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (HTTPS, LAN-exposed)
npm run dev
```

Then open `https://<your-machine-ip>:5173` on your AR-capable device.

> **Why HTTPS?**  
> The WebXR API is only available in secure contexts. `vite-plugin-mkcert`
> handles certificate generation automatically on first run.

---

## Project Structure

```
BabylonAR/
├── index.html          # Shell HTML with canvas + AR overlay UI
├── package.json        # npm scripts & dependencies
├── tsconfig.json       # TypeScript config (ESNext, strict)
├── vite.config.ts      # Vite + mkcert + LAN host
└── src/
    └── main.ts         # Scene setup, WebXR, hit-test, tap-to-place
```

---

## Babylon.js Packages Used

| Package | Purpose |
|---|---|
| `@babylonjs/core` | Engine, Scene, Camera, Meshes, WebXR |
| `@babylonjs/loaders` | glTF/GLB model loading (ready to use) |
| `@babylonjs/materials` | PBR + node materials |

---

## Extending the Project

- **Load a glTF model** — import `SceneLoader` from `@babylonjs/loaders` and call  
  `SceneLoader.ImportMeshAsync(...)` inside `placeObject()`.
- **Plane detection** — enable `WebXRFeatureName.PLANE_DETECTION` via `featuresManager`.
- **Anchor API** — persist placed objects across sessions with  
  `WebXRFeatureName.ANCHOR_SYSTEM`.
- **Light estimation** — match real-world lighting with  
  `WebXRFeatureName.LIGHT_ESTIMATION`.

---

## Browser / Device Support

| Browser | AR Support |
|---|---|
| Chrome for Android 81+ | ✅ Full hit-test |
| Samsung Internet 11.2+ | ✅ Full hit-test |
| Safari (iOS) | ⚠️ WebXR polyfill required |
| Meta Quest Browser | ✅ Passthrough AR |
| Desktop browsers | ❌ No `immersive-ar` support |

---

## License

MIT — use freely for personal or commercial projects.
