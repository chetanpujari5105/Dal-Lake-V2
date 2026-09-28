# Performance log

All numbers come from one repeatable harness: Playwright driving the installed Google Chrome, headless, with the GPU on (ANGLE Metal on an Apple M3 Pro MacBook Pro). The harness places the boat and camera at fixed spots and renders a frame. Triangles and draw calls are for the **main pass only** (`renderer.info` after the final `render`); the desktop reflection pass costs extra.

- **Desktop:** 1440 × 810 CSS px at devicePixelRatio 2, rendered at the high tier's capped pixel ratio of 1.75.
- **Simulated mobile:** 390 × 844 CSS px at DPR 3, touch, iPhone user agent, which selects the low tier (pixel ratio 1.5). This is **Chrome emulation on the laptop GPU, not a real phone**; its frame rate says nothing about phone GPUs.
- **Frame rate:** measured live over 8 s while paddling forward in the default chase view.
  - **Capped:** normal vsync; the display runs at 60 Hz here.
  - **Uncapped:** `--disable-gpu-vsync --disable-frame-rate-limit`, which shows headroom.

The Stage 1 report used a different window size (801k triangles / 172 calls in the chase view). On this harness the same Stage 1 commit measures 758k / 164, and all comparisons below use the harness numbers.

## Default chase view

| Build | Triangles | Draw calls | FPS (vsync) | FPS (uncapped) | p95 frame (uncapped) |
| --- | --- | --- | --- | --- | --- |
| Stage 1 (`bfcc896`) | 758k | 164 | 60 | 178 | 9.9 ms |
| Stage 2 | 936k | 199 | 60 | 142 | 12.4 ms |
| Stage 3 | 936k | 199 | 60 | 141 | 12.7 ms |
| **Final (Stage 5)** | **553k** | **108** | **60** | **172** | **10.7 ms** |

| Build | Simulated-mobile triangles | Draw calls | FPS (vsync, laptop GPU) |
| --- | --- | --- | --- |
| Stage 1 | 359k | 127 | 60 |
| Stage 2 | 446k | 157 | 60 |
| Stage 3 | 446k | 157 | 60 |
| **Final (Stage 5)** | **336k** | **76** | **60** |

Stage 3 changed shaders and lighting rather than geometry.
- **Water shader:** gust patches, wake calm, multi-scale rain, a baked shore-distance map, and a 3-tap reflection blur on the high tier only. It costs about 1 fps uncapped.
- **Low tier:** skips the third rain layer and the reflection blur.
- **Foliage:** switching to Lambert made it slightly cheaper.

## Other views (desktop, main pass)

| View | Stage 1 | Stage 2 | Final |
| --- | --- | --- | --- |
| Side | 378k / 48 | 456k / 54 | 411k / 56 |
| Close-up | 520k / 91 | 661k / 112 | 471k / 70 |
| Landscape | 432k / 91 | 566k / 110 | 373k / 76 |
| Garden | 582k / 45 | 638k / 47 | 455k / 77 |

Stage 2 notes:
- **New content:** leaf-card trees, a terrain mesh twice as fine on the far ranges, houses with roofs, balconies and timber, and houseboat carving.
- **Where it went:** the triangle rise is mostly houses and houseboat balusters, which have no distance LOD yet.
- **Culling:** near trees are frustum-culled per tree, and distant trees are 6-triangle impostors in one draw call.
- **Next:** Stage 5 targets the rest.

## Stage 5: where the cost went, and what changed

A per-object breakdown of the Stage 3 chase view (main pass, visible and in the frustum) showed:

| Source | Stage 3 | What was done | Final |
| --- | --- | --- | --- |
| Floating-garden crops and grass (all 350 m+ from the spawn) | 169k | 130 m cells with draw distances of 170–300 m; grass left out of reflections | 0 at spawn (drawn when near) |
| Distant-tree impostors (one lake-wide mesh, never culled) | 123k | Split into 700 m cells, so off-screen cells are culled | ~80k |
| Moored ghat boats and village houses | 205k | Ghat boats swap to a coarse version beyond 110 m; window trim reduced to a lintel | ~60k |
| Shore grass, reeds and stones (lake-wide) | 50k | 150 m cells with 150–280 m draw distances | ~0–20k by position |
| Houseboats: 84 draw calls | 131k / 84 | Merged per material, name boards in one atlas, carving per row hidden beyond 150 m | ~130k / 8 |

GPU time, not triangles, limited the frame rate. Toggling subsystems off (idle chase view, uncapped) showed:
- **Terrain:** about 1.0 ms. Its per-pixel noise ran in both the main and reflection passes. It is now masked and single-octave for the micro-relief.
- **Shadow map:** about 0.9 ms. It now refreshes every second frame.
- **Reflection pass:** about 0.7 ms. Unchanged; it is the first thing the adaptive quality drops.

The combined result: idle uncapped 167 → 189 fps, and paddling uncapped 141 → 172 fps (Stage 1: 178).

Limits:
- **No real phone:** all mobile numbers are Chrome emulation on the laptop GPU.
- **Side view:** triangles (411k) are higher than they would be with per-boat culling, because each merged houseboat row is drawn whole when any part is visible. The trade was about 76 fewer draw calls. It is still below Stage 2 and Stage 3 (456k).
