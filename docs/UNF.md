# UniFi Engine (UNF)

Project Colombe's official name. Vanilla JS (ES2022 modules), three.js 0.187, Vite. Engine code is in `src/unf`, game code in `src/game` and `src/world`. Target: Chromebook, ChromeOS Chrome, 8 GB RAM, Mali GPU (see BUDGET.md).

## Layout
```
src/unf/
  Engine.js            wires everything; per-tier budgets from core/Quality.js
  core/                Renderer, Quality (tiers + governor), Loop, Input
  assets/              Loader (priority queue), Cache (ref-counted, byte budget, LRU),
                       Geometry (+ dracoWorker), Textures (KTX2/ETC2/ASTC, ImageBitmap), Manifest
  audio/               Audio (buses, voices, decode LRU, streamed playlists), VoicePool, Format
  text/                GlyphAtlas (SDF), NameTags (one instanced draw), Icons (SVG sprite), Sdf
  world/               ChunkStreamer (LOD swap, one GPU upload per frame), Lod, Horizon
  debug/Stats.js       F3 overlay
tools/                 inventory, optimize, retile, manifest, tilestats, smoke, bench
test/                  node:test unit tests
dev/smoke.html         browser smoke page (run with tools/smoke.mjs)
```

## Asset pipeline (`npm run assets`)
1. `inventory.mjs` reads every file 007 ships, decodes every Draco mesh, checks every reference. Writes `docs/INVENTORY.md`, `docs/inventory.json`.
2. `optimize.mjs` transcodes each unique sound to one Opus file (capped at 85% of the source bitrate) into `.cache/audio`.
3. `retile.mjs` re-cuts the planet into 51 spatial tiles per LOD into `.cache/tiles`, verifies no triangle is lost. Writes `docs/tiles.json`.
4. `manifest.mjs` writes `public/manifest.json` (sounds, tiles with bounds, textures, geometry groups).

007's assets are never copied into this repo. In dev, `vite.config.js` serves them from `../007/assets` (override with `UNF_ASSETS`) at `/a/`, and generated files from `.cache`. Check licensing before shipping anything derived from them.

## What 007 loads, and what UNF does about it
| 007 | Finding | UNF |
|---|---|---|
| 233 `.drc` meshes, 18.5 MB, 2.4 M triangles | Planet = 10 "chunks" that each span the whole planet (bounds 30-40 m on a 25 m planet), so per-chunk distance LOD and the render bubble never cull on the ground. All four LOD sets stay resident. | Planet re-tiled into 51 spatial tiles; one LOD resident per tile; horizon + bubble culling. About 75% fewer triangles at the median (simulated, before frustum culling); compressed resident geometry about 0.5 MB vs 4.4 MB. |
| Draco decode on main-thread-adjacent workers, float32 everywhere | | Draco worker decodes off-thread, packs normals to int8, colours to uint8, UVs to uint16 when in range: about 24% less GPU memory on a sample planet mesh. Transfers buffers, no copies. |
| 20 `.ktx2` (Basis UASTC/ETC1S) | Already the right format. `atlas.ktx2` is an HTML error page (unused). | KTX2Loader with transcoder; picks ETC2/ASTC on this GPU; ImageBitmap closed after upload for PNG/WebP. |
| 151 audio files, 96 unique sounds in up to 3 encodings | Decoding every sound would need about 800 MB of PCM. 8 OST tracks are 26 MB of AAC. | One Opus file per sound (23.2 MB vs 31.5 MB a Chrome client fetches today, -26%). SFX decode into a 24-40 MB LRU; long tracks stream through an audio element. Voice cap, per-sound min gap, priority stealing, 5 buses. |
| `.font` (3), `.icon` (19) Abeto containers + `glyph.wasm` | Proprietary format needing Abeto's wasm | Replaced: SDF glyph atlas for in-world text, SVG sprite for icons. Needs open-licensed font and icon art. |
| `msdfworker`, `exrworker` referenced | Missing from the 007 restore | Not needed. |
| 007 `tools/navbake.js` | Missing; nav data (13,829 nodes) lives inline in the bundle | Not ported yet. |

## Not done yet
- Avatar / NPC animation: `.drc` point clouds with bones and clips in an Abeto-specific layout. Needs its own bake format.
- Collision (`hitmesh_*`), materials/shaders for the terrain, water, sky, particles, grass, trees.
- Seams between neighbouring tiles at different LODs (no skirts yet).
- Real-Mali verification. Everything measured so far ran on Apple GPU.
