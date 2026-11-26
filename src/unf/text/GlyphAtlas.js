import { DataTexture, RedFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping } from 'three';
import { sdfFromAlpha } from './Sdf.js';

export class GlyphAtlas {
  constructor({ font = '600 40px system-ui, sans-serif', size = 40, spread = 6, width = 512, height = 512 } = {}) {
    this.font = font;
    this.size = size;
    this.spread = spread;
    this.cell = size + spread * 2;
    this.width = width;
    this.height = height;
    this.cols = Math.floor(width / this.cell);
    this.rows = Math.floor(height / this.cell);
    this.data = new Uint8Array(width * height);
    this.texture = new DataTexture(this.data, width, height, RedFormat, UnsignedByteType);
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.unpackAlignment = 1;
    this.glyphs = new Map();
    this.next = 0;
    this.canvas = new OffscreenCanvas(this.cell, this.cell);
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  glyph(ch) {
    let g = this.glyphs.get(ch);
    if (g) return g;
    if (this.next >= this.cols * this.rows) return this.glyph('?') || null;
    const slot = this.next++;
    const cx = (slot % this.cols) * this.cell;
    const cy = Math.floor(slot / this.cols) * this.cell;
    const { ctx, cell, spread, size } = this;
    ctx.clearRect(0, 0, cell, cell);
    ctx.font = this.font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    const advance = ctx.measureText(ch).width;
    ctx.fillText(ch, spread, spread + size * 0.82);
    const img = ctx.getImageData(0, 0, cell, cell).data;
    const alpha = new Uint8Array(cell * cell);
    for (let i = 0; i < alpha.length; i++) alpha[i] = img[i * 4 + 3];
    sdfFromAlpha(alpha, cell, cell, spread, this.data, cy * this.width + cx, this.width);
    this.texture.needsUpdate = true;
    g = {
      advance: advance / size,
      offsetX: -spread / size,
      offsetY: -(spread + size * 0.82) / size,
      w: cell / size,
      h: cell / size,
      u: cx / this.width,
      v: cy / this.height,
      uw: cell / this.width,
      vh: cell / this.height,
    };
    this.glyphs.set(ch, g);
    return g;
  }

  prime(chars) {
    for (const ch of chars) this.glyph(ch);
  }

  measure(text) {
    let w = 0;
    for (const ch of text) w += this.glyph(ch).advance;
    return w;
  }

  dispose() {
    this.texture.dispose();
  }
}
