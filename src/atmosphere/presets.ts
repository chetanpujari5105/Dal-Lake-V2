import * as THREE from 'three';
import { lerp } from '../core/math';

export type TimeOfDay = 'dawn' | 'sunset' | 'night';
export type Weather = 'clear' | 'rain';

type ColorKeys =
  | 'skyTop' | 'skyHorizon' | 'skyGlow' | 'sunColor' | 'hemiSky' | 'hemiGround'
  | 'fogColor' | 'waterDeep' | 'landTint';
type NumberKeys =
  | 'sunIntensity' | 'hemiIntensity' | 'fogDensity' | 'exposure' | 'waterSpec' | 'stars' | 'moon'
  | 'sunDisc' | 'clouds' | 'lantern' | 'mist' | 'dust' | 'fireflies' | 'birds' | 'rain' | 'wind';

export type AtmosState = Record<ColorKeys, THREE.Color> & Record<NumberKeys, number> & { sunDir: THREE.Vector3 };

const COLOR_KEYS: ColorKeys[] = [
  'skyTop', 'skyHorizon', 'skyGlow', 'sunColor', 'hemiSky', 'hemiGround', 'fogColor', 'waterDeep', 'landTint',
];
const NUMBER_KEYS: NumberKeys[] = [
  'sunIntensity', 'hemiIntensity', 'fogDensity', 'exposure', 'waterSpec', 'stars', 'moon', 'sunDisc',
  'clouds', 'lantern', 'mist', 'dust', 'fireflies', 'birds', 'rain', 'wind',
];

interface Def {
  colors: Record<ColorKeys, string>;
  numbers: Record<NumberKeys, number>;
  sunDir: [number, number, number];
}

const DEFS: Record<TimeOfDay, Def> = {
  // Golden hour: sun low over the Pir Panjal in the west-north-west, lighting the
  // houseboat facades and the Zabarwan slopes across the lake.
  sunset: {
    colors: {
      skyTop: '#4d6fa3', skyHorizon: '#f2b07a', skyGlow: '#ff9446', sunColor: '#ffb066',
      hemiSky: '#b4bfd4', hemiGround: '#7d5c40', fogColor: '#e2b490', waterDeep: '#1e3a40', landTint: '#3b3528',
    },
    numbers: {
      sunIntensity: 3.0, hemiIntensity: 1.25, fogDensity: 0.00036, exposure: 1.0, waterSpec: 1, stars: 0, moon: 0,
      sunDisc: 1, clouds: 0.55, lantern: 0.18, mist: 0, dust: 1, fireflies: 0, birds: 1, rain: 0, wind: 1,
    },
    sunDir: [-0.93, 0.12, -0.34],
  },
  // Dawn: soft light over the Zabarwan range, a still lake under low mist.
  dawn: {
    colors: {
      skyTop: '#7b98c4', skyHorizon: '#e9d2c4', skyGlow: '#ffbf94', sunColor: '#ffd6b0',
      hemiSky: '#b8c6dc', hemiGround: '#5e5a52', fogColor: '#d9d3d1', waterDeep: '#2c4551', landTint: '#626a70',
    },
    numbers: {
      sunIntensity: 2.0, hemiIntensity: 1.05, fogDensity: 0.00085, exposure: 0.98, waterSpec: 0.45, stars: 0, moon: 0,
      sunDisc: 0.7, clouds: 0.3, lantern: 0.06, mist: 0.75, dust: 0.45, fireflies: 0, birds: 0.8, rain: 0, wind: 0.4,
    },
    // High enough to have cleared the Zabarwan ridge that the dawn sun rises behind.
    sunDir: [0.84, 0.3, -0.45],
  },
  // Lantern-lit night under a high moon.
  night: {
    colors: {
      skyTop: '#050a1b', skyHorizon: '#1b2a4a', skyGlow: '#3a4f82', sunColor: '#9fb5ff',
      hemiSky: '#4a5c8c', hemiGround: '#1a1822', fogColor: '#1c2946', waterDeep: '#07111b', landTint: '#0b0d13',
    },
    numbers: {
      sunIntensity: 0.6, hemiIntensity: 0.75, fogDensity: 0.0008, exposure: 1.45, waterSpec: 0.55, stars: 1, moon: 1,
      sunDisc: 0, clouds: 0.22, lantern: 1, mist: 0.12, dust: 0, fireflies: 1, birds: 0, rain: 0, wind: 0.6,
    },
    sunDir: [-0.45, 0.55, 0.7],
  },
};

