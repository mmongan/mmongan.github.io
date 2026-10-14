import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Observable, Observer } from '@babylonjs/core/Misc/observable.pure';
import { Node } from '@babylonjs/core/node';
import { Scene } from '@babylonjs/core/scene.pure';
import { createCollisionMarkerManager, COLLISION_MARKER_RADIUS_YARDS } from './collisionMarkers';
import { buildGaitStepPhaseOffsets, gaitPhaseAtBeat, isAutoGaitStyle, selectAutoGait } from './gaitSelection';
import { resolveRepeatPlayback } from './playbackRepeat';
import { registerManualPlacementMarcher, tryManualMarcherPose } from './manualPlacement';
import { CLARINET_MOUTHPIECE_TIP, getClarinetTemplate } from './clarinetModel';
import { FLUTE_MOUTHPIECE_TIP, getFluteTemplate } from './fluteModel';
import { getSousaphoneTemplate, SOUSAPHONE_MOUTHPIECE_TIP, SOUSAPHONE_VALVE_GRIP, sousaphoneLoopPoint } from './sousaphoneModel';
import {
  BASS_DRUM_GRIPS, getBassDrumTemplate, getGlockenspielTemplate, getSnareTemplate, GLOCKENSPIEL_GRIPS, getTenorTemplate, SNARE_GRIPS, TENOR_GRIPS,
} from './percussionModels';
import { getMellophoneTemplate, MELLOPHONE_MOUTHPIECE_TIP } from './mellophoneModel';
import { getRobotEyesTemplate } from './robotFaceModel';
import {
  getMarcherCalfTemplate, getMarcherForearmTemplate, getMarcherGloveTemplate, getMarcherJacketTemplate,
  getMarcherShoeTemplate, getMarcherThighTemplate, getMarcherTrimTemplate, getMarcherUpperArmTemplate,
} from './marcherBodyModel';
import { getSaxophoneTemplate, SAXOPHONE_MOUTHPIECE_TIP } from './saxophoneModel';
import { BARI_SAXOPHONE_MOUTHPIECE_TIP, getBariSaxophoneTemplate } from './bariSaxophoneModel';
import { EUPHONIUM_MOUTHPIECE_TIP, getEuphoniumTemplate } from './euphoniumModel';
import { getTromboneTemplate, TROMBONE_MOUTHPIECE_TIP, TROMBONE_SLIDE_STAY_Y } from './tromboneModel';
import { getTrumpetTemplate } from './trumpetModel';
import type { ModelDetail, ModelTemplate } from './lowPolyInstrument';
import { isFieldShrunk, onARScaleChangedObservable } from '../xr/ar';
import { lowPolygonMarchersToggle } from '../ui/dom';

export { COLLISION_MARKER_RADIUS_YARDS } from './collisionMarkers';

const allRobots = new Set<TransformNode>();
const heldRobots = new Set<TransformNode>();

// Marcher parts and instruments are hardware instances of one hidden source
// mesh per template, so every copy of a part draws in a single call instead
// of one call per marcher. Instances always render in their source's
// rendering group, so a marcher drawn in any other group (held or previewed)
// temporarily uses plain clones of the templates instead. While the field is
// shrunk (Giant and tabletop modes) the sources and clones switch to their
// template's low-detail geometry, keeping parenting and materials.
type ModelPart = Mesh | InstancedMesh;
interface ModelPartInfo { template: ModelTemplate; tinted: boolean }
const modelPartInfo = new WeakMap<AbstractMesh, ModelPartInfo>();
const partSources = new Map<Scene, Map<ModelTemplate, Mesh>>();
const TINTED_PART_SPECULAR = new Color3(0.3, 0.3, 0.32);
function getMarcherDetail(): ModelDetail {
  return lowPolygonMarchersToggle?.checked || isFieldShrunk() ? "low" : "high";
}

let marcherDetail: ModelDetail = getMarcherDetail();
let instrumentDetail: ModelDetail = isFieldShrunk() ? "low" : "high";
const bodyTemplates = new Set<ModelTemplate>([
  getMarcherCalfTemplate, getMarcherForearmTemplate, getMarcherGloveTemplate,
  getMarcherJacketTemplate, getMarcherShoeTemplate, getMarcherThighTemplate,
  getMarcherTrimTemplate, getMarcherUpperArmTemplate, getRobotEyesTemplate,
]);

function getTemplateDetail(template: ModelTemplate): ModelDetail {
  return bodyTemplates.has(template) ? marcherDetail : instrumentDetail;
}

// Sources are visible but never drawn themselves (`isVisible` false); an
// enabled source keeps its instances rendering.
function getPartSource(template: ModelTemplate, scene: Scene, tinted: boolean): Mesh {
  let sources = partSources.get(scene);
  if (!sources) partSources.set(scene, sources = new Map());
  let source = sources.get(template);
  if (!source || source.isDisposed()) {
    const detailTemplate = template(scene, getTemplateDetail(template));
    source = new Mesh(`${detailTemplate.name}Instances`, scene);
    detailTemplate.geometry?.applyToMesh(source);
    source.material = detailTemplate.material;
    source.isVisible = false;
    source.isPickable = false;
    if (tinted) {
      source.registerInstancedBuffer(VertexBuffer.ColorKind, 4);
      source.instancedBuffers.color = new Color4(1, 1, 1, 1);
    }
    sources.set(template, source);
  }
  return source;
}

function createModelPart(template: ModelTemplate, scene: Scene, name: string, parent: Node | null,
  robot: TransformNode, tinted = false): ModelPart {
  let mesh: ModelPart;
  const color = robotColors.get(robot) ?? Color3.White();
  if (getMarcherRenderingGroup(robot) === 0) {
    mesh = getPartSource(template, scene, tinted).createInstance(name);
    mesh.parent = parent;
    if (tinted) mesh.instancedBuffers.color = Color4.FromColor3(color);
  } else {
    mesh = template(scene, getTemplateDetail(template)).clone(name, parent);
    mesh.setEnabled(true);
    mesh.renderingGroupId = getMarcherRenderingGroup(robot);
    if (tinted) mesh.material = getTintedPartMaterial(robot);
  }
  mesh.isPickable = true;
  modelPartInfo.set(mesh, { template, tinted });
  return mesh;
}

// Clones can't take a per-instance tint, so a robot drawn as clones gets its
// own material matching the shared part material in its team color.
const tintedPartMaterials = new Map<TransformNode, StandardMaterial>();

function getTintedPartMaterial(robot: TransformNode): StandardMaterial {
  let material = tintedPartMaterials.get(robot);
  if (!material) {
    material = new StandardMaterial("robotBodyMaterial", robot.getScene());
    material.diffuseColor = robotColors.get(robot) ?? Color3.White();
    material.specularColor = TINTED_PART_SPECULAR;
    material.specularPower = 32;
    tintedPartMaterials.set(robot, material);
  }
  return material;
}

// One unlit disc shared by every marcher's top-down marker, tinted per
// instance (white emissive times the instance color).
const topDownMarkerSources = new WeakMap<Scene, Mesh>();

function getTopDownMarkerSource(scene: Scene): Mesh {
  let source = topDownMarkerSources.get(scene);
  if (!source || source.isDisposed()) {
    const material = new StandardMaterial("robotMarkerMaterial", scene);
    material.diffuseColor = Color3.Black();
    material.emissiveColor = Color3.White();
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    material.backFaceCulling = false;
    source = MeshBuilder.CreateDisc("robotTopDownMarkerInstances",
      { radius: TOP_DOWN_MARKER_DIAMETER_YARDS / 2, tessellation: 16 }, scene);
    source.material = material;
    source.layerMask = TOP_DOWN_MARKER_LAYER_MASK;
    source.isVisible = false;
    source.isPickable = false;
    source.registerInstancedBuffer(VertexBuffer.ColorKind, 4);
    source.instancedBuffers.color = new Color4(1, 1, 1, 1);
    topDownMarkerSources.set(scene, source);
  }
  return source;
}

const marcherRenderingGroups = new Map<TransformNode, number>();

export function getMarcherRenderingGroup(robot: TransformNode): number {
  return marcherRenderingGroups.get(robot) ?? 0;
}

