import { InstancedBufferGeometry, InstancedBufferAttribute, BufferAttribute, Mesh, ShaderMaterial, Color } from 'three';

const VERT = /* glsl */ `
precision mediump float;
attribute vec3 anchor;
attribute vec4 rect;
attribute vec4 uvr;
attribute vec3 tint;
uniform float uScale;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
  vec4 mv = viewMatrix * vec4(anchor, 1.0);
  float dist = max(0.001, -mv.z);
  float k = uScale * clamp(dist * 0.045, 0.7, 2.6);
  mv.xy += (rect.xy + position.xy * rect.zw) * k;
  gl_Position = projectionMatrix * mv;
  vUv = uvr.xy + vec2(position.x, 1.0 - position.y) * uvr.zw;
  vTint = tint;
  vFade = (mv.z < 0.0) ? 1.0 - smoothstep(uNear, uFar, dist) : 0.0;
}`;

const FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tAtlas;
varying vec2 vUv;
varying vec3 vTint;
varying float vFade;
void main() {
  float d = texture2D(tAtlas, vUv).r;
  float w = max(fwidth(d), 0.02);
  float a = smoothstep(0.5 - w, 0.5 + w, d);
  float o = smoothstep(0.36 - w, 0.36 + w, d);
  vec3 c = mix(vec3(0.0), vTint, a);
  float alpha = o * vFade;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(c, alpha);
}`;

export class NameTags {
  constructor({ atlas, capacity = 16, maxChars = 16, scale = 0.12, near = 30, far = 60 }) {
    this.atlas = atlas;
    this.maxChars = maxChars;
    this.capacity = capacity;
    const n = capacity * maxChars;
    const geo = new InstancedBufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.anchor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.rect = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.uvr = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.tint = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (const a of [this.anchor, this.rect, this.uvr, this.tint]) a.setUsage(35048);
    geo.setAttribute('anchor', this.anchor);
    geo.setAttribute('rect', this.rect);
    geo.setAttribute('uvr', this.uvr);
    geo.setAttribute('tint', this.tint);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { tAtlas: { value: atlas.texture }, uScale: { value: scale }, uNear: { value: near }, uFar: { value: far } },
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.slots = new Map();
    this.free = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
  }

  set(id, text, color = '#ffffff') {
    let slot = this.slots.get(id);
    if (!slot) {
      if (!this.free.length) return false;
      slot = { index: this.free.pop(), count: 0 };
      this.slots.set(id, slot);
    }
    const chars = [...text].slice(0, this.maxChars);
    const total = this.atlas.measure(chars.join(''));
    const c = new Color(color);
    let x = -total / 2;
    const base = slot.index * this.maxChars;
    for (let i = 0; i < this.maxChars; i++) {
      const o = base + i;
      if (i >= chars.length) {
        this.rect.array.fill(0, o * 4, o * 4 + 4);
        continue;
      }
      const g = this.atlas.glyph(chars[i]);
      this.rect.array.set([x + g.offsetX, g.offsetY, g.w, g.h], o * 4);
      this.uvr.array.set([g.u, g.v, g.uw, g.vh], o * 4);
      this.tint.array.set([c.r, c.g, c.b], o * 3);
      x += g.advance;
    }
    slot.count = chars.length;
    this.rect.needsUpdate = this.uvr.needsUpdate = this.tint.needsUpdate = true;
    this.geo.instanceCount = this.capacity * this.maxChars;
    return true;
  }

  move(id, position) {
    const slot = this.slots.get(id);
    if (!slot) return;
    const base = slot.index * this.maxChars;
    for (let i = 0; i < slot.count; i++) this.anchor.array.set([position.x, position.y, position.z], (base + i) * 3);
    this.anchor.needsUpdate = true;
  }

  remove(id) {
    const slot = this.slots.get(id);
    if (!slot) return;
    const base = slot.index * this.maxChars;
    this.rect.array.fill(0, base * 4, (base + this.maxChars) * 4);
    this.rect.needsUpdate = true;
    this.slots.delete(id);
    this.free.push(slot.index);
  }

  dispose() {
    this.geo.dispose();
    this.material.dispose();
  }
}
