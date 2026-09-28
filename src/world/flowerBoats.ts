import * as THREE from 'three';
import { clamp, dampAngle } from '../core/math';
import type { DynamicCircle } from '../controls/boatController';
import { FLOWER_ROUTE, waterHeight } from './layout';
import {
  boatmanSeat, buildPaddleRig, buildShikaraParts, PADDLE_SHOULDER, partsToGroup, type ShikaraMaterials, type ShikaraSpec,
} from './shikaraModel';

interface Vendor {
  root: THREE.Group;
  tilt: THREE.Group;
  paddle: THREE.Group;
  u: number;
  speed: number;
  phase: number;
  heading: number;
  wake: number;
}

const SPEC: ShikaraSpec = {
  length: 6.4,
  width: 1.25,
  canopy: null,
  boatman: true,
  flowers: true,
  seed: 300,
  stations: 40,
  hullTint: '#7a5236',
  detail: 'low',
};

/** Flower sellers paddling a slow loop between the houseboats and the island. */
export class FlowerBoats {
  readonly group = new THREE.Group();
  readonly lanterns: THREE.Vector3[] = [];
  private vendors: Vendor[] = [];
  private curve: THREE.CatmullRomCurve3;
  private length: number;
  private circles: DynamicCircle[] = [];

  constructor(count: number, mats: ShikaraMaterials) {
    this.curve = new THREE.CatmullRomCurve3(FLOWER_ROUTE.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    this.length = this.curve.getLength();
    this.group.name = 'flower-boats';

    for (let i = 0; i < count; i++) {
      const tilt = new THREE.Group();
      tilt.add(partsToGroup(buildShikaraParts({ ...SPEC, seed: 300 + i }, mats)));
      const paddle = buildPaddleRig(mats);
      const seat = boatmanSeat(SPEC);
      paddle.position.set(PADDLE_SHOULDER.x, seat.y + PADDLE_SHOULDER.y, seat.z + PADDLE_SHOULDER.dz);
      tilt.add(paddle);
      const root = new THREE.Group();
      root.add(tilt);
      this.group.add(root);
      const u = i / count + 0.03;
      const tan = this.curve.getTangentAt(u);
      this.vendors.push({ root, tilt, paddle, u, speed: 1.25 + i * 0.12, phase: i * 1.7, heading: Math.atan2(tan.x, tan.z), wake: 0 });
      this.lanterns.push(new THREE.Vector3());
      this.circles.push({ x: 0, z: 0, r: 0.7 }, { x: 0, z: 0, r: 0.7 });
    }
  }

  get obstacles(): DynamicCircle[] {
    return this.circles;
  }

  /** Nearest vendor distance to a point (for the caption). */
  nearest(x: number, z: number): number {
    let best = Infinity;
    for (const v of this.vendors) best = Math.min(best, Math.hypot(v.root.position.x - x, v.root.position.z - z));
    return best;
  }

  update(dt: number, t: number, player: { x: number; z: number }, ripple: ((x: number, z: number, s: number) => void) | null): void {
    this.vendors.forEach((v, i) => {
      const p = this.curve.getPointAt(v.u);
      // Yield if the player is sitting right in front.
      const tan = this.curve.getTangentAt(v.u);
      const ahead = (player.x - p.x) * tan.x + (player.z - p.z) * tan.z;
      const dist = Math.hypot(player.x - p.x, player.z - p.z);
      const yieldF = ahead > 0 && dist < 12 ? clamp((dist - 5) / 7, 0, 1) : 1;
      const speed = v.speed * yieldF;
      v.u = (v.u + (speed * dt) / this.length) % 1;

      const targetHeading = Math.atan2(tan.x, tan.z);
      v.heading = dampAngle(v.heading, targetHeading, 1.5, dt);
      v.root.position.set(p.x, 0, p.z);
      v.root.rotation.y = v.heading;
      const bob = waterHeight(p.x, p.z, t);
      v.tilt.position.y = bob;
      v.tilt.rotation.x = Math.sin(t * 1.3 + i) * 0.015;
      v.tilt.rotation.z = Math.sin(t * 1.1 + i * 2) * 0.02;

      const act = yieldF;
      v.phase += dt * 2.2 * (0.3 + 0.7 * act);
      const ph = v.phase % (Math.PI * 2);
      v.paddle.rotation.x = -Math.cos(ph) * 0.5 * act + 0.7 * (1 - act);
      v.paddle.rotation.z = ph > Math.PI ? Math.sin(ph - Math.PI) * 0.4 * act : 0.25 * (1 - act);

      const fx = Math.sin(v.heading);
      const fz = Math.cos(v.heading);
      this.circles[i * 2].x = p.x + fx * 1.6;
      this.circles[i * 2].z = p.z + fz * 1.6;
      this.circles[i * 2 + 1].x = p.x - fx * 1.6;
      this.circles[i * 2 + 1].z = p.z - fz * 1.6;
      this.lanterns[i].set(p.x + fx * 2.4, 0.9 + bob, p.z + fz * 2.4);

      v.wake -= dt;
      if (ripple && v.wake <= 0 && speed > 0.3) {
        v.wake = 0.55;
        ripple(p.x - fx * 2.8, p.z - fz * 2.8, 0.3);
      }
    });
  }
}
