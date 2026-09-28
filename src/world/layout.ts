// The lake plan: shoreline, terrain height field, obstacle footprints, landmarks.
// World axes: +x east, -z north, y up. Units are metres.
//
// The layout loosely follows Dal Lake's geography: the Boulevard and its houseboat
// rows along the east shore, the Zabarwan range and a Mughal terraced garden behind
// them, floating gardens toward the west, lotus beds in the southern shallows,
// Char Chinar island mid-lake and the Hari Parbat hill on the western skyline.

import { clamp, fbm, lerp, ridged, Rng, smoothstep, valueNoise } from '../core/math';

type P = [number, number];

const CONTROL: P[] = [
  [218, -240], [190, -285], [120, -310], [30, -318], [-60, -300], [-150, -262],
  [-220, -205], [-262, -130], [-285, -40], [-280, 50], [-258, 135], [-212, 205],
  [-140, 250], [-50, 272], [40, 272], [120, 256], [180, 228], [214, 190],
  [218, 120], [218, 40], [218, -40], [218, -120], [218, -180],
];

function chaikin(points: P[], iterations: number): P[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: P[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return pts;
}

function buildShoreline(): P[] {
  const pts = chaikin(CONTROL, 3);
  // Organic wobble everywhere except the straight stone embankment of the Boulevard.
  return pts.map(([x, z]) => {
    const w = 1 - smoothstep(150, 205, x);
    const n = (valueNoise(x * 0.025, z * 0.025) - 0.5) * 14 * w;
    const len = Math.hypot(x + 30, z + 20) || 1;
    return [x + ((x + 30) / len) * n, z + ((z + 20) / len) * n] as P;
  });
}

export const SHORE: P[] = buildShoreline();

/** Signed distance to the shoreline: negative on water, positive on land. */
export function lakeSdf(x: number, z: number): number {
  let minD = Infinity;
  let inside = false;
  const n = SHORE.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = SHORE[i][0], zi = SHORE[i][1];
    const xj = SHORE[j][0], zj = SHORE[j][1];
    const ex = xi - xj, ez = zi - zj;
    const wx = x - xj, wz = z - zj;
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1);
    const dx = wx - ex * t, dz = wz - ez * t;
    const d = dx * dx + dz * dz;
    if (d < minD) minD = d;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  const d = Math.sqrt(minD);
  return inside ? -d : d;
}

export function lakeSdfGradient(x: number, z: number): [number, number] {
  const e = 0.5;
  const gx = lakeSdf(x + e, z) - lakeSdf(x - e, z);
  const gz = lakeSdf(x, z + e) - lakeSdf(x, z - e);
  const l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}

// ---------------------------------------------------------------------------
// Landmarks and structures

export const BOULEVARD_X = 218;

export const NISHAT = { x0: 238, x1: 420, z0: -104, z1: -40, steps: 8 };
export function nishatTerraceTop(x: number): number {
  const i = clamp(Math.floor(((x - NISHAT.x0) / (NISHAT.x1 - NISHAT.x0)) * NISHAT.steps), 0, NISHAT.steps - 1);
  return 1.6 + i * 5.2;
}

export const CHAR_CHINAR = { x: 20, z: -170, r: 16 };
export const HARI_PARBAT = { x: -760, z: -120, height: 115, radius: 95 };
export const LOTUS_BED = { x: -120, z: 192, r: 46 };
export const GHAT = { z0: -34, z1: 2 };

export interface HouseboatPlacement {
  x: number;
  z: number;
  length: number;
  seed: number;
}

export const HOUSEBOATS: HouseboatPlacement[] = (() => {
  const zs = [-205, -189, -173, -157, -141, -125, 22, 39, 56, 73, 90, 107, 124];
  const rng = new Rng(42);
  return zs.map((z, i) => {
    const length = Math.round(rng.range(23, 29));
    return { x: BOULEVARD_X - 2.2 - length / 2, z, length, seed: 100 + i };
  });
})();

export interface GardenPlot {
  x: number;
  z: number;
  w: number; // across (x)
  l: number; // along (z)
  rot: number;
  hut: boolean;
}

export const GARDEN_PLOTS: GardenPlot[] = (() => {
  const rng = new Rng(7);
  const plots: GardenPlot[] = [];
  const cols = [-236, -208, -180, -152, -124];
  for (const cx of cols) {
    for (let cz = -150; cz <= 90; cz += 44) {
      if (rng.chance(0.14)) continue;
      const w = rng.range(8, 12);
      const l = rng.range(24, 33);
      const x = cx + rng.range(-3, 3);
      const z = cz + rng.range(-4, 4);
      const rot = rng.range(-0.09, 0.09);
      // Keep every corner comfortably inside the lake.
      let ok = true;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = (sx * w) / 2, lz = (sz * l) / 2;
        const px = x + lx * Math.cos(rot) + lz * Math.sin(rot);
        const pz = z - lx * Math.sin(rot) + lz * Math.cos(rot);
        if (lakeSdf(px, pz) > -6) ok = false;
      }
      if (ok) plots.push({ x, z, w, l, rot, hut: rng.chance(0.18) });
    }
  }
  return plots;
})();

export const SPAWN = { x: 170, z: 168, heading: Math.PI };

/** Closed loop the flower sellers paddle along. */
export const FLOWER_ROUTE: P[] = [
  [150, 200], [140, 95], [168, 5], [150, -92], [160, -200], [95, -252],
  [20, -236], [-32, -160], [36, -84], [84, 36], [104, 150],
];

export interface Landmark {
  id: string;
  title: string;
  text: string;
  x: number;
  z: number;
  r: number;
}

