import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.pure';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.pure';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.pure';
import { Mesh } from '@babylonjs/core/Meshes/mesh.pure';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Scene } from '@babylonjs/core/scene.pure';

// Shared builder for the marchers' low-poly instruments, tuned for standalone
// headsets such as Meta Quest: each instrument is one hand-indexed mesh with
// shared vertices, colored per vertex so it needs a single material, built
// once per scene and cloned per marcher (one draw call per instrument).
// Tube rings are framed around a side axis (X by default, projected
// perpendicular to the path), so tubes in planes of constant x never twist.

export const BRASS = new Color4(0.86, 0.63, 0.2, 1);
export const SILVER = new Color4(0.8, 0.81, 0.84, 1);
export const PEARL = new Color4(0.96, 0.94, 0.88, 1);
export const EBONY = new Color4(0.06, 0.06, 0.07, 1);

const SIDE_AXIS = new Vector3(1, 0, 0);

// "low" is used while the field is shrunk (Giant and tabletop modes), where
// marchers are only centimeters tall: tubes and caps become triangular,
// lathes about half as round, and fine() details are skipped.
export type ModelDetail = "high" | "low";
export type ModelTemplate = (scene: Scene, detail?: ModelDetail) => Mesh;
let buildDetail: ModelDetail = "high";

export class InstrumentGeometry {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  readonly indices: number[] = [];
  // Taken from the template being built (see cachedInstrumentTemplate).
  readonly low = buildDetail === "low";

  // Builds small details only at high detail.
  fine(build: () => void) {
    if (!this.low) build();
  }

  // Every tube ring is triangular at low detail, so neighbouring side counts
  // still divide and nested tubes keep a shared, coaxial orientation.
  private tubeSides(sides: number) {
    return this.low ? Math.min(sides, 3) : sides;
  }

  vertex(point: Vector3, color: Color4) {
    this.positions.push(point.x, point.y, point.z);
    this.colors.push(color.r, color.g, color.b, color.a);
    return this.positions.length / 3 - 1;
  }

