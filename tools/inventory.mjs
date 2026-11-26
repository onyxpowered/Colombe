import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import draco3d from 'draco3d';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(process.argv[2] || join(ROOT, '../007/assets'));
const BUNDLE = readFileSync(join(SRC, 'App3D-DwM1eiaC.js'), 'utf8');
const kb = (n) => +(n / 1024).toFixed(1);

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    statSync(p).isDirectory() ? walk(p) : f !== '.DS_Store' && files.push(p);
  }
})(SRC);

const kindOf = (rel, ext) =>
  rel.startsWith('geometries/') ? 'geometry' :
  rel.startsWith('audio/') ? 'audio' :
  rel.startsWith('libs/') ? 'lib' :
  rel.startsWith('fonts/') || ext === '.font' ? 'font' :
  ext === '.icon' ? 'icon' :
  rel.startsWith('brand/') ? 'brand' :
  /^assets\/[^/]+\.(js|css)$/.test('assets/' + rel) ? 'code' :
  /\.(ktx2|png|webp|avif|jpg)$/.test(ext) ? 'image' : 'other';

const dracoDecoder = await draco3d.createDecoderModule({});
function dracoInfo(buf) {
  const d = new dracoDecoder.Decoder();
  const b = new dracoDecoder.DecoderBuffer();
  b.Init(new Int8Array(buf), buf.length);
  const type = d.GetEncodedGeometryType(b);
  const mesh = type === dracoDecoder.TRIANGULAR_MESH ? new dracoDecoder.Mesh() : new dracoDecoder.PointCloud();
  const st = type === dracoDecoder.TRIANGULAR_MESH ? d.DecodeBufferToMesh(b, mesh) : d.DecodeBufferToPointCloud(b, mesh);
  if (!st.ok()) { dracoDecoder.destroy(b); dracoDecoder.destroy(d); return { error: st.error_msg() }; }
  const attrs = [];
  for (let i = 0; i < mesh.num_attributes(); i++) {
    const a = d.GetAttribute(mesh, i);
    attrs.push(`${a.attribute_type()}:${a.num_components()}`);
  }
  const out = { points: mesh.num_points(), faces: type === dracoDecoder.TRIANGULAR_MESH ? mesh.num_faces() : 0, attrs: attrs.join(',') };
  dracoDecoder.destroy(mesh); dracoDecoder.destroy(b); dracoDecoder.destroy(d);
  return out;
}

function ktx2Info(buf) {
  if (buf.slice(1, 7).toString() !== 'KTX 20') return { broken: true };
  const r = (o) => buf.readUInt32LE(o);
  return { w: r(20), h: r(24), mips: r(40), super: ['none', 'BasisLZ', 'Zstd', 'ZLIB'][r(44)], vk: r(12) };
}

function audioInfo(p) {
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', p], { encoding: 'utf8' }));
    const s = j.streams[0] || {};
    return { codec: s.codec_name, rate: +s.sample_rate, ch: s.channels, sec: +(+j.format.duration).toFixed(2), kbps: Math.round(+j.format.bit_rate / 1000) };
  } catch { return {}; }
}

