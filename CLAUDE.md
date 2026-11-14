<!--
Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Claude Code Guidance

## Application

OpenChartxr is a Babylon.js, TypeScript, and Vite WebXR marching-band drill designer (AGPL-3.0-or-later), deployed to GitHub Pages from this repository. It supports desktop, immersive VR, and tabletop AR, primarily targeting Meta Quest 3.

- Desktop is a playback-only 1:1 viewer: load shows and music, use the transport, browse chart pages and scores, compare ghosts, and switch spectator/marcher POV. Drill editing, drafting, instrument creation, painting, and formation tools are gated to immersive VR/AR through `src/interaction/editingMode.ts` (`DESKTOP_PLAYBACK_NOTICE`). The exception is football mode, which intentionally enables desktop editing for its session. Startup is paused with POV off; audio permission never starts playback.
- Shows load from OpenMarch `.dots` files and the native binary OpenChart format; examples live in `src/assets/openmarch/`. MIDI music drives the shared drill/music transport.
- A football play mode replaces the band with 11-on-11 stylized players for bundled plays, sequences, and special teams using the same transport, leg solver, chart editor, and drafting workspace.
- `README.md` is the detailed user-facing feature specification (very large). Read the relevant section before changing a feature, and update it alongside behavior changes.

## Source Layout

- `src/scene/index.ts` is the single TypeScript application entrypoint. It is referenced by `src/index.html` and `package.json`.
- `src/scene/engine.ts` owns the shared Babylon engine and scene. Reuse this singleton; do not create another engine or scene for a feature.
- `src/scene/` owns application startup and scene composition.
- `src/xr/` owns WebXR session setup and AR tabletop behavior.
- `src/scene/startupDisplay.ts` owns the in-XR startup/progress display; `src/scene/renderOptimizations.ts` freezes static stadium matrices/materials under the AR transform and must be re-synced (`refreshFrozenWorldMatrices`) when field levels rebuild. It watches the AR transform itself: a one-off change re-syncs, while continuous motion thaws the matrices until the transform settles (re-freezing every frame of a gesture is slower than live matrices). Run `node scripts/check-render-optimizations.mjs` when changing it.
- `src/camera/` owns the desktop spectator camera, marcher POV, and Drum Game.
- `src/audio/` owns MIDI loading/playback, the sampled soundfont synth and worker, click track, MIDI-to-drill timing, score notation/layout (VexFlow), and football-mode music gain.
- `src/interaction/` owns controller, pointer, hand, path, formation, drafting, paint, projector, and football-drafting interactions. `editingMode.ts` owns desktop/XR editing gates and drafting-tool enablement.
- `src/robot/` owns marcher/robot models, instruments, playback, gait and leg solving, drill planning, collision previews, chart pages/timeline, OpenMarch/OpenChart formats, and football play mode (`football*.ts`, `scrimmage*.ts`).
- `src/ui/` owns shared DOM references, the loading screen, leg-bake progress, and playback-mode controls.
- `src/field/` owns field dimensions and stadium components.
- `src/field/adjustableGrid.ts` owns the optional visible field grid. Its spacing and visibility are independent of editing snap settings and the teleport grid.
- `src/environment/` owns sky and horizon-ground construction.
- `src/menu/` owns standalone floating panels, the chart pad, music stand, instrument panel, settings overlay, and the shared action registry. Despite its name, `src/menu/handMenu.ts` is that registry (`HandMenuHit` actions dispatched by panels, stadium signs, and trays); there are no hand/wrist-attached menus. XR entry and controller Y summon the floating settings panel.

Keep modules within their feature boundaries. Use descriptive filenames; do not add another `index.ts` barrel or organize files merely by their Babylon.js dependency. Create a new folder only when it represents a cohesive boundary for multiple related modules.

## Scene Lifecycle

Preserve the ordering in `src/scene/index.ts` unless the change explicitly requires otherwise:

1. Create the sky, horizon ground, and football field.
2. Set up field-level controls and initialize interactions.
3. Call `captureContentRootMeshes()` after real scene content exists and before creating the teleport grid.
4. Create and attach the teleport grid, then initialize XR.
5. Initialize the startup display after the content snapshot (so it never joins the AR transform), then apply static render optimizations.
6. Keep per-frame controller, hand, path, menu, and render updates in their established order.

Per-frame work in `renderFrame` runs through `runFrameStage`, so one failing stage is logged once and cannot stop the render loop (a dead loop looks like a frozen band in a headset while music continues). Keep new per-frame stages inside it.

