import * as THREE from 'three';
import { composeMatrix, MeshBuilder } from '../core/geometry';
import { Rng } from '../core/math';
import type { QualitySettings } from '../core/quality';
import type { HouseboatMaterials } from './houseboat';
import {
  BOULEVARD_X, CHAR_CHINAR, GHAT, HARI_PARBAT, lakeSdf, LOTUS_BED, NISHAT,
  nishatTerraceTop, terrainHeight,
} from './layout';
import type { TextureLibrary } from '../assets/textureLibrary';
import { buildFloatingGardens } from './gardens';
import { buildShikaraParts, partsToGroup, transformParts, type Part, type ShikaraMaterials } from './shikaraModel';
import type { FabricKey } from '../assets/textureLibrary';

export interface TreeSpot {
  x: number;
  z: number;
  y?: number;
  s: number;
}

export interface PropsResult {
  group: THREE.Group;
  lanterns: THREE.Vector3[];
  chinars: TreeSpot[];
  cypresses: TreeSpot[];
  willows: TreeSpot[];
}

const vegMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const stoneMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

export function buildProps(q: QualitySettings, mats: HouseboatMaterials, boatMats: ShikaraMaterials, lib: TextureLibrary): PropsResult {
  const group = new THREE.Group();
  group.name = 'props';
  const lanterns: THREE.Vector3[] = [];
  const chinars: TreeSpot[] = [];
  const cypresses: TreeSpot[] = [];
  const willows: TreeSpot[] = [];

  group.add(buildFloatingGardens(q, lib));
  group.add(buildLotus(q));
  group.add(buildCharChinar(chinars, lanterns));
  group.add(buildGhat(boatMats));
  group.add(buildBoulevard(lanterns, chinars));
  group.add(buildNishat(chinars, cypresses, lanterns));
  group.add(buildHariParbat());
  group.add(buildHouses(q, mats));
  return { group, lanterns, chinars, cypresses, willows };
}

// Nadru: lotus pads and blossoms in the southern shallows.
function buildLotus(q: QualitySettings): THREE.Object3D {
  const g = new THREE.Group();
  const rng = new Rng(91);
  const padCount = Math.round(420 * (q.tier === 'high' ? 1 : 0.55));
  const pads = new THREE.InstancedMesh(
    new THREE.CircleGeometry(1, 9, 0.35, Math.PI * 2 - 0.5).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }),
    padCount,
  );
  const flowers: THREE.Matrix4[] = [];
  let n = 0;
  for (let i = 0; i < padCount * 3 && n < padCount; i++) {
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * LOTUS_BED.r;
    const x = LOTUS_BED.x + Math.cos(a) * r * 1.3;
    const z = LOTUS_BED.z + Math.sin(a) * r * 0.8;
    if (lakeSdf(x, z) > -2) continue;
    const s = rng.range(0.35, 0.8);
    pads.setMatrixAt(n, composeMatrix(x, 0.05 + rng.next() * 0.02, z, 0, rng.next() * 6.3, 0, s, 1, s));
    pads.setColorAt(n, new THREE.Color().setHSL(0.22 + rng.range(-0.03, 0.04), 0.45, rng.range(0.25, 0.36)));
    if (rng.chance(0.14)) flowers.push(composeMatrix(x + 0.2, 0.35, z, 0, rng.next() * 6, 0, 1, rng.range(0.8, 1.2), 1));
    n++;
  }
  pads.count = n;
  pads.receiveShadow = true;
  g.add(pads);

  const fb = new MeshBuilder(92);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    fb.add(new THREE.ConeGeometry(0.09, 0.3, 4), k % 2 ? '#f4b6cc' : '#ec8fb2', composeMatrix(Math.cos(a) * 0.07, 0.1, Math.sin(a) * 0.07, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5));
  }
  fb.sphere(0.05, 0, 0, 0.06, 0, '#f5d547');
  fb.cyl(0.012, 0.012, 0.5, 4, 0, -0.2, 0, '#5d7a34');
  const flowerMesh = new THREE.InstancedMesh(fb.build(), vegMaterial(), flowers.length);
  flowers.forEach((m, i) => flowerMesh.setMatrixAt(i, m));
  g.add(flowerMesh);
  return g;
}

