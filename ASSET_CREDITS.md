# Asset credits

Every third-party file shipped with this project is listed here with its source, creator and licence. If an asset's licence is unclear, it is not used.

## Textures (public/textures)

All four sets are from [Poly Haven](https://polyhaven.com), released under **CC0 1.0 Universal** (public domain, no attribution required; credited here anyway). The 1k JPG originals were converted to WebP (colour at quality 82, normal maps at quality 90) to keep downloads small.

| Files | Asset | Creator | Source | Licence | Used for |
| --- | --- | --- | --- | --- | --- |
| `dark_planks_diff.webp`, `dark_planks_nor_gl.webp`, `dark_planks_rough.webp` | Dark Planks | Rob Tuytel | https://polyhaven.com/a/dark_planks | CC0 | Shikara hull, rails, carved trim |
| `brown_planks_07_diff.webp`, `brown_planks_07_nor_gl.webp` | Brown Planks 07 | Rob Tuytel | https://polyhaven.com/a/brown_planks_07 | CC0 | Shikara decks, paddle, flower baskets |
| `brown_mud_rocks_01_diff.webp`, `brown_mud_rocks_01_nor_gl.webp` | Brown Mud Rocks 01 | Rob Tuytel | https://polyhaven.com/a/brown_mud_rocks_01 | CC0 | Floating-garden beds |
| `rock_boulder_dry_diff.webp`, `rock_boulder_dry_nor_gl.webp` | Rock Boulder Dry | Dimitrios Savva (photography), Rico Cilliers (processing) | https://polyhaven.com/a/rock_boulder_dry | CC0 | Shoreline stones |

Licence text: https://creativecommons.org/publicdomain/zero/1.0/ and https://polyhaven.com/license

Total size: about 1.9 MB.

## Generated in code (original to this project)

These are not third-party assets:

- **Canvas-painted textures:** canopy fabrics (paisley and blossom motifs in four colourways), embroidered valance borders, namda-style carpet, wool for the pheran, grass, reed and collard-leaf alpha cards, and houseboat name boards (`src/assets/textureLibrary.ts`, `src/assets/textures.ts`).
- **Geometry:** shikara hull, canopy, cushions, boatman and paddle (`src/world/shikaraModel.ts`); floating-garden beds and plants (`src/world/gardens.ts`); shoreline reeds, grass and stones (`src/world/shoreline.ts`, `src/world/foliage.ts`); and the rest of the scene.
- **Water ripple map:** generated from summed sine waves (`src/assets/textures.ts`).
- **Audio:** synthesised with the Web Audio API (`src/audio/audio.ts`). There are no audio files.

## Fonts

- [Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) by Christian Thalmann, SIL Open Font License 1.1
- [Inter](https://fonts.google.com/specimen/Inter) by Rasmus Andersson, SIL Open Font License 1.1

Both are loaded from Google Fonts at runtime and are not bundled.

## Libraries

- [three.js](https://threejs.org) 0.169.0, MIT licence, including the `RoundedBoxGeometry` and `BufferGeometryUtils` add-ons.
