import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { WebXRHandJoint, WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { scene } from '../scene/engine';

const FINGERS: WebXRHandJoint[][] = [
  [WebXRHandJoint.THUMB_METACARPAL, WebXRHandJoint.THUMB_PHALANX_PROXIMAL, WebXRHandJoint.THUMB_PHALANX_DISTAL, WebXRHandJoint.THUMB_TIP],
  [WebXRHandJoint.INDEX_FINGER_METACARPAL, WebXRHandJoint.INDEX_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.INDEX_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.INDEX_FINGER_PHALANX_DISTAL, WebXRHandJoint.INDEX_FINGER_TIP],
  [WebXRHandJoint.MIDDLE_FINGER_METACARPAL, WebXRHandJoint.MIDDLE_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.MIDDLE_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.MIDDLE_FINGER_PHALANX_DISTAL, WebXRHandJoint.MIDDLE_FINGER_TIP],
  [WebXRHandJoint.RING_FINGER_METACARPAL, WebXRHandJoint.RING_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.RING_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.RING_FINGER_PHALANX_DISTAL, WebXRHandJoint.RING_FINGER_TIP],
  [WebXRHandJoint.PINKY_FINGER_METACARPAL, WebXRHandJoint.PINKY_FINGER_PHALANX_PROXIMAL, WebXRHandJoint.PINKY_FINGER_PHALANX_INTERMEDIATE, WebXRHandJoint.PINKY_FINGER_PHALANX_DISTAL, WebXRHandJoint.PINKY_FINGER_TIP],
];
const PALM_JOINTS = [
  WebXRHandJoint.WRIST,
  WebXRHandJoint.THUMB_METACARPAL,
  WebXRHandJoint.INDEX_FINGER_METACARPAL,
  WebXRHandJoint.MIDDLE_FINGER_METACARPAL,
  WebXRHandJoint.RING_FINGER_METACARPAL,
  WebXRHandJoint.PINKY_FINGER_METACARPAL,
];
const JOINT_RADIUS = 0.008;
const GLOVE_PADDING = 1.2;
const RING_SEGMENTS = 8;

type HandVisual = {
  mesh: Mesh;
  positions: Float32Array;
  fingerRings: number[][];
  fingerCaps: [number, number][];
  palmFront: number[];
  palmBack: number[];
  palmCenterFront: number;
  palmCenterBack: number;
};

let handTracking: WebXRHandTracking | null = null;
let material: StandardMaterial | null = null;
const visuals = new Map<'left' | 'right', HandVisual>();
const normal = new Vector3();
const palmNormal = new Vector3();
const tangent = new Vector3();
const side = new Vector3();
const across = new Vector3();

function getMaterial() {
  if (!material) {
    material = new StandardMaterial('handSkinMaterial', scene);
    material.diffuseColor = new Color3(0.96, 0.96, 0.94);
    material.emissiveColor = new Color3(0.32, 0.32, 0.31);
    material.specularColor = new Color3(0.05, 0.05, 0.05);
    material.backFaceCulling = false;
  }
  return material;
}

function createVisual(handedness: 'left' | 'right'): HandVisual {
  const positions: number[] = [];
  const indices: number[] = [];
  const fingerRings: number[][] = [];
  const fingerCaps: [number, number][] = [];

  const addVertex = () => {
    const index = positions.length / 3;
    positions.push(0, 0, 0);
    return index;
  };
  const addTriangle = (a: number, b: number, c: number) => {
    indices.push(a, b, c);
  };

  FINGERS.forEach((finger) => {
    const rings: number[] = [];
    finger.forEach(() => {
      const ringStart = positions.length / 3;
      for (let segment = 0; segment < RING_SEGMENTS; segment++) addVertex();
      rings.push(ringStart);
    });
    for (let ring = 0; ring < rings.length - 1; ring++) {
      for (let segment = 0; segment < RING_SEGMENTS; segment++) {
        const next = (segment + 1) % RING_SEGMENTS;
        const a = rings[ring] + segment;
        const b = rings[ring] + next;
        const c = rings[ring + 1] + segment;
        const d = rings[ring + 1] + next;
        addTriangle(a, c, b);
        addTriangle(b, c, d);
      }
    }
    const baseCap = addVertex();
    const tipCap = addVertex();
    fingerCaps.push([baseCap, tipCap]);
    for (let segment = 0; segment < RING_SEGMENTS; segment++) {
      const next = (segment + 1) % RING_SEGMENTS;
      addTriangle(baseCap, rings[0] + next, rings[0] + segment);
      addTriangle(tipCap, rings[rings.length - 1] + segment, rings[rings.length - 1] + next);
    }
    fingerRings.push(rings);
  });

  const palmFront = PALM_JOINTS.map(() => addVertex());
  const palmBack = PALM_JOINTS.map(() => addVertex());
  const palmCenterFront = addVertex();
  const palmCenterBack = addVertex();
  for (let index = 0; index < PALM_JOINTS.length; index++) {
    const next = (index + 1) % PALM_JOINTS.length;
    addTriangle(palmCenterFront, palmFront[index], palmFront[next]);
    addTriangle(palmCenterBack, palmBack[next], palmBack[index]);
    addTriangle(palmFront[index], palmBack[index], palmFront[next]);
    addTriangle(palmFront[next], palmBack[index], palmBack[next]);
  }

  const mesh = new Mesh(`${handedness}GloveSkin`, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh, true);
  mesh.material = getMaterial();
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return {
    mesh,
    positions: new Float32Array(positions.length),
    fingerRings,
    fingerCaps,
    palmFront,
    palmBack,
    palmCenterFront,
    palmCenterBack,
  };
}

function writePosition(target: Float32Array, vertex: number, point: Vector3) {
  const offset = vertex * 3;
  target[offset] = point.x;
  target[offset + 1] = point.y;
  target[offset + 2] = point.z;
}

function writePositionXYZ(target: Float32Array, vertex: number, x: number, y: number, z: number) {
  const offset = vertex * 3;
  target[offset] = x;
  target[offset + 1] = y;
  target[offset + 2] = z;
}

function updateHand(handedness: 'left' | 'right') {
  const hand = handTracking?.getHandByHandedness(handedness);
  const wrist = hand?.getJointMesh(WebXRHandJoint.WRIST);
  if (!hand || !wrist?.parent || wrist.position.lengthSquared() === 0) {
    visuals.get(handedness)?.mesh.setEnabled(false);
    return;
  }

  let visual = visuals.get(handedness);
  if (!visual) {
    visual = createVisual(handedness);
    visuals.set(handedness, visual);
  }
  if (visual.mesh.parent !== wrist.parent) {
    visual.mesh.parent = wrist.parent;
    visual.mesh.position.setAll(0);
    visual.mesh.rotation.setAll(0);
    visual.mesh.scaling.setAll(1);
  }

  const positions = new Map<WebXRHandJoint, Vector3>();
  const radii = new Map<WebXRHandJoint, number>();
  const trackedJoints = new Set([...PALM_JOINTS, ...FINGERS.flat()]);
  trackedJoints.forEach((joint) => {
    const tracked = hand.getJointMesh(joint);
    positions.set(joint, tracked.position);
    radii.set(joint, (tracked.scaling.x > 0 ? tracked.scaling.x : JOINT_RADIUS) * GLOVE_PADDING);
  });

  visual.fingerRings.forEach((rings, fingerIndex) => {
    const joints = FINGERS[fingerIndex];
    rings.forEach((ringStart, jointIndex) => {
      const point = positions.get(joints[jointIndex])!;
      const previous = positions.get(joints[Math.max(0, jointIndex - 1)])!;
      const next = positions.get(joints[Math.min(joints.length - 1, jointIndex + 1)])!;
      next.subtractToRef(previous, tangent);
      if (tangent.lengthSquared() < 1e-8) tangent.set(0, 1, 0);
      else tangent.normalize();

      positions.get(WebXRHandJoint.MIDDLE_FINGER_METACARPAL)!
        .subtractToRef(positions.get(WebXRHandJoint.WRIST)!, normal);
      positions.get(WebXRHandJoint.INDEX_FINGER_METACARPAL)!
        .subtractToRef(positions.get(WebXRHandJoint.PINKY_FINGER_METACARPAL)!, across);
      Vector3.CrossToRef(normal, across, side);
      if (side.lengthSquared() < 1e-8) side.set(0, 0, 1);
      else side.normalize();
      Vector3.CrossToRef(tangent, side, across);
      if (across.lengthSquared() < 1e-8) across.set(1, 0, 0);
      else across.normalize();
      Vector3.CrossToRef(across, tangent, side).normalize();

      const radius = radii.get(joints[jointIndex])!;
      for (let segment = 0; segment < RING_SEGMENTS; segment++) {
        const angle = segment * Math.PI * 2 / RING_SEGMENTS;
        const sideOffset = Math.cos(angle) * radius;
        const acrossOffset = Math.sin(angle) * radius;
        writePositionXYZ(
          visual!.positions,
          ringStart + segment,
          point.x + side.x * sideOffset + across.x * acrossOffset,
          point.y + side.y * sideOffset + across.y * acrossOffset,
          point.z + side.z * sideOffset + across.z * acrossOffset,
        );
      }
    });
    const caps = visual!.fingerCaps[fingerIndex];
    writePosition(visual!.positions, caps[0], positions.get(joints[0])!);
    writePosition(visual!.positions, caps[1], positions.get(joints[joints.length - 1])!);
  });

  const palmPoints = PALM_JOINTS.map((joint) => positions.get(joint)!);
  palmPoints[2].subtractToRef(palmPoints[0], normal);
  palmPoints[1].subtractToRef(palmPoints[5], across);
  Vector3.CrossToRef(normal, across, palmNormal);
  if (palmNormal.lengthSquared() < 1e-8) palmNormal.set(0, 0, 1);
  else palmNormal.normalize();
  const center = palmPoints.reduce((sum, point) => sum.addInPlace(point), Vector3.Zero()).scaleInPlace(1 / palmPoints.length);
  const palmThickness = 0.008;
  visual.palmFront.forEach((vertex, index) => {
    const point = palmPoints[index];
    writePositionXYZ(
      visual!.positions,
      vertex,
      point.x + palmNormal.x * palmThickness,
      point.y + palmNormal.y * palmThickness,
      point.z + palmNormal.z * palmThickness,
    );
    writePositionXYZ(
      visual!.positions,
      visual!.palmBack[index],
      point.x - palmNormal.x * palmThickness,
      point.y - palmNormal.y * palmThickness,
      point.z - palmNormal.z * palmThickness,
    );
  });
  writePositionXYZ(
    visual.positions,
    visual.palmCenterFront,
    center.x + palmNormal.x * palmThickness,
    center.y + palmNormal.y * palmThickness,
    center.z + palmNormal.z * palmThickness,
  );
  writePositionXYZ(
    visual.positions,
    visual.palmCenterBack,
    center.x - palmNormal.x * palmThickness,
    center.y - palmNormal.y * palmThickness,
    center.z - palmNormal.z * palmThickness,
  );

  visual.mesh.updateVerticesData(VertexBuffer.PositionKind, visual.positions);
  const normals: number[] = [];
  VertexData.ComputeNormals(Array.from(visual.positions), visual.mesh.getIndices()!, normals);
  visual.mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
  visual.mesh.refreshBoundingInfo();
  visual.mesh.setEnabled(true);
}

scene.onBeforeRenderObservable.add(() => {
  updateHand('left');
  updateHand('right');
});

export function setHandModelTracking(tracking: WebXRHandTracking | null) {
  handTracking = tracking;
  if (!tracking) visuals.forEach((visual) => visual.mesh.setEnabled(false));
}
