import * as THREE from 'three';
import { heightAt, POND, WATER_LEVEL, WORLD_SIZE } from './terrain.js';
import { clamp, damp } from './noise.js';

/* ═══════════════════════════════════════════════════════════
   The wanderer: a small figure in a straw hat, plus the
   third-person camera that trails politely behind them.
   ═══════════════════════════════════════════════════════════ */

const L = (color, opts = {}) => new THREE.MeshLambertMaterial({ color, ...opts });

const SKIN  = L('#f0cba4');
const HAIR  = L('#3d2f2a');
const CLOAK = L('#d98f4e');
const SHIRT = L('#f2ead6');
const PANTS = L('#5c6f7a');
const STRAW = L('#e3c579');
const SCARF = L('#c25b4e');
const DARK  = L('#241f22');
const BOOT  = L('#6d4f3a');

function limb(mat, w, h, d) {
  const g = new THREE.CapsuleGeometry(w, h, 3, 7);
  const m = new THREE.Mesh(g, mat);
  m.scale.z = d;
  m.castShadow = true;
  return m;
}

export function createCharacter() {
  const root = new THREE.Group();
  root.name = 'player';

  const hips = new THREE.Group();
  hips.position.y = 0.62;
  root.add(hips);

  // torso: a soft cone reads as a little cloak
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.62, 10), SHIRT);
  torso.position.y = 0.3;
  torso.castShadow = true;
  hips.add(torso);

  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.44, 0.78, 12, 1, true), CLOAK);
  cloak.position.y = 0.26;
  cloak.castShadow = true;
  hips.add(cloak);
  cloak.material.side = THREE.DoubleSide;

  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.055, 6, 14), SCARF);
  scarf.rotation.x = Math.PI / 2;
  scarf.position.y = 0.6;
  hips.add(scarf);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.05), SCARF);
  tail.position.set(0.1, 0.44, -0.16);
  hips.add(tail);

  // head
  const neck = new THREE.Group();
  neck.position.y = 0.66;
  hips.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.235, 16, 14), SKIN);
  head.scale.set(1, 1.05, 0.96);
  head.castShadow = true;
  neck.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.245, 16, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), HAIR);
  hair.position.y = 0.02;
  neck.add(hair);
  const fringe = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), HAIR);
  fringe.scale.set(1.08, 0.5, 0.7);
  fringe.position.set(0, 0.12, 0.09);
  neck.add(fringe);

  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.031, 8, 8), DARK);
    eye.position.set(0.082 * s, 0.01, 0.215);
    eye.scale.set(0.8, 1.25, 0.6);
    neck.add(eye);
    const blush = new THREE.Mesh(new THREE.CircleGeometry(0.045, 10), L('#e79a95', { transparent: true, opacity: 0.55 }));
    blush.position.set(0.145 * s, -0.05, 0.185);
    blush.rotation.y = 0.4 * s;
    neck.add(blush);
  }

  // straw hat
  const hat = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.14, 16), STRAW);
  brim.position.y = 0.2;
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), STRAW);
  crown.position.y = 0.21;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.022, 6, 16), SCARF);
  band.rotation.x = Math.PI / 2;
  band.position.y = 0.235;
  hat.add(brim, crown, band);
  hat.position.y = 0.06;
  brim.castShadow = true;
  neck.add(hat);

  // limbs
  const armL = limb(SKIN, 0.062, 0.28, 1);
  const armR = limb(SKIN, 0.062, 0.28, 1);
  const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.24, 8), CLOAK);
  const sleeveR = sleeveL.clone();
  const shoulderL = new THREE.Group(); shoulderL.position.set(-0.29, 0.52, 0);
  const shoulderR = new THREE.Group(); shoulderR.position.set(0.29, 0.52, 0);
  armL.position.y = -0.22; armR.position.y = -0.22;
  sleeveL.position.y = -0.09; sleeveR.position.y = -0.09;
  shoulderL.add(armL, sleeveL);
  shoulderR.add(armR, sleeveR);
  hips.add(shoulderL, shoulderR);

  const legL = limb(PANTS, 0.075, 0.3, 1);
  const legR = limb(PANTS, 0.075, 0.3, 1);
  const hipL = new THREE.Group(); hipL.position.set(-0.12, 0.0, 0);
  const hipR = new THREE.Group(); hipR.position.set(0.12, 0.0, 0);
  legL.position.y = -0.24; legR.position.y = -0.24;
  const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.25), BOOT);
  const bootR = bootL.clone();
  bootL.position.set(0, -0.46, 0.04); bootR.position.set(0, -0.46, 0.04);
  bootL.castShadow = true; bootR.castShadow = true;
  hipL.add(legL, bootL);
  hipR.add(legR, bootR);
  hips.add(hipL, hipR);

  root.userData = { hips, neck, hat, shoulderL, shoulderR, hipL, hipR, cloak, scarfTail: tail };
  return root;
}

