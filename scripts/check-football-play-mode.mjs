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

const transform = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'),
  { mode: 'transform' }).replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
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
  footballStatus: { value: '' },
  footballBallHighlight: { checked: false }, footballFlightPath: { checked: false },
  initFootballTackleEditor: () => Object.assign(() => {}, { refresh() {} }),
  createFootballFuturePreview: () => () => {},
});
for (const module of ['footballMovement', 'footballPresentation', 'footballSymbolModel', 'footballHumanModel', 'scrimmageGeometry', 'footballTackles', 'footballBallFlight']) {
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
      scene.onBeforeRenderObservable.notifyObservers(scene);
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
    })), parent, 96);
    beat = 49;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    const standingHeight = scene.getTransformNodeByName('football-player-offense-QB').position.y;
    for (const { robot } of players) {
      const counts = schedules.get(robot);
      schedules.set(robot, [counts[0], ...Array.from({ length: 4 }, () => ({ position: counts[0].position.clone() })),
        ...counts.slice(1)]);
    }
    context.shiftFootballTimeline(0, 4);
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
        beat = segment.startCount;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        assert.ok(sequenceBall.isEnabled(), 'Ball returns for each snap');
        near(sequenceBall.position, schedules.get(players.find(value => value.player.label === 'C').robot)[beat]
          .position.add(new Vector3(0, 1.05, 0)), 'Each snap begins at center');
        assert.ok(context.footballStatus.value.includes(segment.label), 'Status names current concept');
        beat = segment.endCount + 2;
        scene.onBeforeRenderObservable.notifyObservers(scene);
        const event = sequence.tackles.find(event => event.count === segment.endCount);
        for (const id of [event.defenderId, event.carrierId]) {
          const torso = scene.getTransformNodeByName(`football-player-${id}`);
          assert.ok(Math.abs(torso.rotation.x - Math.PI / 2) < 1e-9, 'Both players fall horizontally');
          assert.equal(torso.position.y, .22, 'Fallen players are on the turf');
        }
        assert.equal(sequenceBall.isEnabled(), true, 'Ball stays with tackled carrier while falling');
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
        assert.equal(sequenceBall.isEnabled(), false, 'Ball is hidden during walk-back resets and after sequence');
      }
      for (const { robot } of players) {
        const counts = schedules.get(robot);
        schedules.set(robot, [counts[0], ...Array.from({ length: 4 }, () => ({ position: counts[0].position.clone() })),
          ...counts.slice(1)]);
      }
      context.shiftFootballTimeline(0, 4);
      assert.equal(sequence.sequence[1].startCount, 48, 'Timeline insertion does not mutate input geometry');
      beat = 52;
      scene.onBeforeRenderObservable.notifyObservers(scene);
      assert.ok(context.footballStatus.value.includes('Stick'), 'Play names follow inserted counts');
      near(sequenceBall.position, schedules.get(players.find(value => value.player.label === 'C').robot)[52]
        .position.add(new Vector3(0, 1.05, 0)), 'Next snap and ball endpoints shift with chart insertion');
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
  for (const play of ['drive', 'kickoff', 'punt', 'field-goal']) {
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
    const kick = data.ballEvents.find(event => event.kind === 'kick' || event.kind === 'punt');
    if (kick) {
      if (play === 'kickoff') {
        const tee = scene.getMeshByName('football-kicking-tee');
        assert.ok(tee.isEnabled() && !tee.isPickable, 'Kickoff ball waits on a non-pickable tee');
        near(ball.position, new Vector3(0, -.48 + .14, -15), 'Kickoff ball is stationary at own 35 before approach');
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
  }
  assert.ok(materials.filter(material => !material.name?.startsWith('footballSymbol-'))
    .every(material => material.disposed), 'All non-shared owned materials are disposed');
  console.log('Football mode passed: 22 player appearances, snap/handoff/pass, scrub, edited targets, tabletop transforms, calibration, and cleanup.');
} finally {
  scene.dispose();
  engine.dispose();
}
