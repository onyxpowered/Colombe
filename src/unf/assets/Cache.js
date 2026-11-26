export class Cache {
  constructor({ budgetBytes = 256 * 1048576 } = {}) {
    this.budget = budgetBytes;
    this.items = new Map();
    this.bytes = 0;
    this.clock = 0;
  }

  acquire(key, load) {
    let e = this.items.get(key);
    if (!e) {
      e = { key, refs: 0, bytes: 0, last: 0, value: undefined, dispose: null, promise: null, dead: false };
      e.promise = Promise.resolve()
        .then(load)
        .then((r) => {
          if (e.dead) {
            if (r && r.dispose) r.dispose();
            return undefined;
          }
          e.value = r.value;
          e.bytes = r.bytes || 0;
          e.dispose = r.dispose || null;
          this.bytes += e.bytes;
          this.trim();
          return e.value;
        })
        .catch((err) => {
          this.items.delete(key);
          throw err;
        });
      this.items.set(key, e);
    }
    e.refs++;
    e.last = ++this.clock;
    return e.promise;
  }

  peek(key) {
    const e = this.items.get(key);
    return e && e.value;
  }

  release(key) {
    const e = this.items.get(key);
    if (!e || e.refs === 0) return;
    e.refs--;
    e.last = ++this.clock;
    if (e.refs === 0) this.trim();
  }

  trim() {
    if (this.bytes <= this.budget) return;
    const idle = [...this.items.values()].filter((e) => e.refs === 0 && e.value !== undefined).sort((a, b) => a.last - b.last);
    for (const e of idle) {
      if (this.bytes <= this.budget) break;
      this.evict(e);
    }
  }

  evict(e) {
    this.items.delete(e.key);
    this.bytes -= e.bytes;
    e.dead = true;
    if (e.dispose) e.dispose();
  }

  clear() {
    for (const e of [...this.items.values()]) this.evict(e);
  }

  stats() {
    let live = 0;
    let idle = 0;
    for (const e of this.items.values()) e.refs > 0 ? live++ : idle++;
    return { bytes: this.bytes, budget: this.budget, live, idle };
  }
}