export const LANDMARKS: Landmark[] = [
  { id: 'houseboats-s', title: 'Houseboat row', text: 'Carved deodar houseboats moored along the Boulevard.', x: 188, z: 72, r: 62 },
  { id: 'ghat', title: 'Shikara ghat', text: 'Painted shikaras wait at the Boulevard steps.', x: 196, z: -16, r: 30 },
  { id: 'nishat', title: 'Nishat Bagh', text: 'Mughal garden terraces stepping down from the Zabarwan hills.', x: 170, z: -72, r: 42 },
  { id: 'houseboats-n', title: 'Houseboat row', text: 'Verandahs of fretwork and walnut, facing the evening sun.', x: 188, z: -165, r: 55 },
  { id: 'charchinar', title: 'Char Chinar', text: 'A tiny island held by four chinar trees.', x: CHAR_CHINAR.x, z: CHAR_CHINAR.z, r: 58 },
  { id: 'hariparbat', title: 'Hari Parbat', text: 'The old fort on its hill watches the western shore.', x: -170, z: -225, r: 70 },
  { id: 'raad', title: 'Floating gardens', text: 'Raad — beds of reed and lake weed, farmed from boats.', x: -180, z: -30, r: 85 },
  { id: 'lotus', title: 'Lotus beds', text: 'Nadru — lotus in the shallows of the southern lake.', x: LOTUS_BED.x, z: LOTUS_BED.z, r: 62 },
];

// ---------------------------------------------------------------------------
// Obstacles for boat and camera collision

export type Obstacle =
  | { kind: 'box'; x: number; z: number; hx: number; hz: number; rot: number; height: number }
  | { kind: 'circle'; x: number; z: number; r: number; height: number };

export const OBSTACLES: Obstacle[] = [
  ...HOUSEBOATS.map((h): Obstacle => ({ kind: 'box', x: h.x, z: h.z, hx: h.length / 2 + 0.4, hz: 3.5, rot: 0, height: 5.5 })),
  ...GARDEN_PLOTS.map((p): Obstacle => ({ kind: 'box', x: p.x, z: p.z, hx: p.w / 2, hz: p.l / 2, rot: p.rot, height: 1.2 })),
  { kind: 'circle', x: CHAR_CHINAR.x, z: CHAR_CHINAR.z, r: CHAR_CHINAR.r + 0.8, height: 3 },
  { kind: 'box', x: BOULEVARD_X - 7, z: (GHAT.z0 + GHAT.z1) / 2, hx: 7.5, hz: (GHAT.z1 - GHAT.z0) / 2, rot: 0, height: 2.5 },
];

// ---------------------------------------------------------------------------
// Terrain

export function terrainHeight(x: number, z: number): number {
  const d = lakeSdf(x, z);
  if (d < 0) return Math.max(-3.2, d * 0.1) - 0.35;

  let h = smoothstep(0, 5, d) * 1.4 - 0.35;
  h += (fbm(x * 0.012, z * 0.012, 3) - 0.5) * 3.2 * smoothstep(10, 70, d);

  // Boulevard promenade: flat stone walk behind the embankment.
  const prom = smoothstep(212, 216, x) * (1 - smoothstep(244, 252, x)) * (1 - smoothstep(250, 290, Math.abs(z)));
  h = lerp(h, 1.25, prom);

  // Zabarwan foothills rising behind the Boulevard.
  const east = smoothstep(250, 540, x);
  h += east * (x - 250) * 0.42 * (0.72 + 0.56 * fbm(x * 0.006 + 3, z * 0.006, 3));

  // Nishat Bagh is cut into the slope as terraces.
  const inX = x > NISHAT.x0 - 6 && x < NISHAT.x1 + 6;
  const inZ = z > NISHAT.z0 - 6 && z < NISHAT.z1 + 6;
  if (inX && inZ) h = Math.min(h, nishatTerraceTop(clamp(x, NISHAT.x0, NISHAT.x1 - 0.1)) - 0.6);

  // Hari Parbat.
  const hx = x - HARI_PARBAT.x, hz = z - HARI_PARBAT.z;
  h += HARI_PARBAT.height * Math.exp(-(hx * hx + hz * hz) / (2 * HARI_PARBAT.radius * HARI_PARBAT.radius));

  // Surrounding ranges: Zabarwan close to the east, Pir Panjal far to the west.
  const r = Math.hypot(x, z);
  const eastMask = 0.35 + 0.65 * smoothstep(-0.25, 0.75, x / (r + 1));
  // Ridged noise softened with fbm so crests are weathered rather than knife-edged.
  const rid = ridged(x * 0.0017 + 11, z * 0.0017 - 4, 4) * 0.65 + fbm(x * 0.0021 - 3, z * 0.0021 + 8, 3) * 0.35;
  // Kept low relative to distance (under ~10 degrees of elevation) so the ranges read
  // as a distant backdrop and their reflections stay near the far shore.
  h += smoothstep(800, 2300, r) * (90 + 300 * rid) * eastMask;
  h += smoothstep(2600, 3800, r) * (150 + 350 * rid) * (1 - eastMask * 0.55);
  return h;
}

/** Height a floating object should sit at. Mirrors the swell in the water shader's base layer. */
export function waterHeight(x: number, z: number, t: number): number {
  return (
    0.034 * Math.sin(0.33 * x + 1.1 * t) +
    0.028 * Math.sin(0.27 * z - 0.93 * t + 1.3) +
    0.018 * Math.sin(0.46 * (x + z) + 1.7 * t)
  );
}
