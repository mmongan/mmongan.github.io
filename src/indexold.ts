import * as BABYLON from '@babylonjs/core';
/// <reference path="create-scene.ts" />

import * as SCENE from './createscene';

const main = function () : void {
  const canvas = document.getElementById('render-canvas') as HTMLCanvasElement;

  let engine: BABYLON.Engine;

  const createDefaultEngine = function () {
    return new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true
    });
  };
   

    // Create engine.
    engine = createDefaultEngine();
    if (!engine) {
      throw 'Engine should not be null';
    }


  const updateInputSources = function (session, frame, refSpace) {
    for (let inputSource of session.inputSources) {
      let targetRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);

      // We may not get a pose back in cases where the input source has lost
      // tracking or does not know where it is relative to the given frame
      // of reference.
      if (!targetRayPose) {
        continue;
      }

      if (inputSource.targetRayMode == 'tracked-pointer') {
        // If we have a pointer matrix and the pointer origin is the users
        // hand (as opposed to their head or the screen) use it to render
        // a ray coming out of the input device to indicate the pointer
        // direction.
        scene.inputRenderer.addLaserPointer(targetRayPose.transform);
      }

      // If we have a pointer matrix we can also use it to render a cursor
      // for both handheld and gaze-based input sources.

      // Statically render the cursor 2 meters down the ray since we're
      // not calculating any intersections in this sample.
      let targetRay = new Ray(targetRayPose.transform);
      let cursorDistance = 2.0;
      let cursorPos = vec3.fromValues(
          targetRay.origin.x,
          targetRay.origin.y,
          targetRay.origin.z
          );
      vec3.add(cursorPos, cursorPos, [
          targetRay.direction.x * cursorDistance,
          targetRay.direction.y * cursorDistance,
          targetRay.direction.z * cursorDistance,
          ]);
      // vec3.transformMat4(cursorPos, cursorPos, inputPose.targetRay.transformMatrix);

      scene.inputRenderer.addCursor(cursorPos);
      
      if (inputSource.gripSpace) {
        let gripPose = frame.getPose(inputSource.gripSpace, refSpace);
        if (gripPose) {
          // If we have a grip pose use it to render a mesh showing the
          // position of the controller.
          scene.inputRenderer.addController(gripPose.transform.matrix, inputSource.handedness);
        }
      }
      
    }
  }







  

  (async () => {

    // // Initialize a WebXR session using "immersive-ar".
    // const session = await navigator.xr.requestSession("immersive-ar");    
    // // A 'local' reference space has a native origin that is located
    // // near the viewer's position at the time the session was created.
    // const referenceSpace = await session.requestReferenceSpace('local');

    const scene = await SCENE.createScene(engine, canvas);
    
    // Run render loop to render future frames.
    engine.runRenderLoop(function () {
      if (scene) {
        
        scene.render();
      
      }
    });

    // Handle browser resize.
    window.addEventListener('resize', function () {
      engine.resize();
    });

  })().catch(e => {
    // Deal with the fact the chain failed
  });      
}

main();

