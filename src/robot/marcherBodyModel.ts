import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildLowPolyTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';
import { addRobotHead } from './robotFaceModel';

// Low-poly marcher body parts in body coordinates (x/z are later squashed by
// the body's build scale). Each part is a shared vertex-colored template
// cloned per marcher, so a marcher is a handful of small meshes sharing one
// material, apart from its team-colored jacket and sleeves:
// - trim: every rigid fixed-color part (neck, head, shako, plume)
//   merged into one mesh;
// - jacket, upper arm, and forearm: white, tinted by the marcher's material;
// - thigh, calf, shoe, and glove: one per animated joint.

const DARK = new Color4(0.06, 0.1, 0.17, 1);
const METAL = new Color4(0.35, 0.38, 0.42, 1);
const BOOT = new Color4(0.025, 0.035, 0.045, 1);
const GLOVE = new Color4(0.9, 0.92, 0.88, 1);
const TINTED = new Color4(1, 1, 1, 1);

const materials = new WeakMap<Scene, StandardMaterial>();

function getMarcherPartMaterial(scene: Scene): StandardMaterial {
  let material = materials.get(scene);
  if (!material || material.getScene() !== scene) {
    material = new StandardMaterial("marcherPartMaterial", scene);
    material.diffuseColor = Color3.White();
    material.specularColor = new Color3(0.12, 0.12, 0.13);
    material.specularPower = 12;
    materials.set(scene, material);
  }
  return material;
}

function partTemplate(name: string, build: (geometry: InstrumentGeometry) => void) {
  return cachedInstrumentTemplate((scene) => {
    const geometry = new InstrumentGeometry();
    build(geometry);
    return buildLowPolyTemplate(name, geometry, getMarcherPartMaterial(scene), scene);
  });
}

export const getMarcherTrimTemplate = partTemplate("marcherTrimTemplate", (geometry) => {
  geometry.lathe([[0.055, 1.06], [0.055, 1.18]], 6, METAL);
  geometry.lathe(geometry.low
    ? [[0, 1.36], [0.14, 1.36], [0.105, 1.64], [0, 1.64]]
    : [[0, 1.36], [0.125, 1.36], [0.14, 1.39], [0.13, 1.43], [0.13, 1.58], [0.105, 1.64], [0, 1.64]], 8, DARK);
  geometry.lathe(geometry.low
    ? [[0, 1.62], [0.08, 1.7], [0, 1.78]]
    : [[0, 1.62], [0.06, 1.645], [0.08, 1.7], [0.06, 1.755], [0, 1.78]], 6, GLOVE);
  addRobotHead(geometry);
});

export const getMarcherJacketTemplate = partTemplate("marcherJacketTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, 0.61], [0.16, 0.63], [0.2, 0.69], [0.215, 0.84], [0.26, 0.98],
      [0.24, 1.035], [0.13, 1.075], [0, 1.085]]
    : [[0, 0.61], [0.11, 0.615], [0.16, 0.635], [0.19, 0.67], [0.205, 0.73],
      [0.215, 0.84], [0.235, 0.93], [0.26, 0.98], [0.255, 1.01], [0.225, 1.045],
      [0.17, 1.07], [0.1, 1.082], [0, 1.085]], 16, TINTED,
    ({ x, y, z }) => new Vector3(x, y, z * 0.85));
});

// Rounded ends overlap at the existing joints, keeping the clay-like silhouette
// continuous without changing the rig's joint centers or instrument grips.
export const getMarcherUpperArmTemplate = partTemplate("marcherUpperArmTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.37], [0.075, -0.3], [0.085, -0.15], [0.095, 0], [0, 0.095]]
    : [[0, -0.375], [0.053, -0.353], [0.075, -0.3], [0.08, -0.23],
      [0.085, -0.15], [0.09, -0.07], [0.095, 0], [0.067, 0.067], [0, 0.095]], 12, TINTED);
});

export const getMarcherForearmTemplate = partTemplate("marcherForearmTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.44], [0.055, -0.4], [0.07, -0.2], [0.075, 0], [0, 0.075]]
    : [[0, -0.445], [0.039, -0.432], [0.055, -0.4], [0.065, -0.3], [0.07, -0.2],
      [0.075, -0.08], [0.075, 0], [0.053, 0.053], [0, 0.075]], 12, TINTED);
});

export const getMarcherThighTemplate = partTemplate("marcherThighTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.29], [0.08, -0.21], [0.085, -0.03], [0.085, 0.16], [0, 0.245]]
    : [[0, -0.29], [0.057, -0.267], [0.08, -0.21], [0.083, -0.12],
      [0.085, -0.03], [0.087, 0.08], [0.085, 0.16], [0.06, 0.22], [0, 0.245]], 12, DARK);
});

export const getMarcherCalfTemplate = partTemplate("marcherCalfTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.26], [0.065, -0.2], [0.08, -0.1], [0.08, 0], [0, 0.08]]
    : [[0, -0.265], [0.046, -0.246], [0.065, -0.2], [0.075, -0.15],
      [0.08, -0.1], [0.082, -0.05], [0.08, 0], [0.057, 0.057], [0, 0.08]], 12, DARK);
});

// Toe along +Z (rotated about X), widened sideways.
export const getMarcherShoeTemplate = partTemplate("marcherShoeTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.135], [0.06, -0.07], [0.06, 0.07], [0, 0.135]]
    : [[0, -0.135], [0.045, -0.12], [0.06, -0.07], [0.06, 0.07], [0.045, 0.12], [0, 0.135]], 12, BOOT,
    ({ x, y, z }) => new Vector3(x * 1.2, -z * (geometry.low ? Math.SQRT2 : 1), y));
});

export const getMarcherGloveTemplate = partTemplate("marcherGloveTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.0475], [0.0475, 0], [0, 0.0475]]
    : [[0, -0.0475], [0.034, -0.034], [0.0475, 0], [0.034, 0.034], [0, 0.0475]], 12, GLOVE);
});
