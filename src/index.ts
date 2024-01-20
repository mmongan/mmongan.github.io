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

  (async () => {
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