const stems = (rel) => {
  const noExt = rel.replace(/\.[^.]+$/, '');
  const parts = noExt.split('/');
  const last = parts[parts.length - 1];
  const tpl = last.replace(/[0-9]+$/, '').replace(/_$/, '');
  return [rel, noExt, parts.slice(-2).join('/'), last, tpl].filter((s) => s.length > 3);
};
const referenced = (rel) => {
  const ext = extname(rel);
  const noExt = rel.replace(ext, '');
  const hits = [rel, noExt + ext, noExt.replace(/\.(ogg|mp3|m4a)$/, '')];
  for (const h of hits) if (BUNDLE.includes('"' + h + '"') || BUNDLE.includes('/' + h + '"')) return 'exact';
  const last = noExt.split('/').pop();
  const tpl = last.replace(/[0-9]+$/, '').replace(/_$/, '');
  const dir = rel.split('/').slice(0, -1).join('/');
  if (BUNDLE.includes('"' + noExt + '"') || BUNDLE.includes('"' + noExt.replace(/^(audio|images)\//, '') + '"')) return 'exact';
  if (new RegExp('[`"\'/]' + last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.|[`"\'])').test(BUNDLE)) return 'name';
  if (tpl.length > 2 && BUNDLE.includes(tpl) && /\d+\.(drc|icon|ktx2|png|ogg|mp3)$/.test(rel)) return 'template';
  if (/^geometries\/planets\//.test(rel) && BUNDLE.includes('planets/')) return /hitmesh|full|tree|smoke|cables|water|grass|butter|beach|waterfall|intro/.test(rel) ? 'template' : 'none';
  if (/^geometries\/(avatar|npcs)\//.test(rel) && /avatar|npcs/.test(BUNDLE)) return 'template';
  return 'none';
};

const rows = [];
const dracoByDir = {};
for (const p of files) {
  const rel = relative(SRC, p).split('\\').join('/');
  const ext = extname(rel);
  const buf = readFileSync(p);
  const row = { rel, kind: kindOf(rel, ext), ext, bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
  if (ext === '.drc') {
    row.draco = dracoInfo(buf);
    const dir = rel.split('/').slice(0, -1).join('/');
    const d = (dracoByDir[dir] ||= { files: 0, bytes: 0, tris: 0, points: 0 });
    d.files++; d.bytes += buf.length; d.tris += row.draco.faces || 0; d.points += row.draco.points || 0;
  } else if (ext === '.ktx2') row.ktx2 = ktx2Info(buf);
  else if (['.mp3', '.ogg', '.m4a'].includes(ext)) row.audio = audioInfo(p);
  row.ref = row.kind === 'code' || row.kind === 'lib' ? 'n/a' : referenced(rel);
  rows.push(row);
}

const byKind = {};
for (const r of rows) {
  const k = (byKind[r.kind] ||= { files: 0, bytes: 0, gzip: 0 });
  k.files++; k.bytes += r.bytes; k.gzip += r.gzip;
}
const unref = rows.filter((r) => r.ref === 'none');
const broken = rows.filter((r) => r.ktx2?.broken);
const audio = rows.filter((r) => r.audio);
const sec = (r) => r.audio.sec || 0;
const audioStems = {};
for (const r of audio) (audioStems[r.rel.replace(/\.[^.]+$/, '')] ||= []).push(r);
const audioDupBytes = Object.values(audioStems).filter((g) => g.length > 1).reduce((a, g) => a + g.reduce((s, r) => s + r.bytes, 0) - Math.max(...g.map((r) => r.bytes)) , 0);
let pcmBytes = 0;
for (const g of Object.values(audioStems)) { const r = g[0]; if (r.audio.sec) pcmBytes += r.audio.sec * (r.audio.rate || 44100) * (r.audio.ch || 2) * 4; }
const longest = audio.slice().sort((a, b) => sec(b) - sec(a)).slice(0, 8);
const tris = Object.values(dracoByDir).reduce((a, d) => a + d.tris, 0);

const md = [];
md.push('# 007 asset inventory', '', `Source: \`${SRC}\`. Generated by \`tools/inventory.mjs\`. Reference detection is heuristic (string and template matching against the bundle).`, '');
md.push('## Totals by kind', '', '| kind | files | MB | gzip MB |', '|---|---|---|---|');
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].bytes - a[1].bytes)) md.push(`| ${k} | ${v.files} | ${(v.bytes / 1048576).toFixed(2)} | ${(v.gzip / 1048576).toFixed(2)} |`);
md.push('', '## Geometry (Draco)', '', '| folder | files | KB | triangles | points |', '|---|---|---|---|---|');
for (const [d, v] of Object.entries(dracoByDir).sort()) md.push(`| ${d} | ${v.files} | ${kb(v.bytes)} | ${v.tris} | ${v.points} |`);
md.push('', `Total decoded triangles across every mesh file: ${tris}.`);
const attrSets = {};
for (const r of rows) if (r.draco && !r.draco.error) attrSets[r.draco.attrs] = (attrSets[r.draco.attrs] || 0) + 1;
md.push('', 'Attribute layouts (draco type:components) and how many files use each:', '', ...Object.entries(attrSets).map(([a, n]) => `- \`${a}\`: ${n}`));
md.push('', '## Textures', '', '| file | size | mips | supercompression | KB |', '|---|---|---|---|---|');
for (const r of rows.filter((x) => x.ext === '.ktx2')) md.push(`| ${r.rel} | ${r.ktx2.broken ? 'BROKEN (not a KTX2 file)' : r.ktx2.w + 'x' + r.ktx2.h} | ${r.ktx2.mips ?? '-'} | ${r.ktx2.super ?? '-'} | ${kb(r.bytes)} |`);
md.push('', '## Audio', '', `- ${audio.length} files; ${Object.keys(audioStems).length} unique sounds. ${kb(audioDupBytes)} KB are duplicate encodings of the same sound (ogg + mp3 + m4a).`, `- Decoded to PCM (float32, every unique sound resident) would be about ${(pcmBytes / 1048576).toFixed(0)} MB. This is why long tracks must stream, not decode.`, '', 'Longest files:', '', '| file | codec | rate | ch | sec | kbps | KB |', '|---|---|---|---|---|---|---|');
for (const r of longest) md.push(`| ${r.rel} | ${r.audio.codec} | ${r.audio.rate} | ${r.audio.ch} | ${r.audio.sec} | ${r.audio.kbps} | ${kb(r.bytes)} |`);
md.push('', '## Problems found', '');
md.push(...(broken.length ? broken.map((r) => `- \`${r.rel}\` is not a KTX2 texture (HTML error page saved during the 007 restore).`) : ['- none broken']));
const missingWorkers = ['msdfworker-DGxypdow.js', 'exrworker-Dm3Bkfzh.js'].filter((w) => !files.some((f) => f.endsWith(w)));
md.push(...missingWorkers.map((w) => `- Bundle references \`${w}\` but it is not in assets/.`));
md.push('', `Unreferenced by heuristic (${unref.length} files, ${kb(unref.reduce((a, r) => a + r.bytes, 0))} KB):`, '', ...unref.map((r) => `- ${r.rel} (${kb(r.bytes)} KB)`));
mkdirSync(join(ROOT, 'docs'), { recursive: true });
writeFileSync(join(ROOT, 'docs/INVENTORY.md'), md.join('\n') + '\n');
writeFileSync(join(ROOT, 'docs/inventory.json'), JSON.stringify({ src: SRC, byKind, dracoByDir, rows }, null, 1));
console.log(md.slice(0, 40).join('\n'));
console.log('...\nfull report: docs/INVENTORY.md');