// Moves every mesh of a marcher into a rendering group. Parts switch between
// instances (group 0) and clones (any other group), keeping their names,
// transforms, children, and the references marcherParts holds to them.
export function setMarcherRenderingGroup(robot: TransformNode, group: number) {
  const previous = getMarcherRenderingGroup(robot);
  if (group === previous || robot.isDisposed()) return;
  if (group === 0) marcherRenderingGroups.delete(robot);
  else marcherRenderingGroups.set(robot, group);
  const swapPartType = previous === 0 || group === 0;
  const replacements = new Map<Node, ModelPart>();
  robot.getChildMeshes(false).forEach((mesh) => {
    const info = modelPartInfo.get(mesh);
    if (!info || !swapPartType) {
      // Instances (the top-down marker) always draw in their source's group.
      if (!(mesh instanceof InstancedMesh)) mesh.renderingGroupId = group;
      return;
    }
    const replacement = createModelPart(info.template, robot.getScene(), mesh.name, mesh.parent, robot, info.tinted);
    replacement.position.copyFrom(mesh.position);
    replacement.rotation.copyFrom(mesh.rotation);
    replacement.rotationQuaternion = mesh.rotationQuaternion?.clone() ?? null;
    replacement.scaling.copyFrom(mesh.scaling);
    replacement.layerMask = mesh.layerMask;
    replacement.isPickable = mesh.isPickable;
    replacement.setEnabled(mesh.isEnabled(false));
    replacements.set(mesh, replacement);
  });
  if (replacements.size === 0) return;
  replacements.forEach((replacement, mesh) => {
    if (replacement.parent && replacements.has(replacement.parent)) {
      replacement.parent = replacements.get(replacement.parent)!;
    }
    mesh.getChildren().forEach((child) => {
      if (!replacements.has(child)) child.parent = replacement;
    });
  });
  replacements.forEach((_, mesh) => mesh.dispose(true));
  const parts = marcherParts.get(robot);
  if (parts) {
    const swap = (mesh: ModelPart) => replacements.get(mesh) ?? mesh;
    parts.horn = swap(parts.horn);
    parts.gloves = [swap(parts.gloves[0]), swap(parts.gloves[1])];
    parts.leftShoe = swap(parts.leftShoe);
    parts.rightShoe = swap(parts.rightShoe);
  }
}
type GeometrySwapMesh = Mesh & {
  _createGlobalSubMesh(force: boolean): unknown;
  _invalidateInstanceVertexArrayObject(): void;
};

// Swap a mesh to another detail level's geometry. applyToMesh only rebuilds
// the submesh when the new geometry is smaller, so going back up to high
// detail would keep drawing the low-detail index range; force it. Sources
// with per-instance colors also cache vertex array objects bound to the old
// geometry's buffers, which applyToMesh doesn't release.
function applyDetailGeometry(mesh: Mesh, template: ModelTemplate, detail: ModelDetail) {
  const geometry = template(mesh.getScene(), detail).geometry;
  if (!geometry || mesh.geometry === geometry) return;
  geometry.applyToMesh(mesh);
  const swapMesh = mesh as GeometrySwapMesh;
  swapMesh._createGlobalSubMesh(true);
  swapMesh._invalidateInstanceVertexArrayObject();
  mesh.synchronizeInstances();
  mesh.instances.forEach((instance) => instance.refreshBoundingInfo());
}

function setMarcherDetail(detail: ModelDetail) {
  const nextInstrumentDetail = isFieldShrunk() ? "low" : "high";
  if (detail === marcherDetail && nextInstrumentDetail === instrumentDetail) return;
  marcherDetail = detail;
  instrumentDetail = nextInstrumentDetail;
  allRobots.forEach((robot) => {
    robot.getChildMeshes(false).forEach((mesh) => {
      const info = modelPartInfo.get(mesh);
      if (info && mesh instanceof Mesh) applyDetailGeometry(mesh, info.template, getTemplateDetail(info.template));
    });
  });
  partSources.forEach((sources) => sources.forEach((source, template) => {
    if (!source.isDisposed()) applyDetailGeometry(source, template, getTemplateDetail(template));
  }));
}

onARScaleChangedObservable.add(() => setMarcherDetail(getMarcherDetail()));
lowPolygonMarchersToggle?.addEventListener("change", () => setMarcherDetail(getMarcherDetail()));
const MARCHER_BUILD_SCALE = 0.64;
const MARCHER_HEIGHT_METERS = 1.8;
const METERS_PER_YARD = 0.9144;
const MARCHER_HEIGHT_YARDS = MARCHER_HEIGHT_METERS / METERS_PER_YARD;
// Standing soles are at y = 0; the skull crown is below the shako and plume.
const MARCHER_MODEL_HEIGHT_YARDS = 1.372;
const MARCHER_BODY_SCALE = MARCHER_HEIGHT_YARDS / MARCHER_MODEL_HEIGHT_YARDS;

export function getMarcherEyePose(robot: TransformNode): { position: Vector3; yaw: number } | null {
  const parts = marcherParts.get(robot);
  if (!parts || robot.isDisposed() || !robot.isEnabled()) return null;
  const world = parts.body.computeWorldMatrix(true);
  const forward = Vector3.TransformNormal(Vector3.Forward(), robot.computeWorldMatrix(true));
  return {
    position: Vector3.TransformCoordinates(new Vector3(0, 1.283, 0.154), world),
    yaw: Math.atan2(forward.x, forward.z),
  };
}

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
const UPPER_ARM_LENGTH = 0.3;
const FOREARM_LENGTH = 0.4;
export type MarcherInstrument = "trumpet" | "mellophone" | "altoSax" | "bariSax" | "trombone" | "euphonium" |
  "clarinet" | "flute" | "sousaphone" | "snare" | "tenors" | "bassDrum" | "glockenspiel";

// Instruments hang off an unsquashed root (uniform MARCHER_BODY_SCALE), so
// they keep true proportions at any rotation. Instrument-root coordinates are
// body coordinates with x and z multiplied by MARCHER_BUILD_SCALE.
// `grips` are instrument-local [left, right] hand centers; `mouthpiece` is the
// local point placed on the lips in the playing pose.
interface InstrumentSpec {
  label: string;
  template: ModelTemplate;
  grips: [Vector3, Vector3];
  mouthpiece: Vector3;
  playRotation: Vector3;
  restPosition: Vector3;
  restRotation: Vector3;
  // Body-space directions the [left, right] elbows bend toward while playing.
  elbowBends?: [Vector3, Vector3];
}

const DEFAULT_ELBOW_BENDS: [Vector3, Vector3] = [new Vector3(-0.6, -1, -0.2), new Vector3(0.6, -1, -0.2)];
const MARCHER_MOUTH = new Vector3(0, 1.2, 0.16 * MARCHER_BUILD_SCALE);

// Drums hang on a carrier and are modelled in instrument-root coordinates, so
// they never move: the "mouthpiece" is the mouth itself, and playing and
// carrying are the same pose with the sticks held over the heads.
function wornInstrument(label: string, template: ModelTemplate, grips: [Vector3, Vector3]): InstrumentSpec {
  return {
    label, template, grips,
    mouthpiece: MARCHER_MOUTH,
    playRotation: Vector3.Zero(),
    restPosition: Vector3.Zero(),
    restRotation: Vector3.Zero(),
  };
}

