import * as THREE from 'three';
import { Rng } from '../core/math';

/**
 * Tileable wind-ripple slope map built from integer-frequency sine waves, so it
 * repeats seamlessly. RG store surface slope in x/z; nothing is downloaded.
 */
export function createRippleNormalMap(size = 256, seed = 11): THREE.DataTexture {
  const rng = new Rng(seed);
  const wind = 0.6; // prevailing wind direction (radians)
  const waves: { kx: number; ky: number; amp: number; ph: number }[] = [];
  while (waves.length < 30) {
    const kx = Math.round((rng.next() * 2 - 1) * 16);
    const ky = Math.round((rng.next() * 2 - 1) * 16);
    const k = Math.hypot(kx, ky);
    if (k < 1.5) continue;
    const align = Math.abs(Math.cos(Math.atan2(ky, kx) - wind));
    waves.push({ kx, ky, amp: (0.35 + 0.65 * align) / Math.pow(k, 1.35), ph: rng.next() * Math.PI * 2 });
  }

  const sx = new Float32Array(size * size);
  const sy = new Float32Array(size * size);
  let maxS = 1e-6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const a = Math.PI * 2 * (w.kx * u + w.ky * v) + w.ph;
        const c = Math.cos(a) * w.amp;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const i = y * size + x;
      sx[i] = dx;
      sy[i] = dy;
      maxS = Math.max(maxS, Math.abs(dx), Math.abs(dy));
    }
  }

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round((sx[i] / maxS) * 127.5 + 127.5);
    data[i * 4 + 1] = Math.round((sy[i] / maxS) * 127.5 + 127.5);
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function drawNameBoard(ctx: CanvasRenderingContext2D, y0: number, w: number, h: number, name: string, bg: string, fg: string): void {
  ctx.save();
  ctx.translate(0, y0);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg;
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 16, w - 32, h - 32);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 22px Georgia, "Times New Roman", serif';
  ctx.fillText('H.B.', 58, h / 2 + 1);
  ctx.fillText('H.B.', w - 58, h / 2 + 1);
  ctx.font = 'italic 600 46px Georgia, "Times New Roman", serif';
  ctx.fillText(name, w / 2, h / 2 + 3, w - 150);
  ctx.restore();
}

/**
 * Hand-painted name boards for every houseboat, stacked in one texture so all
 * the boards share a single material (and draw call). Row i spans
 * v = 1 - (i + 1) / n .. 1 - i / n.
 */
export function createNameBoardAtlas(boards: { name: string; bg: string; fg: string }[]): THREE.CanvasTexture {
  const w = 512;
  const h = 112;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h * boards.length;
  const ctx = canvas.getContext('2d');
  if (ctx) boards.forEach((b, i) => drawNameBoard(ctx, i * h, w, h, b.name, b.bg, b.fg));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
