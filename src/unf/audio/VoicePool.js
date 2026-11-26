export class VoicePool {
  constructor(max = 24) {
    this.max = max;
    this.voices = new Set();
    this.lastPlay = new Map();
    this.perName = new Map();
  }

  admit(name, { priority = 0, minGap = 0, maxVoices = Infinity, now = 0 } = {}) {
    const last = this.lastPlay.get(name);
    if (minGap > 0 && last !== undefined && now - last < minGap) return { ok: false, steal: null };
    const mine = [...this.voices].filter((v) => v.name === name);
    let steal = null;
    if (mine.length >= maxVoices) steal = oldest(mine);
    else if (this.voices.size >= this.max) {
      const lowest = Math.min(...[...this.voices].map((v) => v.priority));
      if (priority < lowest) return { ok: false, steal: null };
      steal = oldest([...this.voices].filter((v) => v.priority === lowest));
    }
    this.lastPlay.set(name, now);
    return { ok: true, steal };
  }

  add(v) {
    this.voices.add(v);
  }

  remove(v) {
    this.voices.delete(v);
  }

  get size() {
    return this.voices.size;
  }
}

function oldest(list) {
  return list.reduce((a, b) => (a.started <= b.started ? a : b));
}
