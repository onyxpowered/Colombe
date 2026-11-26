let decoder = null;
let ready = null;

function init(base) {
  if (ready) return ready;
  ready = (async () => {
    importScripts(base + 'draco_wasm_wrapper.js');
    const wasm = await (await fetch(base + 'draco_decoder.wasm')).arrayBuffer();
    decoder = await new Promise((resolve) => DracoDecoderModule({ wasmBinary: wasm, onModuleLoaded: resolve }));
  })();
  return ready;
}

const NAMES = { 0: 'position', 1: 'normal', 2: 'color', 3: 'uv' };

function readFloats(D, dec, geo, attr, count) {
  const n = count * attr.num_components();
  const ptr = D._malloc(n * 4);
  dec.GetAttributeDataArrayForAllPoints(geo, attr, D.DT_FLOAT32, n * 4, ptr);
  const out = new Float32Array(D.HEAPF32.buffer, ptr, n).slice();
  D._free(ptr);
  return out;
}

function packNormals(src, count) {
  const out = new Int8Array(count * 4);
  for (let i = 0; i < count; i++) {
    out[i * 4] = Math.round(Math.max(-1, Math.min(1, src[i * 3])) * 127);
    out[i * 4 + 1] = Math.round(Math.max(-1, Math.min(1, src[i * 3 + 1])) * 127);
    out[i * 4 + 2] = Math.round(Math.max(-1, Math.min(1, src[i * 3 + 2])) * 127);
  }
  return out;
}

function packColors(src, count, comps) {
  const out = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) out[i * 4 + k] = Math.round(Math.max(0, Math.min(1, k < comps ? src[i * comps + k] : 1)) * 255);
  }
  return out;
}

function packUv(src, count) {
  let ok = true;
  for (let i = 0; i < src.length; i++) {
    if (src[i] < 0 || src[i] > 1) {
      ok = false;
      break;
    }
  }
  if (!ok) return null;
  const out = new Uint16Array(count * 2);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(src[i] * 65535);
  return out;
}

function decode(buffer, opts) {
  const D = decoder;
  const dec = new D.Decoder();
  const input = new D.DecoderBuffer();
  input.Init(new Int8Array(buffer), buffer.byteLength);
  const type = dec.GetEncodedGeometryType(input);
  const isMesh = type === D.TRIANGULAR_MESH;
  const geo = isMesh ? new D.Mesh() : new D.PointCloud();
  const status = isMesh ? dec.DecodeBufferToMesh(input, geo) : dec.DecodeBufferToPointCloud(input, geo);
  if (!status.ok()) {
    const msg = status.error_msg();
    D.destroy(input);
    D.destroy(dec);
    throw new Error('draco: ' + msg);
  }
  const count = geo.num_points();
  const attributes = [];
  const transfer = [];
  const seen = {};
  let generic = 0;
  for (let i = 0; i < geo.num_attributes(); i++) {
    const a = dec.GetAttribute(geo, i);
    const t = a.attribute_type();
    const comps = a.num_components();
    const raw = readFloats(D, dec, geo, a, count);
    let name = NAMES[t];
    if (name) {
      const n = (seen[name] = (seen[name] || 0) + 1);
      if (n > 1) name += n;
    } else name = 'g' + generic++;
    let entry;
    if (opts.compact && t === 1 && comps === 3) entry = { name, array: packNormals(raw, count), itemSize: 4, normalized: true };
    else if (opts.compact && t === 2) entry = { name, array: packColors(raw, count, comps), itemSize: 4, normalized: true };
    else if (opts.compact && t === 3 && comps === 2 && packUv(raw, count)) entry = { name, array: packUv(raw, count), itemSize: 2, normalized: true };
    else entry = { name, array: raw, itemSize: comps, normalized: false };
    attributes.push(entry);
    transfer.push(entry.array.buffer);
  }
  let index = null;
  if (isMesh) {
    const faces = geo.num_faces();
    const n = faces * 3;
    const ptr = D._malloc(n * 4);
    dec.GetTrianglesUInt32Array(geo, n * 4, ptr);
    const all = new Uint32Array(D.HEAPU32.buffer, ptr, n);
    index = count <= 65535 ? Uint16Array.from(all) : all.slice();
    D._free(ptr);
    transfer.push(index.buffer);
  }
  D.destroy(geo);
  D.destroy(input);
  D.destroy(dec);
  return { result: { attributes, index, count }, transfer };
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      await init(m.base);
      self.postMessage({ id: m.id, ok: true });
    } else {
      await ready;
      const { result, transfer } = decode(m.buffer, m.opts || {});
      self.postMessage({ id: m.id, ok: true, result }, transfer);
    }
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
