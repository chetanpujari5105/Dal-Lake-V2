import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedUniforms } from '../atmosphere/presets';
import { Rng } from '../core/math';

// Trees are built from alpha-cut leaf-cluster cards arranged over a few crown
// lobes, with normals pointing out from the crown centre so the canopy shades
// like a soft volume instead of faceted polygons. Beyond the near range each
// tree is swapped for a painted crossed-billboard impostor (6 triangles).
//
// Both textures are painted on canvas at load time; nothing is downloaded.

export type SpeciesId = 'chinar' | 'poplar' | 'willow' | 'deodar' | 'cypress' | 'shrub' | 'walnut';

/** Card atlas quadrants (u0, v0) in 0..1; each is 0.5 x 0.5. */
const Q = {
  broad: [0, 0.5],
  small: [0.5, 0.5],
  needle: [0, 0],
  weep: [0.5, 0],
} as const;
type Quad = keyof typeof Q;
/** An opaque patch in the atlas corner that trunks sample, so shadows keep them solid. */
const BARK_UV: [number, number] = [0.985, 0.015];

export const IMPOSTOR_SLOTS: SpeciesId[] = ['chinar', 'poplar', 'willow', 'deodar', 'cypress', 'shrub', 'walnut'];
const SLOT_W = 1 / 8; // 8 slots across a 2048 x 512 atlas (one spare)
/** Impostor quad is 1 wide by IMP_ASPECT tall (matches a 256 x 512 slot). */
export const IMP_ASPECT = 2;

// ---------------------------------------------------------------------------
// Painted textures

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

