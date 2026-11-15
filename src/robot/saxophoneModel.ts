// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

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

  // Upper (left hand) and lower (right hand) pearl key buttons seated on the
  // body tube, and brass key cups seated on the bell bow, skipped at low
  // detail. Each button embeds a few millimeters into the taper and stands
  // only a little proud, so nothing floats off the tube like a handle.
  geometry.fine(() => {
    // Body taper: r = 0.018 - y * 0.03 above the waist, 0.018 - y * 0.0259 below.
    for (const y of [0.135, 0.16, 0.185, 0.21]) {
      const radius = 0.018 - y * 0.03;
      geometry.box(new Vector3(-0.008, y - 0.007, -(radius + 0.007)),
        new Vector3(0.008, y + 0.007, -(radius - 0.003)), PEARL);
    }
    for (const y of [-0.03, -0.058, -0.086, -0.114]) {
      const radius = 0.018 - y * 0.0259;
      geometry.box(new Vector3(-0.008, y - 0.007, -(radius + 0.007)),
        new Vector3(0.008, y + 0.007, -(radius - 0.003)), PEARL);
    }
    geometry.box(new Vector3(-0.009, -0.225, 0.043), new Vector3(0.009, -0.195, 0.058), BRASS);
    geometry.box(new Vector3(-0.009, -0.175, 0.037), new Vector3(0.009, -0.145, 0.052), BRASS);
  });

  return buildInstrumentTemplate("saxophoneTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getSaxophoneTemplate = cachedInstrumentTemplate(createSaxophoneTemplate);
