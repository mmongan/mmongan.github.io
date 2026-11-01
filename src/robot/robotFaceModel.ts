import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildLowPolyTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';

// Face and skull share the marcher's trim mesh; eyes retain their shared
// template. +Z faces forward and the body build scale narrows X/Z.
const SHELL = new Color4(0.84, 0.86, 0.9, 1);
const TRIM = new Color4(0.55, 0.59, 0.65, 1);
const FACE_DETAIL = new Color4(0.16, 0.19, 0.23, 1);

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

// Lathes match the body's 8 sides; at low detail lathe() halves that and
// turns it half a step itself.
const HEAD_SIDES = 8;
// The face is deeper than the back of the head.
const FRONT_DEPTH = 1.15;

// Narrow chin, wider cheeks, and a rounded forehead beneath the shako.
const SKULL_PROFILE: Array<[number, number]> = [
  [0, 1.13], [0.065, 1.14], [0.105, 1.175], [0.14, 1.235],
  [0.144, 1.285], [0.14, 1.325], [0.125, 1.355], [0, 1.372],
];
const EYE_RADIUS = 0.144;
const EAR_Y = 1.25;
const EAR_RADIUS = 0.142;
const MOUTH_Y = 1.195;
const MOUTH_RADIUS = 0.116;

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

// Appends the smooth-shaded head. At low detail the ears and mouth are skipped.
export function addRobotHead(geometry: InstrumentGeometry) {
  const place = placeHead(geometry);
  geometry.lathe(geometry.low
    ? [[0, 1.13], [0.105, 1.175], [0.14, 1.235], [0.144, 1.3], [0.125, 1.355], [0, 1.372]]
    : SKULL_PROFILE, HEAD_SIDES, SHELL, place);
  const noseZ = frontFaceZ(geometry, 0.14);
  geometry.box(v(-0.018, 1.225, noseZ - 0.005), v(0.018, 1.28, noseZ + 0.032), SHELL);
  geometry.fine(() => {
    const mouthZ = frontFaceZ(geometry, MOUTH_RADIUS);
    geometry.box(v(-0.027, MOUTH_Y - 0.003, mouthZ - 0.004),
      v(0.027, MOUTH_Y + 0.003, mouthZ + 0.003), FACE_DETAIL);
    const browZ = frontFaceZ(geometry, EYE_RADIUS);
    for (const side of [-1, 1]) {
      geometry.box(v(side * 0.043 - 0.02, 1.303, browZ - 0.002),
        v(side * 0.043 + 0.02, 1.31, browZ + 0.006), FACE_DETAIL);
    }
    const earDepth = 0.03;
    const earX = sideFaceX(geometry, EAR_RADIUS) + earDepth / 2 - 0.004;
    for (const side of [-1, 1]) {
      geometry.drum(v(side * earX, EAR_Y, -0.01), v(side, 0, 0), 0.042, earDepth, HEAD_SIDES, SHELL, TRIM);
    }
  });
}
function createRobotEyesTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();
  const white = new Color4(0.95, 0.96, 0.97, 1);
  const pupil = new Color4(0.04, 0.07, 0.1, 1);
  const eyeZ = frontFaceZ(geometry, EYE_RADIUS);
  for (const side of [-1, 1]) {
    const x = side * 0.043;
    geometry.box(v(x - 0.02, 1.276, eyeZ - 0.002), v(x + 0.02, 1.296, eyeZ + 0.006), white);
    geometry.box(v(x - 0.007, 1.28, eyeZ + 0.005), v(x + 0.007, 1.292, eyeZ + 0.009), pupil);
  }
  const material = new StandardMaterial("robotEyesMaterial", scene);
  material.diffuseColor = Color3.White();
  material.specularColor = new Color3(0.15, 0.15, 0.15);
  return buildLowPolyTemplate("robotEyesTemplate", geometry, material, scene);
}

export const getRobotEyesTemplate = cachedInstrumentTemplate(createRobotEyesTemplate);
