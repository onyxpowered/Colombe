import { Renderer } from './core/Renderer.js';
import { Loop } from './core/Loop.js';
import { Input } from './core/Input.js';
import { Cache } from './assets/Cache.js';
import { Loader } from './assets/Loader.js';
import { GeometryLoader } from './assets/Geometry.js';
import { TextureLoader } from './assets/Textures.js';
import { AudioEngine } from './audio/Audio.js';
import { Stats } from './debug/Stats.js';
import { loadManifest, defineAudio } from './assets/Manifest.js';

export const VERSION = '0.2.0';

export class Engine {
  constructor({ parent = document.body, assetRoot = '/a/' } = {}) {
    this.version = VERSION;
    this.renderer = new Renderer(parent);
    this.tier = this.renderer.tier;
    this.input = new Input(this.renderer.canvas);
    this.stats = new Stats();
    this.loader = new Loader({ root: assetRoot, concurrency: this.tier.fetches });
    this.cache = new Cache({ budgetBytes: this.tier.assetMB * 1048576 });
    this.geometry = new GeometryLoader({ loader: this.loader, cache: this.cache, workers: this.tier.decoders });
    this.textures = new TextureLoader({ loader: this.loader, cache: this.cache, renderer: this.renderer, workers: this.tier.decoders });
    this.audio = new AudioEngine({ loader: this.loader, voices: this.tier.voices, decodeBudgetMB: this.tier.audioMB });
  }

  async useManifest(url) {
    this.manifest = await loadManifest(url);
    defineAudio(this.audio, this.manifest);
    return this.manifest;
  }

  loop({ step, render }) {
    const loop = new Loop({
      step,
      render: (alpha, frameMs) => {
        if (this.input.wasPressed('F3')) this.stats.toggle();
        this.input.endFrame();
        render(alpha, frameMs);
        this.renderer.frameDone(frameMs);
        this.stats.update(frameMs, this.renderer, this);
      },
    });
    loop.start();
    return loop;
  }
}
