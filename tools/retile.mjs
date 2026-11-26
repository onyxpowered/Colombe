import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import draco3d from 'draco3d';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.env.UNF_ASSETS || join(ROOT, '../007/assets'));
const OUT = join(ROOT, '.cache/tiles');
const GRID = Number(process.env.GRID || 4);
const dec = await draco3d.createDecoderModule({});
const enc = await draco3d.createEncoderModule({});
const QUANT = { 0: 14, 1: 10, 2: 8, 3: 12, 4: 16 };

function decode(file) {
  const buf = readFileSync(file);
  const d = new dec.Decoder();
  const b = new dec.DecoderBuffer();
  b.Init(new Int8Array(buf), buf.length);
  const mesh = new dec.Mesh();
  if (!d.DecodeBufferToMesh(b, mesh).ok()) throw new Error('decode failed ' + file);
  const n = mesh.num_points();
  const attrs = [];
  for (let i = 0; i < mesh.num_attributes(); i++) {
    const a = d.GetAttribute(mesh, i);
    const c = a.num_components();
    const ptr = dec._malloc(n * c * 4);
    d.GetAttributeDataArrayForAllPoints(mesh, a, dec.DT_FLOAT32, n * c * 4, ptr);
    attrs.push({ type: a.attribute_type(), comps: c, data: new Float32Array(dec.HEAPF32.buffer, ptr, n * c).slice() });
    dec._free(ptr);
  }
  const faces = mesh.num_faces();
  const ip = dec._malloc(faces * 12);
  d.GetTrianglesUInt32Array(mesh, faces * 12, ip);
  const index = new Uint32Array(dec.HEAPU32.buffer, ip, faces * 3).slice();
  dec._free(ip);
  dec.destroy(mesh); dec.destroy(b); dec.destroy(d);
  return { n, attrs, index, bytes: buf.length };
}

function merge(parts) {
  const sig = (p) => p.attrs.map((a) => `${a.type}:${a.comps}`).join(',');
  const s0 = sig(parts[0]);
  for (const p of parts) if (sig(p) !== s0) throw new Error(`attribute layout differs within a LOD: ${s0} vs ${sig(p)}`);
  const total = parts.reduce((a, p) => a + p.n, 0);
  const attrs = parts[0].attrs.map((a, k) => {
    const data = new Float32Array(total * a.comps);
    let o = 0;
    for (const p of parts) { data.set(p.attrs[k].data, o); o += p.attrs[k].data.length; }
    return { type: a.type, comps: a.comps, data };
  });
  const index = new Uint32Array(parts.reduce((a, p) => a + p.index.length, 0));
  let io = 0, base = 0;
  for (const p of parts) { for (let i = 0; i < p.index.length; i++) index[io + i] = p.index[i] + base; io += p.index.length; base += p.n; }
  return { n: total, attrs, index };
}

function encode(attrs, index, n) {
  const e = new enc.Encoder();
  const mb = new enc.MeshBuilder();
  const mesh = new enc.Mesh();
  mb.AddFacesToMesh(mesh, index.length / 3, index);
  for (const a of attrs) {
    mb.AddFloatAttribute(mesh, a.type, n, a.comps, a.data);
    e.SetAttributeQuantization(a.type, QUANT[a.type] || 12);
  }
  e.SetSpeedOptions(3, 3);
  e.SetEncodingMethod(enc.MESH_EDGEBREAKER_ENCODING);
  const out = new enc.DracoInt8Array();
  const len = e.EncodeMeshToDracoBuffer(mesh, out);
  if (len <= 0) throw new Error('encode failed');
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = out.GetValue(i) & 255;
  enc.destroy(out); enc.destroy(mesh); enc.destroy(mb); enc.destroy(e);
  return bytes;
}

const SETS = {
  high: ['full_', 'full-lod-1_', 'full-lod-2_', 'full-lod-3_'].map((p) => ['', p]),
  low: ['full_', 'full-lod-1_', 'full-lod-3_'].map((p) => ['low/', p]),
};

const soups = {};
for (const [set, lods] of Object.entries(SETS)) {
  soups[set] = lods.map(([dir, prefix]) => merge(Array.from({ length: 10 }, (_, i) => decode(join(SRC, 'geometries/planets/present', `${dir}${prefix}${i}.drc`)))));
}

