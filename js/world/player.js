import * as THREE from 'three';
import { heightAt, POND, WATER_LEVEL, WORLD_SIZE } from './terrain.js';
import { clamp, damp } from './noise.js';

/* ═══════════════════════════════════════════════════════════
   The wanderer: a small figure in a straw hat, plus the
   third-person camera that trails politely behind them.
   ═══════════════════════════════════════════════════════════ */

const L = (color) => new THREE.MeshLambertMaterial({ color });

// One muted palette, nothing saturated: the figure should sit in the
// landscape like a brushstroke, not float on it like a toy.
const SKIN  = L('#d9b18c');
const HAIR  = L('#2e2622');
const CLOAK = L('#5a6577');
const INNER = L('#e5dcc6');
const PANTS = L('#3f444c');
const STRAW = L('#c2a568');
const BAND  = L('#8a4f3d');
const BOOT  = L('#4a3d33');

function limb(mat, w, h) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(w, h, 4, 10), mat);
  m.castShadow = true;
  return m;
}

export function createCharacter() {
  const root = new THREE.Group();
  root.name = 'player';

  const hips = new THREE.Group();
  hips.position.y = 0.62;
  root.add(hips);

  /* The cloak is one smooth lathe: shoulders flowing out to a soft A-line
     hem. A single continuous silhouette is what earlier versions lacked —
     they were a stack of primitives, and read as one. */
  const prof = [];
  const P = [
    [0.001, 1.02], [0.11, 1.015], [0.155, 0.97], [0.185, 0.86],
    [0.21, 0.68], [0.25, 0.46], [0.30, 0.24], [0.345, 0.06], [0.355, 0.02],
  ];
  for (const [x, y] of P) prof.push(new THREE.Vector2(x, y));
  const cloak = new THREE.Mesh(new THREE.LatheGeometry(prof, 20), CLOAK);
  cloak.castShadow = true;
  hips.add(cloak);

  // inner collar — one quiet accent, no more
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.115, 0.15, 0.1, 12, 1, true), INNER);
  collar.position.y = 1.0;
  hips.add(collar);

  // satchel strap across the body, bag on the left hip
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.02, 5, 22, Math.PI * 1.05), BOOT);
  strap.rotation.set(0.12, 0.25, 2.15);
  strap.position.y = 0.62;
  hips.add(strap);
  const bag = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.14, 0.09), BOOT);
  bag.position.set(-0.3, 0.28, -0.02);
  bag.rotation.z = 0.15;
  bag.castShadow = true;
  hips.add(bag);

  // head
  const neck = new THREE.Group();
  neck.position.y = 1.14;
  hips.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.185, 18, 14), SKIN);
  head.scale.set(0.96, 1.04, 0.94);
  head.castShadow = true;
  neck.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.195, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.58), HAIR);
  hair.position.y = 0.015;
  hair.rotation.x = -0.12;
  neck.add(hair);
  // low ponytail, tucked under the hat
  const tailHair = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.16, 3, 8), HAIR);
  tailHair.position.set(0, -0.06, -0.19);
  tailHair.rotation.x = 0.5;
  neck.add(tailHair);

  // eyes only — a face at eight metres is two dark strokes, nothing else
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.02, 2, 6), HAIR);
    eye.position.set(0.068 * s, 0.005, 0.168);
    neck.add(eye);
  }

  // kasa: one wide shallow cone, a band, a top knot. Nothing shiny.
  const hat = new THREE.Group();
  const brim = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.17, 22, 1, true), STRAW);
  brim.material = STRAW.clone();
  brim.material.side = THREE.DoubleSide;
  brim.castShadow = true;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), STRAW);
  knob.position.y = 0.1;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.415, 0.42, 0.028, 22, 1, true), BAND);
  band.position.y = -0.055;
  hat.add(brim, knob, band);
  hat.position.y = 0.21;
  hat.rotation.x = 0.07;
  neck.add(hat);

  // arms: sleeves that belong to the cloak, small hands
  const mkArm = () => {
    const g = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.34, 10), CLOAK);
    sleeve.position.y = -0.16;
    sleeve.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.042, 8, 8), SKIN);
    hand.position.y = -0.35;
    g.add(sleeve, hand);
    return g;
  };
  const shoulderL = new THREE.Group(); shoulderL.position.set(-0.235, 0.96, 0);
  const shoulderR = new THREE.Group(); shoulderR.position.set(0.235, 0.96, 0);
  shoulderL.add(mkArm());
  shoulderR.add(mkArm());
  shoulderL.rotation.z = 0.22;
  shoulderR.rotation.z = -0.22;
  hips.add(shoulderL, shoulderR);

  // legs: slim, dark, quiet
  const mkLeg = () => {
    const g = new THREE.Group();
    const leg = limb(PANTS, 0.052, 0.3);
    leg.position.y = -0.26;
    const boot = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.09, 3, 8), BOOT);
    boot.rotation.x = Math.PI / 2;
    boot.position.set(0, -0.55, 0.045);
    boot.castShadow = true;
    g.add(leg, boot);
    return g;
  };
  const hipL = new THREE.Group(); hipL.position.set(-0.1, 0.0, 0);
  const hipR = new THREE.Group(); hipR.position.set(0.1, 0.0, 0);
  hipL.add(mkLeg());
  hipR.add(mkLeg());
  hips.add(hipL, hipR);

  // the animator expects a scarfTail; give it the ponytail so the same
  // run-flutter code moves the hair instead
  root.userData = { hips, neck, hat, shoulderL, shoulderR, hipL, hipR, cloak, scarfTail: tailHair };
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
    this.stepCallback = null;
    this.firstPerson = false;
    this._stepTimer = 0;
  }

  toggleView() {
    this.firstPerson = !this.firstPerson;
    this.mesh.visible = !this.firstPerson;
    if (!this.firstPerson) this._first = true;   // snap the chase camera back
    return this.firstPerson;
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
    this.pitch = clamp(this.pitch + input.look.y * 0.0026,
      this.firstPerson ? -1.2 : -0.5, 1.15);
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
        if (this.stepCallback) this.stepCallback(this.speed);
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
    u.scarfTail.rotation.x = 0.5 + run * 0.6 + Math.sin(t * 6) * 0.15 * run;
    u.cloak.rotation.x = run * 0.06;
    // the hem swings a beat behind the stride
    u.cloak.rotation.z = Math.sin(this.stride - 0.6) * 0.05 * run;
  }

  _camera(dt) {
    if (this.firstPerson) {
      // eyes in the head: no chase, no smoothing lag on the body itself
      const bob = this.onGround
        ? Math.abs(Math.sin(this.stride)) * 0.05 * clamp(this.speed / 3, 0, 1.2)
        : 0;
      this.camera.position.set(
        this.pos.x, this.pos.y + 1.5 + bob - this.sitBlend * 0.45, this.pos.z);
      // dragging up tilts the view up in both modes: the chase camera reads
      // pitch as its own height, the eyes read it inverted
      const cp = Math.cos(this.pitch), sp = Math.sin(-this.pitch);
      this._look.set(
        this.pos.x + Math.sin(this.yaw) * cp,
        this.camera.position.y + sp,
        this.pos.z + Math.cos(this.yaw) * cp
      );
      this.camera.lookAt(this._look);
      return;
    }

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
