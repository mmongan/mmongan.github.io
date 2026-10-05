import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';

// AR tabletop mode: shrink the whole stadium onto a table. The skybox and
// horizon ground are world-scale backdrops, so they stay out of the AR
// transform hierarchy (excluded from reparenting below); visibility rules for
// each are handled separately in updateHiddenMeshVisibility.
const AR_HIDDEN_MESH_NAMES = new Set(["skyBox", "horizonGround"]);
// At AR_SCALE_MIN the ~110m-long field shrinks to roughly a 20cm hand-held model.
const AR_SCALE_MIN = 0.002;
const AR_SCALE_MAX = 1.0;
const AR_SCALE_DEFAULT = 1 / FIELD_LENGTH_YARDS;
const AR_TABLE_HEIGHT = 1;

// The outer ground plane has generous padding (parking-lot sized) that looks
// right at full VR scale, but should pull in to a small tabletop-sized
// overhang once the whole scene is shrunk to tabletop size or smaller.
const GROUND_MESH_NAME = "outerBase";
const GROUND_PADDING_WIDTH_YARDS = 22;
const GROUND_PADDING_LENGTH_YARDS = 16;
const GROUND_TABLETOP_MARGIN_YARDS = 3;
const GROUND_TABLETOP_WIDTH_RATIO =
  (FIELD_WIDTH_YARDS + GROUND_TABLETOP_MARGIN_YARDS * 2) /
  (FIELD_WIDTH_YARDS + GROUND_PADDING_WIDTH_YARDS);
const GROUND_TABLETOP_LENGTH_RATIO =
  (FIELD_LENGTH_YARDS + GROUND_TABLETOP_MARGIN_YARDS * 2) /
  (FIELD_LENGTH_YARDS + GROUND_PADDING_LENGTH_YARDS);

// The AR scene is manipulated through a pivot so the whole stadium can be
// translated, rotated, and scaled around a stable local origin.
const arPivot = new TransformNode("arPivot", scene);
const arRoot = new TransformNode("arRoot", scene);
const globalScaleRoot = new TransformNode("globalScaleRoot", scene);
let arTabletopModeActive = false;
let hasEnteredARTabletopModeBefore = false;
let contentRootMeshes: AbstractMesh[] = [];
const cornerHandles = new Map<AbstractMesh, Vector3>();
const cornerHandleY = -0.8;
const cornerHandleHeight = 0.038;

arRoot.parent = arPivot;
globalScaleRoot.parent = arPivot;

function clampScale(scale: number) {
  return Math.min(AR_SCALE_MAX, Math.max(AR_SCALE_MIN, scale));
}

// Blend a padding ratio from 1 (full size, at/above full VR scale) down to
// tabletopRatio (at/below the tabletop default scale), smoothly in between.
function lerpGroundPaddingRatio(tabletopRatio: number, arScale: number): number {
  if (arScale >= AR_SCALE_MAX) return 1;
  if (arScale <= AR_SCALE_DEFAULT) return tabletopRatio;
  const t =
    (Math.log(arScale) - Math.log(AR_SCALE_DEFAULT)) /
    (Math.log(AR_SCALE_MAX) - Math.log(AR_SCALE_DEFAULT));
  return tabletopRatio + (1 - tabletopRatio) * t;
}

function updateGroundFootprint(arScale: number) {
  const ground = scene.getMeshByName(GROUND_MESH_NAME);
  if (!ground) return;
  ground.scaling.x = lerpGroundPaddingRatio(GROUND_TABLETOP_WIDTH_RATIO, arScale);
  ground.scaling.z = lerpGroundPaddingRatio(GROUND_TABLETOP_LENGTH_RATIO, arScale);
}

function updateCornerHandles(arScale: number) {
  cornerHandles.forEach((corner, handle) => {
    handle.position.copyFrom(corner.scale(arScale));
    handle.position.y = cornerHandleY * arScale + cornerHandleHeight / 2;
  });
}

