// @ts-ignore: allow side-effect CSS import without typings
import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { ShapeType } from "./menu";

// menu state
let menuMesh: any = null;
let menuRoot: any = null;
let menuGrabbed = false;
let menuShapeModels: any[] = [];
let menuHandles: any[] = [];

let spawnedShapes: any[] = [];
let grabbedShape: any = null;
let grabbedShapeParent: any = null;

async function createScene() {
  const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("renderCanvas not found");
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);

  const light = new HemisphericLight("h", new Vector3(0, 1, 0), scene);
  light.intensity = 1.0;

  // polyfill: ensure scene has beginAnimation (some XR runtimes expect this)
  if (!(scene as any).beginAnimation) {
    (scene as any).beginAnimation = function(target: any, from: number, to: number, loop: boolean, speedRatio: number, onAnimationEnd?: () => void) {
      try {
        if ((this as any).beginDirectAnimation) {
          return (this as any).beginDirectAnimation(target, (target as any).getAnimations?.() || [], from, to, loop, speedRatio, onAnimationEnd);
        }
      } catch (e) {
        // ignore animation errors
      }
      return null;
    };
  }

  // simple ground for non-AR fallback
  const ground = MeshBuilder.CreateGround("ground", { width: 10, height: 10 }, scene);
  ground.position.y = -0.01;
  // hide ground in AR view and disable interactions
  ground.isVisible = false;
  ground.isPickable = false;

  // Start XR AR experience (create defaults but do not auto-enter session)
  const xr = await WebXRDefaultExperience.CreateAsync(scene, {
    uiOptions: { 
      sessionMode: "immersive-ar", 
      referenceSpaceType: "local-floor"
    },
    optionalFeatures: ["local-floor", "hand-tracking"]
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

  // No surface hit test: we'll place objects relative to the XR camera instead
  // Reticle left in place for future use but not driven by hit-test
  const reticle = MeshBuilder.CreateDisc("reticle", { radius: 0.06 }, scene);
  reticle.rotation.x = Math.PI / 2;
  reticle.isVisible = false;

  // create the floating menu (lazy import)
  try {
    const menuModule = await import("./menu");
    const createFloatingMenu = menuModule.default as (parentCamera: any, scene: Scene, onPick: (shape: any) => void) => Promise<any>;
    const menuResult = await createFloatingMenu(xr.baseExperience.camera as any, scene, (shape: ShapeType) => {});
    menuMesh = menuResult.menu;
    menuShapeModels = menuResult.shapeModels;
    menuHandles = menuResult.handles;

    // create a world-locked root to hold the menu so we can parent/unparent easily
    try { menuRoot = new TransformNode("menuRoot", scene); } catch (_) { menuRoot = null; }
    if (menuRoot && menuMesh) {
      try {
        const abs = menuMesh.getAbsolutePosition();
        try { menuMesh.setParent(menuRoot); } catch (_) { menuMesh.parent = menuRoot; }
        // reset local position to origin since offset is already in absolute position
        try { menuMesh.position.set(0, 0, 0); } catch (_) {}
        try { (menuRoot as any).setAbsolutePosition(abs); } catch (_) { (menuRoot as any).position = abs; }
      } catch (e) {
        try { menuMesh.setParent(null); } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('failed to create floating menu', e);
  }


  // Detect and log Quest-like controllers when they connect so we can verify controller profiles
  try {
    xr.input.onControllerAddedObservable.add((xrController: any) => {
      xrController.onMotionControllerInitObservable.add((motionController: any) => {
        const profile = motionController.profileId || motionController._profileId || "";
        const gamepadId = (xrController as any).browserGamepad?.id || "";
        const idStr = (profile || gamepadId).toLowerCase();
        if (/quest|oculus|vrcontroller|oculus-touch|oculus_touch/.test(idStr)) {
          console.log("Quest-like controller detected:", profile || gamepadId);
        } else {
          console.log("Controller connected:", profile || gamepadId);
        }
      });
    });
  } catch (e) {
    // ignore controller-detection errors
  }

  // allow grabbing spawned shapes and menu with controller grip button
  try {
    xr.input.onControllerAddedObservable.add((xrController: any) => {
      xrController.onMotionControllerInitObservable.add((motionController: any) => {
        const mainComponent = motionController.getMainComponent ? motionController.getMainComponent() : null;
        if (mainComponent && mainComponent.onButtonStateChangedObservable) {
          mainComponent.onButtonStateChangedObservable.add((state: any) => {
            if (!(state && state.changes && state.changes.pressed)) return;
            const pressed = state.changes.pressed.current;
            if (pressed) {
              if (xrController.grip) {
                // check if grabbing a menu shape model first
                let grabTarget: any = null;
                let closestDist = 0.3; // 30cm grab radius
                let isMenuShapeModel = false;
                let isMenuHandle = false;
                let menuShapeType: ShapeType | null = null;
                
                // check menu shape models (smaller grab radius - 15cm)
                for (const shapeModelObj of menuShapeModels) {
                  const dist = Vector3.Distance(shapeModelObj.mesh.getAbsolutePosition(), xrController.grip.position);
                  if (dist < 0.15) {
                    if (dist < closestDist) {
                      closestDist = dist;
                      grabTarget = shapeModelObj.mesh;
                      isMenuShapeModel = true;
                      isMenuHandle = false;
                      menuShapeType = shapeModelObj.shapeType;
                    }
                  }
                }
                
                // check menu handles (second priority)
                if (!isMenuShapeModel) {
                  for (const handle of menuHandles) {
                    const dist = Vector3.Distance(handle.mesh.getAbsolutePosition(), xrController.grip.position);
                    if (dist < closestDist) {
                      closestDist = dist;
                      grabTarget = menuRoot || menuMesh;
                      isMenuHandle = true;
                      isMenuShapeModel = false;
                    }
                  }
                }
                
                // if not grabbing a menu shape or handle, check menu and regular shapes
                if (!isMenuShapeModel && !isMenuHandle) {
                  // check menu
                  const menuToGrab = menuRoot || menuMesh;
                  if (menuToGrab) {
                    const menuDist = Vector3.Distance(menuToGrab.position, xrController.grip.position);
                    if (menuDist < closestDist) {
                      grabTarget = menuToGrab;
                      closestDist = menuDist;
                    }
                  }
                  
                  // check shapes
                  for (const shape of spawnedShapes) {
                    const dist = Vector3.Distance(shape.position, xrController.grip.position);
                    if (dist < closestDist) {
                      closestDist = dist;
                      grabTarget = shape;
                    }
                  }
                }
                
                if (isMenuShapeModel && menuShapeType) {
                  // spawn a copy of the shape at grip location
                  spawnShapeInScene(menuShapeType, xrController.grip.position.clone());
                  // immediately grab the newly spawned shape so it's held by the grip
                  const newShape = spawnedShapes[spawnedShapes.length - 1];
                  grabbedShape = newShape;
                  grabbedShapeParent = newShape.parent;
                  try { newShape.setParent(xrController.grip); } catch (_) { newShape.parent = xrController.grip; }
                } else if (isMenuHandle || grabTarget === (menuRoot || menuMesh)) {
                  menuGrabbed = true;
                  try { grabTarget.setParent(xrController.grip); } catch (_) { grabTarget.parent = xrController.grip; }
                } else if (grabTarget && spawnedShapes.includes(grabTarget)) {
                  grabbedShape = grabTarget;
                  grabbedShapeParent = grabTarget.parent;
                  try { grabTarget.setParent(xrController.grip); } catch (_) { grabTarget.parent = xrController.grip; }
                }
              }
            } else {
              // release: preserve world position
              if (grabbedShape) {
                const worldPos = grabbedShape.getAbsolutePosition().clone();
                try { grabbedShape.setParent(null); } catch (_) { grabbedShape.parent = null; }
                try { grabbedShape.position = worldPos; } catch (_) {}
                grabbedShape = null;
                grabbedShapeParent = null;
              } else if (menuGrabbed) {
                const menuToRelease = menuRoot || menuMesh;
                if (menuToRelease) {
                  const worldPos = (menuToRelease as any).getAbsolutePosition().clone();
                  try { menuToRelease.setParent(null); } catch (_) { menuToRelease.parent = null; }
                  try { (menuToRelease as any).setAbsolutePosition(worldPos); } catch (_) { menuToRelease.position = worldPos; }
                }
                menuGrabbed = false;
              }
            }
          });
        }
      });
    });
  } catch (e) {
    // ignore
  }

  // No hit-test updates; reticle remains unused in this mode.
  
  // shape spawning
  function spawnShapeInScene(shapeType: ShapeType, pos: Vector3) {
    try {
      let shape: any;
      const mat = new StandardMaterial("shapeMat", scene);
      mat.diffuseColor = Color3.FromHexString("#888888");
      
      switch (shapeType) {
        case "tetrahedron":
          shape = MeshBuilder.CreatePolyhedron("tetrahedron", { type: 0, size: 0.1 }, scene);
          break;
        case "cube":
          shape = MeshBuilder.CreateBox("cube", { size: 0.1 }, scene);
          break;
        case "octahedron":
          shape = MeshBuilder.CreatePolyhedron("octahedron", { type: 1, size: 0.1 }, scene);
          break;
        case "dodecahedron":
          shape = MeshBuilder.CreatePolyhedron("dodecahedron", { type: 2, size: 0.1 }, scene);
          break;
        case "icosahedron":
          shape = MeshBuilder.CreatePolyhedron("icosahedron", { type: 3, size: 0.1 }, scene);
          break;
        default:
          return;
      }
      
      shape.material = mat;
      shape.position = pos;
      spawnedShapes.push(shape);
    } catch (e) {
      console.warn('failed to spawn shape', e);
    }
  }

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

createScene().catch((err) => console.error(err));
