import * as THREE from 'three';
import type { AtmosState } from '../atmosphere/presets';
import { sharedUniforms } from '../atmosphere/presets';
import { GLSL_NOISE } from '../core/glslNoise';
import type { QualitySettings } from '../core/quality';
import { lakeSdf } from './layout';

const TRAIL_LIFE = 6.5;

const vertexShader = /* glsl */ `
uniform mat4 uTextureMatrix;
varying vec3 vWorld;
varying vec4 vReflCoord;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vReflCoord = uTextureMatrix * wp;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform sampler2D uRipples;
uniform sampler2D uReflection;
uniform sampler2D uShore;
uniform float uUseReflection;
uniform vec4 uTrail[TRAIL_N];
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGlow;
uniform vec3 uWaterDeep;
uniform vec3 uShallow;
uniform vec3 uLandTint;
uniform vec3 uHemiSky;
uniform vec3 uFogColor;
uniform float uSunIntensity;
uniform float uHemiIntensity;
uniform float uSpec;
uniform float uWind;
uniform float uRain;
uniform float uFogDensity;
varying vec3 vWorld;
varying vec4 vReflCoord;

${GLSL_NOISE}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Raindrop rings. Every cell fires on its own period; each cycle the drop lands at
// a new random spot, and only some cells fire at all, so no grid or rhythm shows.
vec2 rainLayer(vec2 p, float t, float seed, float density) {
  vec2 g = floor(p);
  vec2 f = fract(p);
  vec2 slope = vec2(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 cell = g + o + seed;
      float h = hash21(cell);
      float tt = t / (0.7 + h * 0.8) + hash21(cell + 11.3);
      float cycle = floor(tt);
      float ph = fract(tt);
      float act = step(1.0 - density, hash21(cell + cycle * 7.13));
      vec2 c = o + 0.1 + 0.8 * vec2(hash21(cell + cycle * 1.7 + 3.1), hash21(cell + cycle * 2.3 + 7.7)) - f;
      float d = length(c);
      float rad = 0.45 + 0.45 * hash21(cell + cycle + 5.0);
      float x = (d - ph * rad) * 16.0;
      float ring = exp(-x * x) * (1.0 - ph) * (1.0 - ph) * act;
      slope += (-c / (d + 1e-4)) * sin(x * 2.2) * ring;
    }
  }
  return slope;
}

vec3 skyColor(vec3 dir) {
  float y = max(dir.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(y, 0.45));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSkyGlow * (pow(sd, 6.0) * 0.5 + exp(-y * 9.0) * pow(sd * 0.5 + 0.5, 3.0) * 0.35);
  return col;
}

vec2 ripple(vec2 uv) {
  return texture2D(uRipples, uv).xy * 2.0 - 1.0;
}

void main() {
  vec2 p = vWorld.xz;
  float dist = length(cameraPosition - vWorld);
  float t = uTime;
  float fade = 1.0 / (1.0 + dist * 0.012);

  // Distance to the natural shore (negative on water), from a baked map.
  vec2 suv = p / 660.0 + 0.5;
  float sd = -40.0;
  if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) sd = texture2D(uShore, suv).r * 50.0 - 40.0;
  float shallow = smoothstep(-9.0, 0.0, sd);

  // Wind: slow-moving gust patches (cat's paws) between calmer glassy stretches.
  vec2 wdir = vec2(0.8, 0.6);
  float gust = smoothstep(0.3, 0.78, fbm3(p * 0.018 - wdir * t * 0.25));
  float windAmp = uWind * (0.3 + 1.0 * gust) * (1.0 - shallow * 0.6);

  // Wake and paddle disturbances.
  float foam = 0.0;
  float calm = 0.0;
  vec2 wake = vec2(0.0);
  for (int i = 0; i < TRAIL_N; i++) {
    vec4 tp = uTrail[i];
    if (tp.w == 0.0) continue;
    vec2 d = p - tp.xy;
    float dd = dot(d, d);
    if (dd > 170.0) continue;
    float st = abs(tp.w);
    float len = sqrt(dd);
    float age = tp.z;
    // Expanding ring; successive points along the path add up to a V-shaped wake.
    float band = len - (0.35 + age * 1.5);
    float env = exp(-band * band * 1.1) * exp(-age * 0.42) * st;
    wake += (d / (len + 1e-3)) * cos(band * 5.0) * env * 0.4;
    // The hull's track stays smoother than the wind-ruffled water around it.
    calm = max(calm, exp(-dd * 0.08) * exp(-age * 0.35) * st);
    float fo = exp(-dd * 1.4) * exp(-age * 2.0) * st;
    if (tp.w < 0.0) {
      // Paddle stroke: a small swirl and a bright burst of aerated water.
      wake += vec2(-d.y, d.x) / (len + 1e-3) * exp(-dd * 1.8) * exp(-age * 1.2) * st * 0.35;
      fo *= 1.6;
    }
    foam += fo;
  }
  windAmp *= 1.0 - 0.65 * clamp(calm, 0.0, 1.0);

  // Three ripple scales, each rotated and domain-warped so the tile never lines up.
  vec2 warp = ripple(p * 0.0031 + t * 0.001) * 0.35;
  const mat2 R1 = mat2(0.8, -0.6, 0.6, 0.8);
  const mat2 R2 = mat2(0.28, 0.96, -0.96, 0.28);
  vec2 s1 = ripple(p * 0.043 + warp + t * vec2(0.011, 0.007));
  vec2 s2 = R1 * ripple((p * R1) * 0.107 + warp * 1.7 + t * vec2(-0.016, 0.012));
  vec2 s3 = R2 * ripple((p * R2) * 0.012 + t * vec2(0.003, -0.005));
  vec2 slope = ((s1 * 0.55 + s2 * 0.3) * windAmp + s3 * 0.3 * (0.4 + 0.6 * uWind)) * 0.26 * (0.3 + 0.7 * fade);
  slope += wake;

  if (uRain > 0.01) {
    float rf = uRain * fade;
    vec2 r = rainLayer(p * 1.3, t, 0.0, 0.55) * 0.18 + rainLayer(p * 2.7 + 17.0, t * 1.1, 31.0, 0.45) * 0.1;
    #ifdef RAIN_DETAIL
      r += rainLayer(p * 5.1 - 9.0, t * 1.25, 57.0, 0.4) * 0.06;
    #endif
    slope += r * rf;
    // Fine pitting from countless small drops, fading quickly with distance.
    float pit = vnoise(p * 9.0 + t * 6.0) - vnoise(p * 9.0 + vec2(0.2, 0.0) + t * 6.0);
    slope += vec2(pit, -pit) * 0.15 * uRain * fade * fade;
  }

  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = max(dot(N, V), 0.0);
  float fres = clamp(0.03 + pow(1.0 - ndv, 4.0) * 0.97, 0.0, 1.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);

  vec3 refl = skyColor(R);
  if (uUseReflection > 0.5) {
    vec2 base = vReflCoord.xy / vReflCoord.w;
    vec2 off = slope * 0.11;
    refl = texture2D(uReflection, base + off).rgb;
    #ifdef REFL_BLUR
      // Rougher water blurs the mirror a little along the ripple direction.
      vec2 bl = vec2(slope.y, -slope.x) * 0.02 * (0.3 + windAmp + uRain);
      refl = refl * 0.5 + 0.25 * (texture2D(uReflection, base + off + bl).rgb + texture2D(uReflection, base + off - bl).rgb);
    #endif
  } else {
    refl = mix(refl, uLandTint, smoothstep(0.1, 0.0, R.y) * 0.8);
  }
  // Rain dulls the mirror.
  refl = mix(refl, refl * 0.8 + uSkyHorizon * 0.12, uRain * 0.5);

  float light = 0.25 + uHemiIntensity * 0.55 + uSunIntensity * max(uSunDir.y, 0.0) * 0.4;
  vec3 body = mix(uWaterDeep, uShallow, shallow * 0.75) * light;
  vec3 col = mix(body, refl, fres * (1.0 - shallow * 0.35));

  // Sun (or moon) glitter path, broken up where gusts roughen the surface.
  float sd2 = max(dot(R, uSunDir), 0.0);
  col += uSunColor * uSunIntensity * uSpec * (pow(sd2, 900.0) * 5.0 + pow(sd2, 110.0) * 0.3) * (0.35 + 0.65 * fade) * (0.6 + 0.6 * gust);

  // Foam from hull and paddle, broken into streaks; a faint lapping line at the shore.
  float fn = vnoise(p * 2.2 + t * 0.4) * 0.6 + vnoise(p * 6.0 - t * 0.7) * 0.4;
  foam = clamp(foam * smoothstep(0.25, 0.8, fn) * 1.4 - 0.1, 0.0, 1.0);
  float lap = exp(-pow((sd + 0.9 + 0.35 * sin(t * 0.9 + (p.x + p.y) * 0.07)) * 2.2, 2.0)) * 0.35 * smoothstep(0.3, 0.7, fn);
  foam = max(foam, lap * (1.0 - uRain * 0.5));
  vec3 foamCol = uSunColor * uSunIntensity * max(uSunDir.y, 0.12) * 0.5 + uHemiSky * uHemiIntensity * 0.55;
  col = mix(col, foamCol, foam * 0.5);

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, fogF);
}
`;

