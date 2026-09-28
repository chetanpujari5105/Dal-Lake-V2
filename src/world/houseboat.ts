import * as THREE from 'three';
import type { TextureLibrary } from '../assets/textureLibrary';
import { tinTexture, triplanar } from '../assets/surfaces';
import { createNameBoardAtlas } from '../assets/textures';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { composeMatrix, MeshBuilder } from '../core/geometry';
import { Rng } from '../core/math';
import type { HouseboatPlacement } from './layout';

// Dal Lake houseboats: a long tarred cedar hull with a raked bow, a walnut and
// deodar cabin of carved pilasters and arched lattice windows, a fretwork
// verandah at the bow, a corrugated tin roof (or a railed sun deck) with carved
// eaves, and a painted name board. Local frame: bow at +z.

const NAMES = [
  'Gul-e-Nargis', 'Shehjar', 'Kongposh', 'Yemberzal', 'Neelofar', 'Bulbul',
  'Mehtab', 'Gulshan', 'Heemal', 'Sheen', 'Zoon Dab', 'Chinar Leaf', 'Nishat Rose',
];

const PALETTES = [
  { wood: '#8a5a3a', trim: '#e7d7b4', accent: '#2f5a44', board: '#5a1a1f', ink: '#e9c983', roof: '#5e8266' },
  { wood: '#7a4a2e', trim: '#c9965f', accent: '#6e2a24', board: '#1f3b2d', ink: '#f0dca8', roof: '#8e3c2e' },
  { wood: '#946447', trim: '#f1e8d4', accent: '#2c4a63', board: '#2c2a4a', ink: '#f2e2b6', roof: '#858b8c' },
  { wood: '#6a4230', trim: '#d4ad76', accent: '#8b3a2a', board: '#6b2224', ink: '#f3d98e', roof: '#4f7560' },
];

export interface HouseboatMaterials {
  wood: THREE.MeshStandardMaterial;
  hull: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  windowLit: THREE.MeshStandardMaterial;
  windowDim: THREE.MeshStandardMaterial;
  /** All name boards in one atlas (row per houseboat index). */
  boards: THREE.MeshStandardMaterial;
}

export function createHouseboatMaterials(lib: TextureLibrary): HouseboatMaterials {
  const wood = triplanar(
    new THREE.MeshStandardMaterial({ vertexColors: true, map: lib.deckWood.map, roughness: 0.78, metalness: 0 }),
    2.2, 'hb-wood', 4.2, 0.85,
  );
  const hull = triplanar(
    new THREE.MeshStandardMaterial({ vertexColors: true, map: lib.hullWood.map, roughness: 0.6, metalness: 0 }),
    2.6, 'hb-hull', 6.5, 0.9,
  );
  const tin = tinTexture();
  const roof = triplanar(
    new THREE.MeshStandardMaterial({ vertexColors: true, map: tin, roughness: 0.55, metalness: 0.25 }),
    1.2, 'hb-roof', 1.6, 0.9,
  );
  return {
    wood,
    hull,
    roof,
    windowLit: new THREE.MeshStandardMaterial({ color: '#2a1d12', emissive: '#ffa04a', emissiveIntensity: 0, roughness: 0.3 }),
    windowDim: new THREE.MeshStandardMaterial({ color: '#1d1916', emissive: '#ff9540', emissiveIntensity: 0, roughness: 0.3 }),
    boards: new THREE.MeshStandardMaterial({
      map: createNameBoardAtlas(NAMES.map((name, i) => ({ name, bg: PALETTES[i % PALETTES.length].board, fg: PALETTES[i % PALETTES.length].ink }))),
      roughness: 0.7,
    }),
  };
}

export interface HouseboatInstance {
  group: THREE.Group;
  detail: THREE.Mesh;
  lanterns: THREE.Vector3[]; // world positions
}