let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
for (const s of soups.high[0].attrs[0].data.constructor === Float32Array ? [soups.high[0]] : []) {
  const p = s.attrs.find((a) => a.type === 0).data;
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
}
const cell = lo.map((v, k) => (hi[k] - v) / GRID + 1e-6);
const cellOf = (x, y, z) => Math.min(GRID - 1, Math.floor((x - lo[0]) / cell[0])) + GRID * (Math.min(GRID - 1, Math.floor((y - lo[1]) / cell[1])) + GRID * Math.min(GRID - 1, Math.floor((z - lo[2]) / cell[2])));

rmSync(OUT, { recursive: true, force: true });
const report = { grid: GRID, lo, hi, sets: {}, tiles: {} };
let beforeBytes = 0;
for (const [set, lodSoups] of Object.entries(soups)) {
  report.sets[set] = [];
  lodSoups.forEach((soup, li) => {
    const pos = soup.attrs.find((a) => a.type === 0).data;
    const tris = new Map();
    for (let t = 0; t < soup.index.length; t += 3) {
      const a = soup.index[t], b = soup.index[t + 1], c = soup.index[t + 2];
      const x = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, y = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, z = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
      const id = cellOf(x, y, z);
      let list = tris.get(id);
      if (!list) tris.set(id, (list = []));
      list.push(a, b, c);
    }
    let triTotal = 0, bytes = 0;
    for (const [id, list] of tris) {
      const remap = new Map();
      const verts = [];
      const idx = new Uint32Array(list.length);
      for (let i = 0; i < list.length; i++) {
        let nv = remap.get(list[i]);
        if (nv === undefined) { nv = verts.length; remap.set(list[i], nv); verts.push(list[i]); }
        idx[i] = nv;
      }
      const attrs = soup.attrs.map((a) => {
        const d = new Float32Array(verts.length * a.comps);
        for (let v = 0; v < verts.length; v++) for (let k = 0; k < a.comps; k++) d[v * a.comps + k] = a.data[verts[v] * a.comps + k];
        return { type: a.type, comps: a.comps, data: d };
      });
      const buf = encode(attrs, idx, verts.length);
      const rel = `${set}/lod${li}/t${id}.drc`;
      mkdirSync(dirname(join(OUT, rel)), { recursive: true });
      writeFileSync(join(OUT, rel), buf);
      const p = attrs.find((a) => a.type === 0).data;
      const tlo = [1e9, 1e9, 1e9], thi = [-1e9, -1e9, -1e9];
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { tlo[k] = Math.min(tlo[k], p[i + k]); thi[k] = Math.max(thi[k], p[i + k]); }
      const key = `${set}:${id}`;
      const e = (report.tiles[key] ||= { set, id, lods: [], lo: tlo, hi: thi });
      e.lo = e.lo.map((v, k) => Math.min(v, tlo[k]));
      e.hi = e.hi.map((v, k) => Math.max(v, thi[k]));
      e.lods[li] = { path: `tiles/${rel}`, tris: idx.length / 3, bytes: buf.length };
      triTotal += idx.length / 3;
      bytes += buf.length;
    }
    report.sets[set].push({ lod: li, tiles: tris.size, tris: triTotal, expectTris: soup.index.length / 3, bytes });
    if (triTotal !== soup.index.length / 3) throw new Error(`triangle loss in ${set} lod${li}: ${triTotal} vs ${soup.index.length / 3}`);
  });
}
for (const t of Object.values(report.tiles)) {
  t.center = t.lo.map((v, k) => +((v + t.hi[k]) / 2).toFixed(3));
  t.radius = +Math.sqrt(t.lo.reduce((a, v, k) => a + ((t.hi[k] - v) / 2) ** 2, 0)).toFixed(3);
  delete t.lo; delete t.hi;
}
writeFileSync(join(ROOT, 'docs/tiles.json'), JSON.stringify(report, null, 1));
for (const [set, rows] of Object.entries(report.sets)) for (const r of rows) console.log(`${set} lod${r.lod}: ${r.tiles} tiles, ${r.tris} tris (kept all: ${r.tris === r.expectTris}), ${(r.bytes / 1024).toFixed(0)} KB`);
const radii = Object.values(report.tiles).filter((t) => t.set === 'high').map((t) => t.radius);
console.log(`high tiles: ${radii.length}, radius min ${Math.min(...radii)} / max ${Math.max(...radii)}`);
