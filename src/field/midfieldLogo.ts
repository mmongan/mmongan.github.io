import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.pure';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.pure';
import { Color3 } from '@babylonjs/core/Maths/math.color.pure';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.pure';
import { scene } from '../scene/engine';
import { FIELD_SURFACE_Y } from './constants';

export const MIDFIELD_LOGO_WIDTH = 16;
export const MIDFIELD_LOGO_HEIGHT = 6;

export function drawMidfieldLogo(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.scale(width / 1024, height / 384);
  ctx.fillStyle = '#101d38';
  ctx.strokeStyle = '#ffcf40';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(70, 18);
  ctx.lineTo(954, 18);
  ctx.lineTo(1006, 192);
  ctx.lineTo(954, 366);
  ctx.lineTo(70, 366);
  ctx.lineTo(18, 192);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(120, 88);
  ctx.lineTo(904, 88);
  ctx.moveTo(120, 296);
  ctx.lineTo(904, 296);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 125px Arial';
  ctx.fillText('OpenChart', 443, 198, 720);
  ctx.fillStyle = '#ffcf40';
  ctx.font = 'bold 110px Arial';
  ctx.fillText('xr', 865, 198, 130);
  ctx.restore();
}

export function createMidfieldLogo() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('The midfield logo requires a 2D canvas context.');
  // Match the ground-marking UV orientation so lettering is not mirrored from above.
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  drawMidfieldLogo(ctx, canvas.width, canvas.height);
  const texture = new DynamicTexture('midfieldLogoTexture', canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  texture.anisotropicFilteringLevel = 8;
  texture.update(false);
  const material = new StandardMaterial('midfieldLogoMaterial', scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.disableLighting = true;
  const logo = MeshBuilder.CreateGround('midfieldLogo',
    { width: MIDFIELD_LOGO_WIDTH, height: MIDFIELD_LOGO_HEIGHT }, scene);
  logo.position.y = FIELD_SURFACE_Y + 0.012;
  logo.rotation.y = -Math.PI / 2;
  logo.material = material;
  logo.isPickable = false;
  let elapsed = 0;
  const fadeObserver = scene.onBeforeRenderObservable.add(() => {
    elapsed += scene.getEngine().getDeltaTime();
    material.alpha = 1 - Math.min(1, Math.max(0, elapsed - 5000) / 800);
    if (material.alpha === 0) scene.onBeforeRenderObservable.remove(fadeObserver);
  });
  scene.onDisposeObservable.addOnce(() => {
    scene.onBeforeRenderObservable.remove(fadeObserver);
    material.dispose(false, true);
  });
  return logo;
}
