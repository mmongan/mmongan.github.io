import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { Scene } from '@babylonjs/core/scene.pure';
import { buildInstrumentTemplate, cachedInstrumentTemplate, EBONY, InstrumentGeometry, SILVER } from './lowPolyInstrument';

// B-flat clarinet in the same shared-mesh style as the trumpet.
// Model units ≈ meters. Local axes: +Y toward the mouthpiece (tip at
// CLARINET_MOUTHPIECE_TIP), -Y toward the bell, +Z the front (tone holes
// and keys), X across.
export const CLARINET_MOUTHPIECE_TIP = new Vector3(0, 0.3, 0);

const GRENADILLA = EBONY;

function createClarinetTemplate(scene: Scene): Mesh {
  const geometry = new InstrumentGeometry("instrument");

  // Mouthpiece beak, barrel, upper/lower joints, and flared bell as one
  // rounded tube with a more finely tessellated bell.
  const [tip] = geometry.tube([
    CLARINET_MOUTHPIECE_TIP,
    new Vector3(0, 0.24, 0),
    new Vector3(0, 0.238, 0),
    new Vector3(0, 0.225, 0),
    new Vector3(0, 0.17, 0),
    new Vector3(0, 0.155, 0),
    new Vector3(0, -0.2, 0),
    new Vector3(0, -0.28, 0),
    new Vector3(0, -0.33, 0),
  ], [0.006, 0.011, 0.012, 0.016, 0.016, 0.0135, 0.0135, 0.024, 0.042], [6, 6, 6, 6, 6, 6, 6, 12, 12], GRENADILLA);
  geometry.cap(tip, 6, CLARINET_MOUTHPIECE_TIP.add(new Vector3(0, 0.004, 0)), GRENADILLA);

  // Silver ligature (8) and upper/lower key clusters on the front (16),
  // skipped at low detail.
  geometry.fine(() => {
    geometry.box(new Vector3(-0.012, 0.25, -0.012), new Vector3(0.012, 0.262, 0.012), SILVER);
    geometry.box(new Vector3(-0.008, 0.06, 0.01), new Vector3(0.008, 0.15, 0.018), SILVER);
    geometry.box(new Vector3(-0.008, -0.16, 0.01), new Vector3(0.008, -0.04, 0.018), SILVER);
  });

  return buildInstrumentTemplate("clarinetTemplate", geometry, scene);
}

// Shared, hidden source mesh; clone it (clones share geometry and material).
export const getClarinetTemplate = cachedInstrumentTemplate(createClarinetTemplate);
