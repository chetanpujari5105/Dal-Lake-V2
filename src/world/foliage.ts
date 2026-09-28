import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { sharedUniforms } from '../atmosphere/presets';
import { cellInstanced } from '../core/cells';
import { Rng } from '../core/math';

/**
 * Alpha-cut foliage card material with wind sway. Normals point up so both
 * faces of a card are lit like the ground they grow from (no dark backfaces).
 */
export function foliageMaterial(map: THREE.Texture, sway: number, alphaToCoverage: boolean, color = '#ffffff'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    color,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  mat.alphaToCoverage = alphaToCoverage;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uWind = sharedUniforms.uWind;
    shader.vertexShader = `uniform float uTime;\nuniform float uWind;\n${shader.vertexShader}`
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float hgt = clamp(position.y, 0.0, 1.5);
        vec2 ip = vec2(0.0);
        #ifdef USE_INSTANCING
          ip = instanceMatrix[3].xz;
        #endif
        float sway = sin(uTime * 1.6 + ip.x * 0.37 + ip.y * 0.29) + 0.45 * sin(uTime * 3.3 + ip.x * 0.9 - ip.y * 0.7);
        transformed.x += sway * hgt * hgt * ${sway.toFixed(3)} * uWind;
        transformed.z += sway * hgt * hgt * ${(sway * 0.55).toFixed(3)} * uWind;`,
      );
  };
  mat.customProgramCacheKey = () => `foliage-${sway}-${alphaToCoverage}`;
  return mat;
}

/** Several vertical cards crossing at the centre; base at y=0, 1 unit tall and wide. */
export function crossedCards(count = 3): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    g.rotateY((i / count) * Math.PI);
    geos.push(g);
  }
  return mergeGeometries(geos)!;
}

/** Leaves radiating from the centre and arching outward, like a collard (haakh) plant. */
export function rosette(leaves = 7, seed = 3): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const geos: THREE.BufferGeometry[] = [];
  for (let i = 0; i < leaves; i++) {
    // A bent leaf: two segments so it rises then droops.
    const g = new THREE.PlaneGeometry(0.55, 1, 1, 2);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.5; // 0..1 along the leaf
      pos.setY(v, y);
      pos.setZ(v, -0.35 * y * y);
    }
    g.rotateX(-rng.range(0.5, 0.95));
    g.rotateY((i / leaves) * Math.PI * 2 + rng.range(-0.2, 0.2));
    const s = rng.range(0.7, 1.05);
    g.scale(s, s, s);
    geos.push(g);
  }
  // A couple of upright young leaves in the heart of the plant.
  for (let i = 0; i < 2; i++) {
    const g = new THREE.PlaneGeometry(0.4, 0.7).translate(0, 0.35, 0);
    g.rotateY(i * Math.PI * 0.5 + 0.4);
    geos.push(g);
  }
  return mergeGeometries(geos)!;
}

/** Smooth irregular stone with box-projected UVs. */
export function stoneGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 1);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const ph = [rng.range(0, 6), rng.range(0, 6), rng.range(0, 6)];
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + 0.14 * Math.sin(x * 2.3 + ph[0]) * Math.cos(z * 1.9 + ph[1]) + 0.08 * Math.sin(y * 3.1 + ph[2]) + 0.05 * Math.sin((x + y) * 6.0);
    const flat = y < -0.3 ? 0.55 : 1;
    pos.setXYZ(i, x * n, y * n * flat, z * n);
    uv[i * 2] = (x + z) * 0.5;
    uv[i * 2 + 1] = y * 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

export interface Instance {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  ry: number;
  color?: THREE.Color;
  tilt?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, list: Instance[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((it, i) => {
    _e.set(it.tilt ?? 0, it.ry, (it.tilt ?? 0) * 0.5, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sx));
    mesh.setMatrixAt(i, _m);
    if (it.color) mesh.setColorAt(i, it.color);
  });
  mesh.count = list.length;
  mesh.computeBoundingSphere();
  return mesh;
}

export interface CellOptions {
  cell: number;
  far: number;
  castShadow?: boolean;
  /** Layer for the meshes; small ground cover goes on the no-reflection layer. */
  layer?: number;
}

/** Like `instanced`, but split into culled spatial cells with a draw distance. */
export function instancedCells(geo: THREE.BufferGeometry, mat: THREE.Material, list: Instance[], o: CellOptions): THREE.Group {
  const items = list.map((it) => {
    _e.set(it.tilt ?? 0, it.ry, (it.tilt ?? 0) * 0.5, 'YXZ');
    _q.setFromEuler(_e);
    return { x: it.x, z: it.z, matrix: new THREE.Matrix4().compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sx)), color: it.color };
  });
  return cellInstanced(geo, mat, items, o.cell, o.far, (m) => {
    m.receiveShadow = true;
    m.castShadow = o.castShadow ?? false;
    if (o.layer !== undefined) m.layers.set(o.layer);
  });
}