function createCornerHandles() {
  if (cornerHandles.size) return;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#88451f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#6c351a";
  for (let row = 0; row < canvas.height; row += 8) {
    for (let column = 0; column < canvas.width; column += 8) {
      ctx.beginPath();
      ctx.arc(column + (row % 16 === 0 ? 2 : 6), row + 2, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "#f4efe5";
  for (const fraction of [0.16, 0.84]) {
    ctx.fillRect(canvas.width * fraction - 5, 0, 10, canvas.height);
  }
  for (const fraction of [0, 0.5, 1]) {
    const laceY = canvas.height * fraction;
    ctx.fillRect(canvas.width * 0.35, laceY - 2, canvas.width * 0.3, 4);
    for (let index = 0; index < 6; index++) {
      ctx.fillRect(canvas.width * (0.37 + index * 0.052) - 2, laceY - 12, 4, 24);
    }
  }
  const texture = new DynamicTexture("tabletopFootballTexture", canvas, scene, true);
  texture.update(false);
  texture.anisotropicFilteringLevel = 8;
  const material = new StandardMaterial("tabletopCornerHandleMaterial", scene);
  material.diffuseTexture = texture;
  material.emissiveColor = new Color3(0.12, 0.07, 0.03);
  material.specularColor = new Color3(0.12, 0.12, 0.12);
  const shape = Array.from({ length: 17 }, (_, index) => new Vector3(
    cornerHandleHeight / 2 * Math.sin(Math.PI * index / 16),
    0.09 * (index / 16 - 0.5),
    0
  ));
  const halfWidth = (FIELD_WIDTH_YARDS + GROUND_TABLETOP_MARGIN_YARDS * 2) / 2;
  const halfLength = (FIELD_LENGTH_YARDS + GROUND_TABLETOP_MARGIN_YARDS * 2) / 2;
  for (const x of [-halfWidth, halfWidth]) {
    for (const z of [-halfLength, halfLength]) {
      const handle = MeshBuilder.CreateLathe(
        "tabletopCornerHandle",
        { shape, tessellation: 24, cap: Mesh.NO_CAP },
        scene
      );
      handle.parent = arPivot;
      handle.rotation.z = Math.PI / 2;
      handle.material = material;
      handle.visibility = 0;
      cornerHandles.set(handle, new Vector3(x, cornerHandleY, z));
    }
  }
}

export function getTabletopCorner(handle: AbstractMesh | null): Vector3 | null {
  return arTabletopModeActive && handle?.isEnabled() ? cornerHandles.get(handle)?.clone() ?? null : null;
}

export function setTabletopCornerHandlesVisible(visible: boolean) {
  cornerHandles.forEach((_, handle) => {
    handle.visibility = visible && arTabletopModeActive ? 1 : 0;
  });
}

// The horizon ground only makes sense at full 1:1 VR scale — hide it whenever
// in an AR session, or at any reduced VR scale.
// The skybox stays visible at any VR scale; it's only hidden for AR passthrough.
function updateHiddenMeshVisibility(arScale: number) {
  const hideGround = arTabletopModeActive || arScale < AR_SCALE_MAX;
  contentRootMeshes.forEach((mesh) => {
    if (mesh.name === "skyBox") {
      mesh.setEnabled(!arTabletopModeActive);
    } else if (mesh.name === "horizonGround") {
      mesh.setEnabled(!hideGround);
    }
  });
}

// The field's world position is stored on the pivot so we can keep the scene
// at a tablet-top height while still moving it in X/Z and rotating it in Y.
export function getARPosition() {
  return arPivot.position.clone();
}

export function getARScale() {
  return arRoot.scaling.x;
}

export function isARTabletopModeActive() {
  return arTabletopModeActive;
}

export function setARScale(scale: number) {
  const clampedScale = clampScale(scale);
  arRoot.scaling.setAll(clampedScale);
  globalScaleRoot.scaling.setAll(clampedScale);
  updateGroundFootprint(clampedScale);
  updateCornerHandles(clampedScale);
  updateHiddenMeshVisibility(clampedScale);
  return clampedScale;
}

export function setARPosition(position: Vector3) {
  arPivot.position.x = position.x;
  arPivot.position.y = position.y;
  arPivot.position.z = position.z;
}

export function getARRotation() {
  return arPivot.rotation.y;
}

export function setARRotation(yaw: number) {
  arPivot.rotation.y = yaw;
}

// Height is independent of AR/VR mode so it carries over across mode switches.
export function getARHeight() {
  return arPivot.position.y;
}

export function setARHeight(height: number) {
  arPivot.position.y = height;
}

// Must be called once all real scene content exists, but before anything that
// should stay outside AR's shrink-to-tabletop transform (e.g. the teleport grid).
// Capture the scene graph before rebasing it under the AR transform roots.
export function captureContentRootMeshes() {
  contentRootMeshes = scene.meshes.filter((mesh) => !mesh.parent);
  contentRootMeshes.forEach((mesh) => {
    if (mesh !== globalScaleRoot && !AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setParent(globalScaleRoot);
    }
  });
}

export function enterARTabletopMode() {
  if (arTabletopModeActive) return;
  arTabletopModeActive = true;
  createCornerHandles();
  cornerHandles.forEach((_, handle) => handle.setEnabled(true));
  contentRootMeshes.forEach((mesh) => {
    if (!AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setParent(arRoot);
    }
  });
  setARScale(AR_SCALE_DEFAULT);
  setARRotation(0);
  // Only default the height the first time; later entries keep whatever height the user set.
  const height = hasEnteredARTabletopModeBefore ? arPivot.position.y : AR_TABLE_HEIGHT;
  hasEnteredARTabletopModeBefore = true;
  arPivot.position = new Vector3(0, height, 0.6);
  arPivot.rotation.setAll(0);
  arRoot.position.setAll(0);
  globalScaleRoot.position.setAll(0);
}

export function exitARTabletopMode() {
  if (!arTabletopModeActive) return;
  arTabletopModeActive = false;
  cornerHandles.forEach((_, handle) => handle.setEnabled(false));
  contentRootMeshes.forEach((mesh) => {
    if (!AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setParent(globalScaleRoot);
    }
  });
  arRoot.scaling.setAll(1);
  globalScaleRoot.scaling.setAll(1);
  updateGroundFootprint(1);
  updateHiddenMeshVisibility(1);
  setARRotation(0);
  arPivot.position.x = 0;
  arPivot.position.z = 0;
  arPivot.rotation.setAll(0);
  arRoot.position.setAll(0);
  globalScaleRoot.position.setAll(0);
}

export function getARScaleRange() {
  return { min: AR_SCALE_MIN, max: AR_SCALE_MAX, default: AR_SCALE_DEFAULT };
}

// Parents a node (e.g. the teleport grid) under the shared AR transform so it
// scales/moves/rotates along with the field instead of staying world-scale.
export function attachToARTransform(node: TransformNode) {
  node.setParent(arRoot);
}
