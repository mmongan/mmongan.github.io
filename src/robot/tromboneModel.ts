import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, InstrumentGeometry, SILVER } from './lowPolyInstrument';

// Minimal tenor trombone in the same Quest-friendly style as the trumpet:
// one hand-indexed mesh of under 100 shared vertices (see lowPolyInstrument.ts).
// Model units ≈ meters. Local axes match the trumpet: +Y toward the
// mouthpiece (tip at TROMBONE_MOUTHPIECE_TIP), -Y toward the slide end and
// bell, +Z up when played, -X the player's left. The slide lies in x = 0;
// the bell section runs parallel at BELL_X, beside the player's head.
export const TROMBONE_MOUTHPIECE_TIP = new Vector3(0, 0.1, 0);

const TUBE_RADIUS = 0.0075;
const SLIDE_Z = -0.07;
const SLIDE_END_Y = -0.62;
const BELL_X = -0.13;
const BELL_Z = 0.06;
// Slide stay the right hand holds, kept near first position so arms reach it.
export const TROMBONE_SLIDE_STAY_Y = -0.16;

function createTromboneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();

  // Mouthpiece (8): square cone, cup toward the player, shank seated in the receiver.
  geometry.tube([new Vector3(0, 0.045, 0), TROMBONE_MOUTHPIECE_TIP], [0.004, 0.014], 4, SILVER);

  // The whole air path as one continuous tube (48): receiver, inner slide
  // forward, U-bend crook, outer slide back to the receiver, a crossbar
  // neck over to the bell section, back over the shoulder through the
  // tuning slide, then forward and straight on into the 9-sided flare.
  // The crossbar and the bell section's back leg stay in the outer slide's
  // plane (below the mouth), so the slide visibly flows into the bell.
  const NECK_Y = 0.03;
  geometry.tube([
    new Vector3(0, 0.05, 0),
    new Vector3(0, 0.03, 0),
    new Vector3(0, SLIDE_END_Y, 0),
    new Vector3(0, SLIDE_END_Y - 0.04, SLIDE_Z / 2),
    new Vector3(0, SLIDE_END_Y, SLIDE_Z),
    new Vector3(0, NECK_Y, SLIDE_Z),
    new Vector3(BELL_X, NECK_Y, SLIDE_Z),
    new Vector3(BELL_X, 0.2, SLIDE_Z),
    new Vector3(BELL_X, 0.24, (SLIDE_Z + BELL_Z) / 2),
    new Vector3(BELL_X, 0.2, BELL_Z),
    new Vector3(BELL_X, -0.2, BELL_Z),
    new Vector3(BELL_X, -0.38, BELL_Z),
    new Vector3(BELL_X, -0.46, BELL_Z),
  ], [
    0.011, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS,
    TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, TUBE_RADIUS, 0.03, 0.095,
  ], [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 9, 9], BRASS);

  // Slide brace joining the receiver to the outer slide at the neck (8), and the slide stay (8).
  geometry.box(new Vector3(-0.006, NECK_Y - 0.008, SLIDE_Z), new Vector3(0.006, NECK_Y + 0.008, 0), BRASS);
  geometry.box(
    new Vector3(-0.006, TROMBONE_SLIDE_STAY_Y - 0.01, SLIDE_Z - 0.004),
    new Vector3(0.006, TROMBONE_SLIDE_STAY_Y + 0.01, 0.004),
    SILVER,
  );

  return buildInstrumentTemplate("tromboneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getTromboneTemplate = cachedInstrumentTemplate(createTromboneTemplate);
