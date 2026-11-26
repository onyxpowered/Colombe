import { Vector3 } from 'three';

export async function loadManifest(url = '/manifest.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('manifest ' + res.status);
  return res.json();
}

export function defineAudio(audio, manifest) {
  for (const [stem, a] of Object.entries(manifest.audio)) {
    audio.define(stem, { path: stem, formats: a.formats, bus: a.bus, stream: a.stream, loop: stem.startsWith('ambiances/') });
  }
}

export function planetChunks(manifest, tier) {
  const p = manifest.planet;
  if (!p.tiles) return [];
  const set = tier.chunkDetail === 0 ? 'low' : 'high';
  const skip = tier.chunkDetail === 1 ? 1 : 0;
  return p.tiles[set].map((t) => {
    const lods = t.lods.slice(skip).filter(Boolean);
    const base = set === 'low' ? [6, 12] : tier.chunkDetail === 1 ? [8, 16] : [6, 12, 20];
    const dists = [...base.slice(0, lods.length - 1), tier.bubble];
    return {
      id: `${set}${t.id}`,
      center: new Vector3(...t.center),
      radius: t.radius,
      lods: lods.map((l, i) => ({ path: l.path, maxDist: dists[i] })),
    };
  });
}
