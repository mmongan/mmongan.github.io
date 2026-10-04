import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Observer } from '@babylonjs/core/Misc/observable.pure';
import { Node } from '@babylonjs/core/node';
import { Scene } from '@babylonjs/core/scene.pure';
import { createCollisionMarkerManager, COLLISION_MARKER_RADIUS_YARDS } from './collisionMarkers';

export { COLLISION_MARKER_RADIUS_YARDS } from './collisionMarkers';

const allRobots = new Set<TransformNode>();
const heldRobots = new Set<TransformNode>();
const MARCHER_MODEL_EYE_HEIGHT = 1.28;
const MARCHER_BUILD_SCALE = 0.75;
const MARCHER_HEIGHT_METERS = 1.8;
const METERS_PER_YARD = 0.9144;
const MARCHER_HEIGHT_YARDS = MARCHER_HEIGHT_METERS / METERS_PER_YARD;
const MARCHER_MODEL_HEIGHT_YARDS = 1.78;
const MARCHER_BODY_SCALE = MARCHER_HEIGHT_YARDS / MARCHER_MODEL_HEIGHT_YARDS;

// Walks up from a picked mesh/node to find which spawned robot (if any) owns it.
export function findRobotRoot(node: Node | null): TransformNode | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof TransformNode && allRobots.has(current)) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

// Disposes every robot ever spawned (each one's own onDisposeObservable
// handles removing it from allRobots/players/collision markers) — e.g. so a
// generator can start from a clean field instead of piling onto old runs.
export function disposeAllRobots() {
  Array.from(allRobots).forEach((robot) => robot.dispose());
}

// Each robot gets its own distinct, well-separated color (golden-angle hue
// step) so it can be told apart from the crowd and matched to its path line.
const ROBOT_COLOR_GOLDEN_ANGLE_DEGREES = 137.508;
let robotColorCounter = 0;
const robotColors = new Map<TransformNode, Color3>();

function nextRobotColor(): Color3 {
  const hue = (robotColorCounter++ * ROBOT_COLOR_GOLDEN_ANGLE_DEGREES) % 360;
  return Color3.FromHSV(hue, 0.65, 0.95);
}

export function getRobotColor(robot: TransformNode): Color3 {
  return robotColors.get(robot) ?? Color3.White();
}

// Robots are tiny relative to the whole field, so the top-down monitor draws
// an oversized marker disc for each one instead of relying on its true size.
// The marker sits on a dedicated layer bit so only a camera that opts into
// this mask (via topDownMarkerLayerMask) renders it — the normal VR/AR view
// still sees the robot at its real size, with no marker floating above it.
export const TOP_DOWN_MARKER_LAYER_MASK = 0x10000000;
const TOP_DOWN_MARKER_DIAMETER_YARDS = 2.2;
const MAX_KNEE_BEND_RADIANS = 1.35;
const marcherParts = new Map<TransformNode, {
  gaitIndex: number;
  instrumentRestPose: boolean;
  leftLeg: TransformNode;
  rightLeg: TransformNode;
  leftKnee: TransformNode;
  rightKnee: TransformNode;
  leftAnkle: TransformNode;
  rightAnkle: TransformNode;
  leftShoe: Mesh;
  rightShoe: Mesh;
  leftArm: TransformNode;
  rightArm: TransformNode;
  horn: Mesh;
  body: TransformNode;
}>();

function orientMarcherShoes(leftShoe: Mesh, rightShoe: Mesh, gait: (typeof MARCHING_GAITS)[number]) {
  const legFacingOffset = "legFacingOffset" in gait ? gait.legFacingOffset : 0;
  const shoeFacing = -legFacingOffset;
  for (const shoe of [leftShoe, rightShoe]) {
    shoe.rotation.y = shoeFacing;
    shoe.position.x = Math.sin(shoeFacing) * 0.07;
    shoe.position.z = Math.cos(shoeFacing) * 0.07;
  }
}

function applyInstrumentPose(parts: {
  leftArm: TransformNode;
  rightArm: TransformNode;
  horn: Mesh;
}, restPose: boolean) {
  parts.leftArm.position.z = 0;
  parts.rightArm.position.z = 0;
  parts.leftArm.rotation.x = restPose ? -0.8 : -1.85;
  parts.rightArm.rotation.x = restPose ? -0.8 : -1.85;
  parts.horn.position.set(0, restPose ? 0.8 : 1.22, restPose ? 0.36 : 0.36);
  parts.horn.rotation.set(restPose ? 0 : -Math.PI / 2, 0, 0);
}

