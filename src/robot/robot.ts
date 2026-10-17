import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { GhostBandPreview } from './ghostBandPreview';
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
import { buildGaitStepPhaseOffsets, DOUBLE_TIME_ABOVE_YARDS, gaitPhaseAtBeat, isAutoGaitStyle, selectAutoGait } from './gaitSelection';
import { resolveRepeatPlayback } from './playbackRepeat';
import { registerManualPlacementMarcher, tryManualMarcherPose, tryManualMarcherPoses } from './manualPlacement';
import { createMarcherDragGhost } from './marcherGhost';
import { CLARINET_MOUTHPIECE_TIP, getClarinetTemplate } from './clarinetModel';
import { FLUTE_MOUTHPIECE_TIP, getFluteTemplate } from './fluteModel';
import { getSousaphoneTemplate, SOUSAPHONE_MOUTHPIECE_TIP, SOUSAPHONE_VALVE_GRIP, sousaphoneLoopPoint } from './sousaphoneModel';
import {
  BASS_DRUM_GRIPS, getBassDrumTemplate, getGlockenspielTemplate, getSnareTemplate, GLOCKENSPIEL_GRIPS, getTenorTemplate, SNARE_GRIPS, TENOR_GRIPS,
  CYMBAL_GRIPS, getCymbalTemplate,
} from './percussionModels';
import { getMellophoneTemplate, MELLOPHONE_MOUTHPIECE_TIP } from './mellophoneModel';
import { getRobotEyesTemplate } from './robotFaceModel';
import {
  getMarcherCalfTemplate, getMarcherForearmTemplate, getMarcherGloveTemplate, getMarcherJacketTemplate,
  getMarcherShoeTemplate, getMarcherThighTemplate, getMarcherKneeTemplate, getMarcherTrimTemplate, getMarcherUpperArmTemplate,
} from './marcherBodyModel';
import { getSaxophoneTemplate, SAXOPHONE_MOUTHPIECE_TIP } from './saxophoneModel';
import { BARI_SAXOPHONE_MOUTHPIECE_TIP, getBariSaxophoneTemplate } from './bariSaxophoneModel';
import { EUPHONIUM_MOUTHPIECE_TIP, getEuphoniumTemplate } from './euphoniumModel';
import { getTromboneTemplate, TROMBONE_MOUTHPIECE_TIP, TROMBONE_SLIDE_STAY_Y } from './tromboneModel';
import { getTrumpetTemplate } from './trumpetModel';
import type { ModelDetail, ModelTemplate } from './lowPolyInstrument';
import { isFieldShrunk, onARScaleChangedObservable } from '../xr/ar';
import { lowPolygonMarchersToggle } from '../ui/dom';
import { registerJacketLegSource, updateJacketLegPlane, updateJacketLegPlanes } from './jacketLegOcclusion';
import { boundMarcherFootTarget, boundMarcherFootLift, MARCHER_CALF_LENGTH, MARCHER_THIGH_LENGTH,
  MARCHER_SHOE_FORWARD_OFFSET, MARCHER_SHOE_HALF_HEIGHT, marcherSwingLift, marcherGroundFootPitch,
  marcherSwingFootPitch, precalculateMarcherLegPose } from './marcherLegPose';
import { marcherFootTarget, marcherSoleInRig } from './marcherFootTargets';
import { marcherSoleFromLegPose } from './marcherLegPose';
import { gaitContactBeats, type MarcherFootContact } from './marcherFootContacts';
import { BakedLegAnimation, SharedLegBakePool, getBakedLegAnimationBytes, getStepCycleCacheStatus,
  type BakedLegPose } from './bakedLegAnimation';
import { midiBeatAtPulse, midiPulseAtBeat, type MidiBeatUnit } from '../audio/midiBeatPulse';
import { sharedMarcherStepPose } from './marcherStepCycles';
import { getGuardFlagTemplate, getGuardRifleTemplate, getGuardSabreTemplate,
  FLAG_GRIPS, RIFLE_GRIPS, SABRE_GRIPS } from './colorGuardModels';

export { COLLISION_MARKER_RADIUS_YARDS } from './collisionMarkers';

const allRobots = new Set<TransformNode>();
// Ghost root -> the hidden marcher it represents on an inserted blank chart page.
const blankPageGhostOwners = new Map<Node, TransformNode>();
const heldRobots = new Set<TransformNode>();
export const onMarcherStrideLimited = new Observable<string>();
const limitedStrideCounts = new WeakMap<TransformNode, number>();

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
  getMarcherTrimTemplate, getMarcherUpperArmTemplate, getMarcherKneeTemplate, getRobotEyesTemplate,
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
    if (template === getMarcherThighTemplate || template === getMarcherCalfTemplate) {
      registerJacketLegSource(source);
    }
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
  if (template === getMarcherThighTemplate || template === getMarcherCalfTemplate) {
    const body = robot.getChildren().find((child) => child.name === 'marcherBody');
    if (body instanceof TransformNode) updateJacketLegPlane(mesh, body);
  }
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
    parts.leftThigh = swap(parts.leftThigh);
    parts.rightThigh = swap(parts.rightThigh);
    parts.leftCalf = swap(parts.leftCalf);
    parts.rightCalf = swap(parts.rightCalf);
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
  const world = robot.computeWorldMatrix(true);
  const forward = Vector3.TransformNormal(Vector3.Forward(), world);
  return {
    position: Vector3.TransformCoordinates(new Vector3(0,
      1.283 * MARCHER_BODY_SCALE, 0.154 * MARCHER_BODY_SCALE * MARCHER_BUILD_SCALE), world),
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
    // A blank chart page's ghost stands in for its hidden marcher until placed.
    const owner = blankPageGhostOwners.get(current);
    if (owner) return owner;
    current = current.parent;
  }
  return null;
}

