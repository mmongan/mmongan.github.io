import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Matrix, Vector4 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene.pure';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

export const JACKET_LEG_CLIP_HEIGHT = 0.69;
const ATTRIBUTE = 'jacketLegPlane';
const planes = new WeakMap<Mesh | InstancedMesh, Vector4>();
const disabledPlane = new Vector4(0, 0, 0, -1);
const inverseBody = Matrix.Identity();
const localToBody = Matrix.Identity();

export function updateJacketLegPlane(mesh: Mesh | InstancedMesh, body: TransformNode) {
  body.computeWorldMatrix().invertToRef(inverseBody);
  updatePlane(mesh);
}

export function updateJacketLegPlanes(meshes: ReadonlyArray<Mesh | InstancedMesh>, body: TransformNode) {
  body.computeWorldMatrix().invertToRef(inverseBody);
  for (const mesh of meshes) updatePlane(mesh);
}

function updatePlane(mesh: Mesh | InstancedMesh) {
  mesh.computeWorldMatrix().multiplyToRef(inverseBody, localToBody);
  const m = localToBody.m;
  let plane = planes.get(mesh);
  if (!plane) {
    plane = new Vector4(0, 0, 0, -1);
    planes.set(mesh, plane);
  }
  plane.set(m[1], m[5], m[9], m[13] - JACKET_LEG_CLIP_HEIGHT);
  if (mesh instanceof InstancedMesh) mesh.instancedBuffers[ATTRIBUTE] = plane;
}

export function registerJacketLegSource(source: Mesh) {
  source.registerInstancedBuffer(ATTRIBUTE, 4);
  source.instancedBuffers[ATTRIBUTE] = new Vector4(0, 0, 0, -1);
}

export class JacketLegOcclusion extends MaterialPluginBase {
  constructor(material: StandardMaterial) {
    super(material, 'JacketLegOcclusion', 200, {}, true, true);
    this.registerForExtraEvents = true;
  }

  getAttributes(attributes: string[]) {
    attributes.push(ATTRIBUTE);
  }

  getUniforms() {
    return { ubo: [{ name: 'jacketLegUniform', size: 4, type: 'vec4' }] };
  }

  hardBindForSubMesh(buffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, subMesh: SubMesh) {
    const plane = planes.get(subMesh.getRenderingMesh()) ?? disabledPlane;
    buffer.updateFloat4('jacketLegUniform', plane.x, plane.y, plane.z, plane.w);
  }

  getCustomCode(shaderType: string): Record<string, string> {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
          #ifdef INSTANCES
          attribute vec4 jacketLegPlane;
          #endif
          varying float jacketLegDistance;
        `,
        CUSTOM_VERTEX_MAIN_END: `
          #ifdef INSTANCES
          jacketLegDistance = dot(vec4(positionUpdated, 1.0), jacketLegPlane);
          #else
          jacketLegDistance = dot(vec4(positionUpdated, 1.0), jacketLegUniform);
          #endif
        `,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: 'varying float jacketLegDistance;',
      CUSTOM_FRAGMENT_MAIN_BEGIN: 'if (jacketLegDistance > 0.0) discard;',
    };
  }
}
