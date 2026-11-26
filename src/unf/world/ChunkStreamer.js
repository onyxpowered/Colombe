import { selectLod } from './Lod.js';

export class ChunkStreamer {
  constructor({ geometry, parent, makeMesh, uploadsPerFrame = 1, hysteresis = 0.12, cull = null }) {
    this.cull = cull;
    this.geometry = geometry;
    this.parent = parent;
    this.makeMesh = makeMesh;
    this.uploadsPerFrame = uploadsPerFrame;
    this.hysteresis = hysteresis;
    this.chunks = [];
    this.ready = [];
    this.stats = { loading: 0, resident: 0, triangles: 0 };
  }

  add(chunk) {
    this.chunks.push({ ...chunk, lod: -2, shown: -1, mesh: null, wanted: -2, loadingLod: -2, maxDists: chunk.lods.map((l) => l.maxDist) });
  }

  update(camera) {
    for (const c of this.chunks) {
      const dist = Math.max(0, camera.distanceTo(c.center) - c.radius);
      c.lod = this.cull && this.cull(camera, c, dist) ? -1 : selectLod(dist, c.maxDists, c.lod, this.hysteresis);
      if (c.lod === c.shown && c.loadingLod < 0) continue;
      if (c.lod === -1) {
        if (c.shown !== -1) this.drop(c);
        continue;
      }
      if (c.lod !== c.loadingLod && c.lod !== c.shown) this.request(c, c.lod, dist);
    }
    let n = 0;
    while (this.ready.length && n < this.uploadsPerFrame) {
      const job = this.ready.shift();
      if (job.chunk.lod !== job.lod) {
        this.geometry.release(job.path);
        continue;
      }
      this.show(job.chunk, job.lod, job.geometry);
      n++;
    }
    this.stats.loading = this.chunks.filter((c) => c.loadingLod >= 0).length;
  }

  request(c, lod, dist) {
    c.loadingLod = lod;
    const path = c.lods[lod].path;
    this.geometry
      .load(path, { priority: Math.max(0, 1000 - Math.round(dist)) })
      .then((g) => {
        if (c.loadingLod === lod) c.loadingLod = -2;
        this.ready.push({ chunk: c, lod, path, geometry: g });
      })
      .catch((e) => {
        if (c.loadingLod === lod) c.loadingLod = -2;
        console.warn('[unf] chunk load failed', path, e.message);
      });
  }

  show(c, lod, g) {
    const old = c.mesh;
    const oldPath = c.shown >= 0 ? c.lods[c.shown].path : null;
    c.mesh = this.makeMesh(g, c, lod);
    this.parent.add(c.mesh);
    c.shown = lod;
    if (old) this.parent.remove(old);
    if (oldPath) this.geometry.release(oldPath);
    this.recount();
  }

  drop(c) {
    if (c.mesh) this.parent.remove(c.mesh);
    if (c.shown >= 0) this.geometry.release(c.lods[c.shown].path);
    c.mesh = null;
    c.shown = -1;
    this.recount();
  }

  recount() {
    let tris = 0;
    let resident = 0;
    for (const c of this.chunks) {
      if (!c.mesh) continue;
      resident++;
      const g = c.mesh.geometry;
      tris += g.index ? g.index.count / 3 : 0;
    }
    this.stats.resident = resident;
    this.stats.triangles = tris;
  }
}
