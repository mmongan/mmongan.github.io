import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, SILVER } from './lowPolyInstrument';

// Minimal tenor trombone in the same Quest-friendly style as the trumpet:
// one hand-indexed mesh of under 100 shared vertices (see lowPolyInstrument.ts).
// Model units ≈ meters. Local axes match the trumpet: +Y toward the
// mouthpiece (tip at TROMBONE_MOUTHPIECE_TIP), -Y toward the slide end and
// bell, +Z up when played, -X the player's left. The slide spans from
// x = 0 to BELL_X, where its return rail runs straight into the bell section.
export const TROMBONE_MOUTHPIECE_TIP = new Vector3(0, 0.1, 0);

const TUBE_RADIUS = 0.0075;
const SLIDE_Z = -0.07;
const SLIDE_END_Y = -0.62;
const BELL_X = -0.13;
const BELL_Z = 0.06;
// Right-hand position along the slide, kept near first position so arms reach it.
export const TROMBONE_SLIDE_STAY_Y = -0.16;

function createTromboneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();

  // Mouthpiece (8): square cone, cup toward the player, shank seated in the receiver.
  geometry.tube([new Vector3(0, 0.045, 0), TROMBONE_MOUTHPIECE_TIP], [0.004, 0.014], 4, SILVER);

  // The widened slide returns directly into the tuning slide and bell,
  // without a sideways neck or extra bends behind the left hand.
  geometry.tube([
    new Vector3(0, 0.05, 0),
    new Vector3(0, 0.03, 0),
    new Vector3(0, SLIDE_END_Y, 0),
    new Vector3(BELL_X / 2, SLIDE_END_Y - 0.065, SLIDE_Z / 2),
    new Vector3(BELL_X, SLIDE_END_Y, SLIDE_Z),
    new Vector3(BELL_X, 0.2, SLIDE_Z),
    new Vector3(BELL_X, 0.24, (SLIDE_Z + BELL_Z) / 2),
    new Vector3(BELL_X, 0.2, BELL_Z),
    new Vector3(BELL_X, -0.2, BELL_Z),
    new Vector3(BELL_X, -0.38, BELL_Z),
    new Vector3(BELL_X, -0.46, BELL_Z),
  ], [
    0.011, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS,
    TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, 0.03, 0.095,
  ], [3, 3, 3, 3, 3, 3, 3, 3, 3, 9, 9], BRASS);

  geometry.tube([
    new Vector3(BELL_X, TROMBONE_SLIDE_STAY_Y, SLIDE_Z),
    new Vector3(0, TROMBONE_SLIDE_STAY_Y, 0),
  ], 0.006, 3, BRASS, Vector3.Up());

  return buildInstrumentTemplate("tromboneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getTromboneTemplate = cachedInstrumentTemplate(createTromboneTemplate);
