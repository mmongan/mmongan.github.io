import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Matrix, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Observer } from '@babylonjs/core/Misc/observable.pure';
import { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem';
import { Scene } from '@babylonjs/core/scene.pure';

// Drill labels (e.g. "T3") float above marchers. Every label is a particle of
// one solid particle system sharing a single text atlas, so the whole band's
// labels draw in one call. Labels stay upright and turn to face whichever
// camera is active, including the XR camera.

const LABEL_HEIGHT_YARDS = 2.6;
const LABEL_WIDTH_YARDS = 0.8;
const LABEL_TALL_YARDS = 0.32;
const CELL_WIDTH = 160;
const CELL_HEIGHT = 64;
const ATLAS_COLUMNS = 12;

type DrillLabel = { robot: TransformNode; label: string };

let labelSystem: SolidParticleSystem | null = null;
let labelAtlas: DynamicTexture | null = null;
let labelObserver: Observer<Scene> | null = null;
let labelsVisible = false;
let labelEntries: DrillLabel[] = [];

const robotWorld = new Vector3();
const labelOffset = new Vector3();
const toParent = new Matrix();
const cameraLocal = new Vector3();

export function setDrillLabelsVisible(visible: boolean) {
  labelsVisible = visible;
  labelSystem?.mesh.setEnabled(visible && labelEntries.length > 0);
}

export function getDrillLabel(robot: TransformNode): string | undefined {
  return labelEntries.find((entry) => entry.robot === robot)?.label;
}

export function clearDrillLabels() {
  labelEntries = [];
  if (labelObserver) labelObserver.remove();
  labelObserver = null;
  labelSystem?.mesh.material?.dispose();
  labelSystem?.dispose();
  labelSystem = null;
  labelAtlas?.dispose();
  labelAtlas = null;
}

// Replaces any existing labels. Positions are expressed in `parent`'s space so
// the labels follow the field through AR tabletop scaling.
export function setDrillLabels(scene: Scene, parent: TransformNode, entries: DrillLabel[]) {
  clearDrillLabels();
  labelEntries = entries.filter((entry) => entry.label);
  if (labelEntries.length === 0) return;

  const uniqueLabels = [...new Set(labelEntries.map((entry) => entry.label))];
  const rows = Math.ceil(uniqueLabels.length / ATLAS_COLUMNS);
  const atlasWidth = CELL_WIDTH * ATLAS_COLUMNS;
  const atlasHeight = CELL_HEIGHT * rows;
  const atlas = new DynamicTexture("drillLabelAtlas", { width: atlasWidth, height: atlasHeight }, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  atlas.hasAlpha = true;
  const context = atlas.getContext() as CanvasRenderingContext2D;
  context.clearRect(0, 0, atlasWidth, atlasHeight);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const cells = new Map<string, Vector4>();
  uniqueLabels.forEach((label, index) => {
    const column = index % ATLAS_COLUMNS;
    const row = Math.floor(index / ATLAS_COLUMNS);
    const x = column * CELL_WIDTH;
    const y = row * CELL_HEIGHT;
    context.fillStyle = "rgba(10, 18, 36, 0.78)";
    context.beginPath();
    context.roundRect(x + 4, y + 4, CELL_WIDTH - 8, CELL_HEIGHT - 8, 14);
    context.fill();
    let fontSize = 42;
    context.font = `bold ${fontSize}px sans-serif`;
    while (fontSize > 18 && context.measureText(label).width > CELL_WIDTH - 24) {
      fontSize -= 2;
      context.font = `bold ${fontSize}px sans-serif`;
    }
    context.fillStyle = "#ffffff";
    context.fillText(label, x + CELL_WIDTH / 2, y + CELL_HEIGHT / 2 + 2);
    // The canvas's top row is the texture's top (v = 1).
    cells.set(label, new Vector4(
      x / atlasWidth,
      1 - (y + CELL_HEIGHT) / atlasHeight,
      (x + CELL_WIDTH) / atlasWidth,
      1 - y / atlasHeight,
    ));
  });
  atlas.update();

  const material = new StandardMaterial("drillLabelMaterial", scene);
  material.diffuseTexture = atlas;
  material.useAlphaFromDiffuseTexture = true;
  material.emissiveColor = Color3.White();
  material.disableLighting = true;
  material.backFaceCulling = false;

  const sps = new SolidParticleSystem("drillLabels", scene, { updatable: true, isPickable: false });
  const plane = MeshBuilder.CreatePlane("drillLabelShape", { width: LABEL_WIDTH_YARDS, height: LABEL_TALL_YARDS }, scene);
  sps.addShape(plane, labelEntries.length);
  plane.dispose();
  const mesh = sps.buildMesh();
  mesh.material = material;
  mesh.parent = parent;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.alphaIndex = 1000;
  sps.computeParticleColor = false;
  sps.computeParticleTexture = true;
  sps.particles.forEach((particle, index) => {
    particle.uvs.copyFrom(cells.get(labelEntries[index].label)!);
  });
  sps.setParticles();
  sps.computeParticleTexture = false;

  sps.updateParticle = (particle) => {
    const robot = labelEntries[particle.idx]?.robot;
    if (!robot || robot.isDisposed() || !robot.isEnabled()) {
      particle.isVisible = false;
      return particle;
    }
    particle.isVisible = true;
    const world = robot.computeWorldMatrix(true);
    labelOffset.set(0, LABEL_HEIGHT_YARDS, 0);
    Vector3.TransformCoordinatesToRef(labelOffset, world, robotWorld);
    Vector3.TransformCoordinatesToRef(robotWorld, toParent, particle.position);
    particle.rotation.y = Math.atan2(particle.position.x - cameraLocal.x, particle.position.z - cameraLocal.z);
    return particle;
  };

  labelSystem = sps;
  labelAtlas = atlas;
  // Added after the robot playback observer, so labels read this frame's
  // marcher positions.
  labelObserver = scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    if (!labelsVisible || !camera || !labelSystem) return;
    parent.computeWorldMatrix(true).invertToRef(toParent);
    Vector3.TransformCoordinatesToRef(camera.globalPosition, toParent, cameraLocal);
    labelSystem.setParticles();
  });
  setDrillLabelsVisible(labelsVisible);
}
