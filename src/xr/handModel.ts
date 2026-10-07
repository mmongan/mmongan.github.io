import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { WebXRHandJoint, WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { scene } from '../scene/engine';

// A lightweight articulated hand built from real (non-instanced) meshes that
// follow Babylon's tracked joint transforms, so hands stay visible without
// relying on the default skinned GLB hand model.
const FINGERS: WebXRHandJoint[][] = [
  [WebXRHandJoint.THUMB_METACARPAL, WebXRHandJoint.THUMB_PHALANX_PROXIMAL, WebXRHandJoint.THUMB_PHALANX_DISTAL, WebXRHandJoint.THUMB_TIP],
  [WebXRHandJoint.INDEX_FINGER_METACARPAL, WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.INDEX_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.INDEX_FINGER_PHALANX_DISTAL, WebXRHandJoint.INDEX_FINGER_TIP],
  [WebXRHandJoint.MIDDLE_FINGER_METACARPAL, WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.MIDDLE_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.MIDDLE_FINGER_PHALANX_DISTAL, WebXRHandJoint.MIDDLE_FINGER_TIP],
  [WebXRHandJoint.RING_FINGER_METACARPAL, WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.RING_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.RING_FINGER_PHALANX_DISTAL, WebXRHandJoint.RING_FINGER_TIP],
  [WebXRHandJoint.PINKY_FINGER_METACARPAL, WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.PINKY_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.PINKY_FINGER_PHALANX_DISTAL, WebXRHandJoint.PINKY_FINGER_TIP],
];
const JOINTS = [WebXRHandJoint.WRIST, ...FINGERS.flat()];
const BONES: [WebXRHandJoint, WebXRHandJoint][] = FINGERS.flatMap((finger) =>
  [WebXRHandJoint.WRIST, ...finger].slice(0, -1).map((joint, index) => [joint, finger[index]] as [WebXRHandJoint, WebXRHandJoint])
);
// Palm webbing between neighbouring knuckles makes the hand read as a hand.
const PALM_BONES: [WebXRHandJoint, WebXRHandJoint][] = [
  [WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL],
  [WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL],
  [WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL],
  [WebXRHandJoint.THUMB_PHALANX_PROXIMAL, WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL],
];
const DEFAULT_JOINT_RADIUS = 0.008;
// Gloves are a little fuller than bare fingers.
const GLOVE_PADDING = 1.15;
const CUFF_LENGTH = 0.05;
const CUFF_DIAMETER = 0.075;

type HandVisual = { joints: Map<WebXRHandJoint, Mesh>; bones: Mesh[]; cuff: Mesh };

let handTracking: WebXRHandTracking | null = null;
let material: StandardMaterial | null = null;
const visuals = new Map<'left' | 'right', HandVisual>();
const boneDirection = new Vector3();

function getMaterial() {
  if (!material) {
    material = new StandardMaterial('handModelMaterial', scene);
    // Matte white marching-band gloves.
    material.diffuseColor = new Color3(0.96, 0.96, 0.94);
    material.emissiveColor = new Color3(0.32, 0.32, 0.31);
    material.specularColor = new Color3(0.05, 0.05, 0.05);
  }
  return material;
}

function prepareMesh(mesh: Mesh) {
  mesh.material = getMaterial();
  mesh.isPickable = false;
  mesh.rotationQuaternion = Quaternion.Identity();
  mesh.setEnabled(false);
  return mesh;
}

function createVisual(handedness: 'left' | 'right'): HandVisual {
  const joints = new Map<WebXRHandJoint, Mesh>();
  JOINTS.forEach((joint) => {
    joints.set(joint, prepareMesh(MeshBuilder.CreateSphere(`${handedness}HandModelJoint`, { diameter: 1, segments: 6 }, scene)));
  });
  const bones = [...BONES, ...PALM_BONES].map(() =>
    prepareMesh(MeshBuilder.CreateCylinder(`${handedness}HandModelBone`, { diameter: 1, height: 1, tessellation: 8 }, scene))
  );
  const cuff = prepareMesh(
    MeshBuilder.CreateCylinder(`${handedness}HandModelCuff`, { diameterTop: 1, diameterBottom: 0.8, height: 1, tessellation: 16 }, scene)
  );
  return { joints, bones, cuff };
}

function setVisualEnabled(visual: HandVisual | undefined, enabled: boolean) {
  if (!visual) return;
  visual.joints.forEach((mesh) => mesh.setEnabled(enabled));
  visual.bones.forEach((mesh) => mesh.setEnabled(enabled));
  visual.cuff.setEnabled(enabled);
}

function updateHand(handedness: 'left' | 'right') {
  const hand = handTracking?.getHandByHandedness(handedness);
  const wrist = hand?.getJointMesh(WebXRHandJoint.WRIST);
  // Joints stay at the origin until the first successful pose arrives.
  if (!hand || !wrist || wrist.position.lengthSquared() === 0) {
    setVisualEnabled(visuals.get(handedness), false);
    return;
  }
  let visual = visuals.get(handedness);
  if (!visual) {
    visual = createVisual(handedness);
    visuals.set(handedness, visual);
  }
  const positions = new Map<WebXRHandJoint, Vector3>();
  const radii = new Map<WebXRHandJoint, number>();
  visual.joints.forEach((mesh, joint) => {
    const tracked = hand.getJointMesh(joint);
    const position = tracked.getAbsolutePosition();
    const radius = (tracked.scaling.x > 0 ? tracked.scaling.x : DEFAULT_JOINT_RADIUS) * GLOVE_PADDING;
    positions.set(joint, position);
    radii.set(joint, radius);
    mesh.position.copyFrom(position);
    mesh.scaling.setAll(radius * 2);
    mesh.setEnabled(true);
  });
  [...BONES, ...PALM_BONES].forEach(([from, to], index) => {
    const bone = visual!.bones[index];
    const start = positions.get(from)!;
    const end = positions.get(to)!;
    end.subtractToRef(start, boneDirection);
    const length = boneDirection.length();
    if (length < 1e-4) {
      bone.setEnabled(false);
      return;
    }
    const diameter = 2 * Math.min(radii.get(from)!, radii.get(to)!);
    start.addToRef(end, bone.position).scaleInPlace(0.5);
    boneDirection.scaleInPlace(1 / length);
    Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, boneDirection, bone.rotationQuaternion!);
    bone.scaling.set(diameter, length, diameter);
    bone.setEnabled(true);
  });
  // Flared cuff extends from the wrist back along the forearm.
  const wristPosition = positions.get(WebXRHandJoint.WRIST)!;
  wristPosition.subtractToRef(positions.get(WebXRHandJoint.MIDDLE_FINGER_METACARPAL)!, boneDirection);
  if (boneDirection.lengthSquared() < 1e-8) {
    visual.cuff.setEnabled(false);
    return;
  }
  boneDirection.normalize();
  wristPosition.addToRef(boneDirection.scale(CUFF_LENGTH * 0.4), visual.cuff.position);
  Quaternion.FromUnitVectorsToRef(Vector3.UpReadOnly, boneDirection, visual.cuff.rotationQuaternion!);
  visual.cuff.scaling.set(CUFF_DIAMETER, CUFF_LENGTH, CUFF_DIAMETER);
  visual.cuff.setEnabled(true);
}

scene.onBeforeRenderObservable.add(() => {
  updateHand('left');
  updateHand('right');
});

export function setHandModelTracking(tracking: WebXRHandTracking | null) {
  handTracking = tracking;
  if (!tracking) visuals.forEach((visual) => setVisualEnabled(visual, false));
}