/** Lofted hull: flat bottom, soft bilge, flared sides, sheer rising to a raked bow. */
function hullGeometry(L: number, W: number, color: string, band: string): THREE.BufferGeometry {
  const hw = W / 2;
  const stations = 36;
  const z0 = -L / 2 - 0.3;
  const z1 = L / 2 + 1.6;
  // Half-section profile (x, y) from keel to sheer; last point replaced by sheer height.
  const prof: [number, number][] = [[0, -0.55], [0.7, -0.58], [0.93, -0.45], [1.0, -0.1], [1.02, 0.42], [1.03, 0.6], [1.03, 0.7], [1.03, 1]];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const cHull = new THREE.Color(color);
  const cBand = new THREE.Color(band);
  const n = prof.length;
  for (let s = 0; s <= stations; s++) {
    const z = z0 + ((z1 - z0) * s) / stations;
    const bow = Math.max(0, (z - (L / 2 - 3.2)) / (z1 - (L / 2 - 3.2)));
    const stern = Math.max(0, ((-L / 2 + 1.2) - z) / 1.5);
    const beam = hw * (1 - Math.pow(bow, 1.7) * 0.92) * (1 - stern * 0.12);
    const sheer = 1.0 + bow * bow * 1.1 + stern * 0.25;
    const lift = bow * bow * 0.5 + stern * 0.3; // bottom sweeps up at the ends
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const [px, py] = prof[i];
        const y = i === n - 1 ? sheer : Math.max(py + lift, py);
        pos.push(side * px * beam, i === n - 1 ? y : y * (i >= n - 2 ? 1 : 1), z);
        // A painted band at the waterline strake; tarred wood above and below.
        const c = i === 4 || i === 5 ? cBand : cHull;
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const row = n * 2;
  for (let s = 0; s < stations; s++) {
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < n - 1; i++) {
        const a = s * row + side * n + i;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;
        if (side === 0) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
  }
  // Transom at the stern.
  for (let i = 0; i < n - 1; i++) idx.push(i, n + i, i + 1, i + 1, n + i, n + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

/** Window opening with a round arch head, in the XY plane, centred at the origin. */
function archShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const r = w / 2;
  s.moveTo(-r, -h / 2);
  s.lineTo(r, -h / 2);
  s.lineTo(r, h / 2 - r);
  s.absarc(0, h / 2 - r, r, 0, Math.PI, false);
  s.lineTo(-r, -h / 2);
  return s;
}

function archFrame(w: number, h: number, t: number): THREE.BufferGeometry {
  const outer = archShape(w + t * 2, h + t * 2);
  const hole = archShape(w, h);
  outer.holes.push(new THREE.Path(hole.getPoints(12)));
  return new THREE.ShapeGeometry(outer, 10);
}

export function buildHouseboat(place: HouseboatPlacement, index: number, mats: HouseboatMaterials): HouseboatInstance {
  const rng = new Rng(place.seed);
  const pal = PALETTES[index % PALETTES.length];
  const L = place.length;
  const W = 6.2;
  const main = new MeshBuilder(place.seed, 0.06);
  const detail = new MeshBuilder(place.seed + 1, 0.06);
  const lit = new MeshBuilder(place.seed + 2);
  const dim = new MeshBuilder(place.seed + 3);
  const roofB = new MeshBuilder(place.seed + 4, 0.05);

  const deckY = 1.0;
  const cabinZ0 = -L / 2 + 0.6;
  const cabinZ1 = L / 2 - 5.2;
  const cabinLen = cabinZ1 - cabinZ0;
  const cabinMid = (cabinZ0 + cabinZ1) / 2;
  const cabinTop = 4.0;
  const cw = W - 0.5;

  // Hull, rub rail and deck.
  main.box(W - 0.1, 0.12, L - 0.3, 0, deckY, 0.2, '#a0785a');

  // Cabin body with plinth and cornice.
  main.box(cw, cabinTop - deckY, cabinLen, 0, (cabinTop + deckY) / 2, cabinMid, pal.wood);
  main.box(cw + 0.22, 0.38, cabinLen + 0.22, 0, cabinTop - 0.14, cabinMid, pal.trim);
  main.box(cw + 0.16, 0.34, cabinLen + 0.16, 0, deckY + 0.2, cabinMid, pal.trim);

  // Side walls: carved pilasters with arched windows between them.
  const bays = Math.max(4, Math.floor(cabinLen / 1.8));
  const bayLen = cabinLen / bays;
  const winW = bayLen * 0.52;
  const winH = 1.45;
  const winY = 2.5;
  const frame = archFrame(winW, winH, 0.09);
  const pane = new THREE.ShapeGeometry(archShape(winW, winH), 10);
  for (const side of [-1, 1]) {
    const x = side * (cw / 2);
    const faceRy = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (let i = 0; i <= bays; i++) {
      const z = cabinZ0 + i * bayLen;
      main.box(0.22, cabinTop - deckY - 0.5, 0.26, x + side * 0.07, (cabinTop + deckY) / 2, z, pal.trim);
      // Capital and base blocks on each pilaster.
      detail.box(0.3, 0.16, 0.34, x + side * 0.09, cabinTop - 0.45, z, pal.trim);
      detail.box(0.3, 0.16, 0.34, x + side * 0.09, deckY + 0.5, z, pal.trim);
    }
    for (let i = 0; i < bays; i++) {
      const z = cabinZ0 + (i + 0.5) * bayLen;
      const m = composeMatrix(x + side * 0.03, winY, z, 0, faceRy);
      (rng.chance(0.6) ? lit : dim).add(pane.clone(), '#ffffff', m);
      main.add(frame.clone(), pal.trim, composeMatrix(x + side * 0.05, winY, z, 0, faceRy));
      // Pinjrakari lattice across the lower half of each window.
      for (let k = 0; k < 5; k++) {
        const zz = z - winW * 0.4 + (k / 4) * winW * 0.8;
        detail.box(0.03, winH * 0.5, 0.03, x + side * 0.07, winY - winH * 0.22, zz, pal.trim, 0, 0.55);
        detail.box(0.03, winH * 0.5, 0.03, x + side * 0.07, winY - winH * 0.22, zz, pal.trim, 0, -0.55);
      }
      detail.box(0.04, 0.05, winW, x + side * 0.08, winY + 0.02, z, pal.trim);
      // Carved panel below the window.
      detail.box(0.05, 0.55, bayLen * 0.62, x + side * 0.05, 1.5, z, pal.trim);
      detail.box(0.05, 0.4, bayLen * 0.46, x + side * 0.08, 1.5, z, pal.wood);
      detail.sphere(0.07, 0, x + side * 0.1, 1.5, z, pal.accent);
    }
    // Dentil band under the cornice.
    for (let z = cabinZ0 + 0.2; z < cabinZ1; z += 0.34) detail.box(0.08, 0.1, 0.14, x + side * 0.14, cabinTop - 0.4, z, pal.trim);
  }

  // Front facade: arched door flanked by arched windows.
  const fz = cabinZ1 + 0.02;
  lit.add(new THREE.ShapeGeometry(archShape(0.95, 2.2), 10), '#ffffff', composeMatrix(0, deckY + 1.12, fz + 0.03));
  main.add(archFrame(0.95, 2.2, 0.12), pal.trim, composeMatrix(0, deckY + 1.12, fz + 0.05));
  for (const x of [-1.8, 1.8]) {
    lit.add(new THREE.ShapeGeometry(archShape(0.9, 1.4), 10), '#ffffff', composeMatrix(x, winY, fz + 0.03));
    main.add(archFrame(0.9, 1.4, 0.1), pal.trim, composeMatrix(x, winY, fz + 0.05));
  }
  for (const x of [-1.4, 1.4]) dim.add(new THREE.ShapeGeometry(archShape(0.8, 1.1), 8), '#ffffff', composeMatrix(x, winY, cabinZ0 - 0.03, 0, Math.PI));

  // Verandah: turned pillars, railing with balusters, scalloped fretwork valance.
  const vz0 = cabinZ1;
  const vz1 = L / 2 - 0.5;
  const vlen = vz1 - vz0;
  const roofY = 3.75;
  const pillars: [number, number][] = [[-W / 2 + 0.25, vz1], [W / 2 - 0.25, vz1], [-W / 2 + 0.25, vz0 + vlen * 0.5], [W / 2 - 0.25, vz0 + vlen * 0.5], [-1.1, vz1], [1.1, vz1]];
  for (const [x, z] of pillars) {
    main.add(new THREE.LatheGeometry(turnedProfile(roofY - deckY), 8), pal.trim, composeMatrix(x, deckY, z));
    main.box(0.34, 0.14, 0.34, x, deckY + 0.07, z, pal.wood);
    main.box(0.38, 0.16, 0.38, x, roofY - 0.08, z, pal.wood);
    // Carved brackets.
    detail.box(0.08, 0.5, 0.5, x, roofY - 0.4, z - 0.2, pal.trim, 0, Math.PI / 4);
  }
  main.box(W + 0.6, 0.16, vlen + 0.7, 0, roofY + 0.08, vz0 + vlen / 2 + 0.2, pal.wood);
  main.box(W + 0.66, 0.1, vlen + 0.76, 0, roofY + 0.2, vz0 + vlen / 2 + 0.2, pal.trim);

  const railY = deckY + 0.95;
  const railRuns: [number, number, number, number][] = [
    [-W / 2 + 0.25, vz1, -1.1, vz1],
    [1.1, vz1, W / 2 - 0.25, vz1],
    [-W / 2 + 0.25, vz0 + 0.2, -W / 2 + 0.25, vz1],
    [W / 2 - 0.25, vz0 + 0.2, W / 2 - 0.25, vz1],
  ];
  for (const [x0, z0, x1, z1] of railRuns) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    main.box(0.12, 0.08, len, (x0 + x1) / 2, railY, (z0 + z1) / 2, pal.trim, ang);
    main.box(0.08, 0.06, len, (x0 + x1) / 2, deckY + 0.2, (z0 + z1) / 2, pal.trim, ang);
    const nb = Math.floor(len / 0.18);
    for (let i = 1; i < nb; i++) {
      const f = i / nb;
      detail.cyl(0.028, 0.035, 0.7, 5, x0 + (x1 - x0) * f, deckY + 0.58, z0 + (z1 - z0) * f, pal.trim);
    }
  }
  // Scalloped valance: a row of small arches with drops under the verandah roof.
  for (let x = -W / 2 + 0.2; x <= W / 2; x += 0.42) {
    detail.add(new THREE.TorusGeometry(0.2, 0.025, 4, 8, Math.PI), pal.trim, composeMatrix(x, roofY - 0.1, vz1 + 0.42, 0, 0, Math.PI));
    detail.sphere(0.04, 0, x + 0.21, roofY - 0.24, vz1 + 0.42, pal.trim);
  }
  for (const side of [-1, 1]) {
    for (let z = vz0 + 0.2; z <= vz1 + 0.3; z += 0.42) {
      detail.add(new THREE.TorusGeometry(0.2, 0.025, 4, 8, Math.PI), pal.trim, composeMatrix(side * (W / 2 + 0.28), roofY - 0.1, z, 0, Math.PI / 2, Math.PI));
    }
  }

  // Roof: a corrugated tin gable with carved eaves, or a railed sun deck.
  const gable = rng.chance(0.55);
  if (gable) {
    const pitch = 0.5;
    const half = cw / 2 + 0.7;
    const slope = half / Math.cos(pitch);
    const rise = Math.tan(pitch) * half;
    const rl = cabinLen + 1.2;
    roofB.box(slope, 0.08, rl, -half / 2, cabinTop + rise / 2 + 0.05, cabinMid, pal.roof, 0, 0, pitch);
    roofB.box(slope, 0.08, rl, half / 2, cabinTop + rise / 2 + 0.05, cabinMid, pal.roof, 0, 0, -pitch);
    roofB.box(0.22, 0.14, rl + 0.05, 0, cabinTop + rise + 0.07, cabinMid, pal.roof);
    for (const z of [cabinZ0 - 0.55, cabinZ1 + 0.55]) {
      // Gable end: a boarded triangle with a carved sunburst and bargeboards.
      main.tris([-half + 0.3, cabinTop, z, half - 0.3, cabinTop, z, 0, cabinTop + rise - 0.15, z], pal.wood);
      main.tris([half - 0.3, cabinTop, z, -half + 0.3, cabinTop, z, 0, cabinTop + rise - 0.15, z], pal.wood);
      for (let k = 0; k < 7; k++) {
        const a = (k / 6) * Math.PI;
        detail.box(0.05, 0.9, 0.04, Math.cos(a) * 0.45, cabinTop + 0.45 + Math.sin(a) * 0.45, z + 0.03 * Math.sign(z), pal.trim, 0, 0, a - Math.PI / 2);
      }
      for (const sx of [-1, 1]) detail.box(slope, 0.2, 0.06, sx * half / 2, cabinTop + rise / 2 - 0.05, z + 0.05 * Math.sign(z), pal.trim, 0, 0, -sx * pitch);
      detail.cyl(0.05, 0.08, 0.7, 6, 0, cabinTop + rise + 0.4, z, pal.trim);
      detail.sphere(0.12, 1, 0, cabinTop + rise + 0.8, z, pal.trim);
    }
    // Carved eave boards along both sides.
    for (const sx of [-1, 1]) {
      for (let z = cabinZ0 - 0.5; z <= cabinZ1 + 0.5; z += 0.36) {
        detail.box(0.04, 0.22, 0.2, sx * (half - 0.02), cabinTop + 0.05 - 0.08, z, pal.trim, 0, Math.PI / 4);
      }
    }
  } else {
    main.box(cw + 0.4, 0.2, cabinLen + 0.4, 0, cabinTop + 0.1, cabinMid, pal.wood);
    const ry = cabinTop + 0.2;
    main.box(0.1, 0.07, cabinLen, cw / 2, ry + 0.78, cabinMid, pal.trim);
    main.box(0.1, 0.07, cabinLen, -cw / 2, ry + 0.78, cabinMid, pal.trim);
    main.box(cw, 0.07, 0.1, 0, ry + 0.78, cabinZ0, pal.trim);
    main.box(cw, 0.07, 0.1, 0, ry + 0.78, cabinZ1, pal.trim);
    for (let z = cabinZ0; z <= cabinZ1; z += 0.28) {
      detail.cyl(0.025, 0.03, 0.72, 5, cw / 2, ry + 0.4, z, pal.trim);
      detail.cyl(0.025, 0.03, 0.72, 5, -cw / 2, ry + 0.4, z, pal.trim);
    }
    for (let x = -cw / 2; x <= cw / 2; x += 0.28) {
      detail.cyl(0.025, 0.03, 0.72, 5, x, ry + 0.4, cabinZ0, pal.trim);
      detail.cyl(0.025, 0.03, 0.72, 5, x, ry + 0.4, cabinZ1, pal.trim);
    }
    // Sun-deck awning with a small tin roof.
    roofB.box(3.0, 0.06, 3.0, 0, ry + 2.0, cabinZ1 - 1.7, pal.roof, 0, 0, 0);
    for (const [x, z] of [[-1.3, cabinZ1 - 0.4], [1.3, cabinZ1 - 0.4], [-1.3, cabinZ1 - 3.0], [1.3, cabinZ1 - 3.0]]) {
      main.cyl(0.05, 0.05, 2.0, 6, x, ry + 1.0, z, pal.trim);
    }
  }

  // Side steps down to the water and a gangplank to the embankment.
  for (let i = 0; i < 3; i++) main.box(0.8, 0.12, 1.2, W / 2 + 0.4 + i * 0.35, deckY - 0.3 - i * 0.28, vz0 + 1.2, '#8b6a4c');
  main.box(1.2, 0.1, 3.6, 0, deckY + 0.05, -L / 2 - 1.8, '#8b6a4c');

  // Hanging lanterns at the verandah corners.
  const lanternsLocal = [new THREE.Vector3(-W / 2 + 0.3, roofY - 0.55, vz1 + 0.1), new THREE.Vector3(W / 2 - 0.3, roofY - 0.55, vz1 + 0.1)];
  for (const p of lanternsLocal) {
    lit.box(0.16, 0.24, 0.16, p.x, p.y, p.z, '#ffffff');
    detail.box(0.02, 0.3, 0.02, p.x, p.y + 0.27, p.z, '#2a2018');
  }

  // Name-board backing, merged into the main mesh (it shares the wood material).
  main.box(4.05, 1.05, 0.08, 0, roofY + 0.72, vz1 + 0.41, pal.trim);

  const group = new THREE.Group();
  const hullMesh = new THREE.Mesh(hullGeometry(L, W, '#3a2c22', pal.accent), mats.hull);
  const mainMesh = new THREE.Mesh(main.build(), mats.wood);
  const roofMesh = new THREE.Mesh(roofB.build(), mats.roof);
  for (const m of [hullMesh, mainMesh, roofMesh]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  const detailMesh = new THREE.Mesh(detail.build(), mats.wood);
  detailMesh.userData.detail = true;
  detailMesh.castShadow = true;
  const litMesh = new THREE.Mesh(lit.build(), mats.windowLit);
  const dimMesh = new THREE.Mesh(dim.build(), mats.windowDim);
  group.add(hullMesh, mainMesh, roofMesh, detailMesh, litMesh, dimMesh);

  // Painted name board above the verandah.
  const name = NAMES[index % NAMES.length];
  const boardGeo = new THREE.PlaneGeometry(3.8, 0.83);
  const row = index % NAMES.length;
  const uv = boardGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + 1 - uv.getY(i)) / NAMES.length);
  const board = new THREE.Mesh(boardGeo, mats.boards);
  board.position.set(0, roofY + 0.72, vz1 + 0.47);
  group.add(board);

  // Bow faces west, toward the open lake and the setting sun.
  group.rotation.y = -Math.PI / 2;
  group.position.set(place.x, 0, place.z);
  group.updateMatrixWorld(true);
  const lanterns = lanternsLocal.map((p) => p.clone().applyMatrix4(group.matrixWorld));
  group.name = `houseboat-${name}`;
  return { group, detail: detailMesh, lanterns };
}

