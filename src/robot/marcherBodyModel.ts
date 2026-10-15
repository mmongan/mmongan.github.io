import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildLowPolyTemplate, cachedInstrumentTemplate, InstrumentGeometry } from './lowPolyInstrument';
import { addRobotHead } from './robotFaceModel';
import { JacketLegOcclusion, JACKET_LEG_CLIP_HEIGHT } from './jacketLegOcclusion';

// Shared vertex-colored templates are instanced for field marchers and cloned
// only for separate rendering groups. The body build scale narrows the torso
// and limb meshes, not the leg rig's joint distances.
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
const legMaterials = new WeakMap<Scene, StandardMaterial>();

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

function partTemplate(name: string, build: (geometry: InstrumentGeometry) => void, underJacket = false) {
  return cachedInstrumentTemplate((scene) => {
    const geometry = new InstrumentGeometry();
    build(geometry);
    let material = getMarcherPartMaterial(scene);
    if (underJacket) {
      let legMaterial = legMaterials.get(scene);
      if (!legMaterial) {
        legMaterial = material.clone('marcherLegMaterial');
        new JacketLegOcclusion(legMaterial);
        legMaterials.set(scene, legMaterial);
      }
      material = legMaterial;
    }
    return buildLowPolyTemplate(name, geometry, material, scene);
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
    ? [[0, JACKET_LEG_CLIP_HEIGHT], [0.21, JACKET_LEG_CLIP_HEIGHT], [0.205, 0.73], [0.215, 0.84], [0.26, 0.98],
      [0.24, 1.035], [0.13, 1.075], [0, 1.085]]
    : [[0, JACKET_LEG_CLIP_HEIGHT], [0.21, JACKET_LEG_CLIP_HEIGHT], [0.205, 0.73],
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
    ? [[0, -0.18], [0.045, -0.155], [0.065, -0.11], [0.085, 0.03], [0.085, 0.16], [0, 0.245]]
    : [[0, -0.18], [0.032, -0.175], [0.045, -0.155], [0.065, -0.11],
      [0.085, 0.03], [0.087, 0.08], [0.085, 0.16], [0.06, 0.22], [0, 0.245]], 12, DARK);
}, true);

export const getMarcherCalfTemplate = partTemplate("marcherCalfTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.34], [0.055, -0.315], [0.075, -0.16], [0.065, -0.045], [0.045, 0], [0, 0.025]]
    : [[0, -0.34], [0.039, -0.333], [0.055, -0.315], [0.075, -0.21],
      [0.075, -0.16], [0.065, -0.045], [0.045, 0], [0.032, 0.018], [0, 0.025]], 12, DARK);
}, true);

export const getMarcherKneeTemplate = partTemplate("marcherKneeTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.075], [0.053, -0.053], [0.075, 0], [0.053, 0.053], [0, 0.075]]
    : [[0, -0.075], [0.0375, -0.065], [0.065, -0.0375], [0.075, 0],
      [0.065, 0.0375], [0.0375, 0.065], [0, 0.075]], 12, DARK);
});

// Toe along +Z (rotated about X), widened sideways.
export const getMarcherShoeTemplate = partTemplate("marcherShoeTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.085], [0.03, -0.075], [0.03, -0.055], [0.03, 0.055], [0.0225, 0.095], [0, 0.105]]
    : [[0, -0.085], [0.03, -0.075], [0.03, -0.055], [0.03, 0.055], [0.0225, 0.095], [0, 0.105]], 12, BOOT,
    ({ x, y, z }) => new Vector3(x * 1.8, -z * (geometry.low ? 1 / Math.cos(Math.PI / 6) : 1), y));
});

export const getMarcherGloveTemplate = partTemplate("marcherGloveTemplate", (geometry) => {
  geometry.lathe(geometry.low
    ? [[0, -0.0475], [0.0475, 0], [0, 0.0475]]
    : [[0, -0.0475], [0.034, -0.034], [0.0475, 0], [0.034, 0.034], [0, 0.0475]], 12, GLOVE);
});
