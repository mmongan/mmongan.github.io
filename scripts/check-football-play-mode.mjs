import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';

const transform = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const geometry = vm.createContext({});
vm.runInContext(transform('../src/robot/footballPlayGeometry.ts'), geometry);
const engine = new NullEngine();
const scene = new Scene(engine);
const parent = new TransformNode('fieldRoot', scene);
parent.scaling.setAll(.01);
parent.rotation.y = .6;
parent.position.set(3, 1.2, -4);
let beat = 0;
const calibration = { checked: false };
const schedules = new Map();
const materials = [];
const context = vm.createContext({
  MeshBuilder, TransformNode, Color3, Vector3, scene,
  StandardMaterial: class {
    constructor() { materials.push(this); }
    dispose(_effect, textures) { this.disposed = true; if (textures) this.diffuseTexture?.dispose(); }
  },
  DynamicTexture: class { drawText() {} dispose() { this.disposed = true; } },
  getDrillTransportState: () => ({ beat }),
  getRobotCounts: robot => schedules.get(robot),
  setRobotColor() {},
  floorCalibrationToggle: calibration,
});
vm.runInContext(transform('../src/robot/footballPlayMode.ts'), context);
const near = (actual, expected, message) =>
  assert.ok(Vector3.Distance(actual, expected) < 1e-6, `${message}: ${actual} versus ${expected}`);
try {
  for (const play of ['slants', 'sweep', 'four-verticals']) {
    const data = geometry.generateFootballPlay('shotgun', play);
    const players = data.players.map(player => {
      const robot = new TransformNode(player.id, scene);
      robot.parent = parent;
      for (const name of ['marcherBody', 'marcherInstrumentRoot', 'marcherLegRoot']) {
        const child = new TransformNode(name, scene);
        child.parent = robot;
      }
      schedules.set(robot, player.positions.map(position =>
        ({ position: new Vector3(position.x, -.48, position.z) })));
      return { robot, player };
    });
    beat = 0;
    const observerCount = scene.onBeforeRenderObservable.observers.length;
    const dispose = context.createFootballVisuals(players, data.ballEvents, parent);
    const ball = scene.getMeshByName('football-ball');
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-helmet-')).length, 22);
    assert.equal(ball.parent, parent);
    for (const { robot } of players) {
      assert.equal(robot.getChildren().find(child => child.name === 'marcherBody').isEnabled(), false);
      assert.equal(robot.getChildren().find(child => child.name === 'marcherInstrumentRoot').isEnabled(), false);
      assert.equal(robot.getChildren().find(child => child.name === 'marcherLegRoot').isEnabled(), true);
    }
    const positionAt = (id, count) => {
      const { robot } = players.find(value => value.player.id === id);
      return schedules.get(robot)[count].position.add(new Vector3(0, 1.05, 0));
    };
    for (const event of data.ballEvents) {
      beat = (event.startCount + event.endCount) / 2;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const midpoint = Vector3.Lerp(positionAt(event.fromId, event.startCount), positionAt(event.toId, event.endCount), .5);
      if (event.kind === 'pass') midpoint.y += 4;
      near(ball.position, midpoint, `${play}: ${event.kind} follows the shared timeline`);
      near(ball.computeWorldMatrix(true).getTranslation(),
        Vector3.TransformCoordinates(midpoint, parent.computeWorldMatrix(true)),
        `${play}: the ball follows scaled/rotated tabletop placement`);
      beat = event.endCount;
      const { robot } = players.find(value => value.player.id === event.toId);
      schedules.get(robot)[beat].position.x += .5;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      near(ball.position, positionAt(event.toId, beat), `${play}: route endpoint edits move the ball target`);
    }
    calibration.checked = true;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(ball.isEnabled(), false, 'Calibration hides the ball');
    calibration.checked = false;
    dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(scene.getMeshByName('football-ball'), null);
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-helmet-')).length, 0);
    assert.equal(scene.onBeforeRenderObservable.observers.length, observerCount);
    assert.ok(players.every(({ robot }) => robot.getChildren()
      .find(child => child.name === 'marcherBody').isEnabled()), 'Cleanup restores surviving player body visibility');
    players.forEach(({ robot }) => robot.dispose());
    schedules.clear();
  }
  assert.ok(materials.every(material => material.disposed), 'All owned materials are disposed');
  console.log('Football mode passed: 22 player appearances, snap/handoff/pass, scrub, edited targets, tabletop transforms, calibration, and cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
