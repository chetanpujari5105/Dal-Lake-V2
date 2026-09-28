import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TextureLibrary } from '../assets/textureLibrary';
import { Rng } from '../core/math';
import type { QualitySettings } from '../core/quality';
import { NO_REFLECT } from '../core/layers';
import { crossedCards, foliageMaterial, instancedCells, rosette, type Instance } from './foliage';
import { GARDEN_PLOTS, type GardenPlot } from './layout';

// Raad: floating beds of reed and lake weed. Each bed is an irregular, domed mat
// with a muddy skirt sloping under the water, planted in loose, uneven rows.

const RING_SCALES = [1.0, 0.86, 0.66, 0.42, 0.18];
const K = 56;

interface BedShape {
  plot: GardenPlot;
  radial: number[]; // per-angle outline factor
}

function outlinePoint(p: GardenPlot, radial: number[], k: number, scale: number): [number, number] {
  const a = (k / K) * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Rounded-rectangle superellipse, roughened per angle.
  const e = 2 / 2.7;
  const lz = Math.sign(s) * Math.pow(Math.abs(s), e) * (p.l / 2) * radial[k % K] * scale;
  // A gentle banana curve along the bed's length so no two read as rectangles.
  const lx = Math.sign(c) * Math.pow(Math.abs(c), e) * (p.w / 2) * radial[k % K] * scale + bedBend(p, lz);
  return [lx, lz];
}

function bedBend(p: GardenPlot, lz: number): number {
  return Math.sin((lz / (p.l / 2)) * Math.PI * 0.5 + p.x) * p.w * 0.12;
}

function toWorld(p: GardenPlot, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
}