function buildCharChinar(chinars: TreeSpot[], lanterns: THREE.Vector3[]): THREE.Object3D {
  const b = new MeshBuilder(33, 0.1);
  const { x, z, r } = CHAR_CHINAR;
  b.cyl(r, r + 0.6, 1.6, 28, x, -0.1, z, '#8f8171');
  b.cyl(r - 0.5, r - 0.5, 0.12, 28, x, 0.74, z, '#6b8a3a');
  // Stone platform and steps down to a small landing.
  b.box(7, 0.5, 7, x, 0.95, z, '#a39584');
  b.box(5.5, 0.3, 5.5, x, 1.3, z, '#b3a590');
  for (let i = 0; i < 4; i++) b.box(4, 0.25, 1, x, 0.6 - i * 0.25, z + r + 0.2 + i * 0.9, '#9d8f7c');
  // Low parapet with gaps.
  for (let i = 0; i < 24; i++) {
    if (i % 6 === 0) continue;
    const a = (i / 24) * Math.PI * 2;
    b.box(3.6, 0.45, 0.4, x + Math.cos(a) * (r - 0.3), 0.98, z + Math.sin(a) * (r - 0.3), '#a39584', -a + Math.PI / 2);
  }
  // Iron lamp on the platform.
  b.cyl(0.06, 0.08, 2.6, 6, x + 2.2, 2.6, z + 2.2, '#2a2a2a');
  lanterns.push(new THREE.Vector3(x + 2.2, 4.0, z + 2.2));
  for (const [dx, dz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) chinars.push({ x: x + dx, z: z + dz, s: 1.35, y: 0.75 });
  const mesh = new THREE.Mesh(b.build(), stoneMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// Shikara stand at the Boulevard steps: painted boats moored side by side.
function buildGhat(boatMats: ShikaraMaterials): THREE.Object3D {
  const g = new THREE.Group();
  const stone = new MeshBuilder(55, 0.08);
  const len = GHAT.z1 - GHAT.z0;
  const zc = (GHAT.z0 + GHAT.z1) / 2;
  for (let i = 0; i < 5; i++) {
    stone.box(1.2, 0.3, len, BOULEVARD_X + 0.3 - i * 1.0, 1.1 - i * 0.35, zc, '#b1a38e');
  }
  const stoneMesh = new THREE.Mesh(stone.build(), stoneMaterial());
  stoneMesh.receiveShadow = true;
  g.add(stoneMesh);

  // Moored shikaras, merged by material into a handful of draw calls.
  const canopies: FabricKey[] = ['royal', 'crimson', 'emerald', 'saffron'];
  const tints = ['#7d5234', '#8c5e3c', '#6e472d'];
  const rng = new Rng(57);
  const parts: Part[] = [];
  let i = 0;
  for (let z = GHAT.z0 + 2; z < GHAT.z1 - 1; z += 3.4) {
    const spec = { length: 8.4, width: 1.45, canopy: canopies[i % canopies.length], boatman: false, flowers: false, seed: 200 + i, stations: 32, hullTint: tints[i % tints.length], detail: 'low' as const };
    i++;
    parts.push(...transformParts(buildShikaraParts(spec, boatMats), composeMatrix(BOULEVARD_X - 5.8, 0.02, z, 0, -Math.PI / 2 + rng.range(-0.04, 0.04))));
  }
  g.add(partsToGroup(parts));
  return g;
}

// Boulevard promenade: iron lamp posts every 24 m and a row of chinars.
function buildBoulevard(lanterns: THREE.Vector3[], chinars: TreeSpot[]): THREE.Object3D {
  const b = new MeshBuilder(66);
  for (let z = -226; z <= 182; z += 24) {
    const x = BOULEVARD_X + 2.2;
    b.box(0.35, 0.3, 0.35, x, 1.4, z, '#3a3a38');
    b.cyl(0.05, 0.08, 3.6, 6, x, 3.2, z, '#2e2e2c');
    b.box(0.3, 0.4, 0.3, x, 5.1, z, '#403a30');
    lanterns.push(new THREE.Vector3(x, 5.1, z));
  }
  for (let z = -214; z <= 176; z += 32) {
    if (z > NISHAT.z0 - 6 && z < NISHAT.z1 + 6) continue;
    chinars.push({ x: BOULEVARD_X + 12, z, s: 1.05 + ((z * 7) % 5) * 0.04 });
  }
  const mesh = new THREE.Mesh(b.build(), stoneMaterial());
  mesh.castShadow = true;
  return mesh;
}

// Nishat Bagh: stepped terraces, a central water channel and a pavilion at the top.
function buildNishat(chinars: TreeSpot[], cypresses: TreeSpot[], lanterns: THREE.Vector3[]): THREE.Object3D {
  const b = new MeshBuilder(88, 0.05);
  const { x0, x1, z0, z1, steps } = NISHAT;
  const stepLen = (x1 - x0) / steps;
  const zc = (z0 + z1) / 2;
  const width = z1 - z0;
  for (let i = 0; i < steps; i++) {
    const sx = x0 + i * stepLen;
    const top = nishatTerraceTop(sx + 0.1);
    const depth = top + 8;
    // Terrace lawn with retaining wall face.
    b.box(stepLen, depth, width, sx + stepLen / 2, top - depth / 2, zc, '#6f8f3e');
    b.box(0.6, depth + 0.05, width, sx + 0.3, top - depth / 2 + 0.03, zc, '#b09a7c');
    // Flower beds either side of the channel.
    b.box(stepLen * 0.7, 0.12, 3, sx + stepLen / 2, top + 0.06, zc - 7, i % 2 ? '#c2452d' : '#d9a03a');
    b.box(stepLen * 0.7, 0.12, 3, sx + stepLen / 2, top + 0.06, zc + 7, i % 2 ? '#d9a03a' : '#c2452d');
    // Central water channel and a cascade down each wall.
    b.box(stepLen, 0.1, 2.4, sx + stepLen / 2, top + 0.02, zc, '#9fb7c2');
    b.box(0.2, 5.2, 2.4, sx + 0.05, top - 2.6, zc, '#d7e3e6');
    for (let k = 1; k < 4; k++) b.cyl(0.08, 0.08, 0.5, 5, sx + (k / 4) * stepLen, top + 0.3, zc, '#e9f1f3');
    // Plane trees and cypress along the walks.
    chinars.push({ x: sx + stepLen / 2, z: z0 + 4, y: top, s: 1.1 });
    chinars.push({ x: sx + stepLen / 2, z: z1 - 4, y: top, s: 1.1 });
    for (let k = 0; k < 3; k++) {
      const cx = sx + ((k + 0.5) / 3) * stepLen;
      cypresses.push({ x: cx, z: zc - 3.6, y: top, s: 1 });
      cypresses.push({ x: cx, z: zc + 3.6, y: top, s: 1 });
    }
  }
  // Boundary walls.
  const topH = nishatTerraceTop(x1 - 1);
  for (const z of [z0, z1]) {
    for (let i = 0; i < steps; i++) {
      const sx = x0 + i * stepLen;
      const top = nishatTerraceTop(sx + 0.1);
      b.box(stepLen, 3, 0.8, sx + stepLen / 2, top + 1, z, '#b8a283');
    }
  }
  // Two-storey pavilion (baradari) at the top terrace.
  const px = x1 - stepLen / 2;
  b.box(9, 4.5, 11, px, topH + 2.25, zc, '#c8b494');
  b.box(10, 0.4, 12, px, topH + 4.7, zc, '#8a6a4a');
  b.box(7, 2.6, 8, px, topH + 6.2, zc, '#c8b494');
  b.add(new THREE.ConeGeometry(6.4, 2.6, 4), '#5a4a3c', composeMatrix(px, topH + 8.8, zc, 0, Math.PI / 4));
  for (let k = -2; k <= 2; k++) b.box(0.3, 2.8, 1.3, px - 4.55, topH + 1.6, zc + k * 2, '#3a2e24');
  lanterns.push(new THREE.Vector3(px - 5, topH + 3.6, zc));
  const mesh = new THREE.Mesh(b.build(), stoneMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

// The fort crowning Hari Parbat, seen as a silhouette against the sunset.
function buildHariParbat(): THREE.Object3D {
  const b = new MeshBuilder(99, 0.1);
  const { x, z } = HARI_PARBAT;
  const top = terrainHeight(x, z);
  const R = 34;
  const segs = 18;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    const mx = x + Math.cos((a0 + a1) / 2) * R;
    const mz = z + Math.sin((a0 + a1) / 2) * R * 0.7;
    const len = 2 * R * Math.sin(Math.PI / segs) * 1.05;
    const h = terrainHeight(mx, mz);
    b.box(len, 9, 2.4, mx, h + 3.5, mz, '#b39a72', -(a0 + a1) / 2 + Math.PI / 2);
    // Crenellations.
    for (let k = -1; k <= 1; k++) b.box(1.2, 1.4, 2.4, mx + Math.cos((a0 + a1) / 2 + Math.PI / 2) * k * 3, h + 8.6, mz + Math.sin((a0 + a1) / 2 + Math.PI / 2) * k * 3, '#a88f68');
  }
  for (const [dx, dz] of [[-R, 0], [R, 0], [0, -R * 0.7], [0, R * 0.7]]) {
    const h = terrainHeight(x + dx, z + dz);
    b.cyl(5, 5.6, 14, 8, x + dx, h + 6, z + dz, '#b39a72');
  }
  b.box(22, 10, 14, x - 4, top + 4, z, '#c0a57c');
  const mesh = new THREE.Mesh(b.build(), stoneMaterial());
  mesh.matrixAutoUpdate = false;
  return mesh;
}

// Kashmiri houses: brick and timber with steep tin roofs, on the shores and plain.
function buildHouses(q: QualitySettings, mats: HouseboatMaterials): THREE.Object3D {
  const g = new THREE.Group();
  const rng = new Rng(123);
  const walls = new MeshBuilder(124, 0.12);
  const windows = new MeshBuilder(125);
  const count = q.tier === 'high' ? 70 : 38;
  let placed = 0;
  for (let tries = 0; tries < 3000 && placed < count; tries++) {
    const a = rng.range(Math.PI * 0.35, Math.PI * 1.75);
    const r = rng.range(290, 620);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const d = lakeSdf(x, z);
    if (d < 22 || d > 260) continue;
    if (x > 200) continue;
    const h0 = terrainHeight(x, z);
    if (h0 > 30) continue;
    const w = rng.range(6, 10);
    const l = rng.range(7, 11);
    const floors = rng.int(2, 3);
    const hgt = floors * 2.9;
    const ry = rng.range(-0.3, 0.3) + (rng.chance(0.5) ? Math.PI / 2 : 0);
    const wall = rng.pick(['#8b5a3c', '#9a6448', '#c9b99a', '#b07a55', '#7f5a44']);
    const roof = rng.pick(['#3f5f55', '#6b6b6b', '#7a3b2e', '#4d5a6a']);
    walls.with(composeMatrix(x, h0, z, 0, ry), () => {
      walls.box(w, hgt, l, 0, hgt / 2 - 0.5, 0, wall);
      walls.box(w + 0.2, 0.25, l + 0.2, 0, 2.9 - 0.5, 0, '#5a4030');
      const pitch = 0.62;
      const half = w / 2 + 0.5;
      const slope = half / Math.cos(pitch);
      const rise = Math.tan(pitch) * half;
      walls.box(slope, 0.12, l + 1, -half / 2, hgt - 0.5 + rise / 2, 0, roof, 0, 0, pitch);
      walls.box(slope, 0.12, l + 1, half / 2, hgt - 0.5 + rise / 2, 0, roof, 0, 0, -pitch);
      for (const zz of [-l / 2 - 0.02, l / 2 + 0.02]) walls.tris([-w / 2, hgt - 0.5, zz, w / 2, hgt - 0.5, zz, 0, hgt - 0.5 + rise - 0.3, zz], wall);
      for (let f = 0; f < floors; f++) {
        for (const xx of [-w / 4, w / 4]) {
          windows.box(0.8, 1.0, 0.06, xx, 1.2 + f * 2.9, l / 2 + 0.03, '#ffffff');
        }
      }
    });
    placed++;
  }
  const wallMesh = new THREE.Mesh(walls.build(), stoneMaterial());
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  g.add(wallMesh, new THREE.Mesh(windows.build(), mats.windowDim));
  return g;
}