// Disposes every robot ever spawned (each one's own onDisposeObservable
// handles removing it from allRobots/players/collision markers) — e.g. so a
// generator can start from a clean field instead of piling onto old runs.
export function disposeAllRobots() {
  endBlankChartPage();
  setGhostBandPreviewEnabled(false);
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

export function setRobotColor(robot: TransformNode, color: Color3) {
  if (robot.isDisposed() || !robotColors.has(robot)) throw new Error('Choose an existing marcher to paint.');
  if (![color.r, color.g, color.b].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError('Uniform color components must be between zero and one.');
  }
  robotColors.set(robot, color.clone());
  for (const mesh of robot.getChildMeshes()) {
    if (mesh instanceof InstancedMesh &&
      (modelPartInfo.get(mesh)?.tinted || mesh.name === 'robotTopDownMarker')) {
      mesh.instancedBuffers.color = Color4.FromColor3(color);
    }
  }
  tintedPartMaterials.get(robot)?.diffuseColor.copyFrom(color);
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
  "clarinet" | "flute" | "sousaphone" | "snare" | "tenors" | "bassDrum" | "glockenspiel" | "cymbals" |
  "guardFlag" | "guardRifle" | "guardSabre";

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
  cymbals: wornInstrument("Cymbals", getCymbalTemplate, CYMBAL_GRIPS),
  guardFlag: wornInstrument("Color guard flag", getGuardFlagTemplate, FLAG_GRIPS),
  guardRifle: wornInstrument("Color guard rifle", getGuardRifleTemplate, RIFLE_GRIPS),
  guardSabre: wornInstrument("Color guard sabre", getGuardSabreTemplate, SABRE_GRIPS),
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
  leftCalf: ModelPart;
  rightCalf: ModelPart;
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
  instrumentRoot: TransformNode;
  legRoot: TransformNode;
}>();

function orientMarcherShoes(leftShoe: ModelPart, rightShoe: ModelPart, legFacingOffset: number) {
  const shoeFacing = -legFacingOffset;
  for (const shoe of [leftShoe, rightShoe]) {
    shoe.rotation.y = shoeFacing;
    shoe.position.x = Math.sin(shoeFacing) * MARCHER_SHOE_FORWARD_OFFSET;
    shoe.position.z = Math.cos(shoeFacing) * MARCHER_SHOE_FORWARD_OFFSET;
  }
}

const thighDirection = Vector3.Zero();
const thighUp = Vector3.Up();

function attachMarcherThigh(thigh: ModelPart, leg: TransformNode, hipX: number, kneeDistance = MARCHER_THIGH_LENGTH) {
  const dx = hipX - leg.position.x;
  const dy = 0.69 - leg.position.y;
  const dz = -leg.position.z;
  const inverseRotation = Quaternion.FromEulerAngles(
    leg.rotation.x, leg.rotation.y, leg.rotation.z).conjugate();
  thighDirection.set(dx, dy, dz).rotateByQuaternionToRef(inverseRotation, thighDirection);
  thighDirection.y += kneeDistance;
  const length = thighDirection.length();
  thigh.position.copyFrom(thighDirection).scaleInPlace(0.155 / MARCHER_THIGH_LENGTH);
  thigh.position.y -= kneeDistance;
  thigh.scaling.y = length / MARCHER_THIGH_LENGTH;
  thighDirection.scaleInPlace(1 / length);
  Quaternion.FromUnitVectorsToRef(thighUp, thighDirection, thigh.rotationQuaternion!);
}

const kneeFlexion = Quaternion.Identity();

function alignMarcherKnee(thigh: ModelPart, knee: TransformNode) {
  // The visible thigh is re-aimed at the fixed hip, independently of the leg root.
  // Measure flexion from that thigh, not from the root's increasingly steep pitch.
  Quaternion.FromEulerAnglesToRef(
    Math.max(0, Math.min(MAX_KNEE_BEND_RADIANS, knee.rotation.x)), 0, 0, kneeFlexion);
  knee.rotationQuaternion ??= Quaternion.Identity();
  thigh.rotationQuaternion!.multiplyToRef(kneeFlexion, knee.rotationQuaternion);
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
  players.forEach(invalidateLegBake);
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
  const legRoot = new TransformNode("marcherLegRoot", scene);
  legRoot.parent = robot;
  legRoot.scaling.setAll(MARCHER_BODY_SCALE);
  const part = (template: ModelTemplate, name: string, parent: Node | null, tinted = false) =>
    createModelPart(template, scene, name, parent, robot, tinted);

  part(getMarcherJacketTemplate, "marcherJacket", body, true);
  part(getMarcherTrimTemplate, "marcherTrim", body);
  part(getRobotEyesTemplate, "robotEyes", body);

  const appendages = ([-1, 1] as const).map((side) => {
    const leg = new TransformNode("marcherLeg", scene);
    leg.position.set(side * 0.09 * MARCHER_BUILD_SCALE, 0.69, 0);
    leg.parent = legRoot;
    const thigh = part(getMarcherThighTemplate, "marcherThigh", leg);
    thigh.position.y = -0.16;
    thigh.rotationQuaternion = Quaternion.Identity();

    const knee = new TransformNode("marcherKnee", scene);
    knee.position.y = -MARCHER_THIGH_LENGTH;
    knee.parent = leg;
    const calf = part(getMarcherCalfTemplate, "marcherCalf", knee);
    const kneeJoint = part(getMarcherKneeTemplate, "marcherKneeJoint", knee);
    for (const mesh of [thigh, calf, kneeJoint]) {
      mesh.scaling.x = MARCHER_BUILD_SCALE;
      mesh.scaling.z = MARCHER_BUILD_SCALE;
    }

    const ankle = new TransformNode("marcherAnkle", scene);
    ankle.position.y = -MARCHER_CALF_LENGTH;
    ankle.parent = knee;
    const shoe = part(getMarcherShoeTemplate, "marcherShoe", ankle);
    shoe.scaling.x = MARCHER_BUILD_SCALE;
    shoe.position.set(0, -MARCHER_SHOE_HALF_HEIGHT, MARCHER_SHOE_FORWARD_OFFSET);

    const arm = new TransformNode("marcherArm", scene);
    arm.position.set(side * 0.21, 1.0, 0.025);
    arm.rotationQuaternion = Quaternion.Identity();
    arm.parent = body;
    part(getMarcherUpperArmTemplate, "marcherUpperArm", arm, true);
    const forearm = new TransformNode("marcherForearm", scene);
    forearm.rotationQuaternion = Quaternion.Identity();
    forearm.parent = body;
    part(getMarcherForearmTemplate, "marcherForearm", forearm, true);
    const glove = part(getMarcherGloveTemplate, "marcherHand", null);
    return { leg, knee, ankle, shoe, thigh, calf, arm, forearm, glove };
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
  orientMarcherShoes(appendages[0].shoe, appendages[1].shoe, 0);

  marcherParts.set(robot, {
    gaitIndex: resolvedGaitIndex,
    instrumentRestPose: instrumentCarryPose,
    instrument,
    gloves: [appendages[0].glove, appendages[1].glove],
    leftLeg: appendages[0].leg, rightLeg: appendages[1].leg,
    leftKnee: appendages[0].knee, rightKnee: appendages[1].knee,
    leftThigh: appendages[0].thigh, rightThigh: appendages[1].thigh,
    leftCalf: appendages[0].calf, rightCalf: appendages[1].calf,
    leftAnkle: appendages[0].ankle, rightAnkle: appendages[1].ankle,
    leftShoe: appendages[0].shoe, rightShoe: appendages[1].shoe,
    leftArm: appendages[0].arm, rightArm: appendages[1].arm,
    leftForearm: appendages[0].forearm, rightForearm: appendages[1].forearm, horn, body, instrumentRoot, legRoot,
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
    const state = players.get(robot);
    if (state) invalidateLegBake(state);
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

export function duplicateMarcherSchedule(source: TransformNode, offset: Vector3): TransformNode {
  const state = players.get(source);
  const parts = marcherParts.get(source);
  if (!state || !parts || state.counts.length === 0) {
    throw new Error('Cannot duplicate a marcher without a registered drill schedule');
  }
  const robot = createLowPolyRobot(source.getScene(), parts.gaitIndex);
  robot.parent = source.parent;
  setMarcherInstrument(robot, parts.instrument);
  setMarcherInstrumentRestPose(robot, parts.instrumentRestPose);
  const counts = state.counts.map(count => ({ ...count, position: count.position.add(offset) }));
  players.set(robot, {
    points: state.points.map(point => point.add(offset)),
    counts, stepSizeYards: state.stepSizeYards, fixedFacingY: state.fixedFacingY,
  });
  robot.setEnabled(true);
  applyGlobalCount(robot, players.get(robot)!);
  return robot;
}

// --- Playback control: play/pause, rewind, fast-forward, step, and seeking
// along a robot's recorded path. All positions/facings are precalculated once
// per path (resamplePathIntoCounts) into a fixed table of drill "counts";
// playback interpolates only between neighboring count positions, so each
// footfall still lands exactly on a precalculated drill count.

export interface RobotCount {
  position: Vector3;
  // Travel heading at this count.
  rotationY: number;
  // Explicit body facing (e.g. facing the box while sliding); absent means
  // the marcher faces where it travels.
  facingY?: number;
  // Marching style (MARCHING_GAITS index) for the move from this count to the
  // next, chosen from the transition library; absent uses the marcher's style.
  styleIndex?: number;
}

// Each robot keeps only its own route/table; the playback transport itself
// (below) is shared by every robot so the whole band marches on one clock.
interface PlayerState {
  points: Vector3[];
  stepSizeYards: number;
  counts: RobotCount[];
  gaitPhaseCache?: Map<number, { counts: RobotCount[]; offsets: number[] }>;
  legBake?: {
    counts: RobotCount[];
    beatUnits: ReadonlyArray<MidiBeatUnit>;
    key: string;
    table: BakedLegAnimation;
    release?: () => void;
  };
  stepCache?: {
    counts: RobotCount[];
    beatUnits: ReadonlyArray<MidiBeatUnit>;
    key: string;
    landings: Map<string, Vector3>;
    facings: Map<number, number>;
    directions: Map<string, number | undefined>;
    rolls: Map<string, { pitch: number; velocity: number }>;
    cycleStride?: number | null;
  };
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
let playbackBeatUnits: ReadonlyArray<MidiBeatUnit> = [];

export function setPlaybackBeatUnits(units: ReadonlyArray<MidiBeatUnit>) {
  playbackBeatUnits = units.map(unit => ({ ...unit }));
  players.forEach(invalidateLegBake);
  notifyDrillTransport(true);
}

export function setPlaybackRepeat(drill: boolean, song: boolean) {
  repeatElapsed ??= getDrillTransportState().beat;
  repeatOptions = { ...repeatOptions, drill, song };
  players.forEach(invalidateLegBake);
  if (!drill && !song) repeatElapsed = null;
  notifyDrillTransport(true);
}

export function setPlaybackSongLength(songLength: number) {
  repeatOptions.songLength = songLength;
  players.forEach(invalidateLegBake);
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
let ghostBandPreview: GhostBandPreview | null = null;
let ghostBandAnchorBeat = 0;

export function isGhostBandPreviewEnabled(): boolean {
  return ghostBandPreview !== null;
}

export function getGhostBandAnchorBeat(): number {
  return ghostBandAnchorBeat;
}

export function isGhostBandMesh(mesh: AbstractMesh): boolean {
  return ghostBandPreview?.owns(mesh) ?? false;
}

export function jumpToGhostBandTime(mesh: AbstractMesh): boolean {
  if (!isGhostBandMesh(mesh)) return false;
  ghostBandAnchorBeat = getDrillTransportState().beat;
  setGhostBandPreviewEnabled(false);
  return true;
}

export function setGhostBandPreviewEnabled(enabled: boolean) {
  if (enabled === isGhostBandPreviewEnabled()) return;
  pauseAll();
  if (enabled) {
    ghostBandAnchorBeat = getDrillTransportState().beat;
    ghostBandPreview = new GhostBandPreview(allRobots);
  } else {
    ghostBandPreview?.dispose();
    ghostBandPreview = null;
    setDrillBeatPosition(ghostBandAnchorBeat);
    if (repeatElapsed !== null) repeatElapsed = ghostBandAnchorBeat;
  }
  applyGlobalCountToAllRobots();
  notifyDrillTransport(true);
}

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
  const transitionStyle = segmentStart >= 0 && segmentStart < last
    ? state.counts[segmentStart].styleIndex : undefined;
  const overridden = transitionStyle !== undefined && MARCHING_GAITS[transitionStyle] !== undefined;
  if (overridden) styleIndex = transitionStyle;
  const style = MARCHING_GAITS[styleIndex];
  if (!isAutoGaitStyle(style.name)) {
    const from = state.counts[Math.min(last, Math.max(0, segmentStart))];
    const origin = style.inPlace && !overridden ? state.counts[0] : from;
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
  const musicBeat = segmentStart + getMusicTransportState().beat - getDrillTransportState().beat;
  const pulse = midiPulseAtBeat(musicBeat, playbackBeatUnits);
  const quarterNotesPerPulse = repeatOptions.songLength > 0
    ? midiBeatAtPulse(pulse + 1, playbackBeatUnits) - musicBeat : 1;
  let cadenceTravelYards = Math.hypot(dx, dz);
  // A half-time footfall spans three quarter-note counts in 6/8. Include
  // neighboring travel so a cadence change cannot overreach across a set.
  for (let nearby = Math.max(0, segmentStart - 3); nearby < Math.min(last, segmentStart + 4); nearby++) {
    const a = state.counts[nearby].position;
    const b = state.counts[nearby + 1].position;
    cadenceTravelYards = Math.max(cadenceTravelYards, Math.hypot(b.x - a.x, b.z - a.z));
    if (nearby + 2 <= last) {
      const c = state.counts[nearby + 2].position;
      const beforeLength = Math.hypot(b.x - a.x, b.z - a.z);
      const afterLength = Math.hypot(c.x - b.x, c.z - b.z);
      if (beforeLength > 0.0001 && afterLength > 0.0001 &&
        ((b.x - a.x) * (c.x - b.x) + (b.z - a.z) * (c.z - b.z)) /
          (beforeLength * afterLength) < Math.cos(Math.PI / 3)) {
        cadenceTravelYards = Math.max(cadenceTravelYards,
          (DOUBLE_TIME_ABOVE_YARDS + 0.0001) / quarterNotesPerPulse);
      }
    }
  }
  const selection = selectAutoGait(bodyYaw, dx, dz, style.name, quarterNotesPerPulse, cadenceTravelYards);
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

const pendingLegBakes = new Set<BakedLegAnimation>();
const sharedLegBakes = new SharedLegBakePool();
let legBakeTimer: ReturnType<typeof setTimeout> | undefined;
let legAnimationBakingEnabled = false;
let sharedStepCyclesEnabled = true;
let bakedPoseHits = 0;
let bakedPoseMisses = 0;
const bakedFallbacks = { pending: 0, accuracy: 0, memory: 0, reverseBoundary: 0 };
let prebakingLegAnimation = false;

export function startLegAnimationPrebake() {
  if (!legAnimationBakingEnabled) {
    console.warn('Leg animation baking is disabled; marching uses cached live IK.');
    return;
  }
  pauseAll();
  prebakingLegAnimation = true;
  applyGlobalCountToAllRobots();
  if (pendingLegBakes.size === 0) prebakingLegAnimation = false;
}

export function cancelLegAnimationPrebake() {
  if (!prebakingLegAnimation) return;
  playAll();
}

function scheduleLegBake(table: BakedLegAnimation) {
  pendingLegBakes.add(table);
  if (legBakeTimer !== undefined) return;
  legBakeTimer = setTimeout(() => {
    legBakeTimer = undefined;
    const deadline = performance.now() + (prebakingLegAnimation ? 12 : 4);
    do {
      const next = pendingLegBakes.values().next().value;
      if (!next) break;
      pendingLegBakes.delete(next);
      next.advance();
      if (!next.complete) pendingLegBakes.add(next);
    } while (performance.now() < deadline);
    const next = pendingLegBakes.values().next().value;
    if (next) scheduleLegBake(next);
    else prebakingLegAnimation = false;
  }, prebakingLegAnimation ? 0 : 16);
}

function invalidateLegBake(state: PlayerState) {
  if (!state.legBake) return;
  if (state.legBake.release) state.legBake.release();
  else {
    pendingLegBakes.delete(state.legBake.table);
    state.legBake.table.dispose();
  }
  state.legBake = undefined;
}

export function getLegAnimationBakeStatus() {
  let bytes = 0, completedCounts = 0, totalCounts = 0, pending = 0, fallbackIntervals = 0, memoryLimited = 0;
  const unique = new Set<BakedLegAnimation>();
  let owners = 0;
  players.forEach(state => {
    const table = state.legBake?.table;
    if (!table) return;
    unique.add(table);
    owners++;
    bytes += table.byteLength;
    completedCounts += table.completedCounts;
    totalCounts += table.lastCount;
    pending += table.complete ? 0 : 1;
    fallbackIntervals += table.fallbackIntervals;
    memoryLimited += table.memoryLimited ? 1 : 0;
  });
  return { bytes, sharedBytes: getBakedLegAnimationBytes(), completedCounts, totalCounts, pending,
    fallbackIntervals, memoryLimited, uniqueBakes: unique.size, reusedBakes: owners - unique.size,
    reusedCycles: Array.from(unique).reduce((sum, table) => sum + table.reusedCycles, 0),
    ...getStepCycleCacheStatus(), bakedPoseHits, bakedPoseMisses,
    bakedFallbacks: { ...bakedFallbacks }, prebaking: prebakingLegAnimation };
}

function applyGlobalCount(robot: TransformNode, state: PlayerState,
  sample?: { drillBeat: number; musicBeat: number;
    contact?: (pose: BakedLegPose, position: Vector3, yaw: number, left: boolean, progress: number) => void;
    parts?: NonNullable<ReturnType<typeof marcherParts.get>> }): BakedLegPose | undefined {
  if (!sample && ghostBandPreview) {
    ghostBandPreview.update(robot, state.counts, getDrillTransportState().beat);
    return;
  }
  if ((!sample && heldRobots.has(robot)) || state.counts.length === 0) return;
  const last = state.counts.length - 1;
  const drillBeat = sample?.drillBeat ?? getDrillTransportState().beat;
  const musicBeat = sample?.musicBeat ?? getMusicTransportState().beat;
  const index = Math.min(Math.floor(drillBeat), last);
  const count = state.counts[index];
  const parts = sample?.parts ?? marcherParts.get(robot);
  if (!parts) return;
  const clockOffset = Math.round((drillBeat - musicBeat) * 1e8) / 1e8;
  const bakeKey = [parts.gaitIndex, clockOffset, repeatOptions.songLength, repeatOptions.drill].join(":");
  if (!sample && state.legBake &&
    (state.legBake.counts !== state.counts || state.legBake.beatUnits !== playbackBeatUnits ||
      state.legBake.key !== bakeKey)) invalidateLegBake(state);
  if (!sample && legAnimationBakingEnabled && last > 0 && !state.legBake) {
    const origin = state.counts[0].position;
    const counts = state.counts.map(count => ({
      ...count, position: count.position.subtract(new Vector3(origin.x, 0, origin.z)),
    }));
    // Exact relative-route equality only: never merge merely similar strides or turns.
    const signature = JSON.stringify([bakeKey, playbackBeatUnits,
      counts.map(count => [count.position.x, count.position.y, count.position.z, count.rotationY, count.facingY,
        count.styleIndex])]);
    const lease = sharedLegBakes.acquire(signature, () => {
      const sampleState: PlayerState = { ...state, counts, gaitPhaseCache: undefined,
        stepCache: undefined, legBake: undefined };
      const sampleParts = { ...parts };
      const cycleKey = (count: number) => {
        // A constant meter and a full neighboring context keep phase, contact and cadence identical.
        if (repeatOptions.songLength <= 0 || repeatOptions.drill || playbackBeatUnits.length > 1 ||
          count < 16 || count + 17 > last) return undefined;
        const unit = playbackBeatUnits[0]?.quarterNotesPerPulse ?? 1;
        if (unit <= 0 || unit > 2 || (playbackBeatUnits[0]?.beat ?? 0) !== 0) return undefined;
        const origin = counts[count].position;
        const phase = midiPulseAtBeat(count - clockOffset, playbackBeatUnits);
        const phaseKey = ((phase % 4) + 4) % 4;
        return JSON.stringify([sampleParts.gaitIndex, unit, phaseKey,
          counts.slice(count - 16, count + 18).map(item => [
            item.position.x - origin.x, item.position.y, item.position.z - origin.z,
            item.rotationY, item.facingY,
          ])]);
      };
      const table = new BakedLegAnimation(last, beat =>
        applyGlobalCount(robot, sampleState, { drillBeat: beat, musicBeat: beat - clockOffset,
          parts: sampleParts }), drillBeat, cycleKey);
      scheduleLegBake(table);
      return table;
    }, table => pendingLegBakes.delete(table));
    state.legBake = { counts: state.counts, beatUnits: playbackBeatUnits, key: bakeKey, ...lease };
  }
  const playbackDirection = sample !== undefined || globalPlayback.speedMultiplier >= 0 ? 1 : -1;
  // Work in the forward frame of the count being crossed, so reverse playback
  // simply runs the same step backward.
  const segmentStart = playbackDirection < 0 && drillBeat > 0 && Number.isInteger(drillBeat)
    ? Math.floor(drillBeat) - 1
    : Math.floor(drillBeat);
  const resolved = resolveSegmentGait(state, segmentStart, parts.gaitIndex);
  const previous = resolveSegmentGait(state, segmentStart - 1, parts.gaitIndex);
  const gaitIndex = resolved?.gaitIndex ?? parts.gaitIndex;
  const hipHalfSpacing = (resolved?.sideways ? 0.115 : 0.09) * MARCHER_BUILD_SCALE;
  const forwardProgress = drillBeat - segmentStart;
  // Turn over the count instead of snapping at its boundary: ease body and
  // leg facing from the previous segment's facing into this segment's.
  const targetBodyYaw = resolved?.bodyYaw ?? count.facingY ?? count.rotationY;
  const turnBlend = forwardProgress * forwardProgress * (3 - 2 * forwardProgress);
  const bodyRotation = previous
    ? lerpAngle(previous.bodyYaw, targetBodyYaw, turnBlend)
    : targetBodyYaw;
  if (!sample) {
    orientMarcherShoes(parts.leftShoe, parts.rightShoe, 0);
    parts.leftLeg.rotation.y = 0;
    parts.rightLeg.rotation.y = 0;
  }
  const instrumentRest = parts.instrumentRestPose;
  const from = state.counts[Math.min(last, Math.max(0, segmentStart))];
  const to = state.counts[Math.min(last, Math.max(0, segmentStart + 1))];
  // Auto mark-time is a leg style for short moves, not permission to freeze
  // authored travel and jump to the next count.
  const inPlace = (resolved?.inPlace ?? false) &&
    (!isAutoGaitStyle(MARCHING_GAITS[parts.gaitIndex].name) ||
      Vector3.DistanceSquared(from.position, to.position) < 1e-12);
  const rootPosition = (inPlace && !isAutoGaitStyle(MARCHING_GAITS[parts.gaitIndex].name)
    ? state.counts[0]
    : count).position.clone();
  if (!inPlace) Vector3.LerpToRef(from.position, to.position, forwardProgress, rootPosition);
  if (!sample) {
    robot.position.copyFrom(rootPosition);
    robot.rotation.y = bodyRotation;
  }
  to.position.subtractToRef(from.position, playbackDisplacement);
  const displacement = playbackDisplacement;
  const moving = !!resolved && (inPlace || displacement.lengthSquared() > 1e-12);
  if (!moving) {
    if (sample) return;
    parts.leftLeg.rotation.x = 0;
    parts.rightLeg.rotation.x = 0;
    parts.leftLeg.rotation.z = 0;
    parts.rightLeg.rotation.z = 0;
    parts.leftKnee.rotation.x = 0;
    parts.rightKnee.rotation.x = 0;
    parts.leftKnee.position.y = -MARCHER_THIGH_LENGTH;
    parts.rightKnee.position.y = -MARCHER_THIGH_LENGTH;
    parts.leftAnkle.rotation.x = 0;
    parts.rightAnkle.rotation.x = 0;
    parts.leftAnkle.rotationQuaternion = null;
    parts.rightAnkle.rotationQuaternion = null;
    parts.leftLeg.position.y = 0.69;
    parts.rightLeg.position.y = 0.69;
    parts.leftLeg.position.x = -hipHalfSpacing;
    parts.rightLeg.position.x = hipHalfSpacing;
    parts.leftLeg.position.z = 0;
    parts.rightLeg.position.z = 0;
    attachMarcherThigh(parts.leftThigh, parts.leftLeg, -hipHalfSpacing);
    attachMarcherThigh(parts.rightThigh, parts.rightLeg, hipHalfSpacing);
    alignMarcherKnee(parts.leftThigh, parts.leftKnee);
    alignMarcherKnee(parts.rightThigh, parts.rightKnee);
    applyInstrumentPose(parts, instrumentRest);
    parts.body.position.y = 0;
    parts.instrumentRoot.position.y = 0;
    parts.legRoot.position.y = 0;
    limitedStrideCounts.delete(robot);
    return;
  }
  let bakedPose: BakedLegPose | undefined;
  if (!sample && legAnimationBakingEnabled && state.legBake) {
    // Exact reverse integer boundaries use the preceding segment's gait.
    if (!(playbackDirection < 0 && Number.isInteger(drillBeat))) bakedPose = state.legBake.table.poseAt(drillBeat);
    if (bakedPose) {
      if (globalPlayback.playing) bakedPoseHits++;
    } else if (globalPlayback.playing) {
      bakedPoseMisses++;
      const reason = playbackDirection < 0 && Number.isInteger(drillBeat)
        ? 'reverseBoundary' : state.legBake.table.fallbackReasonAt(drillBeat);
      bakedFallbacks[reason]++;
    }
  }
  const applyLegPose = (pose: BakedLegPose) => {
    parts.body.position.y = 0;
    parts.instrumentRoot.position.y = 0;
    parts.legRoot.position.y = 0;
    for (const [index, leg, knee, ankle, shoe] of [
      [0, parts.leftLeg, parts.leftKnee, parts.leftAnkle, parts.leftShoe],
      [1, parts.rightLeg, parts.rightKnee, parts.rightAnkle, parts.rightShoe],
    ] as const) {
      const solved = pose.legs[index];
      knee.position.y = -solved.thighLength;
      knee.rotation.x = solved.kneeAngle;
      knee.rotationQuaternion = solved.kneeRotation;
      ankle.rotationQuaternion = solved.ankleRotation;
      solved.legRotation.toEulerAnglesToRef(leg.rotation);
      leg.position.set((index === 0 ? -1 : 1) * pose.hipHalfSpacing, 0.69, 0);
      shoe.rotation.y = 0;
      shoe.position.set(0, -MARCHER_SHOE_HALF_HEIGHT, MARCHER_SHOE_FORWARD_OFFSET);
    }
    attachMarcherThigh(parts.leftThigh, parts.leftLeg, -pose.hipHalfSpacing, MARCHER_THIGH_LENGTH);
    attachMarcherThigh(parts.rightThigh, parts.rightLeg, pose.hipHalfSpacing, MARCHER_THIGH_LENGTH);
    applyInstrumentPose(parts, instrumentRest);
  };
  const reportLimited = (limited: boolean) => {
    if (limited && limitedStrideCounts.get(robot) !== segmentStart) {
      limitedStrideCounts.set(robot, segmentStart);
      onMarcherStrideLimited.notifyObservers(
        `Unmarchable move at count ${segmentStart + 1}: steps are bounded; the authored route is unchanged and may slide.`);
    }
  };
  if (bakedPose) {
    reportLimited(bakedPose.limited);
    applyLegPose(bakedPose);
    return;
  }
  const stepsPerCount = resolved!.stepsPerCount;
  const phase = repeatOptions.songLength > 0
    ? gaitPhaseAtBeat(midiPulseAtBeat(musicBeat, playbackBeatUnits), stepsPerCount)
    : gaitPhaseAtBeat(
      getGaitStepPhaseOffsets(state, parts.gaitIndex)[segmentStart] + forwardProgress * stepsPerCount,
      1
    );
  const stepNumber = phase.stepNumber;
  const gaitProgress = phase.progress;
  const gait = MARCHING_GAITS[gaitIndex];
  const lift = marcherSwingLift(gaitProgress, gait.lift);
  const leftStance = ((stepNumber % 2) + 2) % 2 === 0;
  // Keep only the current step. Quantization removes clock-subtraction noise,
  // not authored timing; seeks and edits invalidate the cache independently.
  const cacheKey = [transportRevision, stepNumber, stepsPerCount, parts.gaitIndex, hipHalfSpacing,
    clockOffset, repeatOptions.songLength, repeatOptions.drill, targetBodyYaw, previous?.bodyYaw,
    inPlace, inPlace ? rootPosition.asArray().join(",") : ""].join(":");
  if (state.stepCache?.counts !== state.counts || state.stepCache.beatUnits !== playbackBeatUnits ||
    state.stepCache.key !== cacheKey) {
    state.stepCache = {
      counts: state.counts, beatUnits: playbackBeatUnits, key: cacheKey,
      landings: new Map(), facings: new Map(), directions: new Map(), rolls: new Map(),
    };
  }
  const stepCache = state.stepCache;
  const beatForStep = (step: number) => {
    if (repeatOptions.songLength > 0) {
      return drillBeat + midiBeatAtPulse(step / stepsPerCount, playbackBeatUnits) - musicBeat;
    }
    const offsets = getGaitStepPhaseOffsets(state, parts.gaitIndex);
    let index = 0;
    while (index + 1 < offsets.length && offsets[index + 1] <= step) index++;
    if (index + 1 >= offsets.length) return last;
    return index + (step - offsets[index]) / (offsets[index + 1] - offsets[index]);
  };
  if (!sample && sharedStepCyclesEnabled) {
    if (stepCache.cycleStride === undefined) {
      stepCache.cycleStride = null;
      const startBeat = beatForStep(stepNumber - 2);
      const endBeat = beatForStep(stepNumber + 3);
      const stepDuration = (endBeat - startBeat) / 5;
      const start = Math.floor(startBeat);
      const end = Math.ceil(endBeat);
      if (!repeatOptions.drill && start >= 1 && end < last && stepDuration > 0 &&
        Math.abs(beatForStep(stepNumber) - startBeat - 2 * stepDuration) < 1e-8 &&
        Math.abs(beatForStep(stepNumber + 1) - startBeat - 3 * stepDuration) < 1e-8 &&
        Math.abs(wrapAngle(bodyRotation - targetBodyYaw)) < 1e-8) {
        const delta = state.counts[start + 1].position.subtract(state.counts[start].position);
        let uniform = Math.abs(delta.y) < 1e-10;
        for (let index = start; uniform && index <= end; index++) {
          const selection = resolveSegmentGait(state, index, parts.gaitIndex);
          const expected = state.counts[start].position.add(delta.scale(index - start));
          uniform = !!selection && selection.gaitIndex === gaitIndex &&
            selection.stepsPerCount === stepsPerCount &&
            Math.abs(wrapAngle(selection.bodyYaw - targetBodyYaw)) < 1e-8 &&
            Vector3.DistanceSquared(state.counts[index].position, expected) < 1e-16;
        }
        const lateral = delta.x * Math.cos(bodyRotation) - delta.z * Math.sin(bodyRotation);
        if (uniform && (inPlace || Math.abs(lateral) < 1e-9)) {
          stepCache.cycleStride = inPlace ? 0 :
            (delta.x * Math.sin(bodyRotation) + delta.z * Math.cos(bodyRotation)) *
            stepDuration / MARCHER_BODY_SCALE;
        }
      }
    }
    if (stepCache.cycleStride !== null) {
      const left = sharedMarcherStepPose(stepCache.cycleStride, gaitProgress, !leftStance, gait.lift);
      const right = sharedMarcherStepPose(stepCache.cycleStride, gaitProgress, leftStance, gait.lift);
      if (left && right) {
        const cyclePose: BakedLegPose = { legs: [left, right], hipHalfSpacing, limited: false };
        applyLegPose(cyclePose);
        return;
      }
    }
  }
  const landingBeat = (step: number) => {
    const beat = beatForStep(step + 0.5);
    return repeatOptions.drill && last > 0
      ? ((beat % last) + last) % last
      : Math.max(0, Math.min(last, beat));
  };
  const landingFacing = (step: number) => {
    const cached = stepCache.facings.get(step);
    if (cached !== undefined) return cached;
    const beat = landingBeat(step);
    const index = Math.min(last - 1, Math.floor(beat));
    const selection = resolveSegmentGait(state, index, parts.gaitIndex);
    if (!selection) return bodyRotation;
    const before = resolveSegmentGait(state, index - 1, parts.gaitIndex);
    const yaw = selection.bodyYaw;
    const progress = beat - Math.floor(beat);
    const facing = before ? lerpAngle(before.bodyYaw, yaw,
      progress * progress * (3 - 2 * progress)) : yaw;
    stepCache.facings.set(step, facing);
    return facing;
  };
  const landing = (step: number, left: boolean) => {
    const key = `${step}:${left}`;
    const cached = stepCache.landings.get(key);
    if (cached) return cached;
    const beat = landingBeat(step);
    const index = Math.floor(beat);
    const position = inPlace ? rootPosition.clone() :
      Vector3.Lerp(state.counts[index].position,
        state.counts[Math.min(last, index + 1)].position, beat - index);
    const yaw = landingFacing(step);
    const side = left ? -1 : 1;
    const lateral = side * hipHalfSpacing * MARCHER_BODY_SCALE;
    position.x += Math.cos(yaw) * lateral;
    position.z -= Math.sin(yaw) * lateral;
    const footYaw = yaw;
    position.x += Math.sin(footYaw) * MARCHER_SHOE_FORWARD_OFFSET * MARCHER_BODY_SCALE;
    position.z += Math.cos(footYaw) * MARCHER_SHOE_FORWARD_OFFSET * MARCHER_BODY_SCALE;
    stepCache.landings.set(key, position);
    return position;
  };
  const footTarget = (side: number, lift: number) => {
    const target = marcherFootTarget(stepNumber, gaitProgress, side < 0, landing).subtract(rootPosition);
    const sole = marcherSoleInRig(target, bodyRotation, MARCHER_BODY_SCALE);
    sole.y += lift;
    const yaw = 0;
    const hip = new Vector3(side * hipHalfSpacing, 0.69, 0);
    const swinging = side < 0 ? !leftStance : leftStance;
    let pitch = 0;
    // Unmarchable (stride-limited) moves can put a probed contact beyond reach; treat that as flat.
    const groundPitch = (...args: Parameters<typeof marcherGroundFootPitch>) => {
      try {
        return marcherGroundFootPitch(...args);
      } catch (error) {
        if (error instanceof RangeError) return 0;
        throw error;
      }
    };
    const contactTarget = (step: number, plantedStep: number) => {
      // Landing targets sample midstance; the contact boundary is half a step earlier.
      const beat = landingBeat(step - 0.5);
      const index = Math.floor(beat);
      const position = inPlace ? rootPosition : Vector3.Lerp(state.counts[index].position,
        state.counts[Math.min(last, index + 1)].position, beat - index);
      const target = marcherSoleInRig(landing(plantedStep, side < 0).subtract(position),
        landingFacing(step - 0.5), MARCHER_BODY_SCALE);
      const bounded = boundMarcherFootTarget(hip, target, yaw);
      return bounded.sole;
    };
    const contactDirection = (plantedStep: number) => {
      const key = `${side}:${plantedStep}`;
      if (stepCache.directions.has(key)) return stepCache.directions.get(key);
      // Retain an endpoint's necessary fallback instead of switching roll branches midstance.
      for (const step of [plantedStep, plantedStep + 1]) {
        const sole = contactTarget(step, plantedStep);
        if (sole.z > MARCHER_SHOE_FORWARD_OFFSET &&
          groundPitch(hip, sole, yaw) > 0) {
          stepCache.directions.set(key, 1);
          return 1;
        }
      }
      stepCache.directions.set(key, undefined);
      return undefined;
    };
    const plantedStep = swinging
      ? (gaitProgress < 0.5 ? stepNumber - 1 : stepNumber + 1)
      : stepNumber;
    const rollDirection = contactDirection(plantedStep);
    if (swinging) {
      const boundary = gaitProgress < 0.5 ? stepNumber : stepNumber + 1;
      const key = `${side}:${plantedStep}:${boundary}`;
      let roll = stepCache.rolls.get(key);
      if (!roll) {
        const contactPitch = groundPitch(hip, contactTarget(boundary, plantedStep), yaw, rollDirection);
        const epsilon = 0.001;
        const nearby = gaitProgress < 0.5 ? boundary - epsilon : boundary + epsilon;
        const nearbyPitch = groundPitch(hip, contactTarget(nearby, plantedStep), yaw, rollDirection);
        const velocity = gaitProgress < 0.5
          ? (contactPitch - nearbyPitch) / epsilon : (nearbyPitch - contactPitch) / epsilon;
        roll = { pitch: contactPitch, velocity };
        stepCache.rolls.set(key, roll);
      }
      pitch = marcherSwingFootPitch(gaitProgress, roll.pitch, roll.velocity);
    }
    return { ...boundMarcherFootTarget(hip, sole, yaw), yaw, pitch, rollDirection };
  };
  const leftTarget = footTarget(-1, !leftStance ? lift : 0);
  const rightTarget = footTarget(1, leftStance ? lift : 0);
  const solveLeg = (side: number, target: typeof leftTarget) => {
    const hip = new Vector3(side * hipHalfSpacing, 0.69, 0);
    const sole = boundMarcherFootLift(hip, target.sole, target.yaw);
    return precalculateMarcherLegPose(hip, sole, target.yaw, target.pitch, target.rollDirection);
  };
  const pose: BakedLegPose = {
    legs: [solveLeg(-1, leftTarget), solveLeg(1, rightTarget)],
    hipHalfSpacing, limited: leftTarget.limited || rightTarget.limited,
  };
  if (sample) {
    sample.contact?.(pose, rootPosition, bodyRotation, leftStance, gaitProgress);
    return pose;
  }
  reportLimited(pose.limited);
  applyLegPose(pose);
}

export function getRobotFootprintSource(robot: TransformNode) {
  const state = players.get(robot), parts = marcherParts.get(robot);
  if (!state || !parts || !state.counts.length) return null;
  const clockOffset = Math.round((getDrillTransportState().beat - getMusicTransportState().beat) * 1e8) / 1e8;
  const key = JSON.stringify([parts.gaitIndex, clockOffset, repeatOptions.songLength, repeatOptions.drill,
    playbackBeatUnits, state.counts.map(count => [
      count.position.x, count.position.y, count.position.z, count.rotationY, count.facingY, count.styleIndex,
    ])]);
  return {
    key,
    build(): MarcherFootContact[] {
      const sampleState: PlayerState = { ...state, stepCache: undefined, gaitPhaseCache: undefined, legBake: undefined };
      const last = state.counts.length - 1;
      const offsets = getGaitStepPhaseOffsets(sampleState, parts.gaitIndex);
      const cadence = (segment: number) => resolveSegmentGait(sampleState, segment, parts.gaitIndex)?.stepsPerCount ?? 1;
      const beats = gaitContactBeats(last,
        (segment, beat) => repeatOptions.songLength > 0
          ? midiPulseAtBeat(beat - clockOffset, playbackBeatUnits) * cadence(segment)
          : offsets[segment] + (beat - segment) * cadence(segment),
        (segment, step) => repeatOptions.songLength > 0
          ? midiBeatAtPulse(step / cadence(segment), playbackBeatUnits) + clockOffset
          : segment + (step - offsets[segment]) / cadence(segment));
      const contacts: MarcherFootContact[] = [];
      for (const beat of beats) {
        applyGlobalCount(robot, sampleState, {
          drillBeat: beat, musicBeat: beat - clockOffset,
          contact(pose, position, yaw, left, progress) {
            for (const side of beat === 0 && progress < 1e-8 ? [-1, 1] : [left ? -1 : 1]) {
              const leg = pose.legs[side < 0 ? 0 : 1];
              const sole = marcherSoleFromLegPose(new Vector3(side * pose.hipHalfSpacing, 0.69, 0), leg);
              const rotation = Quaternion.FromEulerAngles(0, yaw, 0);
              contacts.push({
                beat, left: side < 0, yaw: yaw + sole.yaw,
                position: position.add(sole.position.scale(MARCHER_BODY_SCALE)
                  .rotateByQuaternionToRef(rotation, Vector3.Zero())),
              });
            }
          },
        });
      }
      return contacts;
    },
  };
}

function applyGlobalCountToAllRobots() {
  players.forEach((state, robot) => applyGlobalCount(robot, state));
  allRobots.forEach((robot) => {
    const parts = marcherParts.get(robot);
    if (!parts) return;
    updateJacketLegPlanes([parts.leftThigh, parts.rightThigh, parts.leftCalf, parts.rightCalf], parts.body);
  });
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
  const oldState = players.get(robot);
  if (oldState) invalidateLegBake(oldState);
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
  facings?: ReadonlyArray<number | undefined>,
  skipCollisionRefresh = false
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
  const oldState = players.get(robot);
  if (oldState) invalidateLegBake(oldState);
  players.set(robot, { points: positions, stepSizeYards: DEFAULT_STEP_SIZE_YARDS, counts });
  applyGlobalCount(robot, players.get(robot)!);
  if (!skipCollisionRefresh) recalculateCollisionMarkers(scene);
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
  state.stepCache = undefined;
  invalidateLegBake(state);
  state.gaitPhaseCache?.clear();
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

export function captureMarcherMovement(robot: TransformNode) {
  const state = players.get(robot);
  return {
    position: robot.position.clone(),
    rotationY: robot.rotation.y,
    points: state?.points.map(point => point.clone()),
    counts: state?.counts.map(count => ({ ...count, position: count.position.clone() })),
    fixedFacingY: state?.fixedFacingY,
  };
}

export function restoreMarcherMovement(robot: TransformNode, snapshot: ReturnType<typeof captureMarcherMovement>) {
  if (robot.isDisposed()) throw new Error('Cannot restore movement of a disposed marcher.');
  heldRobots.delete(robot);
  robot.position.copyFrom(snapshot.position);
  robot.rotation.y = snapshot.rotationY;
  const state = players.get(robot);
  if (state && snapshot.points && snapshot.counts) {
    invalidateLegBake(state);
    state.stepCache = undefined;
    state.gaitPhaseCache?.clear();
    state.points = snapshot.points.map(point => point.clone());
    state.counts = snapshot.counts.map(count => ({ ...count, position: count.position.clone() }));
    state.fixedFacingY = snapshot.fixedFacingY;
    applyGlobalCount(robot, state);
  }
  if (sharedScene) recalculateCollisionMarkers(sharedScene);
}

export function clearRobotPath(robot: TransformNode) {
  const state = players.get(robot);
  if (state) invalidateLegBake(state);
  players.delete(robot);
  heldRobots.delete(robot);
}

export function suspendRobotForErase(robot: TransformNode) {
  const state = players.get(robot);
  const enabled = robot.isEnabled();
  if (state) invalidateLegBake(state);
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
  const page = blankChartPage;
  if (held) {
    const ghost = page?.pending.get(robot);
    if (page && ghost) {
      // Picking up a ghost puts the real marcher in the grab; the ghost stays
      // behind at the previous-page spot as a dimmer, ungrabbable reference.
      page.pending.delete(robot);
      setBlankPageGhostWaiting(robot, ghost, false);
      page.leftBehind.set(robot, ghost);
      page.claimed.add(robot);
      robot.setEnabled(true);
      notifyBlankChartPage();
    }
    const state = players.get(robot);
    if (state) invalidateLegBake(state);
    heldRobots.add(robot);
  } else {
    heldRobots.delete(robot);
    const state = players.get(robot);
    if (state) applyGlobalCount(robot, state);
    if (page?.claimed.delete(robot)) {
      // Released without being placed: its ghost becomes grabbable again.
      const ghost = page.leftBehind.get(robot);
      page.leftBehind.delete(robot);
      if (ghost && !ghost.isDisposed()) {
        setBlankPageGhostWaiting(robot, ghost, true);
        page.pending.set(robot, ghost);
        robot.setEnabled(false);
      } else {
        showBlankPageGhost(robot);
      }
      notifyBlankChartPage();
    }
  }
}

export function placeRobot(robot: TransformNode, position: Vector3, scene: Scene) {
  if (blankChartPage && players.get(robot)?.counts[blankChartPage.count]) {
    return placeRobotOnBlankChartPage(robot, position, scene);
  }
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
  state.stepCache = undefined;
  invalidateLegBake(state);

  applyGlobalCount(robot, state);
  recalculateCollisionMarkers(scene);
}

export interface MarcherSetPose {
  robot: TransformNode;
  position: Vector3;
  facingY?: number;
}

// Validate the destination set as one transaction before rewriting its adjacent transitions.
export function setRobotSetPoses(
  index: number, poses: readonly MarcherSetPose[], previousSet: number, nextSet: number, scene: Scene
): boolean {
  if (!Number.isInteger(index) || !Number.isInteger(previousSet) || !Number.isInteger(nextSet) ||
    previousSet < 0 || previousSet > index || nextSet < index || poses.length === 0 ||
    new Set(poses.map(pose => pose.robot)).size !== poses.length ||
    poses.some(pose => !players.get(pose.robot)?.counts[index] ||
      ![pose.position.x, pose.position.y, pose.position.z, pose.facingY ?? 0].every(Number.isFinite))) {
    throw new RangeError("Set edit requires valid counts and finite, unique marcher poses.");
  }
  const snapshots = [...allRobots].map(robot => ({
    robot, position: robot.position.clone(), yaw: robot.rotation.y,
  }));
  let accepted: boolean;
  try {
    for (const robot of allRobots) {
      const counts = players.get(robot)?.counts;
      const count = counts?.[Math.min(index, counts.length - 1)];
      if (count) {
        robot.position.copyFrom(count.position);
        robot.rotation.y = count.facingY ?? count.rotationY;
      }
    }
    accepted = tryManualMarcherPoses(poses.map(pose => ({
      robot: pose.robot, position: pose.position,
      rotationY: pose.facingY ?? players.get(pose.robot)!.counts[index].facingY ??
        players.get(pose.robot)!.counts[index].rotationY,
    })), false);
  } finally {
    snapshots.forEach(({ robot, position, yaw }) => {
      robot.position.copyFrom(position);
      robot.rotation.y = yaw;
      robot.computeWorldMatrix(true);
    });
  }
  if (!accepted) return false;
  for (const pose of poses) {
    const state = players.get(pose.robot)!;
    const last = Math.min(nextSet, state.counts.length - 1);
    const first = Math.min(previousSet, index);
    const from = state.counts[first].position.clone();
    const to = state.counts[last].position.clone();
    for (let count = first; count <= last; count++) {
      const position = count <= index
        ? Vector3.Lerp(from, pose.position, index === first ? 1 : (count - first) / (index - first))
        : Vector3.Lerp(pose.position, to, (count - index) / (last - index));
      state.counts[count].position.copyFrom(position);
    }
    if (pose.facingY !== undefined) state.counts[index].facingY = pose.facingY;
    for (let count = first; count <= last; count++) {
      const before = state.counts[Math.max(0, count - 1)].position;
      const after = state.counts[Math.min(state.counts.length - 1, count + 1)].position;
      if (Vector3.DistanceSquared(before, after) > 1e-8) {
        state.counts[count].rotationY = Math.atan2(after.x - before.x, after.z - before.z);
      }
    }
    state.points = state.counts.map(count => count.position.clone());
    state.gaitPhaseCache?.clear();
    state.stepCache = undefined;
    invalidateLegBake(state);
  }
  applyGlobalCountToAllRobots();
  recalculateCollisionMarkers(scene);
  return true;
}

// Transition library: how marchers travel from one chart page (keyframe) to
// the next. Path shape bends the route, pace times it, and style picks the
// marching style for those counts.
export const TRANSITION_PATH_SHAPES = [
  { id: "straight", label: "Straight" },
  { id: "curveLeft", label: "Curve Left" },
  { id: "curveRight", label: "Curve Right" },
  { id: "sCurve", label: "S-Curve" },
  { id: "lengthFirst", label: "L: Up Field First" },
  { id: "acrossFirst", label: "L: Across First" },
] as const;
export type TransitionPathShape = typeof TRANSITION_PATH_SHAPES[number]["id"];

export const TRANSITION_PACES = [
  { id: "even", label: "Even" },
  { id: "moveHold", label: "Move, Then Hold" },
  { id: "holdMove", label: "Hold, Then Move" },
  { id: "ease", label: "Ease In/Out" },
] as const;
export type TransitionPace = typeof TRANSITION_PACES[number]["id"];

// null keeps each marcher's own (global) style. In-place gaits are excluded
// because a transition must travel.
export const TRANSITION_STYLE_INDICES: readonly (number | null)[] = [null,
  ...["Field March", "High Step", "Parade", "Knee-Ankle March", "Slide", "Crab Walk",
    "Backward March", "Backward High Step"].map(name => GAIT_INDEX_BY_NAME.get(name)!)];

export function getTransitionStyleLabel(styleIndex: number | null): string {
  return styleIndex === null ? "Marcher Style" : MARCHING_GAITS[styleIndex].name;
}

export interface ChartTransition {
  shape: TransitionPathShape;
  pace: TransitionPace;
  styleIndex: number | null;
}

export interface ChartTransitionResult {
  marchers: number;
  maxStepYards: number;
}

// The transition picked in the library; ghosts placed on a blank page travel
// from their previous-page spot along it.
let activeChartTransition: ChartTransition = { shape: "straight", pace: "even", styleIndex: null };
export const onChartTransitionChangedObservable = new Observable<ChartTransition>();

export function getChartTransition(): ChartTransition {
  return { ...activeChartTransition };
}

export function setChartTransition(transition: Partial<ChartTransition>) {
  activeChartTransition = { ...activeChartTransition, ...transition };
  onChartTransitionChangedObservable.notifyObservers(getChartTransition());
}

// Steps one library list (path, pace or style) forward and returns the new label.
export function cycleChartTransition(kind: "shape" | "pace" | "style", direction: 1 | -1 = 1): string {
  const step = <T>(list: readonly T[], current: T) =>
    list[(list.indexOf(current) + direction + list.length) % list.length];
  if (kind === "shape") {
    const shape = step(TRANSITION_PATH_SHAPES.map(entry => entry.id), activeChartTransition.shape);
    setChartTransition({ shape });
    return TRANSITION_PATH_SHAPES.find(entry => entry.id === shape)!.label;
  }
  if (kind === "pace") {
    const pace = step(TRANSITION_PACES.map(entry => entry.id), activeChartTransition.pace);
    setChartTransition({ pace });
    return TRANSITION_PACES.find(entry => entry.id === pace)!.label;
  }
  const styleIndex = step(TRANSITION_STYLE_INDICES, activeChartTransition.styleIndex);
  setChartTransition({ styleIndex });
  return getTransitionStyleLabel(styleIndex);
}

export function getChartTransitionLabels(transition = activeChartTransition) {
  return {
    shape: TRANSITION_PATH_SHAPES.find(entry => entry.id === transition.shape)!.label,
    pace: TRANSITION_PACES.find(entry => entry.id === transition.pace)!.label,
    style: getTransitionStyleLabel(transition.styleIndex),
  };
}

const CURVE_BULGE = 0.35;
const S_CURVE_BULGE = 0.3;
const CURVE_SAMPLES = 48;

export function transitionPaceProgress(pace: TransitionPace, t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  switch (pace) {
    case "moveHold": return Math.min(1, clamped * 2);
    case "holdMove": return Math.max(0, clamped * 2 - 1);
    case "ease": return clamped * clamped * (3 - 2 * clamped);
    default: return clamped;
  }
}

// Ground-plane polyline for a shape from `from` to `to` (z runs up the field).
export function transitionPathPolyline(shape: TransitionPathShape, from: Vector3, to: Vector3): Vector3[] {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const left = new Vector3(-dz, 0, dx);
  const bezier = (controls: Vector3[]) => Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) => {
    let points = controls;
    const t = i / CURVE_SAMPLES;
    while (points.length > 1) {
      points = points.slice(1).map((point, index) => Vector3.Lerp(points[index], point, t));
    }
    return points[0];
  });
  const at = (fraction: number) => Vector3.Lerp(from, to, fraction);
  switch (shape) {
    case "curveLeft":
    case "curveRight": {
      const side = shape === "curveLeft" ? CURVE_BULGE : -CURVE_BULGE;
      return bezier([from, at(0.5).add(left.scale(side * 2)), to]);
    }
    case "sCurve":
      return bezier([from, at(1 / 3).add(left.scale(S_CURVE_BULGE * 1.5)),
        at(2 / 3).subtract(left.scale(S_CURVE_BULGE * 1.5)), to]);
    case "lengthFirst":
      return [from, new Vector3(from.x, (from.y + to.y) / 2, to.z), to];
    case "acrossFirst":
      return [from, new Vector3(to.x, (from.y + to.y) / 2, from.z), to];
    default:
      return [from, to];
  }
}

function polylineSample(points: readonly Vector3[], fraction: number) {
  const lengths = points.slice(1).map((point, index) => Vector3.Distance(points[index], point));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = Math.min(1, Math.max(0, fraction)) * total;
  for (let index = 0; index < lengths.length; index++) {
    const length = lengths[index];
    if (length > 1e-9 && (remaining <= length || index === lengths.length - 1)) {
      const a = points[index], b = points[index + 1];
      return {
        position: Vector3.Lerp(a, b, Math.min(1, remaining / length)),
        heading: Math.atan2(b.x - a.x, b.z - a.z),
      };
    }
    remaining -= length;
  }
  return { position: points[points.length - 1].clone(), heading: null };
}

// Rewrites counts fromCount..toCount of each marcher with the chosen path
// shape, pace and marching style. Positions at both pages stay fixed.
export function setRobotTransition(
  robots: Iterable<TransformNode>, fromCount: number, toCount: number, transition: ChartTransition, scene: Scene
): ChartTransitionResult {
  if (!Number.isInteger(fromCount) || !Number.isInteger(toCount) || fromCount < 0 || toCount <= fromCount) {
    throw new RangeError("A transition needs an earlier page and a later page.");
  }
  if (transition.styleIndex !== null && !TRANSITION_STYLE_INDICES.includes(transition.styleIndex)) {
    throw new RangeError("Transition style must come from the transition library.");
  }
  let marchers = 0;
  let maxStepYards = 0;
  for (const robot of robots) {
    const state = players.get(robot);
    if (!state || state.counts.length <= toCount || blankChartPage?.pending.has(robot)) continue;
    const counts = state.counts;
    const from = counts[fromCount].position.clone();
    const to = counts[toCount].position.clone();
    const polyline = transitionPathPolyline(transition.shape, from, to);
    const span = toCount - fromCount;
    let heading = counts[fromCount].rotationY;
    const firstMove = polylineSample(polyline, 0).heading;
    if (firstMove !== null) heading = firstMove;
    for (let count = fromCount; count <= toCount; count++) {
      const progress = transitionPaceProgress(transition.pace, (count - fromCount) / span);
      const sample = polylineSample(polyline, progress);
      const entry = counts[count];
      if (count > fromCount && count < toCount) entry.position.copyFrom(sample.position);
      entry.position.y = from.y + (to.y - from.y) * progress;
      if (count === fromCount || count === toCount) entry.position.copyFrom(count === fromCount ? from : to);
      if (count < toCount) entry.styleIndex = transition.styleIndex ?? undefined;
    }
    for (let count = fromCount; count <= toCount; count++) {
      const here = counts[count].position;
      const next = counts[Math.min(toCount, count + 1)].position;
      const previous = counts[Math.max(fromCount, count - 1)].position;
      if (count < toCount && Vector3.DistanceSquared(here, next) > 1e-8) {
        heading = Math.atan2(next.x - here.x, next.z - here.z);
        maxStepYards = Math.max(maxStepYards, Math.hypot(next.x - here.x, next.z - here.z));
      } else if (count > fromCount && Vector3.DistanceSquared(previous, here) > 1e-8) {
        heading = Math.atan2(here.x - previous.x, here.z - previous.z);
      }
      if (count > fromCount) counts[count].rotationY = heading;
    }
    state.points = counts.map(count => count.position.clone());
    state.gaitPhaseCache?.clear();
    state.stepCache = undefined;
    invalidateLegBake(state);
    marchers++;
  }
  if (marchers > 0) {
    applyGlobalCountToAllRobots();
    recalculateCollisionMarkers(scene);
  }
  return { marchers, maxStepYards };
}

// A chart page is a keyframe (set). Inserting a blank one after a set adds a
// new keyframe one page later; every marcher holds the earlier set's spot
// there and is hidden behind a translucent ghost until it is placed.
interface BlankChartPage {
  count: number;
  previous: number;
  next: number;
  pending: Map<TransformNode, TransformNode>;
  claimed: Set<TransformNode>;
  // Ghosts whose marchers were picked up stay at the previous-page spot.
  leftBehind: Map<TransformNode, TransformNode>;
  // Each marcher's spot on the following chart page, in another colour.
  nextGhosts: Map<TransformNode, TransformNode>;
}
let blankChartPage: BlankChartPage | null = null;
let blankChartPageTransportObserver: Observer<DrillTransportState> | null = null;
let nextPageLines: ReturnType<typeof MeshBuilder.CreateLineSystem> | null = null;
let nextPageLinesObserver: Observer<Scene> | null = null;
const NEXT_PAGE_GHOST_COLOR = new Color3(1, 0.62, 0.18);
const NEXT_PAGE_GHOST_ALPHA = 0.22;
const NEXT_PAGE_LINE_COLOR = new Color4(1, 0.62, 0.18, 0.85);

export interface BlankChartPageState { count: number; previous: number; waiting: number; }
export const onBlankChartPageChangedObservable = new Observable<BlankChartPageState | null>();

export function getBlankChartPageState(): BlankChartPageState | null {
  return blankChartPage && {
    count: blankChartPage.count,
    previous: blankChartPage.previous,
    waiting: blankChartPage.pending.size + blankChartPage.claimed.size,
  };
}

// While placing ghosts, media stepping/jogging stays within the move from the
// previous page to the blank page so the transition can be scrubbed both ways.
function clampToBlankChartPageSpan(countIndex: number): number {
  const page = blankChartPage;
  return page ? Math.min(page.count, Math.max(page.previous, countIndex)) : countIndex;
}

function notifyBlankChartPage() {
  onBlankChartPageChangedObservable.notifyObservers(getBlankChartPageState());
}

const BLANK_PAGE_GHOST_ALPHA = 0.28;
const LEFT_BEHIND_GHOST_ALPHA = 0.14;

function setBlankPageGhostWaiting(robot: TransformNode, ghost: TransformNode, waiting: boolean) {
  ghost.getChildMeshes().forEach((mesh) => {
    mesh.isPickable = waiting;
    if (mesh.material) mesh.material.alpha = waiting ? BLANK_PAGE_GHOST_ALPHA : LEFT_BEHIND_GHOST_ALPHA;
  });
  if (waiting) blankPageGhostOwners.set(ghost, robot);
  else blankPageGhostOwners.delete(ghost);
}

function showBlankPageGhost(robot: TransformNode) {
  const page = blankChartPage;
  const parent = robot.parent;
  if (!page || robot.isDisposed() || !(parent instanceof TransformNode)) return;
  robot.setEnabled(true);
  robot.computeWorldMatrix(true);
  showNextPageGhost(page, robot, parent);
  const ghost = createMarcherDragGhost(robot, parent);
  ghost.name = 'blankChartPageGhost';
  robot.setEnabled(false);
  setBlankPageGhostWaiting(robot, ghost, true);
  page.pending.set(robot, ghost);
  ghost.onDisposeObservable.addOnce(() => {
    blankPageGhostOwners.delete(ghost);
    if (page.pending.get(robot) === ghost) page.pending.delete(robot);
    if (page.leftBehind.get(robot) === ghost) page.leftBehind.delete(robot);
  });
}

// Shows where `robot` stands on the chart page after the blank one: a ghost
// in another colour, connected to the marcher by a line (see updateNextPageLines).
function showNextPageGhost(page: BlankChartPage, robot: TransformNode, parent: TransformNode) {
  if (page.next <= page.count || page.nextGhosts.has(robot)) return;
  const target = players.get(robot)?.counts[page.next];
  if (!target) return;
  const ghost = createMarcherDragGhost(robot, parent, NEXT_PAGE_GHOST_COLOR);
  ghost.name = 'nextChartPageGhost';
  ghost.getChildMeshes().forEach((mesh) => {
    if (mesh.material) mesh.material.alpha = NEXT_PAGE_GHOST_ALPHA;
  });
  // The parts copy the marcher's current pose; turn and move them about its feet.
  ghost.setPivotPoint(robot.position.clone());
  ghost.rotation.y = (target.facingY ?? target.rotationY) - robot.rotation.y;
  ghost.position.copyFrom(target.position.subtract(robot.position));
  page.nextGhosts.set(robot, ghost);
  ghost.onDisposeObservable.addOnce(() => {
    if (page.nextGhosts.get(robot) === ghost) page.nextGhosts.delete(robot);
  });
}

const nextLineInverse = new Matrix();
const nextLineStart = new Vector3();
const NEXT_PAGE_LINE_LIFT = 0.05;

// Redraws the line from each marcher (waiting, held or placed) to its next-page ghost.
function updateNextPageLines(scene: Scene) {
  const page = blankChartPage;
  const lines: Vector3[][] = [];
  let parent: TransformNode | null = null;
  page?.nextGhosts.forEach((ghost, robot) => {
    const target = players.get(robot)?.counts[page.next]?.position;
    if (!target || robot.isDisposed() || !(ghost.parent instanceof TransformNode)) return;
    parent ??= ghost.parent;
    parent.computeWorldMatrix(true).invertToRef(nextLineInverse);
    Vector3.TransformCoordinatesToRef(robot.getAbsolutePosition(), nextLineInverse, nextLineStart);
    lines.push([
      new Vector3(nextLineStart.x, nextLineStart.y + NEXT_PAGE_LINE_LIFT, nextLineStart.z),
      new Vector3(target.x, target.y + NEXT_PAGE_LINE_LIFT, target.z),
    ]);
  });
  const colors = lines.map(() => [NEXT_PAGE_LINE_COLOR, NEXT_PAGE_LINE_COLOR]);
  const reusable = nextPageLines && !nextPageLines.isDisposed() &&
    nextPageLines.getTotalVertices() === lines.length * 2 && nextPageLines.parent === parent;
  if (lines.length === 0) {
    nextPageLines?.dispose();
    nextPageLines = null;
  } else if (reusable) {
    MeshBuilder.CreateLineSystem('nextChartPageLines', { lines, colors, instance: nextPageLines! }, scene);
  } else {
    nextPageLines?.dispose();
    nextPageLines = MeshBuilder.CreateLineSystem('nextChartPageLines', { lines, colors, updatable: true }, scene);
    nextPageLines.parent = parent;
    nextPageLines.isPickable = false;
    nextPageLines.alpha = NEXT_PAGE_LINE_COLOR.a;
  }
}

function clearNextPagePreview(page: BlankChartPage) {
  [...page.nextGhosts.values()].forEach((ghost) => ghost.dispose());
  page.nextGhosts.clear();
  nextPageLinesObserver?.remove();
  nextPageLinesObserver = null;
  nextPageLines?.dispose();
  nextPageLines = null;
}

function placeRobotOnBlankChartPage(robot: TransformNode, position: Vector3, scene: Scene) {
  const page = blankChartPage!;
  const wasHeld = heldRobots.delete(robot);
  let placed = false;
  try {
    placed = setRobotSetPoses(page.count, [{ robot, position }], page.previous, page.next, scene);
  } catch {
    placed = false;
  }
  if (!placed) {
    if (wasHeld) heldRobots.add(robot);
    return null;
  }
  if (page.previous < page.count) {
    setRobotTransition([robot], page.previous, page.count, activeChartTransition, scene);
  }
  page.claimed.delete(robot);
  robot.setEnabled(true);
  if (!directingAdjacentMarchers) lastBlankPagePlacement = { robot, page, time: performance.now() };
  notifyBlankChartPage();
  // The new keyframe was rewritten in place, so attached route visuals don't shift.
  return Vector3.Zero();
}

// Inserts a blank page after the set at `afterCount` and seeks to it.
// Returns the new page's count, or null when there are no routed marchers.
export function insertBlankChartPage(afterCount: number, countsPerPage: number, scene: Scene): number | null {
  if (players.size === 0 || !Number.isInteger(countsPerPage) || countsPerPage < 1) return null;
  endBlankChartPage();
  setGhostBandPreviewEnabled(false);
  const at = Math.min(getMaxCountIndex(), Math.max(0, Math.round(afterCount)));
  const count = at + countsPerPage;
  const copy = (source: RobotCount): RobotCount =>
    ({ ...source, position: source.position.clone(), styleIndex: undefined });
  players.forEach((state) => {
    const counts = state.counts;
    if (counts.length === 0) return;
    while (counts.length - 1 < at) counts.push(copy(counts[counts.length - 1]));
    const hold = counts[at];
    counts.splice(at + 1, 0, ...Array.from({ length: countsPerPage }, () => copy(hold)));
    state.points = counts.map((entry) => entry.position.clone());
    state.gaitPhaseCache?.clear();
    state.stepCache = undefined;
    invalidateLegBake(state);
  });
  seekToCount(count);
  openBlankChartPage(count, at, Math.min(count + countsPerPage, getMaxCountIndex()), null, scene);
  return count;
}

// Starts placing ghosts on the page at `count` (already seeked to). `waiting`
// limits which marchers wait as ghosts; null means every enabled marcher.
function openBlankChartPage(
  count: number, previous: number, next: number, waiting: ReadonlySet<TransformNode> | null, scene: Scene
) {
  blankChartPage = {
    count, previous, next, pending: new Map(), claimed: new Set(), leftBehind: new Map(), nextGhosts: new Map(),
  };
  const page = blankChartPage;
  players.forEach((_state, robot) => {
    if (!robot.isEnabled() || heldRobots.has(robot)) return;
    if (!waiting || waiting.has(robot)) showBlankPageGhost(robot);
    else if (robot.parent instanceof TransformNode) showNextPageGhost(page, robot, robot.parent);
  });
  nextPageLinesObserver = scene.onBeforeRenderObservable.add(() => updateNextPageLines(scene));
  updateNextPageLines(scene);
  blankChartPageTransportObserver ??= onDrillTransportChangedObservable.add((transport) => {
    // Leaving the move into the new page (seek or playback) finishes it; unplaced marchers keep holding.
    if (blankChartPage && (transport.playing ||
      transport.beat < blankChartPage.previous - 1e-6 || transport.beat > blankChartPage.count + 1e-6)) {
      endBlankChartPage();
    }
  });
  recalculateCollisionMarkers(scene);
  notifyBlankChartPage();
}

// --- Saving a chart page draft in progress: every marcher's full schedule
// plus which marchers still wait as ghosts on the open blank page.
export interface MarcherScheduleSnapshot {
  robot: TransformNode;
  gaitIndex: number;
  instrument: MarcherInstrument;
  instrumentRestPose: boolean;
  color: Color3;
  stepSizeYards: number;
  fixedFacingY?: number;
  counts: RobotCount[];
}

export interface BlankChartPageSnapshot {
  count: number;
  previous: number;
  next: number;
  waiting: TransformNode[];
}

export function captureMarcherSchedules(): MarcherScheduleSnapshot[] {
  const snapshots: MarcherScheduleSnapshot[] = [];
  allRobots.forEach((robot) => {
    const parts = marcherParts.get(robot);
    if (robot.isDisposed() || !parts) return;
    const state = players.get(robot);
    if (!state && !robot.isEnabled()) return;
    const counts = state?.counts.length
      ? state.counts.map((count) => ({ ...count, position: count.position.clone() }))
      : [{ position: robot.position.clone(), rotationY: robot.rotation.y }];
    snapshots.push({
      robot, gaitIndex: parts.gaitIndex, instrument: parts.instrument, instrumentRestPose: parts.instrumentRestPose,
      color: getRobotColor(robot).clone(), stepSizeYards: state?.stepSizeYards ?? DEFAULT_STEP_SIZE_YARDS,
      fixedFacingY: state?.fixedFacingY, counts,
    });
  });
  return snapshots;
}

export function captureBlankChartPage(): BlankChartPageSnapshot | null {
  const page = blankChartPage;
  return page && {
    count: page.count, previous: page.previous, next: page.next,
    waiting: [...page.pending.keys(), ...page.claimed],
  };
}

// Recreates a marcher's saved schedule exactly (counts keep their facings and
// transition styles), so a restored drill plays back as it was saved.
export function restoreMarcherSchedule(
  robot: TransformNode, snapshot: Omit<MarcherScheduleSnapshot, 'robot' | 'gaitIndex'>, scene: Scene
) {
  if (snapshot.counts.length === 0) return;
  ensureSharedObserver(scene);
  setMarcherInstrument(robot, snapshot.instrument);
  setMarcherInstrumentRestPose(robot, snapshot.instrumentRestPose);
  setRobotColor(robot, snapshot.color);
  const counts = snapshot.counts.map((count) => ({ ...count, position: count.position.clone() }));
  const oldState = players.get(robot);
  if (oldState) invalidateLegBake(oldState);
  players.set(robot, {
    points: counts.map((count) => count.position.clone()), stepSizeYards: snapshot.stepSizeYards,
    counts, fixedFacingY: snapshot.fixedFacingY,
  });
  robot.setEnabled(true);
  applyGlobalCount(robot, players.get(robot)!);
}

// Reopens a saved blank page: seeks to it and shows the waiting marchers as ghosts.
export function resumeBlankChartPage(snapshot: BlankChartPageSnapshot, scene: Scene) {
  endBlankChartPage();
  setGhostBandPreviewEnabled(false);
  const last = getMaxCountIndex();
  const count = Math.min(last, Math.max(0, Math.round(snapshot.count)));
  const previous = Math.min(count, Math.max(0, Math.round(snapshot.previous)));
  seekToCount(count);
  openBlankChartPage(count, previous, Math.min(last, Math.max(count, Math.round(snapshot.next))),
    new Set(snapshot.waiting), scene);
}

// Places the waiting marcher whose ghost is nearest `position` onto the blank page.
// Returns null when no marcher is waiting, else whether placement succeeded.
export function placeNearestBlankPageMarcher(position: Vector3, scene: Scene): boolean | null {
  const page = blankChartPage;
  if (!page || page.pending.size === 0) return null;
  let nearest: TransformNode | null = null;
  let nearestDistance = Infinity;
  page.pending.forEach((_ghost, robot) => {
    const spot = players.get(robot)?.counts[page.count]?.position ?? robot.position;
    const distance = (spot.x - position.x) ** 2 + (spot.z - position.z) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = robot;
    }
  });
  const robot = nearest as TransformNode | null;
  if (!robot) return null;
  setRobotHeld(robot, true);
  if (placeRobot(robot, position, scene)) return true;
  setRobotHeld(robot, false);
  return false;
}

// The marcher most recently placed on the blank page anchors the "direct
// adjacent marchers" gesture for a short while afterwards.
const ADJACENT_GESTURE_WINDOW_MS = 10000;
// Previous-page neighbors closer than this are chained into one group.
const ADJACENT_LINK_YARDS = 4.1;
const ADJACENT_MAX_MARCHERS = 32;
const STEP_YARDS = 0.625;
let lastBlankPagePlacement: { robot: TransformNode; page: BlankChartPage; time: number } | null = null;
let directingAdjacentMarchers = false;

function recentBlankPageAnchor() {
  const last = lastBlankPagePlacement;
  const page = blankChartPage;
  if (!last || !page || last.page !== page || last.robot.isDisposed() || page.pending.has(last.robot) ||
    performance.now() - last.time > ADJACENT_GESTURE_WINDOW_MS) return null;
  return { robot: last.robot, page };
}

export function hasRecentBlankPagePlacement() {
  return recentBlankPageAnchor() !== null;
}

export interface AdjacentPlacementPlan {
  robot: TransformNode;
  position: Vector3;
}

// Chains the waiting marchers adjacent to the anchor on the previous page,
// orders them along that line, and spaces them along `guide` at whole-step
// intervals on either side of the anchor's new spot.
export function planAdjacentGuidePlacements(
  anchorPrevious: Vector3, anchorTarget: Vector3, candidates: ReadonlyArray<{ robot: TransformNode; previous: Vector3 }>,
  guide: readonly Vector3[]
): AdjacentPlacementPlan[] {
  if (guide.length < 2) return [];
  const group: { robot: TransformNode | null; previous: Vector3 }[] = [{ robot: null, previous: anchorPrevious }];
  const remaining = [...candidates];
  for (let index = 0; index < group.length && group.length <= ADJACENT_MAX_MARCHERS; index++) {
    const from = group[index].previous;
    for (let other = remaining.length - 1; other >= 0; other--) {
      const point = remaining[other].previous;
      if (Math.hypot(point.x - from.x, point.z - from.z) <= ADJACENT_LINK_YARDS) {
        group.push(remaining[other]);
        remaining.splice(other, 1);
      }
    }
  }
  const members = group.slice(1, ADJACENT_MAX_MARCHERS + 1) as { robot: TransformNode; previous: Vector3 }[];
  if (members.length === 0) return [];

  // Principal axis of the previous-page group gives its left-to-right order.
  const all = [anchorPrevious, ...members.map(member => member.previous)];
  const meanX = all.reduce((sum, point) => sum + point.x, 0) / all.length;
  const meanZ = all.reduce((sum, point) => sum + point.z, 0) / all.length;
  let xx = 0, xz = 0, zz = 0;
  all.forEach(point => {
    const x = point.x - meanX, z = point.z - meanZ;
    xx += x * x; xz += x * z; zz += z * z;
  });
  const angle = 0.5 * Math.atan2(2 * xz, xx - zz);
  let axisX = Math.cos(angle), axisZ = Math.sin(angle);

  const neighborDistances = all.map((point, index) => Math.min(...all.filter((_, other) => other !== index)
    .map(other => Math.hypot(other.x - point.x, other.z - point.z))));
  neighborDistances.sort((a, b) => a - b);
  const median = neighborDistances[Math.floor(neighborDistances.length / 2)];
  const spacing = Math.max(2 * STEP_YARDS, Math.round(median / STEP_YARDS) * STEP_YARDS);

  const lengths = guide.slice(1).map((point, index) => Math.hypot(point.x - guide[index].x, point.z - guide[index].z));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total < 1e-6) return [];
  let anchorArc = 0, bestDistance = Infinity, tangentX = 0, tangentZ = 1, walked = 0;
  lengths.forEach((length, index) => {
    const a = guide[index], b = guide[index + 1];
    const t = length > 1e-9 ? Math.max(0, Math.min(1,
      ((anchorTarget.x - a.x) * (b.x - a.x) + (anchorTarget.z - a.z) * (b.z - a.z)) / (length * length))) : 0;
    const distance = Math.hypot(a.x + (b.x - a.x) * t - anchorTarget.x, a.z + (b.z - a.z) * t - anchorTarget.z);
    if (distance < bestDistance && length > 1e-9) {
      bestDistance = distance;
      anchorArc = walked + t * length;
      tangentX = (b.x - a.x) / length;
      tangentZ = (b.z - a.z) / length;
    }
    walked += length;
  });
  // Keep the group's order consistent with the guide's direction.
  if (axisX * tangentX + axisZ * tangentZ < 0) { axisX = -axisX; axisZ = -axisZ; }
  const projected = members.map(member => ({
    member,
    t: (member.previous.x - anchorPrevious.x) * axisX + (member.previous.z - anchorPrevious.z) * axisZ,
  }));
  const before = projected.filter(entry => entry.t < 0).sort((a, b) => b.t - a.t);
  const after = projected.filter(entry => entry.t >= 0).sort((a, b) => a.t - b.t);

  const at = (arc: number) => {
    let left = arc;
    for (let index = 0; index < lengths.length; index++) {
      if (left <= lengths[index] || index === lengths.length - 1) {
        const t = lengths[index] > 1e-9 ? Math.min(1, left / lengths[index]) : 0;
        return new Vector3(guide[index].x + (guide[index + 1].x - guide[index].x) * t, anchorTarget.y,
          guide[index].z + (guide[index + 1].z - guide[index].z) * t);
      }
      left -= lengths[index];
    }
    return guide[guide.length - 1].clone();
  };
  // Slots fill outward from the anchor; when the guide ends on one side the
  // overflow continues past the last slot on the other side.
  const slotsBefore: number[] = [];
  const slotsAfter: number[] = [];
  for (let k = 1; anchorArc - k * spacing >= -1e-6; k++) slotsBefore.push(anchorArc - k * spacing);
  for (let k = 1; anchorArc + k * spacing <= total + 1e-6; k++) slotsAfter.push(anchorArc + k * spacing);
  const plan: AdjacentPlacementPlan[] = [];
  const assign = (entries: typeof projected, own: number[], other: number[]) => {
    for (const entry of entries) {
      const arc = own.shift() ?? other.shift();
      if (arc === undefined) return;
      plan.push({ robot: entry.member.robot, position: at(arc) });
    }
  };
  if (before.length > slotsBefore.length) {
    assign(after, slotsAfter, slotsBefore);
    assign(before, slotsBefore, slotsAfter);
  } else {
    assign(before, slotsBefore, slotsAfter);
    assign(after, slotsAfter, slotsBefore);
  }
  return plan;
}

// Gesture action: sends the waiting marchers that stood next to the most
// recently placed marcher on the previous page to evenly spaced spots along
// the selected guide. Returns null when no recent placement anchors it.
export function directAdjacentBlankPageMarchers(guide: readonly Vector3[], scene: Scene) {
  const anchor = recentBlankPageAnchor();
  if (!anchor) return null;
  const { robot, page } = anchor;
  const anchorState = players.get(robot);
  if (!anchorState) return null;
  const candidates = [...page.pending.keys()].flatMap(other => {
    const previous = players.get(other)?.counts[page.previous]?.position;
    return previous ? [{ robot: other, previous }] : [];
  });
  const plan = planAdjacentGuidePlacements(anchorState.counts[page.previous].position,
    anchorState.counts[page.count].position, candidates, guide);
  let placed = 0;
  directingAdjacentMarchers = true;
  try {
    for (const entry of plan) {
      setRobotHeld(entry.robot, true);
      if (placeRobot(entry.robot, entry.position, scene)) placed++;
      else setRobotHeld(entry.robot, false);
    }
  } finally {
    directingAdjacentMarchers = false;
  }
  if (lastBlankPagePlacement) lastBlankPagePlacement.time = performance.now();
  return { placed, blocked: plan.length - placed };
}

export function endBlankChartPage() {
  const page = blankChartPage;
  if (!page) return;
  blankChartPage = null;
  lastBlankPagePlacement = null;
  [...page.pending].forEach(([robot, ghost]) => {
    ghost.dispose();
    if (!robot.isDisposed()) robot.setEnabled(true);
  });
  [...page.leftBehind.values()].forEach((ghost) => ghost.dispose());
  clearNextPagePreview(page);
  page.pending.clear();
  page.claimed.clear();
  page.leftBehind.clear();
  applyGlobalCountToAllRobots();
  if (sharedScene) recalculateCollisionMarkers(sharedScene);
  notifyBlankChartPage();
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
  prebakingLegAnimation = false;
  globalPlayback.speedMultiplier = Math.abs(globalPlayback.speedMultiplier) || 1;
  globalPlayback.playing = true;
  notifyDrillTransport();
}

export function pauseAll() {
  prebakingLegAnimation = false;
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
  prebakingLegAnimation = false;
  globalPlayback.speedMultiplier = -2;
  globalPlayback.playing = true;
  notifyDrillTransport();
}

export function fastForwardAll() {
  prebakingLegAnimation = false;
  globalPlayback.speedMultiplier = 2;
  globalPlayback.playing = true;
  notifyDrillTransport();
}

export function stepAll(direction: 1 | -1) {
  transportRevision++;
  globalPlayback.playing = false;
  globalPlayback.stepAccumulatorSeconds = 0;
  globalPlayback.countIndex = clampToBlankChartPageSpan(
    Math.min(getMaxCountIndex(), Math.max(0, globalPlayback.countIndex + direction)));
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
  prebakingLegAnimation = false;
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

export function jogGhostBandBy(deltaCounts: number) {
  if (!Number.isFinite(deltaCounts) || deltaCounts === 0) return;
  if (blankChartPage) {
    // Jog the real band through the transition so placed marchers can be checked.
    seekToCount(clampToBlankChartPageSpan(globalPlayback.countIndex + deltaCounts));
    return;
  }
  setGhostBandPreviewEnabled(true);
  scrubBy(deltaCounts);
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

export function getRoutedRobots(): TransformNode[] {
  return [...players.keys()];
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
