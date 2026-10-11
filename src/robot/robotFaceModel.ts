import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildLowPolyTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';

// Low-poly humanoid robot (android) head in marcher body coordinates (+Z is
// the face, x/z are later squashed by the body's build scale), in the same
// smooth-shaded lathe style as the rest of the body: a rounded skull with a
// flat face forward, a dark visor band around the eyes, a mouth slit, and
// disc ears, merged into the marcher's trim mesh; plus a shared template of
// unlit glowing eyes on the visor, cloned per marcher.
const SHELL = new Color4(0.84, 0.86, 0.9, 1);
const TRIM = new Color4(0.55, 0.59, 0.65, 1);
const VISOR = new Color4(0.06, 0.1, 0.17, 1);

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

// Lathes match the body's 8 sides; at low detail lathe() halves that and
// turns it half a step itself.
const HEAD_SIDES = 8;
// The face is deeper than the back of the head.
const FRONT_DEPTH = 1.15;

// Skull from chin to crown (the shako covers the crown) and the visor band,
// as [radius, y] profiles. The band's edges tuck into the skull.
const SKULL_PROFILE: Array<[number, number]> = [
  [0, 1.13], [0.085, 1.14], [0.13, 1.175], [0.145, 1.235], [0.147, 1.3], [0.13, 1.355], [0, 1.372],
];
const VISOR_PROFILE: Array<[number, number]> = [[0.138, 1.258], [0.153, 1.266], [0.154, 1.3], [0.14, 1.31]];
const VISOR_RADIUS = 0.1535;
const EAR_Y = 1.25;
const EAR_RADIUS = 0.142;
const MOUTH_Y = 1.195;
const MOUTH_RADIUS = 0.136;

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
    ? [[0, 1.13], [0.13, 1.175], [0.147, 1.3], [0.13, 1.355], [0, 1.372]]
    : SKULL_PROFILE, HEAD_SIDES, SHELL, place);
  geometry.lathe(VISOR_PROFILE, HEAD_SIDES, VISOR, place);
  geometry.fine(() => {
    const mouthZ = frontFaceZ(geometry, MOUTH_RADIUS);
    geometry.box(v(-0.035, MOUTH_Y - 0.004, mouthZ - 0.008), v(0.035, MOUTH_Y + 0.004, mouthZ + 0.002), VISOR);
    const earDepth = 0.03;
    const earX = sideFaceX(geometry, EAR_RADIUS) + earDepth / 2 - 0.004;
    for (const side of [-1, 1]) {
      geometry.drum(v(side * earX, EAR_Y, -0.01), v(side, 0, 0), 0.042, earDepth, HEAD_SIDES, SHELL, TRIM);
    }
  });
}
// Unlit, so normals don't matter.
function createRobotEyesTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();
  const glow = new Color4(1, 1, 1, 1);
  const visorZ = frontFaceZ(geometry, VISOR_RADIUS);
  for (const side of [-1, 1]) {
    geometry.box(v(side * 0.016, 1.275, visorZ - 0.002), v(side * 0.05, 1.291, visorZ + 0.004), glow);
  }
  const material = new StandardMaterial("robotEyesMaterial", scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(0.35, 0.95, 1);
  return buildLowPolyTemplate("robotEyesTemplate", geometry, material, scene);
}

export const getRobotEyesTemplate = cachedInstrumentTemplate(createRobotEyesTemplate);
