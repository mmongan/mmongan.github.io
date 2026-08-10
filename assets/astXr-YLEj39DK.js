import{W as Ve,E as Ye,S as Qe,C as he,A as Ke,V as l,H as en,T as Ee,a as O,Q as q,R as Ne,M as V,b as y,c as nn,d as W,D as ze,p as xe,e as tn}from"./package-Bh5hlPqk.js";const ve=`import "@babylonjs/loaders/glTF";
import "@babylonjs/core/XR/motionController/webXROculusTouchMotionController";

import {
  AbstractMesh,
  ActionManager,
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  ExecuteCodeAction,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  SixDofDragBehavior,
  StandardMaterial,
  Texture,
  TransformNode,
  UniversalCamera,
  Vector3,
  WebXRDefaultExperience,
  WebXRInputSource,
  WebXRMotionControllerManager,
  WebXRState,
} from "@babylonjs/core";
import { SkyMaterial } from "@babylonjs/materials/sky";
import { Midi } from "@tonejs/midi";
import { getTransport, PolySynth, start as startAudio, Synth } from "tone";
import packageJson from "../../package.json";
import { compileCalChartShwMovements, parseCalChartShw } from "./calchart-shw";

const queenFinalShwUrl = "https://raw.githubusercontent.com/calband/calchart/main/shows/Queen%20Final.shw";

WebXRMotionControllerManager.UseOnlineRepository = true;
WebXRMotionControllerManager.PrioritizeOnlineRepository = true;

type AlphabetLetter = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j" | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t" | "u" | "v" | "w" | "x" | "y" | "z";
type FormationName = "block" | "box" | "triangle" | "star" | "spiral" | "circle" | "zigzag" | \`letter-\${AlphabetLetter}\`;
type TransitionType = "direct" | "arc-left" | "arc-right" | "expand" | "pinwheel" | "rank-ripple";
type GaitName =
  | "stand"
  | "march"
  | "roll-step"
  | "backward-march"
  | "high-step"
  | "chair-step"
  | "glide"
  | "mark-time"
  | "crab-step"
  | "jazz-run";

type PerformerSection = "brass" | "drum" | "guard" | "drum-major" | "unspecified";
type DrumType = "bass" | "snare" | "tenor" | "auxiliary";
type InstrumentType =
  | "piccolo"
  | "flute"
  | "clarinet"
  | "alto-saxophone"
  | "tenor-saxophone"
  | "trumpet"
  | "mellophone"
  | "flugelhorn"
  | "trombone"
  | "baritone"
  | "sousaphone"
  | "glockenspiel"
  | "cymbals";
type InstrumentStyle = "mouth" | "low" | "shoulder" | "mallet";
type ArmStyle = InstrumentStyle | "cymbals" | "drum" | "guard";
type PlantedFoot = "left" | "right";

interface PrecalculatedFootstep {
  tickOffset: number;
  plantedFoot: PlantedFoot;
  positions: Vector3[];
  directions: Vector3[];
  stepSizes: number[];
}

interface PerformerRig {
  torso: TransformNode;
  leftArm: TransformNode;
  rightArm: TransformNode;
  leftLeg: TransformNode;
  rightLeg: TransformNode;
  instrument: TransformNode | null;
  instrumentStyle: InstrumentStyle | null;
  instrumentPose: number;
  cymbals: [TransformNode, TransformNode] | null;
  armStyle: ArmStyle;
  instrumentType: InstrumentType | null;
}

interface DrillCueFile {
  title: string;
  midi: string;
  source: string;
  cues: Array<{
    measure: number;
    formation: FormationName;
    gait?: GaitName;
    facing?: number;
    readingDirection: number;
    transition?: TransitionType;
    transitionMeasures: number;
    label: string;
  }>;
}

type CalChartMovement = {
  type: "even" | "arc" | "mark" | "stand" | "close";
  beats: number;
  beats_per_step?: number;
  facing?: number;
  facing_offset?: number;
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  start_x?: number;
  start_y?: number;
  center_x?: number;
  center_y?: number;
  angle?: number;
};

interface CalChartViewerFile {
  meta: { type: "viewer"; version?: string; index_name?: string };
  show: {
    title?: string;
    description?: string;
    labels: string[];
    sheets: Array<{
      label: string;
      beats: number;
      field_type?: string;
      movements: Record<string, CalChartMovement[]>;
    }>;
  };
}

type PreparedCalChartSheet = CalChartViewerFile["show"]["sheets"][number] & { startBeat: number };

interface PreparedCalChartDrill {
  labels: string[];
  sheets: PreparedCalChartSheet[];
  title: string;
}

type TimedDrillCue = DrillCueFile["cues"][number] & {
  tick: number;
  transitionTicks: number;
  fromPositions: Vector3[];
  positions: Vector3[];
  pathPositions: Vector3[][];
  pathProgress: number[];
  footsteps: PrecalculatedFootstep[];
  fromFacingAngle: number;
  facingAngle: number;
};

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const statusElement = document.getElementById("status") as HTMLSpanElement;
const buildInfoElement = document.getElementById("build-info") as HTMLDivElement;
const enterArButton = document.getElementById("enter-ar-button") as HTMLButtonElement;
const enterVrButton = document.getElementById("enter-vr-button") as HTMLButtonElement;
const midiFileInput = document.getElementById("midi-file") as HTMLInputElement;
const drillFileInput = document.getElementById("drill-file") as HTMLInputElement;
const playButton = document.getElementById("play-button") as HTMLButtonElement;
const stopButton = document.getElementById("stop-button") as HTMLButtonElement;
const musicPositionInput = document.getElementById("music-position") as HTMLInputElement;
const requestedPerformanceTestCount = Number.parseInt(new URLSearchParams(window.location.search).get("performance-test") ?? "", 10);
const performanceTestPerformerCount = Number.isFinite(requestedPerformanceTestCount) && requestedPerformanceTestCount > 0
  ? requestedPerformanceTestCount
  : null;

const engine = new Engine(canvas, true, { adaptToDeviceRatio: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.025, 0.055, 0.075, 1);
scene.skipPointerMovePicking = true;

const fieldLength = 12;
const fieldWidth = 5.333;
const endZoneDepth = 1;
const playingFieldLength = fieldLength - endZoneDepth * 2;
const tabletopScale = 0.1;
const lifeSizeScale = 109.728 / fieldLength;
const yardsPerSceneUnit = 120 / fieldLength;
const eightToFiveStep = 0.625 / yardsPerSceneUnit;
const fourStepInterval = eightToFiveStep * 4;
const formationInterval = fourStepInterval;
const rankInterval = fourStepInterval;
const performerModelHeight = 0.615;
const shoeSoleClearance = 0.0045;
const fieldPaintHeight = 0.0005;
const physicalPerformerScale = 1.8 / (performerModelHeight * lifeSizeScale);
const fieldRoot = new Mesh("marching-field", scene);

const camera = new UniversalCamera(
  "field-camera",
  new Vector3(0, 3.2, -8),
  scene,
);
camera.setTarget(new Vector3(0, 0.35, 0));
camera.speed = 0.28;
camera.angularSensibility = 3000;
camera.keysUp.push(87);
camera.keysDown.push(83);
camera.keysLeft.push(65);
camera.keysRight.push(68);
camera.attachControl(canvas, true);

const flyKeys = new Set<string>();
window.addEventListener("keydown", event => flyKeys.add(event.code));
window.addEventListener("keyup", event => flyKeys.delete(event.code));
window.addEventListener("blur", () => flyKeys.clear());
scene.onBeforeRenderObservable.add(() => {
  if (scene.activeCamera !== camera) return;
  const verticalDirection = Number(flyKeys.has("Space")) - Number(flyKeys.has("KeyC"));
  camera.position.y += verticalDirection * camera.speed * engine.getDeltaTime() / 16.667;
});

const skyMaterial = new SkyMaterial("stadium-sky-material", scene);
skyMaterial.backFaceCulling = false;
skyMaterial.luminance = 0.92;
skyMaterial.turbidity = 5;
skyMaterial.rayleigh = 1.8;
skyMaterial.mieCoefficient = 0.006;
skyMaterial.mieDirectionalG = 0.82;
skyMaterial.inclination = 0.28;
skyMaterial.azimuth = 0.18;

const skybox = MeshBuilder.CreateBox("stadium-skybox", { size: 900, sideOrientation: Mesh.BACKSIDE }, scene);
skybox.material = skyMaterial;
skybox.isPickable = false;
skybox.alwaysSelectAsActiveMesh = true;
skybox.setEnabled(false);

const light = new HemisphericLight("stadium-light", new Vector3(0.2, 1, 0.15), scene);
light.intensity = 1.15;
light.groundColor = new Color3(0.08, 0.12, 0.16);

function material(name: string, color: Color3, emissive = 0): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = color;
  result.emissiveColor = color.scale(emissive);
  result.specularColor = new Color3(0.08, 0.08, 0.08);
  return result;
}

const turfMaterial = material("turf", new Color3(0.045, 0.32, 0.16));
const turfStripeMaterial = material("turf-stripe", new Color3(0.052, 0.36, 0.18));
const lineMaterial = material("field-marking", new Color3(0.94, 0.96, 0.9), 0.08);
const endZoneMaterial = material("end-zone", new Color3(0.52, 0.08, 0.1));
const trackMaterial = material("track", new Color3(0.32, 0.13, 0.1));
const uniformMaterial = material("uniform", new Color3(0.04, 0.12, 0.24));
const uniformTrimMaterial = material("uniform-trim", new Color3(0.82, 0.1, 0.14), 0.04);
const pantsMaterial = material("uniform-pants", new Color3(0.92, 0.93, 0.9));
const skinMaterial = material("skin", new Color3(0.64, 0.4, 0.28));
const shoeMaterial = material("shoes", new Color3(0.025, 0.03, 0.035));
const brassMaterial = material("brass", new Color3(0.93, 0.67, 0.12), 0.14);
const drumMaterial = material("drum", new Color3(0.76, 0.79, 0.83), 0.06);
const standMaterial = material("stands", new Color3(0.3, 0.34, 0.37));
const scoreboardFrameMaterial = material("scoreboard-frame", new Color3(0.09, 0.1, 0.085));
const goalpostMaterial = material("goalposts", new Color3(0.96, 0.72, 0.08), 0.12);
const tabletopMaterial = material("tabletop-base", new Color3(0.055, 0.065, 0.06));
const tabletopGrabMaterial = material("tabletop-grab", Color3.Black());
tabletopGrabMaterial.alpha = 0;
tabletopGrabMaterial.disableDepthWrite = true;

const sharedPerformerMeshes = new Map<string, Mesh>();

function createSharedPerformerMesh(
  key: string,
  name: string,
  parent: TransformNode,
  material: StandardMaterial,
  createSource: () => Mesh,
): AbstractMesh {
  const source = sharedPerformerMeshes.get(key);
  const mesh = source ? source.createInstance(name) : createSource();
  if (!source) {
    mesh.material = material;
    sharedPerformerMeshes.set(key, mesh as Mesh);
  }
  mesh.parent = parent;
  return mesh;
}

function createMergedPerformerMesh(
  key: string,
  name: string,
  parent: TransformNode,
  material: StandardMaterial,
  createParts: () => Mesh[],
): AbstractMesh {
  return createSharedPerformerMesh(key, name, parent, material, () => {
    const merged = Mesh.MergeMeshes(createParts(), true, true);
    if (!merged) throw new Error(\`Unable to merge \${key} instrument mesh\`);
    merged.name = name;
    return merged;
  });
}

function createField(): { field: Mesh; tabletopBase: Mesh; tabletopGrabSurface: Mesh } {
  const tabletopBase = MeshBuilder.CreateBox("tabletop-base", {
    width: fieldLength + 3,
    height: 0.35,
    depth: fieldWidth + 2.3,
  }, scene);
  tabletopBase.parent = fieldRoot;
  tabletopBase.position.y = -0.225;
  tabletopBase.material = tabletopMaterial;

  const track = MeshBuilder.CreateGround("track", { width: fieldLength + 3, height: fieldWidth + 2.3 }, scene);
  track.parent = fieldRoot;
  track.position.y = -0.025;
  track.material = trackMaterial;

  const field = MeshBuilder.CreateGround("field", { width: fieldLength, height: fieldWidth }, scene);
  field.parent = fieldRoot;
  field.material = turfMaterial;

  for (let stripe = -5; stripe <= 5; stripe += 2) {
    const stripeMesh = MeshBuilder.CreateGround(\`turf-stripe-\${stripe}\`, {
      width: playingFieldLength / 10,
      height: fieldWidth,
    }, scene);
    stripeMesh.parent = fieldRoot;
    stripeMesh.position.set(stripe * playingFieldLength / 10 / 2, fieldPaintHeight * 0.25, 0);
    stripeMesh.material = turfStripeMaterial;
  }

  for (const side of [-1, 1]) {
    const endZone = MeshBuilder.CreateGround(\`end-zone-\${side}\`, { width: endZoneDepth, height: fieldWidth }, scene);
    endZone.parent = fieldRoot;
    endZone.position.set(side * (fieldLength - endZoneDepth) / 2, fieldPaintHeight * 0.25, 0);
    endZone.material = endZoneMaterial;
  }

  const tabletopGrabSurface = MeshBuilder.CreateGround("tabletop-grab-surface", {
    width: fieldLength + 3,
    height: fieldWidth + 2.3,
  }, scene);
  tabletopGrabSurface.parent = fieldRoot;
  tabletopGrabSurface.position.y = 0.025;
  tabletopGrabSurface.material = tabletopGrabMaterial;

  return { field, tabletopBase, tabletopGrabSurface };
}

function addMarking(name: string, x: number, z: number, width: number, depth: number): void {
  const marking = MeshBuilder.CreateGround(name, { width, height: depth }, scene);
  marking.parent = fieldRoot;
  marking.position.set(x, fieldPaintHeight, z);
  marking.material = lineMaterial;
}

function addYardNumber(text: string, x: number, z: number, rotation: number): void {
  const texture = new DynamicTexture(\`yard-number-\${text}-\${x}-\${z}\`, { width: 256, height: 128 }, scene, true);
  texture.hasAlpha = true;
  texture.drawText(text, null, 100, "bold 94px Georgia", "white", "transparent", true, true);
  const numberMaterial = new StandardMaterial(\`yard-number-material-\${text}-\${x}-\${z}\`, scene);
  numberMaterial.diffuseTexture = texture;
  numberMaterial.opacityTexture = texture;
  numberMaterial.emissiveTexture = texture;
  numberMaterial.disableLighting = true;

  const number = MeshBuilder.CreatePlane(\`yard-number-\${text}-\${x}-\${z}\`, { width: 0.56, height: 0.28 }, scene);
  number.parent = fieldRoot;
  number.position.set(x, fieldPaintHeight, z);
  number.rotation.set(Math.PI / 2, rotation, 0);
  number.material = numberMaterial;
}

function createFieldMarkings(): void {
  addMarking("near-sideline", 0, -fieldWidth / 2 + 0.035, fieldLength, 0.07);
  addMarking("far-sideline", 0, fieldWidth / 2 - 0.035, fieldLength, 0.07);

  for (let yard = 0; yard <= 20; yard += 1) {
    const x = -playingFieldLength / 2 + yard * playingFieldLength / 20;
    const major = yard % 2 === 0;
    addMarking(\`yard-line-\${yard}\`, x, 0, major ? 0.035 : 0.018, fieldWidth);

    for (const z of [-0.78, -0.68, 0.68, 0.78]) {
      addMarking(\`hash-\${yard}-\${z}\`, x, z, 0.13, 0.025);
    }
  }

  const values = [10, 20, 30, 40, 50, 40, 30, 20, 10];
  values.forEach((value, index) => {
    const x = -4 + index;
    addYardNumber(String(value), x, -1.72, 0);
    addYardNumber(String(value), x, 1.72, Math.PI);
  });
}

function createGoalPosts(): void {
  for (const side of [-1, 1]) {
    const root = new TransformNode(\`goalpost-\${side}\`, scene);
    root.parent = fieldRoot;
    root.position.set(side * (fieldLength / 2 + 0.35), 0, 0);

    const stem = MeshBuilder.CreateCylinder(\`goalpost-\${side}-stem\`, {
      height: 0.9,
      diameter: 0.07,
      tessellation: 16,
    }, scene);
    stem.parent = root;
    stem.position.y = 0.45;
    stem.material = goalpostMaterial;
    stem.isPickable = false;

    const crossbar = MeshBuilder.CreateCylinder(\`goalpost-\${side}-crossbar\`, {
      height: 1.55,
      diameter: 0.065,
      tessellation: 16,
    }, scene);
    crossbar.parent = root;
    crossbar.position.y = 0.9;
    crossbar.rotation.x = Math.PI / 2;
    crossbar.material = goalpostMaterial;
    crossbar.isPickable = false;

    for (const z of [-0.75, 0.75]) {
      const upright = MeshBuilder.CreateCylinder(\`goalpost-\${side}-upright-\${z}\`, {
        height: 0.85,
        diameter: 0.055,
        tessellation: 16,
      }, scene);
      upright.parent = root;
      upright.position.set(0, 1.325, z);
      upright.material = goalpostMaterial;
      upright.isPickable = false;
    }
  }
}

function createPerformer(
  name: string,
  x: number,
  z: number,
  section: PerformerSection,
  drumType: DrumType = "snare",
  instrumentType: InstrumentType = "trumpet",
): TransformNode {
  const performer = new TransformNode(name, scene);
  performer.parent = fieldRoot;
  performer.position.set(x, 0, z);

  const torsoJoint = new TransformNode(\`\${name}-torso-joint\`, scene);
  torsoJoint.parent = performer;
  torsoJoint.position.y = 0.16;
  const leftArmJoint = new TransformNode(\`\${name}-left-arm-joint\`, scene);
  leftArmJoint.parent = torsoJoint;
  leftArmJoint.position.set(-0.075, 0.14, 0);
  const rightArmJoint = new TransformNode(\`\${name}-right-arm-joint\`, scene);
  rightArmJoint.parent = torsoJoint;
  rightArmJoint.position.set(0.075, 0.14, 0);
  const leftLegJoint = new TransformNode(\`\${name}-left-leg-joint\`, scene);
  leftLegJoint.parent = performer;
  leftLegJoint.position.set(-0.027, 0.17, 0);
  const rightLegJoint = new TransformNode(\`\${name}-right-leg-joint\`, scene);
  rightLegJoint.parent = performer;
  rightLegJoint.position.set(0.027, 0.17, 0);

  for (const [side, legJoint] of [["left", leftLegJoint], ["right", rightLegJoint]] as const) {
    const legName = \`\${name}-\${side}-leg\`;
    const leg = createSharedPerformerMesh(
      "performer-leg",
      legName,
      legJoint,
      pantsMaterial,
      () => MeshBuilder.CreateBox(legName, { width: 0.038, height: 0.16, depth: 0.055 }, scene),
    );
    leg.position.y = -0.08;
  }

  for (const [side, armJoint] of [["left", leftArmJoint], ["right", rightArmJoint]] as const) {
    const armName = \`\${name}-\${side}-arm\`;
    const arm = createSharedPerformerMesh(
      "performer-arm",
      armName,
      armJoint,
      uniformMaterial,
      () => MeshBuilder.CreateBox(armName, { width: 0.032, height: 0.17, depth: 0.04 }, scene),
    );
    arm.position.y = -0.085;
  }

  const bodyName = \`\${name}-body\`;
  const body = createSharedPerformerMesh(
    "performer-body",
    bodyName,
    torsoJoint,
    uniformMaterial,
    () => MeshBuilder.CreateBox(bodyName, { width: 0.13, height: 0.25, depth: 0.09 }, scene),
  );
  body.position.y = 0.085;

  const headName = \`\${name}-head\`;
  const head = createSharedPerformerMesh(
    "performer-head",
    headName,
    torsoJoint,
    skinMaterial,
    () => MeshBuilder.CreateSphere(headName, { diameter: 0.09, segments: 6 }, scene),
  );
  head.position.y = 0.25;
  let instrument: TransformNode | null = null;
  let instrumentStyle: InstrumentStyle | null = null;
  let cymbals: [TransformNode, TransformNode] | null = null;

  if (section === "drum") {
    const drumName = \`\${name}-\${drumType}-drum\`;
    const drum = createSharedPerformerMesh(\`drum-\${drumType}\`, drumName, torsoJoint, drumMaterial, () => {
      if (drumType === "bass") return MeshBuilder.CreateCylinder(drumName, { height: 0.07, diameter: 0.2, tessellation: 16 }, scene);
      if (drumType === "tenor") return MeshBuilder.CreateBox(drumName, { width: 0.24, height: 0.075, depth: 0.16 }, scene);
      if (drumType === "auxiliary") return MeshBuilder.CreateBox(drumName, { width: 0.17, height: 0.055, depth: 0.09 }, scene);
      return MeshBuilder.CreateCylinder(drumName, { height: 0.085, diameter: 0.15, tessellation: 14 }, scene);
    });
    drum.position.set(0, drumType === "bass" ? 0.11 : 0.095, drumType === "bass" ? -0.2 : -0.165);
    if (drumType === "bass") drum.rotation.z = Math.PI / 2;
  } else if (section === "brass") {
    instrument = new TransformNode(\`\${name}-instrument-joint\`, scene);
    instrument.parent = torsoJoint;
    instrumentStyle = instrumentType === "alto-saxophone" || instrumentType === "tenor-saxophone" || instrumentType === "clarinet"
      ? "low"
      : instrumentType === "sousaphone"
        ? "shoulder"
        : instrumentType === "glockenspiel" || instrumentType === "cymbals"
          ? "mallet"
          : "mouth";

    if (instrumentType === "flute" || instrumentType === "piccolo") {
      const piccolo = instrumentType === "piccolo";
      const fluteName = \`\${name}-\${instrumentType}\`;
      const flute = createSharedPerformerMesh(instrumentType, fluteName, instrument, drumMaterial, () => (
        MeshBuilder.CreateCylinder(fluteName, { height: piccolo ? 0.13 : 0.19, diameter: piccolo ? 0.013 : 0.016, tessellation: 8 }, scene)
      ));
      flute.position.set(piccolo ? 0.02 : 0.035, 0, -0.045);
      flute.rotation.z = Math.PI / 2;
    } else if (instrumentType === "clarinet") {
      const clarinetName = \`\${name}-clarinet\`;
      const clarinet = createSharedPerformerMesh("clarinet", clarinetName, instrument, shoeMaterial, () => (
        MeshBuilder.CreateCylinder(clarinetName, { height: 0.25, diameterTop: 0.014, diameterBottom: 0.032, tessellation: 8 }, scene)
      ));
      clarinet.position.set(0, -0.105, -0.055);
      clarinet.rotation.x = -0.25;
    } else if (instrumentType === "alto-saxophone" || instrumentType === "tenor-saxophone") {
      const tenor = instrumentType === "tenor-saxophone";
      const saxName = \`\${name}-\${instrumentType}\`;
      const body = createSharedPerformerMesh(instrumentType, saxName, instrument, brassMaterial, () => (
        MeshBuilder.CreateCylinder(saxName, {
          height: tenor ? 0.27 : 0.22,
          diameterTop: tenor ? 0.03 : 0.025,
          diameterBottom: tenor ? 0.075 : 0.065,
          tessellation: 10,
        }, scene)
      ));
      body.position.set(0.025, tenor ? -0.13 : -0.105, -0.06);
      body.rotation.z = -0.18;
    } else if (instrumentType === "sousaphone") {
      const sousaphoneName = \`\${name}-sousaphone\`;
      const wrap = createSharedPerformerMesh("sousaphone", sousaphoneName, instrument, brassMaterial, () => (
        MeshBuilder.CreateTorus(sousaphoneName, { diameter: 0.3, thickness: 0.035, tessellation: 16 }, scene)
      ));
      wrap.position.set(0.055, 0.09, -0.075);
      wrap.rotation.x = Math.PI / 2;
    } else if (instrumentType === "glockenspiel") {
      const glockName = \`\${name}-glockenspiel\`;
      const frame = createSharedPerformerMesh("glockenspiel", glockName, instrument, drumMaterial, () => (
        MeshBuilder.CreateBox(glockName, { width: 0.22, height: 0.03, depth: 0.14 }, scene)
      ));
      frame.position.set(0, 0, -0.14);
    } else if (instrumentType === "cymbals") {
      const cymbalsName = \`\${name}-cymbals\`;
      createMergedPerformerMesh("cymbals", cymbalsName, instrument, brassMaterial, () => (
        [-0.055, 0.055].map(offsetX => {
          const cymbal = MeshBuilder.CreateCylinder(\`\${cymbalsName}-\${offsetX}\`, { height: 0.012, diameter: 0.16, tessellation: 14 }, scene);
          cymbal.position.x = offsetX;
          cymbal.rotation.z = Math.PI / 2;
          return cymbal;
        })
      ));
    } else if (instrumentType === "trombone") {
      const tromboneName = \`\${name}-trombone\`;
      createMergedPerformerMesh("trombone", tromboneName, instrument, brassMaterial, () => {
        const slide = MeshBuilder.CreateBox(\`\${tromboneName}-slide\`, { width: 0.055, height: 0.012, depth: 0.5 }, scene);
        slide.position.z = -0.27;
        const bell = MeshBuilder.CreateCylinder(\`\${tromboneName}-bell\`, { height: 0.1, diameterTop: 0.025, diameterBottom: 0.095, tessellation: 10 }, scene);
        bell.position.set(0, 0.055, -0.23);
        bell.rotation.x = Math.PI / 2;
        return [slide, bell];
      });
    } else {
      const flugelhorn = instrumentType === "flugelhorn";
      const lowBrass = instrumentType === "baritone";
      const mellophone = instrumentType === "mellophone";
      const hornName = \`\${name}-\${instrumentType}\`;
      const horn = createSharedPerformerMesh(
        instrumentType,
        hornName,
        instrument,
        brassMaterial,
        () => MeshBuilder.CreateCylinder(hornName, {
          height: lowBrass ? 0.25 : flugelhorn ? 0.19 : 0.22,
          diameterTop: lowBrass ? 0.045 : flugelhorn ? 0.04 : 0.025,
          diameterBottom: lowBrass ? 0.115 : mellophone ? 0.1 : flugelhorn ? 0.09 : 0.075,
          tessellation: 12,
        }, scene),
      );
      horn.position.set(0, lowBrass ? -0.025 : 0, lowBrass ? -0.125 : flugelhorn ? -0.095 : -0.11);
      horn.rotation.x = Math.PI / 2;
    }
  } else if (section === "drum-major") {
    const baton = MeshBuilder.CreateCylinder(\`\${name}-baton\`, { height: 0.42, diameter: 0.012, tessellation: 10 }, scene);
    baton.parent = rightArmJoint;
    baton.position.set(0, -0.28, 0);
    baton.material = brassMaterial;
    const batonHead = MeshBuilder.CreateSphere(\`\${name}-baton-head\`, { diameter: 0.045, segments: 8 }, scene);
    batonHead.parent = rightArmJoint;
    batonHead.position.set(0, -0.49, 0);
    batonHead.material = uniformTrimMaterial;
  } else if (section === "guard") {
    const pole = MeshBuilder.CreateCylinder(\`\${name}-flag-pole\`, { height: 0.48, diameter: 0.012, tessellation: 8 }, scene);
    pole.parent = torsoJoint;
    pole.position.set(0.1, 0.13, 0);
    pole.material = brassMaterial;

    const flag = MeshBuilder.CreatePlane(\`\${name}-flag\`, { width: 0.17, height: 0.34, sideOrientation: Mesh.DOUBLESIDE }, scene);
    flag.parent = torsoJoint;
    flag.position.set(0.22, 0.22, 0);
    flag.rotation.y = Math.PI / 2;
    flag.material = endZoneMaterial;
  }

  const rig: PerformerRig = {
    torso: torsoJoint,
    leftArm: leftArmJoint,
    rightArm: rightArmJoint,
    leftLeg: leftLegJoint,
    rightLeg: rightLegJoint,
    instrument,
    instrumentStyle,
    instrumentPose: 0,
    cymbals,
    armStyle: section === "drum" ? "drum" : section === "guard" || section === "drum-major" ? "guard" : instrumentType === "cymbals" ? "cymbals" : instrumentStyle ?? "mouth",
    instrumentType: section === "brass" ? instrumentType : null,
  };
  performer.metadata = { baseX: x, baseZ: z, phase: (x + z) * 2.1, rig };
  return performer;
}

function createBand(): TransformNode[] {
  const performers: TransformNode[] = [];
  const instrumentSections: InstrumentType[][] = [
    [],
    ["piccolo", "flute", "flute", "flute", "clarinet", "clarinet", "clarinet", "alto-saxophone", "alto-saxophone", "tenor-saxophone", "tenor-saxophone"],
    ["trumpet", "trumpet", "trumpet", "trumpet", "mellophone", "mellophone", "flugelhorn", "flugelhorn", "trombone", "trombone", "baritone"],
    [],
    ["trombone", "trombone", "baritone", "baritone", "alto-saxophone", "tenor-saxophone", "mellophone", "sousaphone", "sousaphone", "sousaphone", "sousaphone"],
    ["glockenspiel", "glockenspiel", "glockenspiel", "glockenspiel", "cymbals", "cymbals", "cymbals", "trumpet", "trumpet", "flugelhorn", "flugelhorn"],
    [],
  ];
  for (let rank = 0; rank < 7; rank += 1) {
    for (let file = 0; file < 11; file += 1) {
      const x = (file - 5) * formationInterval;
      const z = (rank - 3) * rankInterval;
      const section = rank === 3 ? "drum" : rank === 0 || rank === 6 ? "guard" : "brass";
      const drumType: DrumType = file < 3 ? "bass" : file < 6 ? "snare" : file < 10 ? "tenor" : "auxiliary";
      const instrumentType = instrumentSections[rank][file] ?? "trumpet";
      performers.push(createPerformer(\`performer-\${rank}-\${file}\`, x, z, section, drumType, instrumentType));
    }
  }

  performers.push(createPerformer("drum-major-near", 0, -3, "drum-major"));
  performers.push(createPerformer("drum-major-far", 0, 3, "drum-major"));
  return performers;
}

function createStands(): void {
  for (const side of [-1, 1]) {
    for (let row = 0; row < 4; row += 1) {
      const stand = MeshBuilder.CreateBox(\`stand-\${side}-\${row}\`, {
        width: 8.5,
        height: 0.12,
        depth: 0.3,
      }, scene);
      stand.parent = fieldRoot;
      stand.position.set(0, 0.08 + row * 0.13, side * (fieldWidth / 2 + 0.45 + row * 0.2));
      stand.material = standMaterial;
    }
  }
}

type ScoreboardPosition = "north-side" | "east-end" | "south-side" | "west-end";

function configureScoreboardTexture(texture: DynamicTexture): void {
  texture.vScale = -1;
  texture.vOffset = 1;
  texture.anisotropicFilteringLevel = 16;
  texture.updateSamplingMode(Texture.TRILINEAR_SAMPLINGMODE);
}

function createScoreboard(): DynamicTexture {
  const scoreboardX = fieldLength / 2 + endZoneDepth + 0.75;
  const scoreboardSideZ = fieldWidth / 2 + 1.35;
  const scoreboardRoot = new TransformNode("scoreboard-root", scene);
  scoreboardRoot.parent = fieldRoot;
  let scoreboardPosition: ScoreboardPosition = "east-end";
  const positionIndicators = new Map<ScoreboardPosition, Mesh>();

  function positionScoreboard(position: ScoreboardPosition): void {
    scoreboardPosition = position;
    switch (position) {
      case "north-side":
        scoreboardRoot.position.set(0, 0.75, scoreboardSideZ);
        scoreboardRoot.rotation.setAll(0);
        break;
      case "east-end":
        scoreboardRoot.position.set(scoreboardX, 0, 0);
        scoreboardRoot.rotation.set(0, Math.PI / 2, 0);
        break;
      case "south-side":
        scoreboardRoot.position.set(0, 0.75, -scoreboardSideZ);
        scoreboardRoot.rotation.set(0, Math.PI, 0);
        break;
      case "west-end":
        scoreboardRoot.position.set(-scoreboardX, 0, 0);
        scoreboardRoot.rotation.set(0, -Math.PI / 2, 0);
        break;
    }
    for (const [indicatorPosition, indicator] of positionIndicators) {
      indicator.material = indicatorPosition === position ? scoreboardRadioActiveMaterial : scoreboardRadioInactiveMaterial;
    }
  }

  const frameRails = [
    { name: "top", width: 3.6, height: 0.125, x: 0, y: 2.0625 },
    { name: "bottom", width: 3.6, height: 0.125, x: 0, y: 0.4375 },
    { name: "left", width: 0.125, height: 1.5, x: -1.7375, y: 1.25 },
    { name: "right", width: 0.125, height: 1.5, x: 1.7375, y: 1.25 },
  ];
  for (const rail of frameRails) {
    const frame = MeshBuilder.CreateBox(\`scoreboard-frame-\${rail.name}\`, {
      width: rail.width,
      height: rail.height,
      depth: 0.12,
    }, scene);
    frame.parent = scoreboardRoot;
    frame.position.set(rail.x, rail.y, 0);
    frame.material = scoreboardFrameMaterial;
  }

  for (const x of [-1.45, 1.45]) {
    const post = MeshBuilder.CreateBox(\`scoreboard-post-\${x}\`, { width: 0.12, height: 1.45, depth: 0.12 }, scene);
    post.parent = scoreboardRoot;
    post.position.set(x, 0.55, 0);
    post.material = scoreboardFrameMaterial;
  }

  const texture = new DynamicTexture("scoreboard-display", { width: 2048, height: 1024 }, scene, true);
  configureScoreboardTexture(texture);
  const screenMaterial = new StandardMaterial("scoreboard-display-material", scene);
  screenMaterial.diffuseTexture = texture;
  screenMaterial.emissiveTexture = texture;
  screenMaterial.disableLighting = true;
  screenMaterial.backFaceCulling = false;

  const screen = MeshBuilder.CreatePlane("scoreboard-display", { width: 3.35, height: 1.5 }, scene);
  screen.parent = scoreboardRoot;
  screen.position.set(0, 1.25, -0.065);
  screen.material = screenMaterial;

  function drawControlLabel(context: CanvasRenderingContext2D, label: string, stop: boolean): void {
    context.fillStyle = stop ? "#8f1f2a" : "#143c2a";
    context.fillRect(0, 0, 256, 96);
    context.strokeStyle = "#f3d35b";
    context.lineWidth = 6;
    context.strokeRect(3, 3, 250, 90);
    context.fillStyle = "#f5f0df";
    context.font = "bold 42px Georgia";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 128, 50);
  }

  const controls = [
    { label: "LOAD", x: -1.32, action: () => {
      midiFileInput.value = "";
      midiFileInput.click();
    } },
    { label: "-10", x: -0.66, action: () => seekPlayback(-10) },
    { label: "PLAY", x: 0, action: () => void togglePlayback() },
    { label: "STOP", x: 0.66, action: () => stopPlayback() },
    { label: "+10", x: 1.32, action: () => seekPlayback(10) },
  ];
  for (const control of controls) {
    const button = MeshBuilder.CreateBox(\`scoreboard-\${control.label}-button\`, {
      width: 0.58,
      height: 0.28,
      depth: 0.12,
    }, scene);
    button.parent = scoreboardRoot;
    button.position.set(control.x, 0.24, 0);
    button.material = scoreboardFrameMaterial;
    button.actionManager = new ActionManager(scene);
    button.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, control.action));

    const labelTexture = new DynamicTexture(\`scoreboard-\${control.label}-texture\`, { width: 512, height: 192 }, scene, true);
    configureScoreboardTexture(labelTexture);
    const labelContext = labelTexture.getContext() as unknown as CanvasRenderingContext2D;
    labelContext.setTransform(2, 0, 0, 2, 0, 0);
    drawControlLabel(labelContext, control.label, control.label === "STOP");
    labelTexture.update(false);

    const labelMaterial = new StandardMaterial(\`scoreboard-\${control.label}-material\`, scene);
    labelMaterial.diffuseTexture = labelTexture;
    labelMaterial.emissiveTexture = labelTexture;
    labelMaterial.disableLighting = true;
    labelMaterial.backFaceCulling = false;
    const label = MeshBuilder.CreatePlane(\`scoreboard-\${control.label}-label\`, { width: 0.52, height: 0.22 }, scene);
    label.parent = scoreboardRoot;
    label.position.set(control.x, 0.24, -0.065);
    label.material = labelMaterial;
    label.actionManager = button.actionManager;
  }

  const scoreboardRadioActiveMaterial = new StandardMaterial("scoreboard-radio-active-material", scene);
  scoreboardRadioActiveMaterial.diffuseColor = Color3.FromHexString("#f3d35b");
  scoreboardRadioActiveMaterial.emissiveColor = Color3.FromHexString("#b88a16");
  const scoreboardRadioInactiveMaterial = new StandardMaterial("scoreboard-radio-inactive-material", scene);
  scoreboardRadioInactiveMaterial.diffuseColor = Color3.FromHexString("#143c2a");
  const positionControls: Array<{ position: ScoreboardPosition; x: number; y: number }> = [
    { position: "west-end", x: -0.42, y: 0.56 },
    { position: "north-side", x: -0.14, y: 0.56 },
    { position: "south-side", x: 0.14, y: 0.56 },
    { position: "east-end", x: 0.42, y: 0.56 },
  ];
  for (const control of positionControls) {
    const button = MeshBuilder.CreateCylinder(\`scoreboard-\${control.position}-radio\`, {
      diameter: 0.25,
      height: 0.1,
      tessellation: 32,
    }, scene);
    button.parent = scoreboardRoot;
    button.position.set(control.x, control.y, -0.11);
    button.rotation.x = Math.PI / 2;
    button.material = scoreboardFrameMaterial;
    button.actionManager = new ActionManager(scene);
    button.actionManager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
      positionScoreboard(control.position);
    }));

    const indicator = MeshBuilder.CreateCylinder(\`scoreboard-\${control.position}-indicator\`, {
      diameter: 0.12,
      height: 0.015,
      tessellation: 32,
    }, scene);
    indicator.parent = scoreboardRoot;
    indicator.position.set(control.x, control.y, -0.17);
    indicator.rotation.x = Math.PI / 2;
    indicator.actionManager = button.actionManager;
    positionIndicators.set(control.position, indicator);
  }
  positionScoreboard(scoreboardPosition);
  return texture;
}

const { field, tabletopBase, tabletopGrabSurface } = createField();
createFieldMarkings();
createGoalPosts();
createStands();
const performers = createBand();
const nativePerformerCount = performers.length;
const scoreboardTexture = createScoreboard();
const tabletopDragBehavior = new SixDofDragBehavior();
tabletopDragBehavior.allowMultiPointer = true;
tabletopDragBehavior.dragDeltaRatio = 1;
tabletopDragBehavior.rotateDraggedObject = false;
tabletopDragBehavior.rotateWithMotionController = false;
tabletopDragBehavior.zDragFactor = 0;
tabletopDragBehavior.draggableMeshes = [tabletopBase, tabletopGrabSurface];
let tabletopDragAttached = false;
const minimumTabletopScale = tabletopScale * 0.5;
const maximumTabletopScale = tabletopScale * 2;

function lockTabletopLevel(): void {
  fieldRoot.rotationQuaternion ??= Quaternion.FromEulerAngles(0, fieldRoot.rotation.y, 0);
  const yaw = fieldRoot.rotationQuaternion.toEulerAngles().y;
  Quaternion.FromEulerAnglesToRef(0, yaw, 0, fieldRoot.rotationQuaternion);
  fieldRoot.rotation.setAll(0);
  const scale = Math.min(maximumTabletopScale, Math.max(minimumTabletopScale, fieldRoot.scaling.x));
  fieldRoot.scaling.setAll(scale);
}

tabletopDragBehavior.onDragObservable.add(lockTabletopLevel);
tabletopDragBehavior.onDragEndObservable.add(lockTabletopLevel);

const transport = getTransport();
const synth = new PolySynth(Synth).toDestination();
synth.maxPolyphony = 32;
const musicRepeatCount = 2;
let loadedMidi: Midi | null = null;
let loadedMidiName = "No MIDI loaded";
let drillTitle = "No drill loaded";
let drillCues: TimedDrillCue[] = [];
let calChartDrill: PreparedCalChartDrill | null = null;
let lastScoreboardContent = "";

function setActivePerformerCount(count: number, labels?: string[]): void {
  while (performers.length < count) {
    performers.push(createPerformer(\`calchart-performer-\${performers.length + 1}\`, 0, 0, "brass"));
  }
  performers.forEach((performer, index) => {
    performer.setEnabled(index < count);
    performer.scaling.setAll(physicalPerformerScale);
    const metadata = performer.metadata as { drillLabel?: string };
    metadata.drillLabel = labels?.[index];
  });
  canvas.dataset.performerCount = String(count);
}

function tickForMeasure(midi: Midi, measure: number): number {
  const target = Math.max(0, measure - 1);
  let low = 0;
  let high = midi.durationTicks * musicRepeatCount;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (midi.header.ticksToMeasures(middle) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function minimumCostAssignment(costs: number[][]): number[] {
  const size = costs.length;
  const rowPotential = new Array<number>(size + 1).fill(0);
  const columnPotential = new Array<number>(size + 1).fill(0);
  const matchedRow = new Array<number>(size + 1).fill(0);
  const previousColumn = new Array<number>(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    matchedRow[0] = row;
    let column = 0;
    const minimum = new Array<number>(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array<boolean>(size + 1).fill(false);
    do {
      used[column] = true;
      const activeRow = matchedRow[column];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= size; candidate += 1) {
        if (used[candidate]) continue;
        const reducedCost = costs[activeRow - 1][candidate - 1]
          - rowPotential[activeRow]
          - columnPotential[candidate];
        if (reducedCost < minimum[candidate]) {
          minimum[candidate] = reducedCost;
          previousColumn[candidate] = column;
        }
        if (minimum[candidate] < delta) {
          delta = minimum[candidate];
          nextColumn = candidate;
        }
      }
      for (let candidate = 0; candidate <= size; candidate += 1) {
        if (used[candidate]) {
          rowPotential[matchedRow[candidate]] += delta;
          columnPotential[candidate] -= delta;
        } else {
          minimum[candidate] -= delta;
        }
      }
      column = nextColumn;
    } while (matchedRow[column] !== 0);
    do {
      const priorColumn = previousColumn[column];
      matchedRow[column] = matchedRow[priorColumn];
      column = priorColumn;
    } while (column !== 0);
  }
  const assignment = new Array<number>(size);
  for (let column = 1; column <= size; column += 1) assignment[matchedRow[column] - 1] = column - 1;
  return assignment;
}

interface MarcherSquad {
  start: number;
  size: 4 | 5;
}

const marcherSquads: MarcherSquad[] = [
  ...Array.from({ length: 13 }, (_, index) => ({ start: index * 5, size: 5 as const })),
  ...Array.from({ length: 3 }, (_, index) => ({ start: 65 + index * 4, size: 4 as const })),
];

function squadLineCost(
  from: Vector3[],
  sourceSquad: MarcherSquad,
  destinations: Vector3[],
  destinationSquad: MarcherSquad,
  reverse: boolean,
): number {
  let cost = 0;
  for (let member = 0; member < sourceSquad.size; member += 1) {
    const destinationMember = reverse ? sourceSquad.size - member - 1 : member;
    cost += Vector3.DistanceSquared(
      from[sourceSquad.start + member],
      destinations[destinationSquad.start + destinationMember],
    );
  }
  return cost;
}

function assignFormationSlots(from: Vector3[], destinations: Vector3[]): Vector3[] {
  const assigned = destinations.map(position => position.clone());
  for (const squadSize of [5, 4] as const) {
    const squads = marcherSquads.filter(squad => squad.size === squadSize);
    const costs = squads.map(sourceSquad => squads.map(destinationSquad => Math.min(
      squadLineCost(from, sourceSquad, destinations, destinationSquad, false),
      squadLineCost(from, sourceSquad, destinations, destinationSquad, true),
    )));
    const squadAssignment = minimumCostAssignment(costs);
    for (let squadIndex = 0; squadIndex < squads.length; squadIndex += 1) {
      const sourceSquad = squads[squadIndex];
      const destinationSquad = squads[squadAssignment[squadIndex]];
      const forwardCost = squadLineCost(from, sourceSquad, destinations, destinationSquad, false);
      const reverseCost = squadLineCost(from, sourceSquad, destinations, destinationSquad, true);
      const reverse = reverseCost < forwardCost;
      for (let member = 0; member < squadSize; member += 1) {
        const destinationMember = reverse ? squadSize - member - 1 : member;
        assigned[sourceSquad.start + member] = destinations[destinationSquad.start + destinationMember].clone();
      }
    }
  }
  return assigned;
}

function prepareDrill(file: DrillCueFile): void {
  if (!loadedMidi) throw new Error("Load a MIDI file before loading drill cues");
  calChartDrill = null;
  setActivePerformerCount(nativePerformerCount);
  const midi = loadedMidi;
  drillTitle = file.title;
  const timedCues = file.cues
    .map(cue => {
      const tick = tickForMeasure(midi, cue.measure);
      const transitionEnd = tickForMeasure(midi, cue.measure + cue.transitionMeasures);
      return { ...cue, tick, transitionTicks: Math.max(0, transitionEnd - tick) };
    })
    .sort((left, right) => left.tick - right.tick);
  let priorPositions = formationPositions("block", nativePerformerCount, 180);
  let priorFacing = facingAngle(180);
  drillCues = timedCues.map(cue => {
    const formationSlots = formationPositions(cue.formation, nativePerformerCount, cue.readingDirection);
    const positions = assignFormationSlots(priorPositions, formationSlots);
    const transition = cue.transition ?? "direct";
    let pathPositions: Vector3[][];
    try {
      pathPositions = precalculateCollisionSafePath(
        priorPositions,
        positions,
        cue.transitionTicks,
        midi.header.ppq,
        transition,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown collision";
      throw new Error(\`\${cue.label}: \${message}\`);
    }
    const pathProgress = precalculatePathProgress(pathPositions);
    const footsteps = precalculateFootsteps(pathPositions, pathProgress, cue.transitionTicks, midi.header.ppq);
    const targetFacingAngle = facingAngle(cue.facing ?? 180);
    const plannedCue: TimedDrillCue = {
      ...cue,
      fromPositions: priorPositions.map(position => position.clone()),
      positions,
      pathPositions,
      pathProgress,
      footsteps,
      fromFacingAngle: priorFacing,
      facingAngle: targetFacingAngle,
    };
    priorPositions = positions;
    priorFacing = targetFacingAngle;
    return plannedCue;
  });
}

function scheduleMidi(midi: Midi): void {
  transport.stop();
  transport.cancel(0);
  synth.releaseAll();
  transport.seconds = 0;
  for (let repeat = 0; repeat < musicRepeatCount; repeat += 1) {
    for (const track of midi.tracks) {
      for (const note of track.notes) {
        transport.schedule(time => {
          synth.triggerAttackRelease(note.name, Math.max(0.03, note.duration), time, note.velocity);
        }, note.time + repeat * midi.duration);
      }
    }
  }
  transport.schedule(() => {
    transport.pause();
    synth.releaseAll();
  }, midi.duration * musicRepeatCount);
}

async function loadMidiData(data: ArrayBuffer, name: string): Promise<void> {
  const midi = new Midi(data);
  if (midi.tracks.every(track => track.notes.length === 0)) throw new Error("The MIDI file contains no notes");
  loadedMidi = midi;
  loadedMidiName = midi.name && midi.name !== "control track" ? midi.name : name.replace(/\\.midi?$/i, "");
  scheduleMidi(midi);
  drillCues = [];
  calChartDrill = null;
  setActivePerformerCount(nativePerformerCount);
  drillTitle = "No drill loaded";
  musicPositionInput.value = "0";
  musicPositionInput.disabled = false;
  playButton.disabled = false;
  stopButton.disabled = false;
  playButton.textContent = "Play";
  setStatus(\`Loaded \${loadedMidiName}: \${midi.tracks.length} tracks, \${musicRepeatCount} passes, \${Math.ceil(midi.duration * musicRepeatCount)} seconds\`);
}

async function loadDrillData(data: DrillCueFile): Promise<void> {
  prepareDrill(data);
  setStatus(\`Loaded \${drillTitle}: \${drillCues.length} synchronized sets\`);
}

function finiteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(\`CalChart viewer \${field} must be a finite number\`);
  return value;
}

function validateCalChartMovement(command: CalChartMovement, context: string): void {
  const beats = finiteNumber(command.beats, \`\${context} beats\`);
  if (beats < 0) throw new Error(\`CalChart viewer \${context} beats cannot be negative\`);
  if (command.type === "even") {
    for (const field of ["x1", "y1", "x2", "y2", "facing"] as const) finiteNumber(command[field], \`\${context} \${field}\`);
  } else if (command.type === "arc") {
    for (const field of ["start_x", "start_y", "center_x", "center_y", "angle"] as const) finiteNumber(command[field], \`\${context} \${field}\`);
    if (command.facing_offset !== undefined) finiteNumber(command.facing_offset, \`\${context} facing_offset\`);
  } else {
    for (const field of ["x", "y", "facing"] as const) finiteNumber(command[field], \`\${context} \${field}\`);
  }
}

function prepareCalChartViewer(data: unknown): void {
  if (!loadedMidi) throw new Error("Load a MIDI file before loading a CalChart viewer drill");
  if (!data || typeof data !== "object") throw new Error("Invalid CalChart viewer file");
  const file = data as Partial<CalChartViewerFile>;
  if (file.meta?.type !== "viewer" || !file.show || !Array.isArray(file.show.labels) || !Array.isArray(file.show.sheets)) {
    throw new Error("This is not a compiled CalChart .viewer file; export the .shw show with CalChart's Online Viewer export");
  }
  if (file.show.labels.length === 0) throw new Error("CalChart viewer file has no marcher labels");
  if (file.show.sheets.length === 0) throw new Error("CalChart viewer file has no sheets");
  const labels = file.show.labels.map((label, index) => {
    if (typeof label !== "string" || !label) throw new Error(\`CalChart marcher label \${index + 1} is invalid\`);
    return label;
  });
  let startBeat = 0;
  const sheets = file.show.sheets.map((sheet, sheetIndex): PreparedCalChartSheet => {
    if (!sheet || typeof sheet !== "object" || !sheet.movements || typeof sheet.movements !== "object") {
      throw new Error(\`CalChart sheet \${sheetIndex + 1} has no compiled movements\`);
    }
    const beats = finiteNumber(sheet.beats, \`sheet \${sheetIndex + 1} beats\`);
    if (beats < 0) throw new Error(\`CalChart sheet \${sheetIndex + 1} beats cannot be negative\`);
    for (const label of labels) {
      const commands = sheet.movements[label];
      if (!Array.isArray(commands) || commands.length === 0) throw new Error(\`CalChart sheet \${sheetIndex + 1} has no movement for \${label}\`);
      let commandBeats = 0;
      for (const [commandIndex, command] of commands.entries()) {
        if (!command || !["even", "arc", "mark", "stand", "close"].includes(command.type)) {
          throw new Error(\`Unsupported CalChart movement for \${label} on sheet \${sheetIndex + 1}, command \${commandIndex + 1}\`);
        }
        validateCalChartMovement(command, \`\${label} sheet \${sheetIndex + 1} command \${commandIndex + 1}\`);
        commandBeats += command.beats;
      }
      if (Math.abs(commandBeats - beats) > 1e-6) {
        throw new Error(\`CalChart movements for \${label} total \${commandBeats} beats, expected \${beats}\`);
      }
    }
    const prepared = { ...sheet, beats, startBeat } as PreparedCalChartSheet;
    startBeat += beats;
    return prepared;
  });
  const title = file.show.title && !file.show.title.startsWith("(MANUAL)")
    ? file.show.title
    : file.meta.index_name && !file.meta.index_name.startsWith("(MANUAL)")
      ? file.meta.index_name
      : "CalChart drill";
  calChartDrill = { labels, sheets, title };
  drillCues = [];
  drillTitle = title;
  setActivePerformerCount(labels.length, labels);
  transport.pause();
  transport.seconds = 0;
  synth.releaseAll();
  musicPositionInput.value = "0";
  playButton.textContent = "Play";
  setStatus(\`Loaded \${title}: \${labels.length} marchers, \${sheets.length} sheets\`);
}

function prepareCalChartShw(data: ArrayBuffer, fileName: string): void {
  const parsed = parseCalChartShw(data);
  const title = fileName.replace(/\\.shw$/i, "");
  const labels = performanceTestPerformerCount
    ? parsed.labels.slice(0, performanceTestPerformerCount)
    : parsed.labels;
  const sheets: CalChartViewerFile["show"]["sheets"] = parsed.sheets.map((sheet, sheetIndex) => {
    const movements = Object.fromEntries(labels.map((label, marcherIndex) => {
      return [label, compileCalChartShwMovements(parsed, sheetIndex, marcherIndex)];
    }));
    return { label: sheet.label, beats: sheet.beats, field_type: "college", movements };
  });
  prepareCalChartViewer({
    meta: { type: "viewer", version: parsed.version, index_name: title },
    show: { title, labels, sheets },
  });
  setStatus(\`Loaded \${title}: \${labels.length} marchers, \${parsed.sheets.length} sheets, authored continuity paths\`);
}

function isCalChartViewerFile(data: unknown): data is CalChartViewerFile {
  return Boolean(data && typeof data === "object" && (data as Partial<CalChartViewerFile>).meta?.type === "viewer");
}

function loadDrillFile(data: unknown): void {
  if (isCalChartViewerFile(data)) prepareCalChartViewer(data);
  else void loadDrillData(data as DrillCueFile);
}

const alphabetGlyphs: Record<AlphabetLetter, string[]> = {
  a: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  b: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  c: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  d: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  e: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  f: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  g: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  h: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  i: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  j: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  k: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  l: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  m: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  n: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  o: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  p: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  r: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  s: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  t: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  u: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  v: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
  w: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  x: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

function samplePolyline(points: Vector3[], count: number, closed: boolean): Vector3[] {
  const vertices = closed ? [...points, points[0]] : points;
  const cumulative = [0];
  for (let index = 1; index < vertices.length; index += 1) {
    cumulative.push(cumulative[index - 1] + Vector3.Distance(vertices[index - 1], vertices[index]));
  }
  const total = cumulative[cumulative.length - 1];
  return Array.from({ length: count }, (_, sampleIndex) => {
    const distance = total * sampleIndex / (closed ? count : Math.max(1, count - 1));
    let segment = 0;
    while (segment < cumulative.length - 2 && cumulative[segment + 1] < distance) segment += 1;
    const length = cumulative[segment + 1] - cumulative[segment];
    return Vector3.Lerp(vertices[segment], vertices[segment + 1], length > 0 ? (distance - cumulative[segment]) / length : 0);
  });
}

function alphabetPositions(letter: AlphabetLetter, count: number): Vector3[] {
  const cells = alphabetGlyphs[letter].flatMap((row, rowIndex) => (
    [...row].flatMap((filled, columnIndex) => filled === "1" ? [{ row: rowIndex, column: columnIndex }] : [])
  ));
  return Array.from({ length: count }, (_, index) => {
    const cellIndex = Math.floor(index * cells.length / count);
    const firstInCell = Math.ceil(cellIndex * count / cells.length);
    const slot = index - firstInCell;
    const cell = cells[cellIndex];
    return new Vector3(
      (2 - cell.column) * 0.7 - (slot % 3 - 1) * 0.19,
      0,
      (3 - cell.row) * 0.58 - (Math.floor(slot / 3) - 1) * 0.19,
    );
  });
}

function formationPositions(name: FormationName, count: number, readingDirection: number): Vector3[] {
  if (!Number.isFinite(readingDirection)) throw new Error("Drill readingDirection must be a finite heading in degrees");
  const fieldPerformerCount = Math.min(77, count);
  let fieldPositions: Vector3[];
  if (name.startsWith("letter-")) {
    fieldPositions = alphabetPositions(name.slice(7) as AlphabetLetter, fieldPerformerCount);
  } else {
    switch (name) {
      case "box":
        fieldPositions = samplePolyline([
          new Vector3(-3.55, 0, -2.25), new Vector3(3.55, 0, -2.25),
          new Vector3(3.55, 0, 2.25), new Vector3(-3.55, 0, 2.25),
        ], fieldPerformerCount, true);
        break;
      case "triangle":
        fieldPositions = samplePolyline([
          new Vector3(0, 0, -2.4), new Vector3(3.8, 0, 2.2), new Vector3(-3.8, 0, 2.2),
        ], fieldPerformerCount, true);
        break;
      case "star":
        fieldPositions = samplePolyline(Array.from({ length: 10 }, (_, vertex) => {
          const angle = vertex * Math.PI / 5 - Math.PI / 2;
          const radius = vertex % 2 === 0 ? 1 : 0.46;
          return new Vector3(Math.cos(angle) * radius * 3.25, 0, Math.sin(angle) * radius * 2.35);
        }), fieldPerformerCount, true);
        break;
      case "spiral":
        fieldPositions = samplePolyline(Array.from({ length: 180 }, (_, vertex) => {
          const angle = vertex / 179 * Math.PI * 4;
          const radius = 0.35 + angle * 0.18;
          return new Vector3(Math.cos(angle) * radius * 1.25, 0, Math.sin(angle) * radius * 0.88);
        }), fieldPerformerCount, false);
        break;
      case "circle":
        fieldPositions = samplePolyline(Array.from({ length: 48 }, (_, vertex) => {
          const angle = vertex * Math.PI * 2 / 48;
          return new Vector3(Math.cos(angle) * 3.05, 0, Math.sin(angle) * 2.35);
        }), fieldPerformerCount, true);
        break;
      case "zigzag":
        fieldPositions = samplePolyline(Array.from({ length: 9 }, (_, vertex) => (
          new Vector3(-4.2 + vertex * 1.05, 0, vertex % 2 === 0 ? -2.05 : 2.05)
        )), fieldPerformerCount, false);
        break;
      default:
        fieldPositions = Array.from({ length: fieldPerformerCount }, (_, index) => {
          const rank = Math.floor(index / 11);
          const file = index % 11;
          return new Vector3((file - 5) * formationInterval, 0, (rank - 3) * rankInterval);
        });
    }
  }
  const readingAngle = (readingDirection - 180) * Math.PI / 180;
  const cosine = Math.cos(readingAngle);
  const sine = Math.sin(readingAngle);
  return Array.from({ length: count }, (_, index) => {
    if (index >= fieldPerformerCount) return new Vector3(0, 0, index === 77 ? -3 : 3);
    const position = fieldPositions[index];
    return new Vector3(
      position.x * cosine - position.z * sine,
      position.y,
      position.x * sine + position.z * cosine,
    );
  });
}

const minimumSweptClearance = 0.13;

function precalculateCollisionSafePath(
  from: Vector3[],
  to: Vector3[],
  transitionTicks: number,
  ppq: number,
  transition: TransitionType,
): Vector3[][] {
  if (transitionTicks <= 0) return [to.map(position => position.clone())];
  const sampleCount = Math.max(2, Math.ceil(transitionTicks / ppq * 8) + 1);
  const path = Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const progress = sampleIndex / (sampleCount - 1);
    return from.map((position, performerIndex) => {
      const destination = to[performerIndex];
      if (performerIndex >= 77) return Vector3.Lerp(position, destination, progress);
      switch (transition) {
        case "arc-left":
        case "arc-right": {
          const travel = destination.subtract(position);
          const distance = travel.length();
          if (distance < 1e-8) return position.clone();
          const side = transition === "arc-left" ? 1 : -1;
          const perpendicular = new Vector3(-travel.z, 0, travel.x).scale(side / distance);
          const sagitta = Math.min(0.65, distance * 0.28);
          const radius = distance * distance / (8 * sagitta) + sagitta / 2;
          const center = Vector3.Lerp(position, destination, 0.5).addInPlace(
            perpendicular.scale(sagitta - radius),
          );
          const fromAngle = Math.atan2(position.z - center.z, position.x - center.x);
          const toAngle = Math.atan2(destination.z - center.z, destination.x - center.x);
          const angle = interpolateAngle(fromAngle, toAngle, progress);
          return new Vector3(center.x + Math.cos(angle) * radius, 0, center.z + Math.sin(angle) * radius);
        }
        case "expand": {
          const base = Vector3.Lerp(position, destination, progress);
          const radius = Math.hypot(base.x, base.z);
          if (radius < 1e-8) return base;
          return base.add(new Vector3(base.x / radius, 0, base.z / radius).scale(Math.sin(progress * Math.PI) * 0.55));
        }
        case "pinwheel": {
          const fromRadius = Math.hypot(position.x, position.z);
          const toRadius = Math.hypot(destination.x, destination.z);
          if (fromRadius < 0.2 || toRadius < 0.2) return Vector3.Lerp(position, destination, progress);
          const fromAngle = Math.atan2(position.z, position.x);
          const toAngle = Math.atan2(destination.z, destination.x);
          const angle = interpolateAngle(fromAngle, toAngle, progress);
          const radius = fromRadius + (toRadius - fromRadius) * progress;
          return new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        }
        case "rank-ripple": {
          const rank = Math.floor(performerIndex / 11);
          const delay = rank / 6;
          const localProgress = Math.min(1, Math.max(0, progress * 1.5 - delay * 0.5));
          const easedProgress = localProgress * localProgress * (3 - 2 * localProgress);
          return Vector3.Lerp(position, destination, easedProgress);
        }
        default:
          return Vector3.Lerp(position, destination, progress);
      }
    });
  });
  reportPathCollision(path);
  return path;
}

interface SweptCollision {
  sampleIndex: number;
  left: number;
  right: number;
  distance: number;
}

function firstSweptCollision(path: Vector3[][]): SweptCollision | null {
  const tolerance = 1e-3;
  for (let sampleIndex = 0; sampleIndex < path.length - 1; sampleIndex += 1) {
    const start = path[sampleIndex];
    const end = path[sampleIndex + 1];
    for (let left = 0; left < start.length; left += 1) {
      for (let right = left + 1; right < start.length; right += 1) {
        const relativeStart = start[right].subtract(start[left]);
        const relativeEnd = end[right].subtract(end[left]);
        const relativeVelocity = relativeEnd.subtract(relativeStart);
        const velocitySquared = relativeVelocity.lengthSquared();
        const closestProgress = velocitySquared > 1e-12
          ? Math.min(1, Math.max(0, -Vector3.Dot(relativeStart, relativeVelocity) / velocitySquared))
          : 0;
        const closestDistance = relativeStart.add(relativeVelocity.scale(closestProgress)).length();
        if (closestDistance < minimumSweptClearance - tolerance) {
          return { sampleIndex, left, right, distance: closestDistance };
        }
      }
    }
  }
  return null;
}

function reportPathCollision(path: Vector3[][]): void {
  const collision = firstSweptCollision(path);
  if (collision) {
    console.warn(
      \`Static drill collision between performers \${collision.left + 1} and \${collision.right + 1} \`
      + \`on path segment \${collision.sampleIndex + 1} (\${collision.distance.toFixed(4)} < \${minimumSweptClearance.toFixed(4)})\`,
    );
  }
}

function precalculatePathProgress(path: Vector3[][]): number[] {
  const cumulative = [0];
  for (let sampleIndex = 1; sampleIndex < path.length; sampleIndex += 1) {
    let segmentDistance = 0;
    for (let performerIndex = 0; performerIndex < path[sampleIndex].length; performerIndex += 1) {
      segmentDistance = Math.max(
        segmentDistance,
        Vector3.Distance(path[sampleIndex - 1][performerIndex], path[sampleIndex][performerIndex]),
      );
    }
    cumulative.push(cumulative[cumulative.length - 1] + segmentDistance);
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 1e-8) return cumulative.map((_, index) => index / Math.max(1, cumulative.length - 1));
  return cumulative.map(distance => distance / total);
}

function samplePrecalculatedPath(
  path: Vector3[][],
  pathProgress: number[],
  progress: number,
): Vector3[] {
  let pathIndex = 0;
  while (pathIndex < pathProgress.length - 2 && pathProgress[pathIndex + 1] <= progress) pathIndex += 1;
  const nextPathIndex = Math.min(path.length - 1, pathIndex + 1);
  const segmentDuration = pathProgress[nextPathIndex] - pathProgress[pathIndex];
  const segmentProgress = segmentDuration > 1e-8
    ? Math.min(1, Math.max(0, (progress - pathProgress[pathIndex]) / segmentDuration))
    : 0;
  return path[pathIndex].map((position, performerIndex) => (
    Vector3.Lerp(position, path[nextPathIndex][performerIndex], segmentProgress)
  ));
}

function precalculateFootsteps(
  path: Vector3[][],
  pathProgress: number[],
  transitionTicks: number,
  ppq: number,
): PrecalculatedFootstep[] {
  const stepCount = Math.max(0, Math.ceil(transitionTicks / ppq));
  return Array.from({ length: stepCount }, (_, stepIndex) => {
    const startPositions = samplePrecalculatedPath(path, pathProgress, stepIndex / stepCount);
    const endPositions = samplePrecalculatedPath(path, pathProgress, (stepIndex + 1) / stepCount);
    const directions = endPositions.map((position, performerIndex) => {
      const direction = position.subtract(startPositions[performerIndex]);
      const distance = direction.length();
      return distance > 0 ? direction.scale(1 / distance) : Vector3.Zero();
    });
    const stepSizes = endPositions.map((position, performerIndex) => (
      Vector3.Distance(startPositions[performerIndex], position)
    ));
    return {
      tickOffset: Math.min(transitionTicks, (stepIndex + 1) * ppq),
      plantedFoot: stepIndex % 2 === 0 ? "right" : "left",
      positions: endPositions,
      directions,
      stepSizes,
    };
  });
}

function facingAngle(headingDegrees: number): number {
  if (!Number.isFinite(headingDegrees)) throw new Error("Drill facing must be a finite heading in degrees");
  const angle = Math.PI + headingDegrees * Math.PI / 180;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function interpolateAngle(from: number, to: number, progress: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * progress;
}

function smoothAngle(from: number, to: number, deltaSeconds: number): number {
  return interpolateAngle(from, to, 1 - Math.exp(-deltaSeconds / 0.12));
}

interface DrillMotion {
  direction: Vector3;
  stepSize: number;
  moving: boolean;
}

interface CalChartMovementSample {
  position: Vector3;
  facing: number;
  gait: GaitName;
  motion: DrillMotion;
}

interface DrillDisplayCue {
  label: string;
  measure?: number;
  gait?: GaitName;
}

interface DrillPlaybackState {
  cue: DrillDisplayCue | null;
  next: DrillDisplayCue | null;
  positions: Vector3[];
  facings: number[];
  gaits: GaitName[];
  motions: DrillMotion[];
}

function nativeDrillState(ticks: number): DrillPlaybackState {
  let cueIndex = -1;
  for (let index = 0; index < drillCues.length && drillCues[index].tick <= ticks; index += 1) cueIndex = index;
  const cue = drillCues[cueIndex] ?? null;
  const next = drillCues[cueIndex + 1] ?? null;
  if (!cue) {
    return {
      cue,
      next: drillCues[0] ?? null,
      positions: formationPositions("block", nativePerformerCount, 180),
      facings: Array.from({ length: nativePerformerCount }, () => facingAngle(180)),
      gaits: Array.from({ length: nativePerformerCount }, () => "march"),
      motions: Array.from({ length: nativePerformerCount }, () => ({ direction: Vector3.Zero(), stepSize: 0, moving: false })),
    };
  }
  const progress = cue.transitionTicks > 0 ? Math.min(1, Math.max(0, (ticks - cue.tick) / cue.transitionTicks)) : 1;
  const positions = samplePrecalculatedPath(cue.pathPositions, cue.pathProgress, progress);
  const counts = loadedMidi && cue.transitionTicks > 0 ? cue.transitionTicks / loadedMidi.header.ppq : 0;
  const elapsedTicks = Math.max(0, ticks - cue.tick);
  const footstepIndex = loadedMidi && cue.footsteps.length > 0
    ? Math.min(cue.footsteps.length - 1, Math.floor(elapsedTicks / loadedMidi.header.ppq))
    : -1;
  const footstep = footstepIndex >= 0 ? cue.footsteps[footstepIndex] : null;
  const motions = cue.fromPositions.map((_, index) => {
    const direction = footstep?.directions[index].clone() ?? Vector3.Zero();
    const stepSize = footstep?.stepSizes[index] ?? 0;
    const moving = progress < 1 && stepSize > 1e-5 && counts > 0;
    return { direction, stepSize: moving ? stepSize : 0, moving };
  });
  return {
    cue,
    next,
    positions,
    facings: Array.from({ length: nativePerformerCount }, () => interpolateAngle(cue.fromFacingAngle, cue.facingAngle, progress)),
    gaits: Array.from({ length: nativePerformerCount }, () => cue.gait ?? "march"),
    motions,
  };
}

function viewerPosition(x: number, y: number): Vector3 {
  return new Vector3((80 - x) * eightToFiveStep, 0, (y - 42) * eightToFiveStep);
}

function viewerFacing(angle: number): number {
  const radians = -Math.PI / 2 - angle * Math.PI / 180;
  return Math.atan2(Math.sin(radians), -Math.cos(radians));
}

function sampleCalChartMovement(commands: CalChartMovement[], beat: number, sample: CalChartMovementSample): void {
  let commandStart = 0;
  let command = commands[commands.length - 1];
  for (const candidate of commands) {
    command = candidate;
    if (beat <= commandStart + candidate.beats || candidate === commands[commands.length - 1]) break;
    commandStart += candidate.beats;
  }
  const progress = command.beats > 0 ? Math.min(1, Math.max(0, (beat - commandStart) / command.beats)) : 1;
  if (command.type === "even") {
    const start = viewerPosition(finiteNumber(command.x1, "even x1"), finiteNumber(command.y1, "even y1"));
    const end = viewerPosition(finiteNumber(command.x2, "even x2"), finiteNumber(command.y2, "even y2"));
    const travelX = end.x - start.x;
    const travelZ = end.z - start.z;
    const distance = Math.hypot(travelX, travelZ);
    sample.position.set(start.x + travelX * progress, 0, start.z + travelZ * progress);
    sample.facing = viewerFacing(finiteNumber(command.facing, "even facing"));
    sample.gait = "high-step";
    sample.motion.direction.set(distance > 0 ? travelX / distance : 0, 0, distance > 0 ? travelZ / distance : 0);
    sample.motion.stepSize = distance / Math.max(1, command.beats);
    sample.motion.moving = progress < 1 && distance > 1e-5;
    return;
  }
  if (command.type === "arc") {
    const startX = finiteNumber(command.start_x, "arc start_x");
    const startY = finiteNumber(command.start_y, "arc start_y");
    const centerX = finiteNumber(command.center_x, "arc center_x");
    const centerY = finiteNumber(command.center_y, "arc center_y");
    const sweep = finiteNumber(command.angle, "arc angle") * Math.PI / 180;
    const startAngle = Math.atan2(startY - centerY, startX - centerX);
    const angle = startAngle + sweep * progress;
    const radius = Math.hypot(startX - centerX, startY - centerY);
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    const directionAngle = angle + Math.sign(sweep || 1) * Math.PI / 2;
    const directionX = -Math.cos(directionAngle);
    const directionZ = Math.sin(directionAngle);
    const facing = directionAngle * 180 / Math.PI + (command.facing_offset ?? 0);
    sample.position.copyFrom(viewerPosition(x, y));
    sample.facing = viewerFacing(facing);
    sample.gait = "high-step";
    sample.motion.direction.set(directionX, 0, directionZ);
    sample.motion.stepSize = radius * Math.abs(sweep) * eightToFiveStep / Math.max(1, command.beats);
    sample.motion.moving = progress < 1 && Math.abs(sweep) > 1e-5;
    return;
  }
  sample.position.copyFrom(viewerPosition(finiteNumber(command.x, \`\${command.type} x\`), finiteNumber(command.y, \`\${command.type} y\`)));
  sample.facing = viewerFacing(finiteNumber(command.facing, \`\${command.type} facing\`));
  sample.gait = command.type === "mark" ? "mark-time" : "stand";
  sample.motion.direction.setAll(0);
  sample.motion.stepSize = 0;
  sample.motion.moving = false;
}

let calChartFrameSamples: CalChartMovementSample[] = [];
let calChartFrameState: DrillPlaybackState | null = null;
let calChartFrameSheetIndex = -1;

function calChartDrillState(ticks: number, drill: PreparedCalChartDrill): DrillPlaybackState {
  const beat = loadedMidi ? Math.max(0, ticks / loadedMidi.header.ppq) : 0;
  let sheetIndex = drill.sheets.findIndex(sheet => beat < sheet.startBeat + sheet.beats);
  if (sheetIndex < 0) sheetIndex = Math.max(0, drill.sheets.length - 1);
  const sheet = drill.sheets[sheetIndex];
  const sheetBeat = Math.min(sheet.beats, Math.max(0, beat - sheet.startBeat));
  if (!calChartFrameState || calChartFrameSamples.length !== drill.labels.length) {
    calChartFrameSamples = drill.labels.map(() => ({
      position: Vector3.Zero(),
      facing: 0,
      gait: "stand",
      motion: { direction: Vector3.Zero(), stepSize: 0, moving: false },
    }));
    calChartFrameState = {
      cue: null,
      next: null,
      positions: calChartFrameSamples.map(sample => sample.position),
      facings: new Array<number>(drill.labels.length).fill(0),
      gaits: new Array<GaitName>(drill.labels.length).fill("stand"),
      motions: calChartFrameSamples.map(sample => sample.motion),
    };
    calChartFrameSheetIndex = -1;
  }
  if (sheetIndex !== calChartFrameSheetIndex) {
    calChartFrameState.cue = { label: \`Sheet \${sheet.label}\` };
    calChartFrameState.next = drill.sheets[sheetIndex + 1] ? { label: \`Sheet \${drill.sheets[sheetIndex + 1].label}\` } : null;
    calChartFrameSheetIndex = sheetIndex;
  }
  for (let index = 0; index < drill.labels.length; index += 1) {
    const sample = calChartFrameSamples[index];
    sampleCalChartMovement(sheet.movements[drill.labels[index]], sheetBeat, sample);
    calChartFrameState.facings[index] = sample.facing;
    calChartFrameState.gaits[index] = sample.gait;
  }
  return calChartFrameState;
}

function currentDrillState(ticks: number): DrillPlaybackState {
  return calChartDrill ? calChartDrillState(ticks, calChartDrill) : nativeDrillState(ticks);
}

function drawScoreboard(drill: DrillPlaybackState): void {
  const content = [
    drillTitle,
    drill?.cue?.label ?? drillTitle,
    drill?.next?.label,
  ].join("|");
  if (content === lastScoreboardContent) return;
  lastScoreboardContent = content;

  const context = scoreboardTexture.getContext() as unknown as CanvasRenderingContext2D;
  context.setTransform(2, 0, 0, 2, 0, 0);
  context.fillStyle = "#07100a";
  context.fillRect(0, 0, 1024, 512);
  context.strokeStyle = "#c92532";
  context.lineWidth = 12;
  context.strokeRect(14, 14, 996, 484);
  context.textAlign = "center";
  context.fillStyle = "#f3d35b";
  context.font = "bold 54px Georgia";
  context.fillText(drillTitle.slice(0, 32), 512, 105);
  context.fillStyle = "#f5f0df";
  context.font = "bold 72px Georgia";
  context.fillText((drill.cue?.label ?? "READY").slice(0, 34), 512, 270);
  context.fillStyle = "#a9d7bf";
  context.font = "bold 38px Georgia";
  const nextPrefix = drill.next?.measure ? \`NEXT M\${drill.next.measure}: \` : "NEXT: ";
  context.fillText(drill.next ? \`\${nextPrefix}\${drill.next.label}\` : "FINAL SET", 512, 410);
  scoreboardTexture.update(false);
}

function configureFieldScale(mode: "desktop" | "immersive-ar" | "immersive-vr"): void {
  activeDisplayMode = mode;
  const fieldScale = mode === "immersive-ar" ? tabletopScale : mode === "immersive-vr" ? lifeSizeScale : 1;
  fieldRoot.scaling.setAll(fieldScale);
  fieldRoot.position.set(0, mode === "immersive-ar" ? 0.75 : 0, mode === "immersive-ar" ? -2 : 0);
  performers.forEach(performer => performer.scaling.setAll(physicalPerformerScale));
  skybox.setEnabled(mode === "immersive-vr");
  fieldRoot.computeWorldMatrix(true);
}

let xrExperience: WebXRDefaultExperience | null = null;
let requestingXr = false;
let supportsAr = false;
let supportsVr = false;
let activeDisplayMode: "desktop" | "immersive-ar" | "immersive-vr" = "desktop";
const vrFlightAxes = { x: 0, y: 0 };
const vrFlightForward = Vector3.Zero();
const vrFlightRight = Vector3.Zero();
const vrFlightMovement = Vector3.Zero();
const vrFlightDeadZone = 0.15;
const vrFlightSpeed = 0.35;

scene.onBeforeRenderObservable.add(() => {
  if (activeDisplayMode !== "immersive-vr" || !xrExperience) return;
  const xrCamera = xrExperience.baseExperience.camera;
  const strafe = Math.abs(vrFlightAxes.x) >= vrFlightDeadZone ? vrFlightAxes.x : 0;
  const forward = Math.abs(vrFlightAxes.y) >= vrFlightDeadZone ? -vrFlightAxes.y : 0;
  if (strafe === 0 && forward === 0) return;

  xrCamera.getDirectionToRef(Vector3.Forward(), vrFlightForward);
  xrCamera.getDirectionToRef(Vector3.Right(), vrFlightRight);
  vrFlightForward.scaleToRef(forward, vrFlightMovement);
  vrFlightMovement.addInPlace(vrFlightRight.scaleInPlace(strafe));
  if (vrFlightMovement.lengthSquared() > 1) vrFlightMovement.normalize();
  vrFlightMovement.scaleInPlace(xrCamera._computeLocalCameraSpeed() * vrFlightSpeed);
  xrCamera.cameraDirection.addInPlace(vrFlightMovement);
});

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function updateButtons(): void {
  const inXr = xrExperience?.baseExperience.state === WebXRState.IN_XR;
  enterArButton.disabled = requestingXr || Boolean(inXr) || !supportsAr;
  enterVrButton.disabled = requestingXr || Boolean(inXr) || !supportsVr;
  enterArButton.textContent = inXr ? "AR Active" : "Enter Field AR";
  enterVrButton.textContent = inXr ? "VR Active" : "Enter Stadium VR";
}

function configureXrInteraction(mode: "desktop" | "immersive-ar" | "immersive-vr"): void {
  if (!xrExperience) return;
  if (mode === "immersive-ar") {
    xrExperience.teleportation.detach();
    if (!tabletopDragAttached) {
      lockTabletopLevel();
      tabletopDragBehavior.attach(fieldRoot);
      tabletopDragAttached = true;
    }
    return;
  }
  if (tabletopDragAttached) {
    tabletopDragBehavior.detach();
    tabletopDragAttached = false;
  }
  if (mode === "immersive-vr") {
    xrExperience.teleportation.detach();
    return;
  }
  xrExperience.teleportation.attach();
}

async function enterXr(mode: "immersive-ar" | "immersive-vr"): Promise<void> {
  if (!xrExperience || requestingXr) return;
  requestingXr = true;
  configureFieldScale(mode);
  configureXrInteraction(mode);
  updateButtons();
  try {
    await xrExperience.baseExperience.enterXRAsync(mode, "local-floor", xrExperience.renderTarget, {
      optionalFeatures: mode === "immersive-ar" ? ["hit-test", "dom-overlay"] : ["bounded-floor"],
    });
    setStatus(mode === "immersive-ar" ? "Tabletop field placed ahead" : "Regulation-size field active");
  } catch (error) {
    configureFieldScale("desktop");
    configureXrInteraction("desktop");
    setStatus(error instanceof Error ? error.message : "Unable to enter WebXR");
  } finally {
    requestingXr = false;
    updateButtons();
  }
}

async function initializeXr(): Promise<void> {
  try {
    xrExperience = await scene.createDefaultXRExperienceAsync({
      floorMeshes: [field],
      disableDefaultUI: true,
      optionalFeatures: true,
      outputCanvasOptions: {
        canvasOptions: {
          antialias: true,
          depth: true,
          stencil: true,
          alpha: true,
          framebufferScaleFactor: 0.6,
        },
      },
    });
    xrExperience.input.onControllerAddedObservable.add(source => {
      source.onMotionControllerInitObservable.add(() => {
        initializeQuestController(source);
      });
    });
    xrExperience.input.onControllerRemovedObservable.add(source => {
      if (source.inputSource.handedness === "left") {
        vrFlightAxes.x = 0;
        vrFlightAxes.y = 0;
      }
    });
    supportsAr = await xrExperience.baseExperience.sessionManager.isSessionSupportedAsync("immersive-ar");
    supportsVr = await xrExperience.baseExperience.sessionManager.isSessionSupportedAsync("immersive-vr");
    xrExperience.baseExperience.onStateChangedObservable.add(state => {
      if (state === WebXRState.NOT_IN_XR) {
        configureFieldScale("desktop");
        configureXrInteraction("desktop");
      }
      updateButtons();
    });
    setStatus(supportsAr || supportsVr ? "Field ready" : "WebXR unavailable; desktop view active");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "WebXR initialization failed");
  }
  updateButtons();
}

async function togglePlayback(): Promise<void> {
  if (!loadedMidi) return;
  await startAudio();
  if (transport.seconds >= loadedMidi.duration * musicRepeatCount - 0.05) transport.seconds = 0;
  if (transport.state === "started") transport.pause();
  else transport.start();
  playButton.textContent = transport.state === "started" ? "Pause" : "Play";
}

function stopPlayback(): void {
  transport.stop();
  transport.seconds = 0;
  synth.releaseAll();
  playButton.textContent = "Play";
}

function seekPlayback(deltaSeconds: number): void {
  if (!loadedMidi) return;
  transport.seconds = Math.max(0, Math.min(loadedMidi.duration * musicRepeatCount, transport.seconds + deltaSeconds));
  synth.releaseAll();
}

function initializeQuestController(source: WebXRInputSource): void {
  const motionController = source.motionController;
  if (!motionController) return;

  if (source.inputSource.handedness === "left") {
    const thumbstick = motionController.getComponent("xr-standard-thumbstick")
      ?? motionController.getComponentOfType("thumbstick");
    thumbstick?.onAxisValueChangedObservable.add(axes => {
      vrFlightAxes.x = axes.x;
      vrFlightAxes.y = axes.y;
    });
  }

  const bindButton = (componentId: string, action: () => void): void => {
    const component = motionController.getComponent(componentId);
    if (!component) return;
    let wasPressed = false;
    component.onButtonStateChangedObservable.add(button => {
      if (button.pressed && !wasPressed) {
        action();
        motionController.pulse?.(0.2, 70);
      }
      wasPressed = button.pressed;
    });
  };

  bindButton("a-button", () => void togglePlayback());
  bindButton("b-button", stopPlayback);
  bindButton("x-button", () => seekPlayback(-10));
  bindButton("y-button", () => seekPlayback(10));
}

enterArButton.addEventListener("click", () => void enterXr("immersive-ar"));
enterVrButton.addEventListener("click", () => void enterXr("immersive-vr"));
midiFileInput.addEventListener("change", () => {
  const file = midiFileInput.files?.[0];
  if (file) void file.arrayBuffer().then(data => loadMidiData(data, file.name)).catch(error => setStatus(error instanceof Error ? error.message : "Unable to load MIDI"));
});
drillFileInput.addEventListener("change", () => {
  const file = drillFileInput.files?.[0];
  if (!file) return;
  if (/\\.shw$/i.test(file.name)) {
    void file.arrayBuffer().then(data => prepareCalChartShw(data, file.name)).catch(error => setStatus(error instanceof Error ? error.message : "Unable to load CalChart show"));
    return;
  }
  void file.text().then(text => loadDrillFile(JSON.parse(text))).catch(error => setStatus(error instanceof Error ? error.message : "Unable to load drill"));
});
playButton.addEventListener("click", () => void togglePlayback());
stopButton.addEventListener("click", stopPlayback);
musicPositionInput.addEventListener("input", () => {
  if (!loadedMidi) return;
  transport.seconds = Number(musicPositionInput.value) * loadedMidi.duration * musicRepeatCount;
  synth.releaseAll();
});
buildInfoElement.textContent = \`ChartXR · build \${packageJson.buildNumber}\`;
configureFieldScale("desktop");

const gaitProfiles: Record<GaitName, {
  cadence: number;
  legSwing: number;
  lateralSwing: number;
  armSwing: number;
  lean: number;
}> = {
  stand: { cadence: 0, legSwing: 0, lateralSwing: 0, armSwing: 0, lean: 0 },
  march: { cadence: 1, legSwing: 0.34, lateralSwing: 0, armSwing: 0.18, lean: 0 },
  "roll-step": { cadence: 1, legSwing: 0.28, lateralSwing: 0, armSwing: 0.14, lean: 0 },
  "backward-march": { cadence: 1, legSwing: -0.3, lateralSwing: 0, armSwing: 0.16, lean: -0.04 },
  "high-step": { cadence: 1, legSwing: 0.78, lateralSwing: 0, armSwing: 0.28, lean: 0 },
  "chair-step": { cadence: 1, legSwing: 1.05, lateralSwing: 0, armSwing: 0.24, lean: 0 },
  glide: { cadence: 0.75, legSwing: 0.12, lateralSwing: 0, armSwing: 0.08, lean: 0 },
  "mark-time": { cadence: 1, legSwing: 0.52, lateralSwing: 0, armSwing: 0.2, lean: 0 },
  "crab-step": { cadence: 1, legSwing: 0.08, lateralSwing: 0.32, armSwing: 0.08, lean: 0 },
  "jazz-run": { cadence: 1.5, legSwing: 0.9, lateralSwing: 0, armSwing: 0.46, lean: 0.14 },
};

function travelGait(cueGait: GaitName, motion: DrillMotion, facing: number): GaitName {
  if (!motion.moving) return cueGait;
  const forwardX = -Math.sin(facing);
  const forwardZ = -Math.cos(facing);
  const rightX = Math.cos(facing);
  const rightZ = -Math.sin(facing);
  const forwardTravel = motion.direction.x * forwardX + motion.direction.z * forwardZ;
  const lateralTravel = motion.direction.x * rightX + motion.direction.z * rightZ;
  if (Math.abs(lateralTravel) > Math.abs(forwardTravel)) return "crab-step";
  if (forwardTravel < 0) return "backward-march";
  if (cueGait === "stand" || cueGait === "mark-time") return "roll-step";
  return cueGait;
}

function animatePerformerRig(
  performer: TransformNode,
  phase: number,
  gait: GaitName,
  motion: DrillMotion,
  facing: number,
  playing: boolean,
): number {
  const rig = (performer.metadata as { rig: PerformerRig }).rig;
  const profile = gaitProfiles[gait];
  const stepping = playing && (motion.moving || gait === "mark-time");
  const stepScale = motion.stepSize > 0 ? Math.min(2, Math.max(0.35, motion.stepSize / eightToFiveStep)) : 1;
  const cycle = ((phase / (Math.PI * 2)) % 1 + 1) % 1;
  const leftPlanted = cycle < 0.5;
  const countProgress = leftPlanted ? cycle * 2 : (cycle - 0.5) * 2;
  const plantedLeg = stepping ? 1 - countProgress * 2 : 0;
  const recoveringLeg = stepping ? -Math.cos(countProgress * Math.PI) : 0;
  const leftStride = leftPlanted ? plantedLeg : recoveringLeg;
  const rightStride = leftPlanted ? recoveringLeg : plantedLeg;
  const legLength = 0.157;
  const coverageRatio = Math.min(0.98, motion.stepSize / (legLength * 2));
  const coverageAngle = Math.asin(coverageRatio);
  const plantedCoverage = Math.asin(plantedLeg * coverageRatio);
  const recoveringCoverage = recoveringLeg * coverageAngle;
  const leftCoverage = leftPlanted ? plantedCoverage : recoveringCoverage;
  const rightCoverage = leftPlanted ? recoveringCoverage : plantedCoverage;
  const forwardTravel = -motion.direction.x * Math.sin(facing) - motion.direction.z * Math.cos(facing);
  const lateralTravel = motion.direction.x * Math.cos(facing) - motion.direction.z * Math.sin(facing);
  if (motion.moving && gait === "crab-step") {
    const direction = Math.sign(lateralTravel) || 1;
    rig.leftLeg.rotation.x = 0;
    rig.rightLeg.rotation.x = 0;
    rig.leftLeg.rotation.z = leftCoverage * direction;
    rig.rightLeg.rotation.z = rightCoverage * direction;
  } else if (motion.moving) {
    const direction = Math.sign(forwardTravel) || 1;
    rig.leftLeg.rotation.x = leftCoverage * direction;
    rig.rightLeg.rotation.x = rightCoverage * direction;
    rig.leftLeg.rotation.z = 0;
    rig.rightLeg.rotation.z = 0;
  } else {
    rig.leftLeg.rotation.x = leftStride * profile.legSwing * stepScale;
    rig.rightLeg.rotation.x = rightStride * profile.legSwing * stepScale;
    rig.leftLeg.rotation.z = leftStride * profile.lateralSwing * stepScale;
    rig.rightLeg.rotation.z = rightStride * profile.lateralSwing * stepScale;
  }
  const armStride = (leftStride - rightStride) * 0.5;
  if (rig.armStyle === "guard") {
    rig.leftArm.rotation.set(-armStride * profile.armSwing, 0, 0);
    rig.rightArm.rotation.set(0.55, 0, -0.3);
  } else {
    let leftX = 1;
    let rightX = 1;
    let inward = 0.24;
    if (rig.armStyle === "mouth") {
      const playingX = rig.instrumentType === "flute" ? 2.3 : 2.2;
      leftX = 0.72 + rig.instrumentPose * (playingX - 0.72);
      rightX = 0.78 + rig.instrumentPose * (playingX - 0.78);
      inward = rig.instrumentType === "flute" ? 0.2 : 0.28;
    } else if (rig.armStyle === "low") {
      leftX = 0.68 + rig.instrumentPose * 0.34;
      rightX = 0.74 + rig.instrumentPose * 0.36;
      inward = 0.27;
    } else if (rig.armStyle === "shoulder") {
      leftX = 1.15;
      rightX = 1.35;
      inward = 0.28;
    } else if (rig.armStyle === "mallet") {
      leftX = 1.05;
      rightX = 1.05;
      inward = 0.22;
    } else if (rig.armStyle === "cymbals") {
      leftX = 1.25;
      rightX = 1.25;
      inward = -0.12;
    } else if (rig.armStyle === "drum") {
      leftX = 1.05;
      rightX = 1.05;
      inward = 0.18;
    }
    rig.leftArm.rotation.set(leftX, 0, inward);
    rig.rightArm.rotation.set(rightX, 0, -inward);
  }
  rig.torso.rotation.x = stepping ? profile.lean : 0;
  rig.torso.position.y = 0.16;
  if (rig.instrument) {
    const poseRate = Math.min(1, engine.getDeltaTime() / 180);
    rig.instrumentPose += ((playing ? 1 : 0) - rig.instrumentPose) * poseRate;
    if (rig.instrumentStyle === "shoulder") {
      rig.instrument.position.set(0, 0.13, -0.02);
      rig.instrument.rotation.x = 0;
    } else if (rig.instrumentStyle === "mallet") {
      rig.instrument.position.set(0, 0.1, -0.02);
      rig.instrument.rotation.x = -0.12;
    } else if (rig.instrumentStyle === "low") {
      rig.instrument.position.set(0, 0.16 + rig.instrumentPose * 0.075, -0.025);
      rig.instrument.rotation.x = -0.35 * (1 - rig.instrumentPose);
    } else {
      rig.instrument.position.set(0, 0.13 + rig.instrumentPose * 0.115, -0.025);
      const restAngle = rig.instrumentType === "trumpet" ? -1.25 : -0.65;
      rig.instrument.rotation.x = restAngle * (1 - rig.instrumentPose);
    }
    if (rig.cymbals) {
      const spacing = 0.085 - rig.instrumentPose * 0.073;
      const angle = -0.35 * (1 - rig.instrumentPose);
      rig.cymbals[0].position.set(-spacing, 0, -0.12);
      rig.cymbals[1].position.set(spacing, 0, -0.12);
      rig.cymbals[0].rotation.y = angle;
      rig.cymbals[1].rotation.y = -angle;
    }
  }
  return shoeSoleClearance * performer.scaling.y + fieldPaintHeight;
}

function animateSimplifiedPerformerRig(
  performer: TransformNode,
  phase: number,
  gait: GaitName,
  motion: DrillMotion,
  playing: boolean,
): number {
  const rig = (performer.metadata as { rig: PerformerRig }).rig;
  const stepping = playing && (motion.moving || gait === "mark-time");
  const legSwing = stepping ? Math.sin(phase) * 0.32 : 0;
  rig.leftLeg.rotation.set(legSwing, 0, 0);
  rig.rightLeg.rotation.set(-legSwing, 0, 0);
  rig.torso.rotation.x = 0;
  rig.torso.position.y = 0.16;

  rig.instrumentPose = playing ? 1 : 0;
  if (rig.armStyle === "guard") {
    rig.leftArm.rotation.set(0, 0, 0);
    rig.rightArm.rotation.set(0.55, 0, -0.3);
  } else {
    let leftX = 1.05;
    let rightX = 1.05;
    let inward = 0.22;
    if (rig.armStyle === "mouth") {
      leftX = playing ? (rig.instrumentType === "flute" ? 2.3 : 2.2) : 0.72;
      rightX = playing ? (rig.instrumentType === "flute" ? 2.3 : 2.2) : 0.78;
      inward = rig.instrumentType === "flute" ? 0.2 : 0.28;
    } else if (rig.armStyle === "low") {
      leftX = playing ? 1.02 : 0.68;
      rightX = playing ? 1.1 : 0.74;
      inward = 0.27;
    } else if (rig.armStyle === "shoulder") {
      leftX = 1.15;
      rightX = 1.35;
      inward = 0.28;
    } else if (rig.armStyle === "cymbals") {
      leftX = 1.25;
      rightX = 1.25;
      inward = -0.12;
    } else if (rig.armStyle === "drum") {
      inward = 0.18;
    }
    rig.leftArm.rotation.set(leftX, 0, inward);
    rig.rightArm.rotation.set(rightX, 0, -inward);
  }

  if (rig.instrument) {
    if (rig.instrumentStyle === "shoulder") {
      rig.instrument.position.set(0, 0.13, -0.02);
      rig.instrument.rotation.x = 0;
    } else if (rig.instrumentStyle === "mallet") {
      rig.instrument.position.set(0, 0.1, -0.02);
      rig.instrument.rotation.x = -0.12;
    } else if (rig.instrumentStyle === "low") {
      rig.instrument.position.set(0, playing ? 0.235 : 0.16, -0.025);
      rig.instrument.rotation.x = playing ? 0 : -0.35;
    } else {
      rig.instrument.position.set(0, playing ? 0.245 : 0.13, -0.025);
      rig.instrument.rotation.x = playing ? 0 : rig.instrumentType === "trumpet" ? -1.25 : -0.65;
    }
  }
  return shoeSoleClearance * performer.scaling.y + fieldPaintHeight;
}

const arRigUpdateInterval = 1 / 30;
let arRigUpdateAccumulator = arRigUpdateInterval;

scene.onBeforeRenderObservable.add(() => {
  const deltaSeconds = engine.getDeltaTime() / 1000;
  if (skybox.isEnabled() && scene.activeCamera) skybox.position.copyFrom(scene.activeCamera.globalPosition);
  const seconds = loadedMidi ? Math.min(transport.seconds, loadedMidi.duration * musicRepeatCount) : 0;
  const ticks = loadedMidi ? loadedMidi.header.secondsToTicks(seconds) : 0;
  const drill = currentDrillState(ticks);
  drawScoreboard(drill);
  const stepTicks = loadedMidi ? loadedMidi.header.ppq * 2 : 1;
  const marching = transport.state === "started";
  arRigUpdateAccumulator += deltaSeconds;
  const updateRig = activeDisplayMode !== "immersive-ar" || arRigUpdateAccumulator >= arRigUpdateInterval;
  if (updateRig && activeDisplayMode === "immersive-ar") arRigUpdateAccumulator %= arRigUpdateInterval;
  for (let index = 0; index < drill.positions.length; index += 1) {
    const performer = performers[index];
    const position = drill.positions[index];
    const motion = drill.motions[index];
    const facing = smoothAngle(performer.rotation.y, drill.facings[index], deltaSeconds);
    performer.position.x = position.x;
    if (updateRig) {
      const gait = travelGait(drill.gaits[index], motion, facing);
      const stepPhase = ticks / stepTicks * Math.PI * 2;
      performer.position.y = activeDisplayMode === "immersive-ar"
        ? animateSimplifiedPerformerRig(performer, stepPhase, gait, motion, marching)
        : animatePerformerRig(performer, stepPhase, gait, motion, facing, marching);
    }
    performer.position.z = position.z;
    performer.rotation.y = facing;
  }
  if (loadedMidi && activeDisplayMode === "desktop") {
    musicPositionInput.value = String(seconds / (loadedMidi.duration * musicRepeatCount));
  }
});

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
void fetch("/music/the-stars-and-stripes-forever.mid")
  .then(response => response.arrayBuffer())
  .then(data => loadMidiData(data, "The Stars and Stripes Forever"))
  .then(() => fetch(queenFinalShwUrl))
  .then(response => response.arrayBuffer())
  .then(data => prepareCalChartShw(data, "queen-final.shw"))
  .catch(error => setStatus(error instanceof Error ? error.message : "Unable to load the default music"));
void initializeXr();
`,an={kind:"SourceFile",label:"chart-xr.ts",start:0,end:92826,uses:[3350,2682,2147,5401,6191,4190,6522,6844,5313,7025,7348,7583,9278,13291,14061,26621,34635,34382,35132,35731,74228,73935,73975,74367,74013,74283,74085,4426,76043,4513,4600,4680,80610,49697,74971,4762,78327,4842,78684,4922,35697,35836,35808,4344,73153,72003,90907,90469,90565,43563,805,48581,76835],usedBy:[2147,2306,2682,3350,3784,5313,5401,6137,6191,7025,7348,7583,7745,8032,8102,8185,8268,8343,8413,8488,8577,8655,8723,8795,8872,8947,9018,9110,9194,9278,9430,9486,9916,10349,12134,12427,14061,15260,25098,26621,27132,27354,27745,34635,35132,35697,35731,35836,35947,36599,39170,39666,40976,42964,43563,44765,45578,48581,49858,51741,52599,53292,56296,59545,60648,61031,61788,62473,64209,64297,64415,64502,64691,66638,66945,70099,73688,73935,73975,74013,75057,76835,78327,79044,81493,82526,83191,88181],children:[{kind:"VariableStatement",label:"variable queenFinalShwUrl",start:805,end:912,uses:[],usedBy:[0],children:[]},{kind:"InterfaceDeclaration",label:"interface PrecalculatedFootstep",start:2147,end:2304,uses:[0],usedBy:[0,62473,64691],children:[]},{kind:"InterfaceDeclaration",label:"interface PerformerRig",start:2306,end:2680,uses:[0],usedBy:[15260,83191,88181],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillCueFile",start:2682,end:2988,uses:[0],usedBy:[0,40976,44387,49697,64691],children:[]},{kind:"InterfaceDeclaration",label:"interface CalChartViewerFile",start:3350,end:3682,uses:[0],usedBy:[0,45578,48581,49502,70099],children:[]},{kind:"InterfaceDeclaration",label:"interface PreparedCalChartDrill",start:3784,end:3891,uses:[0],usedBy:[35984,70099],children:[]},{kind:"VariableStatement",label:"variable canvas",start:4190,end:4267,uses:[],usedBy:[5313,0,36073],children:[]},{kind:"VariableStatement",label:"variable statusElement",start:4268,end:4343,uses:[],usedBy:[74971],children:[]},{kind:"VariableStatement",label:"variable buildInfoElement",start:4344,end:4425,uses:[],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable enterArButton",start:4426,end:4512,uses:[],usedBy:[75057,0],children:[]},{kind:"VariableStatement",label:"variable enterVrButton",start:4513,end:4599,uses:[],usedBy:[75057,0],children:[]},{kind:"VariableStatement",label:"variable midiFileInput",start:4600,end:4679,uses:[],usedBy:[27354,0,80344],children:[]},{kind:"VariableStatement",label:"variable drillFileInput",start:4680,end:4761,uses:[],usedBy:[0,80610],children:[]},{kind:"VariableStatement",label:"variable playButton",start:4762,end:4841,uses:[],usedBy:[43563,45578,78327,78684,0],children:[]},{kind:"VariableStatement",label:"variable stopButton",start:4842,end:4921,uses:[],usedBy:[43563,0],children:[]},{kind:"VariableStatement",label:"variable musicPositionInput",start:4922,end:5011,uses:[],usedBy:[43563,45578,0,92131],children:[]},{kind:"VariableStatement",label:"variable requestedPerformanceTestCount",start:5012,end:5145,uses:[],usedBy:[5146],children:[]},{kind:"VariableStatement",label:"variable performanceTestPerformerCount",start:5146,end:5311,uses:[5012],usedBy:[48581],children:[]},{kind:"VariableStatement",label:"variable engine",start:5313,end:5400,uses:[0,4190],usedBy:[5401,0,83191,90565],children:[]},{kind:"VariableStatement",label:"variable scene",start:5401,end:5433,uses:[0,5313],usedBy:[0,6137,6191,6799,7025,7348,7583,7745,10349,12134,12427,14061,15260,26621,27354,76835,90618],children:[]},{kind:"VariableStatement",label:"variable fieldLength",start:5527,end:5550,uses:[],usedBy:[5601,5687,5732,10349,13291,14061,27354],children:[]},{kind:"VariableStatement",label:"variable fieldWidth",start:5551,end:5576,uses:[],usedBy:[10349,13291,26621,27354],children:[]},{kind:"VariableStatement",label:"variable endZoneDepth",start:5577,end:5600,uses:[],usedBy:[5601,10349,27354],children:[]},{kind:"VariableStatement",label:"variable playingFieldLength",start:5601,end:5659,uses:[5527,5577],usedBy:[10349,13291],children:[]},{kind:"VariableStatement",label:"variable tabletopScale",start:5660,end:5686,uses:[],usedBy:[35033,35083,73153],children:[]},{kind:"VariableStatement",label:"variable lifeSizeScale",start:5687,end:5731,uses:[5527],usedBy:[6060,73153],children:[]},{kind:"VariableStatement",label:"variable yardsPerSceneUnit",start:5732,end:5776,uses:[5527],usedBy:[5777],children:[]},{kind:"VariableStatement",label:"variable eightToFiveStep",start:5777,end:5827,uses:[5732],usedBy:[5828,66638,66945,83191],children:[]},{kind:"VariableStatement",label:"variable fourStepInterval",start:5828,end:5873,uses:[5777],usedBy:[5874,5918],children:[]},{kind:"VariableStatement",label:"variable formationInterval",start:5874,end:5917,uses:[5828],usedBy:[25098,53292],children:[]},{kind:"VariableStatement",label:"variable rankInterval",start:5918,end:5956,uses:[5828],usedBy:[25098,53292],children:[]},{kind:"VariableStatement",label:"variable performerModelHeight",start:5957,end:5992,uses:[],usedBy:[6060],children:[]},{kind:"VariableStatement",label:"variable shoeSoleClearance",start:5993,end:6026,uses:[],usedBy:[83191,88181],children:[]},{kind:"VariableStatement",label:"variable fieldPaintHeight",start:6027,end:6059,uses:[],usedBy:[10349,12134,12427,83191,88181],children:[]},{kind:"VariableStatement",label:"variable physicalPerformerScale",start:6060,end:6136,uses:[5957,5687],usedBy:[36073,73153],children:[]},{kind:"VariableStatement",label:"variable fieldRoot",start:6137,end:6189,uses:[0,5401],usedBy:[10349,12134,12427,14061,15260,26621,27354,35132,73153,75451],children:[]},{kind:"VariableStatement",label:"variable camera",start:6191,end:6283,uses:[0,5401],usedBy:[0,6799],children:[]},{kind:"VariableStatement",label:"variable flyKeys",start:6522,end:6556,uses:[],usedBy:[0,6844],children:[]},{kind:"IfStatement",label:"IfStatement",start:6799,end:6841,uses:[5401,6191],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:6834,end:6841,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable verticalDirection",start:6844,end:6929,uses:[6522],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable skyMaterial",start:7025,end:7092,uses:[0,5401],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable skybox",start:7348,end:7457,uses:[0,5401],usedBy:[0,73153,90618],children:[]},{kind:"VariableStatement",label:"variable light",start:7583,end:7669,uses:[0,5401],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function material",start:7745,end:8030,uses:[0,5401],usedBy:[8032,8102,8185,8268,8343,8413,8488,8577,8655,8723,8795,8872,8947,9018,9110,9194,9278],children:[]},{kind:"VariableStatement",label:"variable turfMaterial",start:8032,end:8101,uses:[7745,0],usedBy:[10349],children:[]},{kind:"VariableStatement",label:"variable turfStripeMaterial",start:8102,end:8184,uses:[7745,0],usedBy:[10349],children:[]},{kind:"VariableStatement",label:"variable lineMaterial",start:8185,end:8267,uses:[7745,0],usedBy:[12134],children:[]},{kind:"VariableStatement",label:"variable endZoneMaterial",start:8268,end:8342,uses:[7745,0],usedBy:[10349,15260],children:[]},{kind:"VariableStatement",label:"variable trackMaterial",start:8343,end:8412,uses:[7745,0],usedBy:[10349],children:[]},{kind:"VariableStatement",label:"variable uniformMaterial",start:8413,end:8487,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable uniformTrimMaterial",start:8488,end:8576,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable pantsMaterial",start:8577,end:8654,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable skinMaterial",start:8655,end:8722,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable shoeMaterial",start:8723,end:8794,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable brassMaterial",start:8795,end:8871,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable drumMaterial",start:8872,end:8946,uses:[7745,0],usedBy:[15260],children:[]},{kind:"VariableStatement",label:"variable standMaterial",start:8947,end:9017,uses:[7745,0],usedBy:[26621],children:[]},{kind:"VariableStatement",label:"variable scoreboardFrameMaterial",start:9018,end:9109,uses:[7745,0],usedBy:[27354],children:[]},{kind:"VariableStatement",label:"variable goalpostMaterial",start:9110,end:9193,uses:[7745,0],usedBy:[14061],children:[]},{kind:"VariableStatement",label:"variable tabletopMaterial",start:9194,end:9277,uses:[7745,0],usedBy:[10349],children:[]},{kind:"VariableStatement",label:"variable tabletopGrabMaterial",start:9278,end:9349,uses:[7745,0],usedBy:[0,10349],children:[]},{kind:"VariableStatement",label:"variable sharedPerformerMeshes",start:9430,end:9484,uses:[0],usedBy:[9486],children:[]},{kind:"FunctionDeclaration",label:"function createSharedPerformerMesh",start:9486,end:9914,uses:[0,9430],usedBy:[9916,15260],children:[]},{kind:"FunctionDeclaration",label:"function createMergedPerformerMesh",start:9916,end:10347,uses:[0,9486],usedBy:[15260],children:[]},{kind:"FunctionDeclaration",label:"function createField",start:10349,end:12132,uses:[0,5527,5551,5401,6137,9194,8343,8032,5601,6027,8102,5577,8268,9278],usedBy:[34382],children:[]},{kind:"FunctionDeclaration",label:"function addMarking",start:12134,end:12425,uses:[0,5401,6137,6027,8185],usedBy:[13291],children:[]},{kind:"FunctionDeclaration",label:"function addYardNumber",start:12427,end:13289,uses:[0,5401,6137,6027],usedBy:[13291],children:[]},{kind:"FunctionDeclaration",label:"function createFieldMarkings",start:13291,end:14059,uses:[12134,5551,5527,5601,12427],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function createGoalPosts",start:14061,end:15258,uses:[0,5401,6137,5527,9110],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function createPerformer",start:15260,end:25096,uses:[0,5401,6137,9486,8577,8413,8655,8872,8723,8795,9916,8488,8268,2306],usedBy:[25098,36073],children:[]},{kind:"FunctionDeclaration",label:"function createBand",start:25098,end:26619,uses:[0,5874,5918,15260],usedBy:[34508],children:[]},{kind:"FunctionDeclaration",label:"function createStands",start:26621,end:27048,uses:[0,5401,6137,5551,8947],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function configureScoreboardTexture",start:27132,end:27352,uses:[0],usedBy:[27354],children:[]},{kind:"FunctionDeclaration",label:"function createScoreboard",start:27354,end:34380,uses:[0,5527,5577,5551,5401,6137,9018,27132,4600,78821,78327,78684,30195,27745],usedBy:[27745,34589],children:[{kind:"FunctionDeclaration",label:"function positionScoreboard",start:27745,end:28685,uses:[0,27354],usedBy:[27354],children:[]},{kind:"FunctionDeclaration",label:"function drawControlLabel",start:30195,end:30675,uses:[],usedBy:[27354],children:[]}]},{kind:"VariableStatement",label:"variable { field, tabletopBase, tabletopGrabSurface }",start:34382,end:34449,uses:[10349],usedBy:[0,76835],children:[]},{kind:"VariableStatement",label:"variable performers",start:34508,end:34540,uses:[25098],usedBy:[34541,36073,73153,91411],children:[]},{kind:"VariableStatement",label:"variable nativePerformerCount",start:34541,end:34588,uses:[34508],usedBy:[40976,43563,64691],children:[]},{kind:"VariableStatement",label:"variable scoreboardTexture",start:34589,end:34634,uses:[27354],usedBy:[72003],children:[]},{kind:"VariableStatement",label:"variable tabletopDragBehavior",start:34635,end:34689,uses:[0],usedBy:[0,75451],children:[]},{kind:"VariableStatement",label:"variable tabletopDragAttached",start:34999,end:35032,uses:[],usedBy:[75451],children:[]},{kind:"VariableStatement",label:"variable minimumTabletopScale",start:35033,end:35082,uses:[5660],usedBy:[35132],children:[]},{kind:"VariableStatement",label:"variable maximumTabletopScale",start:35083,end:35130,uses:[5660],usedBy:[35132],children:[]},{kind:"FunctionDeclaration",label:"function lockTabletopLevel",start:35132,end:35567,uses:[6137,0,35083,35033],usedBy:[0,75451],children:[]},{kind:"VariableStatement",label:"variable transport",start:35697,end:35730,uses:[0],usedBy:[42964,45578,78327,78684,78821,0,90727,91038],children:[]},{kind:"VariableStatement",label:"variable synth",start:35731,end:35782,uses:[0],usedBy:[0,42964,45578,78684,78821],children:[]},{kind:"VariableStatement",label:"variable musicRepeatCount",start:35808,end:35835,uses:[],usedBy:[36599,42964,43563,78327,78821,0,90727,92131],children:[]},{kind:"VariableStatement",label:"variable loadedMidi",start:35836,end:35871,uses:[0],usedBy:[40976,43563,45578,64691,70099,78327,78821,81235,0,90727,90831,90974,92131],children:[]},{kind:"VariableStatement",label:"variable loadedMidiName",start:35872,end:35910,uses:[],usedBy:[43563],children:[]},{kind:"VariableStatement",label:"variable drillTitle",start:35911,end:35946,uses:[],usedBy:[40976,43563,44387,45578,72003],children:[]},{kind:"VariableStatement",label:"variable drillCues",start:35947,end:35983,uses:[0],usedBy:[40976,43563,44387,45578,64691],children:[]},{kind:"VariableStatement",label:"variable calChartDrill",start:35984,end:36039,uses:[3784],usedBy:[40976,43563,45578,71843],children:[]},{kind:"VariableStatement",label:"variable lastScoreboardContent",start:36040,end:36071,uses:[],usedBy:[72003],children:[]},{kind:"FunctionDeclaration",label:"function setActivePerformerCount",start:36073,end:36597,uses:[34508,15260,6060,4190],usedBy:[40976,43563,45578],children:[]},{kind:"FunctionDeclaration",label:"function tickForMeasure",start:36599,end:36959,uses:[0,35808],usedBy:[40976],children:[]},{kind:"FunctionDeclaration",label:"function minimumCostAssignment",start:36961,end:38882,uses:[],usedBy:[39666],children:[]},{kind:"InterfaceDeclaration",label:"interface MarcherSquad",start:38884,end:38942,uses:[],usedBy:[38944,39170,39666],children:[]},{kind:"VariableStatement",label:"variable marcherSquads",start:38944,end:39168,uses:[38884],usedBy:[39666],children:[]},{kind:"FunctionDeclaration",label:"function squadLineCost",start:39170,end:39664,uses:[0,38884],usedBy:[39666],children:[]},{kind:"FunctionDeclaration",label:"function assignFormationSlots",start:39666,end:40974,uses:[0,38944,38884,39170,36961],usedBy:[40976],children:[]},{kind:"FunctionDeclaration",label:"function prepareDrill",start:40976,end:42962,uses:[2682,35836,35984,36073,34541,35911,36599,53292,63587,35947,39666,0,56296,61031,62473],usedBy:[44387],children:[]},{kind:"FunctionDeclaration",label:"function scheduleMidi",start:42964,end:43561,uses:[0,35697,35731,35808],usedBy:[43563],children:[]},{kind:"FunctionDeclaration",label:"function loadMidiData",start:43563,end:44385,uses:[0,35836,35872,42964,35947,35984,36073,34541,35911,4922,4762,4842,74971,35808],usedBy:[80385,0],children:[]},{kind:"FunctionDeclaration",label:"function loadDrillData",start:44387,end:44552,uses:[2682,40976,74971,35911,35947],usedBy:[49697],children:[]},{kind:"FunctionDeclaration",label:"function finiteNumber",start:44554,end:44763,uses:[],usedBy:[44765,45578,66945],children:[]},{kind:"FunctionDeclaration",label:"function validateCalChartMovement",start:44765,end:45576,uses:[0,44554],usedBy:[45578],children:[]},{kind:"FunctionDeclaration",label:"function prepareCalChartViewer",start:45578,end:48579,uses:[35836,3350,0,44554,44765,35984,35947,35911,36073,35697,35731,4922,4762,74971],usedBy:[48581,49697],children:[]},{kind:"FunctionDeclaration",label:"function prepareCalChartShw",start:48581,end:49500,uses:[0,5146,3350,45578,74971],usedBy:[80673,0],children:[]},{kind:"FunctionDeclaration",label:"function isCalChartViewerFile",start:49502,end:49695,uses:[3350],usedBy:[49697],children:[]},{kind:"FunctionDeclaration",label:"function loadDrillFile",start:49697,end:49856,uses:[49502,45578,44387,2682],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable alphabetGlyphs",start:49858,end:51739,uses:[0],usedBy:[52599],children:[]},{kind:"FunctionDeclaration",label:"function samplePolyline",start:51741,end:52597,uses:[0],usedBy:[53292],children:[]},{kind:"FunctionDeclaration",label:"function alphabetPositions",start:52599,end:53290,uses:[0,49858],usedBy:[53292],children:[]},{kind:"FunctionDeclaration",label:"function formationPositions",start:53292,end:56257,uses:[0,52599,51741,5874,5918],usedBy:[40976,64691],children:[]},{kind:"VariableStatement",label:"variable minimumSweptClearance",start:56259,end:56294,uses:[],usedBy:[59545,60648],children:[]},{kind:"FunctionDeclaration",label:"function precalculateCollisionSafePath",start:56296,end:59437,uses:[0,63867,60648],usedBy:[40976],children:[]},{kind:"InterfaceDeclaration",label:"interface SweptCollision",start:59439,end:59543,uses:[],usedBy:[59545,60648],children:[]},{kind:"FunctionDeclaration",label:"function firstSweptCollision",start:59545,end:60646,uses:[0,59439,56259],usedBy:[60648],children:[]},{kind:"FunctionDeclaration",label:"function reportPathCollision",start:60648,end:61029,uses:[0,59545,59439,56259],usedBy:[56296],children:[]},{kind:"FunctionDeclaration",label:"function precalculatePathProgress",start:61031,end:61786,uses:[0],usedBy:[40976],children:[]},{kind:"FunctionDeclaration",label:"function samplePrecalculatedPath",start:61788,end:62471,uses:[0],usedBy:[62473,64691],children:[]},{kind:"FunctionDeclaration",label:"function precalculateFootsteps",start:62473,end:63585,uses:[0,2147,61788],usedBy:[40976],children:[]},{kind:"FunctionDeclaration",label:"function facingAngle",start:63587,end:63865,uses:[],usedBy:[40976,64691],children:[]},{kind:"FunctionDeclaration",label:"function interpolateAngle",start:63867,end:64052,uses:[],usedBy:[56296,64054,64691],children:[]},{kind:"FunctionDeclaration",label:"function smoothAngle",start:64054,end:64207,uses:[63867],usedBy:[91538],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillMotion",start:64209,end:64295,uses:[0],usedBy:[64297,64502,66945,82526,83191,88181],children:[]},{kind:"InterfaceDeclaration",label:"interface CalChartMovementSample",start:64297,end:64413,uses:[0,64209],usedBy:[66945,69949,70099],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillDisplayCue",start:64415,end:64500,uses:[0],usedBy:[64502,72003],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillPlaybackState",start:64502,end:64689,uses:[64415,0,64209],usedBy:[64691,70006,70099,71843,72003,91341,91452,91497,91538,91690],children:[]},{kind:"FunctionDeclaration",label:"function nativeDrillState",start:64691,end:66636,uses:[64502,35947,0,53292,34541,63587,61788,35836,2147,63867,2682],usedBy:[71843],children:[]},{kind:"FunctionDeclaration",label:"function viewerPosition",start:66638,end:66777,uses:[0,5777],usedBy:[66945],children:[]},{kind:"FunctionDeclaration",label:"function viewerFacing",start:66779,end:66943,uses:[],usedBy:[66945],children:[]},{kind:"FunctionDeclaration",label:"function sampleCalChartMovement",start:66945,end:69947,uses:[0,64297,66638,44554,66779,64209,5777],usedBy:[70099],children:[]},{kind:"VariableStatement",label:"variable calChartFrameSamples",start:69949,end:70005,uses:[64297],usedBy:[70099],children:[]},{kind:"VariableStatement",label:"variable calChartFrameState",start:70006,end:70063,uses:[64502],usedBy:[70099],children:[]},{kind:"VariableStatement",label:"variable calChartFrameSheetIndex",start:70064,end:70097,uses:[],usedBy:[70099],children:[]},{kind:"FunctionDeclaration",label:"function calChartDrillState",start:70099,end:71841,uses:[3784,64502,35836,0,3350,70006,69949,64297,70064,66945],usedBy:[71843],children:[]},{kind:"FunctionDeclaration",label:"function currentDrillState",start:71843,end:72001,uses:[64502,35984,70099,64691],usedBy:[90907],children:[]},{kind:"FunctionDeclaration",label:"function drawScoreboard",start:72003,end:73151,uses:[64502,35911,64415,36040,34589],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function configureFieldScale",start:73153,end:73686,uses:[73818,5660,5687,6137,34508,6060,7348],usedBy:[76043,76835,0],children:[]},{kind:"VariableStatement",label:"variable xrExperience",start:73688,end:73743,uses:[0],usedBy:[74159,74228,75057,75451,76043,76835],children:[]},{kind:"VariableStatement",label:"variable requestingXr",start:73744,end:73769,uses:[],usedBy:[75057,76043],children:[]},{kind:"VariableStatement",label:"variable supportsAr",start:73770,end:73793,uses:[],usedBy:[75057,76835],children:[]},{kind:"VariableStatement",label:"variable supportsVr",start:73794,end:73817,uses:[],usedBy:[75057,76835],children:[]},{kind:"VariableStatement",label:"variable activeDisplayMode",start:73818,end:73897,uses:[],usedBy:[73153,74159,91130,91237,91667,92131],children:[]},{kind:"VariableStatement",label:"variable vrFlightAxes",start:73898,end:73934,uses:[],usedBy:[74283,74367,76835,79044],children:[]},{kind:"VariableStatement",label:"variable vrFlightForward",start:73935,end:73974,uses:[0],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable vrFlightRight",start:73975,end:74012,uses:[0],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable vrFlightMovement",start:74013,end:74053,uses:[0],usedBy:[0,74751],children:[]},{kind:"VariableStatement",label:"variable vrFlightDeadZone",start:74054,end:74084,uses:[],usedBy:[74283,74367],children:[]},{kind:"VariableStatement",label:"variable vrFlightSpeed",start:74085,end:74112,uses:[],usedBy:[0],children:[]},{kind:"IfStatement",label:"IfStatement",start:74159,end:74225,uses:[73818,73688],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:74218,end:74225,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable xrCamera",start:74228,end:74280,uses:[73688],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable strafe",start:74283,end:74364,uses:[73898,74054],usedBy:[74453,0],children:[]},{kind:"VariableStatement",label:"variable forward",start:74367,end:74450,uses:[73898,74054],usedBy:[74453,0],children:[]},{kind:"IfStatement",label:"IfStatement",start:74453,end:74495,uses:[74283,74367],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:74488,end:74495,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:74751,end:74822,uses:[74013],usedBy:[],children:[]},{kind:"FunctionDeclaration",label:"function setStatus",start:74971,end:75055,uses:[4268],usedBy:[43563,44387,45578,48581,76043,76835,80385,80673,0],children:[]},{kind:"FunctionDeclaration",label:"function updateButtons",start:75057,end:75449,uses:[73688,0,4426,73744,73770,4513,73794],usedBy:[76043,76835],children:[]},{kind:"FunctionDeclaration",label:"function configureXrInteraction",start:75451,end:76041,uses:[73688,34999,35132,34635,6137],usedBy:[76043,76835],children:[]},{kind:"FunctionDeclaration",label:"function enterXr",start:76043,end:76833,uses:[73688,73744,73153,75451,75057,74971],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function initializeXr",start:76835,end:78325,uses:[73688,5401,34382,79044,73898,73770,73794,0,73153,75451,75057,74971],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function togglePlayback",start:78327,end:78682,uses:[35836,0,35697,35808,4762],usedBy:[27354,79044,0],children:[]},{kind:"FunctionDeclaration",label:"function stopPlayback",start:78684,end:78819,uses:[35697,35731,4762],usedBy:[27354,79044,0],children:[]},{kind:"FunctionDeclaration",label:"function seekPlayback",start:78821,end:79042,uses:[35836,35697,35808,35731],usedBy:[27354,79044],children:[]},{kind:"FunctionDeclaration",label:"function initializeQuestController",start:79044,end:80137,uses:[0,73898,78327,78684,78821],usedBy:[76835],children:[]},{kind:"VariableStatement",label:"variable file",start:80344,end:80382,uses:[4600],usedBy:[80385],children:[]},{kind:"IfStatement",label:"IfStatement",start:80385,end:80553,uses:[80344,43563,74971],usedBy:[],children:[]},{kind:"VariableStatement",label:"variable file",start:80610,end:80649,uses:[4680],usedBy:[80652,80673,0],children:[]},{kind:"IfStatement",label:"IfStatement",start:80652,end:80670,uses:[80610],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:80663,end:80670,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:80673,end:80899,uses:[80610,48581,74971],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:80888,end:80895,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:81235,end:81259,uses:[35836],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:81252,end:81259,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable gaitProfiles",start:81493,end:82524,uses:[0],usedBy:[83191],children:[]},{kind:"FunctionDeclaration",label:"function travelGait",start:82526,end:83189,uses:[0,64209],usedBy:[91690],children:[]},{kind:"FunctionDeclaration",label:"function animatePerformerRig",start:83191,end:88179,uses:[0,64209,2306,81493,5777,5313,5993,6027],usedBy:[91667],children:[]},{kind:"FunctionDeclaration",label:"function animateSimplifiedPerformerRig",start:88181,end:90431,uses:[0,64209,2306,5993,6027],usedBy:[91667],children:[]},{kind:"VariableStatement",label:"variable arRigUpdateInterval",start:90433,end:90468,uses:[],usedBy:[90469,91130,91237],children:[]},{kind:"VariableStatement",label:"variable arRigUpdateAccumulator",start:90469,end:90518,uses:[90433],usedBy:[0,91130,91237],children:[]},{kind:"VariableStatement",label:"variable deltaSeconds",start:90565,end:90615,uses:[5313],usedBy:[0,91538],children:[]},{kind:"IfStatement",label:"IfStatement",start:90618,end:90724,uses:[7348,5401],usedBy:[],children:[]},{kind:"VariableStatement",label:"variable seconds",start:90727,end:90828,uses:[35836,35697,35808],usedBy:[90831,92131],children:[]},{kind:"VariableStatement",label:"variable ticks",start:90831,end:90904,uses:[35836,90727],usedBy:[90907,91757],children:[]},{kind:"VariableStatement",label:"variable drill",start:90907,end:90946,uses:[71843,90831],usedBy:[0,91341,91452,91497,91538,91690],children:[]},{kind:"VariableStatement",label:"variable stepTicks",start:90974,end:91035,uses:[35836],usedBy:[91757],children:[]},{kind:"VariableStatement",label:"variable marching",start:91038,end:91085,uses:[35697],usedBy:[91667],children:[]},{kind:"VariableStatement",label:"variable updateRig",start:91130,end:91234,uses:[73818,90469,90433],usedBy:[91237,91667],children:[]},{kind:"IfStatement",label:"IfStatement",start:91237,end:91338,uses:[91130,73818,90469,90433],usedBy:[],children:[]},{kind:"ForStatement",label:"ForStatement",start:91341,end:92128,uses:[90907,64502,91411,91452,91538],usedBy:[91411,91452,91497,91538,91690],children:[{kind:"VariableStatement",label:"variable performer",start:91411,end:91447,uses:[34508,91341],usedBy:[91538,91341,91667],children:[]},{kind:"VariableStatement",label:"variable position",start:91452,end:91492,uses:[90907,64502,91341],usedBy:[91341],children:[]},{kind:"VariableStatement",label:"variable motion",start:91497,end:91533,uses:[90907,64502,91341],usedBy:[91690,91667],children:[]},{kind:"VariableStatement",label:"variable facing",start:91538,end:91623,uses:[64054,91411,90907,64502,91341,90565],usedBy:[91690,91667,91341],children:[]},{kind:"IfStatement",label:"IfStatement",start:91667,end:92050,uses:[91130,91411,73818,88181,91757,91690,91497,91038,83191,91538],usedBy:[],children:[{kind:"VariableStatement",label:"variable gait",start:91690,end:91750,uses:[82526,90907,64502,91341,91497,91538],usedBy:[91667],children:[]},{kind:"VariableStatement",label:"variable stepPhase",start:91757,end:91807,uses:[90831,90974],usedBy:[91667],children:[]}]}]},{kind:"IfStatement",label:"IfStatement",start:92131,end:92278,uses:[35836,73818,4922,90727,35808],usedBy:[],children:[]}]},Pe=document.getElementById("build-info"),Be=document.getElementById("status"),Le=document.getElementById("render-canvas"),re=document.getElementById("enter-ar-button"),ie=document.getElementById("enter-vr-button"),Ie=document.getElementById("controller-palette");function x(e){Be&&(Be.textContent=e)}function fe(){const e=E?.baseExperience.state===O.IN_XR;re&&(re.textContent=e?"Quest 3 AR Active":"Enter Quest 3 AR",re.disabled=_||e||!ue),ie&&(ie.textContent=e?"VR Active":"Enter VR",ie.disabled=_||e||!Se)}function rn(){if(!Pe)return;const e=Number(xe.buildNumber),n=`${xe.name} v${xe.version} · build ${e} · production`;Pe.textContent=n}Ve.UseOnlineRepository=!0;Ve.PrioritizeOnlineRepository=!0;const Ce=new Ye(Le,!0,{adaptToDeviceRatio:!0,antialias:!0}),b=new Qe(Ce);b.clearColor=new he(0,0,0,0);const $e=new Ke("cam",-Math.PI/2,Math.PI/3,3,l.Zero(),b);$e.attachControl(Le,!1);$e.inputs.clear();const on=new en("light",new l(0,1,0),b);on.intensity=.9;const j=new Ee("sceneRoot",b),D=[],se=new Map,pe=new Map,Xe=new WeakSet,qe=new WeakMap;let N=null;const oe=[],ge=new Map,H=new Map,J=new Map,le=new Map,ce=new Set,Q=new Map;let R=null,I=null,P=null,de=null;const z=new Map,X=new Map,K=[];let v=null,U=null,ee=null,F=null,be=!1,E=null,_=!1,ue=!1,Se=!1;function sn(e){Ie&&Ie.classList.toggle("visible",e)}function Z(e){if(!e){for(const[a,r]of X)Me(a,r.diffuseColor,r.emissiveColor);z.clear(),X.clear();return}const n=z.get(e);if(!n)return;z.delete(e);const t=X.get(n);t&&(t.owners.delete(e),!(t.owners.size>0)&&(Me(n,t.diffuseColor,t.emissiveColor),X.delete(n)))}function Me(e,n,t){if(Xe.has(e)){e.instancedBuffers.color=new he(n.r,n.g,n.b,1);return}const a=e.material;a?.diffuseColor.copyFrom(n),a?.emissiveColor.copyFrom(t)}function _e(e){const n=X.get(e);if(!n)return;const t=Array.from(n.owners).some(a=>(Q.get(a)??!1)||ce.has(a));Me(e,t?new y(.25,.7,.7):new y(.18,.42,.42),t?new y(.35,1,1):new y(.08,.35,.32))}function ln(e,n){if(n){const r=z.get(e);r&&r!==n&&Z(e)}else{Z(e);return}const t=n.material;if(!t)return;let a=X.get(n);if(!a){const r=qe.get(n)??t.diffuseColor;a={emissiveColor:t.emissiveColor.clone(),diffuseColor:r.clone(),owners:new Set},X.set(n,a)}a.owners.add(e),z.set(e,n),_e(n)}function ye(){if(We(),D.length>0)return;const e=Bn(an);x(`🧠 AST scene built (${e} nodes)`)}const cn=new Set(["as","async","await","break","case","catch","class","const","continue","default","delete","do","else","export","extends","false","finally","for","from","function","if","implements","import","in","instanceof","interface","let","new","null","of","private","protected","public","readonly","return","static","super","switch","this","throw","true","try","type","typeof","undefined","void","while","with","yield"]);function dn(e){let n=!1;return e.map(t=>{const a=[];let r=0;for(;r<t.length;){if(n){const m=t.indexOf("*/",r),c=m<0?t.length:m+2;a.push({text:t.slice(r,c),kind:"comment"}),r=c,n=m<0;continue}if(t.startsWith("//",r)){a.push({text:t.slice(r),kind:"comment"});break}if(t.startsWith("/*",r)){const m=t.indexOf("*/",r+2),c=m<0?t.length:m+2;a.push({text:t.slice(r,c),kind:"comment"}),r=c,n=m<0;continue}const s=t.slice(r),u=s.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/),o=s.match(/^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i),i=s.match(/^[A-Za-z_$][\w$]*/),f=s.match(/^\s+/);if(u)a.push({text:u[0],kind:"string"});else if(o)a.push({text:o[0],kind:"number"});else if(i){const m=i[0],c=cn.has(m)?"keyword":/^[A-Z]/.test(m)?"type":"plain";a.push({text:m,kind:c})}else f?a.push({text:f[0],kind:"plain"}):a.push({text:s[0],kind:/[=+\-*/%!?<>|&:^~]/.test(s[0])?"operator":"plain"});r+=a[a.length-1].text.length}return a})}function Oe(e){if(!ee)return;const n=ee.getContext();n.fillStyle="#06151b",n.fillRect(0,0,1024,576);const t=e?.metadata,a=t?.sourceStart!==void 0&&t.sourceEnd!==void 0,r=ve.replace(/\t/g,"  ").split(/\r?\n/),s=dn(r),u=a?ve.slice(0,t.sourceStart).split(`
`).length:1,o=a?ve.slice(0,t.sourceEnd).split(`
`).length:0,i=14,f=Math.max(1,Math.min(u-4,r.length-i+1)),m=r.slice(f-1,f-1+i),c=f+m.length-1,d=t?.astLabel??"chart-xr.ts",g=t?.astKind??(e?"Manual node - showing complete source":"Complete program source");n.fillStyle="#72f0ff",n.font="bold 30px monospace",n.fillText(d.slice(0,52),38,48),n.fillStyle="#6f91a0",n.font="22px monospace",n.fillText(g,38,80);const S=`${f}-${c} / ${r.length}`;n.fillText(S,986-n.measureText(S).width,80),n.fillStyle="#17404a",n.fillRect(38,96,948,2),n.font="24px monospace",m.forEach((w,B)=>{const M=f+B,T=130+B*30,L=a&&M>=u&&M<=o;L&&(n.fillStyle="#123b44",n.fillRect(30,T-23,956,29)),n.fillStyle=L?"#72f0ff":"#4d7582",n.fillText(String(M).padStart(4," "),38,T);let h=118,p=70;for(const k of s[M-1]){if(p<=0)break;const C=k.text.slice(0,p),A={plain:"#d8e7ec",keyword:"#ff78bd",type:"#72e6c1",string:"#ffd580",number:"#b8a0ff",comment:"#668995",operator:"#72d9ff"};n.fillStyle=A[k.kind],n.fillText(C,h,T),h+=n.measureText(C).width,p-=C.length}}),ee.update()}function We(){if(v)return;v=new Ee("source-tablet",b),v.parent=j,v.position=new l(.42,.28,.38),v.rotationQuaternion=q.RotationYawPitchRoll(Math.PI,0,0);const e=new W("tablet-frame-material",b);e.diffuseColor=new y(.035,.045,.06),e.emissiveColor=new y(.008,.012,.02);const n=new W("tablet-screen-material",b);n.diffuseColor=new y(.02,.08,.1),n.emissiveColor=new y(.02,.45,.55),n.disableLighting=!0,U=V.CreateBox("tablet-body",{width:.46,height:.29,depth:.022},b),U.parent=v,U.material=e,U.isPickable=!0;const t=V.CreatePlane("tablet-screen",{width:.42,height:.245},b);t.parent=v,t.position.z=.012,t.rotation.y=Math.PI,t.material=n,t.isPickable=!1;const a=V.CreateBox("tablet-handle",{width:.16,height:.025,depth:.035},b);a.parent=v,a.position.y=-.165,a.material=e,a.isPickable=!1,ee=new ze("tablet-screen-texture",{width:1024,height:576},b,!0),Oe(null),n.diffuseTexture=ee,n.emissiveTexture=ee}function Te(e){return e==="SourceFile"?new y(.82,.88,.95):e==="FunctionDeclaration"?new y(.1,.72,.9):e==="ClassDeclaration"?new y(.95,.55,.15):e==="InterfaceDeclaration"?new y(.2,.78,.42):e==="VariableStatement"?new y(.35,.48,.95):e==="ReturnStatement"?new y(.9,.3,.65):e.endsWith("Statement")?new y(.95,.3,.25):new y(.55,.62,.72)}function un(e,n,t=.075,a=!1){const r=document.createElement("canvas").getContext("2d"),s=48;r&&(r.font=`bold ${s}px sans-serif`);const u=r?.measureText(n).width??n.length*s*.6,o=Math.max(12,Math.floor(s*Math.min(1,2e3/Math.max(u,1)))),i=`bold ${o}px sans-serif`;r&&(r.font=i);const m=(r?.measureText(n).width??n.length*o*.6)+48,c=Math.min(2048,Math.max(256,2**Math.ceil(Math.log2(m)))),d=128,S=.06*c/d,w=V.CreatePlane(`${e.name}_label`,{width:S,height:.06},b);w.parent=e,w.position.y=t,w.billboardMode=tn.BILLBOARDMODE_ALL,w.isPickable=a,a&&pe.set(w,e);const B=new ze(`${e.name}_label_texture`,{width:c,height:d},b,!0);B.hasAlpha=!0,B.drawText(n,null,84,i,"#ffffff","rgba(7, 17, 31, 0.88)",!0,!0);const M=new W(`${e.name}_label_material`,b);M.diffuseTexture=B,M.emissiveTexture=B,M.opacityTexture=B,M.disableLighting=!0,M.backFaceCulling=!1,w.material=M,w.onDisposeObservable.add(()=>{pe.delete(w),M.dispose(!1,!0)})}function Ze(e,n,t="ManualNode",a=new l(.08,.08,.08),r=1){const s=`box_${D.length}`,u=t==="VariableStatement"&&r===1;let o;if(u){if(!N){N=V.CreatePolyhedron("variable-octahedron-source",{type:1,size:a.x/(2*Math.SQRT2),flat:!0},b),N.position.y=-1e3,N.isPickable=!1,N.useVertexColors=!0,N.registerInstancedBuffer("color",4),N.instancedBuffers.color=new he(1,1,1,1);const f=new W("variable-octahedron-material",b);f.diffuseColor=y.White(),f.emissiveColor=new y(.094,.094,.094),N.material=f}o=N.createInstance(s);const i=Te(t);Xe.add(o),qe.set(o,i),o.instancedBuffers.color=new he(i.r,i.g,i.b,1)}else{o=V.CreateBox(s,{width:a.x,height:a.y,depth:a.z},b);const i=new W(`boxMat_${D.length}`,b);i.diffuseColor=Te(t),i.emissiveColor=new y(.094,.094,.094),i.alpha=r,i.backFaceCulling=r===1,o.material=i}return o.position.copyFrom(e),o.rotationQuaternion=q.Identity(),o.parent=j,o.isPickable=r===1,o.computeWorldMatrix(!0),D.push(o),un(o,n??`Node ${D.length}`,a.y/2+.035,r<1),o}function De(e,n){const t=n.position.subtract(e.position),a=e.getBoundingInfo().boundingBox.extendSize,r=e.position.clone();return Math.abs(t.x)>=Math.abs(t.y)&&Math.abs(t.x)>=Math.abs(t.z)?r.x+=Math.sign(t.x)*a.x:Math.abs(t.y)>=Math.abs(t.z)?r.y+=Math.sign(t.y)*a.y:r.z+=Math.sign(t.z)*a.z,r}function mn(e,n){const t=se.get(e);if(!t)return n;const a=t.getBoundingInfo().boundingBox.extendSize,r=e.getBoundingInfo().boundingBox.extendSize,s=.03,u=new l(Math.max(0,a.x-r.x-s),Math.max(0,a.y-r.y-s),Math.max(0,a.z-r.z-s)),o=t.position.subtract(u),i=t.position.add(u);return new l(Math.max(o.x,Math.min(n.x,i.x)),Math.max(o.y,Math.min(n.y,i.y)),Math.max(o.z,Math.min(n.z,i.z)))}function hn(e,n){const t=mn(e,n),a=t.subtract(e.position);if(!(a.lengthSquared()<1e-12)){e.position.copyFrom(t),e.computeWorldMatrix(!0);for(const r of D){let s=se.get(r);for(;s;){if(s===e){r.position.addInPlace(a),r.computeWorldMatrix(!0);break}s=se.get(s)}}}}function Ge(){for(const e of oe){const n=De(e.startNode,e.endNode),t=De(e.endNode,e.startNode),a=t.subtract(n),r=Math.max(a.length(),1e-4),s=a.scale(1/r),u=.12,o=Math.min(.08,r*.4),i=Math.max(r-o,.001),f=Math.max(.021,e.weight*.03),m=n.add(s.scale(i/2));e.shaft.position.copyFrom(m),e.shaft.scaling=new l(f,i,f);const c=l.Up(),d=l.Cross(c,s),g=Math.acos(Math.max(-1,Math.min(1,l.Dot(c,s))));e.shaft.rotationQuaternion=d.lengthSquared()<1e-6?q.Identity():q.RotationAxis(d.normalize(),g);const S=t.subtract(s.scale(o/2)),w=Math.max(.016,f*2.4);e.head.position.copyFrom(S),e.head.scaling=new l(w,o/u,w),e.head.rotationQuaternion=e.shaft.rotationQuaternion?.clone()??q.Identity()}}function fn(e){for(const[a,r]of Array.from(z.entries()))r===e&&Z(a);const n=D.indexOf(e);n>=0&&D.splice(n,1),se.delete(e);const t=oe.filter(a=>a.startNode===e||a.endNode===e);for(const a of t)a.shaft.dispose(),a.head.dispose();for(const a of t){const r=oe.indexOf(a);r>=0&&oe.splice(r,1)}e.dispose()}function He(e){return e.inputSource.handedness==="left"?"left":"right"}function Ue(e){const n=e.motionController;if(!n)return{x:0,y:0};const t=n.getComponent("thumbstick")??n.getComponent("xr-standard-thumbstick")??n.getComponentOfType("thumbstick")??n.getComponent("touchpad");if(!t)return{x:0,y:0};const a=t.axes,r=a?.x??0,s=a?.y??0;return{x:Math.abs(r)<.2?0:r,y:Math.abs(s)<.2?0:s}}function pn(e){return-Ue(e).y*.02}function gn(e){const n=b.activeCamera;if(!n)return;const t=n.getDirection(l.Forward());if(t.y=0,t.lengthSquared()<1e-6)return;t.normalize();const a=l.Cross(t,l.Up()).normalize(),r=l.Zero(),s=.8,u=1.2;let o=0;for(const c of K){if(ce.has(c)||J.has(c))continue;const d=Ue(c);He(c)==="left"?(r.addInPlace(a.scale(-d.x)),r.addInPlace(t.scale(d.y))):(r.addInPlace(l.Up().scale(d.y)),o-=d.x*u*e)}r.scaleInPlace(s*e);const i=n.globalPosition,f=Math.cos(o),m=Math.sin(o);for(const c of D){if(c.position.addInPlace(r),Math.abs(o)>1e-6){const d=c.position.x-i.x,g=c.position.z-i.z;c.position.x=i.x+d*f+g*m,c.position.z=i.z-d*m+g*f}c.computeWorldMatrix(!0)}if(v&&!F){if(v.position.addInPlace(r),Math.abs(o)>1e-6){const c=v.position.x-i.x,d=v.position.z-i.z;v.position.x=i.x+c*f+d*m,v.position.z=i.z-c*m+d*f,v.rotate(l.Up(),-o)}v.computeWorldMatrix(!0)}}function bn(e){const a=((e.pointer??e.grip)?.getDirection?.(l.Forward())??l.Forward()).normalize();let r=l.Cross(a,l.Up());r.lengthSquared()<1e-6&&(r=l.Cross(a,l.Forward())),r.normalize();const s=l.Cross(r,a);return s.normalize(),{depthAxis:a,rightAxis:r,upAxis:s}}function Y(e,n=!0,t=!1){if(n){const m=H.get(e);if(m)return m}if(E?.baseExperience.state===O.IN_XR&&!e._lastXRPose){const m={mesh:null,point:null};return n&&H.set(e,m),m}const a=e.pointer??e.grip;if(!a)return null;const r=a.absolutePosition?.clone()??l.Zero(),u=(a.getDirection?.(l.Forward())??l.Forward()).normalize();let o=l.Cross(u,l.Up());o.lengthSquared()<1e-6&&(o=l.Cross(u,l.Forward())),o.normalize();const i=[u,u.add(o.scale(.08)).normalize(),u.add(o.scale(-.08)).normalize(),u.add(o.scale(.16)).normalize(),u.add(o.scale(-.16)).normalize()];for(const m of i){const c=new Ne(r,m);c.length=8;const d=b.pickWithRay(c,g=>D.includes(g)||t&&pe.has(g));if(d?.pickedMesh){const S={mesh:pe.get(d.pickedMesh)??d.pickedMesh,point:d.pickedPoint?.clone()??r.add(m.scale(.8))};return n&&H.set(e,S),S}}const f={mesh:null,point:null};return n&&H.set(e,f),f}function we(e,n=!1){return Y(e,!n,n)?.mesh??null}function yn(e){const n=[e.pointer?.absolutePosition,e.grip?.absolutePosition].filter(s=>!!s);if(n.length===0)return null;const t=.025**2;let a=null,r=Number.POSITIVE_INFINITY;for(const s of D){if(!s.isPickable)continue;s.computeWorldMatrix(!0);const u=s.getBoundingInfo().boundingBox;for(const o of n){const i=Math.max(u.minimumWorld.x,Math.min(o.x,u.maximumWorld.x)),f=Math.max(u.minimumWorld.y,Math.min(o.y,u.maximumWorld.y)),m=Math.max(u.minimumWorld.z,Math.min(o.z,u.maximumWorld.z)),c=l.DistanceSquared(o,new l(i,f,m));c<=t&&c<r&&(a=s,r=c)}}return a}function Fe(e){if(!U||F&&F!==e)return!1;const n=e.pointer??e.grip;if(!n)return!1;const t=n.absolutePosition?.clone()??l.Zero(),a=n.getDirection?.(l.Forward()).normalize()??l.Forward(),r=new Ne(t,a,8);return b.pickWithRay(r,s=>s===U)?.pickedMesh===U}function xn(){if(!v||!F)return;const e=F.grip??F.pointer,n=b.activeCamera;!e?.absolutePosition||!n||(v.position.copyFrom(e.absolutePosition.add(l.Up().scale(.09))),v.lookAt(n.globalPosition),v.computeWorldMatrix(!0))}function me(){v||We();const e=b.activeCamera;if(!v||!e)return;F=null;const n=e.getDirection(l.Forward()).normalize();v.position.copyFrom(e.globalPosition.add(n.scale(.65)).add(l.Down().scale(.12))),v.lookAt(e.globalPosition),v.computeWorldMatrix(!0),x("📟 Tablet summoned")}function vn(e){const n=V.CreateCylinder(`beam_${e.uniqueId??"controller"}`,{height:1,diameter:.008,tessellation:6},b);n.parent=j,n.isPickable=!1;const t=new W(`beamMat_${e.uniqueId??"controller"}`,b);return t.diffuseColor=new y(.2,.8,1),t.emissiveColor=new y(.1,.35,.7),t.alpha=.9,t.disableLighting=!0,n.material=t,n}function Sn(e,n){const t=e.pointer??e.grip,a=ge.get(e)??vn(e);if(ge.set(e,a),!t){a.setEnabled(!1);return}const r=t.absolutePosition?.clone()??l.Zero(),u=(t.getDirection?.(l.Forward())??l.Forward()).normalize(),o=n??Y(e),i=J.get(e)??null,f=i?i.position.clone():o?.point,m=f?l.Distance(r,f):2.2;if(a.setEnabled(!0),a.position.copyFrom(r.add(u.scale(m/2))),a.scaling.y=m,a.scaling.x=1,a.scaling.z=1,u.lengthSquared()>1e-6){const c=l.Up(),d=l.Cross(c,u),g=Math.acos(Math.max(-1,Math.min(1,l.Dot(c,u))));a.rotationQuaternion=d.lengthSquared()<1e-6?q.Identity():q.RotationAxis(d.normalize(),g)}else a.rotationQuaternion=q.Identity()}function Mn(e,n){const t=e.pointer??e.grip,r=(n??Y(e))?.mesh??null;if(!t){Z(e);return}r?z.get(e)!==r&&ln(e,r):Z(e)}function ke(e){return K.filter(t=>t!==e)[0]??null}function Je(e){const n=[I===e?ke(e):e,e].filter(t=>!!t);for(const t of n){const a=we(t)??z.get(t)??null;if(a&&a!==R)return a}return null}function Cn(e,n){const t=e.pointer??e.grip;if(!t)return l.Zero();const a=t.absolutePosition?.clone()??l.Zero(),s=(t.getDirection?.(l.Forward())??l.Forward()).normalize(),u=I===e?ke(e):e,o=n??Y(u||e);return o?.point?o.point.clone():a.add(s.scale(.8))}function ne(){de&&(de.dispose(),de=null)}function wn(e,n){if(!R||I!==e){P&&(P.dispose(),P=null);const o=n?.mesh??null;if(o){const i=n?.point?.clone()??e.pointer?.absolutePosition?.clone()??e.grip?.absolutePosition?.clone()??l.Zero(),f=o.position.clone();ne();const m=V.CreateLines("hover-connection-preview",{points:[i,f]},b);m.color=new y(.2,.85,1),m.alpha=.35,m.parent=j,m.isPickable=!1,de=m}else ne();return}ne();const t=ke(e),a=t?Y(t):null,s=(a?.mesh??null)?.position?.clone()??Cn(t??e,a??void 0);P&&P.dispose();const u=V.CreateLines("connection-preview",{points:[R.position.clone(),s]},b);u.color=new y(.35,1,1),u.alpha=1,u.parent=j,u.isPickable=!1,P=u}function kn(e){return e==="reference"?{diffuse:new y(1,.25,.82),emissive:new y(.9,.12,.65),head:new y(1,.42,.9)}:e==="user"?{diffuse:new y(1,.72,.18),emissive:new y(.95,.5,.08),head:new y(1,.84,.35)}:{diffuse:new y(.35,1,1),emissive:new y(.25,.9,1),head:new y(.45,1,1)}}function je(e,n,t=1,a="user"){const r=kn(a),s=V.CreateCylinder("connection-shaft",{height:1,diameter:.04,tessellation:12},b);s.parent=j,s.isPickable=!1,s.metadata={connectionKind:a};const u=new W("connection-shaft-mat",b);u.diffuseColor=r.diffuse,u.emissiveColor=r.emissive,u.disableLighting=!0,s.material=u;const o=V.CreateCylinder("connection-head",{height:.12,diameterTop:.001,diameterBottom:.08,tessellation:12},b);o.parent=j,o.isPickable=!1,o.metadata={connectionKind:a};const i=new W("connection-head-mat",b);return i.diffuseColor=r.head,i.emissiveColor=r.emissive,i.disableLighting=!0,o.material=i,oe.push({shaft:s,head:o,startNode:e,endNode:n,weight:t,kind:a}),Ge(),s}class Pn{constructor(n,t,a,r){this.idealEdgeLength=n,this.depthSpacing=t,this.origin=a,this.iterations=r}layout(n,t){const a=Math.PI*(3-Math.sqrt(5)),r=n.map((o,i)=>{const f=this.idealEdgeLength*Math.sqrt(i+1)*.45,m=i*a;return new l(Math.cos(m)*f,Math.sin(m)*f*.25,-o.depth*this.depthSpacing)}),s=this.idealEdgeLength*this.idealEdgeLength;for(let o=0;o<this.iterations;o+=1){const i=n.map(()=>l.Zero());for(let c=0;c<r.length;c+=1)for(let d=c+1;d<r.length;d+=1){const g=r[c].subtract(r[d]),S=Math.max(g.length(),.001),w=g.scale(s/(S*S*S));i[c].addInPlace(w),i[d].subtractInPlace(w)}for(const c of t){const d=r[c.targetIndex].subtract(r[c.sourceIndex]),g=Math.max(d.length(),.001),S=g-this.idealEdgeLength,w=d.scale(S*c.strength/g);i[c.sourceIndex].addInPlace(w),i[c.targetIndex].subtractInPlace(w)}n.forEach((c,d)=>{const g=-c.depth*this.depthSpacing;i[d].z+=(g-r[d].z)*.35,i[d].y-=r[d].y*.08});const f=o/Math.max(this.iterations-1,1),m=this.idealEdgeLength*(.22*(1-f)+.01);r.forEach((c,d)=>{const g=i[d].length();g>1e-6&&c.addInPlace(i[d].scale(Math.min(g,m)/g))})}const u=r.reduce((o,i)=>o.addInPlace(i),l.Zero()).scaleInPlace(1/r.length);return r.map(o=>this.origin.add(o.subtract(u)))}}function Bn(e,n={}){const t=n.maxDepth??3,a=n.maxNodes??72,r=n.horizontalSpacing??.14,s=n.depthSpacing??.2,u=n.layoutIterations??120,o=n.origin?.clone()??new l(0,.1,0),i=[{node:e,parentIndex:null,depth:0}];for(let h=0;h<i.length&&i.length<a;h+=1){const p=i[h];if(!(p.depth>=t))for(const k of p.node.children){if(i.length>=a)break;i.push({node:k,parentIndex:h,depth:p.depth+1})}}const f=new Map;i.forEach((h,p)=>f.set(h.node.start,p));const m=i.flatMap((h,p)=>h.parentIndex===null?[]:[{sourceIndex:h.parentIndex,targetIndex:p,strength:.9}]),c=[],d=new Set,g=(h,p)=>{const k=f.get(h),C=f.get(p),A=`${h}:${p}`;k===void 0||C===void 0||k===C||d.has(A)||(d.add(A),c.push({sourceIndex:k,targetIndex:C,strength:.4}))};i.forEach(h=>{h.node.uses.forEach(p=>{const k=i[f.get(p)??-1]?.node,C=h.node.kind==="FunctionDeclaration"&&k?.kind==="FunctionDeclaration";g(C?h.node.start:p,C?p:h.node.start)}),h.node.usedBy.forEach(p=>{const k=i[f.get(p)??-1]?.node,C=h.node.kind==="FunctionDeclaration"&&k?.kind==="FunctionDeclaration";g(C?p:h.node.start,C?h.node.start:p)})});const S=new Array(i.length),B=new Pn(r,s,o,u).layout(i,[...m,...c]),M=i.map(()=>[]);i.forEach((h,p)=>{h.parentIndex!==null&&M[h.parentIndex].push(p)});const T=B.map(h=>h.clone()),L=B.map(()=>.04);for(let h=i.length-1;h>=0;h-=1){const p=M[h];if(p.length===0)continue;const k=p.reduce((ae,$)=>{const G=L[$];return l.Minimize(ae,T[$].subtract(new l(G,G,G)))},new l(Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY)),C=p.reduce((ae,$)=>{const G=L[$];return l.Maximize(ae,T[$].add(new l(G,G,G)))},new l(Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY)),A=k.add(C).scale(.5),te=p.reduce((ae,$)=>Math.max(ae,l.Distance(A,T[$])+L[$]),0)+.08;T[h]=A,L[h]=te}return i.forEach((h,p)=>{const k=h.node.label,C=M[p].length>0,A=L[p]*2,te=Ze(T[p],k,h.node.kind,C?new l(A,A,A):void 0,C?.1:1);te.name=`ast_${p}_${k.replace(/[^a-z0-9]+/gi,"_")}`,te.metadata={astKind:h.node.kind,astLabel:k,sourceStart:h.node.start,sourceEnd:h.node.end},S[p]=te}),i.forEach((h,p)=>{h.parentIndex!==null&&M[h.parentIndex].length>0&&se.set(S[p],S[h.parentIndex])}),c.forEach(h=>{if(M[h.sourceIndex].length>0&&M[h.targetIndex].length>0)return;const p=i[h.sourceIndex].node.start,k=i[h.targetIndex].node.start,C=je(S[h.sourceIndex],S[h.targetIndex],.3,"reference");C.metadata={...C.metadata,fromId:p,toId:k}}),S.length}function Ae(e){const n=yn(e);return n?(fn(n),!0):!1}function Re(e){const t=(e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero()).add(new l(0,.02,0));Ze(t),x(`📦 Placed box (${D.length})`)}function In(e){const n=we(e)??z.get(e)??null;if(Oe(n),R&&I&&I!==e){Je(e)?Tn(e):x("🔗 Point the second controller at the destination node");return}if(I===e)return;const t=n;t?(R=t,I=e,x("🔗 Select the destination with the other controller")):(R=null,I=null,P?.dispose(),P=null,ne(),x("🔗 Point at a node to start a connection"))}function Tn(e){const n=I,t=Je(e);if(R&&t&&t!==R){if(je(R,t),n&&(Q.get(n)??!1)){P?.dispose(),P=null,x("🔗 Connection drawn — select another destination");return}x("🔗 Connection drawn")}else x("🔗 Connection cancelled");R=null,I=null,P?.dispose(),P=null,ne()}function Dn(){R=null,I=null,P?.dispose(),P=null,ne(),x("🔗 Connection cancelled")}function Fn(e){const n=e.motionController;if(!n)return;const t=He(e),a=t==="left",r=t==="right",s=n.getComponent("trigger")??n.getComponent("xr-standard-trigger")??n.getComponent("squeeze")??n.getComponentOfType("trigger")??n.getComponentOfType("squeeze");s&&s.onButtonStateChangedObservable.add(d=>{const g=Q.get(e)??!1;if(d.pressed&&!g){if(Fe(e)){x("📟 Read-only source tablet"),n.pulse?.(.15,50);return}Q.set(e,!0),In(e),n.pulse?.(.15,50)}else!d.pressed&&g&&(Q.set(e,!1),I===e&&Dn())});const u=n.getComponent("squeeze")??n.getComponentOfType("squeeze");u&&u.onButtonStateChangedObservable.add(d=>{if(d.pressed?ce.add(e):ce.delete(e),d.pressed){if(Fe(e))F=e,x("🤏 Tablet grabbed — release grip to place it");else{const g=we(e,!0);if(!g){x("🎯 Hold grip on a box or tablet to move it"),n.pulse?.(.3,100);return}J.set(e,g);const S=e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero(),B=(e.pointer?.getDirection?.(l.Forward())??l.Forward()).normalize(),M=g.position.subtract(S),T=l.Dot(M,B);le.set(e,T<.01?.15:T),x("🤏 Grip grabbed distant box")}n.pulse?.(.3,100)}else F===e?(F=null,x("✋ Tablet released")):J.has(e)&&(J.delete(e),le.delete(e),x("✋ Box released"))});const o=n.getComponent("a-button")??n.getComponent("x-button"),i=n.getComponent("x-button")??n.getComponent("y-button")??n.getComponent("a-button");o&&(r||!a&&!r)&&o.onButtonStateChangedObservable.add(d=>{d.pressed&&(Ae(e)||me(),n.pulse?.(.2,70))}),i&&(a||!a&&!r)&&i.onButtonStateChangedObservable.add(d=>{d.pressed&&(Ae(e)||me(),n.pulse?.(.2,70))});const f=n.getComponent("b-button")??n.getComponent("y-button")??n.getComponent("a-button");f&&(r||!a&&!r)&&f.onButtonStateChangedObservable.add(d=>{d.pressed&&(Re(e),n.pulse?.(.2,70))});const m=n.getComponent("y-button");m&&a&&m.onButtonStateChangedObservable.add(d=>{d.pressed&&(Re(e),n.pulse?.(.2,70))});const c=n.getComponent("menu")??n.getComponent("xr-standard-menu");if(c&&a){let d=!1;c.onButtonStateChangedObservable.add(g=>{g.pressed&&!d&&(me(),n.pulse?.(.2,70)),d=g.pressed})}x("🕶 Quest 3 controller layout ready")}async function An(){if(!(!E||_)&&E.baseExperience.state!==O.IN_XR){_=!0,x("▶️ Requesting AR session…");try{await E.baseExperience.enterXRAsync("immersive-ar","local-floor")}catch(e){console.error(e),x(`❌ AR request failed — ${e instanceof Error?e.message:"check Quest Browser permissions"}`)}finally{_=!1,fe()}}}async function Rn(){if(!(!E||_)&&E.baseExperience.state!==O.IN_XR){_=!0,x("▶️ Requesting VR session…");try{await E.baseExperience.enterXRAsync("immersive-vr","local-floor")}catch(e){console.error(e),x(`❌ VR request failed — ${e instanceof Error?e.message:"check Quest Browser permissions"}`)}finally{_=!1,fe()}}}async function Vn(){if(x("⏳ Initialising WebXR…"),typeof navigator.xr>"u"){x("❌ WebXR is not available in this browser");return}if(ue=await navigator.xr.isSessionSupported("immersive-ar").catch(()=>!1),Se=await navigator.xr.isSessionSupported("immersive-vr").catch(()=>!1),!ue&&!Se){x("❌ Immersive AR/VR is not supported on this device/browser");return}const e=await nn.CreateAsync(b,{disableDefaultUI:!0,disablePointerSelection:!0,disableTeleportation:!0,disableNearInteraction:!0,uiOptions:{sessionMode:ue?"immersive-ar":"immersive-vr"},optionalFeatures:!0});E=e,e.baseExperience.onStateChangedObservable.add(n=>{n===O.IN_XR?(be=!0,x("🟢 XR ready — Aim assist: optimized • Grip: grab/move • Trigger: draw connections • B/Y: place • X/A: delete")):n===O.NOT_IN_XR&&(be=!1,Z(),H.clear(),x("⬜ XR not active")),fe()}),e.input.onControllerAddedObservable.add(n=>{K.push(n),n.onMotionControllerInitObservable.add(()=>{Fn(n)})}),e.input.onControllerRemovedObservable.add(n=>{const t=K.indexOf(n);t>=0&&K.splice(t,1);const a=ge.get(n);a&&(a.dispose(),ge.delete(n)),Q.delete(n),J.delete(n),le.delete(n),ce.delete(n),F===n&&(F=null),Z(n),H.delete(n)}),rn(),fe()}re&&re.addEventListener("click",async()=>{ye(),await An()});ie&&ie.addEventListener("click",async()=>{ye(),await Rn()});window.addEventListener("click",()=>{E?.baseExperience.state!==O.IN_XR&&ye()});for(const e of Array.from(document.querySelectorAll("[data-action]")))e.addEventListener("click",()=>{const n=e.getAttribute("data-action");if(n){if(n.startsWith("node-")){const t=n.replace("node-","").replace(/^./,a=>a.toUpperCase());x(`🧠 Selected ${t} node`),e.classList.add("active");for(const a of Array.from(document.querySelectorAll("[data-action]")))a!==e&&a.classList.remove("active")}sn(!1)}});b.registerBeforeRender(()=>{H.clear(),be&&E?.baseExperience.state===O.IN_XR&&(be=!1,me()),gn(b.getEngine().getDeltaTime()/1e3);for(const[e,n]of Array.from(J.entries())){const t=e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero(),a=bn(e),r=pn(e),s=le.get(e)??.15,u=Math.abs(r)>1e-6?Math.max(.05,s+r):s;le.set(e,u);const o=t.add(a.depthAxis.scale(u));hn(n,o)}xn(),Ge();for(const e of K){const n=Y(e);n?.mesh||Z(e),Sn(e,n??void 0),Mn(e,n??void 0),I===e&&wn(e,n??void 0)}for(const e of X.keys())_e(e)});Ce.runRenderLoop(()=>{b.render()});window.addEventListener("resize",()=>Ce.resize());Vn().catch(e=>{console.error(e),x("❌ WebXR could not start")});ye();
//# sourceMappingURL=astXr-YLEj39DK.js.map
