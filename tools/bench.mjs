import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Cdp } from './lib/Chrome.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : [a, 'true'])).map(([k, v]) => [k, v ?? 'true']));
const throttle = Number(args.throttle || 4);
const seconds = Number(args.seconds || 20);
const warm = Number(args.warm || 5);
const width = Number(args.width || 1366);
const height = Number(args.height || 768);
const runs = Number(args.runs || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readyTimeout = Number(args['ready-timeout'] || 120) * 1000;
const log = (m) => process.stderr.write(`[bench] ${m}\n`);
const within = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(`timeout: ${what}`)), ms))]);

const targets = {
  colombe: { url: 'http://127.0.0.1:8101/?tier=chromebook', ready: '!!window.__UNF', serve: { cwd: ROOT, cmd: 'npx', argv: ['vite', 'preview', '--host', '127.0.0.1', '--port', '8101', '--strictPort'], port: 8101 } },
  '007': { url: 'http://127.0.0.1:8095/?offline', ready: '!!(window.__Game && window.__Game.match)', serve: { cwd: resolve(ROOT, '../007'), cmd: 'node', argv: ['server/static.mjs'], port: 8095 } },
};

async function waitPort(port, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { await fetch(`http://127.0.0.1:${port}/`); return; } catch { await sleep(250); }
  }
  throw new Error(`port ${port} never came up`);
}

async function portFree(port) {
  try { await fetch(`http://127.0.0.1:${port}/`); return false; } catch { return true; }
}


const sampler = (secs) => `new Promise((resolve) => {
  const dts = [];
  let last = 0;
  const end = performance.now() + ${secs * 1000};
  const tick = (t) => {
    if (last) dts.push(t - last);
    last = t;
    if (t < end) requestAnimationFrame(tick);
    else resolve(dts);
  };
  requestAnimationFrame(tick);
})`;

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

async function measure(name, t) {
  const dir = mkdtempSync(join(tmpdir(), 'colombe-bench-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', `--window-size=${width},${height}`,
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let wsUrl;
    for (let i = 0; i < 60 && !wsUrl; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch { await sleep(250); }
    }
    if (!wsUrl) throw new Error('chrome did not start');
    const ws = new WebSocket(wsUrl, { maxPayload: 1 << 28 });
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    const c = new Cdp(ws);
    await c.send('Page.enable');
    await c.send('Performance.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await c.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const loaded = c.once('Page.loadEventFired');
    await c.send('Page.navigate', { url: args[`${name}-url`] || t.url });
    await within(loaded, readyTimeout, 'page load event').catch((e) => log(`${name}: ${e.message} (continuing)`));
    log(`${name}: loaded, waiting for ready`);
    const ready = args[`${name}-ready`] || t.ready;
    const t0 = Date.now();
    let isReady = false;
    while (Date.now() - t0 < readyTimeout) {
      if (await within(c.eval(`Boolean(${ready})`), 8000, 'ready probe').catch(() => false)) { isReady = true; break; }
      await sleep(1000);
    }
    if (!isReady) log(`${name}: ready check '${ready}' never became true; measuring anyway`);
    const loadSec = (Date.now() - t0) / 1000;
    await sleep(warm * 1000);
    const m = async () => Object.fromEntries((await c.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    const before = await m();
    log(`${name}: sampling ${seconds}s`);
    const dts = await within(c.eval(sampler(seconds)), (seconds + 60) * 1000, 'frame sampler');
    const after = await m();
    const heap = await c.eval('performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0');
    const info = await c.eval('window.__UNF ? (({calls, triangles}) => ({calls, triangles}))(window.__UNF.renderer.gl.info.render) : null').catch(() => null);
    const s = dts.slice().sort((a, b) => a - b);
    const sum = dts.reduce((a, b) => a + b, 0);
    const frames = dts.length;
    const cpuPerFrame = ((after.TaskDuration - before.TaskDuration) * 1000) / frames;
    const scriptPerFrame = ((after.ScriptDuration - before.ScriptDuration) * 1000) / frames;
    ws.close();
    return {
      name, ready: isReady, throttle, size: `${width}x${height}`, loadSec: +loadSec.toFixed(1), frames,
      fps: +((frames * 1000) / sum).toFixed(1), p50: +pct(s, 0.5).toFixed(1), p90: +pct(s, 0.9).toFixed(1), p99: +pct(s, 0.99).toFixed(1), worst: +s[s.length - 1].toFixed(1),
      over33: dts.filter((d) => d > 33.4).length, over50: dts.filter((d) => d > 50).length,
      mainThreadMsPerFrame: +cpuPerFrame.toFixed(2), scriptMsPerFrame: +scriptPerFrame.toFixed(2), jsHeapMB: +heap.toFixed(0), drawCalls: info?.calls ?? null, triangles: info?.triangles ?? null,
    };
  } finally {
    chrome.kill('SIGKILL');
    setTimeout(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }, 800);
  }
}

async function withServer(t, fn) {
  if (args.noserve || !t.serve || !(await portFree(t.serve.port))) return fn();
  const p = spawn(t.serve.cmd, t.serve.argv, { cwd: t.serve.cwd, stdio: 'ignore', detached: true });
  try { await waitPort(t.serve.port); return await fn(); } finally { try { process.kill(-p.pid, 'SIGKILL'); } catch {} }
}

const names = (args.targets || 'colombe,007').split(',').filter((n) => targets[n]);
if (!names.length) { console.error(`usage: node tools/bench.mjs [--targets=colombe,007] [--throttle=4] [--seconds=20] [--warm=5] [--runs=1] [--width=1366 --height=768] [--noserve] [--<name>-url=... --<name>-ready=...]`); process.exit(1); }

const results = [];
for (const n of names) {
  for (let r = 0; r < runs; r++) {
    process.stderr.write(`[bench] ${n} run ${r + 1}/${runs} (throttle ${throttle}x, ${seconds}s)\n`);
    try { results.push(await withServer(targets[n], () => measure(n, targets[n]))); } catch (e) { results.push({ name: n, error: e.message }); }
  }
}

const cols = ['name', 'ready', 'loadSec', 'fps', 'p50', 'p90', 'p99', 'worst', 'over33', 'mainThreadMsPerFrame', 'scriptMsPerFrame', 'jsHeapMB', 'drawCalls', 'triangles'];
console.log(cols.join('\t'));
for (const r of results) console.log(r.error ? `${r.name}\tERROR ${r.error}` : cols.map((k) => r[k] ?? '-').join('\t'));
mkdirSync(join(ROOT, 'bench'), { recursive: true });
const file = join(ROOT, 'bench', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), throttle, seconds, size: `${width}x${height}`, results }, null, 2));
console.error(`[bench] saved ${file}`);