Playback pose application is change-gated: `applyGlobalCountToAllRobots` computes one shared drill/music transport snapshot per frame for every marcher, and while paused the whole per-marcher pass is skipped when the pose key (`drillPoseKey`) is unchanged. Any pose-affecting change outside the transport must bump the key — almost everything already funnels through `invalidateLegBake`; anything new that does not must call `invalidatePlaybackPoses()` from `src/robot/robot.ts`, or paused marchers will not visually update. Football mode has the same contract: `update()` skips when paused with an unchanged key, edit detection polls the event JSON every fourth frame (scale/calibration changes react same-frame), and editors that mutate routes/events must clear the clearance caches directly (they already do). The football separation solver runs at most once per frame via a float-quantized position-cache key.

Play can be pending on the MIDI start guard (`isPlaybackStartPending`/`isPlaybackRequested` in `src/robot/robot.ts`). Any `seekToCount` cancels a pending start, so automatic seeks (warm-ups, mode entries) must skip while playback is requested. 3D Play/Pause controls show the pending state because immersive users can't see the DOM status; the stadium Play sign shows `getMidiPlaybackWaitReason()` from `src/audio/midiPlayback.ts`. Never await `AudioContext.resume()` unbounded: Chrome can leave it pending without user activation, and a stuck `enablingAudio` ignores every later gesture. Keep XR audio unlock on the activation-granting `select`/`squeeze` events.

The content-root snapshot and teleport-grid ordering is important for AR tabletop transforms. Review `src/xr/ar.ts` before changing scene parenting or scale behavior.

## Field Manipulation And Panels

- `src/interaction/controllers.ts` owns shared field-gesture math and controller manipulation; `src/interaction/handInteraction.ts` reuses it for tracked hands. One-controller squeeze or clear-space hand pinch translates in 3D and rotates by world-space wrist yaw around the held point. Reuse `beginSingleHandFieldMovement`, `updateSingleHandFieldMovement`, and `getSingleHandYaw`; do not use field-local marcher-facing yaw for field rotation. Accumulate wrapped yaw deltas, suspend rotation near vertical poses, and rebase yaw on recovery without a jump. Preserve two-hand resize/rotation, release behavior, and priority for marcher, guide, tool, and panel interactions.
- Field scaling stays anchored horizontally to the controller/hand midpoint. `src/xr/ar.ts` owns the scale-dependent transition from configured Table height at tabletop size to configured Floor height at 1:1. `src/xr/webXR.ts` owns Giant-mode room fitting and smooth tracked-floor following. Preserve floating/sinking transitions rather than snapping altitude; do not reset custom height except through the existing explicit placement/preset flows.
- `setSceneManipulationLocked` blocks controller and tracked-hand field transforms during Drum Game. Preserve this lock when adding gestures.
- `src/menu/floatingPanel.ts` owns the shared slim, subdued grab frame and resize/close controls. Keep visual changes shared rather than adding panel-specific competing frames. `src/field/stadiumCrowd.ts` owns the sideline DRAFTING sign, which dispatches the existing `drawingTool: table` action rather than a separate drafting entry flow.

## Marcher POV And Drum Game

- `src/camera/marcherPOV.ts` owns POV setup and lifecycle; `src/camera/marcherPOVCamera.ts` follows the existing marcher's eye pose. Preserve natural VR headset look and physical movement, own-head hiding with the rest of the followed robot body and instrument visible (`isPOVSelfHiddenMesh`), and spectator restoration. Panel/sign starts with no usable selection select the visible marcher nearest the view centre; report state/failures through `getMarcherPOVPanelLabel` for immersive panels; do not create a second camera-follow or marching system.
- `src/camera/marcherDrumGame.ts` owns the immersive-VR-only game. Entry requires a visible selected percussion marcher, full field scale, and remaining scheduled counts. Settings dispatches `marcherDrumGame` through the shared menu registry. Reuse POV and the shared drill transport: pause on entry, seek exactly to the hit target count, then place the next floating drum in the marcher's parent-local route coordinates. Controller-grip virtual stick tips trigger debounced physical hits; these are not trigger-button hits or tracked-hand stick meshes.
- Completion reaches the final count before ending. Stop on POV exit or selected-marcher invalidation, unlock field manipulation, and dispose target/stick meshes and materials; remove disconnected controller sticks. Resume playback only if it was playing at entry, never during scene disposal. Ending the game alone leaves POV active.

## Drafting Tools

