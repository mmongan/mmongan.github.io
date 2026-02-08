// @ts-ignore: allow side-effect CSS import without typings
import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";

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

  // No surface hit test: we'll place objects relative to the XR camera instead
  // Reticle left in place for future use but not driven by hit-test
  const reticle = MeshBuilder.CreateDisc("reticle", { radius: 0.06 }, scene);
  reticle.rotation.x = Math.PI / 2;
  reticle.isVisible = false;

  // (menu removed) — no floating menu will be created in this build

  // No hit-test updates; reticle remains unused in this mode.

  // pointer interactions remain available, but no menu placement logic

  // controller grip handling removed along with the menu

  // shape spawning removed (previously provided by the menu)

  engine.runRenderLoop(() => {
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

createScene().catch((err) => console.error(err));
