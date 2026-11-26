import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.waiters = [];
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d.id && this.pending.has(d.id)) {
        const { res, rej } = this.pending.get(d.id);
        this.pending.delete(d.id);
        d.error ? rej(new Error(d.error.message)) : res(d.result);
      } else if (d.method) this.waiters = this.waiters.filter((w) => !(w.method === d.method && (w.res(d.params), true)));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  once(method) { return new Promise((res) => this.waiters.push({ method, res })); }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

export async function launchChrome({ width = 1366, height = 768, extra = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'unf-chrome-'));
  const port = 9400 + Math.floor(Math.random() * 400);
  const proc = spawn(CHROME, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--headless=new', `--window-size=${width},${height}`,
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', ...extra, 'about:blank',
  ], { stdio: 'ignore' });
  let wsUrl;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch { await sleep(250); }
  }
  if (!wsUrl) { proc.kill('SIGKILL'); throw new Error('chrome did not start'); }
  const ws = new WebSocket(wsUrl, { maxPayload: 1 << 28 });
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  const cdp = new Cdp(ws);
  const close = () => { try { ws.close(); } catch {} proc.kill('SIGKILL'); setTimeout(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} }, 500); };
  return { cdp, close };
}

export async function startServer({ cwd, cmd, argv, port }) {
  const p = spawn(cmd, argv, { cwd, stdio: 'ignore', detached: true });
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(250); }
  }
  return () => { try { process.kill(-p.pid, 'SIGKILL'); } catch {} };
}
