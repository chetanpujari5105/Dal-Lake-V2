import * as THREE from 'three';
import type { TextureLibrary } from '../assets/textureLibrary';
import { Rng } from '../core/math';
import type { QualitySettings } from '../core/quality';
import { crossedCards, foliageMaterial, instanced, stoneGeometry, type Instance } from './foliage';
import { lakeSdf, lakeSdfGradient, NISHAT, SHORE, terrainHeight } from './layout';

// Softens the natural (non-Boulevard) shoreline: reeds standing in the shallows,
// grass along the bank and stones at the waterline.

export function buildShoreFringe(q: QualitySettings, lib: TextureLibrary): THREE.Group {
  const group = new THREE.Group();
  group.name = 'shore-fringe';
  const rng = new Rng(611);
  const high = q.tier === 'high';
  const step = high ? 0.9 : 1.8;

  const grass: Instance[] = [];
  const reeds: Instance[] = [];
  const stones: Instance[] = [];
  const grassTints = ['#d9e1a6', '#c5d597', '#e6dc9a', '#b9cb8a', '#cfd08e'].map((c) => new THREE.Color(c).multiplyScalar(1.3));
  const stoneTints = ['#b8ad9c', '#9d9384', '#c9bfae', '#8f877a'].map((c) => new THREE.Color(c));

  const n = SHORE.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = SHORE[i];
    const [bx, bz] = SHORE[(i + 1) % n];
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d < len; d += step) {
      const f = d / len;
      const px = ax + (bx - ax) * f;
      const pz = az + (bz - az) * f;
      // The stone Boulevard embankment and the Nishat frontage stay clean.
      if (px > 185) continue;
      if (px > NISHAT.x0 - 20 && pz > NISHAT.z0 - 10 && pz < NISHAT.z1 + 10) continue;
      const [gx, gz] = lakeSdfGradient(px, pz); // points toward land

      const clumps = high ? 3 : 2;
      for (let c = 0; c < clumps; c++) {
        const off = rng.range(0.6, 6.5);
        const x = px + gx * off + rng.range(-0.5, 0.5);
        const z = pz + gz * off + rng.range(-0.5, 0.5);
        const y = terrainHeight(x, z);
        if (y < -0.05 || y > 4) continue;
        grass.push({ x, y: y - 0.03, z, sx: rng.range(0.8, 1.5), sy: rng.range(0.5, 1.05) * (off < 3 ? 1.2 : 0.9), ry: rng.next() * 6.3, color: rng.pick(grassTints) });
      }
      if (rng.chance(0.55)) {
        const off = rng.range(-2.8, 0.2);
        const x = px + gx * off;
        const z = pz + gz * off;
        if (lakeSdf(x, z) < 0.5) {
          reeds.push({ x, y: -0.25, z, sx: rng.range(0.9, 1.4), sy: rng.range(0.9, 1.6), ry: rng.next() * 6.3, color: rng.pick(grassTints), tilt: rng.range(-0.12, 0.12) });
        }
      }
      if (rng.chance(high ? 0.22 : 0.12)) {
        const off = rng.range(-0.9, 1.4);
        const x = px + gx * off;
        const z = pz + gz * off;
        const s = rng.range(0.22, 0.75);
        const y = Math.max(terrainHeight(x, z), -0.25) - s * 0.25;
        stones.push({ x, y, z, sx: s * rng.range(0.9, 1.5), sy: s, ry: rng.next() * 6.3, color: rng.pick(stoneTints), tilt: rng.range(-0.25, 0.25) });
      }
    }
  }

  const a2c = high;
  const grassMesh = instanced(crossedCards(3), foliageMaterial(lib.grass, 0.07, a2c), grass);
  const reedMesh = instanced(crossedCards(3), foliageMaterial(lib.reed, 0.09, a2c), reeds);
  grassMesh.receiveShadow = true;
  reedMesh.receiveShadow = true;
  const stoneMat = new THREE.MeshStandardMaterial({
    map: lib.rock.map,
    normalMap: lib.rock.normalMap,
    roughness: 0.92,
  });
  const stoneMesh = instanced(stoneGeometry(5), stoneMat, stones);
  stoneMesh.castShadow = true;
  stoneMesh.receiveShadow = true;
  group.add(grassMesh, reedMesh, stoneMesh);
  return group;
}
