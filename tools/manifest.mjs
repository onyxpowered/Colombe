import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import draco3d from 'draco3d';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inv = JSON.parse(readFileSync(join(ROOT, 'docs/inventory.json'), 'utf8'));
const dec = await draco3d.createDecoderModule({});

function bounds(file) {
  const d = new dec.Decoder();
  const b = new dec.DecoderBuffer();
  const buf = readFileSync(file);
  b.Init(new Int8Array(buf), buf.length);
  const mesh = new dec.Mesh();
  d.DecodeBufferToMesh(b, mesh);
  const a = d.GetAttributeByUniqueId(mesh, 0) || d.GetAttribute(mesh, 0);
  const n = mesh.num_points();
  const ptr = dec._malloc(n * 12);
  d.GetAttributeDataArrayForAllPoints(mesh, a, dec.DT_FLOAT32, n * 12, ptr);
  const p = new Float32Array(dec.HEAPF32.buffer, ptr, n * 3);
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i * 3 + k]); hi[k] = Math.max(hi[k], p[i * 3 + k]); }
  const c = lo.map((v, k) => (v + hi[k]) / 2);
  let r2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = p[i * 3] - c[0], dy = p[i * 3 + 1] - c[1], dz = p[i * 3 + 2] - c[2];
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  dec._free(ptr);
  dec.destroy(mesh); dec.destroy(b); dec.destroy(d);
  return { center: c.map((v) => +v.toFixed(3)), radius: +Math.sqrt(r2).toFixed(3), min: lo.map((v) => +v.toFixed(2)), max: hi.map((v) => +v.toFixed(2)) };
}

const rel = (p) => join(inv.src, p);
const chunkIds = inv.rows.filter((r) => /^geometries\/planets\/present\/full_\d+\.drc$/.test(r.rel)).map((r) => +r.rel.match(/_(\d+)\.drc/)[1]).sort((a, b) => a - b);
const chunks = chunkIds.map((i) => {
  const hi = [`geometries/planets/present/full_${i}.drc`, `geometries/planets/present/full-lod-1_${i}.drc`, `geometries/planets/present/full-lod-2_${i}.drc`, `geometries/planets/present/full-lod-3_${i}.drc`];
  const lo = [`geometries/planets/present/low/full_${i}.drc`, `geometries/planets/present/low/full-lod-1_${i}.drc`, `geometries/planets/present/low/full-lod-3_${i}.drc`];
  const tris = (p) => (inv.rows.find((r) => r.rel === p)?.draco?.faces) || 0;
  return { id: i, ...bounds(rel(hi[0])), sets: { high: hi.filter((p) => inv.rows.some((r) => r.rel === p)).map((p) => ({ path: p, tris: tris(p) })), low: lo.filter((p) => inv.rows.some((r) => r.rel === p)).map((p) => ({ path: p, tris: tris(p) })) } };
});

const busOf = (dir) => ({ music: 'music', ost: 'music', ambiances: 'ambience', ui: 'ui', dialogues: 'voice' })[dir] || 'sfx';
const audio = {};
const cache = join(ROOT, '.cache/audio');
for (const r of inv.rows) {
  if (!r.audio) continue;
  const stem = r.rel.replace(/^audio\//, '').replace(/\.[^.]+$/, '');
  const dir = stem.split('/')[0];
  const opus = join(cache, stem + '.opus');
  audio[stem] = audio[stem] || { bus: busOf(dir), sec: r.audio.sec, stream: r.audio.sec > 30, formats: [], bytes: {} };
  if (existsSync(opus) && !audio[stem].formats.includes('opus')) { audio[stem].formats.unshift('opus'); audio[stem].bytes.opus = statSync(opus).size; }
  const f = r.ext.slice(1);
  if (!audio[stem].formats.includes(f)) { audio[stem].formats.push(f); audio[stem].bytes[f] = r.bytes; }
}

const textures = inv.rows.filter((r) => r.kind === 'image' && !r.ktx2?.broken && r.rel !== 'images/uv/uvchecker-srgb.png').map((r) => ({ path: r.rel, bytes: r.bytes, ...(r.ktx2 ? { w: r.ktx2.w, h: r.ktx2.h, mips: r.ktx2.mips } : {}) }));
const groups = {};
for (const r of inv.rows.filter((x) => x.ext === '.drc' && !x.rel.startsWith('geometries/planets/present/') || (x.ext === '.drc' && x.rel.startsWith('geometries/planets/present/intro')))) {
  const g = r.rel.split('/').slice(1, -1).join('/');
  (groups[g] ||= []).push({ path: r.rel, bytes: r.bytes, tris: r.draco.faces, points: r.draco.points });
}

const tilesFile = join(ROOT, 'docs/tiles.json');
const tileReport = existsSync(tilesFile) ? JSON.parse(readFileSync(tilesFile, 'utf8')) : null;
const tiles = tileReport ? { grid: tileReport.grid, high: [], low: [] } : null;
if (tiles) for (const t of Object.values(tileReport.tiles)) tiles[t.set].push({ id: t.id, center: t.center, radius: t.radius, lods: t.lods });

const manifest = {
  generated: new Date().toISOString(),
  source: 'tools/manifest.mjs from docs/inventory.json',
  planet: { r0: 25.204, thresholds: [6, 12, 20], horizon: 0.45, chunks, tiles },
  audio,
  textures,
  geometry: groups,
  replace: { fonts: 'Abeto .font container (glyph.wasm): UNF uses SDF atlas text', icons: 'Abeto .icon container: UNF uses inline SVG sprite (Icons.js)' },
};
mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(join(ROOT, 'public/manifest.json'), JSON.stringify(manifest));
console.log(`manifest: ${chunks.length} planet chunks, ${Object.keys(audio).length} sounds, ${textures.length} textures, ${Object.keys(groups).length} geometry groups, ${(JSON.stringify(manifest).length / 1024).toFixed(1)} KB`);
console.log('chunk 0:', JSON.stringify({ c: chunks[0].center, r: chunks[0].radius }), 'chunk centers:', chunks.map((c) => c.center.map((v) => Math.round(v)).join(',')).join(' | '));
