import{W as Ve,E as Ye,S as Qe,C as pe,A as Ke,V as l,H as en,T as Ne,a as G,Q as q,R as Ee,M as V,b as y,c as nn,d as W,D as ze,p as xe,e as tn}from"./package-BoiDK--I.js";const Se=`import "@babylonjs/loaders/glTF";
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
import { fromOpenMarchSchemaFile } from "@openmarch/schema";
import { Midi } from "@tonejs/midi";
import { getTransport, PolySynth, start as startAudio, Synth } from "tone";
import packageJson from "../../package.json";
import { compileCalChartShwMovements, parseCalChartShw } from "./calchart-shw";
import { compileCalChartViewer, isCalChartViewerFile } from "./calchart-viewer";
import type { CompiledDrill, CompiledDrillMovement, CompiledDrillSet } from "./compiled-drill";
import { compileOpenMarchShow } from "./openmarch";

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

type PreparedDrillSet = CompiledDrillSet & { startBeat: number };

interface PreparedDrill {
  labels: string[];
  sets: PreparedDrillSet[];
  setNoun: "Page" | "Sheet";
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
let preparedDrill: PreparedDrill | null = null;
let drillLoadGeneration = 0;
let lastScoreboardContent = "";

function setActivePerformerCount(count: number, labels?: string[]): void {
  while (performers.length < count) {
    performers.push(createPerformer(\`imported-performer-\${performers.length + 1}\`, 0, 0, "brass"));
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
  preparedDrill = null;
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
  preparedDrill = null;
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
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(\`Compiled drill \${field} must be a finite number\`);
  return value;
}

function validateCompiledMovement(command: CompiledDrillMovement, context: string): void {
  const beats = finiteNumber(command.beats, \`\${context} beats\`);
  if (beats < 0) throw new Error(\`Compiled drill \${context} beats cannot be negative\`);
  if (command.type === "even") {
    for (const field of ["x1", "y1", "x2", "y2", "facing"] as const) finiteNumber(command[field], \`\${context} \${field}\`);
  } else if (command.type === "arc") {
    for (const field of ["start_x", "start_y", "center_x", "center_y", "angle"] as const) finiteNumber(command[field], \`\${context} \${field}\`);
    if (command.facing_offset !== undefined) finiteNumber(command.facing_offset, \`\${context} facing_offset\`);
  } else {
    for (const field of ["x", "y", "facing"] as const) finiteNumber(command[field], \`\${context} \${field}\`);
  }
}

function prepareCompiledDrill(file: CompiledDrill): void {
  if (!loadedMidi) throw new Error("Load a MIDI file before loading a drill");
  if (file.labels.length === 0) throw new Error(\`\${file.format} drill has no performer labels\`);
  if (file.sets.length === 0) throw new Error(\`\${file.format} drill has no \${file.setNoun.toLowerCase()}s\`);
  const labels = file.labels.map((label, index) => {
    if (typeof label !== "string" || !label) throw new Error(\`Performer label \${index + 1} is invalid\`);
    return label;
  });
  let startBeat = 0;
  const sets = file.sets.map((set, setIndex): PreparedDrillSet => {
    if (!set || typeof set !== "object" || !set.movements || typeof set.movements !== "object") {
      throw new Error(\`\${file.setNoun} \${setIndex + 1} has no compiled movements\`);
    }
    const beats = finiteNumber(set.beats, \`\${file.setNoun.toLowerCase()} \${setIndex + 1} beats\`);
    if (beats < 0) throw new Error(\`\${file.setNoun} \${setIndex + 1} beats cannot be negative\`);
    for (const label of labels) {
      const commands = set.movements[label];
      if (!Array.isArray(commands) || commands.length === 0) throw new Error(\`\${file.setNoun} \${setIndex + 1} has no movement for \${label}\`);
      let commandBeats = 0;
      for (const [commandIndex, command] of commands.entries()) {
        if (!command || !["even", "arc", "mark", "stand", "close"].includes(command.type)) {
          throw new Error(\`Unsupported movement for \${label} on \${file.setNoun.toLowerCase()} \${setIndex + 1}, command \${commandIndex + 1}\`);
        }
        validateCompiledMovement(command, \`\${label} \${file.setNoun.toLowerCase()} \${setIndex + 1} command \${commandIndex + 1}\`);
        commandBeats += command.beats;
      }
      if (Math.abs(commandBeats - beats) > 1e-6) {
        throw new Error(\`Movements for \${label} total \${commandBeats} beats, expected \${beats}\`);
      }
    }
    const prepared = { ...set, beats, startBeat } as PreparedDrillSet;
    startBeat += beats;
    return prepared;
  });
  preparedDrill = { labels, sets, setNoun: file.setNoun, title: file.title };
  compiledFrameSetIndex = -1;
  drillCues = [];
  drillTitle = file.title;
  setActivePerformerCount(labels.length, labels);
  transport.pause();
  transport.seconds = 0;
  synth.releaseAll();
  musicPositionInput.value = "0";
  playButton.textContent = "Play";
  setStatus(\`Loaded \${file.title}: \${labels.length} performers, \${sets.length} \${file.setNoun.toLowerCase()}s\`);
}

function prepareCalChartShw(data: ArrayBuffer, fileName: string): void {
  const parsed = parseCalChartShw(data);
  const title = fileName.replace(/\\.shw$/i, "");
  const labels = performanceTestPerformerCount
    ? parsed.labels.slice(0, performanceTestPerformerCount)
    : parsed.labels;
  const sets: CompiledDrillSet[] = parsed.sheets.map((sheet, sheetIndex) => {
    const movements = Object.fromEntries(labels.map((label, marcherIndex) => {
      return [label, compileCalChartShwMovements(parsed, sheetIndex, marcherIndex)];
    }));
    return { label: sheet.label, beats: sheet.beats, field_type: "college", movements };
  });
  prepareCompiledDrill({
    format: "calchart-shw",
    version: parsed.version,
    title,
    labels,
    setNoun: "Sheet",
    sets,
  });
  setStatus(\`Loaded \${title}: \${labels.length} marchers, \${parsed.sheets.length} sheets, authored continuity paths\`);
}

async function prepareOpenMarch(data: ArrayBuffer): Promise<void> {
  const show = await fromOpenMarchSchemaFile(data);
  prepareCompiledDrill(compileOpenMarchShow(show));
  setStatus(\`Loaded \${drillTitle}: \${show.performers.length} performers, \${show.pages.length} pages, OpenMarch \${show.omSchemaVersion}\`);
}

function loadDrillFile(data: unknown): void {
  if (isCalChartViewerFile(data)) prepareCompiledDrill(compileCalChartViewer(data));
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

interface CompiledMovementSample {
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

function fieldGridPosition(x: number, y: number): Vector3 {
  return new Vector3((80 - x) * eightToFiveStep, 0, (y - 42) * eightToFiveStep);
}

function fieldGridFacing(angle: number): number {
  const radians = -Math.PI / 2 - angle * Math.PI / 180;
  return Math.atan2(Math.sin(radians), -Math.cos(radians));
}

function sampleCompiledMovement(commands: CompiledDrillMovement[], beat: number, sample: CompiledMovementSample): void {
  let commandStart = 0;
  let command = commands[commands.length - 1];
  for (const candidate of commands) {
    command = candidate;
    if (beat <= commandStart + candidate.beats || candidate === commands[commands.length - 1]) break;
    commandStart += candidate.beats;
  }
  const progress = command.beats > 0 ? Math.min(1, Math.max(0, (beat - commandStart) / command.beats)) : 1;
  if (command.type === "even") {
    const start = fieldGridPosition(finiteNumber(command.x1, "even x1"), finiteNumber(command.y1, "even y1"));
    const end = fieldGridPosition(finiteNumber(command.x2, "even x2"), finiteNumber(command.y2, "even y2"));
    const travelX = end.x - start.x;
    const travelZ = end.z - start.z;
    const distance = Math.hypot(travelX, travelZ);
    sample.position.set(start.x + travelX * progress, 0, start.z + travelZ * progress);
    sample.facing = fieldGridFacing(finiteNumber(command.facing, "even facing"));
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
    sample.position.copyFrom(fieldGridPosition(x, y));
    sample.facing = fieldGridFacing(facing);
    sample.gait = "high-step";
    sample.motion.direction.set(directionX, 0, directionZ);
    sample.motion.stepSize = radius * Math.abs(sweep) * eightToFiveStep / Math.max(1, command.beats);
    sample.motion.moving = progress < 1 && Math.abs(sweep) > 1e-5;
    return;
  }
  sample.position.copyFrom(fieldGridPosition(finiteNumber(command.x, \`\${command.type} x\`), finiteNumber(command.y, \`\${command.type} y\`)));
  sample.facing = fieldGridFacing(finiteNumber(command.facing, \`\${command.type} facing\`));
  sample.gait = command.type === "mark" ? "mark-time" : "stand";
  sample.motion.direction.setAll(0);
  sample.motion.stepSize = 0;
  sample.motion.moving = false;
}

let compiledFrameSamples: CompiledMovementSample[] = [];
let compiledFrameState: DrillPlaybackState | null = null;
let compiledFrameSetIndex = -1;

function compiledDrillState(ticks: number, drill: PreparedDrill): DrillPlaybackState {
  const beat = loadedMidi ? Math.max(0, ticks / loadedMidi.header.ppq) : 0;
  let setIndex = drill.sets.findIndex(set => beat < set.startBeat + set.beats);
  if (setIndex < 0) setIndex = Math.max(0, drill.sets.length - 1);
  const set = drill.sets[setIndex];
  const setBeat = Math.min(set.beats, Math.max(0, beat - set.startBeat));
  if (!compiledFrameState || compiledFrameSamples.length !== drill.labels.length) {
    compiledFrameSamples = drill.labels.map(() => ({
      position: Vector3.Zero(),
      facing: 0,
      gait: "stand",
      motion: { direction: Vector3.Zero(), stepSize: 0, moving: false },
    }));
    compiledFrameState = {
      cue: null,
      next: null,
      positions: compiledFrameSamples.map(sample => sample.position),
      facings: new Array<number>(drill.labels.length).fill(0),
      gaits: new Array<GaitName>(drill.labels.length).fill("stand"),
      motions: compiledFrameSamples.map(sample => sample.motion),
    };
    compiledFrameSetIndex = -1;
  }
  if (setIndex !== compiledFrameSetIndex) {
    compiledFrameState.cue = { label: \`\${drill.setNoun} \${set.label}\` };
    compiledFrameState.next = drill.sets[setIndex + 1] ? { label: \`\${drill.setNoun} \${drill.sets[setIndex + 1].label}\` } : null;
    compiledFrameSetIndex = setIndex;
  }
  for (let index = 0; index < drill.labels.length; index += 1) {
    const sample = compiledFrameSamples[index];
    sampleCompiledMovement(set.movements[drill.labels[index]], setBeat, sample);
    compiledFrameState.facings[index] = sample.facing;
    compiledFrameState.gaits[index] = sample.gait;
  }
  return compiledFrameState;
}

function currentDrillState(ticks: number): DrillPlaybackState {
  return preparedDrill ? compiledDrillState(ticks, preparedDrill) : nativeDrillState(ticks);
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
  const generation = ++drillLoadGeneration;
  if (/\\.shw$/i.test(file.name)) {
    void file.arrayBuffer().then(data => {
      if (generation === drillLoadGeneration) prepareCalChartShw(data, file.name);
    }).catch(error => setStatus(error instanceof Error ? error.message : "Unable to load CalChart show"));
    return;
  }
  if (/\\.omz?$/i.test(file.name)) {
    void file.arrayBuffer().then(data => {
      if (generation === drillLoadGeneration) return prepareOpenMarch(data);
    }).catch(error => setStatus(error instanceof Error ? error.message : "Unable to load OpenMarch show"));
    return;
  }
  void file.text().then(text => {
    if (generation === drillLoadGeneration) loadDrillFile(JSON.parse(text));
  }).catch(error => setStatus(error instanceof Error ? error.message : "Unable to load drill"));
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
const defaultDrillGeneration = drillLoadGeneration;
void fetch("/music/the-stars-and-stripes-forever.mid")
  .then(response => response.arrayBuffer())
  .then(data => loadMidiData(data, "The Stars and Stripes Forever"))
  .then(() => fetch(queenFinalShwUrl))
  .then(response => response.arrayBuffer())
  .then(data => {
    if (defaultDrillGeneration === drillLoadGeneration) prepareCalChartShw(data, "queen-final.shw");
  })
  .catch(error => setStatus(error instanceof Error ? error.message : "Unable to load the default music"));
void initializeXr();
`,an={kind:"SourceFile",label:"chart-xr.ts",start:0,end:92555,uses:[2972,2437,4978,5768,3767,6099,6421,4890,6602,6925,7160,8855,12868,13638,26198,34212,33959,34709,35308,73412,73119,73159,73551,73197,73467,73269,4003,75227,4090,4177,4257,79794,74155,4339,77511,4419,77868,4499,35274,35413,35385,3921,72337,71187,90521,90083,90179,43161,1095,76019],usedBy:[2437,2596,2972,3347,4890,4978,5714,5768,6602,6925,7160,7322,7609,7679,7762,7845,7920,7990,8065,8154,8232,8300,8372,8449,8524,8595,8687,8771,8855,9007,9063,9493,9926,11711,12004,13638,14837,24675,26198,26709,26931,27322,34212,34709,35274,35308,35413,35524,36197,38768,39264,40574,42562,43161,44362,45179,47653,48554,48867,49050,50933,51791,52484,55488,58737,59840,60223,60980,61665,63401,63489,63607,63694,63883,65830,66143,69321,72872,73119,73159,73197,74241,76019,77511,78228,80501,81107,82140,82805,87795,92325],children:[{kind:"VariableStatement",label:"variable queenFinalShwUrl",start:1095,end:1202,uses:[],usedBy:[0],children:[]},{kind:"InterfaceDeclaration",label:"interface PrecalculatedFootstep",start:2437,end:2594,uses:[0],usedBy:[0,61665,63883],children:[]},{kind:"InterfaceDeclaration",label:"interface PerformerRig",start:2596,end:2970,uses:[0],usedBy:[14837,82805,87795],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillCueFile",start:2972,end:3278,uses:[0],usedBy:[0,40574,43985,48867,63883],children:[]},{kind:"InterfaceDeclaration",label:"interface PreparedDrill",start:3347,end:3468,uses:[0],usedBy:[35561,69321],children:[]},{kind:"VariableStatement",label:"variable canvas",start:3767,end:3844,uses:[],usedBy:[4890,0,35671],children:[]},{kind:"VariableStatement",label:"variable statusElement",start:3845,end:3920,uses:[],usedBy:[74155],children:[]},{kind:"VariableStatement",label:"variable buildInfoElement",start:3921,end:4002,uses:[],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable enterArButton",start:4003,end:4089,uses:[],usedBy:[74241,0],children:[]},{kind:"VariableStatement",label:"variable enterVrButton",start:4090,end:4176,uses:[],usedBy:[74241,0],children:[]},{kind:"VariableStatement",label:"variable midiFileInput",start:4177,end:4256,uses:[],usedBy:[26931,0,79528],children:[]},{kind:"VariableStatement",label:"variable drillFileInput",start:4257,end:4338,uses:[],usedBy:[0,79794],children:[]},{kind:"VariableStatement",label:"variable playButton",start:4339,end:4418,uses:[],usedBy:[43161,45179,77511,77868,0],children:[]},{kind:"VariableStatement",label:"variable stopButton",start:4419,end:4498,uses:[],usedBy:[43161,0],children:[]},{kind:"VariableStatement",label:"variable musicPositionInput",start:4499,end:4588,uses:[],usedBy:[43161,45179,0,91745],children:[]},{kind:"VariableStatement",label:"variable requestedPerformanceTestCount",start:4589,end:4722,uses:[],usedBy:[4723],children:[]},{kind:"VariableStatement",label:"variable performanceTestPerformerCount",start:4723,end:4888,uses:[4589],usedBy:[47653],children:[]},{kind:"VariableStatement",label:"variable engine",start:4890,end:4977,uses:[0,3767],usedBy:[4978,0,82805,90179],children:[]},{kind:"VariableStatement",label:"variable scene",start:4978,end:5010,uses:[0,4890],usedBy:[0,5714,5768,6376,6602,6925,7160,7322,9926,11711,12004,13638,14837,26198,26931,76019,90232],children:[]},{kind:"VariableStatement",label:"variable fieldLength",start:5104,end:5127,uses:[],usedBy:[5178,5264,5309,9926,12868,13638,26931],children:[]},{kind:"VariableStatement",label:"variable fieldWidth",start:5128,end:5153,uses:[],usedBy:[9926,12868,26198,26931],children:[]},{kind:"VariableStatement",label:"variable endZoneDepth",start:5154,end:5177,uses:[],usedBy:[5178,9926,26931],children:[]},{kind:"VariableStatement",label:"variable playingFieldLength",start:5178,end:5236,uses:[5104,5154],usedBy:[9926,12868],children:[]},{kind:"VariableStatement",label:"variable tabletopScale",start:5237,end:5263,uses:[],usedBy:[34610,34660,72337],children:[]},{kind:"VariableStatement",label:"variable lifeSizeScale",start:5264,end:5308,uses:[5104],usedBy:[5637,72337],children:[]},{kind:"VariableStatement",label:"variable yardsPerSceneUnit",start:5309,end:5353,uses:[5104],usedBy:[5354],children:[]},{kind:"VariableStatement",label:"variable eightToFiveStep",start:5354,end:5404,uses:[5309],usedBy:[5405,65830,66143,82805],children:[]},{kind:"VariableStatement",label:"variable fourStepInterval",start:5405,end:5450,uses:[5354],usedBy:[5451,5495],children:[]},{kind:"VariableStatement",label:"variable formationInterval",start:5451,end:5494,uses:[5405],usedBy:[24675,52484],children:[]},{kind:"VariableStatement",label:"variable rankInterval",start:5495,end:5533,uses:[5405],usedBy:[24675,52484],children:[]},{kind:"VariableStatement",label:"variable performerModelHeight",start:5534,end:5569,uses:[],usedBy:[5637],children:[]},{kind:"VariableStatement",label:"variable shoeSoleClearance",start:5570,end:5603,uses:[],usedBy:[82805,87795],children:[]},{kind:"VariableStatement",label:"variable fieldPaintHeight",start:5604,end:5636,uses:[],usedBy:[9926,11711,12004,82805,87795],children:[]},{kind:"VariableStatement",label:"variable physicalPerformerScale",start:5637,end:5713,uses:[5534,5264],usedBy:[35671,72337],children:[]},{kind:"VariableStatement",label:"variable fieldRoot",start:5714,end:5766,uses:[0,4978],usedBy:[9926,11711,12004,13638,14837,26198,26931,34709,72337,74635],children:[]},{kind:"VariableStatement",label:"variable camera",start:5768,end:5860,uses:[0,4978],usedBy:[0,6376],children:[]},{kind:"VariableStatement",label:"variable flyKeys",start:6099,end:6133,uses:[],usedBy:[0,6421],children:[]},{kind:"IfStatement",label:"IfStatement",start:6376,end:6418,uses:[4978,5768],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:6411,end:6418,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable verticalDirection",start:6421,end:6506,uses:[6099],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable skyMaterial",start:6602,end:6669,uses:[0,4978],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable skybox",start:6925,end:7034,uses:[0,4978],usedBy:[0,72337,90232],children:[]},{kind:"VariableStatement",label:"variable light",start:7160,end:7246,uses:[0,4978],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function material",start:7322,end:7607,uses:[0,4978],usedBy:[7609,7679,7762,7845,7920,7990,8065,8154,8232,8300,8372,8449,8524,8595,8687,8771,8855],children:[]},{kind:"VariableStatement",label:"variable turfMaterial",start:7609,end:7678,uses:[7322,0],usedBy:[9926],children:[]},{kind:"VariableStatement",label:"variable turfStripeMaterial",start:7679,end:7761,uses:[7322,0],usedBy:[9926],children:[]},{kind:"VariableStatement",label:"variable lineMaterial",start:7762,end:7844,uses:[7322,0],usedBy:[11711],children:[]},{kind:"VariableStatement",label:"variable endZoneMaterial",start:7845,end:7919,uses:[7322,0],usedBy:[9926,14837],children:[]},{kind:"VariableStatement",label:"variable trackMaterial",start:7920,end:7989,uses:[7322,0],usedBy:[9926],children:[]},{kind:"VariableStatement",label:"variable uniformMaterial",start:7990,end:8064,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable uniformTrimMaterial",start:8065,end:8153,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable pantsMaterial",start:8154,end:8231,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable skinMaterial",start:8232,end:8299,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable shoeMaterial",start:8300,end:8371,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable brassMaterial",start:8372,end:8448,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable drumMaterial",start:8449,end:8523,uses:[7322,0],usedBy:[14837],children:[]},{kind:"VariableStatement",label:"variable standMaterial",start:8524,end:8594,uses:[7322,0],usedBy:[26198],children:[]},{kind:"VariableStatement",label:"variable scoreboardFrameMaterial",start:8595,end:8686,uses:[7322,0],usedBy:[26931],children:[]},{kind:"VariableStatement",label:"variable goalpostMaterial",start:8687,end:8770,uses:[7322,0],usedBy:[13638],children:[]},{kind:"VariableStatement",label:"variable tabletopMaterial",start:8771,end:8854,uses:[7322,0],usedBy:[9926],children:[]},{kind:"VariableStatement",label:"variable tabletopGrabMaterial",start:8855,end:8926,uses:[7322,0],usedBy:[0,9926],children:[]},{kind:"VariableStatement",label:"variable sharedPerformerMeshes",start:9007,end:9061,uses:[0],usedBy:[9063],children:[]},{kind:"FunctionDeclaration",label:"function createSharedPerformerMesh",start:9063,end:9491,uses:[0,9007],usedBy:[9493,14837],children:[]},{kind:"FunctionDeclaration",label:"function createMergedPerformerMesh",start:9493,end:9924,uses:[0,9063],usedBy:[14837],children:[]},{kind:"FunctionDeclaration",label:"function createField",start:9926,end:11709,uses:[0,5104,5128,4978,5714,8771,7920,7609,5178,5604,7679,5154,7845,8855],usedBy:[33959],children:[]},{kind:"FunctionDeclaration",label:"function addMarking",start:11711,end:12002,uses:[0,4978,5714,5604,7762],usedBy:[12868],children:[]},{kind:"FunctionDeclaration",label:"function addYardNumber",start:12004,end:12866,uses:[0,4978,5714,5604],usedBy:[12868],children:[]},{kind:"FunctionDeclaration",label:"function createFieldMarkings",start:12868,end:13636,uses:[11711,5128,5104,5178,12004],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function createGoalPosts",start:13638,end:14835,uses:[0,4978,5714,5104,8687],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function createPerformer",start:14837,end:24673,uses:[0,4978,5714,9063,8154,7990,8232,8449,8300,8372,9493,8065,7845,2596],usedBy:[24675,35671],children:[]},{kind:"FunctionDeclaration",label:"function createBand",start:24675,end:26196,uses:[0,5451,5495,14837],usedBy:[34085],children:[]},{kind:"FunctionDeclaration",label:"function createStands",start:26198,end:26625,uses:[0,4978,5714,5128,8524],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function configureScoreboardTexture",start:26709,end:26929,uses:[0],usedBy:[26931],children:[]},{kind:"FunctionDeclaration",label:"function createScoreboard",start:26931,end:33957,uses:[0,5104,5154,5128,4978,5714,8595,26709,4177,78005,77511,77868,29772,27322],usedBy:[27322,34166],children:[{kind:"FunctionDeclaration",label:"function positionScoreboard",start:27322,end:28262,uses:[0,26931],usedBy:[26931],children:[]},{kind:"FunctionDeclaration",label:"function drawControlLabel",start:29772,end:30252,uses:[],usedBy:[26931],children:[]}]},{kind:"VariableStatement",label:"variable { field, tabletopBase, tabletopGrabSurface }",start:33959,end:34026,uses:[9926],usedBy:[0,76019],children:[]},{kind:"VariableStatement",label:"variable performers",start:34085,end:34117,uses:[24675],usedBy:[34118,35671,72337,91025],children:[]},{kind:"VariableStatement",label:"variable nativePerformerCount",start:34118,end:34165,uses:[34085],usedBy:[40574,43161,63883],children:[]},{kind:"VariableStatement",label:"variable scoreboardTexture",start:34166,end:34211,uses:[26931],usedBy:[71187],children:[]},{kind:"VariableStatement",label:"variable tabletopDragBehavior",start:34212,end:34266,uses:[0],usedBy:[0,74635],children:[]},{kind:"VariableStatement",label:"variable tabletopDragAttached",start:34576,end:34609,uses:[],usedBy:[74635],children:[]},{kind:"VariableStatement",label:"variable minimumTabletopScale",start:34610,end:34659,uses:[5237],usedBy:[34709],children:[]},{kind:"VariableStatement",label:"variable maximumTabletopScale",start:34660,end:34707,uses:[5237],usedBy:[34709],children:[]},{kind:"FunctionDeclaration",label:"function lockTabletopLevel",start:34709,end:35144,uses:[5714,0,34660,34610],usedBy:[0,74635],children:[]},{kind:"VariableStatement",label:"variable transport",start:35274,end:35307,uses:[0],usedBy:[42562,45179,77511,77868,78005,0,90341,90652],children:[]},{kind:"VariableStatement",label:"variable synth",start:35308,end:35359,uses:[0],usedBy:[0,42562,45179,77868,78005],children:[]},{kind:"VariableStatement",label:"variable musicRepeatCount",start:35385,end:35412,uses:[],usedBy:[36197,42562,43161,77511,78005,0,90341,91745],children:[]},{kind:"VariableStatement",label:"variable loadedMidi",start:35413,end:35448,uses:[0],usedBy:[40574,43161,45179,63883,69321,77511,78005,80849,0,90341,90445,90588,91745],children:[]},{kind:"VariableStatement",label:"variable loadedMidiName",start:35449,end:35487,uses:[],usedBy:[43161],children:[]},{kind:"VariableStatement",label:"variable drillTitle",start:35488,end:35523,uses:[],usedBy:[40574,43161,43985,45179,48554,71187],children:[]},{kind:"VariableStatement",label:"variable drillCues",start:35524,end:35560,uses:[0],usedBy:[40574,43161,43985,45179,63883],children:[]},{kind:"VariableStatement",label:"variable preparedDrill",start:35561,end:35608,uses:[3347],usedBy:[40574,43161,45179,71027],children:[]},{kind:"VariableStatement",label:"variable drillLoadGeneration",start:35609,end:35637,uses:[],usedBy:[79857,79983,80268,80501,92e3,92325],children:[]},{kind:"VariableStatement",label:"variable lastScoreboardContent",start:35638,end:35669,uses:[],usedBy:[71187],children:[]},{kind:"FunctionDeclaration",label:"function setActivePerformerCount",start:35671,end:36195,uses:[34085,14837,5637,3767],usedBy:[40574,43161,45179],children:[]},{kind:"FunctionDeclaration",label:"function tickForMeasure",start:36197,end:36557,uses:[0,35385],usedBy:[40574],children:[]},{kind:"FunctionDeclaration",label:"function minimumCostAssignment",start:36559,end:38480,uses:[],usedBy:[39264],children:[]},{kind:"InterfaceDeclaration",label:"interface MarcherSquad",start:38482,end:38540,uses:[],usedBy:[38542,38768,39264],children:[]},{kind:"VariableStatement",label:"variable marcherSquads",start:38542,end:38766,uses:[38482],usedBy:[39264],children:[]},{kind:"FunctionDeclaration",label:"function squadLineCost",start:38768,end:39262,uses:[0,38482],usedBy:[39264],children:[]},{kind:"FunctionDeclaration",label:"function assignFormationSlots",start:39264,end:40572,uses:[0,38542,38482,38768,36559],usedBy:[40574],children:[]},{kind:"FunctionDeclaration",label:"function prepareDrill",start:40574,end:42560,uses:[2972,35413,35561,35671,34118,35488,36197,52484,62779,35524,39264,0,55488,60223,61665],usedBy:[43985],children:[]},{kind:"FunctionDeclaration",label:"function scheduleMidi",start:42562,end:43159,uses:[0,35274,35308,35385],usedBy:[43161],children:[]},{kind:"FunctionDeclaration",label:"function loadMidiData",start:43161,end:43983,uses:[0,35413,35449,42562,35524,35561,35671,34118,35488,4499,4339,4419,74155,35385],usedBy:[79569,0],children:[]},{kind:"FunctionDeclaration",label:"function loadDrillData",start:43985,end:44150,uses:[2972,40574,74155,35488,35524],usedBy:[48867],children:[]},{kind:"FunctionDeclaration",label:"function finiteNumber",start:44152,end:44360,uses:[],usedBy:[44362,45179,66143],children:[]},{kind:"FunctionDeclaration",label:"function validateCompiledMovement",start:44362,end:45177,uses:[0,44152],usedBy:[45179],children:[]},{kind:"FunctionDeclaration",label:"function prepareCompiledDrill",start:45179,end:47651,uses:[0,35413,44152,44362,35561,69288,35524,35488,35671,35274,35308,4499,4339,74155],usedBy:[47653,48554,48867],children:[]},{kind:"FunctionDeclaration",label:"function prepareCalChartShw",start:47653,end:48552,uses:[0,4723,45179,74155],usedBy:[79983,92325],children:[]},{kind:"FunctionDeclaration",label:"function prepareOpenMarch",start:48554,end:48865,uses:[0,45179,74155,35488],usedBy:[80308],children:[]},{kind:"FunctionDeclaration",label:"function loadDrillFile",start:48867,end:49048,uses:[0,45179,43985,2972],usedBy:[80501],children:[]},{kind:"VariableStatement",label:"variable alphabetGlyphs",start:49050,end:50931,uses:[0],usedBy:[51791],children:[]},{kind:"FunctionDeclaration",label:"function samplePolyline",start:50933,end:51789,uses:[0],usedBy:[52484],children:[]},{kind:"FunctionDeclaration",label:"function alphabetPositions",start:51791,end:52482,uses:[0,49050],usedBy:[52484],children:[]},{kind:"FunctionDeclaration",label:"function formationPositions",start:52484,end:55449,uses:[0,51791,50933,5451,5495],usedBy:[40574,63883],children:[]},{kind:"VariableStatement",label:"variable minimumSweptClearance",start:55451,end:55486,uses:[],usedBy:[58737,59840],children:[]},{kind:"FunctionDeclaration",label:"function precalculateCollisionSafePath",start:55488,end:58629,uses:[0,63059,59840],usedBy:[40574],children:[]},{kind:"InterfaceDeclaration",label:"interface SweptCollision",start:58631,end:58735,uses:[],usedBy:[58737,59840],children:[]},{kind:"FunctionDeclaration",label:"function firstSweptCollision",start:58737,end:59838,uses:[0,58631,55451],usedBy:[59840],children:[]},{kind:"FunctionDeclaration",label:"function reportPathCollision",start:59840,end:60221,uses:[0,58737,58631,55451],usedBy:[55488],children:[]},{kind:"FunctionDeclaration",label:"function precalculatePathProgress",start:60223,end:60978,uses:[0],usedBy:[40574],children:[]},{kind:"FunctionDeclaration",label:"function samplePrecalculatedPath",start:60980,end:61663,uses:[0],usedBy:[61665,63883],children:[]},{kind:"FunctionDeclaration",label:"function precalculateFootsteps",start:61665,end:62777,uses:[0,2437,60980],usedBy:[40574],children:[]},{kind:"FunctionDeclaration",label:"function facingAngle",start:62779,end:63057,uses:[],usedBy:[40574,63883],children:[]},{kind:"FunctionDeclaration",label:"function interpolateAngle",start:63059,end:63244,uses:[],usedBy:[55488,63246,63883],children:[]},{kind:"FunctionDeclaration",label:"function smoothAngle",start:63246,end:63399,uses:[63059],usedBy:[91152],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillMotion",start:63401,end:63487,uses:[0],usedBy:[63489,63694,66143,82140,82805,87795],children:[]},{kind:"InterfaceDeclaration",label:"interface CompiledMovementSample",start:63489,end:63605,uses:[0,63401],usedBy:[66143,69173,69321],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillDisplayCue",start:63607,end:63692,uses:[0],usedBy:[63694,71187],children:[]},{kind:"InterfaceDeclaration",label:"interface DrillPlaybackState",start:63694,end:63881,uses:[63607,0,63401],usedBy:[63883,69230,69321,71027,71187,90955,91066,91111,91152,91304],children:[]},{kind:"FunctionDeclaration",label:"function nativeDrillState",start:63883,end:65828,uses:[63694,35524,0,52484,34118,62779,60980,35413,2437,63059,2972],usedBy:[71027],children:[]},{kind:"FunctionDeclaration",label:"function fieldGridPosition",start:65830,end:65972,uses:[0,5354],usedBy:[66143],children:[]},{kind:"FunctionDeclaration",label:"function fieldGridFacing",start:65974,end:66141,uses:[],usedBy:[66143],children:[]},{kind:"FunctionDeclaration",label:"function sampleCompiledMovement",start:66143,end:69171,uses:[0,63489,65830,44152,65974,63401,5354],usedBy:[69321],children:[]},{kind:"VariableStatement",label:"variable compiledFrameSamples",start:69173,end:69229,uses:[63489],usedBy:[69321],children:[]},{kind:"VariableStatement",label:"variable compiledFrameState",start:69230,end:69287,uses:[63694],usedBy:[69321],children:[]},{kind:"VariableStatement",label:"variable compiledFrameSetIndex",start:69288,end:69319,uses:[],usedBy:[45179,69321],children:[]},{kind:"FunctionDeclaration",label:"function compiledDrillState",start:69321,end:71025,uses:[3347,63694,35413,0,69230,69173,63489,69288,66143],usedBy:[71027],children:[]},{kind:"FunctionDeclaration",label:"function currentDrillState",start:71027,end:71185,uses:[63694,35561,69321,63883],usedBy:[90521],children:[]},{kind:"FunctionDeclaration",label:"function drawScoreboard",start:71187,end:72335,uses:[63694,35488,63607,35638,34166],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function configureFieldScale",start:72337,end:72870,uses:[73002,5237,5264,5714,34085,5637,6925],usedBy:[75227,76019,0],children:[]},{kind:"VariableStatement",label:"variable xrExperience",start:72872,end:72927,uses:[0],usedBy:[73343,73412,74241,74635,75227,76019],children:[]},{kind:"VariableStatement",label:"variable requestingXr",start:72928,end:72953,uses:[],usedBy:[74241,75227],children:[]},{kind:"VariableStatement",label:"variable supportsAr",start:72954,end:72977,uses:[],usedBy:[74241,76019],children:[]},{kind:"VariableStatement",label:"variable supportsVr",start:72978,end:73001,uses:[],usedBy:[74241,76019],children:[]},{kind:"VariableStatement",label:"variable activeDisplayMode",start:73002,end:73081,uses:[],usedBy:[72337,73343,90744,90851,91281,91745],children:[]},{kind:"VariableStatement",label:"variable vrFlightAxes",start:73082,end:73118,uses:[],usedBy:[73467,73551,76019,78228],children:[]},{kind:"VariableStatement",label:"variable vrFlightForward",start:73119,end:73158,uses:[0],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable vrFlightRight",start:73159,end:73196,uses:[0],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable vrFlightMovement",start:73197,end:73237,uses:[0],usedBy:[0,73935],children:[]},{kind:"VariableStatement",label:"variable vrFlightDeadZone",start:73238,end:73268,uses:[],usedBy:[73467,73551],children:[]},{kind:"VariableStatement",label:"variable vrFlightSpeed",start:73269,end:73296,uses:[],usedBy:[0],children:[]},{kind:"IfStatement",label:"IfStatement",start:73343,end:73409,uses:[73002,72872],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:73402,end:73409,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable xrCamera",start:73412,end:73464,uses:[72872],usedBy:[0],children:[]},{kind:"VariableStatement",label:"variable strafe",start:73467,end:73548,uses:[73082,73238],usedBy:[73637,0],children:[]},{kind:"VariableStatement",label:"variable forward",start:73551,end:73634,uses:[73082,73238],usedBy:[73637,0],children:[]},{kind:"IfStatement",label:"IfStatement",start:73637,end:73679,uses:[73467,73551],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:73672,end:73679,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:73935,end:74006,uses:[73197],usedBy:[],children:[]},{kind:"FunctionDeclaration",label:"function setStatus",start:74155,end:74239,uses:[3845],usedBy:[43161,43985,45179,47653,48554,75227,76019,79569,79901,80185,0],children:[]},{kind:"FunctionDeclaration",label:"function updateButtons",start:74241,end:74633,uses:[72872,0,4003,72928,72954,4090,72978],usedBy:[75227,76019],children:[]},{kind:"FunctionDeclaration",label:"function configureXrInteraction",start:74635,end:75225,uses:[72872,34576,34709,34212,5714],usedBy:[75227,76019],children:[]},{kind:"FunctionDeclaration",label:"function enterXr",start:75227,end:76017,uses:[72872,72928,72337,74635,74241,74155],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function initializeXr",start:76019,end:77509,uses:[72872,4978,33959,78228,73082,72954,72978,0,72337,74635,74241,74155],usedBy:[0],children:[]},{kind:"FunctionDeclaration",label:"function togglePlayback",start:77511,end:77866,uses:[35413,0,35274,35385,4339],usedBy:[26931,78228,0],children:[]},{kind:"FunctionDeclaration",label:"function stopPlayback",start:77868,end:78003,uses:[35274,35308,4339],usedBy:[26931,78228,0],children:[]},{kind:"FunctionDeclaration",label:"function seekPlayback",start:78005,end:78226,uses:[35413,35274,35385,35308],usedBy:[26931,78228],children:[]},{kind:"FunctionDeclaration",label:"function initializeQuestController",start:78228,end:79321,uses:[0,73082,77511,77868,78005],usedBy:[76019],children:[]},{kind:"VariableStatement",label:"variable file",start:79528,end:79566,uses:[4177],usedBy:[79569],children:[]},{kind:"IfStatement",label:"IfStatement",start:79569,end:79737,uses:[79528,43161,74155],usedBy:[],children:[]},{kind:"VariableStatement",label:"variable file",start:79794,end:79833,uses:[4257],usedBy:[79836,79901,79983,80185,0],children:[]},{kind:"IfStatement",label:"IfStatement",start:79836,end:79854,uses:[79794],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:79847,end:79854,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable generation",start:79857,end:79898,uses:[35609],usedBy:[79983,80268,80501],children:[]},{kind:"IfStatement",label:"IfStatement",start:79901,end:80182,uses:[79794,74155],usedBy:[79983],children:[{kind:"IfStatement",label:"IfStatement",start:79983,end:80059,uses:[79857,35609,47653,79901,79794],usedBy:[],children:[]},{kind:"ReturnStatement",label:"ReturnStatement",start:80171,end:80178,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:80185,end:80462,uses:[79794,74155],usedBy:[80308],children:[{kind:"IfStatement",label:"IfStatement",start:80268,end:80338,uses:[79857,35609],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:80308,end:80338,uses:[48554,80185],usedBy:[],children:[]}]},{kind:"ReturnStatement",label:"ReturnStatement",start:80451,end:80458,uses:[],usedBy:[],children:[]}]},{kind:"IfStatement",label:"IfStatement",start:80501,end:80573,uses:[79857,35609,48867,0],usedBy:[],children:[]},{kind:"IfStatement",label:"IfStatement",start:80849,end:80873,uses:[35413],usedBy:[],children:[{kind:"ReturnStatement",label:"ReturnStatement",start:80866,end:80873,uses:[],usedBy:[],children:[]}]},{kind:"VariableStatement",label:"variable gaitProfiles",start:81107,end:82138,uses:[0],usedBy:[82805],children:[]},{kind:"FunctionDeclaration",label:"function travelGait",start:82140,end:82803,uses:[0,63401],usedBy:[91304],children:[]},{kind:"FunctionDeclaration",label:"function animatePerformerRig",start:82805,end:87793,uses:[0,63401,2596,81107,5354,4890,5570,5604],usedBy:[91281],children:[]},{kind:"FunctionDeclaration",label:"function animateSimplifiedPerformerRig",start:87795,end:90045,uses:[0,63401,2596,5570,5604],usedBy:[91281],children:[]},{kind:"VariableStatement",label:"variable arRigUpdateInterval",start:90047,end:90082,uses:[],usedBy:[90083,90744,90851],children:[]},{kind:"VariableStatement",label:"variable arRigUpdateAccumulator",start:90083,end:90132,uses:[90047],usedBy:[0,90744,90851],children:[]},{kind:"VariableStatement",label:"variable deltaSeconds",start:90179,end:90229,uses:[4890],usedBy:[0,91152],children:[]},{kind:"IfStatement",label:"IfStatement",start:90232,end:90338,uses:[6925,4978],usedBy:[],children:[]},{kind:"VariableStatement",label:"variable seconds",start:90341,end:90442,uses:[35413,35274,35385],usedBy:[90445,91745],children:[]},{kind:"VariableStatement",label:"variable ticks",start:90445,end:90518,uses:[35413,90341],usedBy:[90521,91371],children:[]},{kind:"VariableStatement",label:"variable drill",start:90521,end:90560,uses:[71027,90445],usedBy:[0,90955,91066,91111,91152,91304],children:[]},{kind:"VariableStatement",label:"variable stepTicks",start:90588,end:90649,uses:[35413],usedBy:[91371],children:[]},{kind:"VariableStatement",label:"variable marching",start:90652,end:90699,uses:[35274],usedBy:[91281],children:[]},{kind:"VariableStatement",label:"variable updateRig",start:90744,end:90848,uses:[73002,90083,90047],usedBy:[90851,91281],children:[]},{kind:"IfStatement",label:"IfStatement",start:90851,end:90952,uses:[90744,73002,90083,90047],usedBy:[],children:[]},{kind:"ForStatement",label:"ForStatement",start:90955,end:91742,uses:[90521,63694,91025,91066,91152],usedBy:[91025,91066,91111,91152,91304],children:[{kind:"VariableStatement",label:"variable performer",start:91025,end:91061,uses:[34085,90955],usedBy:[91152,90955,91281],children:[]},{kind:"VariableStatement",label:"variable position",start:91066,end:91106,uses:[90521,63694,90955],usedBy:[90955],children:[]},{kind:"VariableStatement",label:"variable motion",start:91111,end:91147,uses:[90521,63694,90955],usedBy:[91304,91281],children:[]},{kind:"VariableStatement",label:"variable facing",start:91152,end:91237,uses:[63246,91025,90521,63694,90955,90179],usedBy:[91304,91281,90955],children:[]},{kind:"IfStatement",label:"IfStatement",start:91281,end:91664,uses:[90744,91025,73002,87795,91371,91304,91111,90652,82805,91152],usedBy:[],children:[{kind:"VariableStatement",label:"variable gait",start:91304,end:91364,uses:[82140,90521,63694,90955,91111,91152],usedBy:[91281],children:[]},{kind:"VariableStatement",label:"variable stepPhase",start:91371,end:91421,uses:[90445,90588],usedBy:[91281],children:[]}]}]},{kind:"IfStatement",label:"IfStatement",start:91745,end:91892,uses:[35413,73002,4499,90341,35385],usedBy:[],children:[]},{kind:"VariableStatement",label:"variable defaultDrillGeneration",start:92e3,end:92051,uses:[35609],usedBy:[92325],children:[]},{kind:"IfStatement",label:"IfStatement",start:92325,end:92421,uses:[92e3,35609,47653,0],usedBy:[],children:[]}]},Pe=document.getElementById("build-info"),Be=document.getElementById("status"),Le=document.getElementById("render-canvas"),re=document.getElementById("enter-ar-button"),ie=document.getElementById("enter-vr-button"),Ie=document.getElementById("controller-palette");function x(e){Be&&(Be.textContent=e)}function fe(){const e=N?.baseExperience.state===G.IN_XR;re&&(re.textContent=e?"Quest 3 AR Active":"Enter Quest 3 AR",re.disabled=O||e||!ue),ie&&(ie.textContent=e?"VR Active":"Enter VR",ie.disabled=O||e||!ve)}function rn(){if(!Pe)return;const e=Number(xe.buildNumber),n=`${xe.name} v${xe.version} · build ${e} · production`;Pe.textContent=n}Ve.UseOnlineRepository=!0;Ve.PrioritizeOnlineRepository=!0;const we=new Ye(Le,!0,{adaptToDeviceRatio:!0,antialias:!0}),b=new Qe(we);b.clearColor=new pe(0,0,0,0);const $e=new Ke("cam",-Math.PI/2,Math.PI/3,3,l.Zero(),b);$e.attachControl(Le,!1);$e.inputs.clear();const on=new en("light",new l(0,1,0),b);on.intensity=.9;const j=new Ne("sceneRoot",b),T=[],se=new Map,he=new Map,Xe=new WeakSet,qe=new WeakMap;let E=null;const oe=[],ge=new Map,H=new Map,J=new Map,le=new Map,de=new Set,Q=new Map;let R=null,I=null,P=null,ce=null;const z=new Map,X=new Map,K=[];let S=null,U=null,ee=null,F=null,be=!1,N=null,O=!1,ue=!1,ve=!1;function sn(e){Ie&&Ie.classList.toggle("visible",e)}function _(e){if(!e){for(const[a,r]of X)Me(a,r.diffuseColor,r.emissiveColor);z.clear(),X.clear();return}const n=z.get(e);if(!n)return;z.delete(e);const t=X.get(n);t&&(t.owners.delete(e),!(t.owners.size>0)&&(Me(n,t.diffuseColor,t.emissiveColor),X.delete(n)))}function Me(e,n,t){if(Xe.has(e)){e.instancedBuffers.color=new pe(n.r,n.g,n.b,1);return}const a=e.material;a?.diffuseColor.copyFrom(n),a?.emissiveColor.copyFrom(t)}function Oe(e){const n=X.get(e);if(!n)return;const t=Array.from(n.owners).some(a=>(Q.get(a)??!1)||de.has(a));Me(e,t?new y(.25,.7,.7):new y(.18,.42,.42),t?new y(.35,1,1):new y(.08,.35,.32))}function ln(e,n){if(n){const r=z.get(e);r&&r!==n&&_(e)}else{_(e);return}const t=n.material;if(!t)return;let a=X.get(n);if(!a){const r=qe.get(n)??t.diffuseColor;a={emissiveColor:t.emissiveColor.clone(),diffuseColor:r.clone(),owners:new Set},X.set(n,a)}a.owners.add(e),z.set(e,n),Oe(n)}function ye(){if(We(),T.length>0)return;const e=Bn(an);x(`🧠 AST scene built (${e} nodes)`)}const dn=new Set(["as","async","await","break","case","catch","class","const","continue","default","delete","do","else","export","extends","false","finally","for","from","function","if","implements","import","in","instanceof","interface","let","new","null","of","private","protected","public","readonly","return","static","super","switch","this","throw","true","try","type","typeof","undefined","void","while","with","yield"]);function cn(e){let n=!1;return e.map(t=>{const a=[];let r=0;for(;r<t.length;){if(n){const m=t.indexOf("*/",r),d=m<0?t.length:m+2;a.push({text:t.slice(r,d),kind:"comment"}),r=d,n=m<0;continue}if(t.startsWith("//",r)){a.push({text:t.slice(r),kind:"comment"});break}if(t.startsWith("/*",r)){const m=t.indexOf("*/",r+2),d=m<0?t.length:m+2;a.push({text:t.slice(r,d),kind:"comment"}),r=d,n=m<0;continue}const s=t.slice(r),u=s.match(/^(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/),o=s.match(/^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i),i=s.match(/^[A-Za-z_$][\w$]*/),f=s.match(/^\s+/);if(u)a.push({text:u[0],kind:"string"});else if(o)a.push({text:o[0],kind:"number"});else if(i){const m=i[0],d=dn.has(m)?"keyword":/^[A-Z]/.test(m)?"type":"plain";a.push({text:m,kind:d})}else f?a.push({text:f[0],kind:"plain"}):a.push({text:s[0],kind:/[=+\-*/%!?<>|&:^~]/.test(s[0])?"operator":"plain"});r+=a[a.length-1].text.length}return a})}function Ge(e){if(!ee)return;const n=ee.getContext();n.fillStyle="#06151b",n.fillRect(0,0,1024,576);const t=e?.metadata,a=t?.sourceStart!==void 0&&t.sourceEnd!==void 0,r=Se.replace(/\t/g,"  ").split(/\r?\n/),s=cn(r),u=a?Se.slice(0,t.sourceStart).split(`
`).length:1,o=a?Se.slice(0,t.sourceEnd).split(`
`).length:0,i=14,f=Math.max(1,Math.min(u-4,r.length-i+1)),m=r.slice(f-1,f-1+i),d=f+m.length-1,c=t?.astLabel??"chart-xr.ts",g=t?.astKind??(e?"Manual node - showing complete source":"Complete program source");n.fillStyle="#72f0ff",n.font="bold 30px monospace",n.fillText(c.slice(0,52),38,48),n.fillStyle="#6f91a0",n.font="22px monospace",n.fillText(g,38,80);const v=`${f}-${d} / ${r.length}`;n.fillText(v,986-n.measureText(v).width,80),n.fillStyle="#17404a",n.fillRect(38,96,948,2),n.font="24px monospace",m.forEach((k,B)=>{const M=f+B,D=130+B*30,L=a&&M>=u&&M<=o;L&&(n.fillStyle="#123b44",n.fillRect(30,D-23,956,29)),n.fillStyle=L?"#72f0ff":"#4d7582",n.fillText(String(M).padStart(4," "),38,D);let p=118,h=70;for(const C of s[M-1]){if(h<=0)break;const w=C.text.slice(0,h),A={plain:"#d8e7ec",keyword:"#ff78bd",type:"#72e6c1",string:"#ffd580",number:"#b8a0ff",comment:"#668995",operator:"#72d9ff"};n.fillStyle=A[C.kind],n.fillText(w,p,D),p+=n.measureText(w).width,h-=w.length}}),ee.update()}function We(){if(S)return;S=new Ne("source-tablet",b),S.parent=j,S.position=new l(.42,.28,.38),S.rotationQuaternion=q.RotationYawPitchRoll(Math.PI,0,0);const e=new W("tablet-frame-material",b);e.diffuseColor=new y(.035,.045,.06),e.emissiveColor=new y(.008,.012,.02);const n=new W("tablet-screen-material",b);n.diffuseColor=new y(.02,.08,.1),n.emissiveColor=new y(.02,.45,.55),n.disableLighting=!0,U=V.CreateBox("tablet-body",{width:.46,height:.29,depth:.022},b),U.parent=S,U.material=e,U.isPickable=!0;const t=V.CreatePlane("tablet-screen",{width:.42,height:.245},b);t.parent=S,t.position.z=.012,t.rotation.y=Math.PI,t.material=n,t.isPickable=!1;const a=V.CreateBox("tablet-handle",{width:.16,height:.025,depth:.035},b);a.parent=S,a.position.y=-.165,a.material=e,a.isPickable=!1,ee=new ze("tablet-screen-texture",{width:1024,height:576},b,!0),Ge(null),n.diffuseTexture=ee,n.emissiveTexture=ee}function De(e){return e==="SourceFile"?new y(.82,.88,.95):e==="FunctionDeclaration"?new y(.1,.72,.9):e==="ClassDeclaration"?new y(.95,.55,.15):e==="InterfaceDeclaration"?new y(.2,.78,.42):e==="VariableStatement"?new y(.35,.48,.95):e==="ReturnStatement"?new y(.9,.3,.65):e.endsWith("Statement")?new y(.95,.3,.25):new y(.55,.62,.72)}function un(e,n,t=.075,a=!1){const r=document.createElement("canvas").getContext("2d"),s=48;r&&(r.font=`bold ${s}px sans-serif`);const u=r?.measureText(n).width??n.length*s*.6,o=Math.max(12,Math.floor(s*Math.min(1,2e3/Math.max(u,1)))),i=`bold ${o}px sans-serif`;r&&(r.font=i);const m=(r?.measureText(n).width??n.length*o*.6)+48,d=Math.min(2048,Math.max(256,2**Math.ceil(Math.log2(m)))),c=128,v=.06*d/c,k=V.CreatePlane(`${e.name}_label`,{width:v,height:.06},b);k.parent=e,k.position.y=t,k.billboardMode=tn.BILLBOARDMODE_ALL,k.isPickable=a,a&&he.set(k,e);const B=new ze(`${e.name}_label_texture`,{width:d,height:c},b,!0);B.hasAlpha=!0,B.drawText(n,null,84,i,"#ffffff","rgba(7, 17, 31, 0.88)",!0,!0);const M=new W(`${e.name}_label_material`,b);M.diffuseTexture=B,M.emissiveTexture=B,M.opacityTexture=B,M.disableLighting=!0,M.backFaceCulling=!1,k.material=M,k.onDisposeObservable.add(()=>{he.delete(k),M.dispose(!1,!0)})}function _e(e,n,t="ManualNode",a=new l(.08,.08,.08),r=1){const s=`box_${T.length}`,u=t==="VariableStatement"&&r===1;let o;if(u){if(!E){E=V.CreatePolyhedron("variable-octahedron-source",{type:1,size:a.x/(2*Math.SQRT2),flat:!0},b),E.position.y=-1e3,E.isPickable=!1,E.useVertexColors=!0,E.registerInstancedBuffer("color",4),E.instancedBuffers.color=new pe(1,1,1,1);const f=new W("variable-octahedron-material",b);f.diffuseColor=y.White(),f.emissiveColor=new y(.094,.094,.094),E.material=f}o=E.createInstance(s);const i=De(t);Xe.add(o),qe.set(o,i),o.instancedBuffers.color=new pe(i.r,i.g,i.b,1)}else{o=V.CreateBox(s,{width:a.x,height:a.y,depth:a.z},b);const i=new W(`boxMat_${T.length}`,b);i.diffuseColor=De(t),i.emissiveColor=new y(.094,.094,.094),i.alpha=r,i.backFaceCulling=r===1,o.material=i}return o.position.copyFrom(e),o.rotationQuaternion=q.Identity(),o.parent=j,o.isPickable=r===1,o.computeWorldMatrix(!0),T.push(o),un(o,n??`Node ${T.length}`,a.y/2+.035,r<1),o}function Te(e,n){const t=n.position.subtract(e.position),a=e.getBoundingInfo().boundingBox.extendSize,r=e.position.clone();return Math.abs(t.x)>=Math.abs(t.y)&&Math.abs(t.x)>=Math.abs(t.z)?r.x+=Math.sign(t.x)*a.x:Math.abs(t.y)>=Math.abs(t.z)?r.y+=Math.sign(t.y)*a.y:r.z+=Math.sign(t.z)*a.z,r}function mn(e,n){const t=se.get(e);if(!t)return n;const a=t.getBoundingInfo().boundingBox.extendSize,r=e.getBoundingInfo().boundingBox.extendSize,s=.03,u=new l(Math.max(0,a.x-r.x-s),Math.max(0,a.y-r.y-s),Math.max(0,a.z-r.z-s)),o=t.position.subtract(u),i=t.position.add(u);return new l(Math.max(o.x,Math.min(n.x,i.x)),Math.max(o.y,Math.min(n.y,i.y)),Math.max(o.z,Math.min(n.z,i.z)))}function pn(e,n){const t=mn(e,n),a=t.subtract(e.position);if(!(a.lengthSquared()<1e-12)){e.position.copyFrom(t),e.computeWorldMatrix(!0);for(const r of T){let s=se.get(r);for(;s;){if(s===e){r.position.addInPlace(a),r.computeWorldMatrix(!0);break}s=se.get(s)}}}}function Ze(){for(const e of oe){const n=Te(e.startNode,e.endNode),t=Te(e.endNode,e.startNode),a=t.subtract(n),r=Math.max(a.length(),1e-4),s=a.scale(1/r),u=.12,o=Math.min(.08,r*.4),i=Math.max(r-o,.001),f=Math.max(.021,e.weight*.03),m=n.add(s.scale(i/2));e.shaft.position.copyFrom(m),e.shaft.scaling=new l(f,i,f);const d=l.Up(),c=l.Cross(d,s),g=Math.acos(Math.max(-1,Math.min(1,l.Dot(d,s))));e.shaft.rotationQuaternion=c.lengthSquared()<1e-6?q.Identity():q.RotationAxis(c.normalize(),g);const v=t.subtract(s.scale(o/2)),k=Math.max(.016,f*2.4);e.head.position.copyFrom(v),e.head.scaling=new l(k,o/u,k),e.head.rotationQuaternion=e.shaft.rotationQuaternion?.clone()??q.Identity()}}function fn(e){for(const[a,r]of Array.from(z.entries()))r===e&&_(a);const n=T.indexOf(e);n>=0&&T.splice(n,1),se.delete(e);const t=oe.filter(a=>a.startNode===e||a.endNode===e);for(const a of t)a.shaft.dispose(),a.head.dispose();for(const a of t){const r=oe.indexOf(a);r>=0&&oe.splice(r,1)}e.dispose()}function He(e){return e.inputSource.handedness==="left"?"left":"right"}function Ue(e){const n=e.motionController;if(!n)return{x:0,y:0};const t=n.getComponent("thumbstick")??n.getComponent("xr-standard-thumbstick")??n.getComponentOfType("thumbstick")??n.getComponent("touchpad");if(!t)return{x:0,y:0};const a=t.axes,r=a?.x??0,s=a?.y??0;return{x:Math.abs(r)<.2?0:r,y:Math.abs(s)<.2?0:s}}function hn(e){return-Ue(e).y*.02}function gn(e){const n=b.activeCamera;if(!n)return;const t=n.getDirection(l.Forward());if(t.y=0,t.lengthSquared()<1e-6)return;t.normalize();const a=l.Cross(t,l.Up()).normalize(),r=l.Zero(),s=.8,u=1.2;let o=0;for(const d of K){if(de.has(d)||J.has(d))continue;const c=Ue(d);He(d)==="left"?(r.addInPlace(a.scale(-c.x)),r.addInPlace(t.scale(c.y))):(r.addInPlace(l.Up().scale(c.y)),o-=c.x*u*e)}r.scaleInPlace(s*e);const i=n.globalPosition,f=Math.cos(o),m=Math.sin(o);for(const d of T){if(d.position.addInPlace(r),Math.abs(o)>1e-6){const c=d.position.x-i.x,g=d.position.z-i.z;d.position.x=i.x+c*f+g*m,d.position.z=i.z-c*m+g*f}d.computeWorldMatrix(!0)}if(S&&!F){if(S.position.addInPlace(r),Math.abs(o)>1e-6){const d=S.position.x-i.x,c=S.position.z-i.z;S.position.x=i.x+d*f+c*m,S.position.z=i.z-d*m+c*f,S.rotate(l.Up(),-o)}S.computeWorldMatrix(!0)}}function bn(e){const a=((e.pointer??e.grip)?.getDirection?.(l.Forward())??l.Forward()).normalize();let r=l.Cross(a,l.Up());r.lengthSquared()<1e-6&&(r=l.Cross(a,l.Forward())),r.normalize();const s=l.Cross(r,a);return s.normalize(),{depthAxis:a,rightAxis:r,upAxis:s}}function Y(e,n=!0,t=!1){if(n){const m=H.get(e);if(m)return m}if(N?.baseExperience.state===G.IN_XR&&!e._lastXRPose){const m={mesh:null,point:null};return n&&H.set(e,m),m}const a=e.pointer??e.grip;if(!a)return null;const r=a.absolutePosition?.clone()??l.Zero(),u=(a.getDirection?.(l.Forward())??l.Forward()).normalize();let o=l.Cross(u,l.Up());o.lengthSquared()<1e-6&&(o=l.Cross(u,l.Forward())),o.normalize();const i=[u,u.add(o.scale(.08)).normalize(),u.add(o.scale(-.08)).normalize(),u.add(o.scale(.16)).normalize(),u.add(o.scale(-.16)).normalize()];for(const m of i){const d=new Ee(r,m);d.length=8;const c=b.pickWithRay(d,g=>T.includes(g)||t&&he.has(g));if(c?.pickedMesh){const v={mesh:he.get(c.pickedMesh)??c.pickedMesh,point:c.pickedPoint?.clone()??r.add(m.scale(.8))};return n&&H.set(e,v),v}}const f={mesh:null,point:null};return n&&H.set(e,f),f}function ke(e,n=!1){return Y(e,!n,n)?.mesh??null}function yn(e){const n=[e.pointer?.absolutePosition,e.grip?.absolutePosition].filter(s=>!!s);if(n.length===0)return null;const t=.025**2;let a=null,r=Number.POSITIVE_INFINITY;for(const s of T){if(!s.isPickable)continue;s.computeWorldMatrix(!0);const u=s.getBoundingInfo().boundingBox;for(const o of n){const i=Math.max(u.minimumWorld.x,Math.min(o.x,u.maximumWorld.x)),f=Math.max(u.minimumWorld.y,Math.min(o.y,u.maximumWorld.y)),m=Math.max(u.minimumWorld.z,Math.min(o.z,u.maximumWorld.z)),d=l.DistanceSquared(o,new l(i,f,m));d<=t&&d<r&&(a=s,r=d)}}return a}function Fe(e){if(!U||F&&F!==e)return!1;const n=e.pointer??e.grip;if(!n)return!1;const t=n.absolutePosition?.clone()??l.Zero(),a=n.getDirection?.(l.Forward()).normalize()??l.Forward(),r=new Ee(t,a,8);return b.pickWithRay(r,s=>s===U)?.pickedMesh===U}function xn(){if(!S||!F)return;const e=F.grip??F.pointer,n=b.activeCamera;!e?.absolutePosition||!n||(S.position.copyFrom(e.absolutePosition.add(l.Up().scale(.09))),S.lookAt(n.globalPosition),S.computeWorldMatrix(!0))}function me(){S||We();const e=b.activeCamera;if(!S||!e)return;F=null;const n=e.getDirection(l.Forward()).normalize();S.position.copyFrom(e.globalPosition.add(n.scale(.65)).add(l.Down().scale(.12))),S.lookAt(e.globalPosition),S.computeWorldMatrix(!0),x("📟 Tablet summoned")}function Sn(e){const n=V.CreateCylinder(`beam_${e.uniqueId??"controller"}`,{height:1,diameter:.008,tessellation:6},b);n.parent=j,n.isPickable=!1;const t=new W(`beamMat_${e.uniqueId??"controller"}`,b);return t.diffuseColor=new y(.2,.8,1),t.emissiveColor=new y(.1,.35,.7),t.alpha=.9,t.disableLighting=!0,n.material=t,n}function vn(e,n){const t=e.pointer??e.grip,a=ge.get(e)??Sn(e);if(ge.set(e,a),!t){a.setEnabled(!1);return}const r=t.absolutePosition?.clone()??l.Zero(),u=(t.getDirection?.(l.Forward())??l.Forward()).normalize(),o=n??Y(e),i=J.get(e)??null,f=i?i.position.clone():o?.point,m=f?l.Distance(r,f):2.2;if(a.setEnabled(!0),a.position.copyFrom(r.add(u.scale(m/2))),a.scaling.y=m,a.scaling.x=1,a.scaling.z=1,u.lengthSquared()>1e-6){const d=l.Up(),c=l.Cross(d,u),g=Math.acos(Math.max(-1,Math.min(1,l.Dot(d,u))));a.rotationQuaternion=c.lengthSquared()<1e-6?q.Identity():q.RotationAxis(c.normalize(),g)}else a.rotationQuaternion=q.Identity()}function Mn(e,n){const t=e.pointer??e.grip,r=(n??Y(e))?.mesh??null;if(!t){_(e);return}r?z.get(e)!==r&&ln(e,r):_(e)}function Ce(e){return K.filter(t=>t!==e)[0]??null}function Je(e){const n=[I===e?Ce(e):e,e].filter(t=>!!t);for(const t of n){const a=ke(t)??z.get(t)??null;if(a&&a!==R)return a}return null}function wn(e,n){const t=e.pointer??e.grip;if(!t)return l.Zero();const a=t.absolutePosition?.clone()??l.Zero(),s=(t.getDirection?.(l.Forward())??l.Forward()).normalize(),u=I===e?Ce(e):e,o=n??Y(u||e);return o?.point?o.point.clone():a.add(s.scale(.8))}function ne(){ce&&(ce.dispose(),ce=null)}function kn(e,n){if(!R||I!==e){P&&(P.dispose(),P=null);const o=n?.mesh??null;if(o){const i=n?.point?.clone()??e.pointer?.absolutePosition?.clone()??e.grip?.absolutePosition?.clone()??l.Zero(),f=o.position.clone();ne();const m=V.CreateLines("hover-connection-preview",{points:[i,f]},b);m.color=new y(.2,.85,1),m.alpha=.35,m.parent=j,m.isPickable=!1,ce=m}else ne();return}ne();const t=Ce(e),a=t?Y(t):null,s=(a?.mesh??null)?.position?.clone()??wn(t??e,a??void 0);P&&P.dispose();const u=V.CreateLines("connection-preview",{points:[R.position.clone(),s]},b);u.color=new y(.35,1,1),u.alpha=1,u.parent=j,u.isPickable=!1,P=u}function Cn(e){return e==="reference"?{diffuse:new y(1,.25,.82),emissive:new y(.9,.12,.65),head:new y(1,.42,.9)}:e==="user"?{diffuse:new y(1,.72,.18),emissive:new y(.95,.5,.08),head:new y(1,.84,.35)}:{diffuse:new y(.35,1,1),emissive:new y(.25,.9,1),head:new y(.45,1,1)}}function je(e,n,t=1,a="user"){const r=Cn(a),s=V.CreateCylinder("connection-shaft",{height:1,diameter:.04,tessellation:12},b);s.parent=j,s.isPickable=!1,s.metadata={connectionKind:a};const u=new W("connection-shaft-mat",b);u.diffuseColor=r.diffuse,u.emissiveColor=r.emissive,u.disableLighting=!0,s.material=u;const o=V.CreateCylinder("connection-head",{height:.12,diameterTop:.001,diameterBottom:.08,tessellation:12},b);o.parent=j,o.isPickable=!1,o.metadata={connectionKind:a};const i=new W("connection-head-mat",b);return i.diffuseColor=r.head,i.emissiveColor=r.emissive,i.disableLighting=!0,o.material=i,oe.push({shaft:s,head:o,startNode:e,endNode:n,weight:t,kind:a}),Ze(),s}class Pn{constructor(n,t,a,r){this.idealEdgeLength=n,this.depthSpacing=t,this.origin=a,this.iterations=r}layout(n,t){const a=Math.PI*(3-Math.sqrt(5)),r=n.map((o,i)=>{const f=this.idealEdgeLength*Math.sqrt(i+1)*.45,m=i*a;return new l(Math.cos(m)*f,Math.sin(m)*f*.25,-o.depth*this.depthSpacing)}),s=this.idealEdgeLength*this.idealEdgeLength;for(let o=0;o<this.iterations;o+=1){const i=n.map(()=>l.Zero());for(let d=0;d<r.length;d+=1)for(let c=d+1;c<r.length;c+=1){const g=r[d].subtract(r[c]),v=Math.max(g.length(),.001),k=g.scale(s/(v*v*v));i[d].addInPlace(k),i[c].subtractInPlace(k)}for(const d of t){const c=r[d.targetIndex].subtract(r[d.sourceIndex]),g=Math.max(c.length(),.001),v=g-this.idealEdgeLength,k=c.scale(v*d.strength/g);i[d.sourceIndex].addInPlace(k),i[d.targetIndex].subtractInPlace(k)}n.forEach((d,c)=>{const g=-d.depth*this.depthSpacing;i[c].z+=(g-r[c].z)*.35,i[c].y-=r[c].y*.08});const f=o/Math.max(this.iterations-1,1),m=this.idealEdgeLength*(.22*(1-f)+.01);r.forEach((d,c)=>{const g=i[c].length();g>1e-6&&d.addInPlace(i[c].scale(Math.min(g,m)/g))})}const u=r.reduce((o,i)=>o.addInPlace(i),l.Zero()).scaleInPlace(1/r.length);return r.map(o=>this.origin.add(o.subtract(u)))}}function Bn(e,n={}){const t=n.maxDepth??3,a=n.maxNodes??72,r=n.horizontalSpacing??.14,s=n.depthSpacing??.2,u=n.layoutIterations??120,o=n.origin?.clone()??new l(0,.1,0),i=[{node:e,parentIndex:null,depth:0}];for(let p=0;p<i.length&&i.length<a;p+=1){const h=i[p];if(!(h.depth>=t))for(const C of h.node.children){if(i.length>=a)break;i.push({node:C,parentIndex:p,depth:h.depth+1})}}const f=new Map;i.forEach((p,h)=>f.set(p.node.start,h));const m=i.flatMap((p,h)=>p.parentIndex===null?[]:[{sourceIndex:p.parentIndex,targetIndex:h,strength:.9}]),d=[],c=new Set,g=(p,h)=>{const C=f.get(p),w=f.get(h),A=`${p}:${h}`;C===void 0||w===void 0||C===w||c.has(A)||(c.add(A),d.push({sourceIndex:C,targetIndex:w,strength:.4}))};i.forEach(p=>{p.node.uses.forEach(h=>{const C=i[f.get(h)??-1]?.node,w=p.node.kind==="FunctionDeclaration"&&C?.kind==="FunctionDeclaration";g(w?p.node.start:h,w?h:p.node.start)}),p.node.usedBy.forEach(h=>{const C=i[f.get(h)??-1]?.node,w=p.node.kind==="FunctionDeclaration"&&C?.kind==="FunctionDeclaration";g(w?h:p.node.start,w?p.node.start:h)})});const v=new Array(i.length),B=new Pn(r,s,o,u).layout(i,[...m,...d]),M=i.map(()=>[]);i.forEach((p,h)=>{p.parentIndex!==null&&M[p.parentIndex].push(h)});const D=B.map(p=>p.clone()),L=B.map(()=>.04);for(let p=i.length-1;p>=0;p-=1){const h=M[p];if(h.length===0)continue;const C=h.reduce((ae,$)=>{const Z=L[$];return l.Minimize(ae,D[$].subtract(new l(Z,Z,Z)))},new l(Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY)),w=h.reduce((ae,$)=>{const Z=L[$];return l.Maximize(ae,D[$].add(new l(Z,Z,Z)))},new l(Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY)),A=C.add(w).scale(.5),te=h.reduce((ae,$)=>Math.max(ae,l.Distance(A,D[$])+L[$]),0)+.08;D[p]=A,L[p]=te}return i.forEach((p,h)=>{const C=p.node.label,w=M[h].length>0,A=L[h]*2,te=_e(D[h],C,p.node.kind,w?new l(A,A,A):void 0,w?.1:1);te.name=`ast_${h}_${C.replace(/[^a-z0-9]+/gi,"_")}`,te.metadata={astKind:p.node.kind,astLabel:C,sourceStart:p.node.start,sourceEnd:p.node.end},v[h]=te}),i.forEach((p,h)=>{p.parentIndex!==null&&M[p.parentIndex].length>0&&se.set(v[h],v[p.parentIndex])}),d.forEach(p=>{if(M[p.sourceIndex].length>0&&M[p.targetIndex].length>0)return;const h=i[p.sourceIndex].node.start,C=i[p.targetIndex].node.start,w=je(v[p.sourceIndex],v[p.targetIndex],.3,"reference");w.metadata={...w.metadata,fromId:h,toId:C}}),v.length}function Ae(e){const n=yn(e);return n?(fn(n),!0):!1}function Re(e){const t=(e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero()).add(new l(0,.02,0));_e(t),x(`📦 Placed box (${T.length})`)}function In(e){const n=ke(e)??z.get(e)??null;if(Ge(n),R&&I&&I!==e){Je(e)?Dn(e):x("🔗 Point the second controller at the destination node");return}if(I===e)return;const t=n;t?(R=t,I=e,x("🔗 Select the destination with the other controller")):(R=null,I=null,P?.dispose(),P=null,ne(),x("🔗 Point at a node to start a connection"))}function Dn(e){const n=I,t=Je(e);if(R&&t&&t!==R){if(je(R,t),n&&(Q.get(n)??!1)){P?.dispose(),P=null,x("🔗 Connection drawn — select another destination");return}x("🔗 Connection drawn")}else x("🔗 Connection cancelled");R=null,I=null,P?.dispose(),P=null,ne()}function Tn(){R=null,I=null,P?.dispose(),P=null,ne(),x("🔗 Connection cancelled")}function Fn(e){const n=e.motionController;if(!n)return;const t=He(e),a=t==="left",r=t==="right",s=n.getComponent("trigger")??n.getComponent("xr-standard-trigger")??n.getComponent("squeeze")??n.getComponentOfType("trigger")??n.getComponentOfType("squeeze");s&&s.onButtonStateChangedObservable.add(c=>{const g=Q.get(e)??!1;if(c.pressed&&!g){if(Fe(e)){x("📟 Read-only source tablet"),n.pulse?.(.15,50);return}Q.set(e,!0),In(e),n.pulse?.(.15,50)}else!c.pressed&&g&&(Q.set(e,!1),I===e&&Tn())});const u=n.getComponent("squeeze")??n.getComponentOfType("squeeze");u&&u.onButtonStateChangedObservable.add(c=>{if(c.pressed?de.add(e):de.delete(e),c.pressed){if(Fe(e))F=e,x("🤏 Tablet grabbed — release grip to place it");else{const g=ke(e,!0);if(!g){x("🎯 Hold grip on a box or tablet to move it"),n.pulse?.(.3,100);return}J.set(e,g);const v=e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero(),B=(e.pointer?.getDirection?.(l.Forward())??l.Forward()).normalize(),M=g.position.subtract(v),D=l.Dot(M,B);le.set(e,D<.01?.15:D),x("🤏 Grip grabbed distant box")}n.pulse?.(.3,100)}else F===e?(F=null,x("✋ Tablet released")):J.has(e)&&(J.delete(e),le.delete(e),x("✋ Box released"))});const o=n.getComponent("a-button")??n.getComponent("x-button"),i=n.getComponent("x-button")??n.getComponent("y-button")??n.getComponent("a-button");o&&(r||!a&&!r)&&o.onButtonStateChangedObservable.add(c=>{c.pressed&&(Ae(e)||me(),n.pulse?.(.2,70))}),i&&(a||!a&&!r)&&i.onButtonStateChangedObservable.add(c=>{c.pressed&&(Ae(e)||me(),n.pulse?.(.2,70))});const f=n.getComponent("b-button")??n.getComponent("y-button")??n.getComponent("a-button");f&&(r||!a&&!r)&&f.onButtonStateChangedObservable.add(c=>{c.pressed&&(Re(e),n.pulse?.(.2,70))});const m=n.getComponent("y-button");m&&a&&m.onButtonStateChangedObservable.add(c=>{c.pressed&&(Re(e),n.pulse?.(.2,70))});const d=n.getComponent("menu")??n.getComponent("xr-standard-menu");if(d&&a){let c=!1;d.onButtonStateChangedObservable.add(g=>{g.pressed&&!c&&(me(),n.pulse?.(.2,70)),c=g.pressed})}x("🕶 Quest 3 controller layout ready")}async function An(){if(!(!N||O)&&N.baseExperience.state!==G.IN_XR){O=!0,x("▶️ Requesting AR session…");try{await N.baseExperience.enterXRAsync("immersive-ar","local-floor")}catch(e){console.error(e),x(`❌ AR request failed — ${e instanceof Error?e.message:"check Quest Browser permissions"}`)}finally{O=!1,fe()}}}async function Rn(){if(!(!N||O)&&N.baseExperience.state!==G.IN_XR){O=!0,x("▶️ Requesting VR session…");try{await N.baseExperience.enterXRAsync("immersive-vr","local-floor")}catch(e){console.error(e),x(`❌ VR request failed — ${e instanceof Error?e.message:"check Quest Browser permissions"}`)}finally{O=!1,fe()}}}async function Vn(){if(x("⏳ Initialising WebXR…"),typeof navigator.xr>"u"){x("❌ WebXR is not available in this browser");return}if(ue=await navigator.xr.isSessionSupported("immersive-ar").catch(()=>!1),ve=await navigator.xr.isSessionSupported("immersive-vr").catch(()=>!1),!ue&&!ve){x("❌ Immersive AR/VR is not supported on this device/browser");return}const e=await nn.CreateAsync(b,{disableDefaultUI:!0,disablePointerSelection:!0,disableTeleportation:!0,disableNearInteraction:!0,uiOptions:{sessionMode:ue?"immersive-ar":"immersive-vr"},optionalFeatures:!0});N=e,e.baseExperience.onStateChangedObservable.add(n=>{n===G.IN_XR?(be=!0,x("🟢 XR ready — Aim assist: optimized • Grip: grab/move • Trigger: draw connections • B/Y: place • X/A: delete")):n===G.NOT_IN_XR&&(be=!1,_(),H.clear(),x("⬜ XR not active")),fe()}),e.input.onControllerAddedObservable.add(n=>{K.push(n),n.onMotionControllerInitObservable.add(()=>{Fn(n)})}),e.input.onControllerRemovedObservable.add(n=>{const t=K.indexOf(n);t>=0&&K.splice(t,1);const a=ge.get(n);a&&(a.dispose(),ge.delete(n)),Q.delete(n),J.delete(n),le.delete(n),de.delete(n),F===n&&(F=null),_(n),H.delete(n)}),rn(),fe()}re&&re.addEventListener("click",async()=>{ye(),await An()});ie&&ie.addEventListener("click",async()=>{ye(),await Rn()});window.addEventListener("click",()=>{N?.baseExperience.state!==G.IN_XR&&ye()});for(const e of Array.from(document.querySelectorAll("[data-action]")))e.addEventListener("click",()=>{const n=e.getAttribute("data-action");if(n){if(n.startsWith("node-")){const t=n.replace("node-","").replace(/^./,a=>a.toUpperCase());x(`🧠 Selected ${t} node`),e.classList.add("active");for(const a of Array.from(document.querySelectorAll("[data-action]")))a!==e&&a.classList.remove("active")}sn(!1)}});b.registerBeforeRender(()=>{H.clear(),be&&N?.baseExperience.state===G.IN_XR&&(be=!1,me()),gn(b.getEngine().getDeltaTime()/1e3);for(const[e,n]of Array.from(J.entries())){const t=e.grip?.absolutePosition?.clone()??e.pointer?.absolutePosition?.clone()??l.Zero(),a=bn(e),r=hn(e),s=le.get(e)??.15,u=Math.abs(r)>1e-6?Math.max(.05,s+r):s;le.set(e,u);const o=t.add(a.depthAxis.scale(u));pn(n,o)}xn(),Ze();for(const e of K){const n=Y(e);n?.mesh||_(e),vn(e,n??void 0),Mn(e,n??void 0),I===e&&kn(e,n??void 0)}for(const e of X.keys())Oe(e)});we.runRenderLoop(()=>{b.render()});window.addEventListener("resize",()=>we.resize());Vn().catch(e=>{console.error(e),x("❌ WebXR could not start")});ye();
//# sourceMappingURL=astXr-hPqI5DsQ.js.map
