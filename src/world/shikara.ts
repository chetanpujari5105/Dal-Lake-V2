import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { BoatController } from '../controls/boatController';
import { waterHeight } from './layout';
import {
  boatmanSeat, buildPaddleRig, buildShikaraParts, PADDLE_SHOULDER, partsToGroup, type ShikaraMaterials, type ShikaraSpec,
} from './shikaraModel';

// Local frame for every boat: +z is the bow, +y up, +x is port (left).

export const PLAYER_SPEC: ShikaraSpec = {
  length: 9,
  width: 1.5,
  canopy: 'crimson',
  boatman: true,
  flowers: false,
  seed: 9,
  stations: 72,
  hullTint: '#c68a55',
};

export interface SplashEvent {
  x: number;
  z: number;
  strength: number;
  /** Paddle strokes make a sound; wake rings are silent. */
  audible?: boolean;
  /** A paddle stroke rather than a hull ring: swirls and throws more foam. */
  paddle?: boolean;
}

/** The player's boat: model plus bobbing, tilting, paddling and wake emission. */
export class PlayerShikara {
  readonly root = new THREE.Group();
  private tilt = new THREE.Group();
  private paddle: THREE.Group;
  readonly lamp: THREE.PointLight;
  private lanternMat: THREE.MeshStandardMaterial;
  readonly lanternWorld = new THREE.Vector3();
  private lanternLocal = new THREE.Vector3();

  private pitch = 0;
  private pitchV = 0;
  private roll = 0;
  private rollV = 0;
  private heave = 0;
  private heaveV = 0;
  private phase = 0;
  private activity = 0;
  private prevVF = 0;
  private accel = 0;
  private wakeTimer = 0;
  private bowTimer = 0;
  private idleTimer = 0;
  private impulse = 0;