- `src/interaction/fieldDrawingTools.ts` owns the physical tool trays, field strokes, laser preview, and guide lifecycle. Reuse its guide conversion and cleanup paths rather than adding separate formation/path creation logic.
- `src/interaction/fieldDrawingGeometry.ts` owns field-local guide geometry, including clipping laser alignment lines to the field rectangle. Use the dimensions in `src/field/constants.ts`.
- `src/interaction/draftingTablePanel.ts` owns the shared drafting workspace's floating controls and command registry. `DrawingToolCommand` in `fieldDrawingGeometry.ts` is the shared action type for floating settings, trays, and workspace. Drafting-table mode stays in `fieldDrawingTools.ts`; save field pose/scale/height mode, enter the existing tabletop placement flow, and restore field placement and prior grid visibility on exit.
- `src/field/draftingFieldPreview.ts` owns the optional distant full-size view. Keep it outside the AR transform, view-only/non-pickable/non-colliding, with no editing metadata or separate simulation. Mirror only field surfaces, live marcher mesh transforms and committed guides. Convert source world matrices back to field coordinates before applying the fixed full-size preview transform; never dispose shared source materials/geometry. Hide/dispose copies on mode exit and dispose observers with the workspace. Use the shared engine/scene.
- `src/interaction/memoryWire.ts` owns the shape-memory wire. Reuse the grab/panel infrastructure in `src/menu/floatingPanel.ts` for physical tools.
- `src/interaction/draftingGeometry.ts` owns advanced drafting math: field-axis/angle constraints, path-length measurements and divisions, bounded-miter offsets, and sampled quadratic splines. Keep these operations in field yards; 8-to-5 step measurements use 0.625 yards per step.
- Drafting uses no pins, tacks, or draggable guide handles. The pencil can extend a straight guide from either endpoint. Drafting-table workspace actions move/rotate/duplicate/delete the selected guide (including sticky notes), updating geometry, controls, divisions, measurement labels and saves together. Reject out-of-field edits atomically. Copies are independent; existing derived guides and converted marchers/routes stay unchanged. Tape, spline, and sticky-note controls remain saved as internal `'yarn'`/`'spline'` editable types for workspace compatibility.
- Drill-first drafting: the workspace's `setDestinationPrevious`/`setDestinationNext`/`applyGuideSet` commands drive `stepDestination`/`applyGuideToSet` on the selection editor, which reuses the shared destination-set selector and the same atomic `setRobotSetPoses` transaction as selection transforms (collision rejection, linear transition rebuild to adjacent sets). Slot distribution/ordering lives in `guideMarcherLayout.ts` (`sampleGuideFormation`, `guideArcParameter`). Desktop stays playback-only and football mode is excluded. Run `node scripts/check-guide-to-set.mjs` when changing it.
- Drafting-table snapping is field-local and shared by desktop and held XR tools: endpoints, nearest line segments, then nearby grid points within 0.25 yards. Keep it separate from marcher-editor snapping; use the existing visible grid's interval. Mode/snap toggles are session-only. Never intercept tool/panel/menu interactions when prioritizing guide selection.
- The advanced drafting tray contains T-square, set square, dividers, tape, spline, offset, annotation, and sticky-note implements. Settings and tray controls share spacing/angle state. Annotations and yellow sticky notes use explicit Settings text rather than native modal prompts, which would interrupt immersive input.
- `src/interaction/draftingWorkspace.ts` owns the versioned local workspace format and validation. Serialize field coordinates explicitly rather than relying on Babylon vector JSON internals. Save only committed drafting guides and their settings; do not persist the show, live previews, or tool poses. Validate the complete snapshot before replacing current guides, keep restores explicit, and surface storage/corruption errors. Both Settings and the advanced tray reuse the same save/restore/delete actions.
- `src/interaction/draftingCamera.ts` captures an overhead field PNG using the shared scene/engine and a disposable camera aligned to the transformed field. Keep its render list limited to field surfaces, committed guides, and the visible grid. Store the image and validated drafting workspace atomically under a separate local-storage key. The physical shutter, tray, and Settings reuse the same actions; allow holding only the camera during capture, reject state drift, preserve prior snapshots on failure, and reuse explicit restore confirmation. Downloaded PNGs are images, not restorable workspaces.
- `src/interaction/fieldImageProjector.ts` owns a local PNG/JPEG/WebP tracing reference and the grabbable projector's shared Settings/menu actions. `fieldImageProjectionGeometry.ts` clips the rotated image polygon to field bounds while interpolating UVs, preserving aspect ratio and transparency. Parent only the non-pickable projection to the existing field root; device grabs reposition the controls, not the image. Reuse existing guide drawing/conversion. Respect texture/file limits, preserve the prior image on loading failure, cancel pending loads on clear/disposal, release replaced textures/decoded bitmaps, and hide/block alignment during calibration. Images/settings are session-only and excluded from drafting saves/photos.
- Keep measurements/annotations, divider marks, and other guide meshes owned by the same guide lifecycle. Offsets/divider copies are independent snapshots, not live dependencies.
- Committed layout guides use flat red yarn with no tacks; divider steps are flat red turf marks; ordinary in-progress guides are cyan. Laser previews are green and are saved only by the explicit **Save laser line** action.
- In XR, the laser projects while held and turns off on release. On desktop, dragging aims its line and keeps the preview available for explicit saving. The projection extends both ways across the field, not just along the drag segment.
- Keep previews and saved guide points in field coordinates. Preserve behavior under tabletop translation, yaw, and scale; tools must not draw during floor calibration.
- Eraser, undo, clear, and scene disposal must remove all meshes owned by a guide. Dispose preview geometry and unregister event handlers when the scene is disposed.