export const MARCHING_GAITS = [
  { name: "Field March", lift: 0.16, kneeBend: 0.36, ankleFlex: 0.18, stanceTravel: 1, tempoFactor: 1, facingOffset: 0, inPlace: false },
  { name: "High Step", lift: 0.23, kneeBend: 0.78, ankleFlex: 0.32, stanceTravel: 1, tempoFactor: 1, facingOffset: 0, inPlace: false },
  { name: "Parade", lift: 0.11, kneeBend: 0.52, ankleFlex: 0.14, stanceTravel: 1, tempoFactor: 1, facingOffset: 0, inPlace: false },
  { name: "Crab Walk", lift: 0.12, kneeBend: 0.42, ankleFlex: 0.16, stanceTravel: 1, tempoFactor: 1, facingOffset: Math.PI / 2, legFacingOffset: -Math.PI / 2, inPlace: false },
  { name: "Knee-Ankle March", lift: 0.2, kneeBend: 0.72, ankleFlex: 0.42, stanceTravel: 1, tempoFactor: 1, facingOffset: 0, inPlace: false },
  { name: "Slide", lift: 0.04, kneeBend: 0.12, ankleFlex: 0.04, stanceTravel: 0.45, tempoFactor: 1, facingOffset: 0, inPlace: false },
  { name: "Mark Time", lift: 0.14, kneeBend: 0.5, ankleFlex: 0.22, stanceTravel: 0, tempoFactor: 1, facingOffset: 0, inPlace: true },
  { name: "High Mark Time", lift: 0.24, kneeBend: 0.9, ankleFlex: 0.4, stanceTravel: 0, tempoFactor: 1, facingOffset: 0, inPlace: true },
  { name: "Double Time", lift: 0.16, kneeBend: 0.36, ankleFlex: 0.18, stanceTravel: 1, tempoFactor: 2, facingOffset: 0, inPlace: false },
  { name: "Half Time", lift: 0.16, kneeBend: 0.36, ankleFlex: 0.18, stanceTravel: 1, tempoFactor: 0.5, facingOffset: 0, inPlace: false },
  { name: "Backward March", lift: 0.12, kneeBend: 0.32, ankleFlex: 0.14, stanceTravel: 1, tempoFactor: 1, facingOffset: Math.PI, legFacingOffset: 0, inPlace: false },
  { name: "Backward High Step", lift: 0.2, kneeBend: 0.65, ankleFlex: 0.28, stanceTravel: 1, tempoFactor: 1, facingOffset: Math.PI, legFacingOffset: 0, inPlace: false },
] as const;

export const RANDOM_MARCHING_GAIT_INDICES = MARCHING_GAITS
  .map((gait, index) => gait.tempoFactor === 1 ? index : -1)
  .filter((index) => index >= 0);

let selectedMarchingGait = 0;
let instrumentCarryPose = false;

export function getMarchingGaitIndex(): number {
  return selectedMarchingGait;
}

export function getMarchingGaitTempoFactor(): number {
  return MARCHING_GAITS[selectedMarchingGait].tempoFactor;
}

export function getInstrumentCarryPose(): boolean {
  return instrumentCarryPose;
}

export function toggleInstrumentCarryPose(): boolean {
  instrumentCarryPose = !instrumentCarryPose;
  marcherParts.forEach((parts) => {
    parts.instrumentRestPose = instrumentCarryPose;
    applyInstrumentPose(parts, instrumentCarryPose);
  });
  return instrumentCarryPose;
}

export function setMarcherInstrumentRestPose(robot: TransformNode, restPose: boolean) {
  const parts = marcherParts.get(robot);
  if (!parts) return;
  parts.instrumentRestPose = restPose;
  applyInstrumentPose(parts, restPose);
}

export function cycleMarchingGait(direction: -1 | 1): number {
  selectedMarchingGait = (selectedMarchingGait + direction + MARCHING_GAITS.length) % MARCHING_GAITS.length;
  marcherParts.forEach((parts) => {
    parts.gaitIndex = selectedMarchingGait;
  });
  return selectedMarchingGait;
}