/** Light, slightly green leaf tones; the hue comes from per-instance tint. */
function leafTone(rng: Rng, depth: number): string {
  const l = 38 + (1 - depth) * 34 + rng.range(-6, 6);
  const h = 78 + rng.range(-14, 14);
  const s = 22 + rng.range(-8, 10);
  return `hsl(${h.toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;
}

function palmateLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, fill: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = fill;
  ctx.beginPath();
  // Five pointed lobes, like a plane-tree (chinar) leaf.
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + ((i - 5) / 10) * Math.PI * 1.7;
    const rr = i % 2 === 0 ? r : r * 0.55;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(0, r * 0.25);
    ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,50,20,0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + ((i - 2) / 4) * Math.PI * 0.85;
    ctx.moveTo(0, r * 0.2);
    ctx.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
  }
  ctx.stroke();
  ctx.restore();
}

function ovalLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

/** A cluster of leaves filling a rough disc, darker toward its lower centre. */
function paintCluster(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, kind: 'broad' | 'small', rng: Rng): void {
  const cx = ox + S / 2;
  const cy = oy + S / 2;
  const R = S * 0.46;
  const n = kind === 'broad' ? 150 : 520;
  // Twigs first so leaves sit on top.
  ctx.strokeStyle = 'rgba(70,58,44,0.9)';
  ctx.lineWidth = kind === 'broad' ? 3 : 2;
  for (let i = 0; i < 9; i++) {
    const a = rng.range(0, Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(cx + rng.range(-8, 8), cy + R * 0.9);
    ctx.quadraticCurveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3, cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8);
    ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    // Painter's order from back (dark) to front (light).
    const depth = 1 - i / n;
    const a = rng.range(0, Math.PI * 2);
    const rr = Math.sqrt(rng.next()) * R * (0.55 + 0.45 * (1 - depth * 0.5));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * 0.92;
    const edge = rr / R;
    const d = Math.min(1, depth * 0.7 + (y - oy) / S * 0.35 - edge * 0.15);
    if (kind === 'broad') palmateLeaf(ctx, x, y, rng.range(S * 0.045, S * 0.075), rng.range(0, Math.PI * 2), leafTone(rng, d));
    else ovalLeaf(ctx, x, y, rng.range(S * 0.012, S * 0.022), rng.range(S * 0.025, S * 0.04), rng.range(0, Math.PI * 2), leafTone(rng, d));
  }
}

function paintNeedles(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, rng: Rng): void {
  // A drooping deodar spray: a main twig with fine needle tufts along it.
  for (let k = 0; k < 7; k++) {
    const y0 = oy + S * (0.2 + k * 0.1);
    const x0 = ox + S * rng.range(0.1, 0.2);
    const x1 = ox + S * rng.range(0.8, 0.92);
    const sag = S * rng.range(0.06, 0.14);
    ctx.strokeStyle = 'rgba(70,56,40,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, y0 - sag * 0.3, x1, y0 + sag);
    ctx.stroke();
    for (let i = 0; i < 70; i++) {
      const t = rng.next();
      const x = x0 + (x1 - x0) * t;
      const y = y0 + sag * t * t - sag * 0.3 * 4 * t * (1 - t) * 0.5;
      const depth = rng.next();
      ctx.strokeStyle = leafTone(rng, 0.25 + depth * 0.6);
      ctx.lineWidth = 1.4;
      for (let j = 0; j < 5; j++) {
        const a = Math.PI / 2 + rng.range(-1.1, 1.1);
        const l = S * rng.range(0.02, 0.045) * (1 - t * 0.4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  }
}

function paintWeeping(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, rng: Rng): void {
  // Long willow strands hanging from the top edge.
  for (let k = 0; k < 26; k++) {
    const x0 = ox + S * rng.range(0.08, 0.92);
    const len = S * rng.range(0.55, 0.95);
    const drift = S * rng.range(-0.05, 0.05);
    ctx.strokeStyle = 'rgba(96,88,52,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x0, oy + 2);
    ctx.quadraticCurveTo(x0 + drift, oy + len * 0.5, x0 + drift * 1.6, oy + len);
    ctx.stroke();
    for (let i = 0; i < 40; i++) {
      const t = rng.next();
      const x = x0 + drift * 1.6 * t * t + rng.range(-3, 3);
      const y = oy + 2 + len * t;
      ovalLeaf(ctx, x, y, S * 0.006, S * 0.03, rng.range(-0.5, 0.5), leafTone(rng, 0.2 + rng.next() * 0.6));
    }
  }
}

export function createCardAtlas(anisotropy: number): THREE.Texture {
  const S = 1024;
  const H = S / 2;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(4242);
  // Canvas y grows down; texture v grows up (flipY), so quadrant v0=0.5 is the top half.
  paintCluster(ctx, 0, 0, H, 'broad', rng);
  paintCluster(ctx, H, 0, H, 'small', rng);
  paintNeedles(ctx, 0, H, H, rng);
  paintWeeping(ctx, H, H, H, rng);
  // Opaque bark patch in the bottom-right corner (see BARK_UV).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(S - 40, S - 40, 40, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** A painted, softly shaded side view of each species for the far impostors. */
export function createImpostorAtlas(anisotropy: number): THREE.Texture {
  const W = 2048;
  const H = 512;
  const [c, ctx] = canvas(W, H);
  const rng = new Rng(777);
  const sw = W * SLOT_W;
  IMPOSTOR_SLOTS.forEach((sp, i) => paintImpostor(ctx, i * sw, 0, sw, H, sp, rng));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, light: number, rng: Rng, fine: number): void {
  // A leafy blob: a shaded disc broken up by small leaf dabs at its rim.
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  const hi = Math.round(150 + light * 70);
  const lo = Math.round(55 + light * 45);
  g.addColorStop(0, `rgb(${hi},${hi + 8},${hi - 30})`);
  g.addColorStop(1, `rgb(${lo},${lo + 10},${lo - 18})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < fine; i++) {
    const a = rng.range(0, Math.PI * 2);
    const rr = r * rng.range(0.6, 1.02);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    const top = Math.max(0, -Math.sin(a));
    const v = Math.round(lo + (hi - lo) * (0.35 + 0.5 * top) + rng.range(-12, 12));
    ctx.fillStyle = `rgb(${v},${v + 8},${v - 24})`;
    ctx.beginPath();
    ctx.arc(px, py, r * rng.range(0.07, 0.16), 0, Math.PI * 2);
    ctx.fill();
  }
}

function trunkStroke(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, w0: number, w1: number, col: string): void {
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(x - w0 / 2, y0);
  ctx.lineTo(x - w1 / 2, y1);
  ctx.lineTo(x + w1 / 2, y1);
  ctx.lineTo(x + w0 / 2, y0);
  ctx.closePath();
  ctx.fill();
}

