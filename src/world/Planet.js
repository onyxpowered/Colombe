import { Group, Mesh, InstancedMesh, IcosahedronGeometry, BoxGeometry, MeshLambertMaterial, BufferAttribute, Color, Object3D, Quaternion, Vector3, DirectionalLight, HemisphereLight } from 'three';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Planet {
  constructor({ radius = 40, detail = 22, props = 600, seed = 7 } = {}) {
    this.radius = radius;
    this.object = new Group();
    this.object.add(this.buildGround(radius, detail, rng(seed)));
    this.object.add(this.buildProps(radius, props, rng(seed + 1)));
    this.sun = new DirectionalLight(0xfff1d6, 2.2);
    this.sun.position.set(60, 90, 40);
    this.object.add(this.sun, new HemisphereLight(0xbfdcff, 0x4a5a3a, 1.1));
  }

  gravityUp(point, out) {
    return out.copy(point).normalize();
  }

  surfaceRadius() {
    return this.radius;
  }

  buildGround(radius, detail, rand) {
    const geo = new IcosahedronGeometry(radius, detail);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grass = [new Color(0x5f8f45), new Color(0x6fa04f), new Color(0x557f3d)];
    const sand = new Color(0xd8c690);
    const c = new Color();
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / (3 * radius);
      c.copy(Math.abs(y) < 0.08 ? sand : grass[Math.floor(rand() * grass.length)]);
      for (let k = 0; k < 3; k++) {
        colors[(i + k) * 3] = c.r;
        colors[(i + k) * 3 + 1] = c.g;
        colors[(i + k) * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    const mesh = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = true;
    return mesh;
  }

  buildProps(radius, count, rand) {
    const geo = new BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mesh = new InstancedMesh(geo, new MeshLambertMaterial({ flatShading: true }), count);
    const dummy = new Object3D();
    const up = new Vector3();
    const yAxis = new Vector3(0, 1, 0);
    const q = new Quaternion();
    const spin = new Quaternion();
    const tint = new Color();
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      up.set(r * Math.cos(t), u, r * Math.sin(t));
      const h = 0.8 + rand() * 4.2;
      dummy.position.copy(up).multiplyScalar(radius - 0.05);
      q.setFromUnitVectors(yAxis, up);
      spin.setFromAxisAngle(yAxis, rand() * Math.PI * 2);
      dummy.quaternion.copy(q).multiply(spin);
      dummy.scale.set(0.8 + rand() * 2.4, h, 0.8 + rand() * 2.4);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, tint.setHSL(0.05 + rand() * 0.1, 0.1 + rand() * 0.2, 0.45 + rand() * 0.25));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}
