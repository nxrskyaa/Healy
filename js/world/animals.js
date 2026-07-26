import * as THREE from 'three';
import { makeRandom, clamp, damp } from './noise.js';
import { heightAt, normalAt, POND, WATER_LEVEL } from './terrain.js';
import { paint, mergeParts } from './props.js';

/* ═══════════════════════════════════════════════════════════
   The little inhabitants. Every one of them is built from
   spheres and cones, merged into a single geometry, then
   animated by squashing, hopping and turning the whole body.
   ═══════════════════════════════════════════════════════════ */

const S = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);

function ell(r, sx, sy, sz, x = 0, y = 0, z = 0) {
  const g = S(r, 1);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}

function cone(r, h, x, y, z, rx = 0, rz = 0) {
  const g = new THREE.ConeGeometry(r, h, 7);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function cyl(r1, r2, h, x, y, z, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(r1, r2, h, 6);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

const EYE = '#241f22';
const SHINE = '#ffffff';

/** eyes + a highlight dot, facing +Z */
function eyes(parts, x, y, z, r = 0.055) {
  for (const s of [-1, 1]) {
    parts.push(paint(ell(r, 1, 1.25, 0.8, x * s, y, z), EYE, 0.0));
    parts.push(paint(ell(r * 0.36, 1, 1, 1, x * s + r * 0.34, y + r * 0.42, z + r * 0.5), SHINE, 0.0));
  }
}

/* ───────────────────────── species geometry ───────────────────────── */

const BUILDERS = {
  /* A duckling. The spiky black soot sprites read as burrs rolling through
     the grass, which is not the note this meadow is playing. */
  duckling() {
    const p = [];
    p.push(paint(ell(0.19, 1.05, 0.95, 1.25, 0, 0.19, 0), '#f0dc9a', 0.04));
    p.push(paint(ell(0.125, 1, 1, 1, 0, 0.36, 0.11), '#f6e6ae', 0.03));
    // bill and feet in the same soft orange
    const bill = new THREE.SphereGeometry(0.055, 8, 6);
    bill.scale(1.05, 0.45, 1.2);
    bill.translate(0, 0.335, 0.22);
    p.push(paint(bill, '#e2a24c', 0.02));
    p.push(paint(ell(0.075, 1.3, 0.28, 1.0, -0.075, 0.03, 0.03), '#e2a24c', 0.03));
    p.push(paint(ell(0.075, 1.3, 0.28, 1.0, 0.075, 0.03, 0.03), '#e2a24c', 0.03));
    // stubby wings
    for (const s of [-1, 1]) p.push(paint(ell(0.09, 0.35, 0.8, 1.1, s * 0.17, 0.2, 0), '#e8d288', 0.03));
    // tail tuft
    p.push(paint(cone(0.06, 0.11, 0, 0.24, -0.2, -Math.PI / 2, 0), '#e8d288', 0.03));
    eyes(p, 0.055, 0.39, 0.2, 0.028);
    return { geo: mergeParts(p), lift: 0.0, scale: 1 };
  },

  cat() {
    const p = [];
    p.push(paint(ell(0.3, 1.15, 0.85, 1.5, 0, 0.34, 0), '#d9a86c', 0.05));
    p.push(paint(ell(0.22, 1, 0.95, 1, 0, 0.52, 0.36), '#e0b477', 0.04));
    p.push(paint(cone(0.1, 0.2, -0.11, 0.72, 0.34), '#d9a86c', 0.04));
    p.push(paint(cone(0.1, 0.2, 0.11, 0.72, 0.34), '#d9a86c', 0.04));
    p.push(paint(ell(0.09, 1, 0.8, 1, 0, 0.47, 0.55), '#f6ead5', 0.02));
    p.push(paint(cyl(0.05, 0.08, 0.62, 0, 0.5, -0.46, -0.9, 0), '#d9a86c', 0.05));
    for (const [x, z] of [[-0.16, 0.26], [0.16, 0.26], [-0.16, -0.24], [0.16, -0.24]]) {
      p.push(paint(cyl(0.06, 0.07, 0.3, x, 0.15, z), '#e6bd85', 0.03));
    }
    // little white socks
    for (const [x, z] of [[-0.16, 0.26], [0.16, 0.26]]) p.push(paint(ell(0.075, 1, 0.7, 1.2, x, 0.05, z + 0.03), '#f6ead5', 0.02));
    eyes(p, 0.09, 0.55, 0.55, 0.045);
    return { geo: mergeParts(p), lift: 0.02, scale: 1 };
  },

  rabbit() {
    const p = [];
    p.push(paint(ell(0.26, 1, 0.95, 1.25, 0, 0.26, 0), '#f1ece1', 0.03));
    p.push(paint(ell(0.18, 1, 1, 1, 0, 0.46, 0.24), '#f6f2e8', 0.03));
    for (const s of [-1, 1]) p.push(paint(ell(0.075, 0.75, 2.9, 0.55, s * 0.09, 0.74, 0.16), '#f6f2e8', 0.03));
    p.push(paint(ell(0.1, 1, 1, 1, 0, 0.28, -0.3), '#ffffff', 0.02));
    for (const [x, z] of [[-0.14, 0.18], [0.14, 0.18]]) p.push(paint(ell(0.08, 1, 0.7, 1.4, x, 0.08, z), '#f1ece1', 0.02));
    p.push(paint(ell(0.035, 1, 0.8, 1, 0, 0.44, 0.41), '#e79aa8', 0.02));
    eyes(p, 0.085, 0.5, 0.38, 0.042);
    return { geo: mergeParts(p), lift: 0.02, scale: 1 };
  },

  deer() {
    const p = [];
    p.push(paint(ell(0.42, 1, 0.82, 1.45, 0, 0.82, 0), '#c08e63', 0.04));
    p.push(paint(cyl(0.12, 0.16, 0.55, 0, 1.14, 0.4, -0.5, 0), '#c9976b', 0.03));
    p.push(paint(ell(0.19, 0.9, 0.85, 1.2, 0, 1.4, 0.6), '#cd9c6f', 0.03));
    p.push(paint(ell(0.07, 1, 0.9, 1, 0, 1.33, 0.79), '#5c473a', 0.02));
    for (const s of [-1, 1]) {
      p.push(paint(ell(0.07, 0.7, 1.6, 0.5, s * 0.16, 1.55, 0.52), '#cd9c6f', 0.03));
      p.push(paint(cyl(0.025, 0.035, 0.3, s * 0.1, 1.66, 0.56, 0, s * 0.35), '#8a6b4a', 0.03));
      p.push(paint(cyl(0.02, 0.025, 0.18, s * 0.17, 1.8, 0.52, 0, s * 0.8), '#8a6b4a', 0.03));
    }
    for (const [x, z] of [[-0.2, 0.32], [0.2, 0.32], [-0.2, -0.3], [0.2, -0.3]]) {
      p.push(paint(cyl(0.055, 0.07, 0.78, x, 0.4, z), '#b8875e', 0.03));
      p.push(paint(ell(0.065, 1, 0.6, 1, x, 0.04, z), '#4c3a2e', 0.02));
    }
    // dappled back
    const rnd = makeRandom(19);
    for (let i = 0; i < 7; i++) {
      p.push(paint(ell(0.045, 1, 0.4, 1, (rnd() - 0.5) * 0.4, 1.16 - rnd() * 0.12, (rnd() - 0.5) * 0.9), '#f0dcc4', 0.02));
    }
    p.push(paint(ell(0.11, 1, 1, 1, 0, 0.95, -0.48), '#f4e6d4', 0.02));
    eyes(p, 0.13, 1.44, 0.68, 0.05);
    return { geo: mergeParts(p), lift: 0.0, scale: 1 };
  },

  bird() {
    const p = [];
    p.push(paint(ell(0.16, 1, 0.9, 1.5, 0, 0, 0), '#8fb6d8', 0.05));
    p.push(paint(ell(0.11, 1, 1, 1, 0, 0.09, 0.19), '#9cc2e2', 0.04));
    p.push(paint(cone(0.045, 0.13, 0, 0.07, 0.31, Math.PI / 2, 0), '#e8b465', 0.02));
    p.push(paint(cone(0.09, 0.3, 0, 0.02, -0.28, -Math.PI / 2, 0), '#7ba3c6', 0.04));
    p.push(paint(ell(0.06, 1, 1, 1, 0, -0.02, 0.1), '#f2f6f8', 0.02));
    eyes(p, 0.06, 0.11, 0.26, 0.028);
    return { geo: mergeParts(p), lift: 0, scale: 1 };
  },

  fish() {
    const p = [];
    p.push(paint(ell(0.16, 0.65, 1, 1.9, 0, 0, 0), '#e88f5c', 0.06));
    p.push(paint(cone(0.14, 0.24, 0, 0, -0.33, Math.PI / 2, 0), '#f2a874', 0.05));
    p.push(paint(ell(0.05, 0.3, 1.1, 0.9, 0.1, 0.02, 0.02), '#f6c39a', 0.03));
    p.push(paint(ell(0.05, 0.3, 1.1, 0.9, -0.1, 0.02, 0.02), '#f6c39a', 0.03));
    eyes(p, 0.07, 0.04, 0.19, 0.03);
    return { geo: mergeParts(p), lift: 0, scale: 1 };
  },

  frog() {
    const p = [];
    p.push(paint(ell(0.17, 1.15, 0.8, 1.25, 0, 0.13, 0), '#79ab63', 0.05));
    for (const s of [-1, 1]) {
      p.push(paint(ell(0.075, 1, 1, 1, s * 0.09, 0.26, 0.08), '#8cbd72', 0.03));
      p.push(paint(ell(0.045, 1, 1, 1, s * 0.09, 0.29, 0.12), EYE, 0.0));
      p.push(paint(ell(0.06, 1.1, 0.6, 1.5, s * 0.17, 0.06, -0.06), '#6f9e5b', 0.03));
    }
    return { geo: mergeParts(p), lift: 0.0, scale: 1 };
  },

  kodama() {
    const p = [];
    p.push(paint(ell(0.19, 1, 1.1, 0.95, 0, 0.36, 0), '#eef3ea', 0.02));
    p.push(paint(ell(0.09, 1, 1.5, 0.7, 0, 0.14, 0), '#e6ece2', 0.02));
    for (const [x, z] of [[-0.06, 0], [0.06, 0]]) p.push(paint(cyl(0.02, 0.024, 0.14, x, 0.05, z), '#dee5da', 0.02));
    for (const s of [-1, 1]) p.push(paint(ell(0.038, 1, 1, 0.6, s * 0.07, 0.4, 0.17), '#2a2f2c', 0.0));
    p.push(paint(ell(0.035, 1, 0.7, 0.6, 0, 0.3, 0.18), '#2a2f2c', 0.0));
    return { geo: mergeParts(p), lift: 0, scale: 1 };
  },
};

/* ───────────────────────── behaviour ───────────────────────── */

const onLand = (x, z) => {
  const h = heightAt(x, z);
  const pd = Math.hypot(x - POND.x, z - POND.z);
  return h > WATER_LEVEL + 0.4 && pd > POND.r * 1.05 && normalAt(x, z, 1.0).y > 0.72;
};

class Walker {
  constructor(mesh, opts) {
    this.mesh = mesh;
    Object.assign(this, {
      speed: 1.4, hop: 0, home: new THREE.Vector2(), roam: 14,
      shy: 4, curious: 0, idleMin: 1.5, idleMax: 5, bob: 1, lift: 0,
    }, opts);
    this.pos = new THREE.Vector2(mesh.position.x, mesh.position.z);
    this.target = this.pos.clone();
    this.heading = Math.random() * Math.PI * 2;
    this.timer = Math.random() * 3;
    this.state = 'idle';
    this.phase = Math.random() * 9;
    this.vel = 0;
  }

  pickTarget(rnd) {
    for (let i = 0; i < 12; i++) {
      const a = rnd() * Math.PI * 2;
      const r = rnd() * this.roam;
      const x = this.home.x + Math.cos(a) * r;
      const z = this.home.y + Math.sin(a) * r;
      if (onLand(x, z)) { this.target.set(x, z); return; }
    }
    this.target.copy(this.home);
  }

  update(dt, t, player, rnd) {
    const toPlayer = Math.hypot(player.x - this.pos.x, player.z - this.pos.y);

    // react to the visitor: shy ones scatter, curious ones drift closer
    if (toPlayer < this.shy) {
      const ax = this.pos.x - player.x, az = this.pos.y - player.z;
      const l = Math.max(0.001, Math.hypot(ax, az));
      const fx = this.pos.x + (ax / l) * 7, fz = this.pos.y + (az / l) * 7;
      if (onLand(fx, fz)) this.target.set(fx, fz);
      this.state = 'walk';
      this.timer = 1.2;
    } else if (this.curious > 0 && toPlayer < this.curious && toPlayer > 2.2) {
      this.target.set(
        player.x + (this.pos.x - player.x) * 0.28,
        player.z + (this.pos.y - player.z) * 0.28
      );
      this.state = 'walk';
    }

    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.state === 'idle') { this.pickTarget(rnd); this.state = 'walk'; this.timer = 3 + rnd() * 5; }
      else { this.state = 'idle'; this.timer = this.idleMin + rnd() * (this.idleMax - this.idleMin); }
    }

    let moving = 0;
    if (this.state === 'walk') {
      const dx = this.target.x - this.pos.x, dz = this.target.y - this.pos.y;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) { this.state = 'idle'; this.timer = this.idleMin + rnd() * this.idleMax; }
      else {
        const want = Math.atan2(dx, dz);
        let diff = want - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.heading += clamp(diff, -3.2 * dt, 3.2 * dt);
        const sp = this.speed * (toPlayer < this.shy ? 1.9 : 1);
        const nx = this.pos.x + Math.sin(this.heading) * sp * dt;
        const nz = this.pos.y + Math.cos(this.heading) * sp * dt;
        if (onLand(nx, nz)) { this.pos.set(nx, nz); moving = 1; }
        else { this.pickTarget(rnd); }
      }
    }
    this.vel = damp(this.vel, moving, 6, dt);

    const g = heightAt(this.pos.x, this.pos.y);
    let y = g + this.lift;
    if (this.hop > 0) {
      // hopping gait — a clipped sine so they hang in the air a beat
      const k = Math.max(0, Math.sin(t * this.hop + this.phase));
      y += k * 0.28 * this.vel;
      this.mesh.rotation.x = -k * 0.22 * this.vel;
    } else {
      y += Math.sin(t * 6 + this.phase) * 0.02 * this.vel;
      this.mesh.rotation.x = Math.sin(t * 7 + this.phase) * 0.03 * this.vel;
    }
    this.mesh.position.set(this.pos.x, y, this.pos.y);
    this.mesh.rotation.y = this.heading;

    // idle breathing + a curious head-turn toward the player
    const breathe = 1 + Math.sin(t * 2.1 + this.phase) * 0.022 * (1 - this.vel);
    this.mesh.scale.set(this.baseScale, this.baseScale * breathe, this.baseScale);
    if (this.state === 'idle' && toPlayer < 12) {
      const look = Math.atan2(player.x - this.pos.x, player.z - this.pos.y);
      let diff = look - this.mesh.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.mesh.rotation.y += diff * Math.min(1, dt * 1.6);
      this.heading = this.mesh.rotation.y;
    }
  }
}