const INSTRUMENTS: Record<MarcherInstrument, InstrumentSpec> = {
  // Left hand wraps the valve casings, right hand sits over the valve buttons.
  // Local +Y runs toward the mouthpiece, +Z toward the buttons.
  trumpet: {
    label: "Trumpet",
    template: getTrumpetTemplate,
    grips: [new Vector3(-0.055, 0, -0.01), new Vector3(0.05, 0, 0.07)],
    mouthpiece: new Vector3(0, 0.25, 0),
    playRotation: new Vector3(-Math.PI / 2, 0, 0),
    restPosition: new Vector3(0, 0.86, 0.32),
    restRotation: Vector3.Zero(),
  },
  // Held like the trumpet (same valve layout), with a longer leadpipe and a
  // much larger forward bell. Carried upright with the bell down.
  mellophone: {
    label: "Mellophone",
    template: getMellophoneTemplate,
    grips: [new Vector3(-0.06, 0, -0.01), new Vector3(0.05, 0, 0.07)],
    mouthpiece: MELLOPHONE_MOUTHPIECE_TIP,
    playRotation: new Vector3(-Math.PI / 2, 0, 0),
    restPosition: new Vector3(0, 0.82, 0.34),
    restRotation: Vector3.Zero(),
  },
  // Held down and slightly out to the right; left hand on the upper key stack,
  // right hand on the lower one. Local +Y runs up the body, -Z toward the player.
  altoSax: {
    label: "Alto saxophone",
    template: getSaxophoneTemplate,
    grips: [new Vector3(-0.025, 0.17, -0.06), new Vector3(0.025, -0.07, -0.065)],
    mouthpiece: SAXOPHONE_MOUTHPIECE_TIP,
    playRotation: new Vector3(-0.25, 0, 0.35),
    restPosition: new Vector3(0.05, 0.66, 0.24),
    restRotation: new Vector3(0, 0, 0.2),
  },
  // Held like the alto but hanging lower and further out to the right on its
  // harness, so the long body and bow clear the legs; the pigtail loop rises
  // beside the head. Carried upright at the right hip.
  bariSax: {
    label: "Baritone saxophone",
    template: getBariSaxophoneTemplate,
    grips: [new Vector3(-0.03, 0.17, -0.07), new Vector3(0.03, -0.13, -0.075)],
    mouthpiece: BARI_SAXOPHONE_MOUTHPIECE_TIP,
    playRotation: new Vector3(-0.2, 0, 0.42),
    restPosition: new Vector3(0.1, 0.62, 0.28),
    restRotation: new Vector3(0, 0, 0.15),
  },
  // Slide forward at first position, bell section over the left shoulder.
  // Left hand rests beside the receiver, right hand holds the brass slide crosspiece.
  // Carried upright with the slide pointing down.
  trombone: {
    label: "Trombone",
    template: getTromboneTemplate,
    grips: [new Vector3(-0.055, 0.02, 0), new Vector3(0.055, TROMBONE_SLIDE_STAY_Y, 0)],
    mouthpiece: TROMBONE_MOUTHPIECE_TIP,
    playRotation: new Vector3(-Math.PI / 2, 0, 0),
    restPosition: new Vector3(0.02, 0.95, 0.3),
    restRotation: Vector3.Zero(),
  },
  // Front-bell horn held like the mellophone but much heavier: left hand
  // under the leadpipe wrap, right hand over the valve buttons, bell forward.
  // Carried upright with the bell down.
  euphonium: {
    label: "Euphonium",
    template: getEuphoniumTemplate,
    grips: [new Vector3(-0.075, -0.04, -0.02), new Vector3(0.06, 0, 0.09)],
    mouthpiece: EUPHONIUM_MOUTHPIECE_TIP,
    playRotation: new Vector3(-Math.PI / 2, 0, 0),
    restPosition: new Vector3(0, 0.84, 0.38),
    restRotation: Vector3.Zero(),
  },
  // Angled about 40° below horizontal, left hand on the upper joint and right
  // hand on the lower joint, fingers over the front keys. Carried upright.
  clarinet: {
    label: "Clarinet",
    template: getClarinetTemplate,
    grips: [new Vector3(-0.012, 0.13, 0.025), new Vector3(0.012, -0.03, 0.025)],
    mouthpiece: CLARINET_MOUTHPIECE_TIP,
    playRotation: new Vector3(-0.87, 0, 0),
    restPosition: new Vector3(0, 0.82, 0.3),
    restRotation: Vector3.Zero(),
  },
  // Held level out to the right with the lip plate under the lips and the
  // foot angled slightly forward; both hands under the tube, left hand nearer
  // the head joint. Carried upright with the crown up. The left hand crosses
  // in front of the chin, so its elbow swings out sideways to clear the chest.
  flute: {
    label: "Flute",
    template: getFluteTemplate,
    grips: [new Vector3(0.01, -0.12, -0.012), new Vector3(0.01, -0.33, -0.012)],
    mouthpiece: FLUTE_MOUTHPIECE_TIP,
    playRotation: new Vector3(-Math.PI / 2, -0.25, Math.PI / 2),
    restPosition: new Vector3(0, 0.98, 0.3),
    restRotation: Vector3.Zero(),
    elbowBends: [new Vector3(-1, -0.5, 0), DEFAULT_ELBOW_BENDS[1]],
  },
  // Worn, so it is modelled in instrument-root coordinates and never rotates:
  // playing and carrying are the same pose. Right hand on the valves, left
  // hand on the front of the body loop below the left shoulder.
  sousaphone: {
    label: "Sousaphone",
    template: getSousaphoneTemplate,
    grips: [sousaphoneLoopPoint((3 * Math.PI) / 4), SOUSAPHONE_VALVE_GRIP],
    mouthpiece: SOUSAPHONE_MOUTHPIECE_TIP,
    playRotation: Vector3.Zero(),
    restPosition: Vector3.Zero(),
    restRotation: Vector3.Zero(),
  },
  snare: wornInstrument("Snare drum", getSnareTemplate, SNARE_GRIPS),
  tenors: wornInstrument("Tenor drums", getTenorTemplate, TENOR_GRIPS),
  bassDrum: wornInstrument("Bass drum", getBassDrumTemplate, BASS_DRUM_GRIPS),
  glockenspiel: wornInstrument("Glockenspiel", getGlockenspielTemplate, GLOCKENSPIEL_GRIPS),
};
export const MARCHER_INSTRUMENTS = Object.keys(INSTRUMENTS) as MarcherInstrument[];
const marcherParts = new Map<TransformNode, {
  gaitIndex: number;
  instrumentRestPose: boolean;
  instrument: MarcherInstrument;
  gloves: [ModelPart, ModelPart];
  leftLeg: TransformNode;
  rightLeg: TransformNode;
  leftKnee: TransformNode;
  rightKnee: TransformNode;
  leftThigh: ModelPart;
  rightThigh: ModelPart;
  leftAnkle: TransformNode;
  rightAnkle: TransformNode;
  leftShoe: ModelPart;
  rightShoe: ModelPart;
  leftArm: TransformNode;
  rightArm: TransformNode;
  leftForearm: TransformNode;
  rightForearm: TransformNode;
  appliedInstrumentRestPose?: boolean;
  horn: ModelPart;
  body: TransformNode;
}>();

function orientMarcherShoes(leftShoe: ModelPart, rightShoe: ModelPart, legFacingOffset: number) {
  const shoeFacing = -legFacingOffset;
  for (const shoe of [leftShoe, rightShoe]) {
    shoe.rotation.y = shoeFacing;
    shoe.position.x = Math.sin(shoeFacing) * 0.07;
    shoe.position.z = Math.cos(shoeFacing) * 0.07;
  }
}

const thighDirection = Vector3.Zero();
const thighUp = Vector3.Up();

function attachMarcherThigh(thigh: ModelPart, leg: TransformNode, hipX: number) {
  const dx = hipX - leg.position.x;
  const dy = 0.69 - leg.position.y;
  const dz = -leg.position.z;
  const sinY = Math.sin(leg.rotation.y);
  const cosY = Math.cos(leg.rotation.y);
  const sinX = Math.sin(leg.rotation.x);
  const cosX = Math.cos(leg.rotation.x);
  const localZ = dx * sinY + dz * cosY;
  // Hip in the leg's local frame, measured from the knee at y = -0.37.
  thighDirection.set(dx * cosY - dz * sinY,
    dy * cosX + localZ * sinX + 0.37,
    -dy * sinX + localZ * cosX);
  const length = thighDirection.length();
  thigh.position.copyFrom(thighDirection).scaleInPlace(0.21 / 0.37);
  thigh.position.y -= 0.37;
  thigh.scaling.y = length / 0.37;
  thighDirection.scaleInPlace(1 / length);
  Quaternion.FromUnitVectorsToRef(thighUp, thighDirection, thigh.rotationQuaternion!);
}

function hornRotationMatrix(horn: ModelPart): Matrix {
  return Matrix.RotationYawPitchRoll(horn.rotation.y, horn.rotation.x, horn.rotation.z);
}

