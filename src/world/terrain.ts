import * as THREE from 'three';
import { clamp, fbm, Rng, smoothstep } from '../core/math';
import type { QualitySettings } from '../core/quality';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TextureLibrary } from '../assets/textureLibrary';
import { composeMatrix, MeshBuilder } from '../core/geometry';
import { GLSL_NOISE } from '../core/glslNoise';
import { BOULEVARD_X, GHAT, lakeSdf, NISHAT, terrainHeight } from './layout';

const C = {
  mud: new THREE.Color('#5a4c36'),
  grassA: new THREE.Color('#6f8a3c'),
  grassB: new THREE.Color('#8e9a48'),
  field: new THREE.Color('#b59d4c'),
  stone: new THREE.Color('#a39580'),
  forestA: new THREE.Color('#3d5731'),
  forestB: new THREE.Color('#2f4430'),
  rock: new THREE.Color('#7d7064'),
  snow: new THREE.Color('#d6dbe0'),
};

/**
 * Polar grid centred on the lake. Rings are dense near the shoreline and grow
 * sparse toward the mountains. The inner lowland and the outer ranges are
 * separate grids (the ranges need more segments around the circle to keep
 * ridgelines smooth), and each is split into angular sectors that share one
 * vertex buffer, so the sectors behind the camera are frustum-culled.
 */
export function buildTerrain(q: QualitySettings): THREE.Group {
  const high = q.tier === 'high';
  const group = new THREE.Group();
  group.name = 'terrain';
  const mat = terrainMaterial(high);

  const inner: number[] = [];
  for (let r = 150; r < 620; r += q.terrainRadialStep) inner.push(r);
  inner.push(620);
  const outer: number[] = [];
  for (let r = 620; r < 4200; r *= high ? 1.028 : 1.045) outer.push(r);
  outer.push(4200);

  addGrid(group, mat, inner, q.terrainAngular, 4, q);
  addGrid(group, mat, outer, high ? 720 : 400, 8, q);
  return group;
}

