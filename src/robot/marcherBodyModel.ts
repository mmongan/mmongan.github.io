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
// - trim: every rigid fixed-color part (pelvis, neck, head, shako, plume)
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
    material.specularColor = new Color3(0.3, 0.3, 0.32);
    material.specularPower = 32;
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
  geometry.lathe([[0, 0.48], [0.1, 0.48], [0.14, 0.54], [0.15, 0.6], [0.12, 0.66], [0, 0.7]], 8, DARK);
  geometry.lathe([[0.055, 1.06], [0.055, 1.18]], 6, METAL);
  geometry.lathe([[0, 1.36], [0.125, 1.36], [0.14, 1.39], [0.13, 1.43], [0.13, 1.58], [0.105, 1.64], [0, 1.64]], 8, DARK);
  geometry.lathe([[0, 1.62], [0.06, 1.645], [0.08, 1.7], [0.06, 1.755], [0, 1.78]], 6, GLOVE);
  // Flat shading gives every head triangle its own vertices, so the
  // low-detail head keeps shared ones.
  if (geometry.low) {
    addRobotHead(geometry);
  } else {
    const head = new InstrumentGeometry();
    addRobotHead(head);
    geometry.appendFlat(head);
  }
});

export const getMarcherJacketTemplate = partTemplate("marcherJacketTemplate", (geometry) => {
  geometry.lathe([[0, 0.61], [0.154, 0.61], [0.187, 0.64], [0.209, 0.75],   [0.22, 0.93], [0.245, 1.01],
      [0.2, 1.055], [0.12, 1.075], [0, 1.075]], 8, TINTED);
});

// Arm and leg segments hang down -Y from their joint, capped above it by a
// half ball; the segment above closes the other half, so bends stay rounded
// and seamless. The jacket shoulders reach past the shoulder balls.
export const getMarcherUpperArmTemplate = partTemplate("marcherUpperArmTemplate", (geometry) => {
  geometry.lathe([[0.062, -0.3], [0.075, -0.15], [0.085, 0], [0.06, 0.06], [0, 0.085]], 8, TINTED);
});

export const getMarcherForearmTemplate = partTemplate("marcherForearmTemplate", (geometry) => {
  geometry.lathe([[0.05, -0.4], [0.065, 0], [0.046, 0.046], [0, 0.065]], 8, TINTED);
});

export const getMarcherThighTemplate = partTemplate("marcherThighTemplate", (geometry) => {
  geometry.lathe([[0, -0.22], [0.085, -0.21], [0.08, -0.12], [0.083, -0.03], [0.072, 0.08], [0.07, 0.16],
    [0.05, 0.21], [0, 0.23]], 8, DARK);
});

export const getMarcherCalfTemplate = partTemplate("marcherCalfTemplate", (geometry) => {
  geometry.lathe([[0, -0.25], [0.072, -0.24], [0.068, -0.15], [0.08, -0.05], [0.087, 0], [0.062, 0.062],
    [0, 0.087]], 8, DARK);
});

// Toe along +Z (rotated about X), widened sideways.
export const getMarcherShoeTemplate = partTemplate("marcherShoeTemplate", (geometry) => {
  geometry.lathe([[0, -0.135], [0.045, -0.12], [0.06, -0.07], [0.06, 0.07], [0.045, 0.12], [0, 0.135]], 6, BOOT,
    ({ x, y, z }) => new Vector3(x * 1.2, -z, y));
});

export const getMarcherGloveTemplate = partTemplate("marcherGloveTemplate", (geometry) => {
  geometry.lathe([[0, -0.0475], [0.034, -0.034], [0.0475, 0], [0.034, 0.034], [0, 0.0475]], 6, GLOVE);
});