/** Profile of a turned verandah pillar (radius, height), for a lathe. */
function turnedProfile(h: number): THREE.Vector2[] {
  return [
    new THREE.Vector2(0.001, 0), new THREE.Vector2(0.13, 0), new THREE.Vector2(0.13, 0.12), new THREE.Vector2(0.09, 0.2),
    new THREE.Vector2(0.075, h * 0.35), new THREE.Vector2(0.11, h * 0.42), new THREE.Vector2(0.075, h * 0.5),
    new THREE.Vector2(0.07, h * 0.85), new THREE.Vector2(0.12, h * 0.93), new THREE.Vector2(0.14, h), new THREE.Vector2(0.001, h),
  ];
}

export interface HouseboatRow {
  detail: THREE.Mesh;
  /** Row extent along the Boulevard, for the detail draw distance. */
  x: number;
  z0: number;
  z1: number;
}

/**
 * Bakes every houseboat into one mesh per material (hull, wood, tin, windows,
 * boards), plus one carving mesh per mooring row that can drop out with
 * distance. Thirteen boats go from about 90 draw calls to about 8.
 */
export function mergeHouseboats(list: HouseboatInstance[]): { group: THREE.Group; rows: HouseboatRow[] } {
  const byMat = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean }>();
  const rowGeos: THREE.BufferGeometry[][] = [[], []];
  const rowZ: [number, number][] = [[Infinity, -Infinity], [Infinity, -Infinity]];
  let rowMat: THREE.Material | null = null;
  let rowX = 0;
  for (const hb of list) {
    hb.group.updateMatrixWorld(true);
    const r = hb.group.position.z < 0 ? 0 : 1;
    rowZ[r][0] = Math.min(rowZ[r][0], hb.group.position.z - 15);
    rowZ[r][1] = Math.max(rowZ[r][1], hb.group.position.z + 15);
    rowX = hb.group.position.x;
    hb.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      g = g.applyMatrix4(mesh.matrixWorld);
      if (mesh.userData.detail) {
        rowGeos[r].push(g);
        rowMat = mesh.material as THREE.Material;
        return;
      }
      const mat = mesh.material as THREE.Material;
      const key = `${mat.uuid}:${Object.keys(g.attributes).sort().join(',')}`;
      const e = byMat.get(key) ?? { mat, geos: [], cast: mesh.castShadow };
      e.geos.push(g);
      byMat.set(key, e);
    });
  }
  const group = new THREE.Group();
  group.name = 'houseboats';
  for (const { mat, geos, cast } of byMat.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  const rows: HouseboatRow[] = [];
  rowGeos.forEach((geos, r) => {
    if (!geos.length || !rowMat) return;
    const mesh = new THREE.Mesh(mergeGeometries(geos)!, rowMat);
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    rows.push({ detail: mesh, x: rowX, z0: rowZ[r][0], z1: rowZ[r][1] });
  });
  return { group, rows };
}
