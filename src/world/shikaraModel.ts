import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { FabricKey, PBRSet, TextureLibrary } from '../assets/textureLibrary';
import { Rng } from '../core/math';

// A detailed, smoothly shaded shikara built from lofted and lathed geometry.
// Local frame: +z is the bow, +y up, +x is port. Units are metres.

export interface ShikaraSpec {
  length: number;
  width: number;
  canopy: FabricKey | null;
  boatman: boolean;
  flowers: boolean;
  seed: number;
  /** Stations along the hull; lower for boats that are only seen from afar. */
  stations?: number;
  hullTint?: string;
  /** 'low' trims tessellation and small trims for boats seen from a distance. */
  detail?: 'high' | 'low';
}

export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export interface ShikaraMaterials {
  hull: (tint: string) => THREE.MeshStandardMaterial;
  deck: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  fabric: Record<FabricKey, THREE.MeshStandardMaterial>;
  valance: Record<FabricKey, THREE.MeshStandardMaterial>;
  cushion: THREE.MeshStandardMaterial[];
  carpet: THREE.MeshStandardMaterial;
  robe: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  cap: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  paddle: THREE.MeshStandardMaterial;
  flowers: THREE.MeshStandardMaterial;
  wicker: THREE.MeshStandardMaterial;
}

function pbr(set: PBRSet, color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    roughness,
    metalness: 0,
    ...extra,
  });
}

/**
 * The CC0 plank photos are dark (average linear reflectance ~0.12 for Dark Planks),
 * so a plain tint multiplies them down to near-black. Scaling the tint above 1
 * brings the result to varnished-walnut albedo (~0.18, 0.08, 0.02).
 */
const WOOD_GAIN = 2.6;

function gain(m: THREE.MeshStandardMaterial, k: number): THREE.MeshStandardMaterial {
  m.color.multiplyScalar(k);
  return m;
}

export function createShikaraMaterials(lib: TextureLibrary): ShikaraMaterials {
  const hullCache = new Map<string, THREE.MeshStandardMaterial>();
  const fabric = {} as Record<FabricKey, THREE.MeshStandardMaterial>;
  const valance = {} as Record<FabricKey, THREE.MeshStandardMaterial>;
  for (const k of Object.keys(lib.fabric) as FabricKey[]) {
    fabric[k] = new THREE.MeshStandardMaterial({ map: lib.fabric[k], roughness: 0.92, side: THREE.DoubleSide });
    valance[k] = new THREE.MeshStandardMaterial({ map: lib.valance[k], roughness: 0.88, side: THREE.DoubleSide });
  }
  const cushion = ['#d99a7a', '#c4624f', '#e3bf86'].map(
    (c) => new THREE.MeshStandardMaterial({ map: lib.carpet, color: c, roughness: 0.95 }),
  );
  return {
    hull: (tint) => {
      let m = hullCache.get(tint);
      if (!m) {
        m = pbr(lib.hullWood, tint, 0.8, { side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.9, 0.9) });
        m.color.multiplyScalar(WOOD_GAIN);
        hullCache.set(tint, m);
      }
      return m;
    },
    deck: gain(pbr(lib.deckWood, '#d4a57a', 0.85), 1.6),
    trim: gain(pbr(lib.hullWood, '#d9a664', 0.55, { normalScale: new THREE.Vector2(0.6, 0.6) }), 2.4),
    fabric,
    valance,
    cushion,
    carpet: new THREE.MeshStandardMaterial({ map: lib.carpet, color: '#e9b9a0', roughness: 0.96 }),
    robe: new THREE.MeshStandardMaterial({ map: lib.wool, color: '#8a7462', roughness: 0.95 }),
    skin: new THREE.MeshStandardMaterial({ color: '#b07b56', roughness: 0.62 }),
    cap: new THREE.MeshStandardMaterial({ map: lib.wool, color: '#f1ece2', roughness: 0.9 }),
    brass: new THREE.MeshStandardMaterial({ color: '#c89b4a', roughness: 0.35, metalness: 0.85 }),
    paddle: gain(pbr(lib.deckWood, '#9a6a3e', 0.7), 1.8),
    flowers: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
    wicker: gain(pbr(lib.deckWood, '#c8a26a', 0.9), 1.6),
  };
}

// ---------------------------------------------------------------------------
// Hull shape

export interface Section {
  w: number;
  top: number;
  bot: number;
  deck: number;
}