function addGrid(group: THREE.Group, mat: THREE.Material, radii: number[], segs: number, sectors: number, q: QualitySettings): void {
  const rings = radii.length;
  const count = rings * (segs + 1);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const masks = new Float32Array(count * 3);
  const sdfCache = new Float32Array(count);

  let k = 0;
  for (let i = 0; i < rings; i++) {
    const rr = radii[i];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      positions[k * 3] = x;
      positions[k * 3 + 1] = terrainHeight(x, z);
      positions[k * 3 + 2] = z;
      sdfCache[k] = rr < 520 ? lakeSdf(x, z) : 999;
      k++;
    }
  }

  const index: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + 1;
      const c = a + segs + 1;
      const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();

  const normals = geo.attributes.normal.array as Float32Array;
  const col = new THREE.Color();
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3];
    const h = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const ny = normals[v * 3 + 1];
    const d = sdfCache[v];
    const n = fbm(x * 0.02, z * 0.02, 3);
    const r = Math.hypot(x, z);

    col.copy(C.grassA).lerp(C.grassB, n);
    // Patchwork of mustard and paddy fields on the western plain.
    const fieldN = fbm(x * 0.006 + 40, z * 0.006, 2);
    if (x < 150 && h < 12 && fieldN > 0.56) col.lerp(C.field, smoothstep(0.56, 0.66, fieldN) * 0.7);
    // Wet, darker ground in the first few metres above the waterline, then grass.
    col.lerp(C.mud, (1 - smoothstep(0.1, 1.1, h + (d < 6 ? 0 : 2))) * 0.85);
    // Promenade and Nishat retaining walls read as stone.
    const onProm = x > 216 && x < 246 && Math.abs(z) < 250 && h < 2;
    const inNishat = x > NISHAT.x0 - 4 && x < NISHAT.x1 + 4 && z > NISHAT.z0 - 4 && z < NISHAT.z1 + 4;
    if (onProm && !inNishat) col.lerp(C.stone, 0.85);
    // Forested slopes, rock and a little snow on the far ranges only.
    const forest = smoothstep(14, 70, h) * (1 - smoothstep(420, 560, h)) * (0.55 + 0.45 * smoothstep(0.35, 0.6, fbm(x * 0.004 + 7, z * 0.004 - 3, 3)));
    col.lerp(n > 0.5 ? C.forestA : C.forestB, forest);
    const rocky = clamp(smoothstep(0.8, 0.58, ny) + smoothstep(380, 560, h), 0, 1) * (1 - forest * 0.6);
    col.lerp(C.rock, rocky * 0.8);
    const snowLine = 540 + (n - 0.5) * 140;
    const snow = smoothstep(snowLine, snowLine + 140, h) * smoothstep(0.5, 0.8, ny + 0.15) * smoothstep(1400, 2400, r);
    col.lerp(C.snow, snow);
    colors[v * 3] = col.r;
    colors[v * 3 + 1] = col.g;
    colors[v * 3 + 2] = col.b;
    masks[v * 3] = forest;
    masks[v * 3 + 1] = rocky * (1 - snow);
    masks[v * 3 + 2] = h < 12 && !onProm ? 1 - forest : 0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aMask', new THREE.BufferAttribute(masks, 3));

  // One mesh per angular sector, all sharing the same vertex attributes.
  const per = Math.ceil(segs / sectors);
  for (let s = 0; s < sectors; s++) {
    const j0 = s * per;
    const j1 = Math.min(segs, j0 + per);
    const idx: number[] = [];
    for (let i = 0; i < rings - 1; i++) {
      for (let j = j0; j < j1; j++) {
        const a = i * (segs + 1) + j;
        const b = a + 1;
        const c = a + segs + 1;
        const d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    const part = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color', 'aMask']) part.setAttribute(name, geo.getAttribute(name));
    part.setIndex(idx);
    part.computeBoundingSphere();
    // The bounding sphere from all shared vertices is too loose; fit it to this sector.
    fitSectorSphere(part, radii, j0 / segs, j1 / segs);
    const mesh = new THREE.Mesh(part, mat);
    mesh.receiveShadow = q.shadows;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
}

function fitSectorSphere(g: THREE.BufferGeometry, radii: number[], f0: number, f1: number): void {
  const pos = g.attributes.position;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const idx = g.index!.array;
  for (let i = 0; i < idx.length; i += 3) box.expandByPoint(v.fromBufferAttribute(pos, idx[i]));
  g.boundingBox = box;
  g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  void radii;
  void f0;
  void f1;
}

/** Lambert terrain with per-pixel canopy, meadow and rock detail so slopes never read as flat facets. */
function terrainMaterial(high: boolean): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aMask;\nvarying vec3 vMask;\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMask = aMask;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMask;\nvarying vec3 vWPos;\n${GLSL_NOISE}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 tp = vWPos.xz;
        float tdist = length(vWPos - cameraPosition);
        float tfade = 1.0 - smoothstep(500.0, 2600.0, tdist);
        vec3 tc = diffuseColor.rgb;
        // Each detail layer runs only where its mask is non-zero.
        if (vMask.x > 0.01) {
          // Canopy: clumps of crowns a few metres across, with lit tops and dark gaps.
          float can = fbm3(tp * 0.12);
          float crowns = vnoise(tp * 0.5);
          float cm = vMask.x * mix(0.5, 1.0, tfade);
          tc *= mix(1.0, 0.5 + 0.8 * can, cm);
          tc = mix(tc, tc * 1.3, smoothstep(0.6, 0.85, crowns) * cm * 0.7);
        }
        if (vMask.z * tfade > 0.01) {
          // Meadow: soft patches of taller and shorter grass.
          float mead = fbm3(tp * 0.3 + 5.0);
          tc *= mix(1.0, 0.8 + 0.4 * mead, vMask.z * tfade);
        }
        if (vMask.y > 0.01) {
          // Rock: horizontal strata and weathering streaks.
          float weather = fbm3(tp * 0.05);
          float strata = vnoise(vec2(vWPos.y * 0.12 + weather * 3.0, (tp.x + tp.y) * 0.01));
          tc *= mix(1.0, (0.86 + 0.22 * strata) * (0.8 + 0.35 * weather), vMask.y);
        }
        diffuseColor.rgb = tc;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        ${high ? `{
          // Single-octave micro relief: three value-noise taps, not three fbm stacks.
          vec2 bq = vWPos.xz * 0.2;
          float b0 = vnoise(bq);
          float bx = vnoise(bq + vec2(0.08, 0.0));
          float bz = vnoise(bq + vec2(0.0, 0.08));
          float amt = (0.25 + vMask.x * 0.9 + vMask.y * 1.2) * tfade * 5.0;
          vec3 bump = vec3(b0 - bx, 0.0, b0 - bz) * amt;
          normal = normalize(normal + (viewMatrix * vec4(bump, 0.0)).xyz);
        }` : ''}`,
      );
  };
  mat.customProgramCacheKey = () => `terrain-${high}`;
  return mat;
}

/** Plane with UVs in metres / tile, so textures keep their real-world scale. */
function plane(w: number, h: number, tile: number, m: THREE.Matrix4): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return g.applyMatrix4(m);
}

function paintStone(kind: 'ashlar' | 'flags'): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const rng = new Rng(kind === 'ashlar' ? 31 : 32);
  ctx.fillStyle = kind === 'ashlar' ? '#6d655a' : '#7a746a';
  ctx.fillRect(0, 0, S, S);
  const rows = kind === 'ashlar' ? 5 : 4;
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rng.range(0, 120);
    while (x < S) {
      const w = kind === 'ashlar' ? rng.range(110, 190) : rng.range(90, 170);
      const v = rng.range(-18, 18);
      const base = kind === 'ashlar' ? [168, 156, 138] : [176, 170, 158];
      for (const dx of [0, S]) {
        const bx = x - dx;
        const g = ctx.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
        g.addColorStop(0, `rgb(${base[0] + v + 10},${base[1] + v + 10},${base[2] + v + 8})`);
        g.addColorStop(1, `rgb(${base[0] + v - 14},${base[1] + v - 14},${base[2] + v - 12})`);
        ctx.fillStyle = g;
        ctx.fillRect(bx + 3, r * rh + 3, w - 6, rh - 6);
      }
      x += w;
    }
  }
  // Weathering: speckle and a darker, damp band low on the wall.
  for (let i = 0; i < 9000; i++) {
    const v = rng.range(0, 1) < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rng.range(0.02, 0.07).toFixed(3)})`;
    ctx.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 3), rng.range(1, 3));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * The Boulevard: a coursed-stone embankment wall with a coping, a paved
 * promenade behind it and cast-iron bollards. It sits over the terrain so the
 * lake edge along the Boulevard is a clean line rather than grid triangles.
 */