## Field Chart Mode

- `src/robot/fieldChartMode.ts` owns the previous-set field overlay. It consumes the selection editor's page list and destination selector, pauses the existing transport, and uses non-pickable marcher ghosts plus a single field-local arrow mesh. Keep it distinct from ghost-band timeline preview and the chart pad. Refresh after endpoint edits, omit arrows for holds, and clear it on playback/timeline changes, calibration, or show replacement without modifying schedules.
- Register chart controls after the selection editor's context handlers. Ignore transport notifications while the destination selector changes until the chart has synchronized, so switching sets preserves multi-marcher edit mode.
- `src/robot/marcherFootprints.ts` owns the selected-marcher's optional full-route footprint overlay, using one non-pickable vertex-colored mesh parented to the marcher's field root. Sample actual sole contact anchors through `getRobotFootprintSource` in `src/robot/robot.ts`, using isolated caches and the playback leg solver, never a count-parity approximation or transport seeks. `src/robot/marcherFootContacts.ts` enumerates stance-entry beats; `marcherSoleFromLegPose` recovers roll-compensated anchors from solved leg transforms. Cyan means left, gold right. Include initial planted feet, retain cadence/MIDI/facing/bounded-stride behavior, and project stylized prints onto the turf rather than claiming to show a pressure map. Refresh on selection, gait, route, timing, and repeat changes; hide during calibration and dispose scene resources/listeners. Keep it separate from editable step handles and drafting snapshots.
- Viewing chart mode must not require enabling multi-marcher editing or authored-set editing. Entering pauses/seeks to the destination, exits marcher POV and timeline ghost preview, and leaves the viewing camera otherwise unchanged. Turning it off must not resume playback or rewind; startup autoplay must respect the toggle.
- Use previous-set scheduled positions/facings for cyan ghosts and gold straight-displacement arrows ending at destination positions. Skip marchers lacking either count with an explicit status, show a no-previous-set message for the opening set, and do not present arrows as collision-free routes. Reuse captured ghost geometry rather than adding another marching animation system.
- Parent the overlay to the existing field/path root for tabletop transforms. Keep it non-pickable and out of drafting workspace/photo persistence. Reuse unchanged visuals across frames, rebuild after endpoint or marcher membership changes, and dispose ghosts, arrow geometry/material, event listeners, and observers with the scene.

## Performer Appearance