export function hullSection(t: number, L: number, W: number): Section {
  const e = Math.abs(2 * t - 1);
  const s = L / 9;
  // Fine entry at both ends, full beam amidships.
  const w = Math.max(0.004, (W / 2) * Math.pow(Math.max(Math.sin(Math.PI * t), 0), 0.62));
  // Graceful upswept sheer rising to the pointed bow and stern.
  const top = 0.34 + 0.78 * Math.pow(e, 3.4) * (0.75 + 0.25 * s);
  const bot = -0.15 + 0.26 * Math.pow(e, 2.6);
  const deck = e < 0.7 ? 0.17 : Math.max(0.17, top - 0.035);
  return { w, top, bot, deck };
}

export function deckHeightAt(spec: Pick<ShikaraSpec, 'length' | 'width'>, z: number): number {
  const t = THREE.MathUtils.clamp(z / spec.length + 0.5, 0, 1);
  return hullSection(t, spec.length, spec.width).deck;
}

/** Point on the hull cross-section: s in [-1, 1] from port sheer through keel to starboard sheer. */
function sectionPoint(sec: Section, s: number): [number, number] {
  const phi = Math.abs(s) * (Math.PI / 2);
  const x = Math.sign(s) * sec.w * Math.pow(Math.sin(phi), 0.72);
  const y = sec.bot + (sec.top - sec.bot) * Math.pow(1 - Math.cos(phi), 1.1);
  return [x, y];
}

function hullGeometry(L: number, W: number, N: number, M: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const ring = 2 * M + 1;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -L / 2 + t * L;
    const sec = hullSection(t, L, W);
    let girth = 0;
    let prev: [number, number] | null = null;
    const pts: [number, number][] = [];
    for (let j = 0; j < ring; j++) pts.push(sectionPoint(sec, -1 + (2 * j) / (ring - 1)));
    // v measured from the keel so strakes run symmetrically on both sides.
    const girths: number[] = [];
    for (const p of pts) {
      if (prev) girth += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      girths.push(girth);
      prev = p;
    }
    const mid = girths[M];
    pts.forEach((p, j) => {
      pos.push(p[0], p[1], z);
      uv.push(z / 2.3, Math.abs(girths[j] - mid) / 1.7);
    });
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < ring - 1; j++) {
      const a = i * ring + j;
      const b = a + 1;
      const c = a + ring;
      const d = c + 1;
      // Wound so normals face outward: shadow normal-bias must push away from the hull.
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A surface spanning the hull between two stations, following deck height. */
function deckGeometry(L: number, W: number, t0: number, t1: number, N: number, inset: number, yOf: (s: Section) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const cols = 6;
  for (let i = 0; i <= N; i++) {
    const t = t0 + (t1 - t0) * (i / N);
    const z = -L / 2 + t * L;
    const sec = hullSection(t, L, W);
    const y = yOf(sec);
    // Solve the hull half-width at this deck height.
    const f = THREE.MathUtils.clamp((y - sec.bot) / Math.max(sec.top - sec.bot, 1e-3), 0, 1);
    const phi = Math.acos(1 - Math.pow(f, 1 / 1.1));
    const half = sec.w * Math.pow(Math.sin(phi), 0.72) * inset;
    for (let j = 0; j <= cols; j++) {
      const x = -half + (2 * half * j) / cols;
      pos.push(x, y, z);
      uv.push(z / 2.3, x / 1.7 + 0.5);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j;
      idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function tube(points: THREE.Vector3[], radius: number, segs = 64, radial = 8): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, segs, radius, radial, false);
}

function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(...s),
  );
  return g.applyMatrix4(m);
}

/** Turned wooden post: beads and collars on a slim shaft. */
function turnedPost(height: number, radial = 12): THREE.BufferGeometry {
  const p: [number, number][] = [
    [0.0, 0], [0.05, 0], [0.052, 0.04], [0.034, 0.08], [0.03, 0.2], [0.048, 0.24], [0.03, 0.29],
    [0.026, 0.62], [0.042, 0.67], [0.026, 0.72], [0.026, 0.9], [0.044, 0.95], [0.036, 1.0], [0.0, 1.0],
  ];
  const pts = p.map(([r, y]) => new THREE.Vector2(r, y * height));
  return new THREE.LatheGeometry(pts, radial);
}