export function buildEmbankment(lib: TextureLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = 'boulevard';
  // The face stands a metre out into the lake so the terrain grid behind it never pokes through.
  const x = BOULEVARD_X - 1.1;
  const runs: [number, number][] = [[-228, GHAT.z0 - 0.5], [GHAT.z1 + 0.5, 186]];
  const wall: THREE.BufferGeometry[] = [];
  const coping: THREE.BufferGeometry[] = [];
  const paving: THREE.BufferGeometry[] = [];
  for (const [z0, z1] of runs) {
    const len = z1 - z0;
    const zc = (z0 + z1) / 2;
    // Wall face toward the lake (-x), from below the waterline to the coping.
    wall.push(plane(len, 2.9, 2.2, composeMatrix(x, 0.05, zc, 0, -Math.PI / 2)));
    // Coping stone: top and lake-facing lip.
    coping.push(plane(len, 2.4, 1.6, composeMatrix(x + 1.1, 1.52, zc, -Math.PI / 2, -Math.PI / 2)));
    coping.push(plane(len, 0.18, 1.6, composeMatrix(x - 0.1, 1.43, zc, 0, -Math.PI / 2)));
  }
  // Paved walk behind the wall (continuous; the ghat steps cut into it at the front).
  paving.push(plane(412, 9, 2.4, composeMatrix(x + 6.8, 1.36, -21, -Math.PI / 2, -Math.PI / 2)));

  const ashlar = paintStone('ashlar');
  const flags = paintStone('flags');
  const wallMat = new THREE.MeshStandardMaterial({ map: ashlar, normalMap: lib.rock.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.9 });
  const copeMat = new THREE.MeshStandardMaterial({ map: flags, color: '#e8e0d2', roughness: 0.85 });
  const paveMat = new THREE.MeshStandardMaterial({ map: flags, normalMap: lib.rock.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.88 });
  for (const [geos, mat] of [[wall, wallMat], [coping, copeMat], [paving, paveMat]] as const) {
    const mesh = new THREE.Mesh(mergeGeometries(geos as THREE.BufferGeometry[])!, mat);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }

  // Squat cast-iron bollards along the coping.
  const posts = new MeshBuilder(71);
  for (let z = -226; z <= 184; z += 4) {
    if (z > GHAT.z0 - 1 && z < GHAT.z1 + 1) continue;
    posts.cyl(0.07, 0.09, 0.55, 8, x + 0.6, 1.84, z, '#2b2b29');
    posts.sphere(0.08, 1, x + 0.6, 2.14, z, '#2b2b29');
  }
  const postMesh = new THREE.Mesh(posts.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.5 }));
  postMesh.castShadow = true;
  group.add(postMesh);
  return group;
}
