// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const compile = text => stripTypeScriptTypes(text, { mode: 'transform' })
  .replace(/^import[\s\S]*?;\r?$/gm, '').replace(/export /g, '');
const engine = new NullEngine(), scene = new Scene(engine);
let playing = false;
const textures = [];
const spectatorBoxes = [];
const transport = new Observable();
const scrimmageListeners = new Set();
const scrimmageButton = { dataset: { returnBand: 'false' },
  addEventListener: (_, listener) => scrimmageListeners.add(listener),
  removeEventListener: (_, listener) => scrimmageListeners.delete(listener) };
const context = vm.createContext({
  scrimmageButton,
  scene, Mesh, MeshBuilder: { ...MeshBuilder, CreateSphere(name, options, scene) {
    const mesh = MeshBuilder.CreateSphere(name, options, scene);
    if (name.startsWith('spectator')) spectatorBoxes.push({ mesh, options });
    return mesh;
  }, CreateCapsule(name, options, scene) {
    const mesh = MeshBuilder.CreateCapsule(name, options, scene);
    if (name.startsWith('spectator')) spectatorBoxes.push({ mesh, options });
    return mesh;
  } }, TransformNode, StandardMaterial, Matrix, Quaternion, Vector3, Plane, Color3, Ray, Observable, VertexBuffer,
  Texture: { TRILINEAR_SAMPLINGMODE: 3 },
  document: { createElement: () => {
    const ctx = { labels: [], fillText(label) { this.labels.push(label); } };
    return { getContext: () => ctx };
  } },
  DynamicTexture: class {
    constructor(name, canvas) { this.name = name; this.ctx = canvas.getContext('2d'); textures.push(this); }
    update() { this.updates = (this.updates ?? 0) + 1; }
    dispose() {}
  },
  drawPanelButton() {},
  getDrillTransportState: () => ({ playing }),
  isPlaybackRequested: () => playing, isPlaybackStartPending: () => false,
  getMidiPlaybackWaitReason: () => null, onMidiStatusChangedObservable: { add: () => ({}), remove() {} },
  onDrillTransportChangedObservable: transport,
});
try {
  scene.activeCamera = new FreeCamera('viewer', Vector3.Zero(), scene);
  for (const file of ['interaction/editingMode', 'menu/handMenu', 'menu/settingsButtonIcons', 'menu/floatingPanel',
    'field/constants', 'field/meshMerging', 'field/stadiumCrowd', 'field/stands']) {
    vm.runInContext(compile(read(`../src/${file}.ts`)), context);
  }
  const { updateStands } = context.createStands();
  const scrimmageTexture = textures[textures.length - 1];
  assert.ok(scrimmageTexture.ctx.labels.includes('🏈'), 'Start sign displays football picture');
  scrimmageButton.dataset.returnBand = 'true';
  scrimmageListeners.forEach(listener => listener());
  assert.ok(scrimmageTexture.ctx.labels.includes('🎺'), 'Return sign displays trumpet picture');
  scrimmageButton.dataset.returnBand = 'false';
  scrimmageListeners.forEach(listener => listener());
  const faces = () => scene.meshes.filter(mesh => mesh.name.startsWith('stadiumMediaSignFace-'));
  const crowd = () => scene.meshes.filter(mesh => mesh.name.startsWith('stadiumCrowd_'));
  let previousFace;
  const counts = [];
  for (const level of ['highschool', 'college', 'nfl', 'highschool']) {
    spectatorBoxes.length = 0;
    updateStands(level);
    assert.ok(spectatorBoxes.length > 0, 'Crowd geometry is checked before material batching');
    // Body parts must be connected: every joint in the chains head-neck-torso,
    // torso-thigh-shin-shoe, and shoulder-arm-forearm actually overlaps, in
    // every pose (hands on lap, arms raised, one arm up, arms folded).
    const hatParts = new Set(['spectatorCap', 'spectatorCapBrim', 'spectatorHair']);
    const groups = [];
    for (const part of spectatorBoxes) {
      if (part.mesh.name === 'spectatorTorso') groups.push([]);
      if (!hatParts.has(part.mesh.name)) groups.at(-1).push(part);
    }
    // A capsule's core segment in world space; vertical unless rotated to lie
    // along the field (rotation.z) or across the body (rotation.x).
    const capsuleSegment = ({ mesh, options }) => {
      const half = options.height / 2 - options.radius;
      const axis = Math.abs(mesh.rotation.z - Math.PI / 2) < 1e-9 ? new Vector3(1, 0, 0)
        : Math.abs(mesh.rotation.x - Math.PI / 2) < 1e-9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
      return { a: mesh.position.subtract(axis.scale(half)), b: mesh.position.add(axis.scale(half)),
        radius: options.radius };
    };
    const segmentDistance = (p1, q1, p2, q2) => {
      const d1 = q1.subtract(p1), d2 = q2.subtract(p2), r = p1.subtract(p2);
      const a = Vector3.Dot(d1, d1), e = Vector3.Dot(d2, d2);
      const c = Vector3.Dot(d1, r), f = Vector3.Dot(d2, r);
      let s = 0, t = 0;
      if (a > 1e-12 || e > 1e-12) {
        if (a <= 1e-12) t = Math.max(0, Math.min(1, f / e));
        else if (e <= 1e-12) s = Math.max(0, Math.min(1, -c / a));
        else {
          const b = Vector3.Dot(d1, d2), den = a * e - b * b;
          s = den > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / den)) : 0;
          t = (b * s + f) / e;
          if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
          else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
        }
      }
      return p1.add(d1.scale(s)).subtract(p2.add(d2.scale(t))).length();
    };
    const capsulesTouch = (left, right) => {
      const one = capsuleSegment(left), two = capsuleSegment(right);
      return segmentDistance(one.a, one.b, two.a, two.b) <= one.radius + two.radius - .004;
    };
    // Conservative ellipsoid contact: a sphere of the smallest semi-axis.
    const sphereTouchesCapsule = (ellipsoidPart, capsulePart) => {
      const radius = Math.min(ellipsoidPart.options.diameterX,
        ellipsoidPart.options.diameterY, ellipsoidPart.options.diameterZ) / 2;
      const segment = capsuleSegment(capsulePart);
      return segmentDistance(ellipsoidPart.mesh.position, ellipsoidPart.mesh.position,
        segment.a, segment.b) <= radius + segment.radius - .004;
    };
    const nearest = (part, candidates) => candidates.reduce((best, candidate) =>
      candidate.mesh.position.subtract(part.mesh.position).length() <
        best.mesh.position.subtract(part.mesh.position).length() ? candidate : best);
    for (const group of groups) {
      const named = name => group.filter(part => part.mesh.name === name);
      const [torso] = named('spectatorTorso');
      const [neck] = named('spectatorNeck');
      const [head] = named('spectatorHead');
      assert.ok(neck && head, 'Each spectator has a neck bridging the head and torso');
      assert.ok(torso.mesh.position.y + torso.options.diameterY / 2 -
        (neck.mesh.position.y - neck.options.diameterY / 2) >= .01,
        'The neck sinks into the torso top');
      assert.ok(neck.mesh.position.y + neck.options.diameterY / 2 -
        (head.mesh.position.y - head.options.diameterY / 2) >= .01,
        'The head sits down onto the neck');
      const thighs = named('spectatorThigh');
      const shins = named('spectatorShin');
      const shoes = named('spectatorShoe');
      const arms = named('spectatorArm');
      const forearms = named('spectatorForearm');
      const shoulders = named('spectatorShoulder');
      assert.equal(thighs.length, 2);
      assert.ok(shins.length === 2 && shoes.length === 2 && arms.length === 2 &&
        forearms.length === 2 && shoulders.length === 2, 'Each spectator has both full limbs');
      for (const thigh of thighs) {
        const sideClearance = torso.options.diameterZ / 2 -
          (Math.abs(thigh.mesh.position.z - torso.mesh.position.z) + thigh.options.radius);
        assert.ok(sideClearance >= .0099, 'Thigh capsules stay inset at least 1 cm inside the torso silhouette');
        const verticalOverlap = torso.options.diameterY / 2 + thigh.options.radius -
          Math.abs(torso.mesh.position.y - thigh.mesh.position.y);
        const horizontalOverlap = torso.options.diameterX / 2 + thigh.options.height / 2 -
          Math.abs(torso.mesh.position.x - thigh.mesh.position.x);
        assert.ok(verticalOverlap > .08 && horizontalOverlap > .2,
          'Inset thighs still join the torso without an open waist seam on either sideline');
      }
      for (const shin of shins) {
        assert.ok(capsulesTouch(shin, nearest(shin, thighs)), 'Each shin meets its thigh at the knee');
      }
      for (const shoe of shoes) {
        assert.ok(sphereTouchesCapsule(shoe, nearest(shoe, shins)), 'Each shoe joins its shin at the ankle');
      }
      for (const arm of arms) {
        assert.ok(sphereTouchesCapsule(nearest(arm, shoulders), arm), 'Each arm hangs from its shoulder');
      }
      for (const forearm of forearms) {
        assert.ok(arms.some(arm => capsulesTouch(forearm, arm)), 'Each forearm starts at an elbow');
      }
    }
    if (previousFace) {
      assert.ok(previousFace.isDisposed(), 'Changing stadium level removes old signs');
      assert.equal(context.getHandMenuHit({ pickedMesh: previousFace }), null, 'Rebuild unregisters old actions');
    }
    assert.equal(faces().length, 38, 'Both sidelines have media controls, XR panels, and an audience scrimmage sign');
    for (const side of [-1, 1]) {
      const scrimmage = scene.getMeshByName(`stadiumMediaSignFace-${side}-runScrimmage`);
      assert.ok(scrimmage?.isEnabled(), 'Audience scrimmage signs are visible on desktop too');
      const action = context.getHandMenuHit({ pickedMesh: scrimmage });
      assert.equal(action.action, 'football');
      assert.equal(action.command, 'scrimmage');
      assert.equal(context.isMenuActionAvailable(action), true, 'Scrimmage is available on desktop');
      assert.equal(scrimmage.visibility, 1, 'Audience scrimmage sign text is fully opaque');
      assert.equal(scrimmage.parent.visibility, 1, 'Audience scrimmage sign backing is fully opaque');
      assert.equal(context.beginFloatingPanelGrab('left', Matrix.Identity(), scrimmage, undefined, .03, true),
        false, 'The audience holds the sign; it is not a floating grabbable panel');
      assert.equal(scrimmage.parent.parent.name, 'stands', 'Sign follows the stadium and tabletop transforms');
      const draftingSign = scene.getMeshByName(`stadiumMediaSignFace-${side}-panel-DRAFTING`);
      assert.ok(draftingSign, 'Both sidelines have a drafting entry sign');
      const draftingAction = context.getHandMenuHit({ pickedMesh: draftingSign });
      assert.equal(draftingAction.action, 'drawingTool');
      assert.equal(draftingAction.tool, 'table', 'Drafting sign enters drafting-table mode');
    }
    const signFace = faces().find(face => !face.name.includes('-panel-'));
    const sign = signFace.parent;
    const signParent = sign.parent;
    const signPose = Matrix.Compose(sign.scaling, sign.rotationQuaternion, sign.position);
    assert.equal(context.beginFloatingPanelGrab('left', Matrix.Identity(), signFace, undefined, .03, true), false);
    context.updateFloatingPanelGrab('left', Matrix.Translation(2, 1, -3));
    assert.equal(sign.parent, signParent, 'Signs remain locked to their stadium mount');
    context.recallFloatingPanels();
    assert.equal(sign.parent, signParent, 'Reset reattaches a sideline sign to its original mount');
    assert.ok(Matrix.Compose(sign.scaling, sign.rotationQuaternion, sign.position).equalsWithEpsilon(signPose, 1e-5),
      'Reset restores a sideline sign to its original local pose and size');
    assert.equal(context.isFloatingPanelGrabbed('left'), false, 'Reset releases held signs');
    for (const side of [-1, 1]) {
      const ordered = ['restart', 'rewind', 'stepBack', 'playPause', 'stepForward', 'fastForward', 'goToEnd']
        .map(action => scene.getMeshByName(`stadiumMediaSignFace-${side}-${action}`));
      const screenRightPositions = ordered.map(face => {
        face.computeWorldMatrix(true);
        return -side * face.getAbsolutePosition().z;
      });
      assert.ok(screenRightPositions.every((position, index) => index === 0 || position > screenRightPositions[index - 1]),
        'Both sidelines read Rewind to Fast-forward from left to right when viewed from the field');
    }
    assert.ok(crowd().length > 0 && crowd().length <= 10, 'Static crowd uses at most ten material batches');
    assert.ok(crowd().every(mesh => !mesh.isPickable), 'Spectators do not steal control or field picks');
    counts.push(crowd().reduce((total, mesh) => total + mesh.getTotalVertices(), 0));
    assert.ok(scene.meshes.length < 600, 'Merged crowd and framed signs keep a bounded mesh count');
    for (const face of faces()) {
      const immersive = face.name.includes('-panel-');
      assert.equal(face.isEnabled(), !immersive, 'Panel-launch signs are hidden outside immersive sessions');
    }
    context.setDrillEditingEnabled(true);
    context.setDraftingToolsEnabled(true);
    for (const face of faces()) {
      assert.equal(face.isEnabled(), true, 'All sign controls become visible in VR/AR');
      face.computeWorldMatrix(true);
      const normal = Vector3.TransformNormal(new Vector3(0, 0, -1), face.getWorldMatrix()).normalize();
      const center = face.getAbsolutePosition();
      assert.ok(normal.x * center.x < 0, 'Readable face points toward the field on both sidelines');
      const ray = new Ray(center.add(normal.scale(2)), normal.negate(), 5);
      const pick = context.pickMenuControl(ray);
      assert.ok(pick?.hit, `Sign is clickable: ${face.name}`);
      assert.deepEqual(context.getHandMenuHit(pick), context.getHandMenuHit({ pickedMesh: face }),
        'Sign face and backing share the registered action');
    }
    context.setDrillEditingEnabled(false);
    assert.ok(faces().filter(face => face.name.includes('-panel-')).every(face => !face.isEnabled()));
    previousFace = faces()[0];
  }
  assert.ok(counts[1] > counts[0] && counts[2] > counts[1], 'College and NFL stands have larger crowds and upper decks');
  assert.equal(counts[3], counts[0], 'Stadium rebuilds are deterministic');
  const playTexture = textures[3];
  const initialUpdates = playTexture.updates;
  playing = true; transport.notifyObservers({ playing });
  scene.onBeforeRenderObservable.notifyObservers(scene);
  const playFace = faces().find(face => face.name.endsWith('-playPause'));
  const visibleIcon = () => {
    const icons = playFace.getChildMeshes().filter(mesh => mesh.isEnabled());
    assert.equal(icons.length, 1, 'Each media sign displays a single 3D symbol');
    assert.equal(context.getHandMenuHit({ pickedMesh: icons[0] }).action, 'playPause');
    return icons[0];
  };
  assert.match(visibleIcon().name, /-pause$/, 'Play sign follows shared transport');
  assert.deepEqual(playTexture.ctx.labels, [], 'Media signs do not draw duplicate symbols or labels');
  transport.notifyObservers({ playing });
  assert.equal(playTexture.updates, initialUpdates + 1, 'Steady playback does not redraw the texture every frame');
  playing = false; transport.notifyObservers({ playing });
  scene.onBeforeRenderObservable.notifyObservers(scene);
  assert.match(visibleIcon().name, /-symbol$/);
  console.log('Stadium crowd checks passed: tier population, connected spectator joints in every pose, ten static batches, 38 clickable audience signs including Run Scrimmage, field-facing text, XR-only panel launchers, live Play/Pause, deterministic rebuild, and action cleanup.');
} finally {
  scene.dispose();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(transport.observers.length, 0, 'Disposal removes the sign transport observer');
  engine.dispose();
}
