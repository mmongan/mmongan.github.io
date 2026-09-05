# Babylon.js Quest 3 WebXR Demo

This project is a simple Babylon.js scene that supports both VR and AR sessions for a Meta Quest 3 headset.

## Run locally with Vite

From this project folder, install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Then open:

- http://localhost:5173 on your development machine
- http://<your-computer-ip>:5173 from the Meta Quest browser

For headset usage, the site should be served over localhost or a local network address. If the Quest browser blocks some permissions, try opening it on the headset with the same local IP.

## Build for production

```bash
npm run build
```

## Features

- Babylon.js 3D scene
- VR launch button for immersive VR
- AR launch button for immersive AR
- Quest-friendly UI and simple interactive environment

## Notes

- WebXR requires a browser with XR support and a compatible headset.
- Quest 3 users should open the page in the Meta Quest Browser or another XR-capable browser.
- Some features may require the browser to be granted permission to access the headset's camera for AR.
