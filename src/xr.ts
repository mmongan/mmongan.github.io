import * as BABYLON from 'babylonjs';
import { scene } from './engineScene';
import { vrButton, arButton } from './dom';
import { enterARTabletopMode, exitARTabletopMode } from './ar';
import { setActiveController } from './interaction';

async function checkSessionSupport(mode: XRSessionMode) {
  if (!navigator.xr) {
    alert("WebXR is not available in this browser. Use Meta Quest Browser or another WebXR-enabled browser.");
    return false;
  }

  const supported = await navigator.xr.isSessionSupported(mode);
  if (!supported) {
    alert(`The ${mode} session mode is not supported on this device or browser.`);
    return false;
  }

  return true;
}

// Grid overlay shown across the whole floor while aiming to teleport in VR.
export function createTeleportGrid(): BABYLON.Mesh {
  const teleportGridCanvas = document.createElement("canvas");
  teleportGridCanvas.width = 64;
  teleportGridCanvas.height = 64;
  const teleportGridCtx = teleportGridCanvas.getContext("2d")!;
  teleportGridCtx.clearRect(0, 0, 64, 64);
  teleportGridCtx.strokeStyle = "rgba(120, 220, 255, 0.9)";
  teleportGridCtx.lineWidth = 2;
  teleportGridCtx.strokeRect(0, 0, 64, 64);

  const teleportGridTexture = new BABYLON.DynamicTexture(
    "teleportGridTexture",
    teleportGridCanvas,
    scene,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  teleportGridTexture.update(true);
  teleportGridTexture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  teleportGridTexture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  teleportGridTexture.hasAlpha = true;
  teleportGridTexture.uScale = 160;
  teleportGridTexture.vScale = 160;

  const teleportGridMaterial = new BABYLON.StandardMaterial("teleportGridMaterial", scene);
  teleportGridMaterial.diffuseTexture = teleportGridTexture;
  teleportGridMaterial.opacityTexture = teleportGridTexture;
  teleportGridMaterial.disableLighting = true;
  teleportGridMaterial.emissiveColor = new BABYLON.Color3(0.5, 0.9, 1);
  teleportGridMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
  teleportGridMaterial.backFaceCulling = false;

  const teleportGrid = BABYLON.MeshBuilder.CreateDisc(
    "teleportGrid",
    { radius: 240, tessellation: 64 },
    scene
  );
  teleportGrid.rotation.x = Math.PI / 2;
  teleportGrid.position.y = -0.45;
  teleportGrid.material = teleportGridMaterial;
  teleportGrid.isPickable = false;
  teleportGrid.setEnabled(false);

  return teleportGrid;
}

export function initXR(teleportGrid: BABYLON.Mesh) {
  async function startXR(mode: XRSessionMode) {
    if (!(await checkSessionSupport(mode))) {
      return;
    }

    try {
      const teleportFloorMeshes = ["field", "horizonGround", "outerBase"]
        .map((name) => scene.getMeshByName(name))
        .filter((mesh) => mesh !== null);

      const xrExperience = await scene.createDefaultXRExperienceAsync({
        uiOptions: {
          sessionMode: mode,
          referenceSpaceType: "local-floor",
        },
        optionalFeatures: true,
        floorMeshes: teleportFloorMeshes,
        inputOptions: {
          doNotLoadControllerMeshes: false,
          disableControllerAnimation: false,
        },
      });

      const teleportation = xrExperience.teleportation;
      if (teleportation) {
        let gridHideTimeout: ReturnType<typeof setTimeout> | undefined;
        teleportation.onTargetMeshPositionUpdatedObservable.add(() => {
          teleportGrid.setEnabled(true);
          clearTimeout(gridHideTimeout);
          gridHideTimeout = setTimeout(() => teleportGrid.setEnabled(false), 150);
        });
      }

      if (mode === "immersive-ar") {
        enterARTabletopMode();
      }

      xrExperience.baseExperience.onStateChangedObservable.add((state) => {
        if (state === BABYLON.WebXRState.NOT_IN_XR) {
          teleportGrid.setEnabled(false);
          exitARTabletopMode();
        }
      });

      xrExperience.input.onControllerAddedObservable.add((controller) => {
        setActiveController(controller);
        const handedness = controller.inputSource.handedness || "unknown";
        console.log(`Quest 3 controller connected: ${handedness}`);

        const pointerMaterial = new BABYLON.StandardMaterial(
          `pointerMat-${controller.uniqueId}`,
          scene
        );
        pointerMaterial.emissiveColor = new BABYLON.Color3(0.55, 0.9, 1);
        pointerMaterial.diffuseColor = new BABYLON.Color3(0.15, 0.3, 0.5);
        controller.pointer.material = pointerMaterial;

        if (controller.grip) {
          const gripMaterial = new BABYLON.StandardMaterial(
            `gripMat-${controller.uniqueId}`,
            scene
          );
          gripMaterial.emissiveColor = new BABYLON.Color3(0.8, 0.9, 1);
          controller.grip.material = gripMaterial;
        }

        if (controller.motionController?.rootMesh) {
          controller.motionController.rootMesh.scaling = new BABYLON.Vector3(1.04, 1.04, 1.04);
        }
      });
    } catch (error) {
      console.error(`Failed to start ${mode}:`, error);
      alert(`Unable to start ${mode}. Make sure your headset is connected and WebXR is enabled.`);
    }
  }

  vrButton.addEventListener("click", () => startXR("immersive-vr"));
  arButton.addEventListener("click", () => startXR("immersive-ar"));
}