function paintImpostor(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, sp: SpeciesId, rng: Rng): void {
  const cx = ox + w / 2;
  const base = oy + h - 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox + 1, oy + 1, w - 2, h - 2);
  ctx.clip();
  const bark = '#6d6152';
  const crowns: [number, number, number][] = []; // x, y, r in slot pixels
  // Crown blobs are placed in a species envelope; later blobs are drawn over earlier ones.
  const envelope = (count: number, fn: (t: number) => [number, number, number]) => {
    for (let i = 0; i < count; i++) crowns.push(fn(i / count));
  };
  switch (sp) {
    case 'chinar':
    case 'walnut': {
      trunkStroke(ctx, cx, base, base - h * 0.42, w * 0.11, w * 0.06, bark);
      const top = base - h * 0.62;
      envelope(46, () => {
        const a = rng.range(Math.PI, Math.PI * 2);
        const rr = Math.sqrt(rng.next());
        return [cx + Math.cos(a) * rr * w * 0.4, top + 30 + Math.sin(a) * rr * h * 0.28 + rng.range(0, h * 0.12), rng.range(w * 0.1, w * 0.17)];
      });
      break;
    }
    case 'poplar': {
      trunkStroke(ctx, cx, base, base - h * 0.3, w * 0.05, w * 0.03, bark);
      envelope(40, (t) => {
        const y = base - h * (0.08 + t * 0.88);
        const prof = Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95)) * 0.9 + 0.1;
        return [cx + rng.range(-1, 1) * w * 0.13 * prof, y, w * rng.range(0.08, 0.13) * (0.5 + prof * 0.6)];
      });
      break;
    }
    case 'cypress': {
      trunkStroke(ctx, cx, base, base - h * 0.1, w * 0.05, w * 0.04, bark);
      envelope(34, (t) => {
        const y = base - h * (0.05 + t * 0.9);
        const prof = Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.92)) * (1 - t * 0.4);
        return [cx + rng.range(-1, 1) * w * 0.1 * prof, y, w * rng.range(0.07, 0.11) * (0.4 + prof * 0.7)];
      });
      break;
    }
    case 'deodar': {
      trunkStroke(ctx, cx, base, oy + h * 0.06, w * 0.06, w * 0.01, '#4f4336');
      // Tiered, drooping skirts narrowing to a leader.
      const tiers = 9;
      for (let k = 0; k < tiers; k++) {
        const t = k / (tiers - 1);
        const y = base - h * (0.1 + t * 0.82);
        const half = w * (0.46 * (1 - t) + 0.05);
        for (let j = 0; j < 12; j++) {
          const f = rng.range(-1, 1);
          crowns.push([cx + f * half, y + Math.abs(f) * h * 0.035 + rng.range(-4, 4), w * rng.range(0.05, 0.08) * (1 - t * 0.5)]);
        }
      }
      break;
    }
    case 'willow': {
      trunkStroke(ctx, cx, base, base - h * 0.3, w * 0.09, w * 0.06, bark);
      const top = base - h * 0.52;
      envelope(34, () => {
        const a = rng.range(Math.PI * 1.05, Math.PI * 1.95);
        const rr = Math.sqrt(rng.next());
        return [cx + Math.cos(a) * rr * w * 0.38, top + 20 + Math.sin(a) * rr * h * 0.18, rng.range(w * 0.09, w * 0.14)];
      });
      break;
    }
    case 'shrub': {
      envelope(30, () => {
        const a = rng.range(Math.PI, Math.PI * 2);
        const rr = Math.sqrt(rng.next());
        return [cx + Math.cos(a) * rr * w * 0.4, base - 20 + Math.sin(a) * rr * h * 0.2, rng.range(w * 0.08, w * 0.14)];
      });
      break;
    }
  }
  // Back-to-front by height so upper blobs catch the light on top.
  crowns.sort((a, b) => b[1] - a[1]);
  const minY = Math.min(...crowns.map((c) => c[1]));
  const maxY = Math.max(...crowns.map((c) => c[1]));
  for (const [x, y, r] of crowns) {
    const light = 1 - (y - minY) / Math.max(1, maxY - minY);
    blob(ctx, x, y, r, 0.25 + light * 0.75, rng, sp === 'deodar' || sp === 'cypress' ? 10 : 16);
  }
  if (sp === 'willow') {
    // Hanging curtains of strands below the crown.
    for (let i = 0; i < 60; i++) {
      const x = cx + rng.range(-0.44, 0.44) * w;
      const y0 = base - h * rng.range(0.45, 0.6);
      const len = h * rng.range(0.2, 0.36);
      const v = Math.round(rng.range(95, 150));
      ctx.strokeStyle = `rgba(${v},${v + 10},${v - 30},0.9)`;
      ctx.lineWidth = rng.range(2, 4);
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x + rng.range(-4, 4), y0 + len);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Geometry

interface Lobe {
  c: THREE.Vector3;
  r: THREE.Vector3;
}

class TreeBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  fol: number[] = [];
  idx: number[] = [];
  constructor(private rng: Rng) {}

  private vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, shade: number, tint: number, tex: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(shade, shade, shade);
    this.fol.push(tint, tex);
    return this.pos.length / 3 - 1;
  }

  /**
   * A leaf card centred at `p`, facing roughly `facing`, sampling atlas quadrant `quad`.
   * Normals follow the crown volume (from `centre`) so cards light as one canopy.
   */
  card(p: THREE.Vector3, facing: THREE.Vector3, size: number, quad: Quad, centre: THREE.Vector3, shade: number, hang = false): void {
    const rng = this.rng;
    const n = facing.clone().normalize();
    let t: THREE.Vector3;
    if (hang) {
      t = new THREE.Vector3(-n.z, 0, n.x).normalize();
    } else {
      const ref = Math.abs(n.y) < 0.9 ? _up : _x;
      t = new THREE.Vector3().crossVectors(ref, n).normalize().applyAxisAngle(n, rng.range(0, Math.PI * 2));
    }
    const b = new THREE.Vector3().crossVectors(n, t).normalize();
    const hw = size / 2;
    const hh = hang ? size : size / 2;
    const [u0, v0] = Q[quad];
    // Weeping cards skip the quadrant's bottom strip, where the opaque bark patch lives.
    const vIn = quad === 'weep' ? 0.07 : 0;
    const corners: [number, number, number, number][] = [
      [-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1],
    ];
    const base = this.pos.length / 3;
    for (const [sx, sy, cu, cv] of corners) {
      const q = p.clone().addScaledVector(t, sx * hw);
      if (hang) q.addScaledVector(_up, (sy - 1) * hh);
      else q.addScaledVector(b, sy * hh);
      const vn = q.clone().sub(centre).normalize().multiplyScalar(0.75).addScaledVector(n, 0.25).addScaledVector(_up, 0.15).normalize();
      this.vert(q, vn, u0 + cu * 0.5, v0 + vIn + cv * (0.5 - vIn), shade, 1, 1);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Tapered limb between two points, `sides` facets, bark coloured, untextured. */
  limb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sides: number, color: THREE.Color): void {
    const dir = b.clone().sub(a);
    const len = dir.length();
    dir.normalize();
    const ref = Math.abs(dir.y) < 0.95 ? _up : _x;
    const t = new THREE.Vector3().crossVectors(ref, dir).normalize();
    const bn = new THREE.Vector3().crossVectors(dir, t).normalize();
    const base = this.pos.length / 3;
    for (let ring = 0; ring < 2; ring++) {
      const c = ring === 0 ? a : b;
      const r = ring === 0 ? ra : rb;
      for (let i = 0; i <= sides; i++) {
        const ang = (i / sides) * Math.PI * 2;
        const n = t.clone().multiplyScalar(Math.cos(ang)).addScaledVector(bn, Math.sin(ang));
        const p = c.clone().addScaledVector(n, r);
        this.pos.push(p.x, p.y, p.z);
        this.nor.push(n.x, n.y, n.z);
        this.uv.push(BARK_UV[0], BARK_UV[1]);
        const k = ring === 0 ? 0.8 : 1;
        this.col.push(color.r * k, color.g * k, color.b * k);
        this.fol.push(0, 0);
      }
    }
    for (let i = 0; i < sides; i++) {
      const a0 = base + i;
      const b0 = base + sides + 1 + i;
      this.idx.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
    }
    void len;
  }

  /** Scatter cards over the surface of each lobe. */
  lobes(lobes: Lobe[], cardsPerM2: number, size: [number, number], quad: Quad, centre: THREE.Vector3, minCards = 6): void {
    const rng = this.rng;
    const ymin = Math.min(...lobes.map((l) => l.c.y - l.r.y));
    const ymax = Math.max(...lobes.map((l) => l.c.y + l.r.y));
    for (const l of lobes) {
      const area = 4 * Math.PI * Math.pow((l.r.x * l.r.y + l.r.y * l.r.z + l.r.x * l.r.z) / 3, 0.5) ** 2 / 4;
      const n = Math.max(minCards, Math.round(area * cardsPerM2));
      for (let i = 0; i < n; i++) {
        const dir = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.6, 1), rng.range(-1, 1)).normalize();
        const depth = rng.range(0.55, 1.0);
        const p = l.c.clone().add(new THREE.Vector3(dir.x * l.r.x, dir.y * l.r.y, dir.z * l.r.z).multiplyScalar(depth));
        const facing = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(0.5));
        const hgt = (p.y - ymin) / Math.max(0.01, ymax - ymin);
        // Inner and lower cards sit in the canopy's own shade.
        const shade = 0.5 + 0.3 * hgt + 0.25 * (depth - 0.55) / 0.45;
        this.card(p, facing, rng.range(size[0], size[1]), quad, centre, Math.min(1.05, shade));
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFol', new THREE.Float32BufferAttribute(this.fol, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(1, 0, 0);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface SpeciesModel {
  near: THREE.BufferGeometry;
  /** Impostor height in metres at instance scale 1 (width is height / IMP_ASPECT). */
  height: number;
  slot: number;
  /** Radius for frustum tests at instance scale 1. */
  radius: number;
}

