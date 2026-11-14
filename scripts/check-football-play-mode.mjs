// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

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
import { Observable } from '@babylonjs/core/Misc/observable.js';

const transform = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const snapSource = transform('../src/robot/footballSnapPauses.ts');
let clock = 0, snapTransport = { beat: 47, playing: true, beatsPerSecond: 2, revision: 1 };
let snapStarts = 0;
const snapAfterRender = new Observable();
const snapContext = vm.createContext({
  startFootballMusicPause() {}, finishFootballMusicPause() {}, resetFootballMusicPause() {},
  scene: { onAfterRenderObservable: snapAfterRender }, performance: { now: () => clock },
  getDrillTransportState: () => ({ ...snapTransport }),
  pauseAll: () => { snapTransport.playing = false; },
  seekToCount: beat => { snapTransport.beat = beat; snapTransport.revision++; },
  playAll: () => { snapTransport.playing = true; snapStarts++; },
  footballStatus: { value: '' }, floorCalibrationToggle: { checked: false },
});
vm.runInContext(stripTypeScriptTypes(snapSource, { mode: 'transform' }), snapContext);
const snapEvents = [48, 96].map(startCount => ({ kind: 'snap', startCount }));
const disposeSnaps = snapContext.initFootballSnapPauses(snapEvents);
snapTransport.beat = 48.3; snapAfterRender.notifyObservers(null);
assert.equal(snapTransport.beat, 48, 'Crossing snap stops at the exact count');
assert.equal(snapTransport.playing, false);
clock = 2999; snapAfterRender.notifyObservers(null);
assert.equal(snapStarts, 0, 'Snap pause lasts the full three seconds');
clock = 3000; snapAfterRender.notifyObservers(null);
assert.equal(snapStarts, 1);
snapAfterRender.notifyObservers(null);
assert.equal(snapTransport.playing, true, 'Resuming at the snap does not pause again');
snapTransport.beat = 95; snapAfterRender.notifyObservers(null);
snapEvents[1].startCount += 4;
snapTransport.beat = 100.2; snapAfterRender.notifyObservers(null);
assert.equal(snapTransport.beat, 100, 'Later snap pauses follow retimed event counts');
clock += 3000; snapContext.floorCalibrationToggle.checked = true; snapAfterRender.notifyObservers(null);
assert.equal(snapStarts, 1, 'Calibration defers the restart');
snapContext.floorCalibrationToggle.checked = false; snapAfterRender.notifyObservers(null);
assert.equal(snapStarts, 2, 'Every play resumes after its pause');
snapTransport.beat = 47; snapTransport.revision++; snapAfterRender.notifyObservers(null);
snapTransport.beat = 48; snapAfterRender.notifyObservers(null);
assert.equal(snapTransport.playing, false, 'Replaying a snap pauses again');
snapTransport.beat = 49; snapTransport.revision++;
clock += 3000; snapAfterRender.notifyObservers(null);
assert.equal(snapStarts, 2, 'Manual seek cancels a pending restart');
disposeSnaps();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(snapAfterRender.observers.length, 0, 'Snap observer is disposed on football exit');
assert.match(readFileSync(new URL('../src/index.html', import.meta.url), 'utf8'),
  /id="footballFlightPath"[^>]*\bchecked\b/, 'Ball path defaults on in the shared native/XR toggle');
const geometry = vm.createContext({});
vm.runInContext(transform('../src/robot/footballPlayGeometry.ts'), geometry);
vm.runInContext(transform('../src/robot/footballPlaySequence.ts'), geometry);
vm.runInContext(transform('../src/robot/footballSpecialTeams.ts'), geometry);
vm.runInContext(transform('../src/robot/footballPlayLibrary.ts'), geometry);
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
  addPlaybackPreparationGuard() { throw new Error('Football must not require preparation before Play.'); },
  startFootballMusicPause() {}, finishFootballMusicPause() {}, resetFootballMusicPause() {},
  MeshBuilder, Mesh, TransformNode, Color3, Matrix, Quaternion, Vector3, scene, TOP_DOWN_MARKER_LAYER_MASK: 0x10000000,
  FIELD_WIDTH_YARDS: 53.333, FIELD_LENGTH_YARDS: 120, END_ZONE_DEPTH_YARDS: 10, FIELD_SURFACE_Y: -.48,
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
  scrimmageButton: null,
  footballStatus: { value: '' },
  footballBallHighlight: { checked: false }, footballFlightPath: { checked: false },
  initFootballTackleEditor: () => Object.assign(() => {}, { refresh() {} }),
  createFootballFuturePreview: () => () => {},
});
for (const module of ['footballMovement', 'footballPresentation', 'footballBodyClearance', 'footballSymbolModel', 'footballHumanModel', 'scrimmageGeometry', 'footballTackles', 'footballAnimationLibrary', 'footballBallFlight', 'footballLineOfScrimmage', 'footballSnapPauses']) {
  vm.runInContext(transform(`../src/robot/${module}.ts`), context);
}
vm.runInContext(transform('../src/robot/footballPlayMode.ts'), context);
let movementCalls = 0;
const originalMovement = context.footballMovement;
context.footballMovement = (...args) => {
  movementCalls++;
  return originalMovement(...args);
};
scene.onBeforeRenderObservable.add(() => {
  for (const [robot, counts] of schedules) {
    if (robot.isDisposed() || !counts.length) continue;
    const time = Math.max(0, Math.min(counts.length - 1, beat)), index = Math.floor(time);
    robot.position.copyFrom(Vector3.Lerp(counts[index].position,
      counts[Math.min(index + 1, counts.length - 1)].position, time - index));
    const resolved = context.getFootballPlaybackPosition(robot, beat);
    if (resolved) { robot.position.x = resolved.x; robot.position.z = resolved.z; }
    robot.computeWorldMatrix(true);
  }
});
const near = (actual, expected, message) =>
  assert.ok(Vector3.Distance(actual, expected) < 1e-6, `${message}: ${actual} versus ${expected}`);
