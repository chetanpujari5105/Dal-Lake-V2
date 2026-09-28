import * as THREE from 'three';
import { Rng, smoothstep, fbm } from '../core/math';
import type { QualitySettings } from '../core/quality';
import { BOULEVARD_X, lakeSdf, NISHAT, SHORE, terrainHeight } from './layout';
import type { TreeSpot } from './props';
import {
  buildSpecies, createCardAtlas, createImpostorAtlas, IMP_ASPECT, impostorGeometry, impostorMaterial,
  treeCardMaterial, type SpeciesId, type SpeciesModel,
} from './trees';

// Every tree exists twice: as a 3D leaf-card model (drawn only when near the
// camera and inside its view) and as a painted impostor (drawn otherwise). The
// swap happens per tree each frame, so off-screen foliage costs nothing and the
// whole distant forest is a single draw call.

const SPECIES: SpeciesId[] = ['chinar', 'poplar', 'willow', 'deodar', 'cypress', 'shrub', 'walnut'];

const TINTS: Record<SpeciesId, string[]> = {
  chinar: ['#8fae5c', '#9ab862', '#86a456', '#e0813f', '#d0643a', '#e8a64a', '#b9502f'],
  poplar: ['#aac86e', '#b9cf72', '#9fbf66', '#d8cf66'],
  willow: ['#bcd684', '#b0cc7a', '#c4d98a'],
  deodar: ['#6f8f63', '#67865d', '#7a9868', '#5f7d57'],
  cypress: ['#5d7d52', '#66875a'],
  shrub: ['#9cbd66', '#8fb05e', '#a9c46e', '#b8b45c'],
  walnut: ['#95b464', '#8aaa5c', '#a0bb68'],
};

interface Tree {
  sp: number;
  x: number;
  y: number;
  z: number;
  s: number;
  ry: number;
  color: THREE.Color;
}

export interface VegetationInput {
  chinars: TreeSpot[];
  cypresses: TreeSpot[];
  willows: TreeSpot[];
}

export class Forest {
  readonly group = new THREE.Group();
  private trees: Tree[] = [];
  private models: SpeciesModel[] = [];
  private near: THREE.InstancedMesh[] = [];
  private isNear!: Uint8Array;
  private matrices!: Float32Array;
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private nearR: number;