function createMarcherModel(
  scene: Scene,
  gaitIndex: number,
  registerAsRobot: boolean
): TransformNode {
  const robot = new TransformNode(registerAsRobot ? "pathRobot" : "playerAvatar", scene);
  if (registerAsRobot) allRobots.add(robot);

  const color = nextRobotColor();
  if (registerAsRobot) robotColors.set(robot, color);

  const bodyMaterial = new StandardMaterial("robotBodyMaterial", scene);
  bodyMaterial.diffuseColor = color;
  bodyMaterial.specularColor = new Color3(0.25, 0.25, 0.25);
  const makeMaterial = (name: string, tint: Color3) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = tint;
    return material;
  };
  const dark = makeMaterial("marcherTrousers", new Color3(0.06, 0.1, 0.17));
  const trim = makeMaterial("marcherTrim", new Color3(0.95, 0.85, 0.54));
  const skin = makeMaterial("marcherSkin", new Color3(0.7, 0.44, 0.31));
  const brass = makeMaterial("marcherBrass", new Color3(0.88, 0.64, 0.15));
  const boot = makeMaterial("marcherBoot", new Color3(0.025, 0.035, 0.045));
  const white = makeMaterial("marcherGlove", new Color3(0.9, 0.92, 0.88));
  const body = new TransformNode("marcherBody", scene);
  body.parent = robot;
  body.scaling.set(MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE, MARCHER_BODY_SCALE, MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE);

  const jacket = MeshBuilder.CreateLathe("marcherJacket", {
    shape: [
      new Vector3(0, 0.61, 0),
      new Vector3(0.14, 0.61, 0),
      new Vector3(0.17, 0.63, 0),
      new Vector3(0.17, 0.66, 0),
      new Vector3(0.18, 0.7, 0),
      new Vector3(0.19, 0.75, 0),
      new Vector3(0.185, 0.82, 0),
      new Vector3(0.2, 0.93, 0),
      new Vector3(0.19, 1.02, 0),
      new Vector3(0.125, 1.06, 0),
      new Vector3(0, 1.06, 0),
    ],
    tessellation: 10,
    cap: Mesh.CAP_ALL,
  }, scene);
  jacket.scaling.x = 1.1;
  jacket.scaling.z = 1.1;
  jacket.material = bodyMaterial;
  jacket.parent = body;

  const pelvis = MeshBuilder.CreateLathe("marcherPelvis", {
    shape: [
      new Vector3(0, 0.48, 0),
      new Vector3(0.1, 0.48, 0),
      new Vector3(0.12, 0.5, 0),
      new Vector3(0.14, 0.54, 0),
      new Vector3(0.15, 0.58, 0),
      new Vector3(0.145, 0.62, 0),
      new Vector3(0.12, 0.66, 0),
      new Vector3(0.09, 0.69, 0),
      new Vector3(0, 0.7, 0),
    ],
    tessellation: 10,
    cap: Mesh.CAP_ALL,
  }, scene);
  pelvis.material = dark;
  pelvis.parent = body;

  const belt = MeshBuilder.CreateTorus("marcherBelt", {
    diameter: 0.32,
    thickness: 0.025,
    tessellation: 10,
  }, scene);
  belt.position.y = 0.64;
  belt.material = trim;
  belt.parent = body;

  const neck = MeshBuilder.CreateLathe("marcherNeck", {
    shape: [
      new Vector3(0, -0.06, 0),
      new Vector3(0.05, -0.06, 0),
      new Vector3(0.06, -0.04, 0),
      new Vector3(0.06, 0.04, 0),
      new Vector3(0.05, 0.06, 0),
      new Vector3(0, 0.06, 0),
    ],
    tessellation: 10,
    cap: Mesh.CAP_ALL,
  }, scene);
  neck.position.y = 1.12;
  neck.material = skin;
  neck.parent = body;
  const head = MeshBuilder.CreateSphere("robotHead", { diameter: 0.25, segments: 10 }, scene);
  head.position.y = MARCHER_MODEL_EYE_HEIGHT;
  head.material = skin;
  head.parent = body;

  const hat = MeshBuilder.CreateLathe("marcherShako", {
    shape: [
      new Vector3(0, 1.36, 0),
      new Vector3(0.125, 1.36, 0),
      new Vector3(0.14, 1.39, 0),
      new Vector3(0.13, 1.43, 0),
      new Vector3(0.13, 1.58, 0),
      new Vector3(0.12, 1.62, 0),
      new Vector3(0.105, 1.64, 0),
      new Vector3(0, 1.64, 0),
    ],
    tessellation: 10,
    cap: Mesh.CAP_ALL,
  }, scene);
  hat.material = dark;
  hat.parent = body;
  const plume = MeshBuilder.CreateSphere("marcherPlume", { diameter: 0.16, segments: 8 }, scene);
  plume.position.set(0, 1.7, 0);
  plume.material = white;
  plume.parent = body;

  const appendages = ([-1, 1] as const).map((side) => {
    const leg = new TransformNode("marcherLeg", scene);
    leg.position.set(side * 0.09, 0.69, 0);
    leg.parent = body;
    const thigh = MeshBuilder.CreateLathe("marcherThigh", {
      shape: [
        new Vector3(0, -0.22, 0),
        new Vector3(0.082, -0.22, 0),
        new Vector3(0.088, -0.2, 0),
        new Vector3(0.087, -0.17, 0),
        new Vector3(0.078, -0.12, 0),
        new Vector3(0.085, -0.06, 0),
        new Vector3(0.08, 0, 0),
        new Vector3(0.07, 0.04, 0),
        new Vector3(0.06, 0.1, 0),
        new Vector3(0.045, 0.16, 0),
        new Vector3(0, 0.16, 0),
      ],
      tessellation: 10,
      cap: Mesh.CAP_ALL,
    }, scene);
    thigh.position.y = -0.16;
    thigh.material = dark;
    thigh.parent = leg;

    const knee = new TransformNode("marcherKnee", scene);
    knee.position.y = -0.37;
    knee.parent = leg;
    const calf = MeshBuilder.CreateLathe("marcherCalf", {
      shape: [
        new Vector3(0, -0.25, 0),
        new Vector3(0.065, -0.25, 0),
        new Vector3(0.079, -0.23, 0),
        new Vector3(0.067, -0.2, 0),
        new Vector3(0.07, -0.13, 0),
        new Vector3(0.078, -0.07, 0),
        new Vector3(0.087, -0.025, 0),
        new Vector3(0.087, 0, 0),
        new Vector3(0, 0, 0),
      ],
      tessellation: 10,
      cap: Mesh.CAP_ALL,
    }, scene);
    calf.material = dark;
    calf.parent = knee;

    const ankle = new TransformNode("marcherAnkle", scene);
    ankle.position.y = -0.2;
    ankle.parent = knee;

    const shoe = MeshBuilder.CreateCapsule("marcherShoe", {
      height: 0.27,
      radius: 0.06,
      orientation: Vector3.Forward(),
      tessellation: 10,
      subdivisions: 1,
      capSubdivisions: 2,
    }, scene);
    shoe.scaling.x = 1.2;
    shoe.position.set(0, -0.06, 0.07);
    shoe.material = boot;
    shoe.parent = ankle;

    const arm = new TransformNode("marcherArm", scene);
    arm.position.set(side * 0.16, 1.02, 0);
    arm.rotation.x = 0;
    arm.parent = body;
    const sleeve = MeshBuilder.CreateLathe("marcherSleeve", {
      shape: [
        new Vector3(0, -0.44, 0),
        new Vector3(0.05, -0.44, 0),
        new Vector3(0.06, -0.42, 0),
        new Vector3(0.06, -0.3, 0),
        new Vector3(0.07, -0.22, 0),
        new Vector3(0.082, -0.08, 0),
        new Vector3(0.09, -0.02, 0),
        new Vector3(0.09, 0, 0),
        new Vector3(0, 0, 0),
      ],
      tessellation: 8,
      cap: Mesh.CAP_ALL,
    }, scene);
    sleeve.position.x = -side * 0.04;
    sleeve.material = bodyMaterial;
    sleeve.parent = arm;
    const glove = MeshBuilder.CreateSphere("marcherHand", { diameter: 0.12, segments: 8 }, scene);
    glove.position.set(-side * 0.1, -0.44, 0);
    glove.material = white;
    glove.parent = arm;
    return { leg, knee, ankle, shoe, arm };
  });

  const horn = MeshBuilder.CreateCylinder("marcherHorn", {
    diameterTop: 0.07, diameterBottom: 0.24, height: 0.5, tessellation: 12,
  }, scene);
  horn.position.set(0, 0.8, 0.1);
  horn.rotation.setAll(0);
  horn.material = brass;
  horn.parent = body;
  const resolvedGaitIndex = Math.min(MARCHING_GAITS.length - 1, Math.max(0, gaitIndex));
  orientMarcherShoes(appendages[0].shoe, appendages[1].shoe, MARCHING_GAITS[resolvedGaitIndex]);

  if (registerAsRobot) {
    marcherParts.set(robot, {
      gaitIndex: resolvedGaitIndex,
      instrumentRestPose: instrumentCarryPose,
      leftLeg: appendages[0].leg, rightLeg: appendages[1].leg,
      leftKnee: appendages[0].knee, rightKnee: appendages[1].knee,
      leftAnkle: appendages[0].ankle, rightAnkle: appendages[1].ankle,
      leftShoe: appendages[0].shoe, rightShoe: appendages[1].shoe,
      leftArm: appendages[0].arm, rightArm: appendages[1].arm, horn, body,
    });

    const markerMaterial = new StandardMaterial("robotMarkerMaterial", scene);
    markerMaterial.diffuseColor = color;
    markerMaterial.emissiveColor = color;
    markerMaterial.specularColor = new Color3(0, 0, 0);
    markerMaterial.disableLighting = true;
    markerMaterial.backFaceCulling = false;

    const marker = MeshBuilder.CreateDisc(
      "robotTopDownMarker",
      { radius: TOP_DOWN_MARKER_DIAMETER_YARDS / 2, tessellation: 16 },
      scene
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 1.85 * MARCHER_BODY_SCALE;
    marker.material = markerMaterial;
    marker.layerMask = TOP_DOWN_MARKER_LAYER_MASK;
    marker.isPickable = false;
    marker.parent = robot;

    robot.onDisposeObservable.add(() => {
      allRobots.delete(robot);
      heldRobots.delete(robot);
      robotColors.delete(robot);
      marcherParts.delete(robot);
      players.delete(robot);
      recalculateCollisionMarkers(scene);
    });

    robot.setEnabled(false);
  } else {
    robot.setEnabled(true);
  }

  return robot;
}

