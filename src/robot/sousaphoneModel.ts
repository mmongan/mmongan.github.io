import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';

// Minimal sousaphone in the same Quest-friendly style as the trumpet: one
// hand-indexed mesh of 87 shared vertices (see lowPolyInstrument.ts).
// Worn rather than held, so it is modelled directly in marcher
// instrument-root coordinates (unrotated, origin at the marcher's feet, +Z
// forward, +X to the marcher's right; see robot.ts): a tilted body loop
// that rests on the left shoulder and passes under the right arm, valves in
// front of the chest, a gooseneck to the mouth, and a bell above the head
// facing forward.
export const SOUSAPHONE_MOUTHPIECE_TIP = new Vector3(0, 1.2, 0.1024);
export const SOUSAPHONE_VALVE_GRIP = new Vector3(0.045, 1.08, 0.3);

const LOOP_CENTER = new Vector3(0.01, 0.9, 0);
const LOOP_RADIUS = 0.319;
// In-plane axes: toward the low (right-hip) side, and forward.
const LOOP_U = new Vector3(0.658, -0.752, 0);
const LOOP_V = new Vector3(0, 0, 1);
const LOOP_NORMAL = Vector3.Cross(LOOP_U, LOOP_V);

export function sousaphoneLoopPoint(angle: number): Vector3 {
  return LOOP_CENTER
    .add(LOOP_U.scale(Math.cos(angle) * LOOP_RADIUS))
    .add(LOOP_V.scale(Math.sin(angle) * LOOP_RADIUS));
}

function createSousaphoneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();

  // Body loop (32), closed: front of the chest, under the right arm, behind
  // the back, over the left shoulder, and back to the front.
  geometry.tube(
    Array.from({ length: 9 }, (_, index) => sousaphoneLoopPoint(Math.PI / 2 - (index * Math.PI) / 4)),
    0.024, 4, BRASS, LOOP_NORMAL,
  );

  // Bell neck from the left shoulder, up behind the head, turning straight
  // on into the huge forward-facing bell above the head (32).
  const shoulder = sousaphoneLoopPoint(-Math.PI);
  geometry.tube([
    shoulder,
    new Vector3(-0.2, 1.42, -0.1),
    new Vector3(-0.12, 1.75, -0.2),
    new Vector3(-0.06, 1.95, -0.14),
    new Vector3(-0.06, 1.95, 0.04),
    new Vector3(-0.06, 1.96, 0.16),
  ], [0.024, 0.028, 0.034, 0.04, 0.12, 0.3], [4, 4, 4, 4, 8, 8], BRASS);

  // Gooseneck and mouthpiece from inside the valves to the lips (15).
  geometry.tube([
    new Vector3(0.03, 1.02, 0.295),
    new Vector3(0, 1.15, 0.25),
    new Vector3(0, 1.21, 0.17),
    new Vector3(0, 1.2, 0.13),
    SOUSAPHONE_MOUTHPIECE_TIP,
  ], [0.01, 0.01, 0.009, 0.008, 0.016], 3, BRASS);

  // Valve block (8) above the front of the loop, under the right hand.
  geometry.box(new Vector3(0, 0.92, 0.26), new Vector3(0.09, 1.04, 0.34), BRASS);

  return buildInstrumentTemplate("sousaphoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getSousaphoneTemplate = cachedInstrumentTemplate(createSousaphoneTemplate);
