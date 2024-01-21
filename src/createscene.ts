import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Scene } from "@babylonjs/core/scene";
import { SceneLoader, ArcRotateCamera, MeshBuilder } from "@babylonjs/core";

import { GridMaterial } from "@babylonjs/materials/grid/gridMaterial";
import { SimpleMaterial } from "@babylonjs/materials/simple/simpleMaterial";

import "@babylonjs/loaders"


// Create scene and create XR experience.
export const createScene = async function (engine: Engine, canvas: HTMLCanvasElement): Promise<Scene> {

    // Create a basic Babylon Scene object.
    const scene = new Scene(engine);

    // Create and position a free camera.
    const camera = new FreeCamera('camera-1', new Vector3(0, 0, 5), scene);

    // Point the camera at scene origin.
    camera.setTarget(Vector3.Zero());

    // Attach camera to canvas.
    camera.attachControl(canvas, true);

    // Create a light and aim it vertically to the sky (0, 1, 0).
    let light = new HemisphericLight('light-1', new Vector3(0, 1, 0), scene);

    // Set light intensity to a lower value (default is 1).
    light.intensity = 0.5;    

    
    const importResult = await SceneLoader.ImportMeshAsync(
        "",
        "",
        "../assets/models/trumpet.glb",
        scene,
        undefined,
        ".glb"
    );
    // Create a default environment for the scene.
    scene.createDefaultEnvironment();

    


    return scene;

};

