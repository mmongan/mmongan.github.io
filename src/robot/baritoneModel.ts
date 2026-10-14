import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, PEARL, SILVER } from './lowPolyInstrument';

// Marching baritone in the same shared-mesh style as the trumpet.
// A front-bell horn held like a trumpet, with heavier tubing, a long oval
// tuning wrap, and a long, wide bell. Model units ≈ meters. Local axes: +Y
// toward the mouthpiece (rim at BARITONE_MOUTHPIECE_TIP), -Y toward the bell,
// +Z toward the valve buttons, X across.
export const BARITONE_MOUTHPIECE_TIP = new Vector3(0, 0.25, 0);

const TUBE_RADIUS = 0.012;
const LEADPIPE_X = -0.026;
const BELL_X = 0.026;
const BELL_Z = 0.07;

function createBaritoneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Large mouthpiece, shank seated in the receiver.
  geometry.tube([new Vector3(0, 0.175, 0), BARITONE_MOUTHPIECE_TIP], [0.006, 0.02], 4, SILVER);

  // Receiver and leadpipe into a long oval main tuning wrap, back into the valves.
  geometry.tube([
    new Vector3(0, 0.18, 0),
    new Vector3(0, 0.155, 0),
    new Vector3(LEADPIPE_X, 0.1, 0),
    new Vector3(LEADPIPE_X, -0.2, 0),
    new Vector3(LEADPIPE_X, -0.27, -0.08),
    new Vector3(LEADPIPE_X, -0.2, -0.15),
    new Vector3(LEADPIPE_X, 0, -0.15),
  ], [0.017, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS], 3, BRASS);

  // Bell pipe out of the valves, over a wide bow, and straight on into the
  // long, wide flare as one continuous tube.
  geometry.tube([
    new Vector3(BELL_X, 0, -0.07),
    new Vector3(BELL_X, 0.12, -0.07),
    new Vector3(BELL_X, 0.17, 0),
    new Vector3(BELL_X, 0.12, BELL_Z),
    new Vector3(BELL_X, -0.08, BELL_Z),
    new Vector3(BELL_X, -0.34, BELL_Z),
    new Vector3(BELL_X, -0.45, BELL_Z),
  ], [TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, 0.05, 0.14], [3, 3, 3, 3, 3, 9, 9], BRASS);

  // Valve block covers both tube ends, with three capped pearl finger buttons.
  geometry.box(new Vector3(-0.04, -0.045, -0.165), new Vector3(0.04, 0.045, 0.05), BRASS);
  geometry.fine(() => [0.03, 0, -0.03].forEach((y) => {
    const [, top] = geometry.tube([new Vector3(0, y, 0.05), new Vector3(0, y, 0.07)], [0.007, 0.011], 3, PEARL);
    geometry.cap(top, 3, new Vector3(0, y, 0.073), PEARL);
  }));

  return buildInstrumentTemplate("baritoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getBaritoneTemplate = cachedInstrumentTemplate(createBaritoneTemplate);
