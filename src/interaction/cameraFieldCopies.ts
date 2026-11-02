// Copyright (C) 2026 Marty Mongan <marty.mongan@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { Matrix, Quaternion, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import type { Material } from '@babylonjs/core/Materials/material.pure';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { scene } from '../scene/engine';
import { FloatingPanel } from '../menu/floatingPanel';
import { drawPanelButton } from '../menu/panelStyle';
import { registerMenuButton, type HandMenuHit } from '../menu/handMenu';
import { isDraftingPreviewSource } from '../field/draftingFieldPreview';
import { FIELD_SURFACE_Y, FIELD_WIDTH_YARDS, FIELD_LENGTH_YARDS } from '../field/constants';
import { setCameraFieldEditingEnabled } from './editingMode';
import { getARPosition, getARRotation, getARScale, setARPosition, setARRotation, setARFieldCopyScale,
  getFieldHeightMode, setFieldHeightMode, preserveARSurfaceHeight } from '../xr/ar';

const PREFIX = 'cameraFieldCopy';
interface Copy<T> {
  id: number;
  state: T;
  root: TransformNode;
  visuals: AbstractMesh[];
  sources: Mesh[];
  materials: Material[];
  textures: BaseTexture[];
  panel: FloatingPanel;
  heightMode: ReturnType<typeof getFieldHeightMode>;
  original: boolean;
  setTime(label: string): void;
}