export function createLowPolyRobot(scene: Scene, gaitIndex = selectedMarchingGait): TransformNode {
  return createMarcherModel(scene, gaitIndex, true);
}

export function createMarcherAvatar(scene: Scene): TransformNode {
  return createMarcherModel(scene, 0, false);
}

// --- Playback control: play/pause, rewind, fast-forward, step, and seeking
// along a robot's recorded path. All positions/facings are precalculated once
// per path (resamplePathIntoCounts) into a fixed table of drill "counts";
// playback interpolates only between neighboring count positions, so each
// footfall still lands exactly on a precalculated drill count.

interface RobotCount {
  position: Vector3;
  rotationY: number;
}

// Each robot keeps only its own route/table; the playback transport itself
// (below) is shared by every robot so the whole band marches on one clock.
interface PlayerState {
  points: Vector3[];
  stepSizeYards: number;
  counts: RobotCount[];
}

// Default marching band "8 to 5" step size (8 steps per 5 yards); each robot
// can be given its own via registerRobotPath/setRobotStepSize. A brisk marching
// tempo is used only to time how often the precomputed count index advances.
const DEFAULT_STEP_SIZE_YARDS = 0.625;
const COUNTS_PER_SECOND = 4;
export const MIN_MARCH_TEMPO_BPM = 60;
export const MAX_MARCH_TEMPO_BPM = 120;
const STEP_INTERVAL_SECONDS = 1 / COUNTS_PER_SECOND;
const MARCHING_GAIT_POSES = MARCHING_GAITS.map((gait) =>
  Array.from({ length: 9 }, (_, index) => {
    const progress = index / 8;
    const swing = gait.stanceTravel * (progress - 0.5);
    const arc = Math.sin(Math.PI * progress);
    return {
      stance: -swing,
      swing,
      lift: arc * gait.lift,
      kneeBend: arc * gait.kneeBend,
      ankleFlex: arc * gait.ankleFlex,
      footLift: gait.inPlace ? arc * gait.lift : 0,
    };
  })
);

// A single shared transport drives every robot's playback: all robots march
// on the same marching-band "count" clock, each just holding at its own last
// position once the count runs past the end of its own (possibly shorter) route.
interface GlobalPlayback {
  countIndex: number;
  stepAccumulatorSeconds: number;
  speedMultiplier: number;
  tempoMultiplier: number;
  playing: boolean;
}
const globalPlayback: GlobalPlayback = {
  countIndex: 0,
  stepAccumulatorSeconds: 0,
  speedMultiplier: 1,
  tempoMultiplier: MAX_MARCH_TEMPO_BPM / (COUNTS_PER_SECOND * 60),
  playing: false,
};

const players = new Map<TransformNode, PlayerState>();
let sharedScene: Scene | null = null;
let sharedObserver: Observer<Scene> | null = null;
const collisionMarkerManager = createCollisionMarkerManager((countIndex) => seekToCount(countIndex));

