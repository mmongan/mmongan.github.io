import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildLowPolyTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';

// Low-poly humanoid robot (android) head in marcher body coordinates (+Z is
// the face, x/z are later squashed by the body's build scale): a faceted
// skull tapering to a jaw and chin, brow ridge, eye sockets, nose, mouth
// slit, and disc ears, merged into the marcher's trim mesh; plus a shared
// template of unlit glowing irises cloned per marcher.

const SHELL = new Color4(0.84, 0.86, 0.9, 1);
const TRIM = new Color4(0.55, 0.59, 0.65, 1);
const SOCKET = new Color4(0.04, 0.05, 0.07, 1);
const MOUTH = new Color4(0.16, 0.17, 0.2, 1);

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

// Skull profile from chin to crown: height, half-width, and front/back depth.
const SKULL_PROFILE = [
  { y: 1.14, x: 0.07, front: 0.11, back: 0.06 },
  { y: 1.175, x: 0.12, front: 0.14, back: 0.11 },
  { y: 1.24, x: 0.14, front: 0.15, back: 0.14 },
  { y: 1.31, x: 0.145, front: 0.15, back: 0.145 },
  { y: 1.36, x: 0.13, front: 0.13, back: 0.13 },
];
const SKULL_SIDES = 12;
const LOW_SKULL_SIDES = 6;

// Faceted lathe with an elliptical, front-deeper cross-section; closed at the
// chin and crown. At low detail it is hexagonal, turned so a flat face is
// the front.
function addSkull(geometry: InstrumentGeometry) {
  const sides = geometry.low ? LOW_SKULL_SIDES : SKULL_SIDES;
  const turn = geometry.low ? 0.5 : 0;
  const rings = SKULL_PROFILE.map(({ y, x, front, back }) => {
    const start = geometry.positions.length / 3;
    for (let side = 0; side < sides; side++) {
      const angle = ((side + turn) / sides) * Math.PI * 2;
      const depth = Math.cos(angle) > 0 ? front : back;
      geometry.vertex(v(Math.sin(angle) * x, y, Math.cos(angle) * depth), SHELL);
    }
    return start;
  });
  for (let ring = 0; ring < rings.length - 1; ring++) {
    geometry.bridge(rings[ring + 1], rings[ring], sides);
  }
  const chin = geometry.vertex(v(0, 1.135, 0.02), SHELL);
  const crown = geometry.vertex(v(0, 1.375, 0), SHELL);
  const bottom = rings[0];
  const top = rings[rings.length - 1];
  for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides;
    geometry.indices.push(bottom + next, bottom + side, chin);
    geometry.indices.push(top + side, top + next, crown);
  }
}

function addNose(geometry: InstrumentGeometry) {
  const bridge = geometry.vertex(v(0, 1.29, 0.15), SHELL);
  const tip = geometry.vertex(v(0, 1.232, 0.182), SHELL);
  const left = geometry.vertex(v(-0.024, 1.222, 0.148), SHELL);
  const right = geometry.vertex(v(0.024, 1.222, 0.148), SHELL);
  geometry.indices.push(bridge, tip, left, bridge, right, tip, left, tip, right);
}

// Appends the faceted head (meant to be flat shaded, see appendFlat). At low
// detail only the skull and the eye sockets behind the glowing eyes remain.
export function addRobotHead(geometry: InstrumentGeometry) {
  addSkull(geometry);
  for (const side of [-1, 1]) {
    geometry.box(v(side * 0.03, 1.268, 0.13), v(side * 0.1, 1.3, 0.156), SOCKET);
  }
  geometry.fine(() => {
    addNose(geometry);
    // Brow ridge over the eye sockets, and a thin mouth slit.
    geometry.box(v(-0.115, 1.305, 0.135), v(0.115, 1.318, 0.16), TRIM);
    geometry.box(v(-0.05, 1.19, 0.12), v(0.05, 1.2, 0.152), MOUTH);
    // Disc ears with a darker trim face.
    for (const side of [-1, 1]) {
      geometry.drum(v(side * 0.152, 1.25, -0.01), v(side, 0, 0), 0.042, 0.03, 8, SHELL, TRIM);
    }
  });
}

// Unlit, so normals don't matter.
function createRobotEyesTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry();
  const glow = new Color4(1, 1, 1, 1);
  for (const side of [-1, 1]) {
    geometry.box(v(side * 0.05, 1.275, 0.156), v(side * 0.08, 1.293, 0.162), glow);
  }
  const material = new StandardMaterial("robotEyesMaterial", scene);
  material.disableLighting = true;
  material.emissiveColor = new Color3(0.35, 0.95, 1);
  return buildLowPolyTemplate("robotEyesTemplate", geometry, material, scene);
}

export const getRobotEyesTemplate = cachedInstrumentTemplate(createRobotEyesTemplate);
