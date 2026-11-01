// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { scene } from '../scene/engine';
import { getActiveControllers, setSceneManipulationLocked } from '../interaction/controllers';
import { getARScale, getARScaleRange } from '../xr/ar';
import {
  getDrillLastCountIndex, getGlobalCountIndex, getMarcherInstrument, getRobotCounts,
  isAnyPlaying, pauseAll, playAll, seekToCount,
} from '../robot/robot';

type GameCallbacks = {
  getSelected: () => TransformNode | null;
  startPOV: () => void;
  isPOVActive: () => boolean;
  isVRActive: () => boolean;
  status: (message: string) => void;
};

type DrumStick = { mesh: Mesh; grip: TransformNode };

const DRUM_INSTRUMENTS = new Set(['snare', 'tenors', 'bassDrum', 'glockenspiel', 'cymbals']);
const TARGET_HEIGHT_YARDS = 0.9;
const TARGET_RADIUS = 0.22;
const STICK_LENGTH = 0.34;
const HIT_COOLDOWN_MS = 250;

let callbacks: GameCallbacks | null = null;
let active = false;
let marcher: TransformNode | null = null;
let nextCount = 0;
let wasPlaying = false;
let targetRoot: TransformNode | null = null;
let targetHead: Mesh | null = null;
let targetMaterial: StandardMaterial | null = null;
let stickMaterial: StandardMaterial | null = null;
const sticks = new Map<string, DrumStick>();
let lastHitTime = 0;
let hitCount = 0;

function createTarget(parent: TransformNode) {
  targetRoot = new TransformNode('marcherDrumGameTarget', scene);
  targetRoot.parent = parent;
  targetMaterial = new StandardMaterial('marcherDrumGameTargetMaterial', scene);
  targetMaterial.diffuseColor = new Color3(0.08, 0.22, 0.34);
  targetMaterial.emissiveColor = new Color3(0.05, 0.45, 0.75);
  targetMaterial.specularColor = new Color3(0.75, 0.85, 0.95);
  const shell = MeshBuilder.CreateCylinder('marcherDrumGameTargetShell', {
    height: 0.14, diameter: TARGET_RADIUS * 2, tessellation: 16,
  }, scene);
  shell.parent = targetRoot;
  shell.rotation.x = Math.PI / 2;
  shell.material = targetMaterial;
  shell.isPickable = false;
  targetHead = MeshBuilder.CreateCylinder('marcherDrumGameTargetHead', {
    height: 0.018, diameter: TARGET_RADIUS * 1.7, tessellation: 20,
  }, scene);
  targetHead.parent = targetRoot;
  targetHead.rotation.x = Math.PI / 2;
  targetHead.position.z = -0.075;
  targetHead.material = targetMaterial;
  targetHead.isPickable = false;
}

function setTargetCount(countIndex: number) {
  if (!marcher || !targetRoot) return false;
  const count = getRobotCounts(marcher)?.[countIndex];
  if (!count) return false;
  targetRoot.position.set(count.position.x, count.position.y + TARGET_HEIGHT_YARDS, count.position.z);
  targetRoot.rotation.y = count.rotationY + Math.PI;
  targetRoot.setEnabled(true);
  return true;
}

function ensureStick(handedness: string, grip: TransformNode) {
  const existing = sticks.get(handedness);
  if (existing?.grip === grip) return existing;
  existing?.mesh.dispose();
  stickMaterial ??= new StandardMaterial('marcherDrumGameStickMaterial', scene);
  stickMaterial.diffuseColor = Color3.FromHexString('#d8ad67');
  stickMaterial.emissiveColor = Color3.FromHexString('#392511');
  stickMaterial.specularColor = Color3.FromHexString('#8f7655');
  const mesh = MeshBuilder.CreateCylinder(`marcherDrumGameStick-${handedness}`, {
    height: STICK_LENGTH, diameter: 0.012, tessellation: 8,
  }, scene);
  mesh.parent = grip;
  mesh.position.z = STICK_LENGTH / 2;
  mesh.rotation.x = Math.PI / 2;
  mesh.material = stickMaterial;
  mesh.isPickable = false;
  const stick = { mesh, grip };
  sticks.set(handedness, stick);
  return stick;
}

function clearSticks() {
  sticks.forEach(({ mesh }) => mesh.dispose());
  sticks.clear();
  stickMaterial?.dispose();
  stickMaterial = null;
}

