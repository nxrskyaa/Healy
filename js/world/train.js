import * as THREE from 'three';
import { makeRandom, clamp, smoothstep } from './noise.js';
import { heightAt } from './terrain.js';

/* ═══════════════════════════════════════════════════════════
   The railway. A single line crosses the valley's north side
   on a low embankment; every minute or so a small steam train
   works its way over it, trailing smoke. It never stops here —
   this station closed years ago — which is rather the point.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* ───────────── the line ─────────────
   A gentle S across the north, x from -190 to 190. The rail
   height is the terrain along the path, heavily smoothed, so
   the embankment rises and falls with the land instead of
   ruling a dead-straight line through it. */

const N_PTS = 240;
const PTS = [];

function pathXZ(t) {
  const x = -190 + t * 380;
  const z = -86 + Math.sin(t * 2.6 + 0.4) * 13 - Math.sin(t * 5.9) * 4;
  return [x, z];
}

(function buildPath() {
  // raw ground heights along the line
  const raw = [];
  for (let i = 0; i < N_PTS; i++) {
    const [x, z] = pathXZ(i / (N_PTS - 1));
    raw.push(heightAt(x, z));
  }
  // two passes of a wide box blur = the grade a railway engineer would cut
  for (let pass = 0; pass < 2; pass++) {
    const cp = raw.slice();
    const W = 22;
    for (let i = 0; i < N_PTS; i++) {
      let s = 0, n = 0;
      for (let j = -W; j <= W; j++) {
        const k = Math.min(N_PTS - 1, Math.max(0, i + j));
        s += cp[k]; n++;
      }
      raw[i] = s / n;
    }
  }
  let arc = 0;
  for (let i = 0; i < N_PTS; i++) {
    const [x, z] = pathXZ(i / (N_PTS - 1));
    if (i > 0) arc += Math.hypot(x - PTS[i - 1].x, z - PTS[i - 1].z);
    PTS.push({ x, z, y: raw[i] + 1.35, s: arc });
  }
  PTS.total = arc;
})();

/** position + tangent at an arc length (metres along the line) */
function sampleAt(s) {
  s = clamp(s, 0, PTS.total);
  let lo = 0, hi = N_PTS - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (PTS[m].s <= s) lo = m; else hi = m;
  }
  const a = PTS[lo], b = PTS[hi];
  const k = (s - a.s) / Math.max(1e-5, b.s - a.s);
  const x = a.x + (b.x - a.x) * k;
  const y = a.y + (b.y - a.y) * k;
  const z = a.z + (b.z - a.z) * k;
  const tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x, y, z, tx: (b.x - a.x) / tl, tz: (b.z - a.z) / tl };
}

/* ───────────── track & embankment ───────────── */

function buildEmbankment() {
  const pos = [], col = [], idx = [];
  const cGravel = new THREE.Color('#9a9080');
  const cGrass = new THREE.Color('#71904f');
  const c = new THREE.Color();

  // cross-section: grass toe → shoulder → gravel bed → gravel bed → shoulder → toe
  const XS = [
    { off: -5.2, lift: -1e9, tint: cGrass, dim: 0.85 },   // toe follows terrain
    { off: -2.4, lift: -0.28, tint: cGrass, dim: 0.95 },
    { off: -1.55, lift: 0.0, tint: cGravel, dim: 1.0 },
    { off: 1.55, lift: 0.0, tint: cGravel, dim: 1.0 },
    { off: 2.4, lift: -0.28, tint: cGrass, dim: 0.95 },
    { off: 5.2, lift: -1e9, tint: cGrass, dim: 0.85 },
  ];

  const rows = 120;
  for (let i = 0; i <= rows; i++) {
    const p = sampleAt((i / rows) * PTS.total);
    const nx = -p.tz, nz = p.tx;
    for (let j = 0; j < XS.length; j++) {
      const q = XS[j];
      const x = p.x + nx * q.off;
      const z = p.z + nz * q.off;
      const y = q.lift < -1e8 ? heightAt(x, z) + 0.05 : p.y - 0.42 + q.lift;
      pos.push(x, y, z);
      c.copy(q.tint).multiplyScalar(q.dim * (0.92 + ((i * 7 + j * 13) % 10) * 0.012));
      col.push(c.r, c.g, c.b);
    }
  }
  const w = XS.length;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < w - 1; j++) {
      const a = i * w + j, b = a + 1, cN = a + w, d = cN + 1;
      idx.push(a, cN, b, b, cN, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildTrack() {
  const group = new THREE.Group();

  // sleepers
  const nSleepers = Math.floor(PTS.total / 0.85);
  const sleeperGeo = new THREE.BoxGeometry(0.24, 0.12, 2.0);
  const sleepers = new THREE.InstancedMesh(
    sleeperGeo, new THREE.MeshLambertMaterial({ color: '#4a3c30' }), nSleepers);
  const d = new THREE.Object3D();
  for (let i = 0; i < nSleepers; i++) {
    const p = sampleAt(i * 0.85);
    d.position.set(p.x, p.y - 0.4, p.z);
    d.rotation.y = Math.atan2(p.tx, p.tz);
    d.updateMatrix();
    sleepers.setMatrixAt(i, d.matrix);
  }
  sleepers.instanceMatrix.needsUpdate = true;
  group.add(sleepers);

  // rails: chained segments, instanced
  const segLen = 3.0;
  const nSegs = Math.floor(PTS.total / segLen);
  const railGeo = new THREE.BoxGeometry(0.09, 0.16, segLen * 1.04);
  const railMat = new THREE.MeshLambertMaterial({ color: '#6e6a62' });
  const rails = new THREE.InstancedMesh(railGeo, railMat, nSegs * 2);
  let k = 0;
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < nSegs; i++) {
      const s0 = i * segLen, s1 = Math.min(PTS.total, s0 + segLen);
      const a = sampleAt(s0), b = sampleAt(s1);
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = (a.y + b.y) / 2;
      const nx = -a.tz, nz = a.tx;
      d.position.set(mx + nx * 0.75 * side, my - 0.26, mz + nz * 0.75 * side);
      d.rotation.set(0, Math.atan2(b.x - a.x, b.z - a.z), 0);
      // pitch the segment to follow the grade
      const run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      d.rotation.x = -Math.atan2(b.y - a.y, run);
      d.updateMatrix();
      rails.setMatrixAt(k++, d.matrix);
    }
  }
  rails.instanceMatrix.needsUpdate = true;
  group.add(rails);

  return group;
}

