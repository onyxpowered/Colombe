import { Texture, CanvasTexture, SRGBColorSpace, NoColorSpace, NearestFilter, LinearFilter, LinearMipmapLinearFilter, NearestMipmapNearestFilter, RepeatWrapping, ClampToEdgeWrapping } from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

export class TextureLoader {
  constructor({ loader, cache, renderer, vendorBase = '/vendor/basis/', workers = 2 }) {
    this.loader = loader;
    this.cache = cache;
    this.ktx2 = new KTX2Loader().setTranscoderPath(vendorBase).setWorkerLimit(workers).detectSupport(renderer.gl);
  }

  load(path, { color = false, nearest = false, repeat = false, priority = 0, mips = true } = {}) {
    const key = `tex:${path}:${color ? 's' : 'l'}${nearest ? 'n' : ''}${repeat ? 'r' : ''}`;
    return this.cache.acquire(key, async () => {
      const isKtx = path.endsWith('.ktx2');
      let tex;
      let bytes;
      if (isKtx) {
        tex = await this.ktx2.loadAsync(this.loader.url(path));
        bytes = estimate(tex);
      } else {
        const buf = await this.loader.buffer(path, { priority });
        const bitmap = await createImageBitmap(new Blob([buf]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        tex = new Texture(bitmap);
        tex.flipY = false;
        tex.generateMipmaps = mips && !nearest;
        bytes = bitmap.width * bitmap.height * 4 * (tex.generateMipmaps ? 1.34 : 1);
        tex.onUpdate = () => {
          bitmap.close();
          tex.onUpdate = null;
        };
        tex.needsUpdate = true;
      }
      tex.colorSpace = color ? SRGBColorSpace : NoColorSpace;
      const hasMips = isKtx ? tex.mipmaps && tex.mipmaps.length > 1 : tex.generateMipmaps;
      tex.magFilter = nearest ? NearestFilter : LinearFilter;
      tex.minFilter = nearest ? (hasMips ? NearestMipmapNearestFilter : NearestFilter) : hasMips ? LinearMipmapLinearFilter : LinearFilter;
      tex.wrapS = tex.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
      tex.anisotropy = 1;
      return { value: tex, bytes, dispose: () => tex.dispose() };
    });
  }

  release(path, opts = {}) {
    this.cache.release(`tex:${path}:${opts.color ? 's' : 'l'}${opts.nearest ? 'n' : ''}${opts.repeat ? 'r' : ''}`);
  }

  dispose() {
    this.ktx2.dispose();
  }
}

function estimate(tex) {
  const m = tex.mipmaps && tex.mipmaps[0];
  if (!m) return 0;
  let total = 0;
  for (const level of tex.mipmaps) total += level.data ? level.data.byteLength : 0;
  return total;
}

export function dataTextureFrom(canvas) {
  const t = new CanvasTexture(canvas);
  t.generateMipmaps = false;
  t.minFilter = LinearFilter;
  return t;
}