/** Signed distance to the natural shoreline over the lake, remapped to 0..1 (-40 m .. +10 m). */
function createShoreMap(size = 200): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = ((i + 0.5) / size - 0.5) * 660;
      const z = ((j + 0.5) / size - 0.5) * 660;
      const d = Math.max(-40, Math.min(10, lakeSdf(x, z)));
      const v = Math.round(((d + 40) / 50) * 255);
      const k = (j * size + i) * 4;
      data[k] = v;
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private trail: THREE.Vector4[];
  private trailHead = 0;
  private rt: THREE.WebGLRenderTarget | null = null;
  private virtualCamera = new THREE.PerspectiveCamera();
  private textureMatrix = new THREE.Matrix4();
  private reflectionScale = 0.5;
  reflectionsEnabled: boolean;

  constructor(q: QualitySettings, ripples: THREE.Texture, private renderer: THREE.WebGLRenderer) {
    this.trail = Array.from({ length: q.trailPoints }, () => new THREE.Vector4(0, 0, 99, 0));
    this.reflectionsEnabled = q.reflections;

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: q.tier === 'high' ? { TRAIL_N: q.trailPoints, RAIN_DETAIL: 1, REFL_BLUR: 1 } : { TRAIL_N: q.trailPoints },
      uniforms: {
        uTime: sharedUniforms.uTime,
        uFogColor: sharedUniforms.uFogColor,
        uFogDensity: sharedUniforms.uFogDensity,
        uSunDir: sharedUniforms.uSunDir,
        uSunColor: sharedUniforms.uSunColor,
        uRipples: { value: ripples },
        uShore: { value: createShoreMap() },
        uShallow: { value: new THREE.Color() },
        uReflection: { value: null },
        uUseReflection: { value: 0 },
        uTextureMatrix: { value: this.textureMatrix },
        uTrail: { value: this.trail },
        uSkyTop: { value: new THREE.Color() },
        uSkyHorizon: { value: new THREE.Color() },
        uSkyGlow: { value: new THREE.Color() },
        uWaterDeep: { value: new THREE.Color() },
        uLandTint: { value: new THREE.Color() },
        uHemiSky: { value: new THREE.Color() },
        uSunIntensity: { value: 1 },
        uHemiIntensity: { value: 1 },
        uSpec: { value: 1 },
        uWind: { value: 1 },
        uRain: { value: 0 },
      },
    });

    const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();

    if (this.reflectionsEnabled) this.createTarget();
  }

  private createTarget(): void {
    const ext = this.renderer.extensions;
    const canFloat = ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float');
    this.rt = new THREE.WebGLRenderTarget(16, 16, {
      type: canFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
    });
    this.rt.texture.generateMipmaps = false;
    this.material.uniforms.uReflection.value = this.rt.texture;
    this.material.uniforms.uUseReflection.value = 1;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.resize(size.x, size.y);
  }

  setReflections(on: boolean): void {
    this.reflectionsEnabled = on;
    if (on && !this.rt) this.createTarget();
    if (!on && this.rt) {
      this.rt.dispose();
      this.rt = null;
      this.material.uniforms.uReflection.value = null;
    }
    this.material.uniforms.uUseReflection.value = on ? 1 : 0;
  }

  /** Drawing-buffer size in physical pixels. */
  resize(width: number, height: number): void {
    this.rt?.setSize(Math.max(1, Math.round(width * this.reflectionScale)), Math.max(1, Math.round(height * this.reflectionScale)));
  }

  /** A ring from the hull, a bump or another boat; `paddle` adds a swirl and more foam. */
  addRipple(x: number, z: number, strength: number, paddle = false): void {
    const p = this.trail[this.trailHead];
    p.set(x, z, 0, Math.max(0.01, strength) * (paddle ? -1 : 1));
    this.trailHead = (this.trailHead + 1) % this.trail.length;
  }

  update(dt: number, s: AtmosState): void {
    for (const p of this.trail) {
      if (p.w === 0) continue;
      p.z += dt;
      if (p.z > TRAIL_LIFE) p.w = 0;
    }
    const u = this.material.uniforms;
    u.uSkyTop.value.copy(s.skyTop);
    u.uSkyHorizon.value.copy(s.skyHorizon);
    u.uSkyGlow.value.copy(s.skyGlow).multiplyScalar(1 - s.rain * 0.8);
    u.uWaterDeep.value.copy(s.waterDeep);
    // Shallows: the lake bed's olive silt showing through, lit like the land.
    u.uShallow.value.copy(s.landTint).lerp(_silt, 0.55);
    u.uLandTint.value.copy(s.landTint);
    u.uHemiSky.value.copy(s.hemiSky);
    u.uSunIntensity.value = s.sunIntensity;
    u.uHemiIntensity.value = s.hemiIntensity;
    u.uSpec.value = s.waterSpec;
    u.uWind.value = s.wind;
    u.uRain.value = s.rain;
  }

  /** Planar reflection from a mirrored camera with an oblique near plane (same maths as three's Reflector). */
  renderReflection(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.reflectionsEnabled || !this.rt) return;
    const vc = this.virtualCamera;
    const normal = _normal.set(0, 1, 0);
    const camPos = _camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= 0.02) return;

    const view = _view.set(camPos.x, -camPos.y, camPos.z);
    _rot.extractRotation(camera.matrixWorld);
    const lookAt = _look.set(0, 0, -1).applyMatrix4(_rot).add(camPos);
    const target = _target.set(lookAt.x, -lookAt.y, lookAt.z);

    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(_rot).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.layers.set(0);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix);
    this.textureMatrix.multiply(vc.matrixWorldInverse);

    // Oblique clipping so nothing below the water plane leaks into the reflection.
    _plane.setFromNormalAndCoplanarPoint(normal, _origin);
    _plane.applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix;
    _q.x = (Math.sign(_clip.x) + pm.elements[8]) / pm.elements[0];
    _q.y = (Math.sign(_clip.y) + pm.elements[9]) / pm.elements[5];
    _q.z = -1.0;
    _q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    _clip.multiplyScalar(2.0 / _clip.dot(_q));
    pm.elements[2] = _clip.x;
    pm.elements[6] = _clip.y;
    pm.elements[10] = _clip.z + 1.0;
    pm.elements[14] = _clip.w;

    const prev = this.renderer.getRenderTarget();
    this.mesh.visible = false;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.clear();
    this.renderer.render(scene, vc);
    this.renderer.setRenderTarget(prev);
    this.mesh.visible = true;
  }

  dispose(): void {
    this.rt?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

const _silt = new THREE.Color('#4a4a30');
const _normal = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _view = new THREE.Vector3();
const _look = new THREE.Vector3();
const _target = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _rot = new THREE.Matrix4();
const _plane = new THREE.Plane();
const _clip = new THREE.Vector4();
const _q = new THREE.Vector4();
