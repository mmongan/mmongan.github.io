import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildInstrumentTemplate, cachedInstrumentTemplate, EBONY, InstrumentGeometry, SILVER } from './lowPolyInstrument';

// Minimal concert flute in the same Quest-friendly style as the trumpet:
// one hand-indexed mesh of under 100 shared vertices (see lowPolyInstrument.ts).
// Model units ≈ meters. Local axes: +Y toward the head-joint crown, -Y toward
// the foot, +Z the front (lip plate and keys), +X the player's side of the
// tube. The origin is the embouchure hole; FLUTE_MOUTHPIECE_TIP is the point
// just behind and above it where the lips rest.
export const FLUTE_MOUTHPIECE_TIP = new Vector3(0.012, 0, 0.012);

function createFluteTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Head joint and body as one hexagonal tube, capped at the crown (25).
  const [crown] = geometry.tube([
    new Vector3(0, 0.065, 0),
    new Vector3(0, -0.12, 0),
    new Vector3(0, -0.135, 0),
    new Vector3(0, -0.6, 0),
  ], [0.0105, 0.0105, 0.0095, 0.0095], 6, SILVER);
  geometry.cap(crown, 6, new Vector3(0, 0.07, 0), SILVER);

  // Lip plate (8), then its dark embouchure hole and the body and foot-joint
  // key rows on the front (24), skipped at low detail.
  geometry.box(new Vector3(-0.01, -0.015, 0.008), new Vector3(0.014, 0.015, 0.013), SILVER);
  geometry.fine(() => {
    geometry.box(new Vector3(-0.001, -0.005, 0.013), new Vector3(0.007, 0.005, 0.0135), EBONY);
    geometry.box(new Vector3(-0.007, -0.47, 0.008), new Vector3(0.007, -0.17, 0.016), SILVER);
    geometry.box(new Vector3(-0.007, -0.585, 0.008), new Vector3(0.007, -0.5, 0.016), SILVER);
  });

  return buildInstrumentTemplate("fluteTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getFluteTemplate = cachedInstrumentTemplate(createFluteTemplate);