function recalculateCollisionMarkers(scene: Scene) {
  collisionMarkerManager.refresh(
    scene,
    Array.from(players, ([robot, state]) => ({ robot, counts: state.counts }))
  );
}

export function setCollisionMarkerParent(node: TransformNode) {
  collisionMarkerManager.setParent(node);
}

export function setCollisionMarkersVisible(visible: boolean) {
  collisionMarkerManager.setVisible(visible);
}

export function seekToCollisionMarker(mesh: AbstractMesh): boolean {
  return collisionMarkerManager.seekToMarker(mesh);
}

function computeSegmentLengths(points: Vector3[]): number[] {
  return points.slice(1).map((point, i) => Vector3.Distance(points[i], point));
}

// Precalculates every position/facing along the path up front, resampled to
// one count per marching step, so playback is a table lookup, not live math.
function resamplePathIntoCounts(points: Vector3[], stepSizeYards: number): RobotCount[] {
  if (points.length < 2) {
    return points.length === 1 ? [{ position: points[0].clone(), rotationY: 0 }] : [];
  }

  const segmentLengths = computeSegmentLengths(points);
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  if (totalLength <= 0.001) {
    return [{ position: points[0].clone(), rotationY: 0 }];
  }

  const stepCount = Math.max(1, Math.round(totalLength / stepSizeYards));
  const counts: RobotCount[] = [];
  let lastRotationY = 0;

  for (let i = 0; i <= stepCount; i++) {
    const distance = Math.min(totalLength, (i / stepCount) * totalLength);

    let remaining = distance;
    let segmentIndex = 0;
    while (segmentIndex < segmentLengths.length - 1 && remaining > segmentLengths[segmentIndex]) {
      remaining -= segmentLengths[segmentIndex];
      segmentIndex++;
    }

    const segmentStart = points[segmentIndex];
    const segmentEnd = points[segmentIndex + 1];
    const segmentLength = segmentLengths[segmentIndex] || 0.001;
    const t = Math.min(1, remaining / segmentLength);

    const dx = segmentEnd.x - segmentStart.x;
    const dz = segmentEnd.z - segmentStart.z;
    if (dx * dx + dz * dz > 0.0001) {
      lastRotationY = Math.atan2(dx, dz);
    }

    counts.push({ position: Vector3.Lerp(segmentStart, segmentEnd, t), rotationY: lastRotationY });
  }

  return counts;
}