  private quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d);
  }

  // Tube through `path` with `radii[i]` and `sides[i]` at each point; returns
  // ring start indices. Seam-free by construction:
  // - Bends are mitered: each inner ring lies on the bisector plane of its two
  //   segments, widened along the bend, so the tube keeps its full section
  //   through every corner instead of pinching.
  // - Neighbouring side counts must divide one another (e.g. 3 → 9); the
  //   finer ring shares the coarser ring's corner angles, so a pipe flows
  //   straight into a wider flare.
  // - Rings depend only on point, tangent, radius, and side count, so two
  //   tubes meeting end to end along the same tangent with the same section
  //   line up exactly.
  // - A path whose last point repeats its first is closed into a loop.
  // `sideAxis` must never be parallel to the path (default X, see above).
  tube(path: Vector3[], radii: number[] | number, sides: number[] | number, color: Color4,
    sideAxis = SIDE_AXIS): number[] {
    const closed = path.length > 3 && path[0].subtract(path[path.length - 1]).length() < 1e-6;
    const points = closed ? path.slice(0, -1) : path;
    const count = points.length;
    const sideCount = (index: number) => this.tubeSides(typeof sides === "number" ? sides : sides[index]);
    const rings = points.map((point, index) => {
      const previous = index > 0 ? points[index - 1] : closed ? points[count - 1] : null;
      const next = index < count - 1 ? points[index + 1] : closed ? points[0] : null;
      const incoming = previous ? point.subtract(previous).normalize() : null;
      const outgoing = next ? next.subtract(point).normalize() : null;
      const tangent = incoming && outgoing ? incoming.add(outgoing).normalize() : (incoming ?? outgoing)!;
      // Miter: stretch offsets along the bend by 1 / cos(half the bend angle).
      const bend = incoming && outgoing ? outgoing.subtract(incoming) : Vector3.Zero();
      const bendLength = bend.length();
      const miter = bendLength > 1e-6 ? 1 / Math.max(Vector3.Dot(incoming!, tangent), 0.5) - 1 : 0;
      const bendAxis = bendLength > 1e-6 ? bend.scale(1 / bendLength) : bend;
      const side = Vector3.Cross(Vector3.Cross(tangent, sideAxis), tangent).normalize();
      const across = Vector3.Cross(tangent, side).normalize();
      const radius = typeof radii === "number" ? radii : radii[index];
      const ringSides = sideCount(index);
      const start = this.positions.length / 3;
      for (let step = 0; step < ringSides; step++) {
        const angle = (step / ringSides) * Math.PI * 2;
        const offset = side.scale(Math.cos(angle)).add(across.scale(Math.sin(angle))).scale(radius);
        offset.addInPlace(bendAxis.scale(Vector3.Dot(offset, bendAxis) * miter));
        this.vertex(point.add(offset), color);
      }
      return start;
    });
    for (let ring = 0; ring < (closed ? count : count - 1); ring++) {
      const following = (ring + 1) % count;
      this.bridge(rings[ring], rings[following], sideCount(ring), sideCount(following));
    }
    return rings;
  }

  // Ring of `sides` vertices around `center`, in the plane perpendicular to `normal`.
  ring(center: Vector3, normal: Vector3, radius: number, sides: number, color: Color4): number {
    sides = this.tubeSides(sides);
    const axis = normal.normalizeToNew();
    const reference = Math.abs(axis.y) > 0.9 ? SIDE_AXIS : Vector3.Up();
    const u = Vector3.Cross(reference, axis).normalize();
    const v = Vector3.Cross(axis, u);
    const start = this.positions.length / 3;
    for (let side = 0; side < sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      this.vertex(center.add(u.scale(Math.cos(angle) * radius)).add(v.scale(Math.sin(angle) * radius)), color);
    }
    return start;
  }

  // Strip between two rings. Equal counts give quads; otherwise one count
  // must be a multiple of the other, and each coarse edge fans to the fine
  // vertices between its corners (vertex k·i of the fine ring sits on corner i).
  bridge(ringA: number, ringB: number, sidesA: number, sidesB = sidesA) {
    if (sidesA === sidesB) {
      for (let side = 0; side < sidesA; side++) {
        const next = (side + 1) % sidesA;
        this.quad(ringA + side, ringA + next, ringB + next, ringB + side);
      }
      return;
    }
    const coarse = Math.min(sidesA, sidesB);
    const fine = Math.max(sidesA, sidesB);
    const factor = fine / coarse;
    if (!Number.isInteger(factor)) throw new Error(`Tube ring sides ${sidesA} and ${sidesB} must divide evenly`);
    for (let corner = 0; corner < coarse; corner++) {
      const nextCorner = (corner + 1) % coarse;
      for (let step = 0; step < factor; step++) {
        const fineSide = corner * factor + step;
        const fineNext = (fineSide + 1) % fine;
        if (sidesA < sidesB) this.indices.push(ringA + corner, ringB + fineNext, ringB + fineSide);
        else this.indices.push(ringA + fineSide, ringA + fineNext, ringB + corner);
      }
      const fineCorner = (nextCorner * factor) % fine;
      if (sidesA < sidesB) this.indices.push(ringA + corner, ringA + nextCorner, ringB + fineCorner);
      else this.indices.push(ringA + fineCorner, ringB + nextCorner, ringB + corner);
    }
  }

  // Drum along `axis` from `center` (shell centre): shell plus a separately
  // colored head at the +axis end, and optionally at the -axis end too.
  drum(center: Vector3, axis: Vector3, radius: number, depth: number, sides: number,
    shell: Color4, head: Color4, bothHeads = false) {
    sides = this.tubeSides(sides);
    const half = axis.normalizeToNew().scale(depth / 2);
    const top = center.add(half);
    const bottom = center.subtract(half);
    this.bridge(this.ring(bottom, axis, radius, sides, shell), this.ring(top, axis, radius, sides, shell), sides);
    this.cap(this.ring(top, axis, radius, sides, head), sides, top, head);
    // The reversed normal flips the ring's handedness, so this head faces out too.
    if (bothHeads) this.cap(this.ring(bottom, axis.scale(-1), radius, sides, head), sides, bottom, head);
  }

  // Drumstick or mallet from the butt through the grip to the tip; an
  // optional box head (mallet felt) at the tip.
  stick(butt: Vector3, tip: Vector3, radius: number, color: Color4, headSize = 0, headColor = color) {
    const direction = tip.subtract(butt).normalize();
    const sideAxis = Math.abs(direction.y) > 0.9 ? SIDE_AXIS : Vector3.Up();
    this.tube([butt, tip], [radius, radius * 0.7], 3, color, sideAxis);
    if (headSize > 0) {
      const extent = new Vector3(headSize, headSize, headSize);
      this.box(tip.subtract(extent), tip.add(extent), headColor);
    }
  }

  // Close a ring with a fan to a single center vertex.
  // `sides` is the tube or ring's requested count (reduced like theirs).
  cap(ringStart: number, sides: number, center: Vector3, color: Color4) {
    sides = this.tubeSides(sides);
    const hub = this.vertex(center, color);
    for (let side = 0; side < sides; side++) {
      this.indices.push(ringStart + side, ringStart + ((side + 1) % sides), hub);
    }
  }

  box(cornerA: Vector3, cornerB: Vector3, color: Color4) {
    const min = Vector3.Minimize(cornerA, cornerB);
    const max = Vector3.Maximize(cornerA, cornerB);
    const start = this.positions.length / 3;
    for (const z of [min.z, max.z]) {
      for (const [x, y] of [[min.x, min.y], [max.x, min.y], [max.x, max.y], [min.x, max.y]]) {
        this.vertex(new Vector3(x, y, z), color);
      }
    }
    const [a, b, c, d, e, f, g, h] = Array.from({ length: 8 }, (_, index) => start + index);
    this.quad(a, b, c, d);
    this.quad(h, g, f, e);
    this.quad(a, e, f, b);
    this.quad(b, f, g, c);
    this.quad(c, g, h, d);
    this.quad(d, h, e, a);
  }

  // Surface of revolution around +Y through `profile` ([radius, y] pairs,
  // bottom to top). A zero radius is a single pole vertex; a nonzero first or
  // last ring is left open. `place` maps each point (e.g. to stretch it or
  // rotate the axis; it must be a proper rotation so faces stay outward).
  // At low detail it has about half the sides, turned half a step so a flat
  // face, not an edge, points forward.
  lathe(profile: Array<[number, number]>, sides: number, color: Color4,
    place: (point: Vector3) => Vector3 = (point) => point) {
    const turn = this.low ? 0.5 : 0;
    if (this.low) sides = Math.max(4, Math.ceil(sides / 2));
    let previous: { start: number; pole: boolean } | null = null;
    for (const [radius, y] of profile) {
      const pole = radius === 0;
      const start = this.positions.length / 3;
      for (let side = 0; side < (pole ? 1 : sides); side++) {
        const angle = ((side + turn) / sides) * Math.PI * 2;
        this.vertex(place(new Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius)), color);
      }
      if (previous) {
        for (let side = 0; side < sides; side++) {
          const next = (side + 1) % sides;
          if (previous.pole) this.indices.push(start + side, start + next, previous.start);
          else if (pole) this.indices.push(previous.start + next, previous.start + side, start);
          else this.quad(start + side, start + next, previous.start + next, previous.start + side);
        }
      }
      previous = { start, pole };
    }
  }

  // Appends `other` with every triangle given its own vertices, so computed
  // normals shade it flat while this geometry's shared vertices stay smooth.
  appendFlat(other: InstrumentGeometry) {
    for (const index of other.indices) {
      this.positions.push(...other.positions.slice(index * 3, index * 3 + 3));
      this.colors.push(...other.colors.slice(index * 4, index * 4 + 4));
      this.indices.push(this.positions.length / 3 - 1);
    }
  }
}

