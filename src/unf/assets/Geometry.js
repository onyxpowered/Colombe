import { BufferGeometry, BufferAttribute, Sphere, Box3 } from 'three';

export class GeometryLoader {
  constructor({ loader, cache, vendorBase = '/vendor/draco/', workers = 2 }) {
    this.loader = loader;
    this.cache = cache;
    this.base = new URL(vendorBase, location.href).href;
    this.size = Math.max(1, Math.min(workers, (navigator.hardwareConcurrency || 4) - 1));
    this.pool = [];
    this.id = 0;
    this.pending = new Map();
    this.rr = 0;
  }

  spawn() {
    const w = new Worker(new URL('./dracoWorker.js', import.meta.url));
    w.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
    const ready = this.call(w, { type: 'init', base: this.base });
    return { w, ready };
  }

  call(w, msg, transfer = []) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  }

  async decode(buffer, opts) {
    if (!this.pool.length) for (let i = 0; i < this.size; i++) this.pool.push(this.spawn());
    const slot = this.pool[this.rr++ % this.pool.length];
    await slot.ready;
    return this.call(slot.w, { type: 'decode', buffer, opts }, [buffer]);
  }

  load(path, { priority = 0, compact = true } = {}) {
    return this.cache.acquire('geo:' + path, async () => {
      const buffer = await this.loader.buffer(path, { priority });
      const out = await this.decode(buffer, { compact });
      const geometry = new BufferGeometry();
      let bytes = 0;
      for (const a of out.attributes) {
        geometry.setAttribute(a.name, new BufferAttribute(a.array, a.itemSize, a.normalized));
        bytes += a.array.byteLength;
      }
      if (out.index) {
        geometry.setIndex(new BufferAttribute(out.index, 1));
        bytes += out.index.byteLength;
      }
      const pos = geometry.attributes.position;
      if (pos) {
        geometry.boundingBox = new Box3().setFromBufferAttribute(pos);
        geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
      }
      return { value: geometry, bytes, dispose: () => geometry.dispose() };
    });
  }

  release(path) {
    this.cache.release('geo:' + path);
  }

  dispose() {
    for (const s of this.pool) s.w.terminate();
    this.pool = [];
  }
}
