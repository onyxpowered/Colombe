import test from 'node:test';
import assert from 'node:assert/strict';
import { Cache } from '../src/unf/assets/Cache.js';
import { Loader } from '../src/unf/assets/Loader.js';
import { VoicePool } from '../src/unf/audio/VoicePool.js';
import { selectLod } from '../src/unf/world/Lod.js';
import { edt, sdfFromAlpha } from '../src/unf/text/Sdf.js';

test('cache dedupes loads and shares one value', async () => {
  const c = new Cache({ budgetBytes: 100 });
  let loads = 0;
  const load = async () => (loads++, { value: { id: 1 }, bytes: 10 });
  const [a, b] = await Promise.all([c.acquire('k', load), c.acquire('k', load)]);
  assert.equal(loads, 1);
  assert.equal(a, b);
  assert.equal(c.items.get('k').refs, 2);
});

test('cache evicts idle LRU entries over budget, never referenced ones', async () => {
  const c = new Cache({ budgetBytes: 25 });
  const disposed = [];
  const mk = (n) => async () => ({ value: n, bytes: 10, dispose: () => disposed.push(n) });
  await c.acquire('a', mk('a'));
  await c.acquire('b', mk('b'));
  await c.acquire('c', mk('c'));
  c.release('a');
  c.release('b');
  c.trim();
  assert.deepEqual(disposed, ['a']);
  assert.equal(c.peek('c'), 'c');
  assert.equal(c.peek('b'), 'b');
  c.release('c');
  await c.acquire('d', mk('d'));
  assert.ok(c.bytes <= 30);
  assert.ok(!disposed.includes('d'));
});

test('cache drops failed loads so they can retry', async () => {
  const c = new Cache();
  await assert.rejects(c.acquire('x', async () => { throw new Error('nope'); }));
  const v = await c.acquire('x', async () => ({ value: 7, bytes: 1 }));
  assert.equal(v, 7);
});

test('loader runs highest priority first and respects concurrency', async () => {
  const order = [];
  let live = 0;
  let peak = 0;
  globalThis.fetch = async (url) => {
    live++;
    peak = Math.max(peak, live);
    order.push(url);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const l = new Loader({ root: '/r/', concurrency: 2 });
  const ps = [l.buffer('a', { priority: 0 }), l.buffer('b', { priority: 0 }), l.buffer('c', { priority: 0 }), l.buffer('d', { priority: 9 })];
  await Promise.all(ps);
  assert.equal(peak, 2);
  assert.equal(order[2], '/r/d');
  const same = l.buffer('e');
  assert.equal(same, l.buffer('e'));
  await same;
  assert.equal(l.bytes, 20);
});

test('voice pool enforces minGap, per-name cap and priority stealing', () => {
  const p = new VoicePool(2);
  assert.equal(p.admit('shot', { minGap: 0.1, now: 0 }).ok, true);
  assert.equal(p.admit('shot', { minGap: 0.1, now: 0.05 }).ok, false);
  const v1 = { name: 'a', priority: 1, started: 1, stop() {} };
  const v2 = { name: 'b', priority: 0, started: 2, stop() {} };
  p.add(v1);
  p.add(v2);
  assert.equal(p.admit('c', { priority: 0, now: 3 }).steal, v2);
  assert.equal(p.admit('d', { priority: -1, now: 4 }).ok, false);
  assert.equal(p.admit('a', { priority: 1, maxVoices: 1, now: 5 }).steal, v1);
});

test('lod selection uses hysteresis so chunks do not flicker', () => {
  const d = [20, 50, 100];
  assert.equal(selectLod(10, d), 0);
  assert.equal(selectLod(120, d), -1);
  assert.equal(selectLod(21, d, 0), 0);
  assert.equal(selectLod(23, d, 0), 1);
  assert.equal(selectLod(19, d, 1), 1);
  assert.equal(selectLod(17, d, 1), 0);
  assert.equal(selectLod(105, d, 2), 2);
  assert.equal(selectLod(115, d, 2), -1);
  assert.equal(selectLod(99, d, -1), -1);
  assert.equal(selectLod(85, d, -1), 2);
});

test('edt gives exact euclidean distances', () => {
  const w = 5, h = 5, g = new Float64Array(w * h).fill(1e20);
  g[2 * w + 2] = 0;
  edt(g, w, h);
  assert.equal(g[2 * w + 2], 0);
  assert.equal(g[2 * w + 4], 2);
  assert.ok(Math.abs(g[0] - Math.sqrt(8)) < 1e-9);
});

test('sdf is above half inside a shape and below half outside', () => {
  const w = 24, h = 24, alpha = new Uint8Array(w * h);
  for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) alpha[y * w + x] = 255;
  const out = new Uint8Array(w * h);
  sdfFromAlpha(alpha, w, h, 6, out, 0, w);
  assert.ok(out[12 * w + 12] > 128);
  assert.ok(out[2 * w + 2] < 128);
  assert.ok(out[12 * w + 12] > out[9 * w + 9] || out[12 * w + 12] >= out[9 * w + 9]);
});
