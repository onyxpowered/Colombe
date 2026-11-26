import { Vector3, PerspectiveCamera } from 'three';

const EYE = 1.6;
const WALK = 5.5;
const SPRINT = 8.5;
const JUMP = 6.2;
const GRAVITY = 16;
const ACCEL_GROUND = 14;
const ACCEL_AIR = 3;
const SENS = 0.0022;
const PITCH_LIMIT = 1.45;

const up = new Vector3();
const right = new Vector3();
const wish = new Vector3();
const tmp = new Vector3();

export class Player {
  constructor(planet) {
    this.planet = planet;
    this.pos = new Vector3(0, planet.radius, 0);
    this.prevPos = this.pos.clone();
    this.fwd = new Vector3(0, 0, -1);
    this.prevFwd = this.fwd.clone();
    this.velT = new Vector3();
    this.velUp = 0;
    this.pitch = 0;
    this.grounded = true;
    this.camera = new PerspectiveCamera(75, 1, 0.1, 400);
    this.camera.rotation.order = 'YXZ';
  }

  step(dt, input) {
    this.prevPos.copy(this.pos);
    this.prevFwd.copy(this.fwd);
    this.planet.gravityUp(this.pos, up);

    this.fwd.addScaledVector(up, -this.fwd.dot(up)).normalize();
    this.velT.addScaledVector(up, -this.velT.dot(up));

    const [lx, ly] = input.takeLook();
    if (lx) this.fwd.applyAxisAngle(up, -lx * SENS).normalize();
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - ly * SENS));

    right.crossVectors(this.fwd, up).normalize();
    wish.set(0, 0, 0)
      .addScaledVector(this.fwd, input.axis('KeyS', 'KeyW'))
      .addScaledVector(right, input.axis('KeyA', 'KeyD'));
    if (wish.lengthSq() > 1e-6) wish.normalize();
    const speed = input.held('ShiftLeft') ? SPRINT : WALK;
    wish.multiplyScalar(speed);

    const accel = (this.grounded ? ACCEL_GROUND : ACCEL_AIR) * dt;
    tmp.copy(wish).sub(this.velT);
    const len = tmp.length();
    if (len > accel) tmp.multiplyScalar(accel / len);
    this.velT.add(tmp);

    if (this.grounded && input.held('Space')) {
      this.velUp = JUMP;
      this.grounded = false;
    }
    this.velUp -= GRAVITY * dt;

    this.pos.addScaledVector(this.velT, dt).addScaledVector(up, this.velUp * dt);

    const ground = this.planet.surfaceRadius(this.pos);
    if (this.pos.length() <= ground) {
      this.pos.setLength(ground);
      if (this.velUp < 0) this.velUp = 0;
      this.grounded = true;
    } else {
      this.grounded = this.pos.length() - ground < 0.02 && this.velUp <= 0;
    }
  }

  updateCamera(alpha, aspect) {
    const cam = this.camera;
    if (cam.aspect !== aspect) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    const p = tmp.copy(this.prevPos).lerp(this.pos, alpha);
    up.copy(p).normalize();
    cam.position.copy(p).addScaledVector(up, EYE);
    cam.up.copy(up);
    right.copy(this.prevFwd).lerp(this.fwd, alpha).normalize();
    const cp = Math.cos(this.pitch);
    wish.copy(right).multiplyScalar(cp).addScaledVector(up, Math.sin(this.pitch));
    cam.lookAt(cam.position.x + wish.x, cam.position.y + wish.y, cam.position.z + wish.z);
  }
}
