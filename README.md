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
- Hand and controller gestures do not draw or extend marching paths. Controller triggers select existing marchers and edit existing path or formation segments; enable Placement mode to place standing marchers with a controller trigger or fingertip touch. Sideline pinch creation and two-hand line, arc, and circle formations remain available.
- Place standing robots, create marching formations, and generate a synchronized marching-band drill
- Shared count-based playback with play/pause, rewind, fast-forward, single-count stepping, and timeline seeking; playback controls are available on the video board and the palm-up VR controller or tracked-hand menu
- Collision-marker previews and controls for showing paths and testing larger robot groups
- Immersive VR with teleport locomotion and immersive AR with the stadium scaled to a tabletop
- In VR floor/Giant mode, teleport using controllers only. Hand gestures never teleport. Controller teleport is disabled during floor calibration, in tabletop mode or AR, and whenever the field is smaller than 2 meters along its longest side. It preserves field scale, and its target scales with the field.
- In VR or AR, use both controllers to move, rotate, and scale the stadium between tabletop and full size. Shrinking with controllers or tracked hands across the default tabletop size (a 1-meter-long field) raises the field to the configured Table height; continued resizing preserves that height unless you move your hands vertically.
- Giant mode fits the field uniformly inside the configured room width and length (1-50 meters each; defaults to 4 by 5 meters). Use the Giant mode button in settings; changing room dimensions while active updates the fit. Field height and rotation are preserved, and tabletop/full-scale buttons exit Giant mode. Dimensions describe the field footprint, not the surrounding stadium or a detected safety boundary.
- Tracked hands use Babylon.js skeleton-skinned hand meshes, mapped to WebXR joint bones and rendered with an off-white marching-band glove material in VR and AR.
- In VR or AR, pinch with both tracked hands outside the field to translate, rotate, and zoom the scene: move the midpoint to translate, turn the hands to rotate, and change their separation to scale. Both pinch points must remain outside the field. Zooming scales around the hands horizontally while keeping the field surface at its current height, except when shrinking across the tabletop-size threshold applies the configured Table height. Release either pinch to stop; two-hand manipulation does not start while a hand is holding a marcher.
- In VR or AR at any scale, pinch near a marcher with one hand to grab it, move your hand, and release to place it on the field. Turn your hand while pinching to rotate the marcher to face any direction. Pinching empty space above the stadium ground creates a marcher in your hand; move it onto the field and release to place it. Empty-space pinches outside the stadium ground do not create marchers. While holding a marcher, pinch it with your other hand and pull away: marchers appear in the air along the pulling hand's traced curve. Pull straight for a line, trace an arc for a curved formation, or trace a circle back to the starting marcher to close the loop without duplicating the first marcher. While shaping, move the pulling pinch onto a preview marcher and push or pull it to bend that part of the chain; nearby marchers follow smoothly. Release the pulling hand to finish shaping, then move and rotate the formation with the anchor hand. Releasing the anchor leaves the formation floating: pinch any of its marchers to pick up and reposition the whole formation, as often as needed. Turn a hand palm-up and pinch near its Commit button to project the formation onto the field; controller triggers can also activate Commit. The button appears only after shaping is finished. Releasing the anchor before finishing shaping cancels the formation. Losing tracking while holding the formation cancels it; a released floating formation persists until committed or the XR hand-tracking session resets.
- In tabletop mode, grip a marcher with a controller, then turn the controller while holding it to rotate the marcher; release the grip to place it.
- Grabbed marchers and airborne formation previews render in front of tracked hands and controller models so they stay visible. Released or canceled marchers return to normal depth rendering.
- Uncommitted formations have a cyan outer glow while shaping, floating, or being repositioned. Committing or canceling removes the glow.
- Touch an on-field marcher with an unpinched index fingertip and push to slide only that marcher, keeping its feet on the field and its facing unchanged. Both hands can push different marchers in different directions simultaneously. Moving the finger away stops the push; pinching switches to normal grabbing. This does not draw a marching path or move the rest of a formation.
- Closing a two-hand formation loop snaps the traced shape to a perfect horizontal circle through the held marcher, with evenly spaced marchers and no duplicate at the join. Both the airborne preview and the placed editable formation use the fitted circle; open arcs keep their traced shape.
- To resize an existing circle with tracked hands, pinch two different marchers on that circle and move your hands apart or together. The circle stays centered and circular, with marchers respaced as its radius changes. Release either pinch to keep the new size; losing hand tracking or enabling floor calibration cancels the resize.
- Floor calibration only runs when explicitly enabled using the Floor calibration checkbox; entering XR, teleporting, and touching the floor do not start it automatically
- Separate Floor height (-2 to 2 m) and Table height (0 to 2 m) sliders set the field surface height. Full-scale and Giant mode apply the floor setting; tabletop mode applies the table setting. Values are remembered during the session, defaulting to 0 m and 1 m respectively; adjusting a height does not start calibration.
- At 1:1 VR scale, the horizon ground follows the field's position while remaining below the turf. It stays world-sized and is hidden at reduced scales and in AR.
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
    constants.ts     field dimensions and per-level configs
    footballField.ts assembles the field pieces
    goalPosts.ts     goal posts
    markings.ts      hash marks and yard numbers
    scoreboard.ts    scoreboard
    stands.ts        bleacher/stand geometry
    turf.ts          field turf mesh/materials
    videoBoard.ts    video board and playback display
  interaction/
    controllers.ts   controller input and gesture state
    handInteraction.ts hand tracking and manipulation logic
    pathInteraction.ts robot path editing, formations, and stadium manipulation
  menu/
    handMenu.ts      palm-up controller playback menu
    settings.ts      settings overlay interactions
  robot/
    collisionMarkers.ts collision previews
    drill.ts         synchronized drill path planning
    robot.ts         robot models, path registration, and synchronized playback
  scene/
    engine.ts        Babylon engine and scene setup
    index.ts         sole TypeScript application entrypoint and render loop
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
