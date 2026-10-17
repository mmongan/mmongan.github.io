# Claude Code Guidance

## Application

This is a Babylon.js, TypeScript, and Vite WebXR marching-band drill designer. It supports desktop, immersive VR, and tabletop AR.

## Source Layout

- `src/scene/index.ts` is the single TypeScript application entrypoint. It is referenced by `src/index.html` and `package.json`.
- `src/scene/engine.ts` owns the shared Babylon engine and scene. Reuse this singleton; do not create another engine or scene for a feature.
- `src/scene/` owns application startup and scene composition.
- `src/xr/` owns WebXR session setup and AR tabletop behavior.
- `src/camera/` owns the desktop spectator camera and tracked-player avatar.
- `src/interaction/` owns controller, pointer, hand, path, and formation interactions.
- `src/robot/` owns robot models, playback, drill planning, and collision previews.
- `src/field/` owns field dimensions and stadium components.
- `src/field/adjustableGrid.ts` owns the optional visible field grid. Its spacing and visibility are independent of editing snap settings and the teleport grid.
- `src/environment/` owns sky and horizon-ground construction.
- `src/menu/` owns the controller hand menu and settings overlay behavior.
- `src/ui/dom.ts` owns shared DOM references for application controls.

Keep modules within their feature boundaries. Use descriptive filenames; do not add another `index.ts` barrel or organize files merely by their Babylon.js dependency. Create a new folder only when it represents a cohesive boundary for multiple related modules.

## Scene Lifecycle

Preserve the ordering in `src/scene/index.ts` unless the change explicitly requires otherwise:

1. Create the sky, horizon ground, and football field.
2. Set up field-level controls and initialize interactions.
3. Call `captureContentRootMeshes()` after real scene content exists and before creating the teleport grid.
4. Create and attach the teleport grid, then initialize XR.
5. Keep per-frame controller, hand, path, menu, and render updates in their established order.

The content-root snapshot and teleport-grid ordering is important for AR tabletop transforms. Review `src/xr/ar.ts` before changing scene parenting or scale behavior.

## Drafting Tools

- `src/interaction/fieldDrawingTools.ts` owns the physical tool trays, field strokes, laser preview, and guide lifecycle. Reuse its guide conversion and cleanup paths rather than adding separate formation/path creation logic.
- `src/interaction/fieldDrawingGeometry.ts` owns field-local guide geometry, including clipping laser alignment lines to the field rectangle. Use the dimensions in `src/field/constants.ts`.
- `src/interaction/draftingTablePanel.ts` owns the shared drafting workspace's floating controls and command registry. `DrawingToolCommand` in `fieldDrawingGeometry.ts` is the shared action type for the hand menu, trays, and workspace. Drafting-table mode stays in `fieldDrawingTools.ts`; save field pose/scale/height mode, enter the existing tabletop placement flow, and restore field placement and prior grid visibility on exit.
- `src/field/draftingFieldPreview.ts` owns the optional distant full-size view. Keep it outside the AR transform, view-only/non-pickable/non-colliding, with no editing metadata or separate simulation. Mirror only field surfaces, live marcher mesh transforms and committed guides. Convert source world matrices back to field coordinates before applying the fixed full-size preview transform; never dispose shared source materials/geometry. Hide/dispose copies on mode exit and dispose observers with the workspace. Use the shared engine/scene.
- `src/interaction/memoryWire.ts` owns the shape-memory wire. Reuse the grab/panel infrastructure in `src/menu/floatingPanel.ts` for physical tools.
- `src/interaction/draftingGeometry.ts` owns advanced drafting math: field-axis/angle constraints, path-length measurements and divisions, bounded-miter offsets, and sampled quadratic splines. Keep these operations in field yards; 8-to-5 step measurements use 0.625 yards per step.
- Drafting uses no pins, tacks, or draggable guide handles. The pencil can extend a straight guide from either endpoint. Drafting-table workspace actions move/rotate/duplicate/delete the selected guide (including sticky notes), updating geometry, controls, divisions, measurement labels and saves together. Reject out-of-field edits atomically. Copies are independent; existing derived guides and converted marchers/routes stay unchanged. Tape, spline, and sticky-note controls remain saved as internal `'yarn'`/`'spline'` editable types for workspace compatibility.
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

