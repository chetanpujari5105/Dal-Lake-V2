# Dal Lake: A Shikara Journey

A stylised, playable 3D boat journey across Dal Lake in Srinagar, built with Vite, TypeScript and Three.js. You paddle a decorated shikara at golden hour, past carved houseboats along the Boulevard, the shikara ghat, Nishat Bagh's terraces, Char Chinar island, the floating gardens and the lotus beds, with Hari Parbat's fort on the western skyline.

Code, geometry and sound are original and procedural. The only third-party files are four CC0 photo-texture sets from Poly Haven (wood, mud, rock); see [ASSET_CREDITS.md](ASSET_CREDITS.md).

## Setup

Requires Node 18 or newer.

```bash
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run typecheck  # TypeScript only
```

URL options: `?quality=low` or `?quality=high` override the automatic device tier.

## Versions

| Package | Version | Notes |
| --- | --- | --- |
| three | **0.169.0** (pinned exactly) | Uses `compileAsync`, `WebGLRenderTarget`, and `three/addons/utils/BufferGeometryUtils.js`. Custom shaders rely on r169 chunk names (`tonemapping_fragment`, `colorspace_fragment`) and on r169 fog handling (fog colour converted to the output colour space by three). Re-check these before upgrading. |
| @types/three | 0.169.0 | |
| vite | 5.4.10 | |
| typescript | 5.6.3 | |

WebGL 2 is required. Browsers without it get a clear message instead of a blank page.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Paddle forward / back | `W` / `S` or `↑` / `↓` | ▲ / ▼ buttons (hold) |
| Steer | `A` / `D` or `←` / `→` | ◀ / ▶ buttons (hold) |
| Orbit camera | Drag | One-finger drag |
| Zoom | Mouse wheel | Pinch |
| Chase / cinematic camera | `C` | Camera button |
| Time of day | `1` dawn · `2` sunset · `3` night | Top-right selector |
| Rain on/off | `R` | Top-right selector |
| Sound (everything) | `M` | Speaker button |
| Music mute / volume | `N` / slider | Note button / slider |
| Hide UI | `H` | Eye button (tap the faint eye to restore) |

Steering always swings the bow in the direction pressed, including in reverse, as with a paddle. After you stop dragging, the chase camera drifts back behind the boat.

## Background music (optional)

The project ships **without** a music file. To add one:

1. Use only a track you have the right to publish on the web, such as your own recording, a commissioned piece, or music under a licence that allows it (CC0, CC BY or a purchased web licence). Do not use audio downloaded or extracted from YouTube or other streaming sites.
2. Save it as MP3 at exactly **`public/audio/soundtrack.mp3`**, creating the `audio` folder. Keep it under about 5 MB; 2–4 minutes at 128–160 kbps is plenty. The file loops with a 3-second crossfade, so it doesn't need a seamless loop point.
3. Credit it in [ASSET_CREDITS.md](ASSET_CREDITS.md), under **Audio**, using the template there: title, artist, source URL, licence and licence URL, plus any attribution text the licence requires word for word.
4. Run `npm run build`. Vite copies `public/` into `dist/` as is.

How it behaves:
- **Start:** music starts only after **Start journey** is clicked, then fades in over 4 seconds at a low default volume (40% on the slider). A volume you set is kept for the rest of the browser session and takes precedence over the default; a new session starts at 40%.
- **Controls:** the note button (or `N`) mutes and unmutes it, and the slider sets its level. Both settings persist for the browser session (`sessionStorage`).
- **Sound toggle:** the speaker button (or `M`) silences everything, music included.
- **No file:** if the file is missing or can't be decoded, the music control shows **No music**, and its tooltip and a notice explain why. Everything else keeps working.

## Architecture

```
src/
  main.ts               boot: WebGL 2 check, error screens
  app.ts                orchestration: load steps, frame loop, preset blending, captions
  core/                 math + noise, MeshBuilder (merged, vertex-coloured geometry),
                        quality tiers + adaptive step-down, renderer + resize
  assets/               loader (progress steps), procedural textures (ripple map, name boards),
                        textureLibrary (CC0 photo textures + painted fabric, carpet and foliage cards)
  world/
    layout.ts           shoreline polygon, signed-distance field, terrain height,
                        obstacle footprints, landmarks, spawn, flower-seller route
    terrain.ts          polar terrain mesh (dense near shore, sparse to the ranges), embankment
    water.ts            water shader, planar reflection, wake/ripple emitters
    shikaraModel.ts     detailed shikara: lofted planked hull, carved rails, turned posts, fabric canopy,
                        scalloped valance, curtains, cushions, boatman, heart-shaped paddle
    shikara.ts          player boat: bobbing, tilting, paddling, wake emission
    gardens.ts          floating gardens: irregular domed beds, crops, grass, reeds
    shoreline.ts        reeds, bank grass and stones along the natural shore
    foliage.ts          wind-swayed alpha-card foliage, rosettes, stones, instancing helpers (plain and cell-culled)
    houseboat.ts        carved houseboats (lofted hull, tin roofs, lattice windows), merged per material
    props.ts            floating gardens, lotus, Char Chinar, ghat, Boulevard, Nishat Bagh,
                        Hari Parbat fort, Kashmiri houses
    trees.ts            painted leaf and impostor atlases, leaf-card tree models, tree materials
    vegetation.ts       tree placement and per-frame model/impostor swap with culling
    flowerBoats.ts      flower sellers paddling a loop
  atmosphere/
    presets.ts          dawn / sunset / night × clear / rain, smooth blending, shared uniforms
    sky.ts              gradient sky, sun, clouds, moon and stars
    lighting.ts         sun/moon with texel-snapped shadow box, hemisphere fill
    particles.ts        lantern glows, dust motes, fireflies, rain streaks, dawn mist (GPU-animated)
    birds.ts            instanced flocks with GPU wing flaps
  controls/             keyboard + touch input, boat physics and collision
  camera/cameraRig.ts   chase camera (orbit, zoom, occlusion pull-in) + cinematic shots
  ui/                   title screen, HUD, captions, touch controls, notices, styles
  audio/audio.ts        Web Audio synthesis: lake murmur, hull lapping, splashes, rain, birds, crickets
```