const resolvedAnchor = (robot, count, height = 1.05) => {
  const position = schedules.get(robot)[count].position.clone();
  const resolved = context.getFootballPlaybackPosition(robot, count);
  if (resolved) { position.x = resolved.x; position.z = resolved.z; }
  return position.add(new Vector3(0, height, 0));
};
const snapAnchor = (robot, count) => {
  const position = resolvedAnchor(robot, count, .22);
  position.z = schedules.get(robot)[count].position.z;
  return position;
};
const assertRenderedClearance = (players, tackles = [], scrimmageZ) => {
  const inverse = parent.computeWorldMatrix(true).clone().invert();
  const bodies = players.map(({ robot, player }) => {
    const torso = scene.getTransformNodeByName(`football-player-${player.id}`);
    const tackle = tackles.find(event => [event.defenderId, event.carrierId].includes(player.id) &&
      context.footballTacklePose(event, beat));
    const fall = tackle ? context.footballTacklePose(tackle, beat)?.fall ?? 0 : 0;
    const lean = fall < 1 ? (torso.rotation.x - Math.PI / 2 * fall) / (1 - fall) : 0;
    const body = { x: robot.position.x, z: robot.position.z, yaw: torso.rotation.y + robot.rotation.y, fall, lean, scale: 1 };
    const reach = (.05 + Math.abs(lean) * .5) * (1 - fall) + .9 * fall;
    const offset = (-.03 + lean * .5) * (1 - fall);
    const centerX = body.x + Math.sin(body.yaw) * offset, centerZ = body.z + Math.cos(body.yaw) * offset;
    const dx = Math.sin(body.yaw) * reach, dz = Math.cos(body.yaw) * reach;
    for (const mesh of torso.getChildMeshes()) {
      if (mesh.name.startsWith('football-role')) continue;
      const vertices = mesh.getVerticesData('position');
      if (!vertices) continue;
      const matrix = mesh.computeWorldMatrix(true).multiply(inverse);
      for (let index = 0; index < vertices.length; index += 3) {
        const point = Vector3.TransformCoordinates(new Vector3(vertices[index], vertices[index + 1], vertices[index + 2]), matrix);
        if (scrimmageZ !== undefined) {
          assert.ok(player.team === 'offense' ? point.z <= scrimmageZ - .08 + 1e-5
            : point.z >= scrimmageZ + .08 - 1e-5,
          `${mesh.name}: the whole player, not just the route root, must start on its own side of the TV line`);
        }
        const t = reach ? Math.max(0, Math.min(1,
          ((point.x - centerX + dx) * 2 * dx + (point.z - centerZ + dz) * 2 * dz) / (4 * reach * reach))) : 0;
        const distance = Math.hypot(point.x - (centerX - dx + 2 * dx * t), point.z - (centerZ - dz + 2 * dz * t));
        assert.ok(distance <= .53 + 1e-5, `${mesh.name}: actual geometry must fit its clearance capsule at beat ${beat}: ${distance}, fall=${fall}, yaw=${body.yaw}, lean=${lean}, point=${point}, body=${JSON.stringify(body)}`);
      }
    }
    return body;
  });
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    assert.ok(context.footballBodyGap(bodies[i], bodies[j]).distance >= 1.06 - 1e-6,
      `Actual bodies ${i}/${j} must not overlap at beat ${beat}`);
  }
};
try {
  for (const [formation, play] of [
    ['shotgun', 'slants'], ['spread', 'slants'], ['i-form', 'slants'],
    ['shotgun', 'sweep'], ['shotgun', 'four-verticals'],
  ]) {
    const data = geometry.generateFootballPlay(formation, play);
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
    const scrimmageLine = scene.getMeshByName('football-line-of-scrimmage');
    assert.ok(scrimmageLine && !scrimmageLine.isPickable && !scrimmageLine.checkCollisions,
      'TV line is a non-interacting field overlay');
    assert.equal(scrimmageLine.position.z, data.players.find(player => player.label === 'C').positions[0].z);
    const centerTorso = scene.getTransformNodeByName('football-player-offense-C');
    assert.equal(centerTorso.rotation.x, .35, 'Center is bent forward for the snap');
    assert.ok(centerTorso.position.y < .8, 'Center lowers hips into snap stance');
    const snapArm = scene.getTransformNodeByName('football-shoulder-offense-C--1');
    const readyArm = snapArm.rotation.x;
    beat = .5; scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(snapArm.rotation.x > readyArm, 'Center moves arms backward through snap release');
    for (const { robot, player } of players) {
      const point = context.getFootballPlaybackPosition(robot, 0);
      assert.ok(player.team === 'offense' ? point.z <= scrimmageLine.position.z + 1e-6
        : point.z >= scrimmageLine.position.z - 1e-6, 'Players start on their own side of TV line');
    }
    for (const count of [0, 3.5, 7, 10.5, 16]) {
      beat = count; scene.onBeforeRenderObservable.notifyObservers(scene);
      assertRenderedClearance(players, [], count === 0 ? scrimmageLine.position.z : undefined);
    }
    const ball = scene.getMeshByName('football-ball');
    const possessionHalo = scene.getMeshByName('football-possession-halo');
    assert.equal(possessionHalo.parent, parent, 'Possession halo is field-local, not attached to the flying ball');
    assert.ok(!possessionHalo.isPickable && !possessionHalo.checkCollisions);
    beat = 0; scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(possessionHalo.isEnabled(), 'Center has the ground halo before the snap');
    const centerPosition = context.getFootballPlaybackPosition(players.find(entry => entry.player.label === 'C').robot, 0);
    near(possessionHalo.position, new Vector3(centerPosition.x, -.455, centerPosition.z),
      'Halo uses separated player position, not ball launch position');
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-helmet-')).length, 22);
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-face-')).length, 22,
      'Players have visible human faces beneath their helmets');
    const maskMeshes = scene.meshes.filter(mesh => mesh.name.startsWith('football-mask-'));
    assert.equal(maskMeshes.length, 44, 'Each player has a cage and a center chin bar');
    let cages = 0;
    for (const mask of maskMeshes) {
      const vertices = mask.getVerticesData('position');
      const inverse = mask.parent.computeWorldMatrix(true).clone().invert();
      const matrix = mask.computeWorldMatrix(true).multiply(inverse);
      const points = [];
      for (let index = 0; index < vertices.length; index += 3) {
        points.push(Vector3.TransformCoordinates(new Vector3(vertices[index], vertices[index + 1], vertices[index + 2]), matrix));
      }
      const extent = axis => Math.max(...points.map(point => point[axis])) - Math.min(...points.map(point => point[axis]));
      assert.ok(Math.min(...points.map(point => point.z)) > -.01,
        'Face guard is a front-only cage attached at the jaw, not a ring around the helmet');
      assert.ok(Math.max(...points.map(point => point.z)) > .22,
        'Front of the face guard clears the nose');
      if (extent('x') > .28) {
        cages++;
        assert.ok(extent('y') > .05 && extent('y') < .2,
          'Cage bars band the mouth and chin, not the whole face');
      } else {
        assert.ok(extent('x') < .1 && extent('y') > .08,
          'The narrow mask piece is a vertical center bar tying the cage bars together');
      }
    }
    assert.equal(cages, 22, 'Every player wears one full-width cage');
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-thigh-')).length, 44);
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-calf-')).length, 44);
    // Facial features: layered eyes under brows and a mouth shadow per player.
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-brow-')).length, 44,
      'Every player has two eyebrows');
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-iris-')).length, 44,
      'Every player has two irises layered between eye whites and pupils');
    assert.equal(scene.meshes.filter(mesh => mesh.name.startsWith('football-mouth-')).length, 22,
      'Every player has a mouth shadow in the cage gap');
    for (const suffix of ['eye-white-offense-QB--1', 'iris-offense-QB--1', 'pupil-offense-QB--1']) {
      assert.ok(scene.getMeshByName(`football-${suffix}`), `football-${suffix} exists`);
    }
    {
      const white = scene.getMeshByName('football-eye-white-offense-QB--1');
      const iris = scene.getMeshByName('football-iris-offense-QB--1');
      const pupil = scene.getMeshByName('football-pupil-offense-QB--1');
      assert.ok(white.position.z < iris.position.z && iris.position.z < pupil.position.z,
        'Iris layers in front of the white and behind the pupil');
      assert.ok(iris.scaling.x < white.scaling.x && pupil.scaling.x < iris.scaling.x,
        'Eye layers shrink from white to iris to pupil');
    }
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
      if (count === beat && data.ballEvents.some(event => event.kind === 'pass' && event.toId === id &&
        count >= event.endCount)) {
        const inverse = parent.computeWorldMatrix(true).clone().invert();
        const hands = [-1, 1].map(side => {
          const hand = scene.getMeshByName(`football-glove-${id}-${side}`);
          return Vector3.TransformCoordinates(hand.computeWorldMatrix(true).getTranslation(), inverse);
        });
        return Vector3.Center(hands[0], hands[1]);
      }
      return data.ballEvents.some(event => event.kind === 'snap' && event.fromId === id && count <= event.startCount)
        ? snapAnchor(robot, count) : resolvedAnchor(robot, count);
    };
    for (const event of data.ballEvents.filter(event => event.kind === 'pass')) {
      const arm = scene.getTransformNodeByName(`football-shoulder-${event.fromId}-1`);
      const elbow = scene.getTransformNodeByName(`football-elbow-${event.fromId}-1`);
      for (const time of [-.5, 0, .175, .35, .5, .8, 1.5, 2]) {
        beat = event.startCount + time; scene.onBeforeRenderObservable.notifyObservers(scene);
        assertRenderedClearance(players);
      }
      beat = event.startCount; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(arm.rotation.x, -2.2, 'Thrower cocks right arm above shoulder');
      assert.equal(elbow.rotation.x, -1.8, 'Throwing elbow bends in windup');
      beat = event.startCount + .35; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(Math.abs(elbow.rotation.x + .45) < 1e-6, 'Throwing elbow extends at release');
      const release = arm.rotation.x;
      beat = event.startCount + 1; scene.onBeforeRenderObservable.notifyObservers(scene);
      beat = event.startCount + .35; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(arm.rotation.x, release, 'Reverse seeking reconstructs throwing pose');
      calibration.checked = true; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(elbow.rotation.x, -1.1, 'Calibration removes throwing override');
      calibration.checked = false;
      for (const time of [-.5, 0, .25, .5, 1, 1.5]) {
        beat = event.endCount + time; scene.onBeforeRenderObservable.notifyObservers(scene);
        assertRenderedClearance(players);
      }
      beat = event.endCount; scene.onBeforeRenderObservable.notifyObservers(scene);
      const catcher = [-1, 1].map(side => scene.getTransformNodeByName(`football-shoulder-${event.toId}-${side}`));
      catcher.forEach(arm => assert.equal(arm.rotation.x, -.75, 'Receiver reaches with both arms on arrival'));
      assert.equal(catcher[0].rotation.z, .4, 'Left hand angles inward toward the pass');
      assert.equal(catcher[1].rotation.z, -.4, 'Right hand angles inward toward the pass');
      beat = event.endCount + .5; scene.onBeforeRenderObservable.notifyObservers(scene);
      catcher.forEach(arm => assert.ok(Math.abs(arm.rotation.x + .6) < 1e-6, 'Catch tucks both arms'));
      beat = event.endCount + 2; scene.onBeforeRenderObservable.notifyObservers(scene);
      catcher.forEach(arm => assert.ok(Math.abs(arm.rotation.x + .6) < 1e-6,
        'Receiver continues holding the ball instead of swinging carrying hands'));
      near(ball.position, positionAt(event.toId, beat), 'Caught ball is held between actual gloves');
      const receiverTorso = scene.getTransformNodeByName(`football-player-${event.toId}`);
      const ballWorld = Vector3.TransformCoordinates(ball.position, parent.computeWorldMatrix(true));
      const localBall = Vector3.TransformCoordinates(ballWorld, receiverTorso.computeWorldMatrix(true).clone().invert());
      assert.ok(localBall.z - .24 / 2 > .18,
        `Held football clears the front of the jersey instead of entering the stomach: ${localBall.z}`);
      beat = event.endCount; scene.onBeforeRenderObservable.notifyObservers(scene);
      catcher.forEach(arm => assert.equal(arm.rotation.x, -.75, 'Reverse seeking reconstructs catch'));
      calibration.checked = true; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getTransformNodeByName(`football-elbow-${event.toId}-1`).rotation.x, -1.1,
        'Calibration removes catch override');
      catcher.forEach(arm => assert.equal(arm.rotation.z, 0, 'Calibration clears inward catch rotation'));
      calibration.checked = false;
    }
    for (const event of data.ballEvents) {
      beat = (event.startCount + event.endCount) / 2;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const midpoint = Vector3.Lerp(positionAt(event.fromId, event.startCount), positionAt(event.toId, event.endCount), .5);
      if (event.kind === 'pass') midpoint.y += 4;
      near(ball.position, midpoint, `${play}: ${event.kind} follows the shared timeline`);
      assert.equal(possessionHalo.isEnabled(), false, 'No player possession halo during ball transfer');
      near(ball.computeWorldMatrix(true).getTranslation(),
        Vector3.TransformCoordinates(midpoint, parent.computeWorldMatrix(true)),
        `${play}: the ball follows scaled/rotated tabletop placement`);
      beat = event.endCount;
      const { robot } = players.find(value => value.player.id === event.toId);
      schedules.get(robot)[beat].position.x += .5;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      near(ball.position, positionAt(event.toId, beat), `${play}: route endpoint edits move the ball target`);
      assert.ok(possessionHalo.isEnabled(), 'Possession halo switches to the completed transfer recipient');
      const recipient = context.getFootballPlaybackPosition(robot, beat);
      near(possessionHalo.position, new Vector3(recipient.x, -.455, recipient.z),
        'Possession halo follows edited recipient route');
      near(possessionHalo.computeWorldMatrix(true).getTranslation(),
        Vector3.TransformCoordinates(possessionHalo.position, parent.computeWorldMatrix(true)),
        'Ground halo follows rotated/scaled tabletop placement');
    }
    calibration.checked = true;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(ball.isEnabled(), false, 'Calibration hides the ball');
    assert.equal(possessionHalo.isEnabled(), false, 'Calibration hides possession halo');
    assert.equal(scrimmageLine.isEnabled(), false, 'Calibration hides the TV line');
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
    // Direct rig pokes bypass the transport; paused frames with an unchanged
    // beat legitimately skip re-posing, so advance the clock a hair.
    beat = 5.26;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const thigh = scene.getMeshByName('football-thigh-offense-QB-0');
    hip.computeWorldMatrix(true); knee.computeWorldMatrix(true); thigh.computeWorldMatrix(true);
    near(thigh.getAbsolutePosition(), Vector3.Center(hip.getAbsolutePosition(), knee.getAbsolutePosition()),
      'Human thigh follows solved hip/knee joints under tabletop scale and torso lean');
    if (play !== 'sweep') {
      beat = 13;
      context.footballBallHighlight.checked = true; context.footballFlightPath.checked = true;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      const halo = scene.getMeshByName('football-ball-highlight');
      const line = scene.getMeshByName('football-flight-path');
      assert.ok(halo.isEnabled() && line.isEnabled(), 'Optional halo and flight path follow live ball playback');
      assert.equal(line.parent, parent, 'Flight guide follows rotated/scaled tabletop field');
      assert.equal(line.getTotalVertices(), 33, 'Whole flight arc has fixed reusable samples');
      const lastEvent = data.ballEvents[data.ballEvents.length - 1];
      const receiver = players.find(entry => entry.player.id === lastEvent.toId).robot;
      const prior = line.getVerticesData('position')[96];
      schedules.get(receiver)[lastEvent.endCount].position.x += 1;
      // Live-edit detection is a polling safety net throttled to every fourth
      // frame (editors clear the clearance caches directly); pump the window.
      for (let frame = 0; frame < 4; frame++) scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(Math.abs(line.getVerticesData('position')[96] - prior - 1) < 1e-5,
        'Flight guide refreshes after live endpoint edits');
      assert.equal(line.isPickable, false); assert.equal(halo.isPickable, false);
      calibration.checked = true; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(line.isEnabled(), false); assert.equal(halo.isEnabled(), false);
      calibration.checked = false; context.footballBallHighlight.checked = false; context.footballFlightPath.checked = false;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(line.isEnabled(), false); assert.equal(halo.isEnabled(), false);
    }
    dispose();
    assert.ok(players.every(({ robot }) => context.getFootballPlaybackPosition(robot, beat) === null),
      'Football exit removes body-clearance samplers from shared marcher playback');
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
    for (const { robot, player } of players) {
      schedules.set(robot, context.scrimmagePlayerRoute(player.positions, players.findIndex(entry => entry.robot === robot))
        .map(point => ({ position: new Vector3(point.x, -.48, point.z) })));
    }
    const stagedDispose = context.createFootballVisuals(players, data.ballEvents.map(event => ({
      ...event, startCount: event.startCount + 96, endCount: event.endCount + 96,
    })), parent, 96, undefined, [], [], 112);
    for (const count of [112, 136, 160, 161, 162, 210]) {
      beat = count; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getMeshByName('football-ball').isEnabled(), false, 'Ball hides during return handover');
      assert.equal(scene.getMeshByName('football-line-of-scrimmage').isEnabled(), false);
      if (count >= 162) {
        for (const { robot, player } of players) {
          const torso = scene.getTransformNodeByName(`football-player-${player.id}`);
          assert.ok(Math.abs(torso.position.y - .6) < 1e-9, 'Returned players sit at bench height');
          assert.equal(robot.metadata.motion.playEnd, 112);
        }
      }
    }
    beat = 136; scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(scene.getTransformNodeByName('football-player-offense-LT').position.y > .9,
      'Return walk uses standing jog pose, not blocking crouch');
    beat = 162; scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.ok(Math.abs(scene.getTransformNodeByName('football-player-offense-LT').position.y - .6) < 1e-9,
      'Reverse seek recreates completed bench seating');
    beat = 49;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const standingHeight = scene.getTransformNodeByName('football-player-offense-QB').position.y;
    for (const { robot } of players) {
      const counts = schedules.get(robot);
      schedules.set(robot, [counts[0], ...Array.from({ length: 4 }, () => ({ position: counts[0].position.clone() })),
        ...counts.slice(1)]);
    }
    context.shiftFootballTimeline(0, 4);
    assert.equal(players[0].robot.metadata.motion.playEnd, 116, 'Chart insertion retimes bench return');
    beat = 53;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    assert.equal(scene.getTransformNodeByName('football-player-offense-QB').position.y, standingHeight,
      'Chart insertion before the entrance shifts seated/standing presentation with route counts');
    stagedDispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    if (play === 'four-verticals') {
      const sequence = geometry.generateFootballPlaySequence();
      for (const { robot, player } of players) {
        const route = sequence.players.find(candidate => candidate.id === player.id);
        schedules.set(robot, route.positions.map(point => ({ position: new Vector3(point.x, -.48, point.z) })));
      }
      beat = 0;
      const sequenceDispose = context.createFootballVisuals(players, sequence.ballEvents, parent, 0, sequence.sequence, sequence.tackles);
      const sequenceBall = scene.getMeshByName('football-ball');
      for (const segment of sequence.sequence) {
        for (const elapsed of [0, .5, 1, 1.5, 2, 4, 5, 6, 7, 8]) {
          beat = segment.endCount + elapsed; scene.onBeforeRenderObservable.notifyObservers(scene);
          assertRenderedClearance(players, sequence.tackles);
        }
        beat = segment.startCount;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.equal(scene.getMeshByName('football-line-of-scrimmage').position.z,
          schedules.get(players.find(entry => entry.player.label === 'C').robot)[beat].position.z,
        'TV line follows each play snap count');
        assertRenderedClearance(players, sequence.tackles,
          scene.getMeshByName('football-line-of-scrimmage').position.z);
        assert.ok(sequenceBall.isEnabled(), 'Ball returns for each snap');
        near(sequenceBall.position, snapAnchor(players.find(value => value.player.label === 'C').robot, beat),
          'Each snap begins on the line in front of the separated center');
        assert.ok(context.footballStatus.value.includes(segment.label), 'Status names current concept');
        beat = segment.endCount + 2;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        const event = sequence.tackles.find(event => event.count === segment.endCount);
        for (const id of [event.defenderId, event.carrierId]) {
          const torso = scene.getTransformNodeByName(`football-player-${id}`);
          assert.ok(Math.abs(torso.rotation.x - Math.PI / 2) < 1e-9, 'Both players fall horizontally');
          assert.equal(torso.position.y, .22, 'Fallen players are on the turf');
        }
        const defender = players.find(entry => entry.player.id === event.defenderId).robot;
        const carrier = players.find(entry => entry.player.id === event.carrierId).robot;
        const yaw = scene.getTransformNodeByName(`football-player-${event.carrierId}`).rotation.y + carrier.rotation.y;
        const otherYaw = scene.getTransformNodeByName(`football-player-${event.defenderId}`).rotation.y + defender.rotation.y;
        assert.ok(Math.abs(Math.sin(yaw - otherYaw)) < 1e-9, 'Tackled players fall alongside one another');
        assert.ok(context.footballBodyGap({ x: defender.position.x, z: defender.position.z, yaw: otherYaw, fall: 1, scale: 1 },
          { x: carrier.position.x, z: carrier.position.z, yaw, fall: 1, scale: 1 }).distance >= 1.06 - 1e-6,
        'Fallen bodies including helmets and feet have disjoint clearance capsules');
        assert.equal(sequenceBall.isEnabled(), true, 'Ball stays with tackled carrier while falling');
        const possessionHalo = scene.getMeshByName('football-possession-halo');
        assert.ok(possessionHalo.isEnabled(), 'Ground halo stays visible during tackled possession');
        near(possessionHalo.position, new Vector3(carrier.position.x, -.455, carrier.position.z),
          'Ground halo remains on turf at carrier root, not at the falling chest');
        const saved = scene.getTransformNodeByName(`football-player-${event.carrierId}`).rotation.x;
        beat = segment.endCount + 6;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.ok(scene.getTransformNodeByName(`football-player-${event.carrierId}`).rotation.x < saved,
          'Both players recover before moving to the next set');
        beat = segment.endCount + 2;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.equal(scene.getTransformNodeByName(`football-player-${event.carrierId}`).rotation.x, saved,
          'Reverse scrubbing reconstructs tackle pose exactly');
        beat = segment.endCount + 8;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        const returningBall = sequence.ballEvents.some(ball => ball.kind === 'return' && ball.startCount === beat);
        assert.equal(sequenceBall.isEnabled(), returningBall, 'Ball stays visible for resets but hides after the last play');
        assert.equal(possessionHalo.isEnabled(), returningBall, 'Return starts with carrier possession');
      }
      for (const { robot } of players) {
        const counts = schedules.get(robot);
        schedules.set(robot, [counts[0], ...Array.from({ length: 4 }, () => ({ position: counts[0].position.clone() })),
          ...counts.slice(1)]);
      }
      context.shiftFootballTimeline(0, 4);
      assert.equal(sequence.sequence[1].startCount, 48, 'Timeline insertion does not mutate input geometry');
      beat = 30; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(sequenceBall.isEnabled() && sequenceBall.position.y > -.48 + 3,
        'Return flight retimes with inserted chart counts');
      beat = 32; scene.onBeforeRenderObservable.notifyObservers(scene);
      const returned = sequence.ballEvents.find(event => event.kind === 'return').targetPosition;
      near(sequenceBall.position, new Vector3(returned.x, -.48 + returned.height, returned.z),
        'Retimed return lands at the next snap spot');
      beat = 52;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getMeshByName('football-line-of-scrimmage').position.z,
        schedules.get(players.find(entry => entry.player.label === 'C').robot)[52].position.z,
      'TV line retimes with inserted chart pages');
      assertRenderedClearance(players, sequence.tackles,
        scene.getMeshByName('football-line-of-scrimmage').position.z);
      assert.ok(context.footballStatus.value.includes('Stick'), 'Play names follow inserted counts');
      near(sequenceBall.position, snapAnchor(players.find(value => value.player.label === 'C').robot, 52),
        'Next snap and separated ball endpoints shift with chart insertion');
      beat = 22;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getTransformNodeByName('football-player-offense-WR3').rotation.x, Math.PI / 2,
        'Tackle shifts with inserted chart counts');
      sequenceDispose();
      assert.throws(() => context.shiftFootballTimeline(0, 4), /active football timeline/,
        'Disposed football mode unregisters event retiming');
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    players.forEach(({ robot }) => robot.dispose());
    schedules.clear();
  }
  for (const play of ['drive', 'kickoff', 'punt', 'field-goal',
    'edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz']) {
    const data = geometry.generateFootballLibraryPlay('spread', play);
    const players = data.players.map(player => {
      const robot = new TransformNode(player.id, scene); robot.parent = parent;
      const rig = new TransformNode('marcherLegRoot', scene); rig.parent = robot;
      for (const side of [-1, 1]) {
        const hip = new TransformNode('marcherLeg', scene); hip.parent = rig; hip.position.set(side * .12, .98, 0);
        const knee = new TransformNode('marcherKnee', scene); knee.parent = hip; knee.position.y = -.45;
        const ankle = new TransformNode('marcherAnkle', scene); ankle.parent = knee; ankle.position.y = -.45;
      }
      schedules.set(robot, player.positions.map(point => ({ position: new Vector3(point.x, -.48, point.z) })));
      return { robot, player };
    });
    beat = 0;
    const dispose = context.createFootballVisuals(players, data.ballEvents, parent, 0, data.sequence, data.tackles, data.outcomes);
    const ball = scene.getMeshByName('football-ball');
    if (play === 'drive') {
      beat = 200.25; scene.onBeforeRenderObservable.notifyObservers(scene);
      movementCalls = 0;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(movementCalls <= 44,
        `Warm frame evaluates only current player gaits, not all prior counts: ${movementCalls}`);
      console.log(`Football warm-frame cadence: ${movementCalls} gait evaluations at count 200 (previous history loop: 4422).`);
      const entry = players.find(entry => entry.player.label === 'WR1');
      const motion = { team: entry.player.team, role: entry.player.label, playStart: 0, playWindows: data.sequence };
      const route = schedules.get(entry.robot), index = Math.floor(beat);
      let expectedSteps = 0;
      for (let count = 0; count < index; count++) {
        const a = route[count].position, b = route[count + 1].position;
        expectedSteps += originalMovement(motion, count, b.x - a.x, b.z - a.z).stepsPerCount;
      }
      const a = route[index].position, b = route[index + 1].position;
      const gait = originalMovement(motion, beat, b.x - a.x, b.z - a.z);
      expectedSteps += (beat - index) * gait.stepsPerCount;
      const arm = scene.getTransformNodeByName('football-shoulder-offense-WR1--1');
      assert.ok(Math.abs(arm.rotation.x - Math.sin(expectedSteps * Math.PI) * gait.armSwing) < 1e-9,
        'Cached cadence matches the original full-history arm phase');
      const savedX = route[1].position.x;
      route[1].position.x += 3;
      movementCalls = 0;
      // In-place edits are caught by the throttled poll; pump its window.
      for (let frame = 0; frame < 4; frame++) scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(movementCalls > 200, 'In-place route edits rebuild cached cumulative cadence');
      movementCalls = 0; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(movementCalls <= 44, 'Edited routes return to constant current-count gait work');
      route[1].position.x = savedX;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(Math.abs(arm.rotation.x - Math.sin(expectedSteps * Math.PI) * gait.armSwing) < 1e-9,
        'Restoring route coordinates restores the exact original phase');
    }
    for (const event of data.ballEvents.filter(event => event.kind === 'pass' || event.kind === 'return')) {
      for (let elapsed = -.75; elapsed <= 1.75; elapsed += .25) {
        for (const origin of [event.startCount, event.endCount]) {
          beat = origin + elapsed; scene.onBeforeRenderObservable.notifyObservers(scene);
          assertRenderedClearance(players, data.tackles);
        }
      }
      for (const event of data.ballEvents.filter(event => event.kind === 'return')) {
        const flightLine = scene.getMeshByName('football-flight-path');
        const possessionHalo = scene.getMeshByName('football-possession-halo');
        beat = event.startCount; scene.onBeforeRenderObservable.notifyObservers(scene);
        const carrier = players.find(entry => entry.player.id === event.fromId);
        const launch = schedules.get(carrier.robot)[event.startCount].position;
        const yaw = scene.getTransformNodeByName(`football-player-${event.fromId}`).rotation.y + carrier.robot.rotation.y;
        assert.ok(Math.abs(Math.sin(yaw - Math.atan2(event.targetPosition.x - launch.x,
          event.targetPosition.z - launch.z))) < 1e-9, 'Carrier faces the return landing spot while throwing');
        context.footballFlightPath.checked = true;
        beat = event.startCount + 2; scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.ok(ball.isEnabled() && flightLine.isEnabled(), 'Return throw and optional arc stay visible between plays');
        assert.equal(possessionHalo.isEnabled(), false, 'Airborne return has no possession halo');
        assert.ok(ball.position.y > -.48 + 3, 'Return has a raised throwing arc');
        const midpoint = ball.position.clone();
        for (const count of [event.endCount, event.endCount + 10]) {
          beat = count; scene.onBeforeRenderObservable.notifyObservers(scene);
          near(ball.position, new Vector3(event.targetPosition.x, -.48 + .22, event.targetPosition.z),
            'Returned ball waits at the next line of scrimmage');
          assert.ok(ball.isEnabled(), 'Returned ball does not disappear while teams reset');
          assert.equal(possessionHalo.isEnabled(), false, 'Grounded ball has no player possession');
          assert.equal(scene.getMeshByName('football-line-of-scrimmage').position.z, event.targetPosition.z,
            'Blue line advances when the return lands');
        }
        beat = event.startCount + 2; scene.onBeforeRenderObservable.notifyObservers(scene);
        near(ball.position, midpoint, 'Reverse seek reconstructs the return arc');
        calibration.checked = true; scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.equal(ball.isEnabled(), false, 'Calibration hides the return');
        calibration.checked = false;
        const oldPosition = parent.position.clone(), oldScale = parent.scaling.clone(), oldYaw = parent.rotation.y;
        parent.position.set(4, 2, -3); parent.scaling.setAll(.08); parent.rotation.y = .6;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        near(ball.position, midpoint, 'Tabletop transforms preserve field-local return arc');
        parent.position.copyFrom(oldPosition); parent.scaling.copyFrom(oldScale); parent.rotation.y = oldYaw;
        context.footballFlightPath.checked = false; scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.equal(flightLine.isEnabled(), false, 'Return respects the ball-path toggle');
      }
    }
    if (data.players.some(player => player.rush)) {
      beat = 12; scene.onBeforeRenderObservable.notifyObservers(scene);
      const frontZ = Math.min(...players.filter(entry => entry.player.team === 'offense' &&
        ['LT', 'LG', 'C', 'RG', 'RT'].includes(entry.player.label)).map(entry => entry.robot.position.z));
      assert.ok(players.filter(entry => entry.player.rush).every(entry => entry.robot.position.z < frontZ),
        'Rendered rushers pass the offensive front');
    }
    if (['edge-sack', 'blitz-sack', 'four-man-rush', 'linebacker-blitz'].includes(play)) {
      beat = 0;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assertRenderedClearance(players, [], scene.getMeshByName('football-line-of-scrimmage').position.z);
      for (const count of [4, 6, 8, 10, 12, 13, 14, 16, 18, 20]) {
        beat = count; scene.onBeforeRenderObservable.notifyObservers(scene);
        assertRenderedClearance(players, data.tackles);
        if (data.tackles.length ? count < 20 : count <= 16) {
          assert.ok(ball.isEnabled(), 'Rush and sack retain the visible possession ball');
        }
        if (data.tackles.length && count === 14) {
          const qb = scene.getTransformNodeByName('football-player-offense-QB');
          assert.equal(qb.rotation.x, Math.PI / 2, 'Quarterback falls during sack');
        }
      }
      beat = 0; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getTransformNodeByName('football-player-offense-QB').rotation.x, 0,
        'Reverse seek restores quarterback pre-snap pose');
    }
    const kick = data.ballEvents.find(event => event.kind === 'kick' || event.kind === 'punt');
    if (kick) {
      if (play === 'kickoff') {
        const tee = scene.getMeshByName('football-kicking-tee');
        assert.ok(tee.isEnabled() && !tee.isPickable, 'Kickoff ball waits on a non-pickable tee');
        near(ball.position, new Vector3(0, -.48 + .14, -15), 'Kickoff ball is stationary at own 35 before approach');
        assert.equal(scene.getMeshByName('football-possession-halo').isEnabled(), false,
          'Kickoff tee has no player possession');
      }
      const foot = scene.getMeshByName(`football-cleat-${kick.fromId}-1`);
      beat = kick.startCount - 1; scene.onBeforeRenderObservable.notifyObservers(scene);
      const before = foot.position.clone();
      beat = kick.startCount + .5; scene.onBeforeRenderObservable.notifyObservers(scene);
      const kicked = foot.position.clone();
      assert.ok(kicked.z > before.z + .2, 'Kicker/punter swings right leg through contact');
      beat = kick.startCount - 1; scene.onBeforeRenderObservable.notifyObservers(scene);
      near(foot.position, before, 'Rewind restores normal legs');
      beat = kick.startCount + .5; scene.onBeforeRenderObservable.notifyObservers(scene);
      near(foot.position, kicked, 'Fractional reverse seek reconstructs kick pose');
      context.footballFlightPath.checked = true;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(scene.getMeshByName('football-flight-path').isEnabled());
      if (play === 'kickoff') assert.equal(scene.getMeshByName('football-kicking-tee').isEnabled(), false);
      assert.ok(ball.position.y > -.48 + 1, 'Kicked football follows a raised arc');
      assert.equal(scene.getMeshByName('football-possession-halo').isEnabled(), false,
        'No player halo while kick/punt is airborne');
      if (play === 'punt') {
        beat = kick.startCount - .5;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.ok(Math.abs(ball.position.y - (-.48 + (1.05 + .3) / 2)) < 1e-6,
          'Punter lowers the ball continuously before foot contact');
      }
      context.footballFlightPath.checked = false;
    }
    if (data.outcomes?.length) {
      const event = data.outcomes[0];
      beat = event.count; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(scene.getMeshByName('football-score-sign').isEnabled(), 'Touchdown/field goal has visible field sign');
      assert.ok(ball.isEnabled(), 'Scoring ball stays visible after flight/play');
      assert.ok(context.footballStatus.value.includes(event.kind === 'touchdown' ? 'TOUCHDOWN' : 'FIELD GOAL'));
      assert.equal(scene.getMeshByName('football-possession-halo').isEnabled(), event.kind === 'touchdown',
        'Touchdown retains scorer possession; goalpost flight endpoint has none');
      beat = event.count - 1; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getMeshByName('football-score-sign').isEnabled(), false, 'No premature score on reverse seek');
      beat = event.count; calibration.checked = true; scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.equal(scene.getMeshByName('football-score-sign').isEnabled(), false);
      calibration.checked = false;
    }
    dispose(); players.forEach(({ robot }) => robot.dispose()); schedules.clear();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(scene.getMeshByName('football-flight-path'), null);
    assert.equal(scene.getMeshByName('football-ball-highlight'), null);
    assert.equal(scene.getMeshByName('football-score-sign'), null);
    assert.equal(scene.getMeshByName('football-possession-halo'), null, 'Possession halo is disposed on exit');
  }
  assert.ok(materials.filter(material => !material.name?.startsWith('footballSymbol-'))
    .every(material => material.disposed), 'All non-shared owned materials are disposed');
  console.log('Football mode passed: throw/catch/recovery arms, horizontal face guards, 22 human appearances, actual vertex/capsule clearance, falls, ball anchors, scrub, tabletop transforms, calibration and cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