- Color guard uses `guardFlag`, `guardRifle`, and `guardSabre` in the existing `MarcherInstrument` registry, not a second marcher/transport implementation. `src/robot/colorGuardModels.ts` owns cached high/low-detail static equipment and grips. Keep Settings, palm/creation panels, miniature models, and OpenMarch section mapping consistent. Guard uses normal routes and gait solving; do not imply spins, tosses, cloth simulation, or independent choreography.
- `src/interaction/marcherPaint.ts` owns the grabbable uniform palette and shared paint state/actions. Keep the kidney-shaped board solid with a through thumb hole, beveled rim, and procedural wood grain; swatches are individually sculpted, glossy 3D oil-paint blobs, not discs. Reuse floating-panel/menu dispatch for desktop, controller rays, and tracked-hand pinches. Enable paint by disabling conflicting editing/drawing gestures and finish existing grabs first. Block during floor calibration and exit on other edit modes. Painting must not select, move, erase, scrub, or enter marcher POV; quick consecutive swatch/marcher taps must also work.
- `setRobotColor` in `src/robot/robot.ts` updates the per-marcher color, tinted uniform instance buffers, held-clone material, and top-down marker only; never tint shared equipment materials. New rendering parts inherit the stored color. Refresh matching route/selected step visuals after painting. Color is session-only, outside drafting persistence and camera capture. Dispose palette meshes/materials/textures and unregister DOM/render callbacks with the scene.

## Development And Validation

- Install dependencies with `npm install`.
- Run the local server with `npm run dev`.
- Run strict TypeScript validation with `npx tsc --noEmit`.
- Run the production build with `npm run build`.
- Run `node scripts/simulate-drill-sync.mjs` when changing synchronized drill path planning or collision avoidance.
- Run `node scripts/check-field-drawing-tools.mjs` when changing drafting tools, laser aiming/pinning, advanced drafting geometry, dimension labels, editable pins/splines, or guide cleanup. Preserve coverage of physical contact/release, desktop field-plane dragging, and rotated/scaled tabletop transforms.
- Run `node scripts/check-adjustable-grid.mjs` when changing the visible field grid.
- Run `node scripts/check-field-chart-mode.mjs` and `node scripts/check-ghost-band-preview.mjs` when changing chart-mode visuals or transport integration. Preserve coverage of pause/seek, holds and small displacements, short schedules, set switching during editing, endpoint edits, tabletop transforms, mode exits, show replacement, and cleanup.
- Run `node scripts/check-marcher-footprints.mjs` and `node scripts/check-midi-footfall-position.mjs` when changing selected-marcher footprint geometry, contact sampling, or lifecycle.
- Run `node scripts/check-marcher-paint.mjs` when changing uniform tinting or palette interactions. Use `node scripts/check-instrument-geometry.mjs`, `node scripts/check-instrument-menu.mjs`, and `node scripts/check-instrument-panel.mjs` for equipment models/pickers, including all three guard props.
- Run `node scripts/check-field-image-projector.mjs` for projector image loading, clipped UV geometry, transform/opacity controls, async resource ownership, and tracing/calibration behavior.
- Run `node scripts/check-thumb-jog.mjs` and `node scripts/check-controller-roles.mjs` when changing media jogging or controller hand assignments.

There is no `npm test` script in `package.json`. The standalone checks above can be run directly; those using Node.js TypeScript stripping require Node.js 22.13 or newer. Report only validation commands actually run.

## Change And Deployment Practices

- Inspect nearby callers and preserve public APIs and observable update order when refactoring.
- Keep changes focused; do not overwrite unrelated work in the shared worktree.
- Do not commit or push unless explicitly requested.
- `npm run deploy` publishes the build: it replaces root `assets/`, copies generated output into the repository root, creates a Git commit, and pushes to `origin main`. Do not run it unless the user explicitly asks to deploy.