### Key techniques

- **Water:** three scrolling scales of a tileable procedural slope map, plus Fresnel, sun or moon glitter and foam. The wake is a ring buffer of up to 56 emitters, each an expanding ring, so consecutive points form a V-shaped wake. Paddle strokes, bumps and flower boats add their own rings. Rain adds cell-based drop ripples.
- **Reflections:** on desktop, a half-resolution planar reflection from a mirrored camera with an oblique near plane. Foliage, particles and distant forests sit on a layer the reflection pass skips. On mobile it falls back to sky plus a shoreline-tint approximation.
- **Fog consistency:** three.js mixes fog after tone mapping, so the fog colour is pre-tone-mapped with the same ACES curve. Distant ranges meet the sky without a band. The reflection pass swaps in the raw linear fog colour.
- **Collision:** four hull sample circles against the shoreline's signed-distance field, oriented boxes (houseboats, gardens, ghat), a circle (Char Chinar) and moving circles (flower boats). Inward velocity is removed with a small bounce, and glancing blows yaw the hull.
- **Motion:** inputs, acceleration, braking, turning, bob, pitch, roll and camera are all eased or spring-damped. Nothing snaps.

### Performance

- **Pixel ratio:** capped at 1.75 on desktop and 1.5 on mobile.
- **Trees:** every tree has a near model (leaf cards) and a far impostor (3 crossed quads). Each frame, trees within 190 m (125 m on mobile) that are inside the view use the model; everything else is an impostor. Impostors are grouped into 700 m cells, so the cells behind the camera are culled.
- **Ground cover:** garden crops, grass, reeds and bank stones are instanced in 130–150 m cells with draw distances of 150–300 m, shorter on mobile. Off-screen and distant cells cost nothing. Grass is left out of the reflection pass.
- **Batching:** all 13 houseboats merge into one mesh per material, with their name boards in one texture atlas. Carving is one mesh per mooring row and is hidden beyond 150 m. Moored ghat boats swap to a coarse version beyond 110 m. Village houses are merged into four meshes.
- **Terrain:** inner and outer grids are split into angular sectors that are frustum-culled. Per-pixel detail runs only where its mask is non-zero.
- **Shadows:** one shadow map (2048 desktop, 1024 mobile) covering 110 m around the boat. It refreshes every second frame (the sun is fixed and the boat slow) and is shared with the reflection pass.
- **Measured:** see [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for triangles, draw calls and frame rate at each stage.
- **Adaptive quality:** if frames stay slower than ~38 fps, quality steps down in order: pixel ratio, reflections, pixel ratio 1, shadows.
- **Background tabs:** rendering pauses when the tab is hidden, and audio suspends.

### Loading and failure states

- **Loading:** a progress bar fills the Start button while the lake is generated and shaders compile.
- **No WebGL 2 / build failure:** a readable error card appears with technical details and a Reload button.
- **Lost graphics context:** a notice appears while the app attempts to recover.

### Accessibility and reduced motion

- **Reduced motion:** with `prefers-reduced-motion`, UI transitions are removed, boat roll and pitch are halved, cinematic camera moves run at half speed, and bird wing beats slow.
- **Controls:** all are real `<button>`s with pressed states and focus rings. Keyboard shortcuts mirror every control.
- **Touch targets:** 64 px, and they respect safe-area insets.

## Milestones

1. **MVP:** lit scene, water, boat, steering, camera, resize handling, one houseboat.
2. **Water:** ripple layers, planar reflection, wake, rain ripples.
3. **Landmarks:** houseboat rows, ghat, Nishat Bagh, Char Chinar, floating gardens, lotus beds, Hari Parbat, houses, vegetation.
4. **Atmosphere:** sunset (first), dawn mist, lantern-lit night, rain; birds, dust, fireflies; synthesized audio.
5. **Finish:** loading and error states, mobile controls and quality tier, reduced motion, README.

Possible next steps: Hazratbal and the Shalimar/Nishat approaches along the northern shore, vendors hailing the player, a paddle-sound variant for rain, and GPU timing on real mid-range phones.

## Credits

- **Code, models, sounds:** original to this project, generated procedurally at runtime.
- **Textures:** Dark Planks, Brown Planks 07, Brown Mud Rocks 01 (Rob Tuytel) and Rock Boulder Dry (Dimitrios Savva, Rico Cilliers), from Poly Haven under CC0. The full list is in [ASSET_CREDITS.md](ASSET_CREDITS.md).
- **three.js:** MIT licence, © three.js authors. The planar-reflection maths follows the approach of three's `Reflector` example.
- **Fonts:** [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) (Christian Thalmann) and [Inter](https://fonts.google.com/specimen/Inter) (Rasmus Andersson), both under the SIL Open Font License, served by Google Fonts. Offline, the UI falls back to Georgia and system sans-serif.
- **Place references:** the layout and forms draw on public photographs and maps of Dal Lake: Boulevard houseboats, shikara ghats, Char Chinar, the Raad floating gardens, Nishat Bagh and Hari Parbat. The scene is an interpretation, not a survey. Houseboat names are invented.