// Applies the shared global count (clamped to this robot's own table length,
// so a shorter route just holds at its last position) to one robot.
function applyGlobalCount(robot: TransformNode, state: PlayerState) {
  if (heldRobots.has(robot) || state.counts.length === 0) return;
  const index = Math.min(globalPlayback.countIndex, state.counts.length - 1);
  const count = state.counts[index];
  const parts = marcherParts.get(robot);
  if (!parts) return;
  const gait = MARCHING_GAITS[parts.gaitIndex];
  const hipHalfSpacing = gait.facingOffset === Math.PI / 2 ? 0.115 : 0.09;
  const legFacingOffset = "legFacingOffset" in gait ? gait.legFacingOffset : 0;
  orientMarcherShoes(parts.leftShoe, parts.rightShoe, gait);
  parts.leftLeg.rotation.y = legFacingOffset;
  parts.rightLeg.rotation.y = legFacingOffset;
  const instrumentRest = parts.instrumentRestPose;
  const originCount = gait.inPlace ? state.counts[0] : count;
  robot.position.copyFrom(originCount.position);
  const bodyRotation = originCount.rotationY + gait.facingOffset;
  robot.rotation.y = bodyRotation;
  const direction = globalPlayback.speedMultiplier >= 0 ? 1 : -1;
  const next = state.counts[Math.min(Math.max(index + direction, 0), state.counts.length - 1)];
  const displacement = next.position.subtract(count.position);
  const moving = globalPlayback.playing && (gait.inPlace || displacement.lengthSquared() > 0.0001);
  if (!moving) {
    parts.leftLeg.rotation.x = 0;
    parts.rightLeg.rotation.x = 0;
    parts.leftKnee.rotation.x = 0;
    parts.rightKnee.rotation.x = 0;
    parts.leftAnkle.rotation.x = 0;
    parts.rightAnkle.rotation.x = 0;
    parts.leftLeg.position.y = 0.69;
    parts.rightLeg.position.y = 0.69;
    parts.leftLeg.position.x = -hipHalfSpacing;
    parts.rightLeg.position.x = hipHalfSpacing;
    parts.leftLeg.position.z = 0;
    parts.rightLeg.position.z = 0;
    applyInstrumentPose(parts, instrumentRest);
    parts.body.position.y = 0;
    return;
  }
  const countInterval = STEP_INTERVAL_SECONDS /
    (globalPlayback.tempoMultiplier * gait.tempoFactor);
  const countProgress = Math.min(1, globalPlayback.stepAccumulatorSeconds / countInterval);
  const playbackDirection = globalPlayback.speedMultiplier >= 0 ? 1 : -1;
  if (!gait.inPlace) Vector3.LerpToRef(count.position, next.position, countProgress, robot.position);
  const legWorldRotation = bodyRotation + legFacingOffset;
  const localDisplacement = gait.inPlace
    ? Vector3.Zero()
    : Vector3.TransformNormal(displacement, Matrix.RotationY(-legWorldRotation));
  const gaitPoses = MARCHING_GAIT_POSES[parts.gaitIndex];
  const gaitProgress = playbackDirection > 0 ? countProgress : 1 - countProgress;
  const frame = gaitProgress * (gaitPoses.length - 1);
  const first = gaitPoses[Math.floor(frame)];
  const second = gaitPoses[Math.min(Math.floor(frame) + 1, gaitPoses.length - 1)];
  const blend = frame - Math.floor(frame);
  const mix = (start: number, end: number) => start + (end - start) * blend;
  const stance = mix(first.stance, second.stance);
  const swing = mix(first.swing, second.swing);
  const lift = mix(first.lift, second.lift);
  const kneeBend = mix(first.kneeBend, second.kneeBend);
  const ankleFlex = mix(first.ankleFlex, second.ankleFlex);
  const footLift = mix(first.footLift, second.footLift);
  const gaitPhaseCount = gait.inPlace ? globalPlayback.countIndex : index;
  const stanceCount = playbackDirection > 0 ? gaitPhaseCount : gaitPhaseCount - 1;
  const leftStance = stanceCount % 2 === 0;
  const placeLeg = (
    leg: TransformNode,
    knee: TransformNode,
    ankle: TransformNode,
    side: number,
    offset: number,
    kneeAngle: number,
    ankleAngle: number,
    lift: number
  ) => {
    const footZ = localDisplacement.z * offset;
    const angle = Math.asin(Math.max(-0.95, Math.min(0.95, -footZ / 0.47)));
    const boundedKneeAngle = Math.min(MAX_KNEE_BEND_RADIANS, Math.max(0, kneeAngle));
    knee.rotation.x = boundedKneeAngle;
    ankle.rotation.x = ankleAngle;
    leg.rotation.x = angle;
    leg.position.x = side * hipHalfSpacing + Math.max(-0.015, Math.min(0.015, localDisplacement.x * offset));
    const ankleY = -0.2 * Math.cos(boundedKneeAngle);
    const ankleZ = -0.2 * Math.sin(boundedKneeAngle);
    const shoeYInAnkle = -0.06 * Math.cos(ankleAngle) - 0.07 * Math.sin(ankleAngle);
    const shoeZInAnkle = -0.06 * Math.sin(ankleAngle) + 0.07 * Math.cos(ankleAngle);
    const shoeY = ankleY + shoeYInAnkle * Math.cos(boundedKneeAngle)
      - shoeZInAnkle * Math.sin(boundedKneeAngle);
    const shoeZ = ankleZ + shoeYInAnkle * Math.sin(boundedKneeAngle)
      + shoeZInAnkle * Math.cos(boundedKneeAngle);
    const totalLegAngle = angle + boundedKneeAngle + ankleAngle;
    leg.position.z = Math.max(-0.015, Math.min(0.015, footZ - (-0.37 + shoeY) * Math.sin(angle) - shoeZ * Math.cos(angle) + 0.07));
    const plantedHipHeight = (0.37 - shoeY) * Math.cos(angle) + shoeZ * Math.sin(angle)
      + 0.06 * Math.abs(Math.cos(totalLegAngle))
      + 0.135 * Math.abs(Math.sin(totalLegAngle));
    leg.position.y = plantedHipHeight + lift;
  };
  placeLeg(parts.leftLeg, parts.leftKnee, parts.leftAnkle, -1, leftStance ? stance : swing,
    leftStance ? kneeBend * 0.12 : kneeBend + lift * 2, leftStance ? 0 : -ankleFlex,
    gait.inPlace && !leftStance ? footLift : 0);
  placeLeg(parts.rightLeg, parts.rightKnee, parts.rightAnkle, 1, leftStance ? swing : stance,
    leftStance ? kneeBend + lift * 2 : kneeBend * 0.12, leftStance ? -ankleFlex : 0,
    gait.inPlace && leftStance ? footLift : 0);
  applyInstrumentPose(parts, instrumentRest);
  parts.body.position.y = 0;
}

function applyGlobalCountToAllRobots() {
  players.forEach((state, robot) => applyGlobalCount(robot, state));
}

// The longest registered route determines the full drill's length in counts.
function getMaxCountIndex(): number {
  let max = 0;
  players.forEach((state) => {
    if (state.counts.length - 1 > max) max = state.counts.length - 1;
  });
  return max;
}


function ensureSharedObserver(scene: Scene) {
  if (sharedScene === scene && sharedObserver) return;
  if (sharedObserver && sharedScene) {
    sharedScene.onBeforeRenderObservable.remove(sharedObserver);
  }
  sharedScene = scene;
  sharedObserver = scene.onBeforeRenderObservable.add(() => {
    const deltaSeconds = scene.getEngine().getDeltaTime() / 1000;

    if (globalPlayback.playing && globalPlayback.speedMultiplier !== 0) {
      const direction = globalPlayback.speedMultiplier > 0 ? 1 : -1;
      const maxCountIndex = getMaxCountIndex();
      globalPlayback.stepAccumulatorSeconds += deltaSeconds * Math.abs(globalPlayback.speedMultiplier);

      const countInterval = STEP_INTERVAL_SECONDS /
        (globalPlayback.tempoMultiplier * MARCHING_GAITS[selectedMarchingGait].tempoFactor);
      while (globalPlayback.stepAccumulatorSeconds >= countInterval) {
        const nextIndex = globalPlayback.countIndex + direction;
        if (nextIndex < 0 || nextIndex > maxCountIndex) {
          globalPlayback.playing = false;
          break;
        }
        globalPlayback.stepAccumulatorSeconds -= countInterval;
        globalPlayback.countIndex = nextIndex;
      }
    }

    applyGlobalCountToAllRobots();
  });
}

