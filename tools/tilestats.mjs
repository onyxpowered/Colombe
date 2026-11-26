import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectLod } from '../src/unf/world/Lod.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rep = JSON.parse(readFileSync(join(ROOT, 'docs/tiles.json'), 'utf8'));
const R0 = 25.204;
const EYE = 1.6;
const HORIZON = 0.45;
const set = process.argv[2] || 'low';
const bubble = Number(process.argv[3] || 22);
const thresholds = set === 'low' ? [6, 12, bubble] : [6, 12, 20, bubble];
const tiles = Object.values(rep.tiles).filter((t) => t.set === set);
const total0 = tiles.reduce((a, t) => a + t.lods[0].tris, 0);
const oldDraw = total0;
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const runs = [];
for (let n = 0; n < 300; n++) {
  const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  const up = [r * Math.cos(t), u, r * Math.sin(t)];
  const cam = up.map((v) => v * (R0 + EYE));
  let tris = 0, shown = 0, bytes = 0;
  for (const tile of tiles) {
    const d = Math.hypot(cam[0] - tile.center[0], cam[1] - tile.center[1], cam[2] - tile.center[2]);
    const cl = Math.hypot(...tile.center) || 1;
    const dot = (up[0] * tile.center[0] + up[1] * tile.center[1] + up[2] * tile.center[2]) / cl;
    if (dot < HORIZON && d - tile.radius > 6) continue;
    const lod = selectLod(Math.max(0, d - tile.radius), thresholds);
    if (lod < 0) continue;
    const l = tile.lods[Math.min(lod, tile.lods.length - 1)];
    tris += l.tris; bytes += l.bytes; shown++;
  }
  runs.push({ tris, shown, bytes });
}
const q = (k, p) => runs.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(runs.length * p)];
console.log(`set ${set}, bubble ${bubble} m, ${tiles.length} tiles, 300 random ground positions (before frustum culling)`);
console.log(`007 draws every chunk at LOD0 every frame: ${oldDraw} tris`);
console.log(`UNF tiles  tris  median ${q('tris', 0.5)}  p95 ${q('tris', 0.95)}  worst ${q('tris', 1 - 1e-9)}   (${Math.round((1 - q('tris', 0.5) / oldDraw) * 100)}% fewer at median)`);
console.log(`UNF tiles  visible tiles median ${q('shown', 0.5)}  p95 ${q('shown', 0.95)}   resident geometry (compressed) median ${(q('bytes', 0.5) / 1024).toFixed(0)} KB  vs 007 low-memory residency ${(rep.sets.low.reduce((a, s) => a + s.bytes, 0) / 1024).toFixed(0)} KB`);
