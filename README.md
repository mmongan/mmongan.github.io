# Chartxr: WebXR Marching Band Drill Designer

A browser-based marching band drill designer built with Babylon.js. Create and edit robot formations and paths on a football field, then preview synchronized movement in a 3D stadium. The scene supports desktop browsers and immersive VR or AR on compatible headsets such as Meta Quest 3.

## Run locally with Vite

From this project folder, install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Then open:

- http://localhost:5173 on your development machine
- http://<your-computer-ip>:5173 from the Meta Quest browser

For headset testing, open the local address in an XR-capable browser. WebXR features require a secure context: localhost is suitable for local development, while access from another device generally requires HTTPS. The deployed GitHub Pages site is served over HTTPS.

## Build for production

```bash
npm run build
```

To serve the production build locally:

```bash
npm run preview
```

## Deploy to GitHub Pages

```bash
npm run deploy
```

Builds the project, copies `dist/` into the repository root, then commits and pushes the generated `index.html` and `assets/` to `origin main`. The command refuses to run unless the current branch is `main`. It makes a Git commit and pushes automatically, so use it when you intend to publish.

## Features

- Stadium environment with turf, field markings, stands, goal posts, scoreboard, and a video board
- The video board always displays a live orthographic field view, following field movement, rotation, and scale in desktop, VR, and AR modes
- High school, college, and NFL field-marking layouts
- Draw robot paths with a controller trigger; extend existing paths, select robots, and edit path or formation segments with in-scene handles
- Place standing robots, create marching formations, and generate a synchronized marching-band drill
- Shared count-based playback with play/pause, rewind, fast-forward, single-count stepping, and timeline seeking; playback controls are available on the video board and the palm-up VR controller menu
- Collision-marker previews and controls for showing paths and testing larger robot groups
- Immersive VR with teleport locomotion and immersive AR with the stadium scaled to a tabletop
- At any field scale, point a tracked hand at it and pinch to teleport: VR moves the viewer; AR moves the selected field spot beneath the viewer without moving the headset or changing the field height. Teleport preserves the field scale. The controller teleport torus scales with the field; teleport pauses during floor calibration.
- In VR or AR, use both controllers to move, rotate, and scale the stadium between tabletop and full size
- Floor calibration only runs when explicitly enabled using the Floor calibration checkbox; entering XR, teleporting, and touching the floor do not start it automatically

## Project structure

```
src/
  index.html         entry HTML, HUD, and settings overlay
  style.css          page and overlay styling
  camera/
    desktopCamera.ts desktop spectator camera and intro
    playerAvatar.ts  tracked-player body and height calibration
  environment/
    sky.ts           skybox
    ground.ts        horizon ground plane
  field/
    constants.ts     field dimensions and per-level configs (NFL/college/high school)
    footballField.ts assembles the field pieces
    turf.ts           field turf mesh/materials
    markings.ts       hash marks and yard numbers
    goalPosts.ts      goal posts
    stands.ts         bleacher/stand geometry
    scoreboard.ts     scoreboard
    videoBoard.ts     video board and playback display
  interaction/
    sceneInteraction.ts controller and pointer input, robot paths, formations, and stadium manipulation
  menu/
    handMenu.ts      palm-up controller playback menu
    settings.ts      settings overlay interactions
  robot/
    robot.ts         robot models, path registration, and synchronized playback
    collisionMarkers.ts collision previews
    drill.ts         synchronized drill path planning
  scene/
    index.ts         sole TypeScript application entrypoint and render loop
    engine.ts        Babylon engine and scene setup
  ui/
    dom.ts           shared DOM references for application controls
  xr/
    ar.ts            AR tabletop transforms and scene scaling
    webXR.ts         VR/AR session setup, teleportation, and controllers

scripts/
  deploy.mjs               publishes the production build to GitHub Pages
  simulate-drill-sync.mjs  standalone drill synchronization experiment
```

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).

Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>

## Notes

- WebXR requires a browser with XR support and a compatible headset.
- Quest 3 users should open the page in the Meta Quest Browser or another XR-capable browser.
- Some features may require the browser to be granted permission to access the headset's camera for AR.
