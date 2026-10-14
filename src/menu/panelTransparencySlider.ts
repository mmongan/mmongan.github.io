import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { scene } from '../scene/engine';
import { drawPanelButton } from './panelStyle';

export class PanelTransparencySlider {
  readonly mesh;
  private texture: DynamicTexture;
  private context: CanvasRenderingContext2D;
  private transparency = 35;
  private dragStartY = 0;
  private dragStartTransparency = 35;

  constructor(
    parent: TransformNode,
    name: string,
    x: number,
    y: number,
    private height: number,
    width: number,
    private applyOpacity: (opacity: number) => void,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Panel transparency slider requires a 2D canvas context.');
    this.context = context;
    this.texture = new DynamicTexture(`${name}Texture`, canvas, scene, false);
    this.texture.hasAlpha = true;
    this.texture.getAlphaFromRGB = false;
    const material = new StandardMaterial(`${name}Material`, scene);
    material.diffuseTexture = this.texture;
    material.opacityTexture = this.texture;
    material.emissiveColor = Color3.White();
    material.disableLighting = true;
    this.mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
    this.mesh.parent = parent;
    this.mesh.position.set(x, y, -0.01);
    this.mesh.material = material;
    this.mesh.onDisposeObservable.addOnce(() => material.dispose(false, true));
    this.setTransparency(this.transparency);
  }

  hit(mesh: AbstractMesh | null | undefined, point?: Vector3) {
    if (mesh === this.mesh) return true;
    if (!point) return false;
    const local = Vector3.TransformCoordinates(point, this.mesh.computeWorldMatrix(true).clone().invert());
    const halfWidth = this.mesh.getBoundingInfo().boundingBox.extendSize.x;
    return Math.abs(local.x) <= halfWidth + 0.01 &&
      Math.abs(local.y) <= this.height / 2 && Math.abs(local.z) <= 0.06;
  }

  beginDrag(point: Vector3) {
    const local = Vector3.TransformCoordinates(point, this.mesh.computeWorldMatrix(true).clone().invert());
    this.dragStartY = local.y;
    this.dragStartTransparency = this.transparency;
  }

  setFromWorld(point: Vector3) {
    const local = Vector3.TransformCoordinates(point, this.mesh.computeWorldMatrix(true).clone().invert());
    this.setTransparency(this.dragStartTransparency + (local.y - this.dragStartY) / (this.height * 4) * 100);
  }

  setTransparency(value: number) {
    this.transparency = Math.round(Math.max(0, Math.min(100, value)));
    this.applyOpacity(1 - this.transparency / 100);
    const ctx = this.context;
    drawPanelButton(ctx, 256, 128, `${this.transparency}%`);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    for (const x of [20, 28, 36]) {
      ctx.beginPath();
      ctx.moveTo(x, 48);
      ctx.lineTo(x, 80);
      ctx.stroke();
    }
    this.texture.update(true);
  }
}