function bedGeometry(shape: BedShape, rng: Rng): THREE.BufferGeometry {
  const { plot, radial } = shape;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Below and at the waterline the bed is weed-covered, olive rather than bare mud.
  const wet = [0.3, 0.33, 0.2];
  const edge = [0.72, 0.78, 0.5];
  const heart = [0.7, 0.8, 0.5];
  // Ring 0: skirt below the waterline; rings 1..: domed top; then the centre.
  const rings: { scale: number; y: number; c: number[] }[] = [
    { scale: 1.1, y: -0.45, c: wet },
    { scale: 1.02, y: -0.02, c: wet.map((v, i) => (v + edge[i]) / 2) },
  ];
  RING_SCALES.forEach((sc, i) => {
    const f = i / (RING_SCALES.length - 1);
    rings.push({ scale: sc, y: 0.1 + f * 0.13, c: edge.map((v, j) => v + (heart[j] - v) * Math.min(1, f * 1.6)) });
  });
  for (const r of rings) {
    for (let k = 0; k < K; k++) {
      const jitter = r.y > 0 ? rng.range(-0.025, 0.025) : rng.range(-0.05, 0.05);
      const [lx, lz] = outlinePoint(plot, radial, k, r.scale + (r.y < 0 ? rng.range(0, 0.05) : 0));
      const [x, z] = toWorld(plot, lx, lz);
      pos.push(x, r.y + jitter, z);
      col.push(...r.c.map((v) => v * rng.range(0.93, 1.05)));
      uv.push(x / 2.6, z / 2.6);
    }
  }
  const centre = rings.length * K;
  pos.push(plot.x, 0.26, plot.z);
  col.push(...heart);
  uv.push(plot.x / 2.6, plot.z / 2.6);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < K; k++) {
      const a = r * K + k;
      const b = r * K + ((k + 1) % K);
      const c = (r + 1) * K + k;
      const d = (r + 1) * K + ((k + 1) % K);
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = (rings.length - 1) * K;
  for (let k = 0; k < K; k++) idx.push(last + k, centre, last + ((k + 1) % K));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Approximate bed-surface height at a local point (0 = centre, 1 = edge). */
function bedHeight(radialFrac: number): number {
  return 0.1 + (1 - Math.min(1, radialFrac)) * 0.13;
}

export function buildFloatingGardens(q: QualitySettings, lib: TextureLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = 'floating-gardens';
  const rng = new Rng(78);
  const high = q.tier === 'high';

  const shapes: BedShape[] = GARDEN_PLOTS.map((plot) => {
    const phases = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
    const radial: number[] = [];
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      const n = 0.5 * Math.sin(a * 3 + phases[0]) + 0.3 * Math.sin(a * 7 + phases[1]) + 0.2 * Math.sin(a * 13 + phases[2]);
      radial.push(0.92 + 0.1 * n);
    }
    return { plot, radial };
  });

  const bedMat = new THREE.MeshStandardMaterial({
    map: lib.mud.map,
    normalMap: lib.mud.normalMap,
    vertexColors: true,
    roughness: 0.95,
    color: '#c9bea4',
  });
  const beds = new THREE.Mesh(mergeGeometries(shapes.map((s) => bedGeometry(s, rng)))!, bedMat);
  beds.receiveShadow = true;
  group.add(beds);

  const crops: Instance[] = [];
  const grass: Instance[] = [];
  const reeds: Instance[] = [];
  const gourds: Instance[] = [];
  const poles: THREE.BufferGeometry[] = [];
  const greens = ['#9cc46e', '#86b672', '#a9c95c', '#b6d36a', '#7fae69'].map((c) => new THREE.Color(c).multiplyScalar(1.3));
  // Tints above 1 lift the card texture so tufts stay green in low evening light.
  const grassTints = ['#d7e0a8', '#c7d69a', '#e3dfa0', '#bfcf8f'].map((c) => new THREE.Color(c).multiplyScalar(1.35));
  const gourdCols = ['#d9822b', '#e0a32e', '#c55a1e', '#b8a13a'].map((c) => new THREE.Color(c));

  for (const { plot, radial } of shapes) {
    const c = Math.cos(plot.rot);
    const s = Math.sin(plot.rot);
    const world = (lx: number, lz: number): [number, number] => [plot.x + lx * c + lz * s, plot.z - lx * s + lz * c];

    // Crops in loose rows along the bed, following its curve.
    const rows = Math.max(2, Math.floor((plot.w * 0.72) / 1.25));
    const step = high ? 0.75 : 1.2;
    for (let r = 0; r < rows; r++) {
      const fx = -0.8 + (1.6 * (r + 0.5)) / rows;
      for (let fz = -0.82; fz <= 0.82; fz += step / (plot.l / 2)) {
        if (rng.chance(0.18)) continue;
        const lz = (fz + rng.range(-0.03, 0.03)) * (plot.l / 2) * 0.9;
        const lx = (fx + rng.range(-0.05, 0.05)) * (plot.w / 2) * 0.95 + bedBend(plot, lz);
        const frac = Math.hypot(lx / (plot.w / 2), lz / (plot.l / 2));
        if (frac > 0.95) continue;
        const [x, z] = world(lx, lz);
        const sc = rng.range(0.75, 1.25);
        crops.push({ x, y: bedHeight(frac) - 0.02, z, sx: sc, sy: sc * rng.range(0.8, 1.15), ry: rng.next() * 6.3, color: rng.pick(greens) });
        if (rng.chance(0.08)) {
          const gs = rng.range(0.12, 0.2);
          gourds.push({ x: x + rng.range(-0.3, 0.3), y: bedHeight(frac) + gs * 0.55, z: z + rng.range(-0.3, 0.3), sx: gs, sy: gs * 0.75, ry: rng.next() * 6, color: rng.pick(gourdCols) });
        }
      }
    }

    // Ground cover: tufts of grass and weed between the rows.
    const cover = Math.round((plot.w * plot.l) / (high ? 0.8 : 2.0));
    for (let i = 0; i < cover; i++) {
      const u = rng.range(-1, 1);
      const v = rng.range(-1, 1);
      const frac = Math.hypot(u, v);
      if (frac > 1.0) continue;
      const lz = v * (plot.l / 2) * 0.95;
      const [x, z] = world(u * (plot.w / 2) * 0.95 + bedBend(plot, lz), lz);
      grass.push({ x, y: bedHeight(frac) - 0.03, z, sx: rng.range(0.8, 1.4), sy: rng.range(0.5, 0.95), ry: rng.next() * 6.3, color: rng.pick(grassTints) });
    }

    // Grass along the bed edge; reeds standing in the shallows around it.
    const edgeStep = high ? 1 : 2;
    for (let k = 0; k < K; k += edgeStep) {
      for (let j = 0; j < (high ? 3 : 2); j++) {
        const [lx, lz] = outlinePoint(plot, radial, k + rng.range(0, edgeStep), rng.range(0.92, 1.1));
        const [x, z] = world(lx, lz);
        const h = rng.range(0.6, 1.1);
        grass.push({ x, y: -0.05, z, sx: rng.range(1.1, 1.8), sy: h, ry: rng.next() * 6.3, color: rng.pick(grassTints), tilt: rng.range(-0.25, 0.25) });
      }
      if (rng.chance(0.45)) {
        const [lx, lz] = outlinePoint(plot, radial, k, rng.range(1.04, 1.12));
        const [x, z] = world(lx, lz);
        reeds.push({ x, y: -0.3, z, sx: rng.range(0.9, 1.3), sy: rng.range(0.9, 1.5), ry: rng.next() * 6.3, color: rng.pick(grassTints) });
      }
    }

    // Bamboo poles that moor the bed.
    for (let i = 0; i < 2; i++) {
      const [lx, lz] = outlinePoint(plot, radial, rng.int(0, K - 1), 1.0);
      const [x, z] = world(lx, lz);
      const h = rng.range(2.2, 3.0);
      poles.push(
        new THREE.CylinderGeometry(0.035, 0.045, h, 8)
          .rotateZ(rng.range(-0.12, 0.12))
          .translate(x, h / 2 - 0.4, z)
          .toNonIndexed(),
      );
    }
  }

  // Split into culled cells with draw distances: beyond these a tuft or a
  // collard is a pixel or two across. Grass and reeds skip the reflection pass.
  const a2c = q.tier === 'high';
  const k = q.tier === 'high' ? 1 : 0.7;
  group.add(
    instancedCells(rosette(7, 4), foliageMaterial(lib.leaf, 0.03, a2c), crops, { cell: 130, far: 300 * k, castShadow: true }),
    instancedCells(crossedCards(3), foliageMaterial(lib.grass, 0.07, a2c), grass, { cell: 130, far: 170 * k, layer: NO_REFLECT }),
    instancedCells(crossedCards(3), foliageMaterial(lib.reed, 0.09, a2c), reeds, { cell: 130, far: 260 * k }),
  );

  if (gourds.length) {
    group.add(instancedCells(new THREE.SphereGeometry(1, 9, 7), new THREE.MeshStandardMaterial({ roughness: 0.55 }), gourds, { cell: 130, far: 160 * k, castShadow: true }));
  }

  const poleMesh = new THREE.Mesh(
    mergeGeometries(poles)!,
    new THREE.MeshStandardMaterial({ color: '#b39862', roughness: 0.7 }),
  );
  poleMesh.castShadow = true;
  group.add(poleMesh);
  return group;
}
