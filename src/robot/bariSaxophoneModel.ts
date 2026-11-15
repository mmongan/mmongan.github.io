// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

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

  // Upper (left hand) and lower (right hand) pearl key buttons seated on the
  // body tube, and brass key cups seated on the bell bow, skipped at low
  // detail. Each button embeds a few millimeters into the taper and stands
  // only a little proud, so nothing floats off the tube like a handle.
  geometry.fine(() => {
    // Body taper from r 0.03 at y 0.3 to r 0.042 at y -0.4.
    for (const y of [0.12, 0.15, 0.18, 0.21, -0.075, -0.11, -0.145, -0.18]) {
      const radius = 0.03 + (0.3 - y) / 0.7 * 0.012;
      geometry.box(new Vector3(-0.01, y - 0.009, -(radius + 0.008)),
        new Vector3(0.01, y + 0.009, -(radius - 0.004)), PEARL);
    }
    geometry.box(new Vector3(-0.011, -0.4, 0.062), new Vector3(0.011, -0.36, 0.08), BRASS);
    geometry.box(new Vector3(-0.011, -0.32, 0.063), new Vector3(0.011, -0.28, 0.081), BRASS);
    geometry.box(new Vector3(-0.011, -0.26, 0.051), new Vector3(0.011, -0.22, 0.069), BRASS);
  });

  return buildInstrumentTemplate("bariSaxophoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getBariSaxophoneTemplate = cachedInstrumentTemplate(createBariSaxophoneTemplate);
