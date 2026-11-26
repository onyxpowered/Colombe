import { Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { Engine } from '/src/unf/Engine.js';
import { GlyphAtlas } from '/src/unf/text/GlyphAtlas.js';
import { NameTags } from '/src/unf/text/NameTags.js';
import { ChunkStreamer } from '/src/unf/world/ChunkStreamer.js';
import { pickFormat } from '/src/unf/audio/Format.js';
import { planetChunks } from '/src/unf/assets/Manifest.js';
import { horizonCull } from '/src/unf/world/Horizon.js';

const out = { checks: [], done: false };
const check = (name, ok, detail) => out.checks.push({ name, ok: !!ok, detail });
window.__smoke = out;

try {
  const engine = new Engine({ assetRoot: '/a/' });
  const inv = await (await fetch('/docs/inventory.json')).json();
  const byRel = new Map(inv.rows.map((r) => [r.rel, r]));

  const samples = ['geometries/planets/present/full_0.drc', 'geometries/planets/present/low/full_3.drc', 'geometries/planets/present/hitmesh_2.drc', 'geometries/avatar/avatar-idle.drc', 'geometries/avatar/accessories/' + inv.rows.find((r) => r.rel.startsWith('geometries/avatar/accessories/')).rel.split('/').pop(), 'geometries/npcs/present/fox/' + inv.rows.find((r) => r.rel.startsWith('geometries/npcs/present/fox/')).rel.split('/').pop(), 'geometries/planets/present/grass.drc', 'geometries/emojis/1.drc'];
  for (const rel of samples) {
    const path = rel.replace(/^geometries\//, 'geometries/');
    const t0 = performance.now();
    const g = await engine.geometry.load(path);
    const ms = performance.now() - t0;
    const exp = byRel.get(path).draco;
    const tris = g.index ? g.index.count / 3 : 0;
    const pts = g.attributes.position.count;
    check('draco ' + path, tris === exp.faces && pts === exp.points, { tris, expTris: exp.faces, pts, expPts: exp.points, attrs: Object.keys(g.attributes).join(','), ms: +ms.toFixed(1) });
  }
  const cs = engine.cache.stats();
  check('cache accounting', cs.bytes > 0 && cs.live === samples.length, cs);

  const raw = await engine.loader.buffer('geometries/planets/present/full_0.drc');
  const full = await engine.geometry.decode(raw.slice(0), { compact: false });
  const compact = await engine.geometry.decode(raw.slice(0), { compact: true });
  const size = (o) => o.attributes.reduce((a, x) => a + x.array.byteLength, 0) + (o.index ? o.index.byteLength : 0);
  check('compaction shrinks GPU memory', size(compact) < size(full), { fullKB: Math.round(size(full) / 1024), compactKB: Math.round(size(compact) / 1024), saved: Math.round((1 - size(compact) / size(full)) * 100) + '%' });

  const ktx = ['images/clouds_noise_512.ktx2', 'images/tree-leaves.ktx2', 'images/grass-blades-highq.ktx2', 'images/mouth-highq.ktx2', 'images/water-noises-highq.ktx2'];
  for (const p of ktx) {
    const t = await engine.textures.load(p, { color: false });
    check('ktx2 ' + p, t.isCompressedTexture && t.mipmaps.length > 1, { format: t.format, w: t.image.width, h: t.image.height, mips: t.mipmaps.length });
  }
  const png = await engine.textures.load('images/atlas.png', { color: true, nearest: true });
  check('png via ImageBitmap', png.image && png.image.width > 0, { w: png.image.width, h: png.image.height });

  const fmt = pickFormat(['ogg', 'm4a', 'mp3']);
  check('audio format pick', ['ogg', 'm4a', 'mp3'].includes(fmt), fmt);
  const manifest = await engine.useManifest('/manifest.json');
  check('manifest loaded', manifest.planet.tiles.low.length === 51 && Object.keys(manifest.audio).length === 96, { sounds: Object.keys(manifest.audio).length, tiles: manifest.planet.tiles.low.length });
  check('audio prefers opus', engine.audio.urlFor(engine.audio.defs.get('ui/click2')).endsWith('.opus'), engine.audio.urlFor(engine.audio.defs.get('ui/click2')));
  for (const n of ['ui/click2', 'intro/rune1', 'ambiances/forest', 'dialogues/male1']) {
    const b = await engine.audio.preload(n);
    check('audio decode ' + n, b && b.duration > 0, { sec: +b.duration.toFixed(2), ch: b.numberOfChannels, rate: b.sampleRate });
  }
  check('audio pcm accounting', engine.audio.cache.bytes > 0, engine.audio.cache.stats());

  const atlas = new GlyphAtlas();
  atlas.prime('Hello REDLINE');
  const nonzero = atlas.data.reduce((a, v) => a + (v > 0 ? 1 : 0), 0);
  const tags = new NameTags({ atlas });
  const ok1 = tags.set('p1', 'that_riko', '#ff4d5e');
  tags.move('p1', new Vector3(0, 2, 0));
  tags.remove('p1');
  check('sdf atlas + nametags', nonzero > 1000 && ok1 && tags.free.length === tags.capacity, { glyphs: atlas.glyphs.size, nonzero });

  const group = new Group();
  const streamer = new ChunkStreamer({ geometry: engine.geometry, parent: group, makeMesh: (g) => new Mesh(g, new MeshBasicMaterial()) });
  const chunk = (i) => ({ id: 'c' + i, center: new Vector3(0, 0, 0), radius: 1, lods: [{ path: `geometries/planets/present/full_${i}.drc`, maxDist: 20 }, { path: `geometries/planets/present/full-lod-3_${i}.drc`, maxDist: 100 }] });
  streamer.add(chunk(1));
  streamer.add(chunk(2));
  const near = new Vector3(0, 0, 5);
  for (let i = 0; i < 400 && streamer.stats.resident < 2; i++) {
    streamer.update(near);
    await new Promise((r) => setTimeout(r, 16));
  }
  check('chunk streamer shows lod0', streamer.stats.resident === 2 && group.children.length === 2, { ...streamer.stats });
  const far = new Vector3(0, 0, 60);
  for (let i = 0; i < 400 && !streamer.chunks.every((c) => c.shown === 1); i++) {
    streamer.update(far);
    await new Promise((r) => setTimeout(r, 16));
  }
  check('chunk streamer swaps to lod1 and releases lod0', streamer.chunks.every((c) => c.shown === 1) && group.children.length === 2, { tris: streamer.stats.triangles });
  const gone = new Vector3(0, 0, 500);
  streamer.update(gone);
  check('chunk streamer culls beyond range', group.children.length === 0, null);
  const tiles = planetChunks(manifest, engine.tier);
  const tg = new Group();
  const ts = new ChunkStreamer({ geometry: engine.geometry, parent: tg, makeMesh: (g) => new Mesh(g, new MeshBasicMaterial()), cull: horizonCull({ threshold: manifest.planet.horizon }) });
  tiles.forEach((t) => ts.add(t));
  const R0 = manifest.planet.r0;
  const settle = async (pos) => {
    for (let i = 0; i < 600; i++) {
      ts.update(pos);
      await new Promise((r) => setTimeout(r, 16));
      if (i > 5 && ts.stats.loading === 0 && ts.ready.length === 0 && engine.loader.active === 0 && engine.loader.queue.length === 0) break;
    }
  };
  const spotA = new Vector3(0, R0 + 1.6, 0);
  await settle(spotA);
  const resA = ts.stats.resident;
  const trisA = ts.stats.triangles;
  check('planet tiles stream around player', resA >= 4 && resA <= 30 && trisA > 20000 && trisA < 200000, { tier: engine.tier.name, tilesTotal: tiles.length, resident: resA, tris: trisA, cacheMB: +(engine.cache.bytes / 1048576).toFixed(1) });
  const spotB = new Vector3(0, -(R0 + 1.6), 0);
  await settle(spotB);
  const idle = engine.cache.stats();
  check('walking far swaps the resident set', ts.stats.resident >= 4 && ts.stats.resident <= 30 && ts.chunks.some((c) => c.mesh) && ts.stats.resident !== resA && idle.idle >= 5 && group.children.length === 0, { resident: ts.stats.resident, tris: ts.stats.triangles, live: idle.live, idle: idle.idle });
  out.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
} catch (e) {
  check('smoke exception', false, String(e && e.stack ? e.stack : e));
}
out.done = true;