// Registers (or re-registers, e.g. after extending) a robot's path for
// playback control. stepSizeYards defaults to the robot's existing step
// size, or the standard "8 to 5" size for a brand-new robot; pass it
// explicitly to override per-robot. Position follows the shared global clock.
export function registerRobotPath(
  robot: TransformNode,
  points: Vector3[],
  scene: Scene,
  stepSizeYards?: number
) {
  if (points.length < 2) return;
  ensureSharedObserver(scene);
  const resolvedStepSize = stepSizeYards ?? players.get(robot)?.stepSizeYards ?? DEFAULT_STEP_SIZE_YARDS;
  const counts = resamplePathIntoCounts(points, resolvedStepSize);
  players.set(robot, { points, stepSizeYards: resolvedStepSize, counts });
  applyGlobalCount(robot, players.get(robot)!);
  recalculateCollisionMarkers(scene);
}

// Walks the robot along the given path once, from the start, then stops and
// waits at the end. Used for restoring saved paths on load; every restored
// robot joins the same shared clock and starts marching together.
export function walkRobotAlongPath(
  robot: TransformNode,
  points: Vector3[],
  scene: Scene,
  stepSizeYards?: number
) {
  if (points.length < 2) {
    robot.setEnabled(false);
    return;
  }
  registerRobotPath(robot, points, scene, stepSizeYards);
  robot.setEnabled(true);
  globalPlayback.speedMultiplier = Math.abs(globalPlayback.speedMultiplier) || 1;
  globalPlayback.playing = true;
}

// Registers a robot's counts directly from an already-per-step position
// sequence (one entry per marching count, index 0 = start), instead of
// resampling a path by step size. Used by callers (e.g. the drill generator)
// that precompute exact per-count positions of their own — such as a joint
// multi-robot avoidance pass where every robot must share the same step
// count and count-for-count timing, which resamplePathIntoCounts can't
// guarantee since it only knows about one robot's own path/step size.
export function registerRobotCounts(robot: TransformNode, positions: Vector3[], scene: Scene) {
  if (positions.length < 1) return;
  ensureSharedObserver(scene);
  const counts: RobotCount[] = [];
  let lastRotationY = 0;
  for (let i = 0; i < positions.length; i++) {
    if (i < positions.length - 1) {
      const dx = positions[i + 1].x - positions[i].x;
      const dz = positions[i + 1].z - positions[i].z;
      if (dx * dx + dz * dz > 0.0001) lastRotationY = Math.atan2(dx, dz);
    }
    counts.push({ position: positions[i].clone(), rotationY: lastRotationY });
  }
  players.set(robot, { points: positions, stepSizeYards: DEFAULT_STEP_SIZE_YARDS, counts });
  applyGlobalCount(robot, players.get(robot)!);
  recalculateCollisionMarkers(scene);
}

// Same as walkRobotAlongPath but for a precomputed per-count position
// sequence (see registerRobotCounts).
export function walkRobotAlongCounts(robot: TransformNode, positions: Vector3[], scene: Scene) {
  if (positions.length < 1) {
    robot.setEnabled(false);
    return;
  }
  registerRobotCounts(robot, positions, scene);
  robot.setEnabled(true);
  globalPlayback.speedMultiplier = Math.abs(globalPlayback.speedMultiplier) || 1;
  globalPlayback.playing = true;
}

// Re-resamples a robot's existing path at a new step size.
export function setRobotStepSize(robot: TransformNode, stepSizeYards: number, skipRecalculate = false) {
  const state = players.get(robot);
  if (!state || stepSizeYards <= 0) return;
  state.stepSizeYards = stepSizeYards;
  state.counts = resamplePathIntoCounts(state.points, stepSizeYards);
  applyGlobalCount(robot, state);
  if (!skipRecalculate && sharedScene) recalculateCollisionMarkers(sharedScene);
}

// Rebuilds a robot's full schedule from scratch — step size AND hold —
// composing both instead of one silently discarding the other. Calling
// setRobotStepSize after delayRobotStart (or vice versa) would otherwise
// wipe out whichever adjustment was made first, since each resamples fresh
// from the raw path points with no memory of the other's change.
export function resetRobotSchedule(
  robot: TransformNode,
  stepSizeYards: number,
  holdCounts: number,
  scene: Scene,
  skipRecalculate = false
) {
  const state = players.get(robot);
  if (!state || stepSizeYards <= 0) return;
  state.stepSizeYards = stepSizeYards;
  const resampled = resamplePathIntoCounts(state.points, stepSizeYards);
  const first = resampled[0];
  const hold: RobotCount[] =
    first && holdCounts > 0
      ? Array.from({ length: holdCounts }, () => ({ position: first.position.clone(), rotationY: first.rotationY }))
      : [];
  state.counts = [...hold, ...resampled];
  applyGlobalCount(robot, state);
  if (!skipRecalculate) recalculateCollisionMarkers(scene);
}

export function getRobotStepSize(robot: TransformNode): number {
  return players.get(robot)?.stepSizeYards ?? DEFAULT_STEP_SIZE_YARDS;
}

// Read-only view of a robot's precalculated marching steps, so callers (e.g.
// per-step grab handles) can position one handle per count.
export function getRobotCounts(robot: TransformNode): ReadonlyArray<RobotCount> | null {
  return players.get(robot)?.counts ?? null;
}

export function setRobotHeld(robot: TransformNode, held: boolean) {
  if (held) {
    heldRobots.add(robot);
  } else {
    heldRobots.delete(robot);
    const state = players.get(robot);
    if (state) applyGlobalCount(robot, state);
  }
}