/* ───────────────────────── controller ───────────────────────── */

const HALF = WORLD_SIZE / 2 - 12;

export class Player {
  constructor(scene, camera) {
    this.mesh = createCharacter();
    scene.add(this.mesh);
    this.camera = camera;

    this.pos = new THREE.Vector3(0, 0, 8);
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.vy = 0;
    this.onGround = true;
    this.facing = Math.PI;
    this.speed = 0;
    this.stride = 0;
    this.sitting = false;
    this.sitBlend = 0;

    this.yaw = Math.PI;
    this.pitch = 0.28;
    this.dist = 7.5;
    this._camPos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._first = true;

    this.splashCallback = null;
    this._stepTimer = 0;
  }

  reset() {
    this.pos.set(0, heightAt(0, 8), 8);
    this.vy = 0;
    this.yaw = Math.PI;
    this.pitch = 0.28;
    this.dist = 7.5;
    this.sitting = false;
    this._first = true;
  }

  toggleSit() { this.sitting = !this.sitting; return this.sitting; }

  update(dt, t, input) {
    // ── look ──────────────────────────────────────────────
    this.yaw -= input.look.x * 0.0032;
    this.pitch = clamp(this.pitch + input.look.y * 0.0026, -0.5, 1.15);
    this.dist = clamp(this.dist + input.zoom * 0.0075, 3.2, 17);
    input.consumeLook();

    // ── move ──────────────────────────────────────────────
    let mx = input.move.x, mz = input.move.y;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    const moving = mag > 0.08 && !this.sitting;

    const run = input.run ? 1 : 0;
    const maxSpeed = moving ? (run ? 6.6 : 3.1) * Math.min(1, mag * 1.35) : 0;
    this.speed = damp(this.speed, maxSpeed, 8, dt);

    if (moving) {
      // camera-relative: forward is where you're looking
      const fwd = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
      const right = new THREE.Vector2(fwd.y, -fwd.x);
      const dir = new THREE.Vector2(
        fwd.x * mz + right.x * mx,
        fwd.y * mz + right.y * mx
      ).normalize();

      const want = Math.atan2(dir.x, dir.y);
      let diff = want - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 11);

      const nx = this.pos.x + dir.x * this.speed * dt;
      const nz = this.pos.z + dir.y * this.speed * dt;
      if (this._passable(nx, this.pos.z)) this.pos.x = nx;
      if (this._passable(this.pos.x, nz)) this.pos.z = nz;
    }

    // ── gravity ───────────────────────────────────────────
    const ground = heightAt(this.pos.x, this.pos.z);
    if (input.jumpPressed && this.onGround && !this.sitting) {
      this.vy = 6.4;
      this.onGround = false;
    }
    input.consumeJump();

