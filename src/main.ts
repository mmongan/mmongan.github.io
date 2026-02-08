// @ts-ignore: allow side-effect CSS import without typings
import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRHitTest } from "@babylonjs/core/XR/features/webXRHitTest";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { ShapeType } from "./menu";

async function createScene() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("renderCanvas not found");
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);

  const light = new HemisphericLight("h", new Vector3(0, 1, 0), scene);
  light.intensity = 1.0;

  // simple ground for non-AR fallback
  const ground = MeshBuilder.CreateGround("ground", { width: 10, height: 10 }, scene);
  ground.position.y = -0.01;
  // hide ground in AR view and disable interactions
  ground.isVisible = false;
  ground.isPickable = false;

  // Start XR AR experience
  const xr = await WebXRDefaultExperience.CreateAsync(scene, {
    uiOptions: { sessionMode: "immersive-ar", referenceSpaceType: "local-floor" }
  });

  // Do not animate the camera while in XR — keep camera transforms driven by XR poses only
  try {
    if (xr && xr.baseExperience && xr.baseExperience.camera) {
      (xr.baseExperience.camera as any).animationsEnabled = false;
    }
    // also disable scene-level animations to avoid incidental camera/scene animations
    scene.animationsEnabled = false;
  } catch (e) {
    // ignore if the runtime doesn't expose these properties
  }

  // Hit test feature to place objects on real world surfaces
  const fm = xr.baseExperience.featuresManager;
  const hitTest = fm.enableFeature(WebXRHitTest.Name, "latest") as WebXRHitTest;

  // reticle to show placement
  const reticle = MeshBuilder.CreateDisc("reticle", { radius: 0.06 }, scene);
  reticle.rotation.x = Math.PI / 2;
  reticle.isVisible = false;

  // menu state (declared early so callbacks can reference them)
  let menuMesh: any = null;
  let menuGrabbed = false;
  let lastMenuWorldPos = new Vector3(0, 0, 0);

  // create the floating menu (lazy import)
  try {
    const menuModule = await import("./menu");
    const createFloatingMenu = menuModule.default as (parentCamera: any, scene: Scene, onPick: (shape: any) => void) => Promise<any>;
    menuMesh = await createFloatingMenu(xr.baseExperience.camera, scene, (shape: any) => {
      // spawn the chosen shape at the reticle if available, otherwise in front of camera
      let pos = null as Vector3 | null;
      try { if (reticle && reticle.isVisible) pos = reticle.position.clone(); } catch {}
      if (!pos) {
        const cam = xr.baseExperience.camera;
        pos = cam.position.add(cam.getForwardRay(1).direction.scale(0.8));
      }
      spawnShape(shape, pos as Vector3, scene);
    });

    // Ensure menu is unparented and record its world position so it remains fixed
    try {
      menuMesh.setParent(null);
      (menuMesh as any).setAbsolutePosition(menuMesh.getAbsolutePosition());
      lastMenuWorldPos = menuMesh.getAbsolutePosition().clone();
    } catch (e) {
      try { menuMesh.parent = null; } catch {}
    }
  } catch (e) {
    console.warn("failed to create floating menu:", e);
  }

  hitTest.onHitTestResultObservable.add((results) => {
    if (results && results.length) {
      const first = results[0];
      if (first && first.transformationMatrix) {
        const m = first.transformationMatrix;
        reticle.isVisible = true;
        // use Matrix helper to get translation
        const t = m.getTranslation();
        reticle.position.copyFrom(t);
      }
    } else {
      reticle.isVisible = false;
    }
  });

  // Allow placing the menu at the reticle position: tap to place/unparent so it floats in world space
  let menuPlaced = false;
  scene.onPointerObservable.add((pi) => {
    if (pi.type === PointerEventTypes.POINTERDOWN) {
      if (reticle.isVisible) {
        // move menu to reticle and unparent so it stays in world space
        menuMesh.setParent(null);
        (menuMesh as any).setAbsolutePosition(reticle.position);
        // record last world position
        try { lastMenuWorldPos = menuMesh.getAbsolutePosition().clone(); } catch {}
        // rotate to face the camera
        try { menuMesh.lookAt(xr.baseExperience.camera.position); } catch {}
        menuPlaced = true;
      }
    }
  });

  // Allow attaching the menu to controller grips while the main selection/squeeze button is held,
  // then releasing it at the current world position when the button is released.
  xr.input.onControllerAddedObservable.add((xrController) => {
    xrController.onMotionControllerInitObservable.add((motionController: any) => {
      const mainComponent = motionController.getMainComponent ? motionController.getMainComponent() : null;
      if (mainComponent && mainComponent.onButtonStateChangedObservable) {
        mainComponent.onButtonStateChangedObservable.add((state: any) => {
          if (!(state && state.changes && state.changes.pressed)) return;
          const pressed = state.changes.pressed.current;
          if (pressed) {
            // attach to grip if available
            if (xrController.grip) {
              menuGrabbed = true;
              menuMesh.setParent(xrController.grip);
              // place slightly forward from grip so it's visible
              menuMesh.position.set(0, 0, 0.15);
              try { menuMesh.lookAt(xr.baseExperience.camera.position); } catch {}
            }
          } else {
            // release: preserve world position and stop following
            try {
              const worldPos = menuMesh.getAbsolutePosition().clone();
              menuMesh.setParent(null);
              (menuMesh as any).setAbsolutePosition(worldPos);
              lastMenuWorldPos = worldPos.clone();
            } catch (e) {
              // fallback
              menuMesh.parent = null;
            }
            menuGrabbed = false;
          }
        });
      }
    });
  });

  function spawnShape(type: ShapeType, position: Vector3, scene: Scene) {
    let m: any;
    switch (type) {
      case "box":
        m = MeshBuilder.CreateBox(`box-${Date.now()}`, { size: 0.15 }, scene);
        break;
      case "sphere":
        m = MeshBuilder.CreateSphere(`sphere-${Date.now()}`, { diameter: 0.14 }, scene);
        break;
      case "cylinder":
        m = MeshBuilder.CreateCylinder(`cyl-${Date.now()}`, { height: 0.16, diameterTop: 0.12, diameterBottom: 0.12 }, scene);
        break;
      case "torus":
        m = MeshBuilder.CreateTorus(`torus-${Date.now()}`, { diameter: 0.18, thickness: 0.04 }, scene);
        break;
    }
    if (m) {
      m.position = position;
      m.alwaysSelectAsActiveMesh = true;
      const mat = new StandardMaterial("mat", scene);
      mat.diffuseColor = Color3.Random();
      m.material = mat as any;
    }
  }

  engine.runRenderLoop(() => {
    // if not grabbed, keep the menu at the recorded world position (prevent accidental re-parenting)
    try {
      if (typeof menuGrabbed !== 'undefined' && !menuGrabbed) {
        const abs = menuMesh.getAbsolutePosition();
        if (!abs.equalsWithEpsilon(lastMenuWorldPos, 1e-5)) {
          (menuMesh as any).setAbsolutePosition(lastMenuWorldPos);
        }
      }
    } catch (e) {
      // ignore debug enforcement errors
    }
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

createScene().catch((err) => console.error(err));
