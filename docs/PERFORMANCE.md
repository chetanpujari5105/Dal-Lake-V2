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

| Build | Simulated-mobile triangles | Draw calls | FPS (vsync, laptop GPU) |
| --- | --- | --- | --- |
| Stage 1 | 359k | 127 | 60 |
| Stage 2 | 446k | 157 | 60 |
| Stage 3 | 446k | 157 | 60 |

Stage 3 changed shaders and lighting rather than geometry.
- **Water shader:** gust patches, wake calm, multi-scale rain, a baked shore-distance map, and a 3-tap reflection blur on the high tier only. It costs about 1 fps uncapped.
- **Low tier:** skips the third rain layer and the reflection blur.
- **Foliage:** switching to Lambert made it slightly cheaper.

## Other views (desktop, main pass)

| View | Stage 1 | Stage 2 |
| --- | --- | --- |
| Side | 378k / 48 | 456k / 54 |
| Close-up | 520k / 91 | 661k / 112 |
| Landscape | 432k / 91 | 566k / 110 |
| Garden | 582k / 45 | 638k / 47 |

Stage 2 notes:
- **New content:** leaf-card trees, a terrain mesh twice as fine on the far ranges, houses with roofs, balconies and timber, and houseboat carving.
- **Where it went:** the triangle rise is mostly houses and houseboat balusters, which have no distance LOD yet.
- **Culling:** near trees are frustum-culled per tree, and distant trees are 6-triangle impostors in one draw call.
- **Next:** Stage 5 targets the rest.