// Overcast greys keep a trace of each time of day: cool at dawn, warm at sunset.
const RAIN_GREY: Record<TimeOfDay, THREE.Color> = {
  dawn: new THREE.Color('#8b96a1'),
  sunset: new THREE.Color('#9c948b'),
  night: new THREE.Color('#2c3646'),
};

export function createState(): AtmosState {
  const s = { sunDir: new THREE.Vector3() } as AtmosState;
  for (const k of COLOR_KEYS) s[k] = new THREE.Color();
  for (const k of NUMBER_KEYS) s[k] = 0;
  return s;
}

export function composeTarget(time: TimeOfDay, weather: Weather, out: AtmosState = createState()): AtmosState {
  const def = DEFS[time];
  for (const k of COLOR_KEYS) out[k].set(def.colors[k]);
  for (const k of NUMBER_KEYS) out[k] = def.numbers[k];
  out.sunDir.set(...def.sunDir).normalize();

  if (weather === 'rain') {
    // Overcast: an even grey dome that meets the fog at the horizon, so distant
    // ridges fade into the cloud instead of standing out lighter than the sky.
    const grey = RAIN_GREY[time];
    out.fogColor.lerp(grey.clone().multiplyScalar(1.1), 0.8);
    out.skyHorizon.copy(out.fogColor);
    out.skyTop.lerp(grey, 0.85);
    out.skyGlow.lerp(grey, 0.7);
    out.sunColor.lerp(new THREE.Color('#d8dde2'), 0.6);
    out.sunIntensity *= 0.3;
    out.hemiIntensity *= 1.1;
    out.fogDensity = Math.max(out.fogDensity * 2.4, 0.0022);
    out.waterSpec *= 0.35;
    out.sunDisc = 0;
    out.clouds = 1;
    out.dust = 0;
    out.fireflies *= 0.1;
    out.birds *= 0.15;
    out.stars = 0;
    out.moon *= 0.1;
    out.mist = Math.max(out.mist, 0.35);
    out.rain = 1;
    out.wind = 1.5;
    out.exposure *= 0.97;
  }
  return out;
}

/** Moves `state` toward `target` by fraction `t` (0..1). */
export function blendState(state: AtmosState, target: AtmosState, t: number): void {
  for (const k of COLOR_KEYS) state[k].lerp(target[k], t);
  for (const k of NUMBER_KEYS) state[k] = lerp(state[k], target[k], t);
  state.sunDir.lerp(target.sunDir, t).normalize();
}

export function copyState(dst: AtmosState, src: AtmosState): void {
  blendState(dst, src, 1);
}

/** Uniforms shared by every custom shader so fog stays consistent. */
export const sharedUniforms = {
  uTime: { value: 0 },
  uFogColor: { value: new THREE.Color() },
  uFogDensity: { value: 0.0004 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color() },
  uPixelScale: { value: 500 },
  uWind: { value: 1 },
};

const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);

/**
 * three mixes fog in after tone mapping, while the sky's colours go through
 * ACES. Pre-applying the same curve to the fog colour makes fogged terrain meet
 * the sky with no visible band. Returns a linear colour.
 */
export function toneMappedFogColor(linear: THREE.Color, exposure: number, out: THREE.Color): THREE.Color {
  const k = exposure / 0.6;
  const r = linear.r * k;
  const g = linear.g * k;
  const b = linear.b * k;
  const ir = rrt(0.59719 * r + 0.35458 * g + 0.04823 * b);
  const ig = rrt(0.076 * r + 0.90834 * g + 0.01566 * b);
  const ib = rrt(0.0284 * r + 0.13383 * g + 0.83777 * b);
  out.setRGB(
    Math.min(1, Math.max(0, 1.60475 * ir - 0.53108 * ig - 0.07367 * ib)),
    Math.min(1, Math.max(0, -0.10208 * ir + 1.10813 * ig - 0.00605 * ib)),
    Math.min(1, Math.max(0, -0.00327 * ir - 0.07276 * ig + 1.07602 * ib)),
    THREE.LinearSRGBColorSpace,
  );
  return out;
}