    this.vy -= 18 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      if (!this.onGround && this.splashCallback) this.splashCallback(this.pos.clone(), 1);
      this.pos.y = ground;
      this.vy = 0;
      this.onGround = true;
    }

    // ── footsteps ─────────────────────────────────────────
    if (this.onGround && this.speed > 0.4) {
      this._stepTimer -= dt * this.speed;
      if (this._stepTimer <= 0) {
        this._stepTimer = 1.7;
        if (this.splashCallback) this.splashCallback(this.pos, 0.35);
      }
    }

    this._animate(dt, t);
    this._camera(dt);
  }

  _passable(x, z) {
    if (Math.abs(x) > HALF || Math.abs(z) > HALF) return false;
    const pd = Math.hypot(x - POND.x, z - POND.z);
    // you can paddle at the very edge, but not swim off into the deep
    if (pd < POND.r * 0.94 && heightAt(x, z) < WATER_LEVEL - 0.55) return false;
    return true;
  }

  _animate(dt, t) {
    const u = this.mesh.userData;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.facing;

    this.sitBlend = damp(this.sitBlend, this.sitting ? 1 : 0, 7, dt);
    const sit = this.sitBlend;

    const run = clamp(this.speed / 6.6, 0, 1);
    this.stride += dt * (2.6 + this.speed * 2.0);
    const sw = Math.sin(this.stride) * clamp(this.speed / 3.0, 0, 1.25);
    const air = this.onGround ? 0 : 1;

    u.hipL.rotation.x = (-sw * 0.72) * (1 - sit) - air * 0.5 - sit * 1.5;
    u.hipR.rotation.x = (sw * 0.72) * (1 - sit) - air * 0.25 - sit * 1.5;
    u.hipL.rotation.z = sit * 0.12;
    u.hipR.rotation.z = -sit * 0.12;

    u.shoulderL.rotation.x = (sw * 0.62) * (1 - sit) - air * 0.9 - sit * 0.35;
    u.shoulderR.rotation.x = (-sw * 0.62) * (1 - sit) - air * 0.9 - sit * 0.35;
    u.shoulderL.rotation.z = 0.14 + run * 0.1 + sit * 0.25;
    u.shoulderR.rotation.z = -0.14 - run * 0.1 - sit * 0.25;

    const bob = Math.abs(Math.sin(this.stride)) * 0.055 * clamp(this.speed / 3, 0, 1.2);
    u.hips.position.y = 0.62 + bob - sit * 0.42 + Math.sin(t * 1.8) * 0.012 * (1 - run);
    u.hips.rotation.x = run * 0.14 + sit * 0.16;
    u.hips.rotation.z = Math.sin(this.stride) * 0.045 * run;

    u.neck.rotation.x = -run * 0.1 + Math.sin(t * 1.4) * 0.02 + sit * 0.1;
    u.neck.rotation.z = Math.sin(t * 0.9) * 0.03;
    u.hat.rotation.z = Math.sin(t * 2.2) * 0.02 + run * 0.03;
    u.scarfTail.rotation.x = -0.3 - run * 0.9 - Math.sin(t * 6) * 0.15 * run;
    u.cloak.rotation.x = run * 0.06;
  }

  _camera(dt) {
    const target = this._look.set(this.pos.x, this.pos.y + 1.35, this.pos.z);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const desired = this._camPos.set(
      target.x - Math.sin(this.yaw) * cp * this.dist,
      target.y + sp * this.dist + 0.4,
      target.z - Math.cos(this.yaw) * cp * this.dist
    );

    // never let the camera burrow into a hill
    const g = heightAt(desired.x, desired.z) + 1.1;
    if (desired.y < g) desired.y = g;

    if (this._first) { this.camera.position.copy(desired); this._first = false; }
    else {
      this.camera.position.x = damp(this.camera.position.x, desired.x, 9, dt);
      this.camera.position.y = damp(this.camera.position.y, desired.y, 7, dt);
      this.camera.position.z = damp(this.camera.position.z, desired.z, 9, dt);
    }
    this.camera.lookAt(target);
  }
}
