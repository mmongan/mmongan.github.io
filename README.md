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
- In VR floor/Giant mode, point a tracked hand at the field and pinch to teleport. Teleport preserves the field scale, and the controller teleport torus scales with the field. Teleport pauses during floor calibration and is disabled in tabletop mode, in AR, and whenever the field is smaller than 2 meters along its longest side, for both hands and controllers.
- In VR or AR, use both controllers to move, rotate, and scale the stadium between tabletop and full size
- Giant mode fits the field uniformly inside the configured room width and length (1-50 meters each; defaults to 4 by 5 meters). Use the Giant mode button in settings; changing room dimensions while active updates the fit. Field height and rotation are preserved, and tabletop/full-scale buttons exit Giant mode. Dimensions describe the field footprint, not the surrounding stadium or a detected safety boundary.
- Tracked hands use Babylon.js skeleton-skinned hand meshes, mapped to WebXR joint bones and rendered with an off-white marching-band glove material in VR and AR.
- In VR or AR, pinch with both tracked hands to translate, rotate, and zoom the scene: move the midpoint to translate, turn the hands to rotate, and change their separation to scale. Zooming scales around the hands horizontally while keeping the field surface at its current height, so the field stays in view up to full 1:1 size. Release either pinch to stop; two-hand manipulation takes priority over drawing and teleport, but does not start while a hand is holding a marcher.
- In VR or AR at any scale, pinch near a marcher with one hand to grab it, move your hand, and release to place it on the field. In Placement mode, pinch within 15 cm above the field to create a new marcher. While holding a marcher, pinch another marcher with your other hand to carry both, or pinch the held marcher with your other hand to pass it across; neither starts two-hand scene manipulation. Losing hand tracking cancels the grab and discards unplaced new marchers.
- Floor calibration only runs when explicitly enabled using the Floor calibration checkbox; entering XR, teleporting, and touching the floor do not start it automatically
- Separate Floor height (-2 to 2 m) and Table height (0 to 2 m) sliders set the field surface height. Full-scale and Giant mode apply the floor setting; tabletop mode applies the table setting. Values are remembered during the session, defaulting to 0 m and 1 m respectively; adjusting a height does not start calibration.
- Sitting mode selects a 0.75 m tabletop and 1.2 m virtual eye height; Standing selects 1 m and 1.7 m. The tabletop slider remains adjustable afterward. Eye-height offsets apply only in VR, preserve subsequent physical head movement, and are retained by teleport; AR headset tracking is unchanged.

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
    gloveMeshes.ts   rigged glove meshes and WebXR joint-to-bone mappings
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
- The left and right hand mesh assets are from [BabylonJS/Assets](https://github.com/BabylonJS/Assets/tree/master/meshes/HandMeshes), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Their rigged geometry is used with an off-white glove material.