/* ───────────── the train itself ───────────── */

/* A locomotive is the one thing in this valley that is genuinely made of
   metal, and metal is exactly what Lambert cannot do: no specular, no
   environment, so a boiler came out looking like painted card. With the sky
   prefiltered into an environment map, giving these real metalness and
   roughness is most of what makes the train read as machinery. */
const M = {
  boiler:    new THREE.MeshStandardMaterial({ color: '#2b333c', metalness: 0.85, roughness: 0.42 }),
  boilerLit: new THREE.MeshStandardMaterial({ color: '#3d4650', metalness: 0.8,  roughness: 0.34 }),
  livery:    new THREE.MeshStandardMaterial({ color: '#7e3a34', metalness: 0.25, roughness: 0.55 }),
  brass:     new THREE.MeshStandardMaterial({ color: '#a8894a', metalness: 1.0,  roughness: 0.28 }),
  wheel:     new THREE.MeshStandardMaterial({ color: '#1d2126', metalness: 0.9,  roughness: 0.5 }),
  carBody:   new THREE.MeshStandardMaterial({ color: '#3c6152', metalness: 0.2,  roughness: 0.62 }),
  carBand:   new THREE.MeshStandardMaterial({ color: '#d8cdb2', metalness: 0.15, roughness: 0.7 }),
  carWin:    new THREE.MeshBasicMaterial({ color: '#ffe9b2' }),
  roof:      new THREE.MeshStandardMaterial({ color: '#2e3238', metalness: 0.6,  roughness: 0.66 }),
};

