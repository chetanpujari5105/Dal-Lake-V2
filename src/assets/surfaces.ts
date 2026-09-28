import * as THREE from 'three';
import { Rng } from '../core/math';

// Painted building surfaces (tin, brick, plaster, lawn) and a triplanar patch so
// merged, UV-less geometry still gets real-scale texture detail. All original.

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function speckle(ctx: CanvasRenderingContext2D, S: number, rng: Rng, n: number, a: number): void {
  for (let i = 0; i < n; i++) {
    const v = rng.chance(0.5) ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${(rng.next() * a).toFixed(3)})`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 3), rng.range(1, 4));
  }
}

/** Corrugated tin, near-white so vertex colour sets the paint (green, red, grey). */
export function tinTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(5);
  for (let x = 0; x < S; x++) {
    const v = 175 + 60 * Math.sin((x / S) * Math.PI * 2 * 16);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(x, 0, 1, S);
  }
  // Rust streaks running down the flutes and faded sheet seams.
  for (let i = 0; i < 40; i++) {
    const x = rng.range(0, S);
    const g = ctx.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, 'rgba(120,60,30,0)');
    g.addColorStop(1, `rgba(120,60,30,${rng.range(0.1, 0.3).toFixed(2)})`);
    ctx.fillStyle = g;
    ctx.fillRect(x, rng.range(0, S * 0.5), rng.range(1, 3), S);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, S / 2, S, 2);
  speckle(ctx, S, rng, 2500, 0.08);
  return tex(c);
}

/** Kashmiri brickwork with timber bands (taaq-style), tinted by vertex colour. */
export function brickTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(8);
  ctx.fillStyle = '#b9b0a4';
  ctx.fillRect(0, 0, S, S);
  const bh = 16;
  for (let row = 0; row * bh < S; row++) {
    const y = row * bh;
    if (row % 12 === 11) {
      // A timber lacing band every few courses.
      ctx.fillStyle = '#5a4432';
      ctx.fillRect(0, y, S, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let x = 0; x < S; x += 64) ctx.fillRect(x, y, 2, bh);
      continue;
    }
    const off = row % 2 ? 0 : 20;
    for (let x = -off; x < S; x += 40) {
      const v = rng.range(-22, 18);
      ctx.fillStyle = `rgb(${196 + v},${148 + v},${118 + v})`;
      ctx.fillRect(x + 1, y + 1, 38, bh - 2);
    }
  }
  speckle(ctx, S, rng, 6000, 0.08);
  return tex(c);
}

/** Lime plaster with soft staining. */
export function plasterTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(12);
  ctx.fillStyle = '#e6e0d4';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    const r = rng.range(10, 60);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r, r * rng.range(0.6, 2));
    g.addColorStop(0, `rgba(120,105,85,${rng.range(0.04, 0.12).toFixed(2)})`);
    g.addColorStop(1, 'rgba(120,105,85,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  speckle(ctx, S, rng, 3000, 0.06);
  return tex(c);
}

/** Mown lawn with stripes and clover patches, for the Mughal garden terraces. */
export function lawnTexture(): THREE.CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas(S, S);
  const rng = new Rng(14);
  ctx.fillStyle = '#8fae5a';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const l = rng.range(30, 52);
    ctx.fillStyle = `hsla(${rng.range(70, 100).toFixed(0)}, 45%, ${l.toFixed(0)}%, 0.5)`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), 1, rng.range(2, 5));
  }
  return tex(c);
}

/**
 * Replaces the material's map lookup with a triplanar projection in object
 * space (metres / `scale`), blended by the surface normal. Vertex colours and
 * everything else are untouched. `gain` normalises a dark photo texture to about 1
 * so vertex colours keep their painted value; `strength` blends texture detail in.
 */
export function triplanar<T extends THREE.MeshStandardMaterial | THREE.MeshLambertMaterial>(mat: T, scale: number, key: string, gain = 1, strength = 1): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev.call(mat, shader, r);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNor;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTpPos = position;\nvTpNor = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNor;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec3 tw = pow(abs(normalize(vTpNor)), vec3(4.0));
          tw /= (tw.x + tw.y + tw.z);
          vec3 tpp = vTpPos / ${scale.toFixed(3)};
          vec4 tx = texture2D(map, tpp.zy);
          vec4 ty = texture2D(map, tpp.xz);
          vec4 tz = texture2D(map, tpp.xy);
          vec4 tsum = tx * tw.x + ty * tw.y + tz * tw.z;
          diffuseColor.rgb *= mix(vec3(1.0), tsum.rgb * ${gain.toFixed(3)}, ${strength.toFixed(3)});
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => `triplanar-${key}-${scale}-${gain}-${strength}`;
  return mat;
}
