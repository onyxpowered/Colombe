# UniFi Engine (UNF) performance budget

Target device: Chromebook, ChromeOS Chrome, 8 GB RAM, Mali GPU (tile-based, bandwidth and fill-rate bound, weak at overdraw and fat fragment shaders).

## Hard rules
- No MSAA, no full-screen post chain by default. One render pass straight to the canvas.
- Render at most 1366x768 pixels (tier `chromebook`); the governor lowers the scale in 5% steps (floor 50%) when p90 frame time exceeds budget by 25%, and raises it again after 4 calm windows.
- Fixed 60 Hz simulation, render interpolated. Sim never runs more than 5 catch-up steps.
- Draw calls under 100, triangles under 150k per frame. Props are instanced; one draw call per prop family.
- Cheap materials only: MeshLambert / custom unlit with `mediump`. No transmission, no PBR clearcoat, no per-pixel lights beyond one sun + hemisphere.
- No dynamic shadow maps on `chromebook` and `balanced`. Desktop tier only; static (`autoUpdate = false`).
- Alpha blending sparingly: overdraw is the Mali killer. Prefer alpha-test or dithering.
- Textures: KTX2 (ETC2 / ASTC) only, 512 max for props, atlas everything. No per-frame allocations in sim or render paths.
- Heap target under 600 MB; geometry and textures disposed on scene change.

## Tiers (src/core/Quality.js)
| Tier | Pixels | Shadows | Fog far | Instances |
|---|---|---|---|---|
| chromebook | 1366x768 | off | 160 | 600 |
| balanced | 1920x1080 | off | 260 | 1200 |
| desktop | 2560x1440 | on | 420 | 2400 |

Picked by GPU string (Mali/Adreno/PowerVR/Intel HD/software), core count and `deviceMemory`; force with `?tier=chromebook|balanced|desktop`. F3 shows the live stats overlay.

## Next up
1. Authoritative game server (Bun, WebSocket, 20-30 Hz snapshots, server-side hit validation) replacing Firebase relay.
2. Collision: baked BVH or analytic colliders for buildings, capsule controller with step-up.
3. Weapons and bots ported from 007 as readable modules, server-owned.
4. KTX2 asset pipeline, Draco/meshopt geometry, baked nav mesh with the generator kept in-tree.
