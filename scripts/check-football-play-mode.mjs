import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
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
  MeshBuilder, Mesh, TransformNode, Color3, Matrix, Quaternion, Vector3, scene, TOP_DOWN_MARKER_LAYER_MASK: 0x10000000,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, END_ZONE_DEPTH_YARDS: 10,
  StandardMaterial: class {
    constructor(name) { this.name = name; materials.push(this); }
    dispose(_effect, textures) { this.disposed = true; if (textures) this.diffuseTexture?.dispose(); }
  },
  DynamicTexture: class { drawText() {} dispose() { this.disposed = true; } },
  getDrillTransportState: () => ({ beat }),
  getRobotCounts: robot => schedules.get(robot),
  setRobotColor() {},
  setRobotFootballMotion(robot, motion) { robot.metadata = { motion }; },
  floorCalibrationToggle: calibration,
});
for (const module of ['footballMovement', 'footballPresentation', 'footballSymbolModel', 'footballHumanModel', 'scrimmageGeometry']) {
  vm.runInContext(transform(`../src/robot/${module}.ts`), context);
}
vm.runInContext(transform('../src/robot/footballPlayMode.ts'), context);
const near = (actual, expected, message) =>
  assert.ok(Vector3.Distance(actual, expected) < 1e-6, `${message}: ${actual} versus ${expected}`);
try {
  for (const play of ['slants', 'sweep', 'four-verticals']) {
    const data = geometry.generateFootballPlay('shotgun', play);
    const players = data.players.map(player => {
      const robot = new TransformNode(player.id, scene);
      robot.parent = parent;
      for (const name of ['marcherBody', 'marcherInstrumentRoot', 'marcherLegRoot', 'robotTopDownMarker']) {
        const child = new TransformNode(name, scene);
        child.parent = robot;
      }
      const rig = robot.getChildren().find(node => node.name === 'marcherLegRoot');
      for (const side of [-1, 1]) {
        const hip = new TransformNode('marcherLeg', scene); hip.parent = rig;
        hip.position.set(side * .12, .98, 0);
        const knee = new TransformNode('marcherKnee', scene); knee.parent = hip; knee.position.y = -.45;
        const ankle = new TransformNode('marcherAnkle', scene); ankle.parent = knee; ankle.position.y = -.45;
        for (const [name, parent] of [['marcherThigh', hip], ['marcherCalf', knee], ['marcherKneeJoint', knee]]) {
          const child = new TransformNode(name, scene); child.parent = parent;
        }
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
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-face-')).length, 22,
      'Players have visible human faces beneath their helmets');
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-thigh-')).length, 44);
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-calf-')).length, 44);
    const jersey = scene.getMeshByName('football-jersey-offense-QB');
    assert.ok(jersey.getTotalVertices() > 24, 'Torso is rounded, not a six-face box');
    assert.ok(scene.getTransformNodeByName('football-elbow-offense-QB--1').rotation.x < -1,
      'Human arms have bent elbows');
    assert.equal(ball.parent, parent);
    assert.equal(scene.meshes.filter(mesh => mesh.name === 'robotTopDownMarker').length, 22);
    for (const { robot } of players) {
      assert.equal(context.footballChartSymbol(robot), robot.name.startsWith('offense') ? 'O' : 'X');
      const symbol = robot.getChildMeshes().find(mesh => mesh.name === 'robotTopDownMarker');
      assert.equal(symbol.layerMask, 0x10000000, 'Symbols are video/chart-only');
      assert.equal(symbol.isPickable, false);
      assert.equal(symbol.isVisible, true);
      assert.ok(symbol.isEnabled(), 'Football marker renders even though its source is hidden');
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
    beat = 5.25;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const receiver = scene.getTransformNodeByName('football-player-offense-WR1');
    const shoulder = scene.getTransformNodeByName('football-shoulder-offense-WR1--1');
    assert.equal(receiver.rotation.x, play === 'sweep' ? .1 : .24, 'Receiver lean matches jog or sprint speed');
    const armAngle = shoulder.rotation.x;
    beat = 5.5;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.notEqual(shoulder.rotation.x, armAngle, 'Running arms swing with the shared timeline');
    beat = 5.25;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(shoulder.rotation.x, armAngle, 'Scrubbing reconstructs the same pose');
    const quarterbackRobot = players.find(value => value.player.label === 'QB').robot;
    const rig = quarterbackRobot.getChildren().find(node => node.name === 'marcherLegRoot');
    const hip = rig.getChildren()[0];
    const knee = hip.getChildren().find(node => node.name === 'marcherKnee');
    hip.rotation.x = .35; knee.rotation.x = .4;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const thigh = scene.getMeshByName('football-thigh-offense-QB-0');
    hip.computeWorldMatrix(true); knee.computeWorldMatrix(true); thigh.computeWorldMatrix(true);
    near(thigh.getAbsolutePosition(), Vector3.Center(hip.getAbsolutePosition(), knee.getAbsolutePosition()),
      'Human thigh follows solved hip/knee joints under tabletop scale and torso lean');
    dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(scene.getMeshByName('football-ball'), null);
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-helmet-')).length, 0);
    assert.equal(scene.onBeforeRenderObservable.observers.length, observerCount);
    assert.ok(players.every(({ robot }) => robot.getChildren()
      .find(child => child.name === 'marcherBody').isEnabled()), 'Cleanup restores surviving player body visibility');
    assert.ok(players.every(({ robot }) => context.footballChartSymbol(robot) === null &&
      robot.metadata.motion === null), 'Exit removes football symbols and gait overrides');
    const waitingDispose = context.createFootballVisuals(players, [], parent, Infinity);
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-bench-seat-')).length, 2);
    for (const side of [-1, 1]) {
      const bench = scene.getTransformNodeByName(`football-bench-${side}`);
      assert.equal(bench.parent, parent, 'Team bench is field-mounted, not attached to audience stands');
      assert.ok(Math.abs(bench.position.x) > 53.333 / 2 &&
        Math.abs(bench.position.x) + .4 < 53.333 / 2 + 4,
      'Dedicated benches sit outside the sideline and ahead of the bleachers');
      const back = scene.getMeshByName(`football-bench-back-${side}`);
      assert.equal(back.material.name, side < 0 ? 'football-offense' : 'football-defense');
      assert.ok(back.position.x * side > 0, 'Backrest is behind the seated players, away from the field');
    }
    const seatedTorso = scene.getTransformNodeByName('football-player-offense-QB');
    assert.ok(Math.abs(seatedTorso.position.y - .60) < 1e-9, 'Waiting player sits at bench height');
    assert.equal(seatedTorso.rotation.y + quarterbackRobot.rotation.y, Math.PI / 2,
      'Seated offense faces the field from the left bench');
    assert.ok(scene.meshes.filter(mesh => mesh.name === 'robotTopDownMarker').every(mesh => !mesh.isEnabled()),
      'Waiting presentation players do not add video-monitor symbols');
    waitingDispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-bench-')).length, 0,
      'Benches dispose with football presentation');
    players.forEach(({ robot }) => robot.dispose());
    schedules.clear();
  }
  assert.ok(materials.filter(material => !material.name?.startsWith('footballSymbol-'))
    .every(material => material.disposed), 'All non-shared owned materials are disposed');
  console.log('Football mode passed: 22 player appearances, snap/handoff/pass, scrub, edited targets, tabletop transforms, calibration, and cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
