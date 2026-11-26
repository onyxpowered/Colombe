import { Cache } from '../assets/Cache.js';
import { VoicePool } from './VoicePool.js';
import { pickFormat } from './Format.js';

const BUSES = ['music', 'sfx', 'ui', 'ambience', 'voice'];

export class AudioEngine {
  constructor({ loader, root = 'audio/', voices = 24, decodeBudgetMB = 40 }) {
    this.loader = loader;
    this.root = root;
    this.defs = new Map();
    this.pool = new VoicePool(voices);
    this.cache = new Cache({ budgetBytes: decodeBudgetMB * 1048576 });
    this.ctx = null;
    this.buses = {};
    this.master = null;
    this.volume = { master: 1, music: 0.6, sfx: 1, ui: 0.8, ambience: 0.8, voice: 1 };
    this.suspendTimer = 0;
    this.pendingUnlock = true;
    this.music = null;
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, unlock, { once: false, passive: true });
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  define(name, { path, formats = ['ogg', 'm4a', 'mp3'], bus = 'sfx', volume = 1, minGap = 0, maxVoices = Infinity, priority = 0, loop = false, spatial = null, stream = false }) {
    this.defs.set(name, { name, path, formats, bus, volume, minGap, maxVoices, priority, loop, spatial, stream });
  }

  urlFor(def) {
    return `${this.root}${def.path}.${pickFormat(def.formats)}`;
  }

  ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume.master;
    this.master.connect(this.ctx.destination);
    for (const b of BUSES) {
      const g = this.ctx.createGain();
      g.gain.value = this.volume[b];
      g.connect(this.master);
      this.buses[b] = g;
    }
    return this.ctx;
  }

  unlock() {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    this.pendingUnlock = false;
  }

  setVolume(bus, v) {
    this.volume[bus] = v;
    if (!this.ctx) return;
    const node = bus === 'master' ? this.master : this.buses[bus];
    if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  onVisibility() {
    clearTimeout(this.suspendTimer);
    if (!this.ctx) return;
    if (document.hidden) this.suspendTimer = setTimeout(() => this.ctx.suspend().catch(() => {}), 5000);
    else if (!this.pendingUnlock) this.ctx.resume().catch(() => {});
  }

  decoded(name) {
    return this.cache.peek('buf:' + name);
  }

  preload(name, priority = 0) {
    const def = this.defs.get(name);
    if (!def || def.stream) return Promise.resolve(null);
    const ctx = this.ensureContext();
    return this.cache.acquire('buf:' + name, async () => {
      const raw = await this.loader.buffer(this.urlFor(def), { priority });
      const buffer = await ctx.decodeAudioData(raw);
      return { value: buffer, bytes: buffer.length * buffer.numberOfChannels * 4 };
    });
  }

  play(name, { volume = 1, rate = 1, position = null, loop = null, delay = 0 } = {}) {
    const def = this.defs.get(name);
    if (!def || def.stream) return null;
    const ctx = this.ensureContext();
    if (ctx.state === 'suspended' && this.pendingUnlock) return null;
    const buffer = this.decoded(name);
    if (!buffer) {
      this.preload(name, 5);
      return null;
    }
    const now = performance.now() / 1000;
    const verdict = this.pool.admit(name, { priority: def.priority, minGap: def.minGap, maxVoices: def.maxVoices, now });
    if (!verdict.ok) return null;
    if (verdict.steal) verdict.steal.stop(0.03);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = loop === null ? def.loop : loop;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = def.volume * volume;
    let tail = gain;
    let panner = null;
    if (position && def.spatial) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = def.spatial.ref || 4;
      panner.maxDistance = def.spatial.max || 120;
      panner.rolloffFactor = def.spatial.rolloff || 1.2;
      setPannerPosition(panner, position);
      gain.connect(panner);
      tail = panner;
    }
    tail.connect(this.buses[def.bus]);
    src.connect(gain);
    const voice = {
      name,
      priority: def.priority,
      started: now,
      panner,
      stop: (fade = 0.02) => {
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
          src.stop(ctx.currentTime + fade + 0.02);
        } catch {}
      },
      setVolume: (v) => gain.gain.setTargetAtTime(def.volume * v, ctx.currentTime, 0.02),
      setPosition: (p) => panner && setPannerPosition(panner, p),
    };
    src.onended = () => {
      this.pool.remove(voice);
      src.disconnect();
      gain.disconnect();
      if (panner) panner.disconnect();
    };
    this.pool.add(voice);
    src.start(ctx.currentTime + delay);
    return voice;
  }

  setListener(position, forward, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(position.x, t);
      l.positionY.setValueAtTime(position.y, t);
      l.positionZ.setValueAtTime(position.z, t);
      l.forwardX.setValueAtTime(forward.x, t);
      l.forwardY.setValueAtTime(forward.y, t);
      l.forwardZ.setValueAtTime(forward.z, t);
      l.upX.setValueAtTime(up.x, t);
      l.upY.setValueAtTime(up.y, t);
      l.upZ.setValueAtTime(up.z, t);
    }
  }

  playlist(names, { gapMin = 8, gapMax = 16, bus = 'music', volume = 1 } = {}) {
    if (this.music) this.music.stop();
    this.music = new Playlist(this, names, { gapMin, gapMax, bus, volume });
    this.music.next();
    return this.music;
  }
}

class Playlist {
  constructor(engine, names, { gapMin, gapMax, bus, volume }) {
    this.engine = engine;
    this.names = names;
    this.gapMin = gapMin;
    this.gapMax = gapMax;
    this.bus = bus;
    this.volume = volume;
    this.index = -1;
    this.el = null;
    this.node = null;
    this.timer = 0;
    this.stopped = false;
  }

  next() {
    if (this.stopped) return;
    this.index = (this.index + 1) % this.names.length;
    const def = this.engine.defs.get(this.names[this.index]);
    if (!def) return;
    const ctx = this.engine.ensureContext();
    const el = new Audio();
    el.preload = 'auto';
    el.src = this.engine.loader.url(this.engine.urlFor(def));
    el.volume = 1;
    const node = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = def.volume * this.volume;
    node.connect(gain);
    gain.connect(this.engine.buses[this.bus]);
    this.el = el;
    this.node = [node, gain];
    el.onended = () => {
      this.teardown();
      this.timer = setTimeout(() => this.next(), (this.gapMin + Math.random() * (this.gapMax - this.gapMin)) * 1000);
    };
    el.play().catch(() => {
      this.timer = setTimeout(() => this.next(), 1500);
    });
  }

  teardown() {
    if (this.node) this.node.forEach((n) => n.disconnect());
    if (this.el) {
      this.el.onended = null;
      this.el.pause();
      this.el.removeAttribute('src');
      this.el.load();
    }
    this.el = null;
    this.node = null;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.teardown();
  }
}

function setPannerPosition(p, v) {
  if (p.positionX) {
    p.positionX.value = v.x;
    p.positionY.value = v.y;
    p.positionZ.value = v.z;
  } else p.setPosition(v.x, v.y, v.z);
}
