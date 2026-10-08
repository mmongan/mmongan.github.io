import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Axis } from '@babylonjs/core/Maths/math.axis';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { WebXRHandJoint, XRHandMeshRigMapping } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import '@babylonjs/loaders/glTF';

export type GloveHandTrackingOptions = {
  customMeshes: { left: AbstractMesh; right: AbstractMesh };
  customRigMappings: { left: XRHandMeshRigMapping; right: XRHandMeshRigMapping };
  meshesUseLeftHandedCoordinates: false;
};

let gloveMeshesPromise: Promise<GloveHandTrackingOptions> | undefined;

function createRigMapping(suffix: 'L' | 'R'): XRHandMeshRigMapping {
  return {
    [WebXRHandJoint.WRIST]: `wrist_${suffix}`,
    [WebXRHandJoint.THUMB_METACARPAL]: `thumb_metacarpal_${suffix}`,
    [WebXRHandJoint.THUMB_PHALANX_PROXIMAL]: `thumb_proxPhalanx_${suffix}`,
    [WebXRHandJoint.THUMB_PHALANX_DISTAL]: `thumb_distPhalanx_${suffix}`,
    [WebXRHandJoint.THUMB_TIP]: `thumb_tip_${suffix}`,
    [WebXRHandJoint.INDEX_FINGER_METACARPAL]: `index_metacarpal_${suffix}`,
    [WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL]: `index_proxPhalanx_${suffix}`,
    [WebXRHandJoint.INDEX_FINGER_PHALANX_INTERMEDIATE]: `index_intPhalanx_${suffix}`,
    [WebXRHandJoint.INDEX_FINGER_PHALANX_DISTAL]: `index_distPhalanx_${suffix}`,
    [WebXRHandJoint.INDEX_FINGER_TIP]: `index_tip_${suffix}`,
    [WebXRHandJoint.MIDDLE_FINGER_METACARPAL]: `middle_metacarpal_${suffix}`,
    [WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL]: `middle_proxPhalanx_${suffix}`,
    [WebXRHandJoint.MIDDLE_FINGER_PHALANX_INTERMEDIATE]: `middle_intPhalanx_${suffix}`,
    [WebXRHandJoint.MIDDLE_FINGER_PHALANX_DISTAL]: `middle_distPhalanx_${suffix}`,
    [WebXRHandJoint.MIDDLE_FINGER_TIP]: `middle_tip_${suffix}`,
    [WebXRHandJoint.RING_FINGER_METACARPAL]: `ring_metacarpal_${suffix}`,
    [WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL]: `ring_proxPhalanx_${suffix}`,
    [WebXRHandJoint.RING_FINGER_PHALANX_INTERMEDIATE]: `ring_intPhalanx_${suffix}`,
    [WebXRHandJoint.RING_FINGER_PHALANX_DISTAL]: `ring_distPhalanx_${suffix}`,
    [WebXRHandJoint.RING_FINGER_TIP]: `ring_tip_${suffix}`,
    [WebXRHandJoint.PINKY_FINGER_METACARPAL]: `little_metacarpal_${suffix}`,
    [WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL]: `little_proxPhalanx_${suffix}`,
    [WebXRHandJoint.PINKY_FINGER_PHALANX_INTERMEDIATE]: `little_intPhalanx_${suffix}`,
    [WebXRHandJoint.PINKY_FINGER_PHALANX_DISTAL]: `little_distPhalanx_${suffix}`,
    [WebXRHandJoint.PINKY_FINGER_TIP]: `little_tip_${suffix}`,
  } satisfies XRHandMeshRigMapping;
}

async function loadGloveMesh(url: string, suffix: 'L' | 'R', scene: Scene): Promise<AbstractMesh> {
  const imported = await ImportMeshAsync(url, scene);
  const mesh = imported.meshes.find((candidate) => !!candidate.skeleton);
  if (!mesh?.skeleton) {
    throw new Error(`Glove hand asset ${url} does not contain a skinned mesh.`);
  }

  const mapping = createRigMapping(suffix);
  const missingBones = Object.values(mapping).filter((boneName) => mesh.skeleton!.getBoneIndexByName(boneName) === -1);
  if (missingBones.length > 0) {
    throw new Error(`Glove hand asset ${url} is missing mapped bones: ${missingBones.join(', ')}.`);
  }

  mesh.skeleton.useTextureToStoreBoneMatrices = false;
  mesh.computeBonesUsingShaders = true;
  mesh.material = createGloveMaterial(suffix, scene);
  mesh.isVisible = false;
  if (!scene.useRightHandedSystem) mesh.rotate(Axis.Y, Math.PI);
  return mesh;
}

function createGloveMaterial(suffix: 'L' | 'R', scene: Scene) {
  const material = new StandardMaterial(`marchingBandGlove${suffix}`, scene);
  material.diffuseColor = new Color3(0.94, 0.95, 0.92);
  material.specularColor = new Color3(0.12, 0.12, 0.11);
  material.specularPower = 24;
  return material;
}

async function loadGloveMeshes(scene: Scene): Promise<GloveHandTrackingOptions> {
  const [left, right] = await Promise.all([
    loadGloveMesh(new URL('../assets/hand-gloves/left.glb', import.meta.url).href, 'L', scene),
    loadGloveMesh(new URL('../assets/hand-gloves/right.glb', import.meta.url).href, 'R', scene),
  ]);

  return {
    customMeshes: { left, right },
    customRigMappings: {
      left: createRigMapping('L'),
      right: createRigMapping('R'),
    },
    meshesUseLeftHandedCoordinates: false,
  };
}

export function getGloveHandTrackingOptions(scene: Scene): Promise<GloveHandTrackingOptions> {
  if (!gloveMeshesPromise) {
    gloveMeshesPromise = loadGloveMeshes(scene);
  }
  return gloveMeshesPromise.catch((error: unknown) => {
    gloveMeshesPromise = undefined;
    throw error;
  });
}