  constructor(mats: ShikaraMaterials) {
    const spec = PLAYER_SPEC;
    this.tilt.add(partsToGroup(buildShikaraParts(spec, mats)));

    // Boatman's arms and paddle, pivoting at his right shoulder.
    this.paddle = buildPaddleRig(mats);
    const seat = boatmanSeat(spec);
    this.paddle.position.set(PADDLE_SHOULDER.x, seat.y + PADDLE_SHOULDER.y, seat.z + PADDLE_SHOULDER.dz);
    this.tilt.add(this.paddle);

    // Brass lantern hanging from the front of the canopy.
    this.lanternMat = new THREE.MeshStandardMaterial({ color: '#f6e2b8', emissive: '#ffb060', emissiveIntensity: 0, roughness: 0.2, transparent: true, opacity: 0.92 });
    this.lanternLocal.set(0, 1.5, 1.55 + 0.1);
    const lantern = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 14), this.lanternMat);
    const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.07, 14), mats.brass);
    capTop.position.y = 0.11;
    const capBot = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.03, 14), mats.brass);
    capBot.position.y = -0.09;
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 12), mats.brass);
    hook.position.y = 0.17;
    lantern.add(glass, capTop, capBot, hook);
    lantern.position.copy(this.lanternLocal);
    this.tilt.add(lantern);
    this.lamp = new THREE.PointLight('#ffb468', 0, 16, 2);
    this.lamp.position.copy(this.lanternLocal);
    this.tilt.add(this.lamp);

    this.root.add(this.tilt);
    this.root.name = 'player-shikara';
  }

  update(dt: number, t: number, c: BoatController, lantern: number, reducedMotion: boolean, splash: (e: SplashEvent) => void): void {
    const { x, z, heading } = c;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const vF = c.forwardSpeed;

    // Water-driven heave, pitch and roll with springs so nothing snaps.
    const hB = waterHeight(x + fx * 3.5, z + fz * 3.5, t);
    const hS = waterHeight(x - fx * 3.5, z - fz * 3.5, t);
    const hL = waterHeight(x + fz * 0.8, z - fx * 0.8, t);
    const hR = waterHeight(x - fz * 0.8, z + fx * 0.8, t);
    const a = (vF - this.prevVF) / Math.max(dt, 1e-3);
    this.prevVF = vF;
    this.accel = damp(this.accel, a, 4, dt);

    const motion = reducedMotion ? 0.5 : 1;
    const targetPitch = (Math.atan2(hB - hS, 7) * 1.4 + this.accel * 0.02 + Math.abs(vF) * 0.004) * motion;
    const targetRoll = (Math.atan2(hL - hR, 1.6) * 0.8 + c.yawRate * vF * 0.05) * motion + this.impulse * 0.06;
    const targetHeave = (hB + hS + hL + hR) * 0.25 - Math.abs(vF) * 0.006;

    const k = 30;
    const cdamp = 7;
    this.pitchV += ((targetPitch - this.pitch) * k - this.pitchV * cdamp) * dt;
    this.pitch += this.pitchV * dt;
    this.rollV += ((targetRoll - this.roll) * k - this.rollV * cdamp) * dt;
    this.roll += this.rollV * dt;
    this.heaveV += ((targetHeave - this.heave) * 40 - this.heaveV * 8) * dt;
    this.heave += this.heaveV * dt;
    this.impulse = damp(this.impulse, 0, 3, dt);

    this.root.position.set(x, 0, z);
    this.root.rotation.y = heading;
    this.tilt.position.y = this.heave;
    this.tilt.rotation.set(-this.pitch, 0, this.roll);

    // Paddle stroke: power phase with the blade in the water, then a lifted recovery.
    const drive = clamp(Math.abs(c.throttle) + Math.abs(c.steer) * 0.6, 0, 1);
    this.activity = damp(this.activity, drive, 3, dt);
    const dir = c.throttle < -0.05 ? -1 : 1;
    const prevPhase = this.phase;
    this.phase += dt * (1.5 + 2.2 * this.activity) * dir * (this.activity > 0.04 ? 1 : 0);
    const TWO_PI = Math.PI * 2;
    const crossed = Math.floor(this.phase / TWO_PI) !== Math.floor(prevPhase / TWO_PI);
    const ph = ((this.phase % TWO_PI) + TWO_PI) % TWO_PI;
    const sweep = -Math.cos(ph) * 0.55;
    const lift = ph > Math.PI ? Math.sin(ph - Math.PI) * 0.45 : 0;
    const act = this.activity;
    this.paddle.rotation.x = sweep * act + 0.75 * (1 - act);
    this.paddle.rotation.z = lift * act + 0.28 * (1 - act);

    if (crossed && act > 0.2) {
      // Blade entry: splash on the port side just behind the boatman.
      const px = x - fx * 3.4 + fz * 1.0;
      const pz = z - fz * 3.4 - fx * 1.0;
      splash({ x: px, z: pz, strength: 0.55 * act, audible: true, paddle: true });
    }

    // Wake: rings from the stern and bow; slow idle rings from bobbing.
    const speed = Math.abs(vF);
    this.wakeTimer -= dt;
    this.bowTimer -= dt;
    this.idleTimer -= dt;
    if (speed > 0.35 && this.wakeTimer <= 0) {
      this.wakeTimer = clamp(0.9 / speed, 0.14, 0.4);
      const sgn = vF >= 0 ? -1 : 1;
      splash({ x: x + fx * 3.8 * sgn, z: z + fz * 3.8 * sgn, strength: clamp(speed / 5, 0.12, 0.85) });
    }
    if (speed > 1.2 && this.bowTimer <= 0) {
      this.bowTimer = 0.32;
      const sgn = vF >= 0 ? 1 : -1;
      splash({ x: x + fx * 4.2 * sgn, z: z + fz * 4.2 * sgn, strength: clamp(speed / 7, 0.1, 0.6) });
    }
    if (speed < 0.35 && this.idleTimer <= 0) {
      this.idleTimer = 1.9;
      splash({ x, z, strength: 0.14 });
    }

    // Lantern.
    this.lanternMat.emissiveIntensity = 0.2 + lantern * 3;
    this.lamp.intensity = lantern * 7;
    this.lanternWorld.copy(this.lanternLocal);
    this.tilt.localToWorld(this.lanternWorld);
  }

  bump(strength: number): void {
    this.impulse += clamp(strength, 0, 2) * (Math.random() > 0.5 ? 1 : -1);
  }
}