/** Near-range geometry for one species. `density` scales card counts (quality tier). */
export function buildSpecies(sp: SpeciesId, density: number, seed: number): SpeciesModel {
  const rng = new Rng(seed);
  const b = new TreeBuilder(rng);
  const slot = IMPOSTOR_SLOTS.indexOf(sp);
  const d = density;
  switch (sp) {
    case 'chinar': {
      // Oriental plane: a short massive bole splitting into spreading limbs under a broad dome.
      const bark = new THREE.Color('#8a7d6c');
      const centre = v3(0, 10.5, 0);
      b.limb(v3(0, -0.3, 0), v3(0, 4.5, 0), 0.75, 0.55, 9, bark);
      b.limb(v3(0, 4.3, 0), v3(0.3, 8.5, 0.2), 0.5, 0.25, 7, bark);
      const lobes: Lobe[] = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const r = rng.range(3.2, 5.2);
        const c = v3(Math.cos(a) * r, rng.range(8.5, 11.5), Math.sin(a) * r);
        lobes.push({ c, r: v3(rng.range(2.8, 3.6), rng.range(2.2, 2.9), rng.range(2.8, 3.6)) });
        b.limb(v3(0, 4.3, 0), c.clone().multiplyScalar(0.75).setY(c.y - 1.5), 0.36, 0.14, 6, bark);
      }
      lobes.push({ c: v3(0, 12.6, 0), r: v3(3.6, 2.6, 3.6) });
      // A lower skirt of foliage so the crown is deep and the limbs mostly hidden.
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4 + rng.range(-0.3, 0.3);
        const r = rng.range(4.2, 5.8);
        lobes.push({ c: v3(Math.cos(a) * r, rng.range(5.8, 7.0), Math.sin(a) * r), r: v3(2.8, 1.9, 2.8) });
      }
      lobes.push({ c: v3(0, 7.2, 0), r: v3(2.4, 1.6, 2.4) });
      b.lobes(lobes, 0.95 * d, [1.7, 2.5], 'broad', centre);
      return { near: b.build(), height: 16, slot, radius: 10 };
    }
    case 'walnut': {
      const bark = new THREE.Color('#6f6557');
      const centre = v3(0, 7.5, 0);
      b.limb(v3(0, -0.3, 0), v3(0.2, 4, 0), 0.4, 0.3, 7, bark);
      const lobes: Lobe[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const c = v3(Math.cos(a) * 2.6, rng.range(6.5, 8.5), Math.sin(a) * 2.6);
        lobes.push({ c, r: v3(2.4, 2.0, 2.4) });
        b.limb(v3(0.2, 3.8, 0), c.clone().multiplyScalar(0.7), 0.2, 0.08, 5, bark);
      }
      lobes.push({ c: v3(0, 9.2, 0), r: v3(2.6, 1.8, 2.6) });
      b.lobes(lobes, 1.2 * d, [1.3, 2.0], 'small', centre);
      return { near: b.build(), height: 11.5, slot, radius: 6.5 };
    }
    case 'poplar': {
      // Lombardy poplar: a tall narrow flame of small leaves.
      const bark = new THREE.Color('#7d7466');
      const centre = v3(0, 10, 0);
      b.limb(v3(0, -0.3, 0), v3(0, 17, 0), 0.26, 0.06, 6, bark);
      const lobes: Lobe[] = [];
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const w = 1.0 + Math.sin(Math.PI * (0.2 + t * 0.8)) * 0.7;
        lobes.push({ c: v3(rng.range(-0.25, 0.25), 3.6 + t * 13, rng.range(-0.25, 0.25)), r: v3(w, 1.9, w) });
      }
      b.lobes(lobes, 1.5 * d, [1.1, 1.6], 'small', centre, 5);
      return { near: b.build(), height: 19, slot, radius: 9.5 };
    }
    case 'cypress': {
      const bark = new THREE.Color('#5a4c3e');
      const centre = v3(0, 4.5, 0);
      b.limb(v3(0, -0.2, 0), v3(0, 8, 0), 0.12, 0.04, 5, bark);
      const lobes: Lobe[] = [];
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const w = 0.35 + Math.sin(Math.PI * (0.15 + t * 0.85)) * 0.7 * (1 - t * 0.3);
        lobes.push({ c: v3(0, 1.4 + t * 6.6, 0), r: v3(w, 1.1, w) });
      }
      b.lobes(lobes, 2.6 * d, [0.8, 1.2], 'needle', centre, 5);
      return { near: b.build(), height: 9, slot, radius: 4.5 };
    }
    case 'deodar': {
      // Himalayan cedar: tiers of drooping, needle-laden branches around a straight bole.
      const bark = new THREE.Color('#5b4b3b');
      const centre = v3(0, 7, 0);
      b.limb(v3(0, -0.3, 0), v3(0, 15, 0), 0.4, 0.05, 6, bark);
      const tiers = 8;
      for (let k = 0; k < tiers; k++) {
        const t = k / (tiers - 1);
        const y = 2.4 + t * 11.5;
        const reach = 4.4 * (1 - t) + 0.7;
        const arms = Math.max(4, Math.round((5 + 4 * (1 - t)) * Math.min(1, d + 0.25)));
        for (let j = 0; j < arms; j++) {
          const a = (j / arms) * Math.PI * 2 + rng.range(-0.25, 0.25) + k;
          const dx = Math.cos(a);
          const dz = Math.sin(a);
          const tip = v3(dx * reach, y - reach * 0.22, dz * reach);
          b.limb(v3(0, y + 0.2, 0), tip, 0.09 * (1 - t) + 0.03, 0.02, 3, bark);
          // Sprays along the arm, lying nearly flat and drooping outward.
          const sprays = Math.max(2, Math.round(reach * 0.9 * d));
          for (let s = 0; s < sprays; s++) {
            const f = (s + 0.6) / sprays;
            const p = v3(dx * reach * f, y + 0.2 - reach * 0.22 * f * f, dz * reach * f);
            const facing = v3(dx * 0.35 + rng.range(-0.2, 0.2), 1, dz * 0.35 + rng.range(-0.2, 0.2));
            const shade = 0.55 + 0.4 * t + 0.1 * f;
            b.card(p, facing, rng.range(1.6, 2.3) * (1 - t * 0.35), 'needle', centre, shade);
          }
        }
      }
      b.card(v3(0, 14.6, 0), v3(1, 0.2, 0), 1.3, 'needle', centre, 1, false);
      return { near: b.build(), height: 16, slot, radius: 8 };
    }
    case 'willow': {
      // Weeping willow at the water's edge: a leaning trunk and curtains of strands.
      const bark = new THREE.Color('#6d604f');
      const centre = v3(0.6, 5.5, 0);
      b.limb(v3(0, -0.3, 0), v3(0.8, 3.4, 0), 0.42, 0.3, 7, bark);
      const lobes: Lobe[] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const c = v3(0.8 + Math.cos(a) * 2.4, rng.range(5.4, 6.6), Math.sin(a) * 2.4);
        lobes.push({ c, r: v3(2.2, 1.5, 2.2) });
        b.limb(v3(0.8, 3.3, 0), c.clone().setY(c.y - 0.8), 0.18, 0.06, 5, bark);
      }
      b.lobes(lobes, 1.0 * d, [1.2, 1.8], 'small', centre);
      const strands = Math.round(36 * d) + 8;
      for (let i = 0; i < strands; i++) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(2.6, 4.4);
        const p = v3(0.8 + Math.cos(a) * r, rng.range(5.6, 7.0), Math.sin(a) * r);
        b.card(p, v3(Math.cos(a), 0, Math.sin(a)), rng.range(1.6, 2.4), 'weep', centre, rng.range(0.7, 1.0), true);
      }
      return { near: b.build(), height: 9, slot, radius: 6 };
    }
    case 'shrub': {
      const centre = v3(0, 0.9, 0);
      const lobes: Lobe[] = [];
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        lobes.push({ c: v3(Math.cos(a) * 0.8, rng.range(0.8, 1.3), Math.sin(a) * 0.8), r: v3(1.1, 0.8, 1.1) });
      }
      b.lobes(lobes, 2.2 * d, [0.8, 1.2], 'small', centre, 5);
      return { near: b.build(), height: 2.6, slot, radius: 2 };
    }
  }
}

