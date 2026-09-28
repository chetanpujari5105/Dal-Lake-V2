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
import { brickTexture, lawnTexture, plasterTexture, triplanar } from '../assets/surfaces';
import { buildShikaraParts, partsToGroup, transformParts, type Part, type ShikaraMaterials } from './shikaraModel';
import type { FabricKey } from '../assets/textureLibrary';

export interface TreeSpot {
  x: number;
  z: number;
  y?: number;
  s: number;
}

export interface Lod {
  update(cam: THREE.Vector3): void;
}

export interface PropsResult {
  group: THREE.Group;
  /** Distance switches to run each frame. */
  lods: Lod[];
  lanterns: THREE.Vector3[];
  chinars: TreeSpot[];
  cypresses: TreeSpot[];
  willows: TreeSpot[];
}

const vegMaterial = () => new THREE.MeshLambertMaterial({ vertexColors: true });
let stoneTex: THREE.Texture | null = null;
/** Dressed stone: the CC0 boulder photo projected triplanar at about 1.8 m per tile. */
const stoneMaterial = () =>
  triplanar(new THREE.MeshStandardMaterial({ vertexColors: true, map: stoneTex, roughness: 0.92 }), 1.8, 'prop-stone', 1.55, 0.75);
let lawnTex: THREE.Texture | null = null;
const lawnMaterial = () => triplanar(new THREE.MeshStandardMaterial({ vertexColors: true, map: lawnTex, roughness: 0.95 }), 3, 'prop-lawn', 2.4, 0.7);