function stopGame(message?: string) {
  if (!active) return;
  active = false;
  setSceneManipulationLocked(false);
  targetRoot?.dispose();
  targetRoot = null;
  targetHead = null;
  targetMaterial?.dispose();
  targetMaterial = null;
  clearSticks();
  if (wasPlaying) playAll();
  wasPlaying = false;
  marcher = null;
  if (message) callbacks?.status(message);
}

function hitTarget() {
  if (!marcher || !targetHead || !callbacks) return;
  hitCount++;
  seekToCount(nextCount);
  lastHitTime = performance.now();
  const next = nextCount + 1;
  if (next > getDrillLastCountIndex() || !setTargetCount(next)) {
    stopGame(`Drum game complete: ${hitCount} targets hit.`);
    return;
  }
  nextCount = next;
}

function update() {
  if (!active || !marcher || !callbacks) return;
  if (marcher.isDisposed() || !marcher.isEnabled() || callbacks.getSelected() !== marcher) {
    stopGame('Drum game stopped because the selected marcher changed.');
    return;
  }
  const controllers = getActiveControllers();
  const connected = new Set<string>();
  for (const [handedness, controller] of controllers) {
    const grip = controller.grip;
    if (!grip) continue;
    connected.add(handedness);
    ensureStick(handedness, grip);
  }
  for (const [handedness, stick] of sticks) {
    if (!connected.has(handedness)) {
      stick.mesh.dispose();
      sticks.delete(handedness);
    }
  }
  if (!targetRoot?.isEnabled() || performance.now() - lastHitTime < HIT_COOLDOWN_MS) return;
  targetRoot.computeWorldMatrix(true);
  const targetPosition = targetRoot.getAbsolutePosition();
  for (const { grip } of sticks.values()) {
    grip.computeWorldMatrix(true);
    const tip = Vector3.TransformCoordinates(new Vector3(0, 0, STICK_LENGTH), grip.getWorldMatrix());
    if (Vector3.DistanceSquared(tip, targetPosition) <= TARGET_RADIUS * TARGET_RADIUS) {
      hitTarget();
      return;
    }
  }
}

scene.onBeforeRenderObservable.add(update);
scene.onDisposeObservable.addOnce(() => {
  wasPlaying = false;
  stopGame();
});

export function initMarcherDrumGame(gameCallbacks: GameCallbacks) {
  callbacks = gameCallbacks;
}

export function isMarcherDrumGameActive() {
  return active;
}

export function stopMarcherDrumGame() {
  stopGame();
}

export function toggleMarcherDrumGame() {
  if (!callbacks) throw new Error('Marcher drum game has not been initialized.');
  if (active) {
    stopGame('Drum game stopped.');
    return;
  }
  const robot = callbacks.getSelected();
  if (!robot || robot.isDisposed() || !robot.isEnabled()) {
    callbacks.status('Select a visible percussion marcher to start Drum Game.');
    return;
  }
  if (!DRUM_INSTRUMENTS.has(getMarcherInstrument(robot) ?? '')) {
    callbacks.status('Select a snare, tenor, bass drum, glockenspiel, or cymbal marcher for Drum Game.');
    return;
  }
  if (!callbacks.isVRActive() || scene.activeCamera?.getClassName() !== 'WebXRCamera') {
    callbacks.status('Drum Game is available in immersive VR only.');
    return;
  }
  if (getARScale() < getARScaleRange().max) {
    callbacks.status('Set the field to Full scale before starting Drum Game.');
    return;
  }
  const counts = getRobotCounts(robot);
  const startCount = getGlobalCountIndex();
  const parent = robot.parent;
  if (!counts || startCount >= counts.length - 1 || !(parent instanceof TransformNode) || parent.isDisposed()) {
    callbacks.status('The selected percussion marcher has no remaining route.');
    return;
  }
  if (!callbacks.isPOVActive()) callbacks.startPOV();
  if (!callbacks.isPOVActive()) return;
  marcher = robot;
  nextCount = startCount + 1;
  hitCount = 0;
  lastHitTime = 0;
  wasPlaying = isAnyPlaying();
  active = true;
  pauseAll();
  createTarget(parent);
  if (!setTargetCount(nextCount)) {
    stopGame('The selected percussion marcher has no remaining route.');
    return;
  }
  setSceneManipulationLocked(true);
  callbacks.status('Drum Game: swing a virtual stick into the floating drum to march to the next count.');
}
