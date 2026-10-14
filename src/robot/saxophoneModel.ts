import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, EBONY, InstrumentGeometry, PEARL } from './lowPolyInstrument';

// Alto saxophone in the same shared-mesh style as the trumpet.
// Model units ≈ meters. Local axes: +Y up the body toward the neck, -Z toward
// the player (mouthpiece tip at SAXOPHONE_MOUTHPIECE_TIP, key stacks on the
// -Z side under the fingers), +Z toward the bell, X across.
export const SAXOPHONE_MOUTHPIECE_TIP = new Vector3(0, 0.355, -0.125);

function createSaxophoneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Neck from the mouthpiece, curving down into the conical body, U-shaped
  // bow and upturned bell, as one tube.
  geometry.tube([
    new Vector3(0, 0.36, -0.07),
    new Vector3(0, 0.363, -0.037),
    new Vector3(0, 0.3, 0),
    new Vector3(0, 0, 0),
    new Vector3(0, -0.27, 0),
    new Vector3(0, -0.33, 0.035),
    new Vector3(0, -0.29, 0.075),
    new Vector3(0, -0.18, 0.08),
    new Vector3(0, -0.1, 0.085),
  ], [0.007, 0.007, 0.009, 0.018, 0.025, 0.028, 0.03, 0.035, 0.06], [3, 3, 6, 6, 6, 6, 6, 6, 6], BRASS);

  // Black mouthpiece in line with the end of the neck, its base
  // sleeved over the neck, capped at the tip.
  const [, tip] = geometry.tube([
    new Vector3(0, 0.36, -0.07),
    SAXOPHONE_MOUTHPIECE_TIP,
  ], [0.0105, 0.006], 4, EBONY);
  geometry.cap(tip, 4, SAXOPHONE_MOUTHPIECE_TIP.add(new Vector3(0, 0, -0.004)), EBONY);

  // Upper (left hand) and lower (right hand) pearl key stacks and the bell
  // keys / guard down the bell side (24), skipped at low detail.
  geometry.fine(() => {
    geometry.box(new Vector3(-0.012, 0.12, -0.034), new Vector3(0.012, 0.22, -0.012), PEARL);
    geometry.box(new Vector3(-0.012, -0.12, -0.04), new Vector3(0.012, -0.02, -0.018), PEARL);
    geometry.box(new Vector3(-0.01, -0.25, 0.03), new Vector3(0.01, -0.12, 0.05), BRASS);
  });

  return buildInstrumentTemplate("saxophoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getSaxophoneTemplate = cachedInstrumentTemplate(createSaxophoneTemplate);
