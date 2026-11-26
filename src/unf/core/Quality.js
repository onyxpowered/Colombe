export const Tiers = {
  chromebook: { name: 'chromebook', maxPixels: 1366 * 768, minScale: 0.5, shadows: false, fogFar: 160, instances: 600, targetMs: 16.7, assetMB: 160, audioMB: 24, voices: 16, fetches: 4, decoders: 1, chunkDetail: 0, bubble: 22 },
  balanced: { name: 'balanced', maxPixels: 1920 * 1080, minScale: 0.6, shadows: false, fogFar: 260, instances: 1200, targetMs: 16.7, assetMB: 320, audioMB: 40, voices: 24, fetches: 6, decoders: 2, chunkDetail: 1, bubble: 28 },
  desktop: { name: 'desktop', maxPixels: 2560 * 1440, minScale: 0.7, shadows: true, fogFar: 420, instances: 2400, targetMs: 8.3, assetMB: 640, audioMB: 64, voices: 32, fetches: 8, decoders: 3, chunkDetail: 2, bubble: 34 },
};

const weakGpu = /mali|adreno|powervr|swiftshader|llvmpipe|software|intel.*(hd|uhd) graphics|intel.*(gma|celeron|pentium)/i;
const strongGpu = /nvidia|geforce|rtx|radeon rx|apple m[2-9]|apple gpu/i;

export function detectGpu(gl) {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
}

export function pickTier(gpu) {
  const forced = new URLSearchParams(location.search).get('tier');
  if (forced && Tiers[forced]) return Tiers[forced];
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  if (weakGpu.test(gpu) || cores <= 4 || memory <= 4) return Tiers.chromebook;
  if (strongGpu.test(gpu) && cores >= 8) return Tiers.desktop;
  return Tiers.balanced;
}

export class Governor {
  constructor(tier) {
    this.tier = tier;
    this.scale = 1;
    this.samples = [];
    this.calm = 0;
    this.changed = true;
  }

  record(frameMs) {
    const s = this.samples;
    s.push(frameMs);
    if (s.length < 30) return;
    const sorted = s.slice().sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    s.length = 0;
    const budget = this.tier.targetMs;
    if (p90 > budget * 1.25 && this.scale > this.tier.minScale) {
      this.scale = Math.max(this.tier.minScale, +(this.scale - 0.05).toFixed(2));
      this.calm = 0;
      this.changed = true;
    } else if (p90 < budget * 0.8) {
      if (++this.calm >= 4 && this.scale < 1) {
        this.scale = Math.min(1, +(this.scale + 0.05).toFixed(2));
        this.calm = 0;
        this.changed = true;
      }
    } else {
      this.calm = 0;
    }
  }

  consume() {
    const c = this.changed;
    this.changed = false;
    return c;
  }
}
