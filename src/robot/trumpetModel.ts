import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, PEARL, SILVER } from './lowPolyInstrument';

// B-flat trumpet for standalone headsets: one shared, indexed mesh.
// Model units ≈ meters. Local axes: +Y toward the mouthpiece (rim at
// y = 0.25), -Y toward the bell, +Z toward the valve buttons, X across.
const TUBE_RADIUS = 0.0075;
// +X is the player's right: leadpipe right, bell bow left.
const LEADPIPE_X = 0.018;
const BELL_X = -0.018;
const BELL_TUBE_Z = 0.04;

function createTrumpetTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Mouthpiece cup toward the player, shank seated in the receiver.
  geometry.tube([new Vector3(0, 0.185, 0), new Vector3(0, 0.25, 0)], [0.004, 0.013], 4, SILVER);

  // Receiver and leadpipe into the main tuning slide, back into the valves.
  geometry.tube([
    new Vector3(0, 0.19, 0),
    new Vector3(0, 0.17, 0),
    new Vector3(LEADPIPE_X, 0.13, 0),
    new Vector3(LEADPIPE_X, -0.12, 0),
    new Vector3(LEADPIPE_X, -0.15, -0.03),
    new Vector3(LEADPIPE_X, -0.12, -0.06),
    new Vector3(LEADPIPE_X, 0, -0.06),
  ], [0.011, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS], 3, BRASS);

  // Bell pipe out of the valves, around the bell bow, and straight on into
  // the flare as one continuous tube.
  geometry.tube([
    new Vector3(BELL_X, 0, -BELL_TUBE_Z),
    new Vector3(BELL_X, 0.13, -BELL_TUBE_Z),
    new Vector3(BELL_X, 0.17, 0),
    new Vector3(BELL_X, 0.13, BELL_TUBE_Z),
    new Vector3(BELL_X, -0.05, BELL_TUBE_Z),
    new Vector3(BELL_X, -0.19, BELL_TUBE_Z),
    new Vector3(BELL_X, -0.25, BELL_TUBE_Z),
  ], [TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, 0.021, 0.062], [3, 3, 3, 3, 3, 9, 9], BRASS);

  // Valve block covers both tube ends, with three capped pearl finger buttons.
  geometry.box(new Vector3(-0.027, -0.037, -0.07), new Vector3(0.027, 0.037, 0.05), BRASS);
  geometry.fine(() => [0.026, 0, -0.026].forEach((y) => {
    const [, top] = geometry.tube([new Vector3(0, y, 0.05), new Vector3(0, y, 0.068)], [0.006, 0.009], 3, PEARL);
    geometry.cap(top, 3, new Vector3(0, y, 0.07), PEARL);
  }));

  return buildInstrumentTemplate("trumpetTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getTrumpetTemplate = cachedInstrumentTemplate(createTrumpetTemplate);
