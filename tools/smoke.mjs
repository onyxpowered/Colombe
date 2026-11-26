import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, startServer, sleep } from './lib/Chrome.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 8102;
const stopServer = await startServer({ cwd: ROOT, cmd: 'npx', argv: ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], port });
const chrome = await launchChrome();
let failed = 1;
try {
  const { cdp } = chrome;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  const logs = [];
  cdp.ws.on('message', (m) => {
    const d = JSON.parse(m);
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ' ' + d.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/dev/smoke.html?tier=${process.argv[2] || 'chromebook'}` });
  let res = null;
  const t0 = Date.now();
  while (Date.now() - t0 < Number(process.env.SMOKE_TIMEOUT || 60) * 1000) {
    await sleep(500);
    const v = await cdp.eval('window.__smoke && window.__smoke.done ? JSON.stringify(window.__smoke) : null').catch(() => null);
    if (v) { res = JSON.parse(v); break; }
  }
  if (!res) {
    const partial = await cdp.eval('JSON.stringify(window.__smoke || null)').catch((e) => String(e));
    console.log('TIMEOUT. partial:', partial, '\nconsole:', [...new Set(logs)].join('\n'));
  }
  else {
    for (const c of res.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${c.detail ? JSON.stringify(c.detail) : ''}`);
    const bad = res.checks.filter((c) => !c.ok).length;
    console.log(`\n${res.checks.length - bad}/${res.checks.length} passed, js heap ${res.heapMB} MB`);
    if (logs.length) console.log('console:\n' + [...new Set(logs)].join('\n'));
    failed = bad;
  }
} finally {
  chrome.close();
  stopServer();
}
process.exit(failed ? 1 : 0);