function buildLoco() {
  const g = new THREE.Group();
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 3.0, 14), M.boilerLit);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 1.28, 0.5);
  const smokebox = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.5, 14), M.boiler);
  smokebox.rotation.x = Math.PI / 2;
  smokebox.position.set(0, 1.28, 2.1);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.62, 10), M.boiler);
  chimney.position.set(0, 2.1, 2.05);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), M.brass);
  dome.scale.y = 0.7;
  dome.position.set(0, 1.92, 0.7);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.7, 1.5), M.livery);
  cab.position.set(0, 1.65, -1.55);
  const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.12, 1.8), M.roof);
  cabRoof.position.set(0, 2.56, -1.55);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 4.6), M.boiler);
  frame.position.set(0, 0.62, 0);
  const cow = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.6), M.livery);
  cow.position.set(0, 0.52, 2.5);
  cow.rotation.x = 0.5;
  g.add(boiler, smokebox, chimney, dome, cab, cabRoof, frame, cow);

  const wheels = [];
  for (const [wz, r] of [[1.5, 0.42], [0.45, 0.55], [-0.7, 0.55], [-1.8, 0.42]]) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.14, 14), M.wheel);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 0.72, r - 0.02, wz);
      g.add(w);
      wheels.push(w);
    }
  }
  g.userData.wheels = wheels;
  g.userData.chimney = chimney;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function buildCoach() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.5, 5.2), M.carBody);
  body.position.y = 1.45;
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.42, 5.24), M.carBand);
  band.position.y = 1.72;
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 5.3, 10, 1, false, 0, Math.PI), M.roof);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.set(1, 0.28, 1);
  roof.position.y = 2.2;
  g.add(body, band, roof);
  // window strip — glows after dark
  for (let i = -2; i <= 2; i++) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), M.carWin);
      w.position.set(side * 0.83, 1.72, i * 0.95);
      w.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(w);
    }
  }
  for (const wz of [1.7, -1.7]) {
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.12, 12), M.wheel);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * 0.72, 0.3, wz);
      g.add(w);
    }
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function smokeTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(244,238,228,0.9)');
  g.addColorStop(0.55, 'rgba(226,220,216,0.42)');
  g.addColorStop(1, 'rgba(220,214,214,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ───────────── the system ───────────── */

const CYCLE = 82;        // seconds between departures
const SPEED = 11.5;      // m/s across the valley
const CARS = 3;
const CAR_GAP = 6.1;

export class Railway {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'railway';
    this.group.add(buildEmbankment(), buildTrack());

    this.loco = buildLoco();
    this.cars = [];
    for (let i = 0; i < CARS; i++) {
      const c = buildCoach();
      this.cars.push(c);
      this.group.add(c);
    }
    this.group.add(this.loco);
    scene.add(this.group);

    // smoke pool
    this.smokeMat = new THREE.SpriteMaterial({
      map: smokeTexture(), transparent: true, depthWrite: false, opacity: 0.8,
    });
    this.puffs = [];
    for (let i = 0; i < 46; i++) {
      const s = new THREE.Sprite(this.smokeMat.clone());
      s.visible = false;
      this.group.add(s);
      this.puffs.push({ s, age: 9, life: 1, drift: 0 });
    }
    this._puffIdx = 0;
    this._puffAcc = 0;
    this._rnd = makeRandom(4321);
    this._whistled = false;

    this.active = false;
    this.dist = 1e4;
    this.pan = 0;
    this.speedNorm = 0;
    this.chuffPhase = 0;
    this.onChuff = null;    // set by main: (strength) => audio.chuff(...)
    this.onWhistle = null;

    this._setVisible(false);
  }

  _setVisible(v) {
    this.loco.visible = v;
    for (const c of this.cars) c.visible = v;
  }

  _place(obj, s) {
    const p = sampleAt(s);
    obj.position.set(p.x, p.y - 0.36, p.z);
    obj.rotation.y = Math.atan2(p.tx, p.tz);
    return p;
  }

  update(dt, elapsed, camera, nightFactor) {
    const tCycle = elapsed % CYCLE;
    const crossTime = (PTS.total + 60) / SPEED;
    this.active = tCycle < crossTime;

    if (!this.active) {
      this._setVisible(false);
      this.dist = 1e4;
      this.speedNorm = 0;
      this._whistled = false;
    } else {
      this._setVisible(true);
      const head = tCycle * SPEED - 20;      // start just off the west end

      // ease in and out at the ends of the crossing
      const eased = smoothstep(0, 30, head + 20) * smoothstep(PTS.total + 40, PTS.total - 10, head);
      this.speedNorm = clamp(eased, 0, 1);

      const p = this._place(this.loco, clamp(head, 0, PTS.total));
      for (let i = 0; i < CARS; i++) {
        this._place(this.cars[i], clamp(head - (i + 1) * CAR_GAP - 1.2, 0, PTS.total));
      }

      // wheels
      const wheelRate = SPEED * this.speedNorm / 0.55;
      for (const w of this.loco.userData.wheels) w.rotation.x += wheelRate * dt;

      // audio hooks
      const toCam = new THREE.Vector3().subVectors(this.loco.position, camera.position);
      this.dist = toCam.length();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      this.pan = clamp((right.x * toCam.x + right.z * toCam.z) / Math.max(1, this.dist), -0.9, 0.9);

      // four chuffs per wheel revolution, softer as it coasts
      this.chuffPhase += wheelRate * dt / TAU * 4;
      if (this.chuffPhase >= 1) {
        this.chuffPhase %= 1;
        if (this.onChuff && this.dist < 320) {
          this.onChuff(clamp(0.5 + this.speedNorm * 0.5, 0, 1));
        }
      }
      if (!this._whistled && head > PTS.total * 0.22) {
        this._whistled = true;
        if (this.onWhistle) this.onWhistle();
      }

      // smoke: puff on the chuff rhythm
      this._puffAcc += dt * (2.2 + this.speedNorm * 5.5);
      while (this._puffAcc > 1) {
        this._puffAcc -= 1;
        const P = this.puffs[this._puffIdx++ % this.puffs.length];
        const ch = this.loco.userData.chimney.getWorldPosition(new THREE.Vector3());
        P.s.visible = true;
        P.s.position.copy(ch);
        P.age = 0;
        P.life = 3.2 + this._rnd() * 2.0;
        P.drift = (this._rnd() - 0.5) * 0.8;
        P.scale0 = 1.1 + this._rnd() * 0.7;
      }

      // window glow at night
      M.carWin.color.setHex(0xffe9b2).multiplyScalar(0.25 + nightFactor * 0.75);
    }

    // smoke always finishes its life, even after the train has gone
    for (const P of this.puffs) {
      if (!P.s.visible) continue;
      P.age += dt;
      const u = P.age / P.life;
      if (u >= 1) { P.s.visible = false; continue; }
      P.s.position.y += dt * (1.6 - u * 0.9);
      P.s.position.x += dt * (0.6 + P.drift);
      P.s.position.z += dt * 0.3;
      const sc = P.scale0 * (0.6 + u * 3.4);
      P.s.scale.set(sc, sc, 1);
      P.s.material.opacity = 0.72 * (1 - u) * (0.4 + 0.6 * smoothstep(0, 0.12, u));
    }
  }
}