/** Gathered curtain tied back at a post, with soft folds. */
function curtainGeometry(height: number, seed: number, radial = 28): THREE.BufferGeometry {
  const prof: [number, number][] = [
    [0.03, 0], [0.1, 0.04], [0.12, 0.18], [0.08, 0.36], [0.045, 0.45], [0.08, 0.55], [0.12, 0.75], [0.085, 0.95], [0.04, 1.0],
  ];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y * height)), radial);
  const pos = g.attributes.position;
  const rng = new Rng(seed);
  const phase = rng.next() * 6;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.22 * Math.sin(a * 7 + phase) + 0.08 * Math.sin(a * 13);
    pos.setX(i, x * k);
    pos.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Slightly arched canopy roof. */
function roofGeometry(halfW: number, z0: number, z1: number, y: number, crown: number): THREE.BufferGeometry {
  const nx = 14;
  const nz = 16;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nz; i++) {
    const z = z0 + (z1 - z0) * (i / nz);
    for (let j = 0; j <= nx; j++) {
      const u = -1 + (2 * j) / nx;
      const x = u * halfW;
      pos.push(x, y + crown * (1 - u * u), z);
      uv.push(x / 1.1, z / 1.1);
    }
  }
  for (let i = 0; i < nz; i++) {
    for (let j = 0; j < nx; j++) {
      const a = i * (nx + 1) + j;
      idx.push(a, a + nx + 1, a + 1, a + 1, a + nx + 1, a + nx + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Scalloped valance running round the roof edge; returns the low points for tassels. */
function valanceGeometry(halfW: number, z0: number, z1: number, yEdge: number, depth: number): { geo: THREE.BufferGeometry; tassels: THREE.Vector3[] } {
  const path: THREE.Vector3[] = [
    new THREE.Vector3(-halfW, yEdge, z0), new THREE.Vector3(halfW, yEdge, z0),
    new THREE.Vector3(halfW, yEdge, z1), new THREE.Vector3(-halfW, yEdge, z1), new THREE.Vector3(-halfW, yEdge, z0),
  ];
  const scallop = 0.24;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const tassels: THREE.Vector3[] = [];
  let s = 0;
  let k = 0;
  for (let seg = 0; seg < 4; seg++) {
    const a = path[seg];
    const b = path[seg + 1];
    const len = a.distanceTo(b);
    const steps = Math.max(8, Math.round(len / 0.04));
    for (let i = 0; i <= steps; i++) {
      if (seg > 0 && i === 0) continue;
      const f = i / steps;
      const p = a.clone().lerp(b, f);
      const ss = s + f * len;
      const frac = (ss / scallop) % 1;
      const drop = depth + 0.06 * Math.sin(Math.PI * frac);
      pos.push(p.x, p.y, p.z, p.x, p.y - drop, p.z);
      uv.push(ss / 2.1, 1, ss / 2.1, 1 - drop / (depth + 0.06));
      if (k > 0) {
        const base = (k - 1) * 2;
        idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      }
      k++;
    }
    // One tassel at the lowest point of each scallop along this side.
    for (let n = Math.ceil(s / scallop - 0.5); (n + 0.5) * scallop < s + len; n++) {
      const f = ((n + 0.5) * scallop - s) / len;
      if (f < 0 || f > 1) continue;
      const p = a.clone().lerp(b, f);
      tassels.push(new THREE.Vector3(p.x, p.y - depth - 0.06, p.z));
    }
    s += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, tassels };
}

function colorize(g: THREE.BufferGeometry, color: THREE.Color): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

// ---------------------------------------------------------------------------

export const PADDLE_SHOULDER = { x: 0.17, y: 0.74, dz: 0.02 };

/** Seat position of the boatman on the stern deck. */
export function boatmanSeat(spec: Pick<ShikaraSpec, 'length' | 'width'>): THREE.Vector3 {
  const z = -spec.length / 2 + 1.05 * (spec.length / 9);
  return new THREE.Vector3(0, deckHeightAt(spec, z), z);
}

export function buildShikaraParts(spec: ShikaraSpec, mats: ShikaraMaterials): Part[] {
  const L = spec.length;
  const W = spec.width;
  const N = spec.stations ?? 64;
  const rng = new Rng(spec.seed);
  const parts: Part[] = [];
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => parts.push({ geometry, material });
  const hullMat = mats.hull(spec.hullTint ?? '#9a6a46');
  const low = spec.detail === 'low';
  const tubeSegs = low ? 28 : 90;

  // Hull shell, floor, covered bow and stern decks, bulkheads.
  add(hullGeometry(L, W, N, 9), hullMat);
  const t0 = 0.17;
  const t1 = 0.83;
  add(deckGeometry(L, W, t0 - 0.02, t1 + 0.02, Math.round(N * 0.5), 0.97, (s) => Math.min(s.top - 0.02, 0.17)), mats.deck);
  add(deckGeometry(L, W, 0.0, t0, Math.round(N * 0.2), 0.99, (s) => s.top - 0.03), mats.deck);
  add(deckGeometry(L, W, t1, 1.0, Math.round(N * 0.2), 0.99, (s) => s.top - 0.03), mats.deck);
  for (const t of [t0, t1]) {
    const sec = hullSection(t, L, W);
    const z = -L / 2 + t * L;
    const h = sec.top - 0.03 - 0.17;
    // Bulkheads face into the open well between the covered decks.
    add(placed(new THREE.PlaneGeometry(sec.w * 1.9, h), 0, 0.17 + h / 2, z, 0, t > 0.5 ? Math.PI : 0), mats.trim);
  }

  // Carved gunwale rails, a rub strake, and swan-neck stem posts.
  for (const side of [-1, 1]) {
    const rail: THREE.Vector3[] = [];
    const strake: THREE.Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = 0.01 + 0.98 * (i / 40);
      const sec = hullSection(t, L, W);
      const z = -L / 2 + t * L;
      rail.push(new THREE.Vector3(side * (sec.w + 0.012), sec.top + 0.01, z));
      const [sx, sy] = sectionPoint(sec, side * 0.72);
      strake.push(new THREE.Vector3(sx + side * 0.012, sy, z));
    }
    add(tube(rail, 0.03, tubeSegs, low ? 5 : 8), mats.trim);
    if (!low) add(tube(strake, 0.017, tubeSegs, 6), mats.trim);
  }
  for (const end of [1, -1]) {
    const tip = hullSection(end > 0 ? 1 : 0, L, W).top;
    const z = (end * L) / 2;
    const neck = [
      new THREE.Vector3(0, tip - 0.1, z - end * 0.12),
      new THREE.Vector3(0, tip + 0.08, z + end * 0.02),
      new THREE.Vector3(0, tip + 0.3, z + end * 0.06),
      new THREE.Vector3(0, tip + 0.44, z - end * 0.02),
    ];
    add(tube(neck, 0.034, low ? 10 : 24, low ? 5 : 8), mats.trim);
    add(placed(new THREE.SphereGeometry(0.05, 12, 10), 0, tip + 0.47, z - end * 0.035), mats.brass);
  }

  const s = L / 9;
  if (spec.canopy) {
    const cz0 = -1.95 * s;
    const cz1 = 1.55 * s;
    const cmid = (cz0 + cz1) / 2;
    const px = (W / 2) * 0.8;
    const base = 0.17;
    const roofY = 1.86;
    const halfW = W * 0.56;
    for (const z of [cz0, cmid, cz1]) {
      for (const x of [-px, px]) add(placed(turnedPost(roofY - base, low ? 6 : 12), x, base, z), mats.trim);
    }
    // Roof with a wooden edge frame.
    add(roofGeometry(halfW, cz0 - 0.2, cz1 + 0.2, roofY + 0.02, 0.14), mats.fabric[spec.canopy]);
    const frame = [
      new THREE.Vector3(-halfW, roofY, cz0 - 0.2), new THREE.Vector3(halfW, roofY, cz0 - 0.2),
      new THREE.Vector3(halfW, roofY, cz1 + 0.2), new THREE.Vector3(-halfW, roofY, cz1 + 0.2), new THREE.Vector3(-halfW, roofY, cz0 - 0.2),
    ];
    for (let i = 0; i < 4; i++) add(tube([frame[i], frame[i + 1]], 0.022, 2, 6), mats.trim);
    // Scalloped valance with brass tassels.
    const v = valanceGeometry(halfW + 0.005, cz0 - 0.205, cz1 + 0.205, roofY + 0.01, 0.2);
    add(v.geo, mats.valance[spec.canopy]);
    const tassel = mergeGeometries([
      new THREE.CylinderGeometry(0.008, 0.02, 0.07, 8).translate(0, -0.035, 0).toNonIndexed(),
      new THREE.SphereGeometry(0.018, 8, 6).translate(0, -0.075, 0).toNonIndexed(),
    ]);
    if (!low) {
      const tassels = v.tassels.map((p) => tassel.clone().translate(p.x, p.y, p.z));
      add(mergeGeometries(tassels), mats.brass);
    }
    // Tied-back curtains at the corners.
    let ci = 0;
    for (const z of [cz0, cz1]) {
      for (const x of [-px, px]) {
        const h = roofY - 0.6;
        add(placed(curtainGeometry(h, spec.seed + ci++, low ? 12 : 28), x * 1.02, 0.55, z + (z > 0 ? -0.08 : 0.08)), mats.fabric[spec.canopy]);
        add(placed(new THREE.TorusGeometry(0.05, 0.012, 6, 16), x * 1.02, 0.55 + h * 0.45, z + (z > 0 ? -0.08 : 0.08), Math.PI / 2), mats.brass);
      }
    }
    // Cushioned seat, backrest, bolsters and pillows.
    const seatLen = (cz1 - cz0) * 0.8;
    add(placed(new RoundedBoxGeometry(W * 0.74, 0.14, seatLen, 3, 0.05), 0, 0.25, cmid - 0.05), mats.cushion[0]);
    add(placed(new RoundedBoxGeometry(W * 0.72, 0.5, 0.2, 3, 0.08), 0, 0.5, cz0 + 0.24, -0.28), mats.cushion[1]);
    for (const x of [-W * 0.3, W * 0.3]) {
      add(placed(new THREE.CapsuleGeometry(0.085, seatLen * 0.55, 6, 12), x, 0.4, cmid - 0.1, Math.PI / 2), mats.cushion[2]);
    }
    for (let i = 0; i < 2; i++) {
      add(placed(new RoundedBoxGeometry(0.34, 0.12, 0.3, 3, 0.05), (i ? 1 : -1) * W * 0.16, 0.38, cz0 + 0.55, -0.35, rng.range(-0.2, 0.2)), mats.cushion[i + 1]);
    }
    // Carpet forward of the seat.
    add(placed(new THREE.PlaneGeometry(W * 0.7, 1.1 * s), 0, 0.176, cz1 + 0.35, -Math.PI / 2), mats.carpet);
  }

  if (spec.boatman) {
    const seat = boatmanSeat(spec);
    // Seated figure in a long woollen pheran.
    const prof: [number, number][] = [
      [0, 0], [0.33, 0], [0.35, 0.07], [0.3, 0.24], [0.24, 0.44], [0.215, 0.6], [0.205, 0.7], [0.15, 0.77], [0.07, 0.8], [0.055, 0.86], [0, 0.87],
    ];
    add(
      placed(new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 24), 0, seat.y, seat.z, 0, 0, 0, [1, 1, 0.82]),
      mats.robe,
    );
    add(placed(new THREE.SphereGeometry(0.105, 24, 18), 0, seat.y + 0.97, seat.z + 0.01), mats.skin);
    add(placed(new THREE.SphereGeometry(0.108, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.3), 0, seat.y + 0.99, seat.z + 0.005), mats.cap);
    add(placed(new THREE.SphereGeometry(0.07, 16, 12), 0, seat.y + 0.915, seat.z + 0.07, 0, 0, 0, [1, 0.85, 0.7]), mats.robe);
    add(placed(new THREE.SphereGeometry(0.02, 8, 6), 0, seat.y + 0.97, seat.z + 0.108), mats.skin);
  }

  if (spec.flowers) {
    // Heaped marigolds, roses and lotus buds in two wicker baskets.
    const palette = ['#f08a1c', '#ffb02e', '#c01c32', '#e45c8a', '#f5efe4', '#f2c230', '#d6336c'];
    const flowerGeos: THREE.BufferGeometry[] = [];
    const color = new THREE.Color();
    for (const bz of [0.65 * s, -0.55 * s]) {
      add(placed(new THREE.LatheGeometry([
        new THREE.Vector2(0, 0), new THREE.Vector2(0.24, 0), new THREE.Vector2(0.32, 0.18), new THREE.Vector2(0.34, 0.24), new THREE.Vector2(0.3, 0.25),
      ], 20), 0, 0.17, bz), mats.wicker);
      for (let i = 0; i < 46; i++) {
        const a = rng.next() * Math.PI * 2;
        const r = Math.sqrt(rng.next()) * 0.3;
        const y = 0.36 + (1 - (r / 0.3) ** 2) * 0.2;
        color.set(rng.pick(palette)).multiplyScalar(rng.range(0.85, 1.1));
        const g = new THREE.IcosahedronGeometry(rng.range(0.045, 0.07), 1);
        flowerGeos.push(colorize(placed(g, Math.cos(a) * r, y, bz + Math.sin(a) * r, 0, 0, 0, [1, 0.8, 1]), color));
      }
    }
    for (let i = 0; i < 6; i++) {
      const x = rng.range(-0.15, 0.15);
      const z = rng.range(-0.3, 0.3) * s;
      flowerGeos.push(colorize(new THREE.CylinderGeometry(0.01, 0.012, 0.5, 5).translate(x, 0.55, z), new THREE.Color('#5d7a34')));
      flowerGeos.push(colorize(new THREE.ConeGeometry(0.05, 0.14, 10).translate(x, 0.85, z), new THREE.Color('#f2a7c3')));
    }
    add(mergeGeometries(flowerGeos.map((g) => (g.index ? g.toNonIndexed() : g))), mats.flowers);
  }
  return parts;
}

/** Merges parts sharing a material into single meshes (fewer draw calls). */
export function partsToGroup(parts: Part[], castShadow = true): THREE.Group {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const list = byMat.get(p.material) ?? [];
    list.push(g);
    byMat.set(p.material, list);
  }
  const group = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

/** Transforms parts into a shared frame so several boats can be merged together. */
export function transformParts(parts: Part[], m: THREE.Matrix4): Part[] {
  return parts.map((p) => ({ geometry: p.geometry.clone().applyMatrix4(m), material: p.material }));
}

/** The boatman's arms and heart-shaped paddle, pivoting at the right shoulder. */
export function buildPaddleRig(mats: ShikaraMaterials): THREE.Group {
  const parts: Part[] = [];
  const dir = new THREE.Vector3(0.62, -1.25, 0).normalize();
  const hand = new THREE.Vector3(0.14, -0.33, 0.12);
  const grip = hand.clone().addScaledVector(dir, -0.36);
  const shaftTop = hand.clone().addScaledVector(dir, -0.52);
  const shaftEnd = hand.clone().addScaledVector(dir, 1.3);

  const limb = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b);
    const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 4, 10);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    return g.translate(mid.x, mid.y, mid.z);
  };
  const leftShoulder = new THREE.Vector3(-0.34, 0, 0);
  parts.push({ geometry: limb(new THREE.Vector3(0, 0, 0), hand, 0.048), material: mats.robe });
  parts.push({ geometry: limb(leftShoulder, grip, 0.048), material: mats.robe });
  parts.push({ geometry: new THREE.SphereGeometry(0.04, 12, 10).translate(hand.x, hand.y, hand.z), material: mats.skin });
  parts.push({ geometry: new THREE.SphereGeometry(0.04, 12, 10).translate(grip.x, grip.y, grip.z), material: mats.skin });
  parts.push({ geometry: limb(shaftTop, shaftEnd, 0.022), material: mats.paddle });
  parts.push({ geometry: new THREE.SphereGeometry(0.035, 10, 8).translate(shaftTop.x, shaftTop.y, shaftTop.z), material: mats.paddle });

  // Heart-shaped blade with thickness, tip pointing down along the shaft.
  const sh = new THREE.Shape();
  const k = 1.2;
  sh.moveTo(0, 0);
  sh.bezierCurveTo(0.13 * k, 0.1 * k, 0.17 * k, 0.3 * k, 0.09 * k, 0.39 * k);
  sh.bezierCurveTo(0.04 * k, 0.44 * k, 0, 0.4 * k, 0, 0.35 * k);
  sh.bezierCurveTo(0, 0.4 * k, -0.04 * k, 0.44 * k, -0.09 * k, 0.39 * k);
  sh.bezierCurveTo(-0.17 * k, 0.3 * k, -0.13 * k, 0.1 * k, 0, 0);
  const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 18 });
  blade.translate(0, 0, -0.006);
  const rz = Math.atan2(dir.x, -dir.y);
  const up = new THREE.Vector3(-Math.sin(rz), Math.cos(rz), 0);
  const tip = shaftEnd.clone().addScaledVector(up, -0.5 * k + 0.06);
  blade.rotateZ(rz);
  blade.translate(tip.x, tip.y, tip.z);
  parts.push({ geometry: blade, material: mats.paddle });

  return partsToGroup(parts);
}
