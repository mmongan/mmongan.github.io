# Babylon.js Quest 3 WebXR Demo

This project is a simple Babylon.js scene that supports both VR and AR sessions for a Meta Quest 3 headset.

## Run locally

From this project folder, start a static web server:

```bash
python -m http.server 8000
```

Then open:

- http://localhost:8000 on your development machine
- http://<your-computer-ip>:8000 from the Meta Quest browser

For headset usage, the site must be served over a secure context or localhost. Localhost works when opened on the same machine, but when using the Quest browser it is usually best to use the local machine's LAN IP.

## Features

- Babylon.js 3D scene
- VR launch button for immersive VR
- AR launch button for immersive AR
- Quest-friendly UI and simple interactive environment

## Notes

- WebXR requires a browser with XR support and a compatible headset.
- Quest 3 users should open the page in the Meta Quest Browser or another XR-capable browser.
- Some features may require the browser to be granted permission to access the headset's camera for AR.
