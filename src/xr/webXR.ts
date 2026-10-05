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
import '@babylonjs/loaders/glTF';
import { RegisterWebXROculusTouchMotionController } from '@babylonjs/core/XR/motionController/webXROculusTouchMotionController.pure';
import { scene } from '../scene/engine';
import { xrModeInputs, getSelectedXRMode, floorCalibrationToggle, fullScaleVRButton, tabletopScaleButton } from '../ui/dom';
import { enterARTabletopMode, exitARTabletopMode, getARPosition, getARScale, getARScaleRange, setARPosition, setARScale } from './ar';
import { setActiveController, removeActiveController, setHandTracking, getActiveControllers, consumeFloorCalibrationGesture, setHandFloorContact } from '../interaction/pathInteraction';

RegisterWebXROculusTouchMotionController();
WebXRMotionControllerManager.PrioritizeOnlineRepository = true;

let playerFloorOffset = 0;

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

// Full-scale teleporting is restricted to the field; the surrounding ground
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
  let wasFullScaleVR = false;
  let heightCalibrationPending = false;
  let handTrackingFeature: WebXRHandTracking | null = null;
  let wasCalibratingFloor = false;
  const calibrationPresses = new Map<string, boolean>();
  let switchingToFullScaleVR = false;
  const floorCalibrationStorageKey = "chartxr.floorCalibrationOffset";
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
    switchingToFullScaleVR = true;
    try {
      setARScale(getARScaleRange().max);
      heightCalibrationPending = true;
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
    setARScale(getARScaleRange().default);
    heightCalibrationPending = false;
    if (floorCalibrationToggle) floorCalibrationToggle.checked = false;
    updateTeleportationAvailability();
  });

  function updateTeleportationAvailability() {
    const teleportation = xrExperience?.teleportation;
    const enabled = preferredMode === "immersive-vr" && getARScale() === getARScaleRange().max;
    if (!teleportation) {
      teleportGrid.setEnabled(false);
      return;
    }
    teleportation.disableAutoAttach = !enabled;
    if (!enabled) {
      if (teleportation.attached) teleportation.detach();
      teleportGrid.setEnabled(false);
    } else if (xrExperience?.baseExperience.state === WebXRState.IN_XR && !teleportation.attached) {
      teleportation.attach();
    }
  }

  function getHeadsetFloorY(camera: WebXRCamera): number {
    camera.computeWorldMatrix();
    return camera.globalPosition.y - camera.realWorldHeight;
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
    const active = baseExperience?.state === WebXRState.IN_XR && preferredMode === "immersive-vr";
    if (!active || !baseExperience) {
      setHandFloorContact("left", false);
      setHandFloorContact("right", false);
      wasCalibratingFloor = false;
      calibrationPresses.clear();
      return;
    }
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
      setARScale(getARScaleRange().max);
      setPlayerFloorOffset(camera.realWorldHeight - eyeHeight);
      alignFieldFloorTo(floor, point.y);
      heightCalibrationPending = false;
      captured = true;
      alignedOnEntry = alignOnEntry;
      if (alignOnEntry) calibrationPresses.set(`floor:controller:${handedness}`, true);
      wasFullScaleVR = true;
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
        savedFloorOffset = baseExperience.camera.realWorldHeight - getTrackedPlayerHeight(baseExperience.camera);
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
      xrExperience = await WebXRDefaultExperience.CreateAsync(scene, {
        uiOptions: {
          sessionMode: preferredMode,
          referenceSpaceType: "local-floor",
        },
        optionalFeatures: true,
        handSupportOptions: {
          jointMeshes: { invisible: false },
          handMeshes: {
            disableDefaultMeshes: true,
          },
        },
        floorMeshes: getFieldFloorMeshes(),
        disableTeleportation: preferredMode === "immersive-ar",
        inputOptions: {
          doNotLoadControllerMeshes: false,
          disableControllerAnimation: false,
          disableOnlineControllerRepository: false,
          customControllersRepositoryURL: "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist",
        },
      });

      xrExperience.baseExperience.onInitialXRPoseSetObservable.add((camera) => {
        wasFullScaleVR = preferredMode === "immersive-vr" && getARScale() === getARScaleRange().max;
        heightCalibrationPending = wasFullScaleVR;
        resetPlayerFloorOffset();
        if (preferredMode === "immersive-vr" && savedFloorOffset !== null) setPlayerFloorOffset(savedFloorOffset);
      });

      const handTracking = xrExperience.baseExperience.featuresManager
        .getEnabledFeature(WebXRFeatureName.HAND_TRACKING) ?? null;
      handTrackingFeature = handTracking;
      setHandTracking(handTracking);

      const teleportation = xrExperience.teleportation;
      updateTeleportationAvailability();
      if (teleportation) {
        let teleportHeightCorrection = 0;
        teleportation.onBeforeCameraTeleport.add(() => {
          const camera = xrExperience!.baseExperience.camera;
          const rawHeight = camera.realWorldHeight;
          const calibratedHeight = getTrackedPlayerHeight(camera);
          teleportHeightCorrection = Number.isFinite(rawHeight) && Number.isFinite(calibratedHeight) && calibratedHeight > 0
            ? rawHeight - calibratedHeight
            : 0;
        });
        teleportation.onAfterCameraTeleport.add(() => {
          xrExperience!.baseExperience.camera.position.y -= teleportHeightCorrection;
          teleportHeightCorrection = 0;
        });
        let gridHideTimeout: ReturnType<typeof setTimeout> | undefined;
        teleportation.onTargetMeshPositionUpdatedObservable.add(() => {
          if (preferredMode !== "immersive-vr" || getARScale() < getARScaleRange().max) {
            teleportGrid.setEnabled(false);
            return;
          }
          teleportGrid.setEnabled(true);
          clearTimeout(gridHideTimeout);
          gridHideTimeout = setTimeout(() => teleportGrid.setEnabled(false), 150);
        });
      }

      xrExperience.baseExperience.onStateChangedObservable.add((state) => {
        if (state === WebXRState.ENTERING_XR || state === WebXRState.IN_XR) {
          if (state === WebXRState.ENTERING_XR) setHandTracking(handTracking);
          if (preferredMode === "immersive-ar") {
            scene.clearColor = new Color4(0, 0, 0, 0);
            scene.autoClear = true;
            enterARTabletopMode();
          } else {
            scene.clearColor = new Color4(0.03, 0.05, 0.09, 1);
            exitARTabletopMode();
          }
          updateTeleportationAvailability();
          return;
        }

        if (state === WebXRState.NOT_IN_XR) {
          fullScaleNoticeShown = false;
          hideFloorResetNotice();
          wasFullScaleVR = false;
          heightCalibrationPending = false;
          wasCalibratingFloor = false;
          calibrationPresses.clear();
          resetPlayerFloorOffset();
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

  // Teleportation is available only in full-scale VR.
  scene.onBeforeAnimationsObservable.add(() => {
    updateFloorCalibration();
    const baseExperience = xrExperience?.baseExperience;
    if (baseExperience?.state === WebXRState.IN_XR) {
      const fullScaleVR = preferredMode === "immersive-vr" && getARScale() === getARScaleRange().max;
      if (fullScaleVR && !fullScaleNoticeShown) {
        showFloorResetNotice(baseExperience.camera);
        fullScaleNoticeShown = true;
      }
      if (fullScaleVR && floorResetNotice?.isEnabled()) {
        const horizontalProjection = Math.abs(baseExperience.camera.getProjectionMatrix().m[0]);
        const availableWidth = 1.6 / Math.max(horizontalProjection, 0.001);
        floorResetNotice.scaling.setAll(Math.min(1, availableWidth * 0.85 / 0.48));
      }
      if (!fullScaleVR) {
        fullScaleNoticeShown = false;
        hideFloorResetNotice();
      }
      if (fullScaleVR && !wasFullScaleVR) heightCalibrationPending = true;
      if (fullScaleVR && heightCalibrationPending && !floorCalibrationToggle?.checked) {
        const floor = scene.getMeshByName("turfStripe0");
        const eyeHeight = getTrackedPlayerHeight(baseExperience.camera);
        const headsetFloorY = getHeadsetFloorY(baseExperience.camera);
        if (floor && Number.isFinite(eyeHeight) && eyeHeight > 0 && Number.isFinite(headsetFloorY)) {
          alignFieldFloorTo(floor, headsetFloorY);
          heightCalibrationPending = false;
        }
      }
      if (!fullScaleVR) heightCalibrationPending = false;
      wasFullScaleVR = fullScaleVR;
    }

    updateTeleportationAvailability();
  });
}