export function buildProps(q: QualitySettings, mats: HouseboatMaterials, boatMats: ShikaraMaterials, lib: TextureLibrary): PropsResult {
  const group = new THREE.Group();
  group.name = 'props';
  const lanterns: THREE.Vector3[] = [];
  const chinars: TreeSpot[] = [];
  const cypresses: TreeSpot[] = [];
  const willows: TreeSpot[] = [];
  stoneTex = lib.rock.map;
  lawnTex = lawnTexture();

  group.add(buildFloatingGardens(q, lib));
  group.add(buildLotus(q));
  group.add(buildCharChinar(chinars, lanterns));
  const lods: Lod[] = [];
  group.add(buildGhat(boatMats, lods));
  group.add(buildBoulevard(lanterns, chinars));
  group.add(buildNishat(chinars, cypresses, lanterns));
  group.add(buildHariParbat());
  group.add(buildHouses(q, mats));
  return { group, lods, lanterns, chinars, cypresses, willows };
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
// Near: the full low-detail boats. Far (beyond ~110 m): coarser hulls with the
// canopy, posts and valance only, merged into a handful of draw calls.
function buildGhat(boatMats: ShikaraMaterials, lods: Lod[]): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'ghat';
  const stone = new MeshBuilder(55, 0.08);
  const len = GHAT.z1 - GHAT.z0;
  const zc = (GHAT.z0 + GHAT.z1) / 2;
  for (let i = 0; i < 5; i++) {
    stone.box(1.2, 0.3, len, BOULEVARD_X + 0.3 - i * 1.0, 1.1 - i * 0.35, zc, '#b1a38e');
  }
  const stoneMesh = new THREE.Mesh(stone.build(), stoneMaterial());
  stoneMesh.receiveShadow = true;
  g.add(stoneMesh);

  const canopies: FabricKey[] = ['royal', 'crimson', 'emerald', 'saffron'];
  const tints = ['#7d5234', '#8c5e3c', '#6e472d'];
  const rng = new Rng(57);
  const near: Part[] = [];
  const far: Part[] = [];
  const skip = new Set<THREE.Material>([...boatMats.cushion, boatMats.carpet, boatMats.brass, ...Object.values(boatMats.fabric)]);
  let i = 0;
  for (let z = GHAT.z0 + 2; z < GHAT.z1 - 1; z += 3.4) {
    const base = { length: 8.4, width: 1.45, canopy: canopies[i % canopies.length], boatman: false, flowers: false, seed: 200 + i, hullTint: tints[i % tints.length], detail: 'low' as const };
    i++;
    const m = composeMatrix(BOULEVARD_X - 5.8, 0.02, z, 0, -Math.PI / 2 + rng.range(-0.04, 0.04));
    near.push(...transformParts(buildShikaraParts({ ...base, stations: 32 }, boatMats), m));
    const coarse = buildShikaraParts({ ...base, stations: 12 }, boatMats);
    // Keep the roof (the first fabric part); drop curtains, cushions and brass.
    let roofKept = false;
    const kept = coarse.filter((p) => {
      if (Object.values(boatMats.fabric).includes(p.material as THREE.MeshStandardMaterial)) {
        if (roofKept) return false;
        roofKept = true;
        return true;
      }
      return !skip.has(p.material);
    });
    far.push(...transformParts(kept, m));
  }
  const nearGroup = partsToGroup(near);
  const farGroup = partsToGroup(far, false);
  farGroup.visible = false;
  g.add(nearGroup, farGroup);
  const centre = new THREE.Vector3(BOULEVARD_X - 5.8, 0, zc);
  lods.push({
    update(cam) {
      const isNear = cam.distanceTo(centre) < 110;
      nearGroup.visible = isNear;
      farGroup.visible = !isNear;
    },
  });
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
  const lawn = new MeshBuilder(89, 0.06);
  const { x0, x1, z0, z1, steps } = NISHAT;
  const stepLen = (x1 - x0) / steps;
  const zc = (z0 + z1) / 2;
  const width = z1 - z0;
  for (let i = 0; i < steps; i++) {
    const sx = x0 + i * stepLen;
    const top = nishatTerraceTop(sx + 0.1);
    const depth = top + 8;
    // Terrace lawn with retaining wall face.
    lawn.box(stepLen, depth, width, sx + stepLen / 2, top - depth / 2, zc, '#7f9f4a');
    b.box(0.6, depth + 0.05, width, sx + 0.3, top - depth / 2 + 0.03, zc, '#b09a7c');
    // Flower beds either side of the channel.
    lawn.box(stepLen * 0.7, 0.18, 3, sx + stepLen / 2, top + 0.06, zc - 7, i % 2 ? '#d0553a' : '#e6b04a');
    lawn.box(stepLen * 0.7, 0.18, 3, sx + stepLen / 2, top + 0.06, zc + 7, i % 2 ? '#e6b04a' : '#d0553a');
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
  const g = new THREE.Group();
  const mesh = new THREE.Mesh(b.build(), stoneMaterial());
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const lawnMesh = new THREE.Mesh(lawn.build(), lawnMaterial());
  lawnMesh.receiveShadow = true;
  g.add(mesh, lawnMesh);
  return g;
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

// Kashmiri houses: brick with timber lacing, steep corrugated-tin roofs, a
// projecting wooden balcony (dub) on the upper floor, grouped into villages.
function buildHouses(q: QualitySettings, mats: HouseboatMaterials): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'houses';
  const rng = new Rng(123);
  const walls = new MeshBuilder(124, 0.1);
  const wood = new MeshBuilder(126, 0.08);
  const roofs = new MeshBuilder(127, 0.08);
  const windows = new MeshBuilder(125);
  const villages = q.tier === 'high' ? 16 : 10;
  const perVillage = q.tier === 'high' ? 6 : 4;
  let v = 0;
  for (let tries = 0; tries < 4000 && v < villages; tries++) {
    const a = rng.range(Math.PI * 0.35, Math.PI * 1.75);
    const r = rng.range(300, 640);
    const vx = Math.cos(a) * r;
    const vz = Math.sin(a) * r;
    const d0 = lakeSdf(vx, vz);
    if (d0 < 30 || d0 > 280 || vx > 200 || terrainHeight(vx, vz) > 24) continue;
    v++;
    const lane = rng.range(0, Math.PI);
    for (let k = 0; k < perVillage; k++) {
      const along = (k - perVillage / 2) * rng.range(11, 16);
      const x = vx + Math.cos(lane) * along + rng.range(-5, 5);
      const z = vz + Math.sin(lane) * along + rng.range(-5, 5);
      if (lakeSdf(x, z) < 22) continue;
      const h0 = terrainHeight(x, z);
      if (h0 > 30) continue;
      house(x, h0, z, lane + (rng.chance(0.5) ? Math.PI / 2 : 0) + rng.range(-0.12, 0.12));
    }
  }

  function house(x: number, h0: number, z: number, ry: number): void {
    const w = rng.range(7, 10);
    const l = rng.range(8, 12);
    const floors = rng.int(2, 3);
    const fh = 2.9;
    const hgt = floors * fh;
    const plaster = rng.chance(0.3);
    const wall = plaster ? rng.pick(['#efe7d8', '#e8dcc4', '#dfe3e0']) : rng.pick(['#f0e4dc', '#e8d8cc', '#f4ece4']);
    const roof = rng.pick(['#4f7560', '#6f7475', '#8e3c2e', '#5d6b7a', '#7b8a6a']);
    const timber = rng.pick(['#5a4030', '#4a3426', '#6a4a34']);
    const m = composeMatrix(x, h0, z, 0, ry);
    for (const b of [wood, roofs, windows]) b.push(m);
    walls.with(m, () => {
      walls.box(w, hgt + 0.6, l, 0, hgt / 2 - 0.3, 0, wall);
      // Stone plinth.
      walls.box(w + 0.3, 0.7, l + 0.3, 0, 0.05, 0, '#9d9384');
      for (let f = 1; f < floors; f++) wood.box(w + 0.16, 0.22, l + 0.16, 0, 0.3 + f * fh - 0.3, 0, timber);
      wood.box(w + 0.2, 0.26, l + 0.2, 0, hgt + 0.15, 0, timber);
      // Steep hipped-gable roof with deep eaves and an attic dormer.
      const pitch = 0.78;
      const half = w / 2 + 0.7;
      const slope = half / Math.cos(pitch);
      const rise = Math.tan(pitch) * half;
      const ry0 = hgt + 0.25;
      roofs.box(slope, 0.1, l + 1.4, -half / 2, ry0 + rise / 2, 0, roof, 0, 0, pitch);
      roofs.box(slope, 0.1, l + 1.4, half / 2, ry0 + rise / 2, 0, roof, 0, 0, -pitch);
      roofs.box(0.3, 0.16, l + 1.45, 0, ry0 + rise + 0.02, 0, roof);
      for (const zz of [-l / 2 - 0.02, l / 2 + 0.02]) {
        wood.tris([-w / 2 - 0.1, ry0, zz, w / 2 + 0.1, ry0, zz, 0, ry0 + rise - 0.25, zz], timber);
        wood.tris([w / 2 + 0.1, ry0, zz, -w / 2 - 0.1, ry0, zz, 0, ry0 + rise - 0.25, zz], timber);
        windows.box(0.9, 0.9, 0.06, 0, ry0 + rise * 0.35, zz + Math.sign(zz) * 0.02, '#ffffff');
      }
      // Windows with timber frames on every floor, both long faces.
      const cols = Math.max(2, Math.floor(l / 2.6));
      for (let f = 0; f < floors; f++) {
        for (let c = 0; c < cols; c++) {
          const wz = -l / 2 + ((c + 0.5) / cols) * l;
          for (const sx of [-1, 1]) {
            // Houses are seen from 250 m+, so a pane and a timber lintel are enough.
            windows.box(0.06, 1.1, 0.8, sx * (w / 2 + 0.03), 1.3 + f * fh, wz, '#ffffff');
            wood.box(0.1, 0.14, 1.1, sx * (w / 2 + 0.06), 1.95 + f * fh, wz, timber);
          }
        }
      }
      // Dub: a projecting wooden balcony with lattice on the top floor of one face.
      if (floors >= 2 && rng.chance(0.7)) {
        const by = (floors - 1) * fh + 0.4;
        const bl = l * 0.55;
        wood.box(1.1, 0.16, bl, w / 2 + 0.55, by, 0, timber);
        wood.box(1.1, 2.1, bl, w / 2 + 0.6, by + 1.15, 0, timber);
        windows.box(0.06, 1.0, bl * 0.8, w / 2 + 1.17, by + 1.35, 0, '#ffffff');
        for (let k = 0; k < 8; k++) {
          const zz = -bl * 0.4 + (k / 7) * bl * 0.8;
          wood.box(0.04, 1.0, 0.04, w / 2 + 1.2, by + 1.35, zz, '#d9c7a3', 0, 0.6);
          wood.box(0.04, 1.0, 0.04, w / 2 + 1.2, by + 1.35, zz, '#d9c7a3', 0, -0.6);
        }
        roofs.box(1.5, 0.08, bl + 0.4, w / 2 + 0.75, by + 2.35, 0, roof, 0, 0, -0.35);
      }
    });
    for (const b of [wood, roofs, windows]) b.pop();
  }

  const wallMat = triplanar(new THREE.MeshStandardMaterial({ vertexColors: true, map: brickTexture(), roughness: 0.9 }), 2.2, 'house-brick', 1.25, 1);
  const woodMat = triplanar(new THREE.MeshStandardMaterial({ vertexColors: true, map: plasterTexture(), roughness: 0.8 }), 1.5, 'house-wood', 1.1, 0.6);
  const wallMesh = new THREE.Mesh(walls.build(), wallMat);
  const woodMesh = new THREE.Mesh(wood.build(), woodMat);
  const roofMesh = new THREE.Mesh(roofs.build(), mats.roof);
  for (const m of [wallMesh, woodMesh, roofMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  g.add(wallMesh, woodMesh, roofMesh, new THREE.Mesh(windows.build(), mats.windowDim));
  return g;
}