function applyInstrumentPose(parts: {
  instrument: MarcherInstrument;
  leftArm: TransformNode;
  rightArm: TransformNode;
  leftForearm: TransformNode;
  rightForearm: TransformNode;
  appliedInstrumentRestPose?: boolean;
  horn: ModelPart;
}, restPose: boolean) {
  if (parts.appliedInstrumentRestPose === restPose) return;
  parts.appliedInstrumentRestPose = restPose;
  const spec = INSTRUMENTS[parts.instrument];
  if (restPose) {
    parts.horn.position.copyFrom(spec.restPosition);
    parts.horn.rotation.copyFrom(spec.restRotation);
  } else {
    // Put the mouthpiece on the lips.
    parts.horn.rotation.copyFrom(spec.playRotation);
    const mouthpieceOffset = Vector3.TransformCoordinates(spec.mouthpiece, hornRotationMatrix(parts.horn));
    parts.horn.position.copyFrom(MARCHER_MOUTH.subtract(mouthpieceOffset));
  }
  const hornRotation = hornRotationMatrix(parts.horn);
  for (const [index, arm, forearm] of [
    [0, parts.leftArm, parts.leftForearm],
    [1, parts.rightArm, parts.rightForearm],
  ] as const) {
    // Grip in instrument-root coordinates, then unsquash into body coordinates.
    const grip = Vector3.TransformCoordinates(spec.grips[index], hornRotation).add(parts.horn.position);
    const wrist = new Vector3(grip.x / MARCHER_BUILD_SCALE, grip.y, grip.z / MARCHER_BUILD_SCALE);
    const shoulderToWrist = wrist.subtract(arm.position);
    const distance = shoulderToWrist.length();
    const direction = shoulderToWrist.scale(1 / distance);
    // Out of reach, the arm straightens and the forearm stretches to the grip
    // so the elbow and wrist stay attached.
    const along = Math.min(UPPER_ARM_LENGTH,
      (UPPER_ARM_LENGTH ** 2 - FOREARM_LENGTH ** 2 + distance ** 2) / (2 * distance));
    const outward = (!restPose && spec.elbowBends ? spec.elbowBends : DEFAULT_ELBOW_BENDS)[index];
    const bendDirection = outward.subtract(direction.scale(Vector3.Dot(outward, direction))).normalize();
    const bend = Math.sqrt(Math.max(0, UPPER_ARM_LENGTH ** 2 - along ** 2));
    const elbow = arm.position.add(direction.scale(along)).add(bendDirection.scale(bend));
    forearm.position.copyFrom(elbow);
    forearm.scaling.y = Math.max(1, Vector3.Distance(elbow, wrist) / FOREARM_LENGTH);
    Quaternion.FromUnitVectorsToRef(Vector3.Down(), elbow.subtract(arm.position).normalize(), arm.rotationQuaternion!);
    Quaternion.FromUnitVectorsToRef(Vector3.Down(), wrist.subtract(elbow).normalize(), forearm.rotationQuaternion!);
  }
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

let selectedMarchingGait = 0;
let instrumentCarryPose = false;

export function getMarchingGaitIndex(): number {
  return selectedMarchingGait;
}

export function getMarchingGaitTempoFactor(): number {
  return MARCHING_GAITS[selectedMarchingGait].tempoFactor;
}

// Forward styles (Field March, High Step, Parade, Knee-Ankle) turn on automatic
// gait: each count picks mark time, half/double time, backward or crab walk from
// facing, travel direction and step size. Any other gait is forced on everyone.
export function isAutoGaitActive(): boolean {
  return isAutoGaitStyle(MARCHING_GAITS[selectedMarchingGait].name);
}

export function getMarchingGaitLabel(): string {
  const name = MARCHING_GAITS[selectedMarchingGait].name;
  return isAutoGaitActive() ? `Auto · ${name}` : name;
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

let selectedInstrument: MarcherInstrument = "trumpet";

export function getInstrumentLabel(instrument: MarcherInstrument): string {
  return INSTRUMENTS[instrument].label;
}

export function getSelectedInstrument(): MarcherInstrument {
  return selectedInstrument;
}

// The instrument new marchers are created with.
export function setSelectedInstrument(instrument: MarcherInstrument) {
  selectedInstrument = instrument;
}

export function getMarcherInstrument(robot: TransformNode): MarcherInstrument | null {
  return marcherParts.get(robot)?.instrument ?? null;
}

function createInstrumentMesh(robot: TransformNode, instrument: MarcherInstrument, root: TransformNode): ModelPart {
  return createModelPart(INSTRUMENTS[instrument].template, robot.getScene(), "marcherHorn", root, robot);
}

// Swaps a marcher's instrument mesh, moving its gloves onto the new grips.
export function setMarcherInstrument(robot: TransformNode, instrument: MarcherInstrument) {
  const parts = marcherParts.get(robot);
  if (!parts || parts.instrument === instrument) return;
  const oldHorn = parts.horn;
  const horn = createInstrumentMesh(robot, instrument, oldHorn.parent as TransformNode);
  horn.layerMask = oldHorn.layerMask;
  parts.gloves.forEach((glove, index) => {
    glove.parent = horn;
    glove.position.copyFrom(INSTRUMENTS[instrument].grips[index]);
  });
  oldHorn.dispose();
  parts.horn = horn;
  parts.instrument = instrument;
  parts.appliedInstrumentRestPose = undefined;
  applyInstrumentPose(parts, parts.instrumentRestPose);
}

export function cycleMarchingGait(direction: -1 | 1): number {
  selectedMarchingGait = (selectedMarchingGait + direction + MARCHING_GAITS.length) % MARCHING_GAITS.length;
  marcherParts.forEach((parts) => {
    parts.gaitIndex = selectedMarchingGait;
  });
  return selectedMarchingGait;
}

function createMarcherModel(scene: Scene, gaitIndex: number): TransformNode {
  const robot = new TransformNode("pathRobot", scene);
  allRobots.add(robot);

  const color = nextRobotColor();
  robotColors.set(robot, color);

  const body = new TransformNode("marcherBody", scene);
  body.parent = robot;
  body.scaling.set(MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE, MARCHER_BODY_SCALE, MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE);
  const part = (template: ModelTemplate, name: string, parent: Node | null, tinted = false) =>
    createModelPart(template, scene, name, parent, robot, tinted);

  part(getMarcherJacketTemplate, "marcherJacket", body, true);
  part(getMarcherTrimTemplate, "marcherTrim", body);
  part(getRobotEyesTemplate, "robotEyes", body);

  const appendages = ([-1, 1] as const).map((side) => {
    const leg = new TransformNode("marcherLeg", scene);
    leg.position.set(side * 0.09, 0.69, 0);
    leg.parent = body;
    const thigh = part(getMarcherThighTemplate, "marcherThigh", leg);
    thigh.position.y = -0.16;
    thigh.rotationQuaternion = Quaternion.Identity();

    const knee = new TransformNode("marcherKnee", scene);
    knee.position.y = -0.37;
    knee.parent = leg;
    part(getMarcherCalfTemplate, "marcherCalf", knee);

    const ankle = new TransformNode("marcherAnkle", scene);
    ankle.position.y = -0.2;
    ankle.parent = knee;
    const shoe = part(getMarcherShoeTemplate, "marcherShoe", ankle);
    shoe.position.set(0, -0.06, 0.07);

    const arm = new TransformNode("marcherArm", scene);
    arm.position.set(side * 0.31, 1.02, 0);
    arm.rotationQuaternion = Quaternion.Identity();
    arm.parent = body;
    part(getMarcherUpperArmTemplate, "marcherUpperArm", arm, true);
    const forearm = new TransformNode("marcherForearm", scene);
    forearm.rotationQuaternion = Quaternion.Identity();
    forearm.parent = body;
    part(getMarcherForearmTemplate, "marcherForearm", forearm, true);
    const glove = part(getMarcherGloveTemplate, "marcherHand", null);
    return { leg, knee, ankle, shoe, thigh, arm, forearm, glove };
  });

  const instrumentRoot = new TransformNode("marcherInstrumentRoot", scene);
  instrumentRoot.parent = robot;
  instrumentRoot.scaling.setAll(MARCHER_BODY_SCALE);
  const instrument = selectedInstrument;
  const horn = createInstrumentMesh(robot, instrument, instrumentRoot);
  appendages.forEach(({ glove }, index) => {
    glove.parent = horn;
    glove.position.copyFrom(INSTRUMENTS[instrument].grips[index]);
  });
  const resolvedGaitIndex = Math.min(MARCHING_GAITS.length - 1, Math.max(0, gaitIndex));
  const initialGait = MARCHING_GAITS[resolvedGaitIndex];
  orientMarcherShoes(appendages[0].shoe, appendages[1].shoe,
    "legFacingOffset" in initialGait ? initialGait.legFacingOffset : 0);

  marcherParts.set(robot, {
    gaitIndex: resolvedGaitIndex,
    instrumentRestPose: instrumentCarryPose,
    instrument,
    gloves: [appendages[0].glove, appendages[1].glove],
    leftLeg: appendages[0].leg, rightLeg: appendages[1].leg,
    leftKnee: appendages[0].knee, rightKnee: appendages[1].knee,
    leftThigh: appendages[0].thigh, rightThigh: appendages[1].thigh,
    leftAnkle: appendages[0].ankle, rightAnkle: appendages[1].ankle,
    leftShoe: appendages[0].shoe, rightShoe: appendages[1].shoe,
    leftArm: appendages[0].arm, rightArm: appendages[1].arm,
    leftForearm: appendages[0].forearm, rightForearm: appendages[1].forearm, horn, body,
  });
  applyInstrumentPose(marcherParts.get(robot)!, instrumentCarryPose);

  const marker = getTopDownMarkerSource(scene).createInstance("robotTopDownMarker");
  marker.instancedBuffers.color = Color4.FromColor3(color);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 1.85 * MARCHER_BODY_SCALE;
  marker.layerMask = TOP_DOWN_MARKER_LAYER_MASK;
  marker.isPickable = false;
  marker.parent = robot;

  robot.onDisposeObservable.add(() => {
    tintedPartMaterials.get(robot)?.dispose();
    tintedPartMaterials.delete(robot);
    marcherRenderingGroups.delete(robot);
    allRobots.delete(robot);
    heldRobots.delete(robot);
    robotColors.delete(robot);
    marcherParts.delete(robot);
    players.delete(robot);
    recalculateCollisionMarkers(scene);
  });

  robot.setEnabled(false);
  registerManualPlacementMarcher(robot, () =>
    robot.getChildMeshes().filter((mesh) => modelPartInfo.has(mesh)));

  return robot;
}

export function createLowPolyRobot(scene: Scene, gaitIndex = selectedMarchingGait): TransformNode {
  return createMarcherModel(scene, gaitIndex);
}

// --- Playback control: play/pause, rewind, fast-forward, step, and seeking
// along a robot's recorded path. All positions/facings are precalculated once
// per path (resamplePathIntoCounts) into a fixed table of drill "counts";
// playback interpolates only between neighboring count positions, so each
// footfall still lands exactly on a precalculated drill count.

interface RobotCount {
  position: Vector3;
  // Travel heading at this count.
  rotationY: number;
  // Explicit body facing (e.g. facing the box while sliding); absent means
  // the marcher faces where it travels.
  facingY?: number;
}

// Each robot keeps only its own route/table; the playback transport itself
// (below) is shared by every robot so the whole band marches on one clock.
interface PlayerState {
  points: Vector3[];
  stepSizeYards: number;
  counts: RobotCount[];
  gaitPhaseCache?: Map<number, { counts: RobotCount[]; offsets: number[] }>;
  // Facing held for the whole route; reapplied whenever counts are rebuilt.
  fixedFacingY?: number;
}

// Default marching band "8 to 5" step size (8 steps per 5 yards); each robot
// can be given its own via registerRobotPath/setRobotStepSize. A brisk marching
// tempo is used only to time how often the precomputed count index advances.
const DEFAULT_STEP_SIZE_YARDS = 0.625;
const COUNTS_PER_SECOND = 4;
export const MIN_MARCH_TEMPO_BPM = 60;
export const MAX_MARCH_TEMPO_BPM = 120;
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

export interface DrillTransportState {
  beat: number;
  beatsPerSecond: number;
  playing: boolean;
  lastBeat: number;
  revision: number;
}

export interface PlaybackTempoEvent {
  beat: number;
  bpm: number;
}

let transportRevision = 0;
let repeatElapsed: number | null = null;
let repeatOptions = { drill: false, song: false, songLength: 0 };
let playbackTempoMap: ReadonlyArray<PlaybackTempoEvent> | null = null;

export function setPlaybackRepeat(drill: boolean, song: boolean) {
  repeatElapsed ??= getDrillTransportState().beat;
  repeatOptions = { ...repeatOptions, drill, song };
  if (!drill && !song) repeatElapsed = null;
  notifyDrillTransport(true);
}

export function setPlaybackSongLength(songLength: number) {
  repeatOptions.songLength = songLength;
  repeatElapsed = repeatOptions.drill || repeatOptions.song ? getDrillTransportState().beat : null;
  notifyDrillTransport(true);
}

export function setPlaybackTempoMap(tempoMap: ReadonlyArray<PlaybackTempoEvent> | null) {
  const beat = getDrillTransportState().beat;
  playbackTempoMap = tempoMap?.map((event) => ({ ...event })) ?? null;
  setDrillBeatPosition(beat);
  notifyDrillTransport(true);
}

export function getMusicTransportState(): DrillTransportState {
  const state = getDrillTransportState();
  if (repeatElapsed === null) return state;
  const frame = resolveRepeatPlayback(repeatElapsed, state.lastBeat, repeatOptions);
  return { ...state, beat: frame.songBeat, lastBeat: frame.songEnd,
    beatsPerSecond: globalPlayback.speedMultiplier / getCountInterval(frame.songBeat),
    revision: state.revision + frame.songCycle };
}

export const onDrillTransportChangedObservable = new Observable<DrillTransportState>();

function getTempoBpmAtBeat(beat: number): number {
  if (!playbackTempoMap?.length) return COUNTS_PER_SECOND * 60 * globalPlayback.tempoMultiplier;
  let low = 0;
  let high = playbackTempoMap.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (playbackTempoMap[middle].beat <= beat) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? playbackTempoMap[low - 1].bpm : 120;
}

function getCountInterval(beat: number, gaitIndex = selectedMarchingGait): number {
  return 60 / (getTempoBpmAtBeat(Math.max(0, beat)) * MARCHING_GAITS[gaitIndex].tempoFactor);
}

const TEMPO_BOUNDARY_EPSILON = 1e-9;

function nextTempoBoundary(beat: number, end: number, direction: 1 | -1): number {
  if (!playbackTempoMap) return end;
  let boundary = end;
  for (const event of playbackTempoMap) {
    if (direction > 0 && event.beat > beat + TEMPO_BOUNDARY_EPSILON && event.beat < boundary) {
      boundary = event.beat;
    } else if (direction < 0 && event.beat < beat - TEMPO_BOUNDARY_EPSILON && event.beat > boundary) {
      boundary = event.beat;
    }
  }
  return boundary;
}

function getSecondsBetweenBeats(start: number, end: number, gaitIndex = selectedMarchingGait): number {
  const direction: 1 | -1 = end >= start ? 1 : -1;
  let beat = start;
  let seconds = 0;
  while (direction * (end - beat) > TEMPO_BOUNDARY_EPSILON) {
    const tempoBeat = direction > 0 ? beat : beat - TEMPO_BOUNDARY_EPSILON;
    const boundary = nextTempoBoundary(beat, end, direction);
    seconds += Math.abs(boundary - beat) * getCountInterval(tempoBeat, gaitIndex);
    beat = boundary;
  }
  return seconds;
}

function advanceBeatBySeconds(
  start: number,
  end: number,
  seconds: number,
  gaitIndex = selectedMarchingGait
): number {
  const direction: 1 | -1 = end >= start ? 1 : -1;
  let beat = start;
  let remainingSeconds = Math.max(0, seconds);
  while (direction * (end - beat) > TEMPO_BOUNDARY_EPSILON && remainingSeconds > 0) {
    const tempoBeat = direction > 0 ? beat : beat - TEMPO_BOUNDARY_EPSILON;
    const boundary = nextTempoBoundary(beat, end, direction);
    const interval = getCountInterval(tempoBeat, gaitIndex);
    const secondsToBoundary = Math.abs(boundary - beat) * interval;
    if (remainingSeconds < secondsToBoundary) return beat + direction * remainingSeconds / interval;
    beat = boundary;
    remainingSeconds -= secondsToBoundary;
  }
  return beat;
}

function setDrillBeatPosition(beat: number) {
  const reverse = globalPlayback.speedMultiplier < 0;
  globalPlayback.countIndex = reverse ? Math.ceil(beat) : Math.floor(beat);
  globalPlayback.stepAccumulatorSeconds = getSecondsBetweenBeats(globalPlayback.countIndex, beat);
}

export function getDrillTransportState(): DrillTransportState {
  const direction = Math.sign(globalPlayback.speedMultiplier);
  const startBeat = globalPlayback.countIndex;
  const endBeat = globalPlayback.countIndex + (direction < 0 ? -1 : direction > 0 ? 1 : 0);
  const beat = repeatElapsed !== null
    ? resolveRepeatPlayback(repeatElapsed, getMaxCountIndex(), repeatOptions).drillBeat
    : advanceBeatBySeconds(startBeat, endBeat, globalPlayback.stepAccumulatorSeconds);
  const tempoBeat = direction < 0 ? beat - TEMPO_BOUNDARY_EPSILON : beat;
  const cadence = 1 / getCountInterval(tempoBeat);
  const lastBeat = getMaxCountIndex();
  return {
    beat: Math.min(lastBeat, Math.max(0, beat)),
    beatsPerSecond: cadence * globalPlayback.speedMultiplier,
    playing: globalPlayback.playing,
    lastBeat,
    revision: transportRevision,
  };
}

function notifyDrillTransport(discontinuity = false) {
  if (discontinuity) transportRevision++;
  onDrillTransportChangedObservable.notifyObservers(getDrillTransportState());
}

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

const GAIT_INDEX_BY_NAME = new Map<string, number>(MARCHING_GAITS.map((gait, index) => [gait.name, index]));

interface ResolvedCountGait {
  gaitIndex: number;
  stepsPerCount: number;
  bodyYaw: number;
  legYawOffset: number;
  inPlace: boolean;
  sideways: boolean;
  label: string;
}

// Gait for the move from counts[segmentStart] to counts[segmentStart + 1].
// Auto styles derive it from facing/travel/step size; other gaits are forced.
// Returns null once an auto marcher's route has ended (it halts at attention).
function resolveSegmentGait(
  state: PlayerState,
  segmentStart: number,
  styleIndex: number
): ResolvedCountGait | null {
  const last = state.counts.length - 1;
  const style = MARCHING_GAITS[styleIndex];
  if (!isAutoGaitStyle(style.name)) {
    const from = state.counts[Math.min(last, Math.max(0, segmentStart))];
    const origin = style.inPlace ? state.counts[0] : from;
    return {
      gaitIndex: styleIndex,
      stepsPerCount: 1,
      bodyYaw: origin.rotationY + style.facingOffset,
      legYawOffset: "legFacingOffset" in style ? style.legFacingOffset : 0,
      inPlace: style.inPlace,
      sideways: style.facingOffset === Math.PI / 2,
      label: style.name,
    };
  }
  if (segmentStart < 0 || segmentStart + 1 > last) return null;
  const from = state.counts[segmentStart];
  const to = state.counts[segmentStart + 1];
  const dx = to.position.x - from.position.x;
  const dz = to.position.z - from.position.z;
  const travelYaw = dx * dx + dz * dz > 0.0001 ? Math.atan2(dx, dz) : from.rotationY;
  const bodyYaw = to.facingY ?? from.facingY ?? travelYaw;
  const selection = selectAutoGait(bodyYaw, dx, dz, style.name);
  return {
    gaitIndex: GAIT_INDEX_BY_NAME.get(selection.gait) ?? styleIndex,
    stepsPerCount: selection.stepsPerCount,
    bodyYaw,
    legYawOffset: selection.legYawOffset,
    inPlace: selection.relation === "in-place",
    sideways: selection.relation === "sideways",
    label: selection.label,
  };
}

function getGaitStepPhaseOffsets(state: PlayerState, styleIndex: number): number[] {
  const cached = state.gaitPhaseCache?.get(styleIndex);
  if (cached?.counts === state.counts) return cached.offsets;

  const stepsPerCount = Array.from({ length: Math.max(0, state.counts.length - 1) }, (_, index) =>
    resolveSegmentGait(state, index, styleIndex)?.stepsPerCount ?? 0);
  const offsets = buildGaitStepPhaseOffsets(stepsPerCount);
  (state.gaitPhaseCache ??= new Map()).set(styleIndex, { counts: state.counts, offsets });
  return offsets;
}

// The gait a marcher uses leaving the given count (e.g. for labels/debugging).
export function getRobotGaitAtCount(robot: TransformNode, countIndex: number): string | null {
  const state = players.get(robot);
  const parts = marcherParts.get(robot);
  if (!state || !parts || state.counts.length === 0) return null;
  return resolveSegmentGait(state, countIndex, parts.gaitIndex)?.label ?? "Halt";
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function lerpAngle(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * t;
}

// Applies the shared global count (clamped to this robot's own table length,
// so a shorter route just holds at its last position) to one robot.
const playbackDisplacement = Vector3.Zero();
const playbackLocalDisplacement = Vector3.Zero();

function applyGlobalCount(robot: TransformNode, state: PlayerState) {
  if (heldRobots.has(robot) || state.counts.length === 0) return;
  const last = state.counts.length - 1;
  const drillBeat = getDrillTransportState().beat;
  const index = Math.min(Math.floor(drillBeat), last);
  const count = state.counts[index];
  const parts = marcherParts.get(robot);
  if (!parts) return;
  const playbackDirection = globalPlayback.speedMultiplier >= 0 ? 1 : -1;
  // Work in the forward frame of the count being crossed, so reverse playback
  // simply runs the same step backward.
  const segmentStart = playbackDirection < 0 && drillBeat > 0 && Number.isInteger(drillBeat)
    ? Math.floor(drillBeat) - 1
    : Math.floor(drillBeat);
  const resolved = resolveSegmentGait(state, segmentStart, parts.gaitIndex);
  const previous = resolveSegmentGait(state, segmentStart - 1, parts.gaitIndex);
  const gaitIndex = resolved?.gaitIndex ?? parts.gaitIndex;
  const hipHalfSpacing = resolved?.sideways ? 0.115 : 0.09;
  const forwardProgress = drillBeat - segmentStart;
  // Turn over the count instead of snapping at its boundary: ease body and
  // leg facing from the previous segment's facing into this segment's.
  const targetBodyYaw = resolved?.bodyYaw ?? count.facingY ?? count.rotationY;
  const targetLegYaw = targetBodyYaw + (resolved?.legYawOffset ?? 0);
  const turnBlend = forwardProgress * forwardProgress * (3 - 2 * forwardProgress);
  const bodyRotation = previous
    ? lerpAngle(previous.bodyYaw, targetBodyYaw, turnBlend)
    : targetBodyYaw;
  const legWorldRotation = previous
    ? lerpAngle(previous.bodyYaw + previous.legYawOffset, targetLegYaw, turnBlend)
    : targetLegYaw;
  const legFacingOffset = wrapAngle(legWorldRotation - bodyRotation);
  orientMarcherShoes(parts.leftShoe, parts.rightShoe, legFacingOffset);
  parts.leftLeg.rotation.y = legFacingOffset;
  parts.rightLeg.rotation.y = legFacingOffset;
  const instrumentRest = parts.instrumentRestPose;
  const inPlace = resolved?.inPlace ?? false;
  const from = state.counts[Math.min(last, Math.max(0, segmentStart))];
  const to = state.counts[Math.min(last, Math.max(0, segmentStart + 1))];
  robot.position.copyFrom((inPlace && !isAutoGaitStyle(MARCHING_GAITS[parts.gaitIndex].name)
    ? state.counts[0]
    : count).position);
  robot.rotation.y = bodyRotation;
  to.position.subtractToRef(from.position, playbackDisplacement);
  const displacement = playbackDisplacement;
  const moving = !!resolved && (inPlace || displacement.lengthSquared() > 0.0001);
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
    attachMarcherThigh(parts.leftThigh, parts.leftLeg, -hipHalfSpacing);
    attachMarcherThigh(parts.rightThigh, parts.rightLeg, hipHalfSpacing);
    applyInstrumentPose(parts, instrumentRest);
    parts.body.position.y = 0;
    return;
  }
  if (!inPlace) Vector3.LerpToRef(from.position, to.position, forwardProgress, robot.position);
  const stepsPerCount = resolved!.stepsPerCount;
  // One footfall covers 1/stepsPerCount counts, so its stride scales the same way.
  const localDisplacement = playbackLocalDisplacement;
  if (inPlace) {
    localDisplacement.setAll(0);
  } else {
    const sin = Math.sin(legWorldRotation);
    const cos = Math.cos(legWorldRotation);
    localDisplacement.set(
      (displacement.x * cos - displacement.z * sin) / (stepsPerCount * MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE),
      displacement.y / (stepsPerCount * MARCHER_BODY_SCALE),
      (displacement.x * sin + displacement.z * cos) / (stepsPerCount * MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE),
    );
  }
  const phase = repeatOptions.songLength > 0
    ? gaitPhaseAtBeat(getMusicTransportState().beat, stepsPerCount)
    : gaitPhaseAtBeat(
      getGaitStepPhaseOffsets(state, parts.gaitIndex)[segmentStart] + forwardProgress * stepsPerCount,
      1
    );
  const stepNumber = phase.stepNumber;
  const gaitProgress = phase.progress;
  const gaitPoses = MARCHING_GAIT_POSES[gaitIndex];
  const gait = MARCHING_GAITS[gaitIndex];
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
  const leftStance = ((stepNumber % 2) + 2) % 2 === 0;
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
    const kneeRotationAngle = Math.min(MAX_KNEE_BEND_RADIANS, Math.max(0, kneeAngle));
    knee.rotation.x = kneeRotationAngle;
    ankle.rotation.x = ankleAngle;
    leg.rotation.x = angle;
    leg.position.x = side * hipHalfSpacing + Math.max(-0.015, Math.min(0.015, localDisplacement.x * offset));
    const ankleY = -0.2 * Math.cos(kneeRotationAngle);
    const ankleZ = -0.2 * Math.sin(kneeRotationAngle);
    const shoeYInAnkle = -0.06 * Math.cos(ankleAngle) - 0.07 * Math.sin(ankleAngle);
    const shoeZInAnkle = -0.06 * Math.sin(ankleAngle) + 0.07 * Math.cos(ankleAngle);
    const shoeY = ankleY + shoeYInAnkle * Math.cos(kneeRotationAngle)
      - shoeZInAnkle * Math.sin(kneeRotationAngle);
    const shoeZ = ankleZ + shoeYInAnkle * Math.sin(kneeRotationAngle)
      + shoeZInAnkle * Math.cos(kneeRotationAngle);
    const totalLegAngle = angle + kneeRotationAngle + ankleAngle;
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
  attachMarcherThigh(parts.leftThigh, parts.leftLeg, -hipHalfSpacing);
  attachMarcherThigh(parts.rightThigh, parts.rightLeg, hipHalfSpacing);
  applyInstrumentPose(parts, instrumentRest);
  parts.body.position.y = 0;
}

function applyGlobalCountToAllRobots() {
  players.forEach((state, robot) => applyGlobalCount(robot, state));
  notifyDrillTransport();
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

      if (repeatElapsed !== null && direction > 0 && maxCountIndex > 0) {
        let remainingSeconds = deltaSeconds * Math.abs(globalPlayback.speedMultiplier);
        while (remainingSeconds > 0) {
          const currentFrame = resolveRepeatPlayback(repeatElapsed, maxCountIndex, repeatOptions);
          if (currentFrame.ended) {
            remainingSeconds = 0;
            break;
          }
          const beat = currentFrame.songBeat;
          let nextBoundary = Math.floor(beat) + 1;
          const nextTempoEvent = playbackTempoMap?.find((event) => event.beat > beat + 1e-9);
          if (nextTempoEvent && nextTempoEvent.beat < nextBoundary) nextBoundary = nextTempoEvent.beat;
          if (repeatOptions.song && repeatOptions.songLength > beat &&
            repeatOptions.songLength < nextBoundary) nextBoundary = repeatOptions.songLength;
          const secondsToBoundary = getSecondsBetweenBeats(beat, nextBoundary);
          if (remainingSeconds < secondsToBoundary) {
            const nextBeat = advanceBeatBySeconds(beat, nextBoundary, remainingSeconds);
            repeatElapsed += nextBeat - beat;
            remainingSeconds = 0;
          } else {
            repeatElapsed += nextBoundary - beat;
            remainingSeconds -= secondsToBoundary;
          }
        }
        const frame = resolveRepeatPlayback(repeatElapsed, maxCountIndex, repeatOptions);
        repeatElapsed = frame.elapsed;
        globalPlayback.countIndex = Math.floor(frame.drillBeat);
        globalPlayback.stepAccumulatorSeconds = getSecondsBetweenBeats(
          globalPlayback.countIndex,
          frame.drillBeat
        );
        if (frame.ended) {
          globalPlayback.playing = false;
          globalPlayback.stepAccumulatorSeconds = 0;
        }
      } else {
        const nextCountInterval = () => getSecondsBetweenBeats(
          direction > 0 ? globalPlayback.countIndex : globalPlayback.countIndex - 1,
          direction > 0 ? globalPlayback.countIndex + 1 : globalPlayback.countIndex
        );
        let countDuration = nextCountInterval();
        while (globalPlayback.stepAccumulatorSeconds >= countDuration) {
          const nextIndex = globalPlayback.countIndex + direction;
          if (nextIndex < 0 || nextIndex > maxCountIndex) {
            globalPlayback.playing = false;
            break;
          }
          globalPlayback.stepAccumulatorSeconds -= countDuration;
          globalPlayback.countIndex = nextIndex;
          countDuration = nextCountInterval();
        }
        if (repeatElapsed !== null) {
          const startBeat = direction > 0 ? globalPlayback.countIndex : globalPlayback.countIndex - 1;
          const endBeat = direction > 0 ? globalPlayback.countIndex + 1 : globalPlayback.countIndex;
          const elapsedBeat = advanceBeatBySeconds(
            direction > 0 ? startBeat : endBeat,
            direction > 0 ? endBeat : startBeat,
            globalPlayback.stepAccumulatorSeconds
          );
          repeatElapsed = elapsedBeat;
        }
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
  const fixedFacingY = players.get(robot)?.fixedFacingY;
  players.set(robot, { points, stepSizeYards: resolvedStepSize, counts, fixedFacingY });
  applyFixedFacing(players.get(robot)!);
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
export function registerRobotCounts(
  robot: TransformNode,
  positions: Vector3[],
  scene: Scene,
  facings?: ReadonlyArray<number | undefined>
) {
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
    const facingY = facings?.[i];
    counts.push({ position: positions[i].clone(), rotationY: lastRotationY, ...(facingY === undefined ? {} : { facingY }) });
  }
  players.set(robot, { points: positions, stepSizeYards: DEFAULT_STEP_SIZE_YARDS, counts });
  applyGlobalCount(robot, players.get(robot)!);
  recalculateCollisionMarkers(scene);
}

// Same as walkRobotAlongPath but for a precomputed per-count position
// sequence (see registerRobotCounts).
export function walkRobotAlongCounts(
  robot: TransformNode,
  positions: Vector3[],
  scene: Scene,
  facings?: ReadonlyArray<number | undefined>
) {
  if (positions.length < 1) {
    robot.setEnabled(false);
    return;
  }
  registerRobotCounts(robot, positions, scene, facings);
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
  applyFixedFacing(state);
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
      ? Array.from({ length: holdCounts }, () => ({ ...first, position: first.position.clone() }))
      : [];
  state.counts = [...hold, ...resampled];
  applyFixedFacing(state);
  applyGlobalCount(robot, state);
  if (!skipRecalculate) recalculateCollisionMarkers(scene);
}

export function getRobotStepSize(robot: TransformNode): number {
  return players.get(robot)?.stepSizeYards ?? DEFAULT_STEP_SIZE_YARDS;
}

function applyFixedFacing(state: PlayerState) {
  if (state.fixedFacingY === undefined) return;
  state.counts.forEach((count) => { count.facingY = state.fixedFacingY; });
}

// Holds one body facing for a marcher's whole route (e.g. facing the box while
// it travels sideways or backward); null restores facing the direction of travel.
// Auto gait then turns that facing/travel difference into slides or back-marches.
export function setRobotFacing(robot: TransformNode, facingY: number | null) {
  const state = players.get(robot);
  if (!state) return;
  if (facingY === null) {
    state.fixedFacingY = undefined;
    state.counts.forEach((count) => { delete count.facingY; });
  } else {
    state.fixedFacingY = Math.atan2(Math.sin(facingY), Math.cos(facingY));
    applyFixedFacing(state);
  }
  applyGlobalCount(robot, state);
}

export function getRobotFixedFacing(robot: TransformNode): number | null {
  return players.get(robot)?.fixedFacingY ?? null;
}

// Read-only view of a robot's precalculated marching steps, so callers (e.g.
// per-step grab handles) can position one handle per count.
export function getRobotCounts(robot: TransformNode): ReadonlyArray<RobotCount> | null {
  return players.get(robot)?.counts ?? null;
}

export function clearRobotPath(robot: TransformNode) {
  players.delete(robot);
  heldRobots.delete(robot);
}

export function suspendRobotForErase(robot: TransformNode) {
  const state = players.get(robot);
  const enabled = robot.isEnabled();
  allRobots.delete(robot);
  players.delete(robot);
  heldRobots.delete(robot);
  robot.setEnabled(false);
  if (sharedScene) recalculateCollisionMarkers(sharedScene);
  return () => {
    allRobots.add(robot);
    robot.setEnabled(enabled);
    if (state) {
      players.set(robot, state);
      applyGlobalCount(robot, state);
    }
    if (sharedScene) recalculateCollisionMarkers(sharedScene);
  };
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
  const previous = robot.position.clone();
  const previousYaw = robot.rotation.y;
  const wasHeld = heldRobots.has(robot);
  if (!tryManualMarcherPose(robot, position)) return null;
  robot.position.copyFrom(previous);
  setRobotHeld(robot, false);
  const delta = position.subtract(robot.position);
  if (!tryManualMarcherPose(robot, position, robot.rotation.y, false)) {
    robot.position.copyFrom(previous);
    robot.rotation.y = previousYaw;
    if (wasHeld) heldRobots.add(robot);
    return null;
  }
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

  const from = state.counts[index - 1] ?? count;
  const to = state.counts[index + 1] ?? count;
  const fromPosition = from === count ? position : from.position;
  const toPosition = to === count ? position : to.position;
  const dx = toPosition.x - fromPosition.x;
  const dz = toPosition.z - fromPosition.z;
  const rotationY = dx * dx + dz * dz > 0.0001 ? Math.atan2(dx, dz) : count.rotationY;
  const snapshots = [...allRobots].map((other) => ({
    robot: other, position: other.position.clone(), yaw: other.rotation.y,
  }));
  let accepted: boolean;
  try {
    for (const other of allRobots) {
      if (other === robot) continue;
      const counts = players.get(other)?.counts;
      const otherCount = counts?.[Math.min(index, counts.length - 1)];
      if (otherCount) {
        other.position.copyFrom(otherCount.position);
        other.rotation.y = otherCount.facingY ?? otherCount.rotationY;
      }
    }
    accepted = tryManualMarcherPose(robot, position, count.facingY ?? rotationY, false);
  } finally {
    snapshots.forEach(({ robot: other, position: original, yaw }) => {
      other.position.copyFrom(original);
      other.rotation.y = yaw;
      other.computeWorldMatrix(true);
    });
  }
  if (!accepted) return;
  count.position.copyFrom(position);
  count.rotationY = rotationY;
  state.gaitPhaseCache?.clear();

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
    ...firstCount,
    position: firstCount.position.clone(),
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
  notifyDrillTransport();
}

export function pauseAll() {
  globalPlayback.playing = false;
  notifyDrillTransport();
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
  return getTempoBpmAtBeat(getDrillTransportState().beat);
}

export function setMarchTempo(beatsPerMinute: number): number {
  const beat = getDrillTransportState().beat;
  const boundedBpm = Math.min(MAX_MARCH_TEMPO_BPM, Math.max(MIN_MARCH_TEMPO_BPM, beatsPerMinute));
  playbackTempoMap = null;
  globalPlayback.tempoMultiplier = boundedBpm / (COUNTS_PER_SECOND * 60);
  setDrillBeatPosition(beat);
  notifyDrillTransport();
  return getMarchTempo();
}

export function rewindAll() {
  globalPlayback.speedMultiplier = -2;
  globalPlayback.playing = true;
  notifyDrillTransport();
}

export function fastForwardAll() {
  globalPlayback.speedMultiplier = 2;
  globalPlayback.playing = true;
  notifyDrillTransport();
}

export function stepAll(direction: 1 | -1) {
  transportRevision++;
  globalPlayback.playing = false;
  globalPlayback.stepAccumulatorSeconds = 0;
  globalPlayback.countIndex = Math.min(getMaxCountIndex(), Math.max(0, globalPlayback.countIndex + direction));
  if (repeatElapsed !== null) repeatElapsed = globalPlayback.countIndex;
  applyGlobalCountToAllRobots();
}

// Seeks to a 0..1 fraction along the full drill (e.g. tapping a point on the progress bar).
export function seekAll(fraction: number) {
  transportRevision++;
  globalPlayback.stepAccumulatorSeconds = 0;
  globalPlayback.countIndex = Math.round(Math.min(1, Math.max(0, fraction)) * getMaxCountIndex());
  if (repeatElapsed !== null) repeatElapsed = globalPlayback.countIndex;
  applyGlobalCountToAllRobots();
}

// Seeks to an absolute count index (e.g. clicking a specific footstep handle)
// and pauses there, so the clicked moment stays put instead of playing on.
export function seekToCount(countIndex: number) {
  transportRevision++;
  const beat = Math.min(getMaxCountIndex(), Math.max(0, countIndex));
  setDrillBeatPosition(beat);
  if (repeatElapsed !== null) repeatElapsed = beat;
  globalPlayback.playing = false;
  applyGlobalCountToAllRobots();
}

// Nudges the shared clock by a relative number of counts (e.g. a joystick
// scrub) and pauses there, same as any other manual seek.
export function scrubBy(deltaCounts: number) {
  seekToCount(globalPlayback.countIndex + deltaCounts);
}

export function getGlobalCountIndex(): number {
  return globalPlayback.countIndex;
}

export function getDrillLastCountIndex(): number {
  return getMaxCountIndex();
}

// Each registered marcher's position at a count, holding at its final spot
// once its own route ends (same as playback does).
export function getRobotPositionAtCount(robot: TransformNode, countIndex: number): Vector3 | null {
  if (robot.isDisposed() || !robot.isEnabled()) return null;
  const state = players.get(robot);
  if (!state) return robot.position;
  return state.counts[Math.min(state.counts.length - 1, Math.max(0, countIndex))]?.position ?? null;
}

export function getRobotPositionsAtCount(countIndex: number): Vector3[] {
  const positions: Vector3[] = [];
  players.forEach((state) => {
    const count = state.counts[Math.min(state.counts.length - 1, Math.max(0, countIndex))];
    if (count) positions.push(count.position);
  });
  allRobots.forEach((robot) => {
    if (!players.has(robot) && robot.isEnabled()) positions.push(robot.position);
  });
  return positions;
}

export function getGlobalProgress(): number | null {
  const maxCountIndex = getMaxCountIndex();
  if (maxCountIndex < 1) return null;
  return globalPlayback.countIndex / maxCountIndex;
}
