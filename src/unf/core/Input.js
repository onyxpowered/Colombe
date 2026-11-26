export class Input {
  constructor(element) {
    this.element = element;
    this.down = new Set();
    this.pressed = new Set();
    this.lookX = 0;
    this.lookY = 0;
    this.locked = false;
    this.onLockChange = null;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (this.locked && (e.code === 'Space' || e.code.startsWith('Arrow'))) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX;
      this.lookY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      if (!this.locked) this.down.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
    element.addEventListener('click', () => this.lock());
  }

  lock() {
    if (this.locked) return;
    const p = this.element.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.element.requestPointerLock());
  }

  held(code) {
    return this.down.has(code);
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  axis(neg, pos) {
    return (this.down.has(pos) ? 1 : 0) - (this.down.has(neg) ? 1 : 0);
  }

  takeLook() {
    const x = this.lookX;
    const y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return [x, y];
  }

  endFrame() {
    this.pressed.clear();
  }
}
