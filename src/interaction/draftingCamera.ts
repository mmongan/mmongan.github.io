import { Camera } from '@babylonjs/core/Cameras/camera.pure';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode.pure';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.pure';
import { CreateScreenshotUsingRenderTarget } from '@babylonjs/core/Misc/screenshotTools';
import { scene } from '../scene/engine';
import { FIELD_LENGTH_YARDS, FIELD_WIDTH_YARDS, FIELD_SURFACE_Y } from '../field/constants';
import { parseDraftingWorkspace, serializeDraftingWorkspace, type DraftingWorkspace } from './draftingWorkspace';

export const DRAFTING_CAMERA_KEY = 'chartxr.draftingCamera.v1';

export interface DraftingPhoto {
  version: 1;
  capturedAt: string;
  image: string;
  workspace: string;
}

export function parseDraftingPhoto(json: string): DraftingPhoto {
  if (json.length > 12_000_000) throw new Error('Saved field snapshot is too large.');
  const value: unknown = JSON.parse(json);
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 ||
    !('capturedAt' in value) || typeof value.capturedAt !== 'string' || !Number.isFinite(Date.parse(value.capturedAt)) ||
    !('image' in value) || typeof value.image !== 'string' ||
    !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.image) ||
    !('workspace' in value) || typeof value.workspace !== 'string') {
    throw new Error('Invalid saved field snapshot.');
  }
  parseDraftingWorkspace(value.workspace);
  return { version: 1, capturedAt: value.capturedAt, image: value.image, workspace: value.workspace };
}

export async function captureDraftingPhoto(
  field: TransformNode, workspace: DraftingWorkspace, guides: AbstractMesh[]
): Promise<DraftingPhoto> {
  const serialized = serializeDraftingWorkspace(workspace);
  const world = field.computeWorldMatrix(true);
  const scale = Vector3.TransformNormal(Vector3.Up(), world).length();
  const target = Vector3.TransformCoordinates(new Vector3(0, FIELD_SURFACE_Y, 0), world);
  const up = Vector3.TransformNormal(Vector3.Up(), world).normalize();
  const camera = new FreeCamera('draftingSnapshotCamera', target.add(up.scale(90 * scale)), scene);
  try {
    camera.upVector = Vector3.TransformNormal(Vector3.Right(), world).normalize();
    camera.setTarget(target);
    camera.position.copyFrom(target.add(up.scale(90 * scale)));
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoLeft = -(FIELD_LENGTH_YARDS / 2 + 2) * scale;
    camera.orthoRight = (FIELD_LENGTH_YARDS / 2 + 2) * scale;
    camera.orthoTop = (FIELD_WIDTH_YARDS / 2 + 2) * scale;
    camera.orthoBottom = -(FIELD_WIDTH_YARDS / 2 + 2) * scale;
    camera.minZ = Math.max(0.0001, scale * 0.1);
    camera.maxZ = 180 * scale;
    const image = await new Promise<string>((resolve, reject) => {
      CreateScreenshotUsingRenderTarget(
        scene.getEngine(), camera, { width: 1240, height: Math.round((FIELD_WIDTH_YARDS + 4) * 10) },
        resolve, 'image/png', 1, false, undefined, false, false, true, undefined,
        texture => {
          texture.renderList = scene.meshes.filter(mesh => guides.includes(mesh) ||
            mesh.name === 'adjustableFieldGrid' ||
            /^(field$|turfStripe\d+$|leftEndZone$|rightEndZone$|leftSideline$|rightSideline$|goalLine|hashMark)/.test(mesh.name));
        },
        (width, height, data, callback, _mimeType, _fileName, invertY) => {
          try {
            if (data.byteLength !== width * height * 4) throw new Error('Unexpected field snapshot pixel format.');
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Field snapshots require a 2D canvas context.');
            const pixels = context.createImageData(width, height);
            const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
            const rowLength = width * 4;
            for (let row = 0; row < height; row++) {
              const offset = (invertY ? height - row - 1 : row) * rowLength;
              pixels.data.set(source.subarray(offset, offset + rowLength), row * rowLength);
            }
            context.putImageData(pixels, 0, 0);
            callback?.(canvas.toDataURL('image/png'));
          } catch (error) { reject(error); }
        },
        30000, () => reject(new Error('Field snapshot timed out. Please try again.'))
      );
    });
    return { version: 1, capturedAt: new Date().toISOString(), image, workspace: serialized };
  } finally {
    camera.dispose();
  }
}
