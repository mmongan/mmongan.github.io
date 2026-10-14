import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { WebXRHandJoint, WebXRHandTracking } from '@babylonjs/core/XR/features/WebXRHandTracking.pure';
import { WebXRGenericTriggerMotionController } from '@babylonjs/core/XR/motionController/webXRGenericMotionController';
import { WebXRMotionControllerManager } from '@babylonjs/core/XR/motionController/webXRMotionControllerManager.pure';
import { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import { WebXRDefaultExperience } from '@babylonjs/core/XR/webXRDefaultExperience';
import { WebXRFeatureName } from '@babylonjs/core/XR/webXRFeaturesManager';
import { WebXRState } from '@babylonjs/core/XR/webXRTypes';
import type { IWebXRTeleportationOptions, WebXRMotionControllerTeleportation } from '@babylonjs/core/XR/features/WebXRControllerTeleportation';
import { getNavigationControllerHand, swapControllerRolesToggle } from '../ui/dom';
import '@babylonjs/loaders/glTF';
import { RegisterWebXROculusTouchMotionController } from '@babylonjs/core/XR/motionController/webXROculusTouchMotionController.pure';
import { scene } from '../scene/engine';
import { connectMidiXRSession } from '../audio/midiPlayback';
import { connectMarcherPOVXR, isMarcherPOVActive, setMarcherPOVEnabled } from '../camera/marcherPOV';
import { setTableHeightForPosture } from '../menu/settings';
import { xrModeInputs, getSelectedXRMode, floorCalibrationToggle, fullScaleVRButton, tabletopScaleButton, giantModeButton, roomWidthInput, roomLengthInput, sittingModeToggle } from '../ui/dom';
import { FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import { enterARTabletopMode, exitARTabletopMode, getARPosition, getARScale, getARScaleRange, setARPosition, setARScale, setFieldHeightMode, getFieldHeightMode, setARSurfaceHeight } from './ar';
import { getGloveHandTrackingOptions } from './gloveMeshes';
import { setActiveController, removeActiveController, setHandTracking, getActiveControllers, consumeFloorCalibrationGesture, setHandFloorContact } from '../interaction/pathInteraction';

RegisterWebXROculusTouchMotionController();
WebXRMotionControllerManager.PrioritizeOnlineRepository = true;

// Height of the calibrated real floor above the headset's local-floor origin.
let playerFloorOffset = 0;
let postureHeightOffset = 0;

function resetPlayerFloorOffset() {
  playerFloorOffset = 0;
}

function setPlayerFloorOffset(offset: number) {
  if (!Number.isFinite(offset)) return false;
  playerFloorOffset = offset;
  return true;
}

function getTrackedPlayerHeight(camera: WebXRCamera) {
  return camera.realWorldHeight - playerFloorOffset;
}

// WebXR session detection: this keeps the app from trying to launch unsupported
// VR/AR modes while still allowing the chosen mode to fail quietly.
async function checkSessionSupport(mode: XRSessionMode) {
  if (!navigator.xr) {
    console.warn("WebXR is not available in this browser.");
    return false;
  }

  const supported = await navigator.xr.isSessionSupported(mode);
  if (!supported) {
    console.warn(`The ${mode} session mode is not supported on this device or browser.`);
    return false;
  }

  return true;
}

// Grid overlay shown across the whole floor while aiming to teleport in VR.
export function createTeleportGrid(): Mesh {
  const teleportGridCanvas = document.createElement("canvas");
  teleportGridCanvas.width = 64;
  teleportGridCanvas.height = 64;
  const teleportGridCtx = teleportGridCanvas.getContext("2d")!;
  teleportGridCtx.clearRect(0, 0, 64, 64);
  teleportGridCtx.strokeStyle = "rgba(120, 220, 255, 0.9)";
  teleportGridCtx.lineWidth = 2;
  teleportGridCtx.strokeRect(0, 0, 64, 64);

  const teleportGridTexture = new DynamicTexture(
    "teleportGridTexture",
    teleportGridCanvas,
    scene,
    false,
    Texture.TRILINEAR_SAMPLINGMODE
  );
  teleportGridTexture.update(true);
  teleportGridTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  teleportGridTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  teleportGridTexture.hasAlpha = true;
  const teleportGridRadius = 240;
  // Matches the marching band "8 to 5" step size (8 steps per 5 yards) used
  // for path-drawing snap in interaction.ts, so the grid lines line up with
  // where drawn points actually land.
  const teleportGridCellYards = 0.625;
  const teleportGridTiles = (teleportGridRadius * 2) / teleportGridCellYards;
  teleportGridTexture.uScale = teleportGridTiles;
  teleportGridTexture.vScale = teleportGridTiles;

  const teleportGridMaterial = new StandardMaterial("teleportGridMaterial", scene);
  teleportGridMaterial.diffuseTexture = teleportGridTexture;
  teleportGridMaterial.opacityTexture = teleportGridTexture;
  teleportGridMaterial.disableLighting = true;
  teleportGridMaterial.emissiveColor = new Color3(0.5, 0.9, 1);
  teleportGridMaterial.specularColor = new Color3(0, 0, 0);
  teleportGridMaterial.backFaceCulling = false;

  const teleportGrid = MeshBuilder.CreateDisc(
    "teleportGrid",
    { radius: teleportGridRadius, tessellation: 64 },
    scene
  );
  teleportGrid.rotation.x = Math.PI / 2;
  teleportGrid.position.y = -0.45;
  teleportGrid.material = teleportGridMaterial;
  teleportGrid.isPickable = false;
  teleportGrid.setEnabled(false);

  return teleportGrid;
}

// Teleporting is restricted to the field; the surrounding ground
// remains scenery, not a valid destination.
function getFieldFloorMeshes(): AbstractMesh[] {
  const field = scene.getMeshByName("field");
  return field ? [field] : [];
}

export function initXR(teleportGrid: Mesh) {
  // Keep the active XR mode in sync with the radio UI while the app runs.
  let preferredMode: XRSessionMode = getSelectedXRMode();
  // The default XR experience bakes its Enter button to whatever sessionMode
  // was passed in at creation time, so switching the radio has to rebuild it —
  // otherwise "AR" still launches an opaque immersive-vr session (black background).
  let xrExperience: WebXRDefaultExperience | undefined;
  let navigationOptions: IWebXRTeleportationOptions | undefined;
  swapControllerRolesToggle?.addEventListener("change", () => {
    if (!navigationOptions) return;
    navigationOptions.forceHandedness = getNavigationControllerHand();
    const teleportation = xrExperience?.teleportation;
    if (teleportation?.attached) teleportation.detach();
    teleportGrid.setEnabled(false);
    updateTeleportationAvailability();
  });
  let handTrackingFeature: WebXRHandTracking | null = null;
  let wasCalibratingFloor = false;
  const calibrationPresses = new Map<string, boolean>();
  let switchingToFullScaleVR = false;
  let giantModeActive = false;
  let detectedSitting: boolean | null = null;
  let pendingSitting: boolean | null = null;
  let pendingPostureSince = 0;

  function updateTableHeightFromCamera(camera: WebXRCamera, sitting: boolean) {
    const height = camera.realWorldHeight;
    if (!Number.isFinite(height) || height <= 0) return;
    const worldScale = xrExperience?.baseExperience.sessionManager.worldScalingFactor ?? 1;
    const tableAboveFloor = Math.max(0, Math.min(
      (sitting ? 0.75 : 1) * worldScale,
      height - 0.45 * worldScale
    ));
    setTableHeightForPosture(sitting, getHeadsetFloorY(camera) + tableAboveFloor);
  }

  function updateDetectedPosture(camera: WebXRCamera) {
    if (floorCalibrationToggle?.checked) {
      pendingSitting = null;
      return;
    }
    const worldScale = xrExperience?.baseExperience.sessionManager.worldScalingFactor ?? 1;
    const height = camera.realWorldHeight / worldScale;
    if (!Number.isFinite(height) || height <= 0) {
      pendingSitting = null;
      return;
    }
    const sitting = detectedSitting === null
      ? height < 1.425
      : detectedSitting ? height < 1.5 : height < 1.35;
    if (sitting === detectedSitting) {
      pendingSitting = null;
      return;
    }
    const now = performance.now();
    if (pendingSitting !== sitting) {
      pendingSitting = sitting;
      pendingPostureSince = now;
    }
    if (now - pendingPostureSince >= 1000) {
      detectedSitting = sitting;
      pendingSitting = null;
      updateTableHeightFromCamera(camera, sitting);
    }
  }

  function applyPostureHeight(camera: WebXRCamera) {
    if (preferredMode !== "immersive-vr") return;
    const trackedHeight = camera.realWorldHeight;
    if (!Number.isFinite(trackedHeight) || trackedHeight <= 0) {
      console.warn("Cannot apply sitting/standing height until a valid XR pose is available.");
      return;
    }
    const fullScaleFloor = !giantModeActive && getFieldHeightMode() === "floor";
    // Standing keeps physical eye height so real feet stay on the turf; the
    // floor-calibration offset shifts tracking space instead of the field.
    if (fullScaleFloor) setFieldHeightMode("floor");
    const newOffset = !fullScaleFloor
      ? 0
      : sittingModeToggle?.checked ? 1.2 - trackedHeight : -playerFloorOffset;
    camera.position.y += newOffset - postureHeightOffset;
    postureHeightOffset = newOffset;
  }

  sittingModeToggle?.addEventListener("change", () => {
    const baseExperience = xrExperience?.baseExperience;
    if (baseExperience?.state === WebXRState.IN_XR) {
      applyPostureHeight(baseExperience.camera);
      updateTableHeightFromCamera(baseExperience.camera, !!sittingModeToggle?.checked);
    }
  });
  const floorCalibrationStorageKey = "chartxr.floorCalibrationOffset.v2";
  let savedFloorOffset: number | null = null;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(floorCalibrationStorageKey) ?? "null");
    if (typeof value === "number" && Number.isFinite(value)) savedFloorOffset = value;
  } catch (error) {
    console.warn("Unable to read saved floor calibration:", error);
  }
  let fullScaleNoticeShown = false;
  let floorResetNotice: Mesh | null = null;
  let floorResetNoticeTimeout: ReturnType<typeof setTimeout> | undefined;

  function hideFloorResetNotice() {
    clearTimeout(floorResetNoticeTimeout);
    floorResetNoticeTimeout = undefined;
    floorResetNotice?.setEnabled(false);
  }

  function showFloorResetNotice(camera: WebXRCamera) {
    if (!floorResetNotice || floorResetNotice.isDisposed()) {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 96;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(18, 22, 32, 0.94)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "white";
      ctx.font = "28px 'Segoe UI', Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Touch the floor to reset your height", canvas.width / 2, canvas.height / 2);
      const texture = new DynamicTexture("floorResetNoticeTexture", canvas, scene, false);
      texture.hasAlpha = true;
      texture.update(true);
      const material = new StandardMaterial("floorResetNoticeMaterial", scene);
      material.diffuseTexture = texture;
      material.opacityTexture = texture;
      material.emissiveColor = Color3.White();
      material.disableLighting = true;
      material.backFaceCulling = false;
      material.disableDepthWrite = true;
      floorResetNotice = MeshBuilder.CreatePlane("floorResetNotice", { width: 0.48, height: 0.072 }, scene);
      floorResetNotice.material = material;
      floorResetNotice.position.set(0, -0.13, 0.8);
      floorResetNotice.isPickable = false;
      floorResetNotice.applyFog = false;
      floorResetNotice.renderingGroupId = 3;
      floorResetNotice.onDisposeObservable.add(() => material.dispose(false, true));
    }
    floorResetNotice.parent = camera;
    floorResetNotice.setEnabled(true);
    clearTimeout(floorResetNoticeTimeout);
    floorResetNoticeTimeout = setTimeout(hideFloorResetNotice, 8000);
  }

  async function enterFullScaleVR() {
    if (switchingToFullScaleVR) return;
    if (isMarcherPOVActive()) setMarcherPOVEnabled(false);
    switchingToFullScaleVR = true;
    try {
      giantModeActive = false;
      setARScale(getARScaleRange().max);
      setFieldHeightMode("floor");
      if (xrExperience?.baseExperience.state === WebXRState.IN_XR) {
        applyPostureHeight(xrExperience.baseExperience.camera);
      }
      if (preferredMode !== "immersive-vr") {
        if (xrExperience && xrExperience.baseExperience.state !== WebXRState.NOT_IN_XR) {
          await xrExperience.baseExperience.exitXRAsync();
        }
        xrExperience?.dispose();
        xrExperience = undefined;
        preferredMode = "immersive-vr";
        xrModeInputs.forEach((input) => { input.checked = input.value === preferredMode; });
      }
      if (!xrExperience) await setupDefaultXRExperience();
      if (xrExperience?.baseExperience.state === WebXRState.NOT_IN_XR) {
        await xrExperience.baseExperience.enterXRAsync("immersive-vr", "local-floor");
      }
    } catch (error) {
      console.error("Failed to enter full-scale VR:", error);
    } finally {
      switchingToFullScaleVR = false;
    }
  }

  fullScaleVRButton?.addEventListener("click", () => { void enterFullScaleVR(); });
  tabletopScaleButton?.addEventListener("click", () => {
    if (switchingToFullScaleVR) return;
    if (isMarcherPOVActive()) setMarcherPOVEnabled(false);
    giantModeActive = false;
    setARScale(getARScaleRange().default);
    setFieldHeightMode("table");
    if (floorCalibrationToggle) floorCalibrationToggle.checked = false;
    const baseExperience = xrExperience?.baseExperience;
    if (baseExperience?.state === WebXRState.IN_XR) {
      applyPostureHeight(baseExperience.camera);
      updateTableHeightFromCamera(baseExperience.camera, detectedSitting ?? !!sittingModeToggle?.checked);
    }
    updateTeleportationAvailability();
  });

  function applyRoomScale() {
    if (!roomWidthInput || !roomLengthInput) return;
    if (!roomWidthInput.reportValidity() || !roomLengthInput.reportValidity()) return;
    if (isMarcherPOVActive()) setMarcherPOVEnabled(false);
    // Scene field coordinates are yards, but XR world coordinates are meters.
    setARScale(Math.min(
      roomWidthInput.valueAsNumber / FIELD_WIDTH_YARDS,
      roomLengthInput.valueAsNumber / FIELD_LENGTH_YARDS
    ));
    setFieldHeightMode("floor");
    giantModeActive = true;
    resetPlayerFloorOffset();
    if (floorCalibrationToggle) floorCalibrationToggle.checked = false;
    const baseExperience = xrExperience?.baseExperience;
    if (baseExperience?.state === WebXRState.IN_XR) {
      applyPostureHeight(baseExperience.camera);
      alignRoomScaleFloor(baseExperience.camera);
    }
    updateTeleportationAvailability();
  }

  giantModeButton?.addEventListener("click", () => {
    if (!switchingToFullScaleVR) applyRoomScale();
  });
  for (const input of [roomWidthInput, roomLengthInput]) {
    input?.addEventListener("change", () => {
      if (giantModeActive && !switchingToFullScaleVR) applyRoomScale();
    });
  }

  function updateTeleportationAvailability() {
    const teleportation = xrExperience?.teleportation;
    const enabled = isTeleportationEnabled();
    if (!teleportation) {
      teleportGrid.setEnabled(false);
      return;
    }
    teleportation.teleportationTargetMesh?.scaling.setAll(
      getARScale() * xrExperience!.baseExperience.sessionManager.worldScalingFactor
    );
    teleportation.disableAutoAttach = !enabled;
    if (!enabled) {
      if (teleportation.attached) teleportation.detach();
      teleportGrid.setEnabled(false);
    } else if (xrExperience?.baseExperience.state === WebXRState.IN_XR && !teleportation.attached) {
      teleportation.attach();
    }
  }

  // Fields smaller than this (longest side, in meters) are within reach and
  // shouldn't be teleported across.
  const MIN_TELEPORT_FIELD_SIZE_METERS = 2;

  function isTeleportationEnabled() {
    return preferredMode === "immersive-vr" && getFieldHeightMode() === "floor" &&
      !isMarcherPOVActive() &&
      !floorCalibrationToggle?.checked &&
      Math.max(FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS) * getARScale() >= MIN_TELEPORT_FIELD_SIZE_METERS;
  }

  function getHeadsetFloorY(camera: WebXRCamera): number {
    camera.computeWorldMatrix();
    return camera.globalPosition.y - camera.realWorldHeight - postureHeightOffset;
  }

  function alignRoomScaleFloor(camera: WebXRCamera) {
    if (!giantModeActive || getFieldHeightMode() !== "floor") return;
    if (!Number.isFinite(camera.realWorldHeight) || camera.realWorldHeight <= 0) return;
    setARSurfaceHeight(getHeadsetFloorY(camera));
  }

  function alignFieldFloorTo(floor: AbstractMesh, floorY: number) {
    floor.computeWorldMatrix(true);
    const fieldPosition = getARPosition();
    fieldPosition.y += floorY - floor.getAbsolutePosition().y;
    setARPosition(fieldPosition);
    floor.computeWorldMatrix(true);
  }

  function updateFloorCalibration() {
    const baseExperience = xrExperience?.baseExperience;
    const manual = !!floorCalibrationToggle?.checked;
    const active = manual && baseExperience?.state === WebXRState.IN_XR && preferredMode === "immersive-vr";
    if (!active || !baseExperience) {
      setHandFloorContact("left", false);
      setHandFloorContact("right", false);
      wasCalibratingFloor = false;
      calibrationPresses.clear();
      return;
    }
    giantModeActive = false;
    const trackedHeight = getTrackedPlayerHeight(baseExperience.camera);
    if (!Number.isFinite(trackedHeight) || trackedHeight <= 0 ||
      !Number.isFinite(baseExperience.camera.realWorldHeight) || baseExperience.camera.realWorldHeight <= 0) {
      calibrationPresses.clear();
      return;
    }
    const floor = scene.getMeshByName("turfStripe0");
    if (!floor) return;
    const floorY = getHeadsetFloorY(baseExperience.camera);
    if (!Number.isFinite(floorY)) return;
    let captured = false;
    let alignedOnEntry = false;
    const capture = (key: string, pressed: boolean, point: Vector3,
      handedness: string, source: "hand" | "controller", confirmation = false, alignOnEntry = false) => {
      const wasPressed = calibrationPresses.get(key) ?? (confirmation ? pressed : false);
      calibrationPresses.set(key, pressed);
      const loweringFloor = source === "controller" && !confirmation && point.y < floorY - 0.01;
      if (captured || !pressed || (!alignOnEntry && ((confirmation && !wasCalibratingFloor) ||
        (wasPressed && !loweringFloor && (confirmation || getARScale() === getARScaleRange().max))))) return;
      const camera = baseExperience.camera;
      camera.computeWorldMatrix();
      const eyeHeight = camera.globalPosition.y - point.y;
      if (!Number.isFinite(eyeHeight) || eyeHeight <= 0 ||
        !Number.isFinite(camera.realWorldHeight) || camera.realWorldHeight <= 0) return;
      if (manual) setARScale(getARScaleRange().max);
      setPlayerFloorOffset(camera.realWorldHeight - eyeHeight);
      alignFieldFloorTo(floor, point.y);
      captured = true;
      alignedOnEntry = alignOnEntry;
      if (alignOnEntry) calibrationPresses.set(`floor:controller:${handedness}`, true);
      fullScaleNoticeShown = true;
      hideFloorResetNotice();
      if (!alignOnEntry) {
        consumeFloorCalibrationGesture(handedness, source);
        if (floorCalibrationToggle) floorCalibrationToggle.checked = false;
      }
    };
    const controllers = [...getActiveControllers().entries()]
      .filter(([, controller]) => controller.grip && !controller.grip.isDisposed())
      .map(([handedness, controller]) => {
      const point = controller.grip!.getAbsolutePosition().clone();
      const model = controller.motionController?.rootMesh;
      if (model) {
        const meshes = [model, ...model.getChildMeshes()].filter((mesh) => mesh.getTotalVertices() > 0);
        const bottom = Math.min(...meshes.map((mesh) => {
          mesh.computeWorldMatrix(true);
          return mesh.getBoundingInfo().boundingBox.minimumWorld.y;
        }));
        if (Number.isFinite(bottom)) point.y = bottom;
      }
      return { handedness, controller, point };
    }).sort((first, second) => first.point.y - second.point.y);
    if (manual && controllers.length > 0) {
      let confirmation: string | null = null;
      controllers.forEach(({ handedness, controller }) => {
        const key = `controller:${handedness}`;
        const pressed = !!controller.motionController?.getComponentOfType("trigger")?.pressed;
        const wasPressed = calibrationPresses.get(key) ?? pressed;
        calibrationPresses.set(key, pressed);
        if (wasCalibratingFloor && pressed && !wasPressed) confirmation = handedness;
      });
      const lowest = controllers[0];
      capture(`preview:controller:${lowest.handedness}`, true, lowest.point,
        lowest.handedness, "controller", false, true);
      if (captured && confirmation !== null) {
        savedFloorOffset = playerFloorOffset;
        try {
          localStorage.setItem(floorCalibrationStorageKey, JSON.stringify(savedFloorOffset));
        } catch (error) {
          console.warn("Unable to save floor calibration:", error);
        }
        consumeFloorCalibrationGesture(confirmation, "controller");
        if (floorCalibrationToggle) floorCalibrationToggle.checked = false;
      }
      wasCalibratingFloor = !!floorCalibrationToggle?.checked;
      return;
    }
    controllers.forEach(({ handedness, controller, point }) => {
      if (captured) return;
      if (manual && !wasCalibratingFloor) {
        capture(`entry:controller:${handedness}`, true, point, handedness, "controller", false, true);
        return;
      }
      if (controller.motionController?.rootMesh) {
        const key = `floor:controller:${handedness}`;
        const touching = point.y - floorY <= (calibrationPresses.get(key) ? 0.04 : 0.025);
        capture(key, touching, point, handedness, "controller");
      }
      const pressed = !!controller.motionController?.getComponentOfType("trigger")?.pressed;
      if (manual) capture(`controller:${handedness}`, pressed, point, handedness, "controller", true);
    });
    for (const handedness of ["left", "right"] as const) {
      const hand = handTrackingFeature?.getHandByHandedness(handedness);
      if (!hand) {
        setHandFloorContact(handedness, false);
        continue;
      }
      const finger = hand.getJointMesh(WebXRHandJoint.INDEX_FINGER_TIP).getAbsolutePosition();
      const thumb = hand.getJointMesh(WebXRHandJoint.THUMB_TIP).getAbsolutePosition();
      const key = `hand:${handedness}`;
      const distance = Vector3.Distance(finger, thumb);
      if (distance < 0.002) {
        setHandFloorContact(handedness, false);
        continue;
      }
      const floorKey = `floor:hand:${handedness}`;
      const touching = Math.abs(finger.y - floorY) <= (calibrationPresses.get(floorKey) ? 0.04 : 0.025);
      setHandFloorContact(handedness, touching);
      capture(floorKey, touching, finger, handedness, "hand");
      const pressed = distance < (calibrationPresses.get(key) ? 0.04 : 0.025);
      if (manual) capture(key, pressed, finger, handedness, "hand", true);
    }
    wasCalibratingFloor = manual && (alignedOnEntry || !captured);
  }

  xrModeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      preferredMode = getSelectedXRMode();
      if (xrExperience && xrExperience.baseExperience.state === WebXRState.NOT_IN_XR) {
        xrExperience.dispose();
        xrExperience = undefined;
        void setupDefaultXRExperience();
      }
    });
  });

  async function setupDefaultXRExperience() {
    if (!(await checkSessionSupport(preferredMode))) {
      return;
    }

    try {
      const gloveHandTrackingOptions = await getGloveHandTrackingOptions(scene);
      xrExperience = await WebXRDefaultExperience.CreateAsync(scene, {
        uiOptions: {
          sessionMode: preferredMode,
          referenceSpaceType: "local-floor",
        },
        optionalFeatures: true,
        handSupportOptions: {
          jointMeshes: { invisible: true },
          handMeshes: gloveHandTrackingOptions,
        },
        floorMeshes: getFieldFloorMeshes(),
        disableTeleportation: true,
        inputOptions: {
          doNotLoadControllerMeshes: false,
          disableControllerAnimation: false,
          disableOnlineControllerRepository: false,
          customControllersRepositoryURL: "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist",
        },
      });

      navigationOptions = undefined;
      if (preferredMode !== "immersive-ar") {
        navigationOptions = {
          xrInput: xrExperience.input,
          floorMeshes: getFieldFloorMeshes(),
          forceHandedness: getNavigationControllerHand(),
        };
        xrExperience.teleportation = xrExperience.baseExperience.featuresManager.enableFeature(
          WebXRFeatureName.TELEPORTATION, "stable", navigationOptions
        ) as WebXRMotionControllerTeleportation;
        xrExperience.teleportation.setSelectionFeature(xrExperience.pointerSelection);
      }

      xrExperience.baseExperience.onInitialXRPoseSetObservable.add((camera) => {
        postureHeightOffset = 0;
        resetPlayerFloorOffset();
        if (preferredMode === "immersive-vr" && !giantModeActive && savedFloorOffset !== null) {
          setPlayerFloorOffset(savedFloorOffset);
        }
        applyPostureHeight(camera);
        alignRoomScaleFloor(camera);
        if (getFieldHeightMode() === "table") {
          updateTableHeightFromCamera(camera, camera.realWorldHeight < 1.425 *
            xrExperience!.baseExperience.sessionManager.worldScalingFactor);
        }
      });

      const handTracking = xrExperience.baseExperience.featuresManager
        .getEnabledFeature(WebXRFeatureName.HAND_TRACKING) ?? null;
      handTrackingFeature = handTracking;
      setHandTracking(handTracking);
      const sessionManager = xrExperience.baseExperience.sessionManager;
      sessionManager.onXRSessionInit.add(connectMidiXRSession);
      connectMarcherPOVXR(xrExperience, () => preferredMode === "immersive-vr" && !floorCalibrationToggle?.checked);
      const setGloveScale = (scale: number) => {
        gloveHandTrackingOptions.customMeshes.left.scaling.setAll(scale);
        gloveHandTrackingOptions.customMeshes.right.scaling.setAll(scale);
      };
      setGloveScale(sessionManager.worldScalingFactor);
      sessionManager.onWorldScaleFactorChangedObservable.add(({ newScaleFactor }) => {
        setGloveScale(newScaleFactor);
      });

      const teleportation = xrExperience.teleportation;
      updateTeleportationAvailability();
      if (teleportation) {
        let teleportHeightCorrection = 0;
        teleportation.onBeforeCameraTeleport.add(() => {
          const camera = xrExperience!.baseExperience.camera;
          const rawHeight = camera.realWorldHeight;
          const seatedFullScale = !giantModeActive && getFieldHeightMode() === "floor" && !!sittingModeToggle?.checked;
          const eyeHeight = seatedFullScale ? 1.2 : getTrackedPlayerHeight(camera);
          teleportHeightCorrection = Number.isFinite(rawHeight) && Number.isFinite(eyeHeight) && eyeHeight > 0
            ? rawHeight - eyeHeight
            : 0;
        });
        teleportation.onAfterCameraTeleport.add(() => {
          xrExperience!.baseExperience.camera.position.y -= teleportHeightCorrection;
          teleportHeightCorrection = 0;
        });
        let gridHideTimeout: ReturnType<typeof setTimeout> | undefined;
        teleportation.onTargetMeshPositionUpdatedObservable.add(() => {
          if (!isTeleportationEnabled()) {
            teleportGrid.setEnabled(false);
            return;
          }
          teleportGrid.setEnabled(true);
          clearTimeout(gridHideTimeout);
          gridHideTimeout = setTimeout(() => teleportGrid.setEnabled(false), 150);
        });
      }

      xrExperience.baseExperience.onStateChangedObservable.add((state) => {
        if (state === WebXRState.IN_XR && sessionManager.isFixedFoveationSupported) {
          sessionManager.fixedFoveation = 0.5;
        }
        if (state === WebXRState.ENTERING_XR || state === WebXRState.IN_XR) {
          if (state === WebXRState.ENTERING_XR) {
            setHandTracking(handTracking);
          }
          if (preferredMode === "immersive-ar") {
            scene.clearColor = new Color4(0, 0, 0, 0);
            scene.autoClear = true;
            enterARTabletopMode();
            if (giantModeActive) applyRoomScale();
          } else {
            scene.clearColor = new Color4(0.03, 0.05, 0.09, 1);
            exitARTabletopMode();
            if (giantModeActive) applyRoomScale();
          }
          updateTeleportationAvailability();
          return;
        }

        if (state === WebXRState.NOT_IN_XR) {
          detectedSitting = null;
          pendingSitting = null;
          fullScaleNoticeShown = false;
          hideFloorResetNotice();
          wasCalibratingFloor = false;
          calibrationPresses.clear();
          resetPlayerFloorOffset();
          postureHeightOffset = 0;
          setHandTracking(null);
          scene.clearColor = new Color4(0.03, 0.05, 0.09, 1);
          teleportGrid.setEnabled(false);
          exitARTabletopMode();
        }
      });

      xrExperience.input.onControllerRemovedObservable.add(removeActiveController);
      xrExperience.input.onControllerAddedObservable.add((controller) => {
        if (controller.inputSource.hand) return;
        setActiveController(controller);
        const handedness = controller.inputSource.handedness || "unknown";
        console.log(`Quest 3 controller connected: ${handedness}`);

        const pointerMaterial = new StandardMaterial(
          `pointerMat-${controller.uniqueId}`,
          scene
        );
        pointerMaterial.emissiveColor = new Color3(0.55, 0.9, 1);
        pointerMaterial.diffuseColor = new Color3(0.15, 0.3, 0.5);
        controller.pointer.material = pointerMaterial;

        if (controller.grip) {
          const gripMaterial = new StandardMaterial(
            `gripMat-${controller.uniqueId}`,
            scene
          );
          gripMaterial.emissiveColor = new Color3(0.8, 0.9, 1);
          controller.grip.material = gripMaterial;
        }

        controller.onMotionControllerInitObservable.add((motionController) => {
          const applyRealControllerScale = () => {
            const profileId = motionController.profileId || "unknown";
            const isQuestProfile = profileId.includes("oculus") || profileId.includes("quest");

            if (!isQuestProfile || motionController instanceof WebXRGenericTriggerMotionController) {
              console.warn(
                `Quest 3 controller (${handedness}) is using profile "${profileId}"; this is not the real Quest mesh.`
              );
              return;
            }

            motionController.rootMesh?.scaling.setAll(1);
            console.log(`Loaded real Quest controller mesh for ${handedness}: ${profileId}`);
          };

          if (motionController.rootMesh) {
            applyRealControllerScale();
          } else {
            motionController.onModelLoadedObservable.addOnce(applyRealControllerScale);
          }
        });
      });
    } catch (error) {
      console.error(`Failed to prepare ${preferredMode}:`, error);
    }
  }

  void setupDefaultXRExperience();

  // Keep teleportation in sync with the field's current scale.
  scene.onBeforeAnimationsObservable.add(() => {
    if (isMarcherPOVActive() && scene.activeCamera?.getClassName() === "WebXRCamera") {
      if (preferredMode !== "immersive-vr" || floorCalibrationToggle?.checked) setMarcherPOVEnabled(false);
      else {
        updateTeleportationAvailability();
        return;
      }
    }
    updateFloorCalibration();
    const baseExperience = xrExperience?.baseExperience;
    if (baseExperience?.state === WebXRState.IN_XR) {
      if ((giantModeActive || getFieldHeightMode() === "table") && postureHeightOffset !== 0) {
        applyPostureHeight(baseExperience.camera);
      }
      alignRoomScaleFloor(baseExperience.camera);
      updateDetectedPosture(baseExperience.camera);
      const calibratingFloor = preferredMode === "immersive-vr" && !!floorCalibrationToggle?.checked;
      if (calibratingFloor && !fullScaleNoticeShown) {
        showFloorResetNotice(baseExperience.camera);
        fullScaleNoticeShown = true;
      }
      if (calibratingFloor && floorResetNotice?.isEnabled()) {
        const horizontalProjection = Math.abs(baseExperience.camera.getProjectionMatrix().m[0]);
        const availableWidth = 1.6 / Math.max(horizontalProjection, 0.001);
        floorResetNotice.scaling.setAll(Math.min(1, availableWidth * 0.85 / 0.48));
      }
      if (!calibratingFloor) {
        fullScaleNoticeShown = false;
        hideFloorResetNotice();
      }
    }

    updateTeleportationAvailability();
  });
}
