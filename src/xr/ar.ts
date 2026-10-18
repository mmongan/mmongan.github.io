import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { Camera } from '@babylonjs/core/Cameras/camera.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Observable } from '@babylonjs/core/Misc/observable.pure';
import { scene } from '../scene/engine';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS, FIELD_SURFACE_Y } from '../field/constants';

// AR tabletop mode: shrink the whole stadium onto a table. The skybox and
// horizon ground are world-scale backdrops. The horizon follows the unscaled
// pivot so it stays below the field; visibility rules for
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
let immersiveFieldScaling = false;
let fieldHeightMode: "floor" | "table" = "floor";
const fieldHeights = { floor: 0, table: AR_TABLE_HEIGHT };
let contentRootMeshes: AbstractMesh[] = [];

// Fired with the new scale whenever the field is scaled or tabletop mode exits.
export const onARScaleChangedObservable = new Observable<number>();

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
  const clampedScale = immersiveFieldScaling ? clampScale(scale) : AR_SCALE_MAX;
  arRoot.scaling.setAll(clampedScale);
  globalScaleRoot.scaling.setAll(clampedScale);
  updateGroundFootprint(clampedScale);
  updateHiddenMeshVisibility(clampedScale);
  onARScaleChangedObservable.notifyObservers(clampedScale);
  return clampedScale;
}

export function setImmersiveFieldScaling(enabled: boolean) {
  immersiveFieldScaling = enabled;
  if (!enabled) {
    exitARTabletopMode();
    setARScale(AR_SCALE_MAX);
    setARRotation(0);
    setARPosition(Vector3.Zero());
    setFieldHeightMode('floor');
  }
}

// True in Giant and tabletop modes, where the field is shrunk below full scale.
export function isFieldShrunk() {
  return arTabletopModeActive || getARScale() < AR_SCALE_MAX;
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

export function placeTabletopInFrontOfCamera(camera: Camera) {
  camera.computeWorldMatrix();
  const forward = camera.getDirection(new Vector3(0, 0, scene.useRightHandedSystem ? -1 : 1));
  forward.y = 0;
  if (forward.lengthSquared() < 0.000001) {
    const right = camera.getDirection(Vector3.Right());
    forward.set(-right.z, 0, right.x);
    if (scene.useRightHandedSystem) forward.negateInPlace();
  }
  forward.normalize();
  arPivot.position.x = camera.globalPosition.x + forward.x * 0.6;
  arPivot.position.z = camera.globalPosition.z + forward.z * 0.6;
  setARRotation(Math.atan2(forward.x, forward.z));
}

// Height is independent of AR/VR mode so it carries over across mode switches.
export function getARHeight() {
  return arPivot.position.y;
}

export function setARHeight(height: number) {
  arPivot.position.y = height;
}

// World-space height of the field surface, independent of the current scale.
export function getARSurfaceHeight() {
  return arPivot.position.y + FIELD_SURFACE_Y * getARScale();
}

export function setARSurfaceHeight(height: number) {
  arPivot.position.y = height - FIELD_SURFACE_Y * getARScale();
}

// While scaling, a tabletop-size field keeps the requested surface height,
// but as it grows past the tabletop it settles onto the floor so a large
// field or life-size marchers stand on the ground instead of at eye level.
export function getScaleAwareSurfaceHeight(height: number, scale: number) {
  if (scale <= AR_SCALE_DEFAULT) return height;
  const t = Math.min(1, Math.log(scale / AR_SCALE_DEFAULT) /
    Math.log(AR_SCALE_MAX / AR_SCALE_DEFAULT));
  const eased = t * t * (3 - 2 * t);
  return height + (fieldHeights.floor - height) * eased;
}

// Hands naturally rise while spreading apart, so vertical hand motion stops
// moving the field once it has grown 4x during the gesture.
const GESTURE_LIFT_FADE_RATIO = 4;
export function getScaleGestureSurfaceHeight(startSurfaceY: number, verticalDelta: number,
  startScale: number, scale: number) {
  const growth = scale > startScale
    ? Math.min(1, Math.log(scale / startScale) / Math.log(GESTURE_LIFT_FADE_RATIO)) : 0;
  return getScaleAwareSurfaceHeight(startSurfaceY + verticalDelta * (1 - growth), scale);
}

export function setFieldHeightMode(mode: "floor" | "table") {
  fieldHeightMode = mode;
  setARHeight(fieldHeights[mode] - FIELD_SURFACE_Y * getARScale());
}

export function getFieldHeightMode() {
  return fieldHeightMode;
}

export function getFieldHeightSetting(mode: "floor" | "table") {
  return fieldHeights[mode];
}

export function setFieldHeightSetting(mode: "floor" | "table", height: number) {
  fieldHeights[mode] = height;
  if (fieldHeightMode === mode) setFieldHeightMode(mode);
}

// Must be called once all real scene content exists, but before anything that
// should stay outside AR's shrink-to-tabletop transform (e.g. the teleport grid).
// Capture the scene graph before rebasing it under the AR transform roots.
export function captureContentRootMeshes() {
  contentRootMeshes = scene.meshes.filter((mesh) => !mesh.parent);
  contentRootMeshes.forEach((mesh) => {
    if (mesh.name === "horizonGround") {
      mesh.parent = arPivot;
    } else if (mesh !== globalScaleRoot && !AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setParent(globalScaleRoot);
    }
  });
}

export function enterARTabletopMode() {
  if (!immersiveFieldScaling || arTabletopModeActive) return;
  arTabletopModeActive = true;
  contentRootMeshes.forEach((mesh) => {
    if (!AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setParent(arRoot);
    }
  });
  setARScale(AR_SCALE_DEFAULT);
  setARRotation(0);
  setFieldHeightMode("table");
  arPivot.rotation.setAll(0);
  arRoot.position.setAll(0);
  globalScaleRoot.position.setAll(0);
  if (scene.activeCamera) placeTabletopInFrontOfCamera(scene.activeCamera);
}

export function exitARTabletopMode() {
  if (!arTabletopModeActive) return;
  arTabletopModeActive = false;
  contentRootMeshes.forEach((mesh) => {
    if (!AR_HIDDEN_MESH_NAMES.has(mesh.name)) {
      mesh.setParent(globalScaleRoot);
    }
  });
  arRoot.scaling.setAll(1);
  globalScaleRoot.scaling.setAll(1);
  setFieldHeightMode("floor");
  updateGroundFootprint(1);
  updateHiddenMeshVisibility(1);
  setARRotation(0);
  arPivot.position.x = 0;
  arPivot.position.z = 0;
  arPivot.rotation.setAll(0);
  arRoot.position.setAll(0);
  globalScaleRoot.position.setAll(0);
  onARScaleChangedObservable.notifyObservers(1);
}

export function getARScaleRange() {
  return { min: AR_SCALE_MIN, max: AR_SCALE_MAX, default: AR_SCALE_DEFAULT };
}

// Parents a node (e.g. the teleport grid) under the shared AR transform so it
// scales/moves/rotates along with the field instead of staying world-scale.
export function attachToARTransform(node: TransformNode) {
  node.setParent(arRoot);
}
