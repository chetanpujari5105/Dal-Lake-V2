import * as THREE from 'three';
import { clamp, damp, dampAngle } from '../core/math';
import { terrainHeight, type Obstacle } from '../world/layout';

export type CameraMode = 'chase' | 'cinematic';

export interface Subject {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

interface Shot {
  duration: number;
  place(s: Subject, t: number, sun: THREE.Vector3, pos: THREE.Vector3, look: THREE.Vector3): void;
}

const fwd = (h: number) => [Math.sin(h), Math.cos(h)] as const;

/** Slow, gliding shots that frame the boat against the lake. Transitions blend, never cut. */
const SHOTS: Shot[] = [
  {
    // High crane, slowly orbiting.
    duration: 13,
    place(s, t, _sun, pos, look) {
      const a = s.heading + Math.PI * 0.75 + t * 0.07;
      pos.set(s.x + Math.sin(a) * 30, 14, s.z + Math.cos(a) * 30);
      look.set(s.x, 1.2, s.z);
    },
  },
  {
    // Water-level tracking shot off the port side.
    duration: 11,
    place(s, _t, _sun, pos, look) {
      const [fx, fz] = fwd(s.heading);
      pos.set(s.x + fz * 8 + fx * 2.5, 0.95, s.z - fx * 8 + fz * 2.5);
      look.set(s.x + fx * 1.5, 1.1, s.z + fz * 1.5);
    },
  },
  {
    // Into the sun: the boat silhouetted on the glitter path.
    duration: 12,
    place(s, t, sun, pos, look) {
      const l = Math.hypot(sun.x, sun.z) || 1;
      const sx = sun.x / l;
      const sz = sun.z / l;
      const drift = Math.sin(t * 0.08) * 0.35;
      pos.set(s.x - (sx - sz * drift) * 34, 5.5, s.z - (sz + sx * drift) * 34);
      look.set(s.x + sx * 6, 1.5, s.z + sz * 6);
    },
  },
  {
    // Lead shot: ahead of the bow looking back at the boatman.
    duration: 10,
    place(s, t, _sun, pos, look) {
      const [fx, fz] = fwd(s.heading);
      const side = Math.sin(t * 0.1) * 4;
      pos.set(s.x + fx * 15 + fz * side, 2.6, s.z + fz * 15 - fx * side);
      look.set(s.x - fx * 1.5, 1.2, s.z - fz * 1.5);
    },
  },
];

export class CameraRig {
  mode: CameraMode = 'chase';
  // Default chase framing: close and low enough that the shikara fills the lower
  // third of the frame (canopy, hull and boatman readable), with the look point
  // pushed ahead of the bow so the water in front stays visible for steering.
  readonly defaultPitch = 0.23;
  readonly defaultDistance = 8.6;
  lookAhead = 10;
  lookHeight = 1.4;
  yaw = 0;
  pitch = this.defaultPitch;
  distance = this.defaultDistance;
  readonly minDistance = 5.5;
  readonly maxDistance = 36;

  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private desiredLook = new THREE.Vector3();
  private camHeading = 0;
  private occludedDistance = 99;
  private lastInteract = -Infinity;
  private shotIndex = 0;
  private shotTime = 0;
  private initialised = false;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private clock = 0;
  interactive = true;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
    private obstacles: Obstacle[],
    public reducedMotion: boolean,
  ) {
    dom.addEventListener('pointerdown', this.onDown);
    dom.addEventListener('pointermove', this.onMove);
    dom.addEventListener('pointerup', this.onUp);
    dom.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
  }

