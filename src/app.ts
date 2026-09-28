import * as THREE from 'three';
import { runLoadSteps } from './assets/loader';
import { loadTextureLibrary, type TextureLibrary } from './assets/textureLibrary';
import { createRippleNormalMap } from './assets/textures';
import { Birds } from './atmosphere/birds';
import { Lighting } from './atmosphere/lighting';
import { Glows, Particles } from './atmosphere/particles';
import {
  blendState, composeTarget, copyState, createState, toneMappedFogColor, sharedUniforms, type AtmosState, type TimeOfDay, type Weather,
} from './atmosphere/presets';
import { Sky } from './atmosphere/sky';
import { LakeAudio } from './audio/audio';
import { CameraRig, type CameraMode } from './camera/cameraRig';
import { BoatController } from './controls/boatController';
import { Input } from './controls/input';
import { AdaptiveQuality, detectQuality, detectTouch, type QualitySettings } from './core/quality';
import { createRenderer, watchResize } from './core/renderer';
import { UI } from './ui/ui';
import { FlowerBoats } from './world/flowerBoats';
import { buildHouseboat, createHouseboatMaterials, type HouseboatInstance, type HouseboatMaterials } from './world/houseboat';
import { HOUSEBOATS, LANDMARKS, OBSTACLES, SPAWN } from './world/layout';
import { buildProps } from './world/props';
import { PlayerShikara } from './world/shikara';
import { createShikaraMaterials, type ShikaraMaterials } from './world/shikaraModel';
import { buildShoreFringe } from './world/shoreline';
import { buildEmbankment, buildTerrain } from './world/terrain';
import { Forest } from './world/vegetation';
import { Water } from './world/water';

/** Objects on this layer are drawn normally but skipped by the reflection pass. */
const NO_REFLECT = 1;
const SOUND_KEY = 'dal-lake:sound';

export class App {
  readonly quality: QualitySettings;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly ui: UI;
  private input = new Input();
  private audio = new LakeAudio();
  private isTouch = detectTouch();
  private reducedMotion: boolean;

  private rig!: CameraRig;
  private controller = new BoatController(SPAWN.x, SPAWN.z, SPAWN.heading);
  private player!: PlayerShikara;
  private water!: Water;
  private sky!: Sky;
  private lighting!: Lighting;
  private particles!: Particles;
  private glows!: Glows;
  private birds!: Birds;
  private flowerBoats!: FlowerBoats;
  private forest!: Forest;
  private houseboats: HouseboatInstance[] = [];
  private houseboatMats!: HouseboatMaterials;
  private textures!: TextureLibrary;
  private boatMats!: ShikaraMaterials;
  private adaptive: AdaptiveQuality;
  private fog = new THREE.FogExp2('#e2b490', 0.0004);

  private timeOfDay: TimeOfDay = 'sunset';
  private weather: Weather = 'clear';
  private state: AtmosState = createState();
  private target: AtmosState = createState();

