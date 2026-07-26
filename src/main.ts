/**
 * main.ts — Babylon.js WebXR Immersive-AR boilerplate
 *
 * Features:
 *  • Immersive-AR session with transparent background
 *  • Hit-test requested as an optional feature (graceful fallback if unsupported)
 *  • Tap-to-place: places a glowing sphere at the hit-test result position
 *  • Minimal scene: ambient + point light, one reticle mesh to guide placement
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  PointLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  WebXRDefaultExperience,
  WebXRHitTest,
  WebXRFeatureName,
  AbstractMesh,
  Quaternion,
} from "@babylonjs/core";

// ─── DOM references ──────────────────────────────────────────────────────────

const canvas = document.getElementById("render-canvas") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const enterARBtn = document.getElementById("enter-ar-btn") as HTMLButtonElement;

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

// ─── Engine & Scene ───────────────────────────────────────────────────────────

const engine = new Engine(canvas, true, {
  adaptToDeviceRatio: true,
  antialias: true,
});

const scene = new Scene(engine);

// Transparent background — essential for AR passthrough
scene.clearColor = new Color4(0, 0, 0, 0);

// ─── Camera ───────────────────────────────────────────────────────────────────

// ArcRotateCamera lets you inspect the scene on-screen before entering AR
const camera = new ArcRotateCamera(
  "preview-cam",
  -Math.PI / 2,
  Math.PI / 2.5,
  4,
  Vector3.Zero(),
  scene
);
camera.attachControl(canvas, true);
camera.minZ = 0.01; // prevent near-clip on close objects

// ─── Lighting ─────────────────────────────────────────────────────────────────

const hemiLight = new HemisphericLight(
  "hemi",
  new Vector3(0, 1, 0),
  scene
);
hemiLight.intensity = 0.6;
hemiLight.diffuse = new Color3(1, 1, 1);
hemiLight.groundColor = new Color3(0.3, 0.3, 0.4);

const pointLight = new PointLight(
  "point",
  new Vector3(0, 2, -1),
  scene
);
pointLight.intensity = 0.8;

// ─── Reticle (placement indicator) ───────────────────────────────────────────

const reticle = MeshBuilder.CreateTorus(
  "reticle",
  { diameter: 0.12, thickness: 0.01, tessellation: 32 },
  scene
);
reticle.isVisible = false;
reticle.rotationQuaternion = Quaternion.Identity();

const reticleMat = new StandardMaterial("reticle-mat", scene);
reticleMat.emissiveColor = new Color3(0.2, 0.9, 0.5);
reticleMat.disableLighting = true;
reticle.material = reticleMat;

// ─── Placed objects collection ────────────────────────────────────────────────

const placedMeshes: AbstractMesh[] = [];

function placeObject(position: Vector3, normal: Vector3): void {
  const sphere = MeshBuilder.CreateSphere(
    `sphere-${placedMeshes.length}`,
    { diameter: 0.08, segments: 16 },
    scene
  );
  sphere.position = position.clone();
  sphere.position.y += 0.04; // lift half-diameter above surface

  // Align sphere's up axis to the hit-test surface normal
  sphere.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
    Vector3.Up(),
    normal,
    new Quaternion()
  );

  const mat = new StandardMaterial(`sphere-mat-${placedMeshes.length}`, scene);
  const hue = Math.random();
  mat.emissiveColor = Color3.FromHSV(hue * 360, 0.85, 1.0);
  mat.diffuseColor = Color3.FromHSV(hue * 360, 0.6, 0.9);
  sphere.material = mat;

  placedMeshes.push(sphere);
}

// ─── WebXR ────────────────────────────────────────────────────────────────────

async function initXR(): Promise<void> {
  setStatus("Checking WebXR support…");

  // Check if the browser supports immersive-ar at all
  const supported = await navigator.xr
    ?.isSessionSupported("immersive-ar")
    .catch(() => false);

  if (!supported) {
    setStatus("⚠️  Immersive-AR not supported on this device/browser.");
    return;
  }

  setStatus('WebXR AR supported — tap "Enter AR" to begin.');
  enterARBtn.disabled = false;

  // Build the default XR experience targeting immersive-ar
  const xrHelper = await WebXRDefaultExperience.CreateAsync(scene, {
    uiOptions: {
      sessionMode: "immersive-ar",
    },
    optionalFeatures: true, // request hit-test + plane-detection as optional
  });

  const xrSessionManager = xrHelper.baseExperience.sessionManager;
  const featuresManager = xrHelper.baseExperience.featuresManager;

  // ── Hit-test feature ──────────────────────────────────────────────────────
  let hitTestFeature: WebXRHitTest | undefined;

  xrHelper.baseExperience.onStateChangedObservable.add((state) => {
    // XRState: 0 = NOT_IN_XR, 2 = IN_XR, 3 = ENTERING_XR, 4 = EXITING_XR
    const InXR = 2;
    if (state === InXR) {
      setStatus("AR active — point at a surface, then tap to place a sphere.");

      // Try to enable hit-test (optional — fails gracefully if unavailable)
      try {
        hitTestFeature = featuresManager.enableFeature(
          WebXRFeatureName.HIT_TEST,
          "latest",
          {
            entityTypes: ["plane", "mesh"],
          }
        ) as WebXRHitTest;

        hitTestFeature.onHitTestResultObservable.add((results) => {
          if (results.length > 0) {
            const hit = results[0];
            if (hit.transformationMatrix) {
              // Extract position & normal from the hit matrix
              const hitMatrix = hit.transformationMatrix;
              const position = Vector3.TransformCoordinates(
                Vector3.Zero(),
                hitMatrix
              );
              const normal = Vector3.TransformNormal(
                Vector3.Up(),
                hitMatrix
              );

              reticle.isVisible = true;
              reticle.position.copyFrom(position);
              // Align reticle to surface normal
              if (normal.length() > 0.001) {
                reticle.rotationQuaternion = Quaternion.FromUnitVectorsToRef(
                  Vector3.Up(),
                  normal,
                  reticle.rotationQuaternion ?? new Quaternion()
                );
              }
            }
          } else {
            reticle.isVisible = false;
          }
        });
      } catch {
        setStatus(
          "AR active (hit-test unavailable on this device — tap reticle area to place)."
        );
      }
    } else {
      reticle.isVisible = false;
      setStatus('WebXR AR supported — tap "Enter AR" to begin.');
    }
  });

  // ── Tap-to-place via controller select event ──────────────────────────────
  xrHelper.baseExperience.onStateChangedObservable.add(() => {
    xrSessionManager.onXRSessionInit.add(() => {
      // Use the XR input source's select event for tap-to-place
    });
  });

  // Tap / screen touch in AR → place object at reticle position
  scene.onPointerObservable.add((pointerInfo) => {
    // PointerEventTypes.POINTERDOWN = 1
    if (
      pointerInfo.type === 1 &&
      xrHelper.baseExperience.state === 2 // IN_XR
    ) {
      if (reticle.isVisible) {
        const normal = Vector3.Up(); // fallback normal
        placeObject(reticle.position, normal);
      }
    }
  });

  // ── Wire up Enter AR button ───────────────────────────────────────────────
  enterARBtn.addEventListener("click", async () => {
    try {
      await xrHelper.baseExperience.enterXRAsync(
        "immersive-ar",
        "unbounded", // or "local-floor" if device doesn't support unbounded
        xrHelper.renderTarget
      );
    } catch (err) {
      // Fallback: try "local-floor" reference space
      try {
        await xrHelper.baseExperience.enterXRAsync(
          "immersive-ar",
          "local-floor",
          xrHelper.renderTarget
        );
      } catch {
        setStatus(`⚠️  Could not start AR session: ${(err as Error).message}`);
      }
    }
  });
}

// ─── Render loop ──────────────────────────────────────────────────────────────

engine.runRenderLoop(() => scene.render());

window.addEventListener("resize", () => engine.resize());

// ─── Boot ─────────────────────────────────────────────────────────────────────

initXR().catch((err: Error) => {
  setStatus(`Error: ${err.message}`);
  console.error(err);
});
