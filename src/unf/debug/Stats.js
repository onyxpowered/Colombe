export class Stats {
  constructor() {
    this.el = document.createElement('pre');
    this.el.style.cssText = 'position:fixed;left:8px;top:8px;margin:0;padding:6px 8px;background:rgba(0,0,0,.55);color:#9ef0a8;font:11px/1.35 ui-monospace,monospace;pointer-events:none;display:none;white-space:pre';
    document.body.appendChild(this.el);
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
    this.visible = false;
  }

  toggle() {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }

  update(frameMs, renderer, engine) {
    this.frames++;
    this.acc += frameMs;
    this.worst = Math.max(this.worst, frameMs);
    if (this.acc < 500) return;
    if (this.visible) {
      const info = renderer.gl.info.render;
      this.el.textContent =
        `${(1000 * this.frames / this.acc).toFixed(0)} fps  avg ${(this.acc / this.frames).toFixed(1)} ms  worst ${this.worst.toFixed(0)} ms\n` +
        `tier ${renderer.tier.name}  scale ${renderer.governor.scale.toFixed(2)}  ${renderer.width}x${renderer.height}\n` +
        `calls ${info.calls}  tris ${info.triangles}  tex ${renderer.gl.info.memory.textures}  geo ${renderer.gl.info.memory.geometries}\n` +
        `${renderer.gpu || 'gpu unknown'}` +
        (engine ? `\nassets ${(engine.cache.bytes / 1048576).toFixed(0)}/${engine.tier.assetMB} MB  fetch ${engine.loader.active}+${engine.loader.queue.length}  voices ${engine.audio.pool.size}` : '');
    }
    this.frames = 0;
    this.acc = 0;
    this.worst = 0;
  }
}