/** Three crossed vertical quads sampling a species' impostor slot via the instance's aSlot. */
export function impostorGeometry(): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(1, IMP_ASPECT, 1, 2).translate(0, IMP_ASPECT / 2, 0);
    g.rotateY((i / 3) * Math.PI);
    geos.push(g);
  }
  const g = mergeGeometries(geos)!;
  // Rounded crown normals: out from the canopy centre, tipped upward.
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const n = new THREE.Vector3(pos.getX(i) * 1.6, (pos.getY(i) - IMP_ASPECT * 0.55) * 0.6 + 0.35, pos.getZ(i) * 1.6).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Materials

function patchCommon(shader: THREE.WebGLProgramParametersWithUniforms, sway: string): void {
  shader.uniforms.uTime = sharedUniforms.uTime;
  shader.uniforms.uWind = sharedUniforms.uWind;
  shader.vertexShader = `uniform float uTime;\nuniform float uWind;\n${shader.vertexShader}`
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${sway}`);
  // Double-sided cards keep the crown normal on both faces; no dark backsides.
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <normal_fragment_begin>',
    THREE.ShaderChunk.normal_fragment_begin.split('normal *= faceDirection;').join('').split('normal = normal * faceDirection;').join(''),
  );
}

/** Near trees: vertex AO x per-instance tint (leaves only) x card atlas (leaves only). */
export function treeCardMaterial(map: THREE.Texture, alphaToCoverage: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
  mat.alphaToCoverage = alphaToCoverage;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aFol;\nvarying float vTex;')
      .replace(
        '#include <color_vertex>',
        `vColor = color;
        #ifdef USE_INSTANCING_COLOR
          vColor *= mix(vec3(1.0), instanceColor.xyz, aFol.x);
        #endif
        vTex = aFol.y;`,
      );
    patchCommon(
      shader,
      `vec2 ip = vec2(0.0);
      #ifdef USE_INSTANCING
        ip = instanceMatrix[3].xz;
      #endif
      float sw = sin(uTime * 0.9 + ip.x * 0.11 + ip.y * 0.07) + 0.5 * sin(uTime * 1.7 + ip.x * 0.23);
      float flutter = sin(uTime * 4.0 + position.x * 2.1 + position.z * 1.7 + position.y) * aFol.y;
      float k = max(position.y, 0.0) * 0.012 * uWind;
      transformed.x += sw * k + flutter * 0.04 * uWind;
      transformed.z += sw * k * 0.6 + flutter * 0.03 * uWind;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTex;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 texel = texture2D( map, vMapUv );
          diffuseColor *= mix(vec4(1.0), texel, vTex);
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `tree-cards-${alphaToCoverage}`;
  return mat;
}

/** Far impostors: one draw call for every species; aSlot picks the atlas column. */
export function impostorMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSlot;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2((aSlot + uv.x) * ${SLOT_W.toFixed(6)}, uv.y);\n#endif`);
    patchCommon(
      shader,
      `vec2 ip = instanceMatrix[3].xz;
      transformed.x += sin(uTime * 0.8 + ip.x * 0.1) * max(position.y - 0.4, 0.0) * 0.03 * uWind;`,
    );
  };
  mat.customProgramCacheKey = () => 'tree-impostor';
  return mat;
}
