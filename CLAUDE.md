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

## Development And Validation

- Install dependencies with `npm install`.
- Run the local server with `npm run dev`.
- Run strict TypeScript validation with `npx tsc --noEmit`.
- Run the production build with `npm run build`.
- Run `node scripts/simulate-drill-sync.mjs` when changing synchronized drill path planning or collision avoidance.

There is no test script currently defined in `package.json`; do not claim tests passed unless a test command is added and run.

## Change And Deployment Practices

- Inspect nearby callers and preserve public APIs and observable update order when refactoring.
- Keep changes focused; do not overwrite unrelated work in the shared worktree.
- Do not commit or push unless explicitly requested.
- `npm run deploy` publishes the build: it replaces root `assets/`, copies generated output into the repository root, creates a Git commit, and pushes to `origin main`. Do not run it unless the user explicitly asks to deploy.