// Hidden, unpickable template mesh (smooth normals over shared vertices) to
// clone from; clones share its geometry.
export function buildLowPolyTemplate(name: string, geometry: InstrumentGeometry,
  material: StandardMaterial, scene: Scene): Mesh {
  const normals: number[] = [];
  VertexData.ComputeNormals(geometry.positions, geometry.indices, normals);
  const data = new VertexData();
  data.positions = geometry.positions;
  data.indices = geometry.indices;
  data.normals = normals;
  data.colors = geometry.colors;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  mesh.material = material;
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

const instrumentMaterials = new WeakMap<Scene, StandardMaterial>();

function getInstrumentMaterial(scene: Scene): StandardMaterial {
  let material = instrumentMaterials.get(scene);
  if (!material || material.getScene() !== scene) {
    material = new StandardMaterial("instrumentMaterial", scene);
    material.diffuseColor = Color3.White();
    material.specularColor = new Color3(0.9, 0.8, 0.5);
    material.specularPower = 48;
    // Tubes and bells are open shells; light both faces instead of adding caps.
    material.backFaceCulling = false;
    material.twoSidedLighting = true;
    instrumentMaterials.set(scene, material);
  }
  return material;
}

// Turns the geometry into a hidden, unpickable template mesh to clone from.
export function buildInstrumentTemplate(name: string, geometry: InstrumentGeometry, scene: Scene): Mesh {
  return buildLowPolyTemplate(name, geometry, getInstrumentMaterial(scene), scene);
}

// Caches one template per scene and detail level, rebuilding it if it was
// disposed; geometry built inside `build` uses the requested detail.
export function cachedInstrumentTemplate(build: (scene: Scene) => Mesh): ModelTemplate {
  const templates = { high: new WeakMap<Scene, Mesh>(), low: new WeakMap<Scene, Mesh>() };
  return (scene, detail = "high") => {
    let template = templates[detail].get(scene);
    if (!template || template.isDisposed()) {
      const previous = buildDetail;
      buildDetail = detail;
      try {
        template = build(scene);
      } finally {
        buildDetail = previous;
      }
      if (detail === "low") template.name += "Low";
      templates[detail].set(scene, template);
    }
    return template;
  };
}