  setMode(mode: CameraMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.shotTime = 0;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.interactive) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.dom.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) this.pinchDist = this.currentPinch();
    this.lastInteract = this.clock;
  };

  private onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 1) {
      this.yaw -= dx * 0.0055;
      this.pitch = clamp(this.pitch + dy * 0.004, 0.04, 1.2);
    } else if (this.pointers.size === 2) {
      const d = this.currentPinch();
      if (this.pinchDist > 0 && d > 0) this.zoomBy(this.pinchDist / d);
      this.pinchDist = d;
    }
    this.lastInteract = this.clock;
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.dom.hasPointerCapture(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    this.pinchDist = this.pointers.size === 2 ? this.currentPinch() : 0;
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.interactive) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.zoomBy(Math.exp(clamp(delta, -200, 200) * 0.0012));
    this.lastInteract = this.clock;
  };

  private currentPinch(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private zoomBy(f: number): void {
    this.distance = clamp(this.distance * f, this.minDistance, this.maxDistance);
  }

  update(dt: number, s: Subject, sun: THREE.Vector3): void {
    this.clock += dt;
    if (!this.initialised) {
      this.camHeading = s.heading;
      this.chaseTarget(s);
      this.pos.copy(this.desired);
      this.look.copy(this.desiredLook);
      this.initialised = true;
    }

    let posRate: number;
    let lookRate: number;
    if (this.mode === 'chase') {
      this.camHeading = dampAngle(this.camHeading, s.heading, 2.0, dt);
      // Drift back behind the boat after the player stops dragging.
      if (this.clock - this.lastInteract > 3 && Math.abs(s.speed) > 0.6) this.yaw = dampAngle(this.yaw, 0, 0.5, dt);
      this.chaseTarget(s);
      posRate = 6;
      lookRate = 9;
    } else {
      const slow = this.reducedMotion ? 0.5 : 1;
      this.shotTime += dt * slow;
      const shot = SHOTS[this.shotIndex];
      if (this.shotTime > shot.duration) {
        this.shotTime = 0;
        this.shotIndex = (this.shotIndex + 1) % SHOTS.length;
      }
      SHOTS[this.shotIndex].place(s, this.shotTime, sun, this.desired, this.desiredLook);
      posRate = 0.9 * slow;
      lookRate = 1.6 * slow;
    }

    // Keep above water and terrain.
    const ground = Math.max(0, terrainHeight(this.desired.x, this.desired.z));
    this.desired.y = Math.max(this.desired.y, ground + 0.8);

    this.pos.x = damp(this.pos.x, this.desired.x, posRate, dt);
    this.pos.y = damp(this.pos.y, this.desired.y, posRate, dt);
    this.pos.z = damp(this.pos.z, this.desired.z, posRate, dt);
    this.look.x = damp(this.look.x, this.desiredLook.x, lookRate, dt);
    this.look.y = damp(this.look.y, this.desiredLook.y, lookRate, dt);
    this.look.z = damp(this.look.z, this.desiredLook.z, lookRate, dt);
    const g2 = Math.max(0, terrainHeight(this.pos.x, this.pos.z));
    this.pos.y = Math.max(this.pos.y, g2 + 0.6, 0.6);

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  private chaseTarget(s: Subject): void {
    const ang = this.camHeading + this.yaw;
    const bx = -Math.sin(ang);
    const bz = -Math.cos(ang);
    const [fx, fz] = fwd(s.heading);
    this.desiredLook.set(s.x + fx * this.lookAhead, this.lookHeight, s.z + fz * this.lookAhead);

    // Portrait screens are narrow: pull back and look down a little more so the
    // whole shikara and the water ahead still fit.
    const aspect = this.camera.aspect;
    const fit = aspect < 0.8 ? 1.32 : aspect < 1.2 ? 1.12 : 1;
    const pitch = this.pitch + (aspect < 0.8 ? 0.06 : 0);
    const d = this.distance * fit * (1 + Math.min(Math.abs(s.speed), 6) * 0.015);
    // Pull in if a houseboat or island sits between the boat and the camera.
    let free = d;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const f = i / steps;
      const px = s.x + bx * Math.cos(pitch) * d * f;
      const pz = s.z + bz * Math.cos(pitch) * d * f;
      const py = 1.35 + Math.sin(pitch) * d * f;
      if (this.blocked(px, py, pz)) {
        free = Math.max(this.minDistance * 0.6, d * (f - 1 / steps));
        break;
      }
    }
    const inRate = free < this.occludedDistance ? 10 : 1.5;
    this.occludedDistance = damp(this.occludedDistance, free, inRate, 1 / 60);

    const dd = Math.min(d, this.occludedDistance);
    this.desired.set(
      s.x + bx * Math.cos(pitch) * dd,
      1.35 + Math.sin(pitch) * dd,
      s.z + bz * Math.cos(pitch) * dd,
    );
  }

  private blocked(x: number, y: number, z: number): boolean {
    for (const o of this.obstacles) {
      if (y > o.height + 0.6) continue;
      if (o.kind === 'circle') {
        if (Math.hypot(x - o.x, z - o.z) < o.r) return true;
      } else {
        const c = Math.cos(o.rot);
        const sn = Math.sin(o.rot);
        const dx = x - o.x;
        const dz = z - o.z;
        const lx = dx * c - dz * sn;
        const lz = dx * sn + dz * c;
        if (Math.abs(lx) < o.hx && Math.abs(lz) < o.hz) return true;
      }
    }
    return false;
  }
}
