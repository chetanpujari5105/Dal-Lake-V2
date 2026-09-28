import * as THREE from 'three';
import { Rng } from '../core/math';

// Photographic textures are CC0 from Poly Haven (see ASSET_CREDITS.md), shipped
// as 1k WebP in public/textures. Fabric, carpet and foliage-card textures are
// painted procedurally on canvas here. Any file that fails to load degrades to
// a plain-coloured material instead of breaking the scene.

export interface PBRSet {
  map: THREE.Texture | null;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

export type FabricKey = 'crimson' | 'royal' | 'emerald' | 'saffron';

export interface TextureLibrary {
  hullWood: PBRSet;
  deckWood: PBRSet;
  mud: PBRSet;
  rock: PBRSet;
  fabric: Record<FabricKey, THREE.Texture>;
  valance: Record<FabricKey, THREE.Texture>;
  carpet: THREE.Texture;
  wool: THREE.Texture;
  grass: THREE.Texture;
  reed: THREE.Texture;
  leaf: THREE.Texture;
  /** Files that could not be loaded (reported, not fatal). */
  missing: string[];
}

const BASE = `${import.meta.env.BASE_URL}textures/`;

async function loadSet(
  loader: THREE.TextureLoader,
  id: string,
  maps: ('diff' | 'nor_gl' | 'rough')[],
  anisotropy: number,
  missing: string[],
): Promise<PBRSet> {
  const load = async (suffix: string, srgb: boolean): Promise<THREE.Texture | null> => {
    const url = `${BASE}${id}_${suffix}.webp`;
    try {
      const t = await loader.loadAsync(url);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return t;
    } catch {
      missing.push(url);
      return null;
    }
  };
  const [map, normalMap, roughnessMap] = await Promise.all([
    maps.includes('diff') ? load('diff', true) : Promise.resolve(null),
    maps.includes('nor_gl') ? load('nor_gl', false) : Promise.resolve(null),
    maps.includes('rough') ? load('rough', false) : Promise.resolve(null),
  ]);
  return { map, normalMap, roughnessMap };
}

function canvasTexture(canvas: HTMLCanvasElement, anisotropy: number, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Draws `fn` at (x, y) and at wrapped copies so the tile repeats seamlessly. */
function tiled(w: number, h: number, x: number, y: number, pad: number, fn: (x: number, y: number) => void): void {
  for (const dx of [-w, 0, w]) {
    for (const dy of [-h, 0, h]) {
      const px = x + dx;
      const py = y + dy;
      if (px > -pad && px < w + pad && py > -pad && py < h + pad) fn(px, py);
    }
  }
}

function weave(ctx: CanvasRenderingContext2D, w: number, h: number, rng: Rng, strength: number): void {
  for (let y = 0; y < h; y += 2) {
    ctx.fillStyle = `rgba(0,0,0,${(rng.next() * strength).toFixed(3)})`;
    ctx.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 2) {
    ctx.fillStyle = `rgba(255,255,255,${(rng.next() * strength * 0.6).toFixed(3)})`;
    ctx.fillRect(x, 0, 1, h);
  }
}

function paisley(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number, fill: string, line: string, dot: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 22);
  ctx.bezierCurveTo(-20, 18, -22, -6, -6, -16);
  ctx.bezierCurveTo(6, -24, 20, -18, 14, -30);
  ctx.bezierCurveTo(26, -18, 24, 14, 0, 22);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = line;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 14);
  ctx.bezierCurveTo(-12, 10, -12, -4, -2, -9);
  ctx.bezierCurveTo(8, -13, 14, -4, 6, 10);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = dot;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(-2 + Math.cos(i * 1.3) * 5, 2 + Math.sin(i * 1.3) * 5, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function blossom(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string, core: string): void {
  ctx.fillStyle = petal;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.ellipse(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6, r * 0.55, r * 0.32, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

const FABRIC_COLORS: Record<FabricKey, { base: string; motif: string; line: string; accent: string }> = {
  crimson: { base: '#8e1b2b', motif: '#b8323f', line: '#e8b85a', accent: '#f3e3b8' },
  royal: { base: '#1d3f73', motif: '#2d5a96', line: '#e7c267', accent: '#f1e6c8' },
  emerald: { base: '#1e5a44', motif: '#2d7657', line: '#e9c46a', accent: '#f4e8c6' },
  saffron: { base: '#c46a1c', motif: '#d98532', line: '#7a1d24', accent: '#f6e3b0' },
};

/** Kashmiri-style embroidered canopy cloth: staggered paisleys and small blossoms. */
function fabricTexture(key: FabricKey, anisotropy: number): THREE.Texture {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const col = FABRIC_COLORS[key];
  const rng = new Rng(key.length * 97);
  ctx.fillStyle = col.base;
  ctx.fillRect(0, 0, S, S);
  weave(ctx, S, S, rng, 0.08);
  const step = S / 4;
  for (let gy = 0; gy < 4; gy++) {
    for (let gx = 0; gx < 4; gx++) {
      const x = gx * step + (gy % 2 ? step / 2 : 0) + step / 4;
      const y = gy * step + step / 2;
      tiled(S, S, x, y, 60, (px, py) => paisley(ctx, px, py, 1.25, (gx + gy) % 2 ? 0.5 : -0.4, col.motif, col.line, col.accent));
      tiled(S, S, x + step / 2, y + step / 2, 20, (px, py) => blossom(ctx, px, py, 8, col.accent, col.line));
    }
  }
  return canvasTexture(c, anisotropy);
}

/** Embroidered border for the canopy valance; tiles horizontally. */
function valanceTexture(key: FabricKey, anisotropy: number): THREE.Texture {
  const W = 1024;
  const H = 128;
  const [c, ctx] = makeCanvas(W, H);
  const col = FABRIC_COLORS[key];
  const rng = new Rng(7 + key.length);
  ctx.fillStyle = col.base;
  ctx.fillRect(0, 0, W, H);
  weave(ctx, W, H, rng, 0.07);
  // Gold braid along the top.
  ctx.fillStyle = col.line;
  ctx.fillRect(0, 8, W, 6);
  ctx.fillRect(0, 22, W, 2);
  // Chain of arches with blossoms, 8 per tile.
  const n = 8;
  for (let i = 0; i < n; i++) {
    const cx = (i + 0.5) * (W / n);
    ctx.strokeStyle = col.line;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, 76, 44, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    blossom(ctx, cx, 64, 13, col.accent, col.line);
    paisley(ctx, cx - 40, 92, 0.55, -0.6, col.motif, col.line, col.accent);
    paisley(ctx, cx + 40, 92, 0.55, 0.6, col.motif, col.line, col.accent);
  }
  ctx.fillStyle = col.line;
  ctx.fillRect(0, H - 14, W, 4);
  return canvasTexture(c, anisotropy);
}

/** Namda-style felted rug for cushions and the deck carpet. */
function carpetTexture(anisotropy: number): THREE.Texture {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const rng = new Rng(51);
  ctx.fillStyle = '#e8dcc2';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = `rgba(${120 + rng.int(0, 60)},${90 + rng.int(0, 40)},${60 + rng.int(0, 30)},0.06)`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 4), 1);
  }
  const palette = ['#a8322c', '#2f5d7c', '#c9862b', '#3f6b3a', '#7a2d55'];
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const petal = rng.pick(palette);
    tiled(S, S, x, y, 40, (px, py) => {
      ctx.strokeStyle = '#4e6b3a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.quadraticCurveTo(px + 14, py + 18, px + 4, py + 34);
      ctx.stroke();
      ctx.fillStyle = '#5d7d3f';
      ctx.beginPath();
      ctx.ellipse(px + 10, py + 20, 7, 3, 0.9, 0, Math.PI * 2);
      ctx.fill();
      blossom(ctx, px, py, 11, petal, '#f0c75a');
    });
  }
  return canvasTexture(c, anisotropy);
}

