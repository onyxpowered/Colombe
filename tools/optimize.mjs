import { readFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inv = JSON.parse(readFileSync(join(ROOT, 'docs/inventory.json'), 'utf8'));
const OUT = join(ROOT, '.cache/audio');
const force = process.argv.includes('--force');

const plan = (dir) =>
  ({ ost: [80, 2], music: [96, 0], ambiances: [56, 0], fk: [64, 2], dialogues: [32, 1], character: [40, 1], camera: [40, 1], intro: [40, 1], sfx: [40, 1], ui: [40, 1] })[dir] || [48, 0];

const groups = new Map();
for (const r of inv.rows) {
  if (!r.audio) continue;
  const stem = r.rel.replace(/^audio\//, '').replace(/\.[^.]+$/, '');
  (groups.get(stem) || groups.set(stem, []).get(stem)).push(r);
}

const jobs = [];
for (const [stem, list] of groups) {
  const best = list.slice().sort((a, b) => (b.audio.kbps || 0) - (a.audio.kbps || 0))[0];
  const [kbps, chans] = plan(stem.split('/')[0]);
  const ch = chans || best.audio.ch || 1;
  const cap = best.audio.kbps ? Math.max(16, Math.floor(best.audio.kbps * 0.85)) : kbps;
  jobs.push({ stem, src: join(inv.src, best.rel), out: join(OUT, stem + '.opus'), kbps: Math.min(kbps, cap), ch, list });
}

async function encode(j) {
  mkdirSync(dirname(j.out), { recursive: true });
  if (!force && existsSync(j.out)) return;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', j.src, '-vn', '-map_metadata', '-1', '-ac', String(j.ch), '-c:a', 'libopus', '-b:a', `${j.kbps}k`, '-vbr', 'on', '-application', j.stem.startsWith('music') || j.stem.startsWith('ost') ? 'audio' : 'audio', j.out]);
}

let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < jobs.length) await encode(jobs[i++]);
}));

const chromeChoice = (list) => list.find((r) => r.ext === '.ogg') || list.find((r) => r.ext === '.m4a') || list[0];
let before = 0, after = 0, allSrc = 0;
const rows = [];
for (const j of jobs) {
  const b = chromeChoice(j.list).bytes;
  const a = statSync(j.out).size;
  before += b; after += a;
  allSrc += j.list.reduce((s, r) => s + r.bytes, 0);
  rows.push({ stem: j.stem, before: b, after: a });
}
const mb = (n) => (n / 1048576).toFixed(2);
console.log(`unique sounds: ${jobs.length}`);
console.log(`on disk today (every format): ${mb(allSrc)} MB`);
console.log(`what a Chrome client downloads today (ogg, else m4a): ${mb(before)} MB`);
console.log(`single Opus set: ${mb(after)} MB  (${Math.round((1 - after / before) * 100)}% smaller download, ${Math.round((1 - after / allSrc) * 100)}% smaller on disk)`);
for (const dir of ['ost', 'music', 'ambiances', 'dialogues', 'sfx', 'ui', 'character']) {
  const r = rows.filter((x) => x.stem.startsWith(dir + '/'));
  if (r.length) console.log(`  ${dir.padEnd(10)} ${mb(r.reduce((s, x) => s + x.before, 0)).padStart(6)} -> ${mb(r.reduce((s, x) => s + x.after, 0)).padStart(6)} MB`);
}