/* ───────────────────────── the whole menagerie ───────────────────────── */

export class Wildlife {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'wildlife';
    scene.add(this.group);

    this.rnd = makeRandom(24680);
    this.protos = {};
    this.walkers = [];
    this.birds = [];
    this.fish = [];
    this.kodama = [];
    this._tmp = new THREE.Vector3();

    const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.material = mat();
    this.glowMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x5c6b58, emissiveIntensity: 0 });

    for (const key of Object.keys(BUILDERS)) this.protos[key] = BUILDERS[key]();

    this._spawnLand();
    this._spawnBirds();
    this._spawnFish();
    this._spawnKodama();
  }

  _mesh(kind, material = this.material) {
    const m = new THREE.Mesh(this.protos[kind].geo, material);
    m.castShadow = true;
    this.group.add(m);
    return m;
  }

  _findSpot(cx, cz, spread) {
    for (let i = 0; i < 40; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * spread;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (onLand(x, z)) return [x, z];
    }
    return [cx, cz];
  }

  _addWalker(kind, cx, cz, spread, opts) {
    const [x, z] = this._findSpot(cx, cz, spread);
    const mesh = this._mesh(kind, opts.material || this.material);
    const scale = opts.scale || 1;
    mesh.position.set(x, heightAt(x, z), z);
    mesh.scale.setScalar(scale);
    const w = new Walker(mesh, { ...opts, lift: this.protos[kind].lift * scale });
    w.baseScale = scale;
    w.home.set(x, z);
    this.walkers.push(w);
    return w;
  }

  _spawnLand() {
    // a brood of ducklings pottering near the pond's bank
    for (let i = 0; i < 9; i++) {
      this._addWalker('duckling', POND.x - 24, POND.z + 12, 14, {
        speed: 1.0, hop: 7, roam: 11, shy: 3.0, scale: 0.8 + this.rnd() * 0.35,
        idleMin: 0.6, idleMax: 2.4,
      });
    }
    for (let i = 0; i < 4; i++) {
      this._addWalker('cat', 18, 20, 22, {
        speed: 1.25, hop: 0, roam: 20, shy: 0, curious: 16, scale: 0.95 + this.rnd() * 0.25,
        idleMin: 2.5, idleMax: 7,
      });
    }
    for (let i = 0; i < 10; i++) {
      this._addWalker('rabbit', (this.rnd() - 0.5) * 90, (this.rnd() - 0.5) * 90, 16, {
        speed: 2.0, hop: 8.5, roam: 14, shy: 5.5, scale: 0.85 + this.rnd() * 0.35,
        idleMin: 1.2, idleMax: 4,
      });
    }
    for (let i = 0; i < 5; i++) {
      this._addWalker('deer', (this.rnd() - 0.5) * 120, (this.rnd() - 0.5) * 120, 26, {
        speed: 1.5, hop: 0, roam: 30, shy: 7, scale: 0.95 + this.rnd() * 0.3,
        idleMin: 3, idleMax: 9,
      });
    }
    for (let i = 0; i < 4; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = POND.r * (1.12 + this.rnd() * 0.18);   // on the bank, not in it
      this._addWalker('frog', POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, 3, {
        speed: 0.9, hop: 7, roam: 4, shy: 3, scale: 1.0 + this.rnd() * 0.3,
        idleMin: 2, idleMax: 6,
      });
    }
  }

  _spawnBirds() {
    for (let i = 0; i < 18; i++) {
      const m = this._mesh('bird');
      m.castShadow = false;
      const a = this.rnd() * Math.PI * 2;
      this.birds.push({
        mesh: m,
        a, r: 26 + this.rnd() * 58,
        y: 16 + this.rnd() * 16,
        sp: (0.12 + this.rnd() * 0.16) * (this.rnd() < 0.5 ? 1 : -1),
        ph: this.rnd() * 9,
        cx: (this.rnd() - 0.5) * 60, cz: (this.rnd() - 0.5) * 60,
        scale: 0.8 + this.rnd() * 0.6,
      });
      m.scale.setScalar(this.birds[i].scale);
    }
  }

  _spawnFish() {
    for (let i = 0; i < 12; i++) {
      const m = this._mesh('fish');
      m.castShadow = false;
      this.fish.push({
        mesh: m,
        a: this.rnd() * Math.PI * 2,
        r: 3 + this.rnd() * (POND.r * 0.62),
        sp: (0.2 + this.rnd() * 0.35) * (this.rnd() < 0.5 ? 1 : -1),
        ph: this.rnd() * 9,
        jump: 4 + this.rnd() * 14,
        scale: 0.7 + this.rnd() * 0.6,
      });
      m.scale.setScalar(this.fish[i].scale);
    }
  }

  _spawnKodama() {
    for (let i = 0; i < 9; i++) {
      const [x, z] = this._findSpot((this.rnd() - 0.5) * 110, (this.rnd() - 0.5) * 110, 20);
      const m = this._mesh('kodama', this.glowMaterial);
      m.castShadow = false;
      m.position.set(x, heightAt(x, z), z);
      m.scale.setScalar(0.9 + this.rnd() * 0.5);
      m.visible = false;
      this.kodama.push({ mesh: m, x, z, ph: this.rnd() * 9, sp: 0.4 + this.rnd() * 0.5 });
    }
  }

  update(dt, t, playerPos, nightFactor) {
    for (const w of this.walkers) w.update(dt, t, playerPos, this.rnd);

    for (const b of this.birds) {
      b.a += b.sp * dt;
      const x = b.cx + Math.cos(b.a) * b.r;
      const z = b.cz + Math.sin(b.a) * b.r;
      const y = b.y + Math.sin(t * 0.7 + b.ph) * 1.8;
      b.mesh.position.set(x, y, z);
      b.mesh.rotation.y = -b.a + (b.sp > 0 ? Math.PI / 2 : -Math.PI / 2);
      b.mesh.rotation.z = Math.sin(t * 9 + b.ph) * 0.28;      // wingbeat, faked as a roll
      b.mesh.rotation.x = Math.sin(t * 0.9 + b.ph) * 0.1;
      b.mesh.scale.y = b.scale * (1 + Math.sin(t * 9 + b.ph) * 0.16);
    }

    for (const f of this.fish) {
      f.a += f.sp * dt;
      const x = POND.x + Math.cos(f.a) * f.r;
      const z = POND.z + Math.sin(f.a) * f.r;
      f.jump -= dt;
      let y = WATER_LEVEL - 0.35 + Math.sin(t * 1.4 + f.ph) * 0.12;
      let pitch = 0;
      if (f.jump < 0 && f.jump > -0.75) {
        const k = (f.jump + 0.75) / 0.75;           // 1 → 0 over the arc
        const arc = Math.sin(k * Math.PI);
        y += arc * 1.1;
        pitch = Math.cos(k * Math.PI) * 0.9;
      } else if (f.jump <= -0.75) {
        f.jump = 8 + Math.random() * 16;
      }
      f.mesh.position.set(x, y, z);
      f.mesh.rotation.set(pitch, -f.a + (f.sp > 0 ? Math.PI : 0), Math.sin(t * 4 + f.ph) * 0.2);
    }

    const glow = clamp(nightFactor, 0, 1);
    this.glowMaterial.emissiveIntensity = glow * 0.8;
    for (const k of this.kodama) {
      k.mesh.visible = glow > 0.05;
      if (!k.mesh.visible) continue;
      const bob = Math.sin(t * k.sp * 2 + k.ph);
      k.mesh.position.y = heightAt(k.x, k.z) + 0.05 + bob * 0.06;
      // the little head-rattle kodama are known for
      k.mesh.rotation.y = Math.sin(t * k.sp * 3 + k.ph) * 0.9;
      k.mesh.rotation.z = Math.sin(t * k.sp * 7 + k.ph) * 0.06;
    }
  }
}
