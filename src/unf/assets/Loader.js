export class Loader {
  constructor({ root = '/a/', concurrency = 6 } = {}) {
    this.root = root.endsWith('/') ? root : root + '/';
    this.concurrency = concurrency;
    this.queue = [];
    this.active = 0;
    this.inflight = new Map();
    this.seq = 0;
    this.requested = 0;
    this.completed = 0;
    this.bytes = 0;
    this.onProgress = null;
  }

  url(path) {
    return /^(https?:|blob:|data:|\/)/.test(path) ? path : this.root + path;
  }

  buffer(path, { priority = 0 } = {}) {
    const hit = this.inflight.get(path);
    if (hit) {
      if (priority > hit.task.priority) {
        hit.task.priority = priority;
        this.queue.sort(order);
      }
      return hit.promise;
    }
    const task = { path, priority, seq: this.seq++, controller: new AbortController(), run: null };
    const promise = new Promise((resolve, reject) => {
      task.run = async () => {
        try {
          const res = await fetch(this.url(path), { signal: task.controller.signal });
          if (!res.ok) throw new Error(`${res.status} ${path}`);
          const buf = await res.arrayBuffer();
          this.bytes += buf.byteLength;
          resolve(buf);
        } catch (e) {
          reject(e);
        }
      };
    });
    this.inflight.set(path, { task, promise });
    this.requested++;
    this.queue.push(task);
    this.queue.sort(order);
    this.pump();
    return promise;
  }

  cancel(path) {
    const hit = this.inflight.get(path);
    if (!hit) return;
    const i = this.queue.indexOf(hit.task);
    if (i >= 0) {
      this.queue.splice(i, 1);
      this.inflight.delete(path);
      this.requested--;
    } else hit.task.controller.abort();
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      this.active++;
      task.run().finally(() => {
        this.active--;
        this.completed++;
        this.inflight.delete(task.path);
        if (this.onProgress) this.onProgress(this.progress());
        this.pump();
      });
    }
  }

  progress() {
    return { done: this.completed, total: this.requested, bytes: this.bytes, active: this.active, queued: this.queue.length };
  }
}

function order(a, b) {
  return b.priority - a.priority || a.seq - b.seq;
}