export function createCameraFieldCopies<T>(deps: {
  field: TransformNode;
  capture(): T;
  restore(state: T): void;
  allowed(): boolean;
  notify(message: string): void;
  timeLabel(): string;
  beforeCapture?(): void;
}) {
  const copies: Copy<T>[] = [];
  let active: Copy<T> | null = null;
  let nextId = 1;
  const clearVisuals = (copy: Copy<T>) => {
    copy.visuals.splice(0).forEach(mesh => mesh.dispose(false, false));
    copy.sources.splice(0).forEach(mesh => mesh.dispose(false, false));
    copy.materials.splice(0).forEach(material => material.dispose(false, false));
    copy.textures.splice(0).forEach(texture => texture.dispose());
  };
  function freeze(copy: Copy<T>) {
    const inverse = deps.field.computeWorldMatrix(true).clone().invert();
    const instanceSources = new Map<Mesh, Mesh>();
    const materials = new Map<Material, Material>();
    try {
      for (const source of [...scene.meshes]) {
        if (!isDraftingPreviewSource(source) || source.name.startsWith(PREFIX) ||
          !source.isEnabled() || !source.isVisible) continue;
        let visual: AbstractMesh;
        if (source instanceof InstancedMesh) {
          let template = instanceSources.get(source.sourceMesh);
          if (!template) {
            template = source.sourceMesh.clone(`${PREFIX}-template-${source.uniqueId}`, copy.root, true);
            template.makeGeometryUnique();
            template.isVisible = false;
            template.isPickable = false;
            copy.sources.push(template);
            instanceSources.set(source.sourceMesh, template);
            for (const key of Object.keys(source.instancedBuffers ?? {})) {
              const value: unknown = source.instancedBuffers[key];
              template.registerInstancedBuffer(key, typeof value === 'number' ? 1 : 4);
            }
          }
          const instance = template.createInstance(`${PREFIX}-marcher-${source.uniqueId}`);
          for (const key of Object.keys(source.instancedBuffers ?? {})) {
            const value: unknown = source.instancedBuffers[key];
            if (value instanceof Color4 || value instanceof Vector4) instance.instancedBuffers[key] = value.clone();
            else if (typeof value === 'number') instance.instancedBuffers[key] = value;
            else throw new Error(`Unsupported snapshot instance buffer: ${key}.`);
          }
          visual = instance;
        } else {
          const mesh = source.clone(`${PREFIX}-mesh-${source.uniqueId}`, copy.root, true);
          if (!mesh) throw new Error(`Could not copy ${source.name}.`);
          if (mesh instanceof Mesh) mesh.makeGeometryUnique();
          visual = mesh;
        }
        copy.visuals.push(visual);
        if (source.material) {
          let material = materials.get(source.material);
          if (!material) {
            material = source.material.clone(`${PREFIX}-material-${source.uniqueId}`) ?? undefined;
            if (!material) throw new Error(`Could not copy material for ${source.name}.`);
            materials.set(source.material, material);
            copy.materials.push(material);
            if (material instanceof StandardMaterial && source.material instanceof StandardMaterial) {
              const textures = new Map<BaseTexture, BaseTexture>();
              for (const slot of ['diffuseTexture', 'ambientTexture', 'opacityTexture', 'emissiveTexture',
                'specularTexture', 'bumpTexture', 'lightmapTexture', 'reflectionTexture', 'refractionTexture'] as const) {
                const texture = source.material[slot];
                if (!texture) continue;
                let clone = textures.get(texture);
                if (!clone) {
                  clone = material[slot] ?? undefined;
                  if (!clone || clone === texture) clone = texture.clone() ?? undefined;
                  if (!clone || clone === texture) throw new Error(`Could not copy texture for ${source.name}.`);
                  textures.set(texture, clone); copy.textures.push(clone);
                  if (texture instanceof DynamicTexture && clone instanceof DynamicTexture) {
                    clone.getContext().drawImage(texture.getContext().canvas, 0, 0);
                    clone.update(texture.invertY);
                  }
                }
                material[slot] = clone;
              }
            }
          }
          if (visual instanceof InstancedMesh) visual.sourceMesh.material = material;
          else visual.material = material;
        }
        visual.parent = copy.root;
        visual.isVisible = source.isVisible;
        visual.visibility = source.visibility;
        visual.layerMask = source.layerMask;
        if (visual instanceof InstancedMesh && source instanceof InstancedMesh) visual.sourceMesh.layerMask = source.sourceMesh.layerMask;
        visual.isPickable = false;
        visual.checkCollisions = false;
        visual.metadata = null;
        visual.actionManager = null;
        visual.skeleton = null;
        visual.morphTargetManager = null;
        visual.renderingGroupId = 0;
        const pose = source.computeWorldMatrix(true).multiply(inverse);
        visual.rotationQuaternion = Quaternion.Identity();
        pose.decompose(visual.scaling, visual.rotationQuaternion, visual.position);
      }
    } catch (error) {
      clearVisuals(copy);
      throw error;
    }
  }
  function rememberPose(copy: Copy<T>) {
    copy.root.position.copyFrom(getARPosition());
    copy.root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), getARRotation());
    copy.root.scaling.setAll(getARScale());
    copy.heightMode = getFieldHeightMode();
  }
  function makeCopy(state: T): Copy<T> {
    const id = nextId++;
    const root = new TransformNode(`${PREFIX}-${id}`, scene);
    root.rotationQuaternion = Quaternion.Identity();
    try {
      const meshes = new Set<AbstractMesh>();
      const buttons = new Map<AbstractMesh, HandMenuHit>();
      const material = new StandardMaterial(`${PREFIX}-controls-${id}`, scene);
      root.onDisposeObservable.addOnce(() => material.dispose());
      material.diffuseColor = new Color3(.04, .1, .16);
      const handle = MeshBuilder.CreateBox(`${PREFIX}-handle-${id}`,
        { width: FIELD_WIDTH_YARDS + 2, height: .6, depth: 2 }, scene);
      handle.parent = root;
      handle.position.set(0, FIELD_SURFACE_Y, -FIELD_LENGTH_YARDS / 2 - 3);
      handle.material = material;
      meshes.add(handle);
      for (const [index, label, command] of [
        [0, `Edit field ${id}`, `cameraFieldEdit:${id}`],
        [1, 'Delete copy', `cameraFieldDelete:${id}`],
        [2, '-', `cameraFieldSmaller:${id}`],
        [3, '+', `cameraFieldLarger:${id}`],
      ] as const) {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 128;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Camera copy controls require a canvas context.');
        drawPanelButton(context, 512, 128, label);
        const texture = new DynamicTexture(`${PREFIX}-label-${id}-${index}`, canvas, scene, false);
        texture.update();
        const buttonMaterial = new StandardMaterial(`${PREFIX}-button-${id}-${index}`, scene);
        buttonMaterial.diffuseTexture = texture;
        buttonMaterial.disableLighting = true;
        buttonMaterial.emissiveColor = Color3.White();
        buttonMaterial.backFaceCulling = false;
        const button = MeshBuilder.CreatePlane(`${PREFIX}-button-${id}-${index}`, { width: 10, height: 5 }, scene);
        button.parent = root;
        button.position.set(-18 + index * 12, FIELD_SURFACE_Y + .35, -FIELD_LENGTH_YARDS / 2 - 3);
        button.rotation.x = Math.PI / 2;
        button.material = buttonMaterial;
        const action: HandMenuHit = { action: 'drawingTool', tool: command };
        meshes.add(button); buttons.set(button, action); registerMenuButton(button, action);
        button.onDisposeObservable.addOnce(() => buttonMaterial.dispose(false, true));
      }
      const timeCanvas = document.createElement('canvas');
      timeCanvas.width = 1024; timeCanvas.height = 128;
      const timeContext = timeCanvas.getContext('2d');
      if (!timeContext) throw new Error('Camera copy labels require a canvas context.');
      const timeTexture = new DynamicTexture(`${PREFIX}-time-${id}`, timeCanvas, scene, false);
      const timeMaterial = new StandardMaterial(`${PREFIX}-time-${id}`, scene);
      timeMaterial.diffuseTexture = timeTexture;
      timeMaterial.disableLighting = true;
      timeMaterial.emissiveColor = Color3.White();
      timeMaterial.backFaceCulling = false;
      const timePlate = MeshBuilder.CreatePlane(`${PREFIX}-time-${id}`, { width: 40, height: 5 }, scene);
      timePlate.parent = root;
      timePlate.position.set(0, FIELD_SURFACE_Y + .35, -FIELD_LENGTH_YARDS / 2 - 9);
      timePlate.rotation.x = Math.PI / 2;
      timePlate.material = timeMaterial;
      timePlate.isPickable = false;
      timePlate.onDisposeObservable.addOnce(() => timeMaterial.dispose(false, true));
      let timeText = '';
      const setTime = (label: string) => {
        if (label === timeText) return;
        timeText = label;
        timeContext.clearRect(0, 0, 1024, 128);
        timeContext.fillStyle = '#18263b';
        timeContext.fillRect(0, 0, 1024, 128);
        timeContext.fillStyle = '#ffffff';
        timeContext.font = 'bold 54px Arial';
        timeContext.textAlign = 'center';
        timeContext.textBaseline = 'middle';
        timeContext.fillText(`Field ${id} · ${label}`, 512, 64, 1000);
        timeTexture.update();
      };
      class CopyPanel extends FloatingPanel {
        private held = new Set<string>();
        private resizeSurfaceY: number | null = null;
        override get hasPanelChrome() { return false; }
        override get canGrab() { return active?.id !== id && deps.allowed(); }
        override begin(source: string, world: Matrix) {
          if (!this.canGrab) { deps.notify('Release drawing tools before moving an inactive camera copy.'); return; }
          const surface = root.position.y + FIELD_SURFACE_Y * root.scaling.x;
          super.begin(source, world);
          if (this.grabbed(source)) this.held.add(source);
          if (this.held.size > 1 && this.resizeSurfaceY === null) this.resizeSurfaceY = surface;
        }
        override update(source: string, world: Matrix) {
          if (!this.grabbed(source)) return;
          super.update(source, world);
          root.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), root.rotationQuaternion!.toEulerAngles().y);
          if (this.resizeSurfaceY !== null) {
            root.position.y = this.resizeSurfaceY - FIELD_SURFACE_Y * root.scaling.x;
          }
        }
        override end(source: string) {
          super.end(source);
          this.held.delete(source);
          if (this.held.size < 2) this.resizeSurfaceY = null;
        }
        override release() {
          super.release();
          this.held.clear();
          this.resizeSurfaceY = null;
        }
      }
      const panel = new CopyPanel(root, meshes, handle, new Vector3(FIELD_WIDTH_YARDS / 2 + 1, .3, 1),
        buttons, {
          getScale: () => root.scaling.x,
          setScale: value => root.scaling.setAll(Math.max(.002, Math.min(1, value))),
        });
      return { id, state, root, visuals: [], sources: [], materials: [], textures: [], panel,
        heightMode: getFieldHeightMode(), original: false, setTime };
    } catch (error) {
      root.dispose();
      throw error;
    }
  }
  function capture() {
    if (!deps.allowed()) throw new Error('Release tools and finish calibration before taking a 3D snapshot.');
    if (copies.length >= 8) throw new Error('Camera copy limit reached (8); delete a copy first.');
    deps.beforeCapture?.();
    const state = deps.capture();
    const time = deps.timeLabel();
    let original: Copy<T> | null = null;
    let copy: Copy<T> | null = null;
    try {
      if (!active) {
        original = makeCopy(state);
        original.original = true;
        original.setTime(time);
        rememberPose(original);
      }
      copy = makeCopy(state);
      copy.setTime(time);
      rememberPose(copy);
      freeze(copy);
      const offset = Vector3.TransformNormal(new Vector3(FIELD_WIDTH_YARDS + 8, 0, 0),
        copy.root.computeWorldMatrix(true));
      copy.root.position.addInPlace(offset);
      if (original) { copies.push(original); active = original; }
      copies.push(copy);
      deps.notify(`3D field ${copy.id} captured. Grab its edge to move/resize; Edit field activates its own paused show.`);
    } catch (error) {
      if (copy) { clearVisuals(copy); copy.root.dispose(); }
      original?.root.dispose();
      throw error;
    }
  }
  function edit(id: number) {
    const target = copies.find(copy => copy.id === id);
    if (!target) throw new Error('This camera field copy no longer exists.');
    if (target === active) { deps.notify(`Field ${id} is already active.`); return; }
    if (!deps.allowed() || copies.some(copy => copy.panel.grabbed())) {
      throw new Error('Release field copies and tools before switching the active field.');
    }
    if (!active) throw new Error('Capture a field before selecting a copy.');
    const previous = active;
    const state = deps.capture();
    previous.setTime(deps.timeLabel());
    rememberPose(previous);
    freeze(previous);
    try {
      deps.restore(target.state);
    } catch (error) {
      try { deps.restore(state); }
      finally { clearVisuals(previous); }
      throw error;
    }
    previous.state = state;
    active = target;
    setCameraFieldEditingEnabled(!target.original);
    clearVisuals(target);
    const height = target.root.position.y + FIELD_SURFACE_Y * target.root.scaling.x;
    setARFieldCopyScale(target.root.scaling.x);
    setFieldHeightMode(target.heightMode);
    setARRotation(target.root.rotationQuaternion?.toEulerAngles().y ?? 0);
    setARPosition(target.root.position);
    preserveARSurfaceHeight(height);
    deps.notify(`Field ${id} active. Editing and playback now affect only this field; the previous field is paused.`);
  }
  const observer = scene.onBeforeRenderObservable.add(() => {
    if (!active) return;
    rememberPose(active);
    active.setTime(deps.timeLabel());
  });
  return {
    capture, edit,
    resize(id: number, ratio: number) {
      const copy = copies.find(copy => copy.id === id);
      if (!copy) throw new Error('This camera field copy no longer exists.');
      if (copy === active) throw new Error('Resize the active field with its normal field controls.');
      if (!deps.allowed() || copy.panel.grabbed()) throw new Error('Release tools and the copy before resizing it.');
      const surface = copy.root.position.y + FIELD_SURFACE_Y * copy.root.scaling.x;
      copy.root.scaling.setAll(Math.max(.002, Math.min(1, copy.root.scaling.x * ratio)));
      copy.root.position.y = surface - FIELD_SURFACE_Y * copy.root.scaling.x;
    },
    delete(id: number) {
      const copy = copies.find(copy => copy.id === id);
      if (!copy) throw new Error('This camera field copy no longer exists.');
      if (copy === active) throw new Error('Select another field before deleting the active field.');
      if (!deps.allowed() || copy.panel.grabbed()) throw new Error('Release tools and the copy before deleting it.');
      clearVisuals(copy); copy.root.dispose();
      copies.splice(copies.indexOf(copy), 1);
      deps.notify(`Camera field ${id} deleted.`);
    },
    dispose() {
      setCameraFieldEditingEnabled(false);
      scene.onBeforeRenderObservable.remove(observer);
      copies.splice(0).forEach(copy => { clearVisuals(copy); copy.root.dispose(); });
    },
  };
}