export function placeRobot(robot: TransformNode, position: Vector3, scene: Scene) {
  setRobotHeld(robot, false);
  const delta = position.subtract(robot.position);
  const state = players.get(robot);
  if (state) {
    state.points = state.points.map((point) => point.add(delta));
    state.counts = state.counts.map((count) => ({ ...count, position: count.position.add(delta) }));
    applyGlobalCount(robot, state);
  } else {
    robot.position.copyFrom(position);
  }
  recalculateCollisionMarkers(scene);
  return delta;
}

// Directly overrides one marching step's position (e.g. dragging its handle),
// bypassing the curve/resampling pipeline since the count table itself is
// the source of truth for playback. Re-derives that step's facing from its
// neighbors so the turn still looks natural, then refreshes collision previews.
export function setRobotCountPosition(
  robot: TransformNode,
  index: number,
  position: Vector3,
  scene: Scene
) {
  const state = players.get(robot);
  const count = state?.counts[index];
  if (!state || !count) return;
  count.position.copyFrom(position);

  const from = state.counts[index - 1] ?? count;
  const to = state.counts[index + 1] ?? count;
  const dx = to.position.x - from.position.x;
  const dz = to.position.z - from.position.z;
  if (dx * dx + dz * dz > 0.0001) {
    count.rotationY = Math.atan2(dx, dz);
  }

  applyGlobalCount(robot, state);
  recalculateCollisionMarkers(scene);
}

// Prepends "hold in place" counts to a robot's route so it departs later than
// count 0 on the shared global clock — e.g. staggering a crowd's departures
// so they don't all cross the same crowded space at the exact same moment.
// skipRecalculate lets a caller staggering many robots in a loop defer the
// (O(n^2)) collision recalculation to a single call once they're all done.
export function delayRobotStart(
  robot: TransformNode,
  holdCounts: number,
  scene: Scene,
  skipRecalculate = false
) {
  const state = players.get(robot);
  const firstCount = state?.counts[0];
  if (!state || !firstCount || holdCounts <= 0) return;
  const hold: RobotCount[] = Array.from({ length: holdCounts }, () => ({
    position: firstCount.position.clone(),
    rotationY: firstCount.rotationY,
  }));
  state.counts = [...hold, ...state.counts];
  applyGlobalCount(robot, state);
  if (!skipRecalculate) recalculateCollisionMarkers(scene);
}

// Triggers a fresh collision-marker pass on demand, e.g. once after a batch
// of delayRobotStart calls that each skipped their own recalculation.
export function refreshCollisionMarkers(scene: Scene) {
  recalculateCollisionMarkers(scene);
}

// --- The transport below controls every registered robot at once, so the
// whole band always marches together on the same synchronized count clock.

export function playAll() {
  globalPlayback.speedMultiplier = Math.abs(globalPlayback.speedMultiplier) || 1;
  globalPlayback.playing = true;
}

export function pauseAll() {
  globalPlayback.playing = false;
}

export function toggleAllPlayback() {
  if (globalPlayback.playing) {
    pauseAll();
  } else {
    playAll();
  }
}

export function isAnyPlaying(): boolean {
  return globalPlayback.playing;
}

export function getMarchTempo(): number {
  return COUNTS_PER_SECOND * 60 * globalPlayback.tempoMultiplier;
}

export function setMarchTempo(beatsPerMinute: number): number {
  const boundedBpm = Math.min(MAX_MARCH_TEMPO_BPM, Math.max(MIN_MARCH_TEMPO_BPM, beatsPerMinute));
  globalPlayback.tempoMultiplier = boundedBpm / (COUNTS_PER_SECOND * 60);
  return getMarchTempo();
}

export function rewindAll() {
  globalPlayback.speedMultiplier = -2;
  globalPlayback.playing = true;
}

export function fastForwardAll() {
  globalPlayback.speedMultiplier = 2;
  globalPlayback.playing = true;
}

export function stepAll(direction: 1 | -1) {
  globalPlayback.playing = false;
  globalPlayback.stepAccumulatorSeconds = 0;
  globalPlayback.countIndex = Math.min(getMaxCountIndex(), Math.max(0, globalPlayback.countIndex + direction));
  applyGlobalCountToAllRobots();
}

// Seeks to a 0..1 fraction along the full drill (e.g. tapping a point on the progress bar).
export function seekAll(fraction: number) {
  globalPlayback.stepAccumulatorSeconds = 0;
  globalPlayback.countIndex = Math.round(Math.min(1, Math.max(0, fraction)) * getMaxCountIndex());
  applyGlobalCountToAllRobots();
}

// Seeks to an absolute count index (e.g. clicking a specific footstep handle)
// and pauses there, so the clicked moment stays put instead of playing on.
export function seekToCount(countIndex: number) {
  globalPlayback.stepAccumulatorSeconds = 0;
  globalPlayback.countIndex = Math.min(getMaxCountIndex(), Math.max(0, countIndex));
  globalPlayback.playing = false;
  applyGlobalCountToAllRobots();
}

// Nudges the shared clock by a relative number of counts (e.g. a joystick
// scrub) and pauses there, same as any other manual seek.
export function scrubBy(deltaCounts: number) {
  seekToCount(globalPlayback.countIndex + deltaCounts);
}

export function getGlobalProgress(): number | null {
  const maxCountIndex = getMaxCountIndex();
  if (maxCountIndex < 1) return null;
  return globalPlayback.countIndex / maxCountIndex;
}


