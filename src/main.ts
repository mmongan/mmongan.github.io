// @ts-ignore: allow side-effect CSS import without typings
import "./styles.css";
import {
  Engine,
  Scene,
  HemisphericLight,
  Vector3,
  Color3,
  MeshBuilder,
  TransformNode,
  StandardMaterial,
  WebXRDefaultExperience
} from "@babylonjs/core";
import type { ShapeType } from "./menu";
import createFloatingMenu from "./menu";

// menu state
let menuMesh: any = null;
let menuRoot: any = null;
let menuShapeModels: any[] = []; 

let spawnedShapes: any[] = [];
// per-controller hold state is stored on the controller object (e.g. controller._heldShape)


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
  let xr: WebXRDefaultExperience | null = null;
  try {
    xr = await WebXRDefaultExperience.CreateAsync(scene, {
      uiOptions: { 
        sessionMode: "immersive-ar", 
        referenceSpaceType: "local-floor"
      },
      optionalFeatures: ["local-floor", "hand-tracking"]
    });
  } catch (e) {
    console.warn('WebXR not available, menu will still load:', e);
  }

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

  // create the floating menu (shapes hidden, grid visible)
  try {
    const parentCamera = (xr && xr.baseExperience && (xr.baseExperience as any).camera) ? (xr.baseExperience as any).camera : (function() { try { return new TransformNode('menuDebugParent', scene); } catch { return null; } })();

    const menuResult = await createFloatingMenu(parentCamera as any, scene, (shape: ShapeType, spawnPos?: Vector3, spawnSize?: number) => {
      try {
        let pos = spawnPos as Vector3 | undefined;
        if (!pos) {
          try {
            const cam = parentCamera as any;
            if (cam && cam.getForwardRay) {
              const dir = cam.getForwardRay(1).direction as Vector3;
              const p = cam.getAbsolutePosition ? cam.getAbsolutePosition() as Vector3 : new Vector3(0, 1, 0);
              pos = p.add(dir.scale(0.4));
            } else if (cam && cam.getAbsolutePosition) {
              const p = cam.getAbsolutePosition() as Vector3;
              pos = p.add(new Vector3(0, 0, -0.4));
            } else pos = new Vector3(0, 1, -0.6);
          } catch (e) { pos = new Vector3(0, 1, -0.6); }
        }
        const finalSize = (typeof spawnSize === 'number') ? spawnSize : ((window as any).__MENU_DEBUG && (window as any).__MENU_DEBUG.spawnSize) ? (window as any).__MENU_DEBUG.spawnSize : 0.1;
        if (pos) spawnShapeInScene(shape, pos, finalSize);
      } catch (e) {}
    });
    menuMesh = menuResult.menu;
    menuShapeModels = menuResult.shapeModels;

    // create a world-locked root to hold the menu so we can parent/unparent easily
    try { menuRoot = new TransformNode("menuRoot", scene); } catch (_) { menuRoot = null; }
    if (menuRoot && menuMesh) {
      try {
        const abs = menuMesh.getAbsolutePosition();
        try { menuMesh.setParent(menuRoot); } catch (_) { menuMesh.parent = menuRoot; }
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
            const ctrlState = xrController as any;

            if (pressed) {
              if (xrController.grip) {
                // enforce one held object per hand
                if (ctrlState._heldShape || ctrlState._menuGrabbed) {
                  // already holding something with this hand; ignore new grabs
                  return;
                }

                // check if grabbing a menu shape model first
                let grabTarget: any = null;
                let closestDist = 0.3; // 30cm grab radius
                let isMenuShapeModel = false;
                let menuShapeType: ShapeType | null = null;

                // check menu shape models (smaller grab radius - 15cm)
                for (const shapeModelObj of menuShapeModels) {
                  const dist = Vector3.Distance(shapeModelObj.mesh.getAbsolutePosition(), xrController.grip.position);
                  if (dist < 0.15) {
                    if (dist < closestDist) {
                      closestDist = dist;
                      grabTarget = shapeModelObj.mesh;
                      isMenuShapeModel = true;
                      menuShapeType = shapeModelObj.shapeType;
                    }
                  }
                }

                // if not grabbing a menu shape, check menu and regular shapes
                if (!isMenuShapeModel) {
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
                  // debug: log which palette shape we think was picked
                  try { console.log('menu pick:', menuShapeType, grabTarget?.name, grabTarget?.getAbsolutePosition()); } catch (e) {}
                  // spawn a copy of the shape at grip location
                  const runtimeSpawnSize = ((window as any).__MENU_DEBUG && (window as any).__MENU_DEBUG.spawnSize) ? (window as any).__MENU_DEBUG.spawnSize : 0.1;
                  spawnShapeInScene(menuShapeType, xrController.grip.position.clone(), runtimeSpawnSize);
                  // immediately grab the newly spawned shape so it's held by the grip
                  const newShape = spawnedShapes[spawnedShapes.length - 1];
                  // color-code the spawned shape for visual verification and add active outline
                  try {
                    if (menuShapeType === 'sphere') newShape.material.diffuseColor = Color3.FromHexString('#FFD166');
                    else if (menuShapeType === 'cube') newShape.material.diffuseColor = Color3.FromHexString('#4ECDC4');
                    else if ((menuShapeType as string).startsWith('poly')) {
                      const idx = parseInt((menuShapeType as string).replace('poly',''), 10);
                      const palette = ['#98D8C8','#FF6B6B','#45B7D1','#FFA07A','#F6C9E2','#D4A5FF','#FFB86B','#B0E57C','#9AD0FF','#E3E66D','#C0C0C0','#FF9FB4','#8FD3C7','#D9B8FF','#FFD7A6'];
                      newShape.material.diffuseColor = Color3.FromHexString(palette[idx % palette.length]);
                    } else if (menuShapeType === 'icosahedron') newShape.material.diffuseColor = Color3.FromHexString('#98D8C8');
                    else if (menuShapeType === 'tetrahedron') newShape.material.diffuseColor = Color3.FromHexString('#FF6B6B');
                    else if (menuShapeType === 'octahedron') newShape.material.diffuseColor = Color3.FromHexString('#45B7D1');
                    else if (menuShapeType === 'dodecahedron') newShape.material.diffuseColor = Color3.FromHexString('#FFA07A');
                  } catch (e) {}
                  // grab highlight disabled: no outline changes when held
                  // mark shape as owned by this controller to prevent other hands from grabbing it
                  try { (newShape as any)._heldBy = xrController; } catch (_) {}
                  ctrlState._heldShape = newShape;
                  ctrlState._heldShapeParent = newShape.parent;
                  try { newShape.setParent(xrController.grip); } catch (_) { newShape.parent = xrController.grip; }
                } else if (grabTarget === (menuRoot || menuMesh)) {
                  ctrlState._menuGrabbed = true;
                  try { grabTarget.setParent(xrController.grip); } catch (_) { grabTarget.parent = xrController.grip; }
                } else if (grabTarget && spawnedShapes.includes(grabTarget)) {
                  // prevent grabbing if another controller already holds this shape
                  if ((grabTarget as any)._heldBy) {
                    // already held by another hand: ignore grab
                  } else {
                    try { (grabTarget as any)._heldBy = xrController; } catch (_) {}
                    ctrlState._heldShape = grabTarget;
                    ctrlState._heldShapeParent = grabTarget.parent;
                    try { grabTarget.setParent(xrController.grip); } catch (_) { grabTarget.parent = xrController.grip; }
                    // grab highlight disabled: do not change outline on grab
                  }
                }
              }
            } else {
              // release: preserve world position
              if (ctrlState._heldShape) {
                try { (ctrlState._heldShape as any)._heldBy = null; } catch (_) {}
                const worldPos = ctrlState._heldShape.getAbsolutePosition().clone();
                try { ctrlState._heldShape.setParent(null); } catch (_) { ctrlState._heldShape.parent = null; }
                try { ctrlState._heldShape.position = worldPos; } catch (_) {}
                ctrlState._heldShape = null;
                ctrlState._heldShapeParent = null;
              } else if (ctrlState._menuGrabbed) {
                const menuToRelease = menuRoot || menuMesh;
                if (menuToRelease) {
                  const worldPos = (menuToRelease as any).getAbsolutePosition().clone();
                  try { menuToRelease.setParent(null); } catch (_) { menuToRelease.parent = null; }
                  try { (menuToRelease as any).setAbsolutePosition(worldPos); } catch (_) { menuToRelease.position = worldPos; }
                }
                ctrlState._menuGrabbed = false;
              }
            }
          });
        }
      });
    });

    // cleanup: if a controller is removed while holding something, release it
    try {
      xr.input.onControllerRemovedObservable.add((xrController: any) => {
        try {
          const ctrlState = xrController as any;
          if (ctrlState._heldShape) {
            try { (ctrlState._heldShape as any)._heldBy = null; } catch (_) {}
            try {
              const worldPos = ctrlState._heldShape.getAbsolutePosition().clone();
              try { ctrlState._heldShape.setParent(null); } catch (_) { ctrlState._heldShape.parent = null; }
              try { ctrlState._heldShape.position = worldPos; } catch (_) {}
            } catch (_) {}
            ctrlState._heldShape = null;
            ctrlState._heldShapeParent = null;
          }

          if (ctrlState._menuGrabbed) {
            const menuToRelease = menuRoot || menuMesh;
            if (menuToRelease) {
              try {
                const worldPos = (menuToRelease as any).getAbsolutePosition().clone();
                try { menuToRelease.setParent(null); } catch (_) { menuToRelease.parent = null; }
                try { (menuToRelease as any).setAbsolutePosition(worldPos); } catch (_) { menuToRelease.position = worldPos; }
              } catch (_) {}
            }
            ctrlState._menuGrabbed = false;
          }
        } catch (e) {}
      });
    } catch (e) {
      // ignore
    }
  } catch (e) {
    // ignore
  }

  // No hit-test updates; reticle remains unused in this mode.
  
  // shape spawning
  function spawnShapeInScene(shapeType: ShapeType, pos: Vector3, size = 0.1) {
    try {
      let shape: any;
      const mat = new StandardMaterial("shapeMat", scene);
      mat.diffuseColor = Color3.FromHexString("#888888");
      
      switch (shapeType) {
        case "tetrahedron":
          shape = MeshBuilder.CreatePolyhedron("tetrahedron", { type: 0, size }, scene);
          break;
        case "cube":
          shape = MeshBuilder.CreateBox("cube", { size }, scene);
          break;
        case "sphere":
          shape = MeshBuilder.CreateSphere("sphere", { diameter: size }, scene);
          break;
        case "octahedron":
          shape = MeshBuilder.CreatePolyhedron("octahedron", { type: 1, size }, scene);
          break;
        case "dodecahedron":
          shape = MeshBuilder.CreatePolyhedron("dodecahedron", { type: 2, size }, scene);
          break;
        case "icosahedron":
          shape = MeshBuilder.CreatePolyhedron("icosahedron", { type: 3, size }, scene);
          break;
        default:
          // handle polyNN naming (poly0..poly14)
          try {
            if ((shapeType as string).startsWith("poly")) {
              const idx = parseInt((shapeType as string).replace("poly",""), 10);
              if (!isNaN(idx)) {
                shape = MeshBuilder.CreatePolyhedron(shapeType as string, { type: idx, size }, scene);
                break;
              }
            }
          } catch (e) {}
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