- `src/robot/marcherBodyModel.ts` and `src/robot/robotFaceModel.ts` own the stylized body templates; eyes, brows, and mouth live on the shared untinted `robotEyes` template (one instance per marcher and crowd member, rendered at every detail level, excluded from the body vertex budget); `src/robot/lowPolyInstrument.ts` supplies the shared geometry builder. Preserve shared hardware instances, vertex colors, high/low-detail switching, rounded joint overlap, silhouette profiles, and rig/grip positions. Low-polygon bodies are enabled by default without reducing full-scale instrument detail; shrunk fields reduce both automatically.
- Low-detail body lathes use four to six radial sides, with explicit six-sided shoe/glove overrides to preserve sole contact and cuff fit. Instrument tessellation must remain independent. Validate actual mesh counts, silhouette bounds, elbow shading, glove containment, and shoe geometry against the contact solver before accepting reductions; vertex reductions are not measured FPS improvements.
- Color guard uses `guardFlag`, `guardRifle`, and `guardSabre` in the existing `MarcherInstrument` registry, not a second marcher/transport implementation. `src/robot/colorGuardModels.ts` owns cached high/low-detail static equipment and grips. Keep Settings, creation panels, miniature models, and OpenMarch section mapping consistent. Guard uses normal routes and gait solving; do not imply spins, tosses, cloth simulation, or independent choreography.
- `src/interaction/marcherPaint.ts` owns the grabbable uniform palette and shared paint state/actions. Keep the kidney-shaped board solid with a through thumb hole, beveled rim, and procedural wood grain; swatches are individually sculpted, glossy 3D oil-paint blobs, not discs. Reuse floating-panel/menu dispatch for desktop, controller rays, and tracked-hand pinches. Enable paint by disabling conflicting editing/drawing gestures and finish existing grabs first. Block during floor calibration and exit on other edit modes. Painting must not select, move, erase, scrub, or enter marcher POV; quick consecutive swatch/marcher taps must also work.
- `setRobotColor` in `src/robot/robot.ts` updates the per-marcher color, tinted uniform instance buffers, held-clone material, and top-down marker only; never tint shared equipment materials. New rendering parts inherit the stored color. Refresh matching route/selected step visuals after painting. Color is session-only, outside drafting persistence and camera capture. Dispose palette meshes/materials/textures and unregister DOM/render callbacks with the scene.

## Show Formats And Chart Pages

- `src/robot/openMarchFormat.ts` and `openMarchUrl.ts` read OpenMarch `.dots` shows; `openChartFormat.ts` and `openChartPerformance.ts` own the versioned binary OpenChart format and baked performances. Wire value codes are permanent and independent of runtime library ordering; never renumber them. The OpenChart field reference in `README.md` documents the format, so update it with any format change.
- `chartPageTimeline.ts`, `chartPageDraft.ts`, and `chartPageGhostMode.ts` own authored set pages, blank keyframes, and their ghosts. Inserting a page must retime everything keyed to later counts (football snaps, passes, tackles, drafting counts).
- `scripts/convert-openmarch.mts` and `make-openmarch-example.mts` regenerate example assets; `generate-step-cycles.mjs` regenerates `marcherStepCycles.bin`.

## Football Play Mode

- `src/robot/footballPlayMode.ts` composes football visuals and their cleanup; `footballPlayLibrary.ts`/`footballPlaySequence.ts` define the bundled plays and drives; `footballSnapPauses.ts` owns snap hold/restart timing; `scrimmagePlayback.ts` owns staged band exit/return handovers; `footballBodyClearance.ts` owns presentation-only body separation; `footballTackles.ts`/`footballTackleEditor.ts` own scripted tackles; `footballAnimationLibrary.ts` owns shared throw/catch clips. `src/interaction/footballDrafting.ts` connects football to the existing chart editor and drafting workspace; `src/audio/footballMusicTransport.ts` owns band music gain during football.
- Football reuses the shared transport, leg solver, chart editor, drafting tools, and tabletop parenting; do not add a separate simulation, clock, or animation cache that blocks Play. Presentation offsets must not modify authored routes, counts, possession, or tackle events; body separation offsets only the rendered root, while the live leg solve stays in the authored-route frame so planted feet travel with the displaced body (guarded by `tests/live/football.spec.ts`).
- Loading football snapshots and replaces the band; exiting or a finished return restores the saved routes, pages, guides, and timing. Football presentation, ball events, and the band snapshot are session-only. Calibration and unfinished grabs/drawing block load/exit; camera field-copy capture is blocked in football mode.
- These are illustrative teaching animations, not physics, AI coverage, or rules simulation; keep UI copy and docs from implying otherwise.

## Development And Validation

