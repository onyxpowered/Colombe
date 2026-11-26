export class Loop {
  constructor({ step, render, hz = 60, maxCatchUp = 5 }) {
    this.step = step;
    this.render = render;
    this.dt = 1 / hz;
    this.maxCatchUp = maxCatchUp;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.tick = this.tick.bind(this);
    document.addEventListener('visibilitychange', () => {
      this.last = 0;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
  }

  tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this.tick);
    if (!this.last) this.last = now;
    const frameMs = Math.min(250, now - this.last);
    this.last = now;
    this.acc += frameMs / 1000;
    let steps = 0;
    while (this.acc >= this.dt && steps < this.maxCatchUp) {
      this.step(this.dt);
      this.acc -= this.dt;
      steps++;
    }
    if (steps === this.maxCatchUp) this.acc = 0;
    this.render(this.acc / this.dt, frameMs);
  }
}
