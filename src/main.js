import { Scene, Color, Fog } from 'three';
import { Engine } from './unf/Engine.js';
import { Planet } from './world/Planet.js';
import { Player } from './game/Player.js';

const engine = new Engine();
const { renderer, input } = engine;
const hint = document.getElementById('hint');

const sky = new Color(0x9fd0f0);
const scene = new Scene();
scene.background = sky;
scene.fog = new Fog(sky, 30, renderer.tier.fogFar);

const planet = new Planet({ props: renderer.tier.instances });
scene.add(planet.object);
const player = new Player(planet);

input.onLockChange = (locked) => hint.classList.toggle('off', locked);

engine.loop({
  step: (dt) => player.step(dt, input),
  render: (alpha) => {
    player.updateCamera(alpha, renderer.width / renderer.height);
    renderer.render(scene, player.camera);
  },
});

window.__UNF = { engine, scene, player, planet, renderer };