- Install dependencies with `npm install`.
- Run the local server with `npm run dev`.
- Run strict TypeScript validation with `npx tsc --noEmit`.
- Run the production build with `npm run build`.
- Run `node scripts/check-tabletop-placement.mjs` for field scale/height/placement and one-handed translation/rotation. Preserve coverage of both controllers and tracked hands, held-point anchoring at multiple scales, yaw wrapping, vertical-pose recovery, and scene-manipulation locks. Run `node scripts/check-controller-panel-grab.mjs`, `node scripts/check-controller-roles.mjs`, and `node scripts/check-hand-joystick.mjs` for nearby interaction ownership and navigation changes.
- Run `node scripts/check-marcher-drum-game.mjs` and `node scripts/check-marcher-pov.mjs` for Drum Game or POV changes; run `node scripts/check-xr-settings-panel.mjs` when changing its Settings launcher.
- Run `node scripts/check-marcher-seat.mjs` and `node scripts/check-instrument-geometry.mjs` for body topology/detail changes. Preserve joint fit, shoe contact, cached templates, bounds, and independent instrument detail. Run `node scripts/check-stadium-crowd.mjs` for sideline launcher changes and `node scripts/check-floating-panels.mjs` for shared panel-frame changes.
- Run `node scripts/simulate-drill-sync.mjs` when changing synchronized drill path planning or collision avoidance.
- Run `node scripts/check-field-drawing-tools.mjs` when changing drafting tools, laser aiming/pinning, advanced drafting geometry, dimension labels, editable pins/splines, or guide cleanup. Preserve coverage of physical contact/release, desktop field-plane dragging, and rotated/scaled tabletop transforms.
- Run `node scripts/check-adjustable-grid.mjs` when changing the visible field grid.
- Run `node scripts/check-field-chart-mode.mjs` and `node scripts/check-ghost-band-preview.mjs` when changing chart-mode visuals or transport integration. Preserve coverage of pause/seek, holds and small displacements, short schedules, set switching during editing, endpoint edits, tabletop transforms, mode exits, show replacement, and cleanup.
- Run `node scripts/check-marcher-footprints.mjs` and `node scripts/check-midi-footfall-position.mjs` when changing selected-marcher footprint geometry, contact sampling, or lifecycle.
- Run `node scripts/check-marcher-paint.mjs` when changing uniform tinting or palette interactions. Use `node scripts/check-instrument-geometry.mjs`, `node scripts/check-instrument-menu.mjs`, and `node scripts/check-instrument-panel.mjs` for equipment models/pickers, including all three guard props.
- Run `node scripts/check-field-image-projector.mjs` for projector image loading, clipped UV geometry, transform/opacity controls, async resource ownership, and tracing/calibration behavior.
- Run `node scripts/check-thumb-jog.mjs` and `node scripts/check-controller-roles.mjs` when changing media jogging or controller hand assignments.
- Run the `scripts/check-football-*.mjs` checks plus `check-scrimmage.mjs` when changing football play mode, and `check-xr-settings-panel.mjs` when changing its floating controls.
- Run `check-openmarch-format.mjs`, `check-openchart-format.mjs`, `check-openchart-integration.mjs`, and `check-openchart-performance.mjs` for show import/format changes; run the `check-chart-page-*.mjs` checks for chart page/timeline changes.
- Run `check-midi-*.mjs`, `check-sampled-midi.mjs`, and `check-click-track.mjs` for audio changes; `check-engine-startup.mjs` for WebGL/startup failure handling; `check-playback-mode.mjs` and `check-xr-entry.mjs` for desktop playback-only gating and XR entry.
- Every `scripts/check-*.mjs` file is a standalone check; when unsure which apply, search `scripts/` for the module name you changed.

- Run `npm run test:live` (Playwright, `tests/live/`) for startup, transport, pending-Play, render-loop, or desktop-gating changes. It starts Vite on port 5179 and drives the real app in headless installed Chrome (`PW_CHANNEL` overrides; `LIVE_TEST_URL` targets a running/deployed build). Tests read state only through `window.__openchartxr` from `src/scene/diagnosticsHooks.ts` (dev builds or `?diagnostics`); extend that hook rather than reaching into modules. Soundfonts are served offline as silent samples and can be held to test loading states; keep the suite network-free. Type-check tests with `npx tsc --noEmit -p tests/live/tsconfig.json`.

There is no `npm test` script in `package.json`. The standalone checks above can be run directly; those using Node.js TypeScript stripping require Node.js 22.13 or newer. Report only validation commands actually run.

## Change And Deployment Practices

- Inspect nearby callers and preserve public APIs and observable update order when refactoring.
- Keep changes focused; do not overwrite unrelated work in the shared worktree.
- New project-owned source, scripts, styles, HTML, and Markdown files carry the copyright and `SPDX-License-Identifier: AGPL-3.0-or-later` header used by existing files. Third-party assets keep their own notices (see `NOTICE`).
- Root `index.html` and `assets/` are generated deploy output; edit `src/` instead.
- Do not commit or push unless explicitly requested.
- `npm run deploy` publishes the build: it replaces root `assets/`, copies generated output into the repository root, creates a Git commit, and pushes to `origin main`. Do not run it unless the user explicitly asks to deploy.
