// @ts-ignore: allow side-effect CSS import without typings
import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import { WebXRHitTest } from "@babylonjs/core/XR/features/webXRHitTest";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import createFloatingMenu, { ShapeType } from "./menu";

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

  // Start XR AR experience
  const xr = await WebXRDefaultExperience.CreateAsync(scene, {
    uiOptions: { sessionMode: "immersive-ar", referenceSpaceType: "local-floor" }
  });

  // Hit test feature to place objects on real world surfaces
  const fm = xr.baseExperience.featuresManager;
  const hitTest = fm.enableFeature(WebXRHitTest.Name, "latest") as WebXRHitTest;

  // reticle to show placement
  const reticle = MeshBuilder.CreateDisc("reticle", { radius: 0.06 }, scene);
  reticle.rotation.x = Math.PI / 2;
  reticle.isVisible = false;

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

  // Floating menu attached to the XR camera
  const menuMesh = createFloatingMenu(xr.baseExperience.camera as any, scene, (shape) => {
    const pos = reticle.isVisible ? reticle.position.clone() : xr.baseExperience.camera.position.add(xr.baseExperience.camera.getForwardRay(2).direction.scale(1.2));
    spawnShape(shape, pos, scene);
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
    scene.render();
  });

  window.addEventListener("resize", () => engine.resize());
}

createScene().catch((err) => console.error(err));
