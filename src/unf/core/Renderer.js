import { WebGLRenderer, PCFShadowMap } from 'three';
import { detectGpu, pickTier, Governor } from './Quality.js';

export class Renderer {
  constructor(parent) {
    this.canvas = document.createElement('canvas');
    parent.appendChild(this.canvas);
    this.gl = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      precision: 'mediump',
    });
    this.gpu = detectGpu(this.gl.getContext());
    this.tier = pickTier(this.gpu);
    this.governor = new Governor(this.tier);
    this.gl.setPixelRatio(1);
    this.gl.shadowMap.enabled = this.tier.shadows;
    this.gl.shadowMap.type = PCFShadowMap;
    this.gl.shadowMap.autoUpdate = false;
    this.gl.info.autoReset = false;
    this.width = 1;
    this.height = 1;
    this.lost = false;
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.resize();
    });
    this.resize();
  }

  resize() {
    const cssW = Math.max(1, innerWidth);
    const cssH = Math.max(1, innerHeight);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const nativeW = cssW * dpr;
    const nativeH = cssH * dpr;
    const cap = Math.min(1, Math.sqrt(this.tier.maxPixels / (nativeW * nativeH)));
    const k = cap * this.governor.scale;
    this.width = Math.max(2, Math.round(nativeW * k));
    this.height = Math.max(2, Math.round(nativeH * k));
    this.gl.setSize(this.width, this.height, false);
  }

  render(scene, camera) {
    if (this.lost) return;
    this.gl.info.reset();
    this.gl.render(scene, camera);
  }

  frameDone(frameMs) {
    this.governor.record(frameMs);
    if (this.governor.consume()) this.resize();
  }
}
