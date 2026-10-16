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
- `src/interaction/memoryWire.ts` owns the shape-memory wire. Reuse the grab/panel infrastructure in `src/menu/floatingPanel.ts` for physical tools.
- `src/interaction/draftingGeometry.ts` owns advanced drafting math: field-axis/angle constraints, path-length measurements and divisions, bounded-miter offsets, and sampled quadratic splines. Keep these operations in field yards; 8-to-5 step measurements use 0.625 yards per step.
- `src/interaction/draftingHandles.ts` owns constrained, draggable field pins. Reuse floating-panel picking/grabs, but intersect desktop drags with the transformed field plane. Pin edits must update the saved guide points used for conversion as well as its meshes.
- The advanced drafting tray contains T-square, set square, dividers, tape, spline, offset, annotation, yarn, and sticky-note implements. Settings and tray controls share spacing/angle state. Annotations and yellow sticky notes use explicit Settings text rather than native modal prompts, which would interrupt immersive input. Sticky-note pin moves translate the complete note instead of stretching it.
- `src/interaction/draftingWorkspace.ts` owns the versioned local workspace format and validation. Serialize field coordinates explicitly rather than relying on Babylon vector JSON internals. Save only committed drafting guides and their settings; do not persist the show, live previews, or tool poses. Validate the complete snapshot before replacing current guides, keep restores explicit, and surface storage/corruption errors. Both Settings and the advanced tray reuse the same save/restore/delete actions.
- `src/interaction/draftingCamera.ts` captures an overhead field PNG using the shared scene/engine and a disposable camera aligned to the transformed field. Keep its render list limited to field surfaces, committed guides/pins, and the visible grid. Store the image and validated drafting workspace atomically under a separate local-storage key. The physical shutter, tray, and Settings reuse the same actions; allow holding only the camera during capture, reject state drift, preserve prior snapshots on failure, and reuse explicit restore confirmation. Downloaded PNGs are images, not restorable workspaces.
- Keep measurements/annotations, editable handles, and decorative meshes owned by the same guide lifecycle. Offsets/divider copies are independent snapshots, not live dependencies. Converting an editable guide does not attach its pins to the resulting marchers or route.
- Committed layout guides use yarn and thumbtacks; ordinary in-progress guides are cyan. Laser previews are green and are saved only by the explicit **Pin laser line** action.
- In XR, the laser projects while held and turns off on release. On desktop, dragging aims its line and keeps the preview available for explicit pinning. The projection extends both ways across the field, not just along the drag segment.
- Keep previews and saved guide points in field coordinates. Preserve behavior under tabletop translation, yaw, and scale; tools must not draw or pin during floor calibration.
- Eraser, undo, clear, and scene disposal must remove all meshes owned by a guide. Dispose preview geometry and unregister event handlers when the scene is disposed.

## Field Chart Mode

- `src/robot/fieldChartMode.ts` owns the previous-set field overlay. It consumes the selection editor's page list and destination selector, pauses the existing transport, and uses non-pickable marcher ghosts plus a single field-local arrow mesh. Keep it distinct from ghost-band timeline preview and the chart pad. Refresh after endpoint edits, omit arrows for holds, and clear it on playback/timeline changes, calibration, or show replacement without modifying schedules.
- Register chart controls after the selection editor's context handlers. Ignore transport notifications while the destination selector changes until the chart has synchronized, so switching sets preserves multi-marcher edit mode.
- Viewing chart mode must not require enabling multi-marcher editing or authored-set editing. Entering pauses/seeks to the destination, exits marcher POV and timeline ghost preview, and leaves the viewing camera otherwise unchanged. Turning it off must not resume playback or rewind; startup autoplay must respect the toggle.
- Use previous-set scheduled positions/facings for cyan ghosts and gold straight-displacement arrows ending at destination positions. Skip marchers lacking either count with an explicit status, show a no-previous-set message for the opening set, and do not present arrows as collision-free routes. Reuse captured ghost geometry rather than adding another marching animation system.
- Parent the overlay to the existing field/path root for tabletop transforms. Keep it non-pickable and out of drafting workspace/photo persistence. Reuse unchanged visuals across frames, rebuild after endpoint or marcher membership changes, and dispose ghosts, arrow geometry/material, event listeners, and observers with the scene.

## Development And Validation

- Install dependencies with `npm install`.
- Run the local server with `npm run dev`.
- Run strict TypeScript validation with `npx tsc --noEmit`.
- Run the production build with `npm run build`.
- Run `node scripts/simulate-drill-sync.mjs` when changing synchronized drill path planning or collision avoidance.
- Run `node scripts/check-field-drawing-tools.mjs` when changing drafting tools, laser aiming/pinning, advanced drafting geometry, dimension labels, editable pins/splines, or guide cleanup. Preserve coverage of physical contact/release, desktop field-plane dragging, and rotated/scaled tabletop transforms.
- Run `node scripts/check-adjustable-grid.mjs` when changing the visible field grid.
- Run `node scripts/check-field-chart-mode.mjs` and `node scripts/check-ghost-band-preview.mjs` when changing chart-mode visuals or transport integration. Preserve coverage of pause/seek, holds and small displacements, short schedules, set switching during editing, endpoint edits, tabletop transforms, mode exits, show replacement, and cleanup.
- Run `node scripts/check-thumb-jog.mjs` and `node scripts/check-controller-roles.mjs` when changing media jogging or controller hand assignments.

There is no `npm test` script in `package.json`. The standalone checks above can be run directly; those using Node.js TypeScript stripping require Node.js 22.13 or newer. Report only validation commands actually run.

## Change And Deployment Practices

- Inspect nearby callers and preserve public APIs and observable update order when refactoring.
- Keep changes focused; do not overwrite unrelated work in the shared worktree.
- Do not commit or push unless explicitly requested.
- `npm run deploy` publishes the build: it replaces root `assets/`, copies generated output into the repository root, creates a Git commit, and pushes to `origin main`. Do not run it unless the user explicitly asks to deploy.
