import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, PEARL, SILVER } from './lowPolyInstrument';

// Minimal marching mellophone in the same Quest-friendly style as the
// trumpet: one hand-indexed mesh of 91 shared vertices (see
// lowPolyInstrument.ts). It shares the trumpet's right-handed valve layout
// but has a longer leadpipe, a deeper tuning-slide wrap, and a much larger
// forward bell. Model units ≈ meters. Local axes: +Y toward the mouthpiece
// (rim at MELLOPHONE_MOUTHPIECE_TIP), -Y toward the bell, +Z toward the
// valve buttons, X across.
export const MELLOPHONE_MOUTHPIECE_TIP = new Vector3(0, 0.3, 0);

const TUBE_RADIUS = 0.0085;
const LEADPIPE_X = -0.02;
const BELL_X = 0.02;
const BELL_TUBE_Z = 0.045;

function createMellophoneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();

  // Mouthpiece (8): square cone, cup toward the player, shank seated in the receiver.
  geometry.tube([new Vector3(0, 0.23, 0), MELLOPHONE_MOUTHPIECE_TIP], [0.0045, 0.015], 4, SILVER);

  // Receiver and long leadpipe into a deep main tuning slide, back into the valves (21).
  geometry.tube([
    new Vector3(0, 0.235, 0),
    new Vector3(0, 0.215, 0),
    new Vector3(LEADPIPE_X, 0.165, 0),
    new Vector3(LEADPIPE_X, -0.12, 0),
    new Vector3(LEADPIPE_X, -0.17, -0.05),
    new Vector3(LEADPIPE_X, -0.12, -0.1),
    new Vector3(LEADPIPE_X, 0, -0.1),
  ], [0.0125, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS], 3, BRASS);

  // Bell pipe out of the valves, around a wide bell bow, and straight on into
  // the large 9-sided flare as one continuous tube (33).
  geometry.tube([
    new Vector3(BELL_X, 0, -BELL_TUBE_Z),
    new Vector3(BELL_X, 0.15, -BELL_TUBE_Z),
    new Vector3(BELL_X, 0.2, 0),
    new Vector3(BELL_X, 0.15, BELL_TUBE_Z),
    new Vector3(BELL_X, -0.06, BELL_TUBE_Z),
    new Vector3(BELL_X, -0.23, BELL_TUBE_Z),
    new Vector3(BELL_X, -0.3, BELL_TUBE_Z),
  ], [TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, 0.032, 0.1], [3, 3, 3, 3, 3, 9, 9], BRASS);

  // Valve block (8), wide enough to swallow both tube ends, and three capped
  // pearl finger buttons (3 × 7 = 21).
  geometry.box(new Vector3(-0.03, -0.037, -0.11), new Vector3(0.03, 0.037, 0.05), BRASS);
  geometry.fine(() => [0.026, 0, -0.026].forEach((y) => {
    const [, top] = geometry.tube([new Vector3(0, y, 0.05), new Vector3(0, y, 0.068)], [0.006, 0.009], 3, PEARL);
    geometry.cap(top, 3, new Vector3(0, y, 0.07), PEARL);
  }));

  return buildInstrumentTemplate("mellophoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getMellophoneTemplate = cachedInstrumentTemplate(createMellophoneTemplate);