  constructor(q: QualitySettings, input: VegetationInput, renderer: THREE.WebGLRenderer) {
    this.group.name = 'forest';
    const high = q.tier === 'high';
    this.nearR = high ? 190 : 125;
    this.place(q, input);

    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const cardMat = treeCardMaterial(createCardAtlas(aniso), high);
    const impMat = impostorMaterial(createImpostorAtlas(aniso));

    const counts = SPECIES.map((_, i) => this.trees.filter((t) => t.sp === i).length);
    SPECIES.forEach((sp, i) => {
      const model = buildSpecies(sp, high ? 1 : 0.55, 900 + i);
      this.models.push(model);
      const mesh = new THREE.InstancedMesh(model.near, cardMat, Math.max(1, counts[i]));
      mesh.count = 0;
      mesh.frustumCulled = false; // culled per tree below
      mesh.castShadow = sp !== 'shrub' && sp !== 'deodar';
      mesh.receiveShadow = true;
      mesh.name = `trees-${sp}`;
      // Colour buffer must exist before the first compile.
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.near.push(mesh);
      this.group.add(mesh);
    });

    // Far impostors: every species shares one material, split into spatial cells
    // (each a contiguous run of the tree list) so cells off-screen are culled.
    const CELL = 700;
    const key = (t: Tree) => Math.floor(t.x / CELL) * 10000 + Math.floor(t.z / CELL);
    this.trees.sort((p, q) => key(p) - key(q));
    const n = this.trees.length;
    const base = impostorGeometry();
    this.matrices = new Float32Array(n * 16);
    this.farMatrices = new Float32Array(n * 16);
    this.cellOf = new Uint16Array(n);
    const m = new THREE.Matrix4();
    const q4 = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    this.trees.forEach((t, i) => {
      const model = this.models[t.sp];
      q4.setFromAxisAngle(_up, t.ry);
      m.compose(pos.set(t.x, t.y, t.z), q4, sc.setScalar(t.s));
      m.toArray(this.matrices, i * 16);
      // Impostor quads are 1 x IMP_ASPECT; scale them to the species' height.
      m.compose(pos, q4, sc.setScalar((model.height * t.s) / IMP_ASPECT));
      m.toArray(this.farMatrices, i * 16);
    });
    let start = 0;
    while (start < n) {
      let end = start + 1;
      while (end < n && key(this.trees[end]) === key(this.trees[start])) end++;
      const geo = new THREE.BufferGeometry();
      for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.getAttribute(name));
      geo.setIndex(base.index);
      const slots = new Float32Array(end - start);
      const mesh = new THREE.InstancedMesh(geo, impMat, end - start);
      for (let i = start; i < end; i++) {
        (mesh.instanceMatrix.array as Float32Array).set(this.farMatrices.subarray(i * 16, i * 16 + 16), (i - start) * 16);
        mesh.setColorAt(i - start, this.trees[i].color);
        slots[i - start] = this.models[this.trees[i].sp].slot;
        this.cellOf[i] = this.farCells.length;
      }
      geo.setAttribute('aSlot', new THREE.InstancedBufferAttribute(slots, 1));
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.name = 'trees-impostors';
      this.farCells.push({ mesh, start, lo: Infinity, hi: -1 });
      this.group.add(mesh);
      start = end;
    }
    this.isNear = new Uint8Array(n);
  }

  private farCells: { mesh: THREE.InstancedMesh; start: number; lo: number; hi: number }[] = [];
  private cellOf!: Uint16Array;
  private farMatrices!: Float32Array;

  get count(): number {
    return this.trees.length;
  }

  /** Swap trees between near models and impostors, and cull near trees to the view. */
  update(camera: THREE.PerspectiveCamera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    const nearIn = this.nearR * this.nearR;
    const nearOut = (this.nearR * 1.08) ** 2;
    const zero = this.zero.elements;
    for (const mesh of this.near) mesh.count = 0;

    for (let i = 0; i < this.trees.length; i++) {
      const t = this.trees[i];
      const dx = t.x - cx;
      const dz = t.z - cz;
      const d2 = dx * dx + dz * dz;
      const wasNear = this.isNear[i] === 1;
      const nowNear = wasNear ? d2 < nearOut : d2 < nearIn;
      if (nowNear !== wasNear) {
        this.isNear[i] = nowNear ? 1 : 0;
        const src = nowNear ? zero : this.farMatrices.subarray(i * 16, i * 16 + 16);
        const cell = this.farCells[this.cellOf[i]];
        const local = i - cell.start;
        (cell.mesh.instanceMatrix.array as Float32Array).set(src, local * 16);
        cell.lo = Math.min(cell.lo, local);
        cell.hi = Math.max(cell.hi, local);
      }
      if (!nowNear) continue;
      const model = this.models[t.sp];
      const r = model.radius * t.s;
      this.sphere.center.set(t.x, t.y + r * 0.8, t.z);
      this.sphere.radius = r;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const mesh = this.near[t.sp];
      const k = mesh.count++;
      (mesh.instanceMatrix.array as Float32Array).set(this.matrices.subarray(i * 16, i * 16 + 16), k * 16);
      t.color.toArray(mesh.instanceColor!.array, k * 3);
    }
    for (const mesh of this.near) {
      if (mesh.count === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
    for (const cell of this.farCells) {
      if (cell.hi < 0) continue;
      const attr = cell.mesh.instanceMatrix;
      attr.clearUpdateRanges();
      attr.addUpdateRange(cell.lo * 16, (cell.hi - cell.lo + 1) * 16);
      attr.needsUpdate = true;
      cell.lo = Infinity;
      cell.hi = -1;
    }
  }


  // -------------------------------------------------------------------------

  private add(sp: SpeciesId, x: number, z: number, s: number, rng: Rng, y?: number): void {
    const i = SPECIES.indexOf(sp);
    const color = new THREE.Color(rng.pick(TINTS[sp])).multiplyScalar(rng.range(0.9, 1.08));
    this.trees.push({ sp: i, x, z, y: y ?? terrainHeight(x, z) - 0.15, s, ry: rng.next() * Math.PI * 2, color });
  }

  private place(q: QualitySettings, input: VegetationInput): void {
    const rng = new Rng(2024);
    const n = (x: number) => Math.round(x * q.treeScale);
    const inNishat = (x: number, z: number) => x > NISHAT.x0 - 8 && x < NISHAT.x1 + 8 && z > NISHAT.z0 - 8 && z < NISHAT.z1 + 8;
    const onLand = (x: number, z: number, minSdf: number, maxH = 30) => {
      if (inNishat(x, z)) return false;
      return lakeSdf(x, z) > minSdf && terrainHeight(x, z) < maxH;
    };

    for (const s of input.chinars) this.add('chinar', s.x, s.z, s.s * rng.range(0.9, 1.1), rng, s.y);
    for (const s of input.cypresses) this.add('cypress', s.x, s.z, s.s * rng.range(0.92, 1.08), rng, s.y);
    for (const s of input.willows) this.add('willow', s.x, s.z, s.s, rng, s.y);

    // Poplars: the Boulevard row, avenues across the plain and scattered stands.
    for (let z = -236; z <= 190; z += 9) {
      if (inNishat(BOULEVARD_X + 20, z)) continue;
      this.add('poplar', BOULEVARD_X + 20 + rng.range(-1, 1), z, rng.range(0.85, 1.1), rng);
    }
    const avenues = Math.round(26 * q.treeScale + 6);
    for (let a = 0; a < avenues; a++) {
      const ang = rng.next() * Math.PI * 2;
      const r = rng.range(300, 640);
      let x = Math.cos(ang) * r;
      let z = Math.sin(ang) * r;
      const dir = rng.next() * Math.PI;
      const len = rng.int(6, 16);
      for (let i = 0; i < len; i++) {
        if (onLand(x, z, 12, 20)) this.add('poplar', x, z, rng.range(0.8, 1.15), rng);
        x += Math.cos(dir) * 7;
        z += Math.sin(dir) * 7;
      }
    }

    // Orchards and groves on the plain: clumps of walnut and chinar with poplar
    // accents, so the far shore reads as varied woodland rather than a picket fence.
    const groves = n(70);
    for (let g = 0, tries = 0; g < groves && tries < 3000; tries++) {
      const x = rng.range(-760, 560);
      const z = rng.range(-640, 640);
      if (!onLand(x, z, 18, 26)) continue;
      g++;
      const size = rng.int(4, 11);
      const kind = rng.next();
      for (let i = 0; i < size; i++) {
        const px = x + rng.range(-18, 18);
        const pz = z + rng.range(-18, 18);
        if (!onLand(px, pz, 12, 30)) continue;
        const sp: SpeciesId = kind < 0.45 ? 'walnut' : kind < 0.75 ? 'chinar' : rng.chance(0.5) ? 'poplar' : 'walnut';
        this.add(sp, px, pz, rng.range(0.75, 1.15), rng);
      }
    }

    // Chinars scattered near the shore.
    for (let i = 0, tries = 0; i < n(55) && tries < 4000; tries++) {
      const x = rng.range(-500, 500);
      const z = rng.range(-500, 500);
      if (onLand(x, z, 16, 30) && lakeSdf(x, z) < 120) {
        this.add('chinar', x, z, rng.range(0.8, 1.2), rng);
        i++;
      }
    }

    // The natural shoreline: willows leaning over the water, shrubs and young
    // trees in a loose band behind them, never evenly spaced.
    const stride = q.tier === 'high' ? 1 : 2;
    for (let i = 0; i < SHORE.length; i += stride) {
      const [sx, sz] = SHORE[i];
      if (sx > 190) continue;
      const len = Math.hypot(sx + 30, sz + 20) || 1;
      const nx = (sx + 30) / len;
      const nz = (sz + 20) / len;
      const cluster = fbm(sx * 0.02, sz * 0.02, 2);
      if (rng.chance(0.25 + cluster * 0.5)) {
        const off = rng.range(3.5, 9);
        const x = sx + nx * off;
        const z = sz + nz * off;
        if (lakeSdf(x, z) > 2) this.add('willow', x, z, rng.range(0.75, 1.15), rng);
      }
      const shrubs = rng.int(0, high(q) ? 3 : 2);
      for (let k = 0; k < shrubs; k++) {
        const off = rng.range(5, 22);
        const x = sx + nx * off + rng.range(-3, 3);
        const z = sz + nz * off + rng.range(-3, 3);
        if (lakeSdf(x, z) > 3 && terrainHeight(x, z) < 8) this.add('shrub', x, z, rng.range(0.7, 1.4), rng);
      }
      if (rng.chance(0.3)) {
        const off = rng.range(12, 30);
        const x = sx + nx * off;
        const z = sz + nz * off;
        if (lakeSdf(x, z) > 8) this.add(rng.chance(0.5) ? 'walnut' : 'chinar', x, z, rng.range(0.6, 0.95), rng);
      }
    }

    // Foothill forests: deodar, denser on the Zabarwan slopes behind the Boulevard,
    // with broadleaf trees mixed into the lower edge.
    for (let i = 0, tries = 0; i < n(9000) && tries < 160000; tries++) {
      const ang = rng.next() * Math.PI * 2;
      const r = rng.range(380, 1900);
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      const h = terrainHeight(x, z);
      if (h < 16 || h > 360 || inNishat(x, z)) continue;
      if (x < 0 && rng.chance(0.55)) continue;
      // Patchy stands: thin out where a low-frequency noise says "clearing".
      const patch = fbm(x * 0.004 + 7, z * 0.004 - 3, 3);
      if (rng.next() > smoothstep(0.3, 0.55, patch)) continue;
      const broad = h < 60 && rng.chance(0.35);
      this.add(broad ? (rng.chance(0.5) ? 'walnut' : 'chinar') : 'deodar', x, z, rng.range(1.0, 1.6) * (1 + r / 2000), rng, h - 0.5);
      i++;
    }
  }
}

const high = (q: QualitySettings) => q.tier === 'high';
const _up = new THREE.Vector3(0, 1, 0);
