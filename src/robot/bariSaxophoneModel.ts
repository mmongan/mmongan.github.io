import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { BRASS, buildInstrumentTemplate, cachedInstrumentTemplate, EBONY, InstrumentGeometry, PEARL } from './lowPolyInstrument';

// Baritone saxophone in the same shared-mesh style as the alto.
// About 1.5 times the alto's height, with a wider bore and bell and the
// an open S-shaped neck above the body rather than a spiral. Model units ≈ meters. Local
// axes: +Y up the body, -Z toward the player (mouthpiece tip at
// BARI_SAXOPHONE_MOUTHPIECE_TIP, key stacks on the -Z side), +Z toward the
// bell, X across.
export const BARI_SAXOPHONE_MOUTHPIECE_TIP = new Vector3(0.045, 0.4, -0.19);

function createBariSaxophoneTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Two opposing neck bends flow into the body without a full turn or crossing.
  geometry.tube([
    new Vector3(0.045, 0.402, -0.135),
    new Vector3(0.04, 0.405, -0.105),
    new Vector3(0.03, 0.44, -0.095),
    new Vector3(0.02, 0.48, -0.065),
    new Vector3(0.01, 0.47, -0.025),
    new Vector3(0, 0.435, -0.025),
    new Vector3(0, 0.395, 0),
    new Vector3(0, 0.3, 0),
    new Vector3(0, -0.4, 0),
    new Vector3(0, -0.5, 0.055),
    new Vector3(0, -0.45, 0.115),
    new Vector3(0, -0.3, 0.125),
    new Vector3(0, -0.14, 0.13),
  ], [
    0.011, 0.012, 0.014, 0.016, 0.018, 0.019,
    0.024, 0.03, 0.042, 0.046, 0.05, 0.058, 0.095,
  ], 6, BRASS);

  // Black mouthpiece in line with the end of the neck, its base
  // sleeved over the neck, capped at the tip.
  const [, tip] = geometry.tube([
    new Vector3(0.045, 0.402, -0.135),
    BARI_SAXOPHONE_MOUTHPIECE_TIP,
  ], [0.016, 0.009], 4, EBONY);
  geometry.cap(tip, 4, BARI_SAXOPHONE_MOUTHPIECE_TIP.add(new Vector3(0, -0.001, -0.005)), EBONY);

  // Upper (left hand) and lower (right hand) pearl key stacks and the bell
  // keys / guard down the bell side (24), skipped at low detail.
  geometry.fine(() => {
    geometry.box(new Vector3(-0.016, 0.1, -0.05), new Vector3(0.016, 0.24, -0.022), PEARL);
    geometry.box(new Vector3(-0.016, -0.2, -0.058), new Vector3(0.016, -0.06, -0.03), PEARL);
    geometry.box(new Vector3(-0.013, -0.42, 0.04), new Vector3(0.013, -0.2, 0.07), BRASS);
  });

  return buildInstrumentTemplate("bariSaxophoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getBariSaxophoneTemplate = cachedInstrumentTemplate(createBariSaxophoneTemplate);