function woolTexture(anisotropy: number): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const rng = new Rng(9);
  ctx.fillStyle = '#9a9a9a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 7000; i++) {
    const v = rng.int(120, 190);
    ctx.fillStyle = `rgba(${v},${v},${v},0.25)`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1, rng.range(2, 6));
  }
  // Embroidered neckline band (tilak) near the top of the tile.
  ctx.fillStyle = 'rgba(210,170,90,0.55)';
  for (let x = 0; x < S; x += 6) ctx.fillRect(x, 10, 3, 3);
  return canvasTexture(c, anisotropy);
}

/** Alpha-cut grass blades; tip at the top of the texture. */
function grassTexture(anisotropy: number, reeds: boolean): THREE.Texture {
  const W = reeds ? 128 : 256;
  const H = 512;
  const [c, ctx] = makeCanvas(W, H);
  const rng = new Rng(reeds ? 31 : 17);
  const blades = reeds ? 16 : 46;
  for (let i = 0; i < blades; i++) {
    const x0 = rng.range(W * 0.1, W * 0.9);
    const h = rng.range(H * (reeds ? 0.6 : 0.4), H * 0.98);
    const bend = rng.range(-W * 0.22, W * 0.22);
    const wBase = rng.range(4, reeds ? 7 : 9);
    const g = ctx.createLinearGradient(0, H, 0, H - h);
    const hue = reeds ? rng.range(58, 76) : rng.range(72, 98);
    const light = rng.range(reeds ? 30 : 28, reeds ? 42 : 40);
    g.addColorStop(0, `hsl(${hue - 10}, 45%, ${light - 12}%)`);
    g.addColorStop(0.55, `hsl(${hue}, 48%, ${light}%)`);
    g.addColorStop(1, `hsl(${hue - 25}, 55%, ${light + 22}%)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x0 - wBase, H);
    ctx.quadraticCurveTo(x0 - wBase * 0.6 + bend * 0.4, H - h * 0.55, x0 + bend, H - h);
    ctx.quadraticCurveTo(x0 + wBase * 0.6 + bend * 0.4, H - h * 0.55, x0 + wBase, H);
    ctx.closePath();
    ctx.fill();
    if (reeds && rng.chance(0.2)) {
      // Cattail seed head.
      ctx.fillStyle = '#5a3a22';
      ctx.beginPath();
      ctx.ellipse(x0 + bend * 0.8, H - h * 0.86, 4, 16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = canvasTexture(c, anisotropy);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** A single broad leaf (collard / haakh) with veins, for rosette plants. */
function leafTexture(anisotropy: number): THREE.Texture {
  const S = 256;
  const [c, ctx] = makeCanvas(S, S);
  const g = ctx.createLinearGradient(0, S, 0, 0);
  g.addColorStop(0, '#5a8a3a');
  g.addColorStop(1, '#94c060');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(S / 2, S - 4);
  ctx.bezierCurveTo(S * 0.02, S * 0.7, S * 0.08, S * 0.12, S / 2, 6);
  ctx.bezierCurveTo(S * 0.92, S * 0.12, S * 0.98, S * 0.7, S / 2, S - 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(210,230,170,0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(S / 2, S - 4);
  ctx.lineTo(S / 2, 18);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 8; i++) {
    const y = S - 20 - i * 28;
    ctx.beginPath();
    ctx.moveTo(S / 2, y);
    ctx.quadraticCurveTo(S / 2 - 40, y - 6, S / 2 - 70 + i * 4, y - 26);
    ctx.moveTo(S / 2, y);
    ctx.quadraticCurveTo(S / 2 + 40, y - 6, S / 2 + 70 - i * 4, y - 26);
    ctx.stroke();
  }
  const t = canvasTexture(c, anisotropy);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export async function loadTextureLibrary(renderer: THREE.WebGLRenderer): Promise<TextureLibrary> {
  const loader = new THREE.TextureLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const missing: string[] = [];
  const [hullWood, deckWood, mud, rock] = await Promise.all([
    loadSet(loader, 'dark_planks', ['diff', 'nor_gl', 'rough'], aniso, missing),
    loadSet(loader, 'brown_planks_07', ['diff', 'nor_gl'], aniso, missing),
    loadSet(loader, 'brown_mud_rocks_01', ['diff', 'nor_gl'], aniso, missing),
    loadSet(loader, 'rock_boulder_dry', ['diff', 'nor_gl'], aniso, missing),
  ]);
  if (missing.length) console.warn('[textures] falling back to plain colours for:', missing);

  const keys: FabricKey[] = ['crimson', 'royal', 'emerald', 'saffron'];
  const fabric = {} as Record<FabricKey, THREE.Texture>;
  const valance = {} as Record<FabricKey, THREE.Texture>;
  for (const k of keys) {
    fabric[k] = fabricTexture(k, aniso);
    valance[k] = valanceTexture(k, aniso);
  }
  return {
    hullWood,
    deckWood,
    mud,
    rock,
    fabric,
    valance,
    carpet: carpetTexture(aniso),
    wool: woolTexture(aniso),
    grass: grassTexture(aniso, false),
    reed: grassTexture(aniso, true),
    leaf: leafTexture(aniso),
    missing,
  };
}
