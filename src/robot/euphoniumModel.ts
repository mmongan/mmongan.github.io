import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, PEARL, SILVER } from './lowPolyInstrument';

// Minimal marching euphonium in the same Quest-friendly style as the trumpet:
// one hand-indexed mesh of about 100 shared vertices (see lowPolyInstrument.ts).
// A front-bell horn held like a trumpet, with a heavy conical bore that widens
// through two tuning wraps and a very large forward bell. Model units ≈
// meters. Local axes: +Y toward the mouthpiece (rim at
// EUPHONIUM_MOUTHPIECE_TIP), -Y toward the bell, +Z toward the valve buttons,
// X across.
export const EUPHONIUM_MOUTHPIECE_TIP = new Vector3(0, 0.27, 0);

const LEADPIPE_X = -0.032;
const BELL_X = 0.032;
const BELL_Z = 0.085;

function createEuphoniumTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Large mouthpiece (8), shank seated in the receiver.
  geometry.tube([new Vector3(0, 0.19, 0), EUPHONIUM_MOUTHPIECE_TIP], [0.007, 0.022], 4, SILVER);

  // Receiver and leadpipe down to a deep main tuning wrap, back up past the
  // valves into a second (upper) wrap, then down into the valves (27).
  geometry.tube([
    new Vector3(0, 0.195, 0),
    new Vector3(0, 0.17, 0),
    new Vector3(LEADPIPE_X, 0.11, 0),
    new Vector3(LEADPIPE_X, -0.24, 0),
    new Vector3(LEADPIPE_X, -0.32, -0.09),
    new Vector3(LEADPIPE_X, -0.24, -0.18),
    new Vector3(LEADPIPE_X, 0.08, -0.18),
    new Vector3(LEADPIPE_X, 0.12, -0.13),
    new Vector3(LEADPIPE_X, 0.02, -0.09),
  ], [0.019, 0.012, 0.012, 0.013, 0.014, 0.015, 0.016, 0.016, 0.016], 3, BRASS);

  // Bell pipe out of the valves, over a wide bow, and straight on into the
  // long, very wide 9-sided flare as one continuous tube (33).
  geometry.tube([
    new Vector3(BELL_X, 0, -0.08),
    new Vector3(BELL_X, 0.15, -0.08),
    new Vector3(BELL_X, 0.2, 0),
    new Vector3(BELL_X, 0.15, BELL_Z),
    new Vector3(BELL_X, -0.08, BELL_Z),
    new Vector3(BELL_X, -0.38, BELL_Z),
    new Vector3(BELL_X, -0.52, BELL_Z),
  ], [0.017, 0.019, 0.021, 0.023, 0.026, 0.065, 0.16], [3, 3, 3, 3, 3, 9, 9], BRASS);

  // Valve block (8), wide enough to swallow both tube ends, and three capped
  // pearl finger buttons (21).
  geometry.box(new Vector3(-0.05, -0.05, -0.115), new Vector3(0.05, 0.05, 0.06), BRASS);
  geometry.fine(() => [0.033, 0, -0.033].forEach((y) => {
    const [, top] = geometry.tube([new Vector3(0, y, 0.06), new Vector3(0, y, 0.08)], [0.008, 0.012], 3, PEARL);
    geometry.cap(top, 3, new Vector3(0, y, 0.083), PEARL);
  }));

  return buildInstrumentTemplate("euphoniumTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getEuphoniumTemplate = cachedInstrumentTemplate(createEuphoniumTemplate);
