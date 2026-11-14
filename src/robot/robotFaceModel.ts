// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildLowPolyTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';

// Face and skull share the marcher's trim mesh; eyes retain their shared
// template. +Z faces forward and the body build scale narrows X/Z.
const SKIN = new Color4(0.95, 0.75, 0.59, 1);
const LIPS = new Color4(0.49, 0.25, 0.22, 1);
const FACE_DETAIL = new Color4(0.16, 0.19, 0.23, 1);

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

const HEAD_SIDES = 16;
// The face is deeper than the back of the head.
const FRONT_DEPTH = 1.15;

// Narrow chin, wider cheeks, and a rounded forehead beneath the shako.
const SKULL_PROFILE: Array<[number, number]> = [
  [0, 1.13], [0.065, 1.14], [0.105, 1.175], [0.132, 1.2], [0.14, 1.235],
  [0.144, 1.285], [0.14, 1.325], [0.125, 1.355], [0, 1.372],
];
const EYE_RADIUS = 0.144;
const EAR_Y = 1.25;
const EAR_RADIUS = 0.142;

function headSides(geometry: InstrumentGeometry) {
  return geometry.low ? Math.max(4, HEAD_SIDES / 2) : HEAD_SIDES;
}

// Turns a vertex-forward lathe half a step at high detail, so a flat face
// points forward (lathe() already does this at low detail), and deepens the face.
function placeHead(geometry: InstrumentGeometry) {
  const turn = geometry.low ? 0 : Math.PI / HEAD_SIDES;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return ({ x, y, z }: Vector3) => {
    const turnedZ = z * cos - x * sin;
    return v(x * cos + z * sin, y, turnedZ > 0 ? turnedZ * FRONT_DEPTH : turnedZ);
  };
}

// Depth of the flat front face (and half-width of the flat side face) of a
// head lathe ring of `radius`.
function frontFaceZ(geometry: InstrumentGeometry, radius: number) {
  return radius * Math.cos(Math.PI / headSides(geometry)) * FRONT_DEPTH;
}

function sideFaceX(geometry: InstrumentGeometry, radius: number) {
  return radius * Math.cos(Math.PI / headSides(geometry));
}

// Flat-front surface depth of the full-detail skull at height `y`, so features
// seated on the sloping chin and brow sit against the face instead of floating
// at the head's widest ring's depth.
function faceSurfaceZ(geometry: InstrumentGeometry, y: number) {
  for (let index = 0; index < SKULL_PROFILE.length - 1; index++) {
    const [radius0, y0] = SKULL_PROFILE[index];
    const [radius1, y1] = SKULL_PROFILE[index + 1];
    if (y >= y0 && y <= y1 && y1 > y0) {
      return frontFaceZ(geometry, radius0 + (radius1 - radius0) * (y - y0) / (y1 - y0));
    }
  }
  return frontFaceZ(geometry, EYE_RADIUS);
}

// Appends the smooth-shaded head. At low detail the ears and mouth are skipped.
export function addRobotHead(geometry: InstrumentGeometry, skin = SKIN) {
  const place = placeHead(geometry);
  geometry.lathe(geometry.low
    ? [[0, 1.13], [0.105, 1.175], [0.14, 1.235], [0.144, 1.3], [0.125, 1.355], [0, 1.372]]
    : SKULL_PROFILE, HEAD_SIDES, skin, place);
  // Nose with a bridge rising toward the brow line and a rounded tip.
  const noseZ = frontFaceZ(geometry, 0.14);
  geometry.lathe([[0, 1.216], [.019, 1.226], [.021, 1.242], [.013, 1.262], [.011, 1.284], [0, 1.294]],
    6, skin, ({ x, y, z }) => v(x, y, noseZ + .013 + z * 1.3));
  // Eyes, brows, and mouth render from the shared face-features template at
  // every detail level, so even a low-detail face keeps its expression.
  geometry.fine(() => {
    const earDepth = 0.03;
    const earX = sideFaceX(geometry, EAR_RADIUS) + earDepth / 2 - 0.004;
    for (const side of [-1, 1]) {
      geometry.lathe([[0, -.04], [.016, -.025], [.022, 0], [.017, .025], [0, .04]], 6,
        skin, ({ x, y, z }) => v(side * earX + x * .65, EAR_Y + y, z - .01));
    }
  });
}
// Shared face features: layered eyes (white, iris, pupil) under a lash line,
// tapered brows, and a two-tone mouth. They live on the untinted shared
// template so every complexion and detail level keeps the same expression;
// the budget-checked trim carries only skin-colored geometry.
function createRobotEyesTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();
  const white = new Color4(0.95, 0.96, 0.97, 1);
  const iris = new Color4(0.36, 0.22, 0.13, 1);
  const pupil = new Color4(0.04, 0.07, 0.1, 1);
  const brow = new Color4(0.17, 0.12, 0.09, 1);
  const lowerLip = new Color4(0.68, 0.4, 0.35, 1);
  const eyeZ = frontFaceZ(geometry, EYE_RADIUS);
  // Corners sorted so boxes accept either side's coordinates.
  const span = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, color: Color4) =>
    geometry.box(v(Math.min(x1, x2), Math.min(y1, y2), Math.min(z1, z2)),
      v(Math.max(x1, x2), Math.max(y1, y2), Math.max(z1, z2)), color);
  for (const side of [-1, 1]) {
    const x = side * 0.043;
    span(x - 0.021, 1.274, eyeZ - 0.002, x + 0.021, 1.294, eyeZ + 0.005, white);
    span(x - 0.011, 1.277, eyeZ + 0.004, x + 0.011, 1.291, eyeZ + 0.008, iris);
    span(x - 0.005, 1.28, eyeZ + 0.007, x + 0.005, 1.289, eyeZ + 0.01, pupil);
    // Dark upper lash line settles the stare into an open-eyed look.
    span(x - 0.022, 1.293, eyeZ - 0.004, x + 0.022, 1.2965, eyeZ + 0.0025, FACE_DETAIL);
    // Two slim brow segments, lifted clear of the lashes with a raised outer
    // end, keep the expression relaxed rather than glowering. The forehead
    // curves back above the eye band, so they seat on the measured surface.
    const browZ = faceSurfaceZ(geometry, 1.313);
    span(side * 0.022, 1.309, browZ - 0.0045, side * 0.047, 1.315, browZ + 0.0035, brow);
    span(side * 0.045, 1.3115, browZ - 0.0045, side * 0.067, 1.3175, browZ + 0.0035, brow);
  }
  // The chin recedes below the head's widest ring, so each lip seats against
  // the measured surface at its own height (barely proud, back embedded)
  // instead of hovering at the equator depth.
  const lipLineZ = faceSurfaceZ(geometry, 1.1955);
  span(-0.028, 1.193, lipLineZ - 0.0045, 0.028, 1.198, lipLineZ + 0.0035, LIPS);
  const lowerLipZ = faceSurfaceZ(geometry, 1.19);
  span(-0.019, 1.1865, lowerLipZ - 0.006, 0.019, 1.193, lowerLipZ + 0.0025, lowerLip);
  const material = new StandardMaterial("robotEyesMaterial", scene);
  material.diffuseColor = Color3.White();
  material.specularColor = new Color3(0.15, 0.15, 0.15);
  return buildLowPolyTemplate("robotEyesTemplate", geometry, material, scene);
}

export const getRobotEyesTemplate = cachedInstrumentTemplate(createRobotEyesTemplate);