  private clock = 0;
  private last = 0;
  private running = false;
  private started = false;
  private uiHidden = false;
  private activeTime = 0;
  private journeyTime = 0;
  private bumpCooldown = 0;
  private landmarkTimer = 1;
  private landmarkSeen = new Map<string, number>();
  private lastLandmark = '';
  private focus = new THREE.Vector3();
  private rainLight = new THREE.Color();
  private tmpColor = new THREE.Color();
  private stopResize: () => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    this.quality = detectQuality();
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', (e) => {
      this.reducedMotion = e.matches;
      if (this.rig) this.rig.reducedMotion = e.matches;
    });

    this.renderer = createRenderer(canvas, this.quality);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.25, 7000);
    this.camera.layers.enable(NO_REFLECT);
    this.scene.fog = this.fog;

    let soundPref = true;
    try {
      soundPref = localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      /* storage unavailable */
    }
    this.audio.setEnabled(soundPref);

    this.ui = new UI(
      {
        onStart: () => this.startJourney(),
        onTime: (t) => this.setTime(t),
        onWeather: (w) => this.setWeather(w),
        onSound: (on) => {
          this.audio.setEnabled(on);
          if (on) this.audio.start();
          try {
            localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
          } catch {
            /* ignore */
          }
        },
        onCamera: (mode) => this.setCamera(mode),
        onHide: (hidden) => (this.uiHidden = hidden),
      },
      this.isTouch,
    );
    this.ui.setSound(soundPref);

    this.input.onShortcut = (code) => this.shortcut(code);
    this.input.bindButton(this.ui.touchRoot.querySelector('[data-dir="fwd"]')!, 'fwd');
    this.input.bindButton(this.ui.touchRoot.querySelector('[data-dir="back"]')!, 'back');
    this.input.bindButton(this.ui.touchRoot.querySelector('[data-dir="left"]')!, 'left');
    this.input.bindButton(this.ui.touchRoot.querySelector('[data-dir="right"]')!, 'right');

    this.adaptive = new AdaptiveQuality((level) => this.stepDownQuality(level));

    document.addEventListener('visibilitychange', () => {
      this.audio.suspend(document.hidden);
      this.last = performance.now();
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.running = false;
      this.ui.showNotice('Graphics were interrupted — trying to restore…', 0);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.ui.hideNotice();
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    });
  }

  async init(): Promise<void> {
    const q = this.quality;
    const scene = this.scene;
    composeTarget(this.timeOfDay, this.weather, this.target);
    copyState(this.state, this.target);

    await runLoadSteps(
      [
        {
          label: 'Gathering materials',
          weight: 2,
          run: async () => {
            this.textures = await loadTextureLibrary(this.renderer);
            this.boatMats = createShikaraMaterials(this.textures);
          },
        },
        {
          label: 'Weaving ripples',
          weight: 1,
          run: () => {
            const ripples = createRippleNormalMap(256);
            this.water = new Water(q, ripples, this.renderer);
            scene.add(this.water.mesh);
          },
        },
        {
          label: 'Raising the valley',
          weight: 3,
          run: () => {
            scene.add(buildTerrain(q));
            
          },
        },
        {
          label: 'Mooring houseboats',
          weight: 2,
          run: () => {
            this.houseboatMats = createHouseboatMaterials(this.textures);
            HOUSEBOATS.forEach((h, i) => {
              const hb = buildHouseboat(h, i, this.houseboatMats);
              this.houseboats.push(hb);
              scene.add(hb.group);
            });
          },
        },
        {
          label: 'Planting the shore',
          weight: 3,
          run: () => {
            const props = buildProps(q, this.houseboatMats, this.boatMats, this.textures);
            scene.add(props.group);
            scene.add(buildShoreFringe(q, this.textures));
            this.forest = new Forest(q, props, this.renderer);
            scene.add(this.forest.group);
            scene.add(buildEmbankment(this.textures));
            const lanterns = [...props.lanterns, ...this.houseboats.flatMap((h) => h.lanterns)];
            this.flowerBoats = new FlowerBoats(q.tier === 'high' ? 3 : 2, this.boatMats);
            scene.add(this.flowerBoats.group);
            this.glows = new Glows(lanterns, 1 + this.flowerBoats.lanterns.length);
            scene.add(this.glows.points);
          },
        },
        {
          label: 'Launching the shikara',
          weight: 1,
          run: () => {
            this.player = new PlayerShikara(this.boatMats);
            scene.add(this.player.root);
            this.rig = new CameraRig(this.camera, this.renderer.domElement, OBSTACLES, this.reducedMotion);
            this.rig.setMode('cinematic');
          },
        },
        {
          label: 'Painting the sky',
          weight: 1,
          run: () => {
            this.sky = new Sky();
            scene.add(this.sky.mesh);
            this.lighting = new Lighting(scene, q);
            this.particles = new Particles(q.particles, NO_REFLECT);
            scene.add(this.particles.group);
            this.birds = new Birds(this.reducedMotion);
            scene.add(this.birds.mesh);
          },
        },
        {
          label: 'Lighting the lanterns',
          weight: 2,
          run: async () => {
            this.stopResize = watchResize(this.renderer, this.camera, () => this.onResize());
            this.update(0);
            try {
              await this.renderer.compileAsync(scene, this.camera);
            } catch {
              this.renderer.compile(scene, this.camera);
            }
          },
        },
      ],
      (f, label) => this.ui.setProgress(f, label),
    );

    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.frame);
    this.ui.ready();
  }

  private onResize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.water?.resize(size.x, size.y);
    sharedUniforms.uPixelScale.value = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  private startJourney(): void {
    if (this.started) return;
    this.started = true;
    this.audio.start();
    this.input.enabled = true;
    this.rig.setMode('chase');
    this.ui.setCamera('chase');
    this.ui.enterJourney();
    this.renderer.domElement.focus({ preventScroll: true });
  }

  private setTime(t: TimeOfDay): void {
    this.timeOfDay = t;
    composeTarget(this.timeOfDay, this.weather, this.target);
  }

  private setWeather(w: Weather): void {
    this.weather = w;
    composeTarget(this.timeOfDay, this.weather, this.target);
  }

  private setCamera(mode: CameraMode): void {
    this.rig.setMode(mode);
  }

  private shortcut(code: string): void {
    if (!this.started) {
      if (code === 'Enter' || code === 'Space') this.ui.onStartRequested();
      return;
    }
    switch (code) {
      case 'KeyC':
        this.ui.toggleCamera();
        break;
      case 'KeyH':
        this.ui.toggleHidden();
        break;
      case 'KeyM':
        this.ui.toggleSound();
        break;
      case 'KeyR': {
        const w = this.weather === 'rain' ? 'clear' : 'rain';
        this.ui.setWeather(w);
        this.setWeather(w);
        break;
      }
      case 'Digit1':
      case 'Digit2':
      case 'Digit3': {
        const t = (['dawn', 'sunset', 'night'] as const)[Number(code.slice(-1)) - 1];
        this.ui.setTime(t);
        this.setTime(t);
        break;
      }
    }
  }

  private stepDownQuality(level: number): boolean {
    const r = this.renderer;
    switch (level) {
      case 1:
        if (r.getPixelRatio() <= 1.25) return this.stepDownQuality(2);
        r.setPixelRatio(1.25);
        break;
      case 2:
        if (!this.water.reflectionsEnabled) return this.stepDownQuality(3);
        this.water.setReflections(false);
        break;
      case 3:
        if (r.getPixelRatio() <= 1) return this.stepDownQuality(4);
        r.setPixelRatio(1);
        break;
      case 4:
        if (!this.lighting.sun.castShadow) return false;
        this.lighting.setShadows(false);
        break;
      default:
        return false;
    }
    this.onResize();
    console.info(`[quality] stepped down to level ${level}`);
    return true;
  }

  private frame = (now: number) => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.update(dt);
    this.render();
    if (this.started) this.adaptive.update(dt);
  };

  private update(dt: number): void {
    this.clock += dt;
    const t = this.clock;
    sharedUniforms.uTime.value = t;

    // Atmosphere eases between presets over a few seconds.
    blendState(this.state, this.target, 1 - Math.exp(-dt * (this.reducedMotion ? 2.5 : 1.1)));
    const s = this.state;
    this.renderer.toneMappingExposure = s.exposure;
    this.applyScreenFog();
    this.fog.density = s.fogDensity;
    sharedUniforms.uFogDensity.value = s.fogDensity;
    sharedUniforms.uSunDir.value.copy(s.sunDir);
    sharedUniforms.uSunColor.value.copy(s.sunColor);
    sharedUniforms.uWind.value = this.reducedMotion ? s.wind * 0.4 : s.wind;

    // Boat.
    const axes = this.input.read();
    if (this.started && (axes.throttle !== 0 || axes.steer !== 0)) this.activeTime += dt;
    const contact = this.controller.update(dt, axes, OBSTACLES, this.flowerBoats.obstacles);
    this.bumpCooldown -= dt;
    if (contact && contact.strength > 0.35 && this.bumpCooldown <= 0) {
      this.bumpCooldown = 0.5;
      this.player.bump(contact.strength);
      this.audio.bump(contact.strength);
      this.water.addRipple(contact.x, contact.z, Math.min(1, contact.strength * 0.4));
    }
    this.player.update(dt, t, this.controller, s.lantern, this.reducedMotion, (e) => {
      this.water.addRipple(e.x, e.z, e.strength, e.paddle);
      if (e.audible) this.audio.splash(e.strength);
    });
    this.flowerBoats.update(dt, t, this.controller, this.quality.tier === 'high' ? (x, z, st) => this.water.addRipple(x, z, st) : null);

    // Camera.
    this.rig.update(dt, { x: this.controller.x, z: this.controller.z, heading: this.controller.heading, speed: this.controller.forwardSpeed }, s.sunDir);

    // Level of detail: trees swap between models and impostors; houseboat fretwork drops out far away.
    this.camera.updateMatrixWorld();
    this.forest.update(this.camera);
    const cam = this.camera.position;
    for (const hb of this.houseboats) hb.detail.visible = cam.distanceToSquared(hb.group.position) < 230 * 230;

    // Lights, sky, water and particles.
    this.focus.set(this.controller.x, 0, this.controller.z);
    this.lighting.update(s, this.focus);
    this.sky.update(this.camera, s);
    this.water.update(dt, s);
    this.birds.update(dt, t, s.birds);
    this.rainLight.copy(s.hemiSky).multiplyScalar(s.hemiIntensity * 0.85).add(this.tmpColor.copy(s.sunColor).multiplyScalar(s.sunIntensity * 0.08));
    this.particles.update(this.camera, s, this.rainLight, this.fog.color);
    this.houseboatMats.windowLit.emissiveIntensity = 0.05 + s.lantern * 2.6;
    this.houseboatMats.windowDim.emissiveIntensity = 0.02 + s.lantern * 0.9;
    this.glows.setDynamic(0, this.player.lanternWorld);
    this.flowerBoats.lanterns.forEach((p, i) => this.glows.setDynamic(i + 1, p));
    this.glows.update(s.lantern);

    this.audio.update(dt, { speed: this.controller.forwardSpeed, rain: s.rain, night: s.stars, birds: s.birds });

    if (this.started) {
      this.journeyTime += dt;
      if (this.activeTime > 8 || this.journeyTime > 30) this.ui.fadeHint();
      this.updateLandmarks(dt);
    }
  }

  private updateLandmarks(dt: number): void {
    this.landmarkTimer -= dt;
    if (this.landmarkTimer > 0 || this.uiHidden) return;
    this.landmarkTimer = 0.5;
    const { x, z } = this.controller;
    const now = this.clock;
    const ready = (id: string) => id !== this.lastLandmark && now - (this.landmarkSeen.get(id) ?? -Infinity) > 90;

    if (this.flowerBoats.nearest(x, z) < 14 && ready('flowers')) {
      this.announce('flowers', 'Flower seller', 'Marigolds and lotus, paddled from houseboat to houseboat.');
      return;
    }
    let best: (typeof LANDMARKS)[number] | null = null;
    let bestD = Infinity;
    for (const l of LANDMARKS) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < l.r && d < bestD) {
        best = l;
        bestD = d;
      }
    }
    if (best && ready(best.id)) this.announce(best.id, best.title, best.text);
  }

  private announce(id: string, title: string, text: string): void {
    this.landmarkSeen.set(id, this.clock);
    this.lastLandmark = id;
    this.ui.showCaption(title, text);
  }

  /**
   * Fog for the on-screen pass. three converts fog.color to sRGB itself; the
   * custom shaders mix fog after their own encoding, so they get the encoded copy.
   */
  private applyScreenFog(): void {
    toneMappedFogColor(this.state.fogColor, this.state.exposure, this.fog.color);
    sharedUniforms.uFogColor.value.copy(this.fog.color).convertLinearToSRGB();
  }

  private render(): void {
    const r = this.renderer;
    if (this.lighting.sun.castShadow) r.shadowMap.needsUpdate = true;
    // The reflection target is linear and not tone mapped, so it takes the raw fog colour.
    if (this.water.reflectionsEnabled) {
      this.fog.color.copy(this.state.fogColor);
      sharedUniforms.uFogColor.value.copy(this.state.fogColor);
      this.water.renderReflection(this.scene, this.camera);
      this.applyScreenFog();
    }
    r.render(this.scene, this.camera);
  }

  dispose(): void {
    this.running = false;
    this.stopResize();
    this.water?.dispose();
    this.renderer.dispose();
  }
}
