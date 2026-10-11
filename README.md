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

To check eraser undo/redo behavior (Node.js 22.13 or newer):

```bash
node scripts/check-erase-history.mjs
```

To check automatic gait selection:

```bash
node scripts/check-gait-selection.mjs
```

## Deploy to GitHub Pages

```bash
npm run deploy
```

Builds the project, copies `dist/` into the repository root, then commits and pushes the generated `index.html` and `assets/` to `origin main`. The command refuses to run unless the current branch is `main`. It makes a Git commit and pushes automatically, so use it when you intend to publish.

## Features

- The startup video board displays the application version from `package.json`, alongside the build timestamp.
- Stadium environment with turf, field markings, stands, goal posts, scoreboard, and a video board
- The video board always displays a live orthographic field view, following field movement, rotation, and scale in desktop, VR, and AR modes
- High school, college, and NFL field-marking layouts
- Hand and controller gestures do not draw or extend marching paths. Controller triggers select existing marchers and edit existing path or formation segments; enable Placement mode to place standing marchers with a controller trigger or fingertip touch. Sideline pinch creation and two-hand line, arc, and circle formations remain available.
- Place standing robots, create marching formations, and generate a synchronized marching-band drill
- The app opens with the bundled example OpenMarch show (below) already marching. If it cannot be loaded, it falls back to a generated drill, which starts on the half of the field you are looking at. The generated drill's block is arranged in band sections by rank, front to back: flutes, clarinets, saxophones (baritones on the ends, altos inside), mellophones, trumpets, trombones, low brass (euphoniums in the centre, sousaphones on either side), and a drumline (glockenspiels on the ends, bass drums inside them, then tenors, snares in the centre). Marchers turn smoothly through each count instead of snapping to a new facing. Use Settings → Generate marching band drill to regenerate it, or the eraser to clear marchers
- Open an [OpenMarch](https://openmarch.com) show from a URL: paste a `.dots` link into Settings → Open OpenMarch show and press Open, or share a link such as `https://mmongan.github.io/?openmarch=https://example.com/show.dots` to open it on startup. GitHub file-page and Dropbox share links are converted to direct downloads; other hosts must allow cross-origin downloads (CORS). The show replaces the field and plays from its first set: each page's dots become count positions (moves are straight lines through any midsets), marchers get the closest instrument for their OpenMarch section (unknown sections keep the selected instrument), and the tempo comes from the show's beats, limited to Chartxr's 60–120 BPM range. The SQLite reader (sql.js) only downloads the first time a show opens.
- Press Settings → Load example OpenMarch show (or share `?openmarch=example`) to reopen the bundled 40-marcher OpenMarch show that plays on startup: a block that spreads into a company front, curves into an arc, folds into a chevron, and closes back into the block over 64 counts at 120 BPM, with every band section represented. Regenerate it with `node --experimental-strip-types scripts/make-openmarch-example.mts`.
- Marchers are robots with a low-poly humanoid android head: a flat-shaded pale faceted skull tapering to a jaw and chin, a brow ridge over dark eye sockets with glowing cyan irises, a nose, a mouth slit, and disc ears, under the shako and plume.
- Marcher bodies are simplified for Meta Quest: every part comes from a shared low-poly, vertex-colored template. The pelvis, neck, head, shako, and plume are merged into one mesh, and each arm segment includes its own joint ball. A marcher (with its trumpet) is 17 meshes and about 1,300 vertices, down from 26 meshes and about 4,500 vertices. Every part is drawn with hardware instancing: each template has one hidden instance source and the team color is a per-instance color, so the whole band renders in a few dozen draw calls. With 80 marchers on the field, draw calls drop from about 1,360 to about 90, and desktop frame time falls from about 10.4 ms to 6.9 ms. Top-down video-board markers are instanced too. While a marcher is held or previewed, its parts temporarily become ordinary clones so they can render on top in a separate rendering group. They switch back to instances when released.
- Static stadium geometry is kept light. Stand risers, benches, and walls, as well as goal-post parts, are merged into one mesh per material. The field is a single quad, the video-board hash marks are flat quads, and path tubes are simplified (Ramer–Douglas–Peucker) before tessellation. Without the marchers, the static scene dropped from about 78,000 to 16,000 vertices. Draw calls fell from 87 to 61.- In Giant and tabletop modes (any time the field is shrunk below full scale) marchers and instruments switch to low-detail versions of the same templates: tubes and caps become triangular, body lathes have half the sides, the head is a smooth hexagonal skull with eye sockets, and small details (valve buttons, keys, ligature, nose, brow, mouth, ears) are skipped. A trumpet marcher drops from about 1,300 to about 430 vertices. Existing marchers swap geometry in place when the scale changes, and new marchers and instrument changes use the current level.
- Instrument tubes are seam-free: bends are mitered so they never pinch, each bell flares straight on from its pipe as one tube, mouthpieces sit inside straight receivers, tube ends finish inside valve blocks and braces, and the sousaphone's body loop is closed. Marcher joints are seamless too: shoulders, elbows, hips, and knees bend around rounded caps, and the forearm stretches slightly when a grip is just out of reach, so wrists stay attached to the hands.
- Marchers hold their instrument with both glove hands in playing and carry poses, with articulated elbows connecting their sleeves to the instrument's grip points.
- Trumpets are a minimal B♭ horn sized for Meta Quest: mouthpiece, leadpipe and tuning slide, valve block with three pearl buttons, bell bow, and flared bell at true proportions. Every horn is an instance of one shared, hand-indexed 91-vertex mesh with a single vertex-colored material, so all trumpets share one draw call. The left hand wraps the valve casings and the right hand rests on the buttons.
- Mellophones use the same style and right-handed valve layout as the trumpet, with a longer leadpipe, a deeper tuning-slide wrap, and a much larger forward bell, as one shared 91-vertex mesh. They are held like a trumpet when played and carried upright with the bell down.
- Alto saxophones use the same style: a conical body, bow and upturned bell in one hexagonal tube, a curved neck, a black mouthpiece, and pearl key stacks, as one shared 81-vertex mesh. The left hand sits on the upper key stack and the right hand on the lower; when played, the horn hangs down and slightly out to the marcher's right.
- Baritone saxophones are about one and a half times the alto's size, with a wider bore and bell and the characteristic looped neck above the body (129 vertices). They are held further out to the marcher's right.
- Euphoniums are carried like the mellophone with a large front-facing bell, wrapped leadpipe, valve block, and three pearl valve buttons (97 vertices).
- Trombones use the same style: mouthpiece, a forward slide with its crook and silver slide stay, and a bell section whose tuning slide passes over the marcher's left shoulder, as one shared 83-vertex mesh. The left hand grips the brace by the mouthpiece and the right hand holds the slide stay at first position. In the carry pose the trombone is held upright with the slide pointing down.
- Clarinets use the same style: a black mouthpiece with a silver ligature, barrel, straight body with silver front key clusters, and a flared bell, as one shared 91-vertex mesh. They are played angled about 40° below horizontal, with the left hand on the upper joint and the right hand on the lower joint, and carried upright in front of the chest.
- Flutes use the same style: a silver head joint and body with a lip plate, a dark embouchure hole, and front key rows, as one shared 57-vertex mesh. They are played level out to the marcher's right, with the lip plate under the mouth grille, the foot angled slightly forward, and the left hand crossing in front of the chin with its elbow swung out to the side, clear of the chest. They are carried upright with the crown up.
- Sousaphones are worn rather than held, as one shared 87-vertex brass mesh: a tilted body loop rests on the left shoulder and passes under the right arm, a gooseneck reaches the mouth, and the bell faces forward above the shako. The right hand sits on the valves and the left hand on the front of the loop; playing and carrying use the same pose.
- Percussion is worn on a carrier in the same style, with the sticks or mallets in the marcher's hands: a silver snare drum with pearl heads (70 vertices), navy quad tenors with felt-tipped mallets (136 vertices), and a navy bass drum turned on its side with a felt mallet beside each head (86 vertices), and a glockenspiel with graduated silver bars, its sharps on a raised rail, and red-tipped mallets (124 vertices).
- Choose an instrument (Trumpet, Mellophone, Trombone, Euphonium, Sousaphone, Alto saxophone, Baritone saxophone, Clarinet, Flute, Snare drum, Tenor drums, Bass drum, or Glockenspiel) in Settings → Robot paths, or on the palm-up hand menu with the brass row (`Tpt`/`Mel`/`Tbn`/`Eup`/`Sou`), woodwind row (`Alto`/`Bari`/`Cl`/`Fl`), and percussion row (`Sn`/`Ten`/`BD`/`Glk`). The pick changes the selected marcher's instrument and is used for every marcher created afterwards. The active choice is highlighted on the hand menu.
- Automatic gait: when the scoreboard gait selector shows `AUTO` (Field March, High Step, Parade, or Knee-Ankle March style), each marcher's gait is worked out count by count from its facing, travel direction, and step size. A stationary count is mark time (high mark time for High Step/Knee-Ankle). Travel within 50° of facing marches forward in the selected style, beyond 130° is a backward march (backward high step for high-lift styles), and in between is a crab walk with legs along the line of travel. Steps shorter than 0.36 yd per count (for example 16-to-5) march half time, and steps longer than 1.05 yd (for example 4-to-5) double time, so the stride stays near 8-to-5. Marchers whose route has ended halt at attention. Selecting any other gait (Crab Walk, Slide, Mark Time, Double Time, Backward March, and so on) forces it on every marcher as before. With tracked hands, twist a scheduled marcher at least 20° while holding it to make it keep that facing for its whole route, so forward moves become slides or back-marches; twist it back toward its path to face the direction of travel again.
- Shared count-based playback with play/pause, rewind, fast-forward, single-count stepping, and timeline seeking; playback controls are available on the video board and the palm-up VR controller or tracked-hand menu. The hand menu's Form page offers Line, Arc, Circle, Block, Triangle, Square, Pentagon, Hexagon, and Star formations, plus A-Z letter formations, around the held or selected marcher.
- Collision-marker previews and controls for showing paths and testing larger robot groups
- Immersive VR with teleport locomotion and immersive AR with the stadium scaled to a tabletop
- In VR floor/Giant mode, teleport using controllers only. Hand gestures never teleport. Controller teleport is disabled during floor calibration, in tabletop mode or AR, and whenever the field is smaller than 2 meters along its longest side. It preserves field scale, and its target scales with the field.
- In VR or AR, use both controllers to move, rotate, and scale the stadium between tabletop and full size. Shrinking with controllers or tracked hands across the default tabletop size (a 1-meter-long field) raises the field to the configured Table height; continued resizing preserves that height unless you move your hands vertically.
- Giant mode fits the field uniformly inside the configured room width and length (1-50 meters each; defaults to 4 by 5 meters). Use the Giant mode button in settings; changing room dimensions while active updates the fit. In XR, the field surface follows the headset's local-floor reference rather than the Floor height slider, with physical eye height and rotation preserved. Tabletop/full-scale buttons and explicit floor calibration exit Giant mode. Dimensions describe the field footprint, not the surrounding stadium or a detected safety boundary.
- Tracked hands use Babylon.js skeleton-skinned hand meshes, mapped to WebXR joint bones and rendered with an off-white marching-band glove material in VR and AR.
- In VR or AR, pinch with both tracked hands outside the field to translate, rotate, and zoom the scene: move the midpoint to translate, turn the hands to rotate, and change their separation to scale. Both pinch points must remain outside the field. Zooming scales around the hands horizontally while keeping the field surface at its current height, except when shrinking across the tabletop-size threshold applies the configured Table height. Release either pinch to stop; two-hand manipulation does not start while a hand is holding a marcher.
- In VR or AR at any scale, pinch near a marcher with one hand to grab it, move your hand, and release to place it on the field. Turn your hand while pinching to rotate the marcher to face any direction. Pinching empty space above the stadium ground creates a marcher in your hand; move it onto the field and release to place it. Empty-space pinches outside the stadium ground do not create marchers. While holding a marcher, pinch it with your other hand and pull away: marchers appear in the air along the pulling hand's traced curve, constrained to a horizontal plane parallel to the field. Pull straight for a line, trace an arc for a curved formation, or trace a circle back to the starting marcher to close the loop without duplicating the first marcher. While shaping, move the pulling pinch onto a preview marcher and push or pull it to bend that part of the chain; nearby marchers follow smoothly. Release the pulling hand to finish shaping, then move and rotate the formation with the anchor hand. Releasing the anchor leaves the formation floating: pinch any of its marchers to pick up and reposition the whole formation, as often as needed. Turn a hand palm-up and pinch near its Commit button to place the formation on the field; controller triggers can also activate Commit. The button appears only after shaping is finished. Releasing the anchor before finishing shaping cancels the formation. Losing tracking while holding the formation cancels it; a released floating formation persists until committed or the XR hand-tracking session resets.
- In tabletop mode, grip a marcher with a controller, then turn the controller while holding it to rotate the marcher; release the grip to place it.
- Grabbed marchers and airborne formation previews render in front of tracked hands and controller models so they stay visible. Released or canceled marchers return to normal depth rendering.
- Uncommitted formations have a cyan outer glow while shaping, floating, or being repositioned. Committing or canceling removes the glow.
- Touch an on-field marcher with an unpinched index fingertip and push to slide only that marcher, keeping its feet on the field and its facing unchanged. Both hands can push different marchers in different directions simultaneously. Moving the finger away stops the push; pinching switches to normal grabbing. This does not draw a marching path or move the rest of a formation.
- Enable Erase marchers in settings or toggle the orange-highlighted Erase button in the palm-up menu. Click a marcher on desktop, aim and press a controller trigger, pinch near a marcher, or touch it with an unpinched index fingertip to delete only that marcher. Move the fingertip at least 4 cm before another touch deletion. Erase disables placement, grabbing, finger pushing, and two-hand scene manipulation, and pauses during floor calibration. Enabling it finishes pending formation placement so individual members can be erased. Deleted members stay missing when their formation is reshaped.
- Eraser deletions have a session-local undo/redo stack of up to 100 actions. Use Undo erase/Redo erase in settings, Undo/Redo in the palm-up menu, Ctrl/Cmd+Z to undo, or Ctrl/Cmd+Shift+Z (also Ctrl/Cmd+Y) to redo. Text inputs keep their native shortcuts. Undo restores the same marcher, formation membership, path, and count schedule; redo deletes it again. New erasures discard redo history. Reshaping/rebuilding a formation or path, and generating a replacement drill, clear deletion history; other editing actions are not undoable.
- Toggle the drill chart pad with the Chart button in the palm-up menu or the Drill chart pad checkbox in settings. A paper pad appears just below eye level in front of you and stays floating at room scale (it does not move or scale with the tabletop field). Each page is one 8-count set (plus the final count), drawn top-down like a paper drill chart: the field with yard lines and hashes, every marcher's dot for that set, and faint previous-set dots with dashed movement lines. Pinch the pad with a tracked hand, or squeeze a controller grip on/aimed at it, to grab it; it follows your hand's position and rotation and stays where you release it. Prev/Next on the pad (pinch, trigger, or click) flips pages and seeks playback to that set, and playback flips pages as it reaches each set.
- Two-hand hand-tracked formations are created in a horizontal plane parallel to the field. Trace an open curve for a smoothly spaced arc, or close the loop to fit a true horizontal circle through the held marcher. Pulling a marcher on a closed loop stretches or compresses the circle into an ellipse while keeping the anchor marcher fixed. Pulling the free end of an open arc outward progressively straightens the chain; dragging a marcher in the middle reshapes it locally.
- To resize an existing circle with tracked hands, pinch two different marchers on that circle and move your hands apart or together. The circle stays centered and circular, with marchers respaced as its radius changes. Release either pinch to keep the new size; losing hand tracking or enabling floor calibration cancels the resize.
- Floor calibration only runs when explicitly enabled using the Floor calibration checkbox; entering XR, teleporting, and touching the floor do not start it automatically
- Separate Floor height (-2 to 2 m) and Table height (0 to 2 m) sliders set the field surface height. Full-scale applies the floor setting; Giant mode uses the tracked local floor in XR; tabletop mode applies the table setting. Values are remembered during the session, defaulting to 0 m and 1 m respectively; adjusting a height does not start calibration.
- At 1:1 VR scale, the horizon ground follows the field's position while remaining below the turf. It stays world-sized and is hidden at reduced scales and in AR.
- Sitting mode selects a tabletop up to 0.75 m above the local floor; Standing selects up to 1 m. In XR, automatic placement lowers it as needed to stay 0.45 m below measured eye level, stopping at the floor. The tabletop slider remains adjustable afterward. Full-scale VR uses 1.2 m sitting and 1.7 m standing virtual eye heights; Giant and tabletop modes preserve physical eye height. AR headset tracking is unchanged.
- In VR and AR, physical headset height automatically selects sitting or standing table height after one second of stable detection. Initial detection uses 1.425 m; subsequent transitions use below 1.35 m for sitting and at least 1.5 m for standing. Tabletop entry also adjusts height immediately when a tracked pose is available. Automatic detection does not change virtual eye height, is paused during floor calibration, and leaves manual table-height adjustments intact until the next detected posture change.

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
