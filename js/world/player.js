import * as THREE from 'three';
import { heightAt, POND, WATER_LEVEL, WORLD_SIZE } from './terrain.js';
import { clamp, damp } from './noise.js';

/* ═══════════════════════════════════════════════════════════
   The wanderer: a round little islander with a frangipani in
   her hair, plus the third-person camera that trails politely
   behind — or her own eyes, if you press V.
   ═══════════════════════════════════════════════════════════ */

const L = (color) => new THREE.MeshLambertMaterial({ color });

const SKIN   = L('#e3b68c');
const HAIR   = L('#241d19');
const TOP    = L('#f2ead8');       // white kebaya
const SARONG = L('#8c4436');       // terracotta wrap
const SASH   = L('#c9992e');       // gold waist sash
const PETAL  = L('#f6f1e2');
const PISTIL = L('#e4b33c');

export function createCharacter() {
  const root = new THREE.Group();
  root.name = 'player';

  /* A round little islander. The whole figure is three readable shapes —
     head, white top, terracotta sarong — with everything else kept to
     accents. Chibi proportions: the head is nearly a third of the height,
     which is what makes a figure at eight metres read as a character
     instead of a mannequin. */

  const hips = new THREE.Group();
  hips.position.y = 0.5;
  root.add(hips);

  // sarong: one smooth wrap from waist to ankle, gold band at the waist
  const prof = [];
  for (const [x, y] of [
    [0.20, 0.16], [0.225, 0.06], [0.235, -0.10], [0.235, -0.26],
    [0.225, -0.38], [0.205, -0.45], [0.14, -0.47], [0.02, -0.475],
  ]) prof.push(new THREE.Vector2(x, y));
  const cloak = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), SARONG);
  cloak.castShadow = true;
  hips.add(cloak);

  const sashBand = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.225, 0.09, 16), SASH);
  sashBand.position.y = 0.17;
  hips.add(sashBand);
  // sash tail — the animator flutters this while running
  const sashTail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.02), SASH);
  sashTail.position.set(0.05, 0.02, -0.22);
  sashTail.rotation.x = 0.14;
  hips.add(sashTail);

  // white top: a soft rounded torso
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.21, 16, 12), TOP);
  torso.scale.set(1, 1.15, 0.9);
  torso.position.y = 0.34;
  torso.castShadow = true;
  hips.add(torso);

  // head: big, round, simple
  const neck = new THREE.Group();
  neck.position.y = 0.62;
  hips.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 20, 16), SKIN);
  head.scale.set(1, 0.98, 0.98);
  head.position.y = 0.16;
  head.castShadow = true;
  neck.add(head);

  // bob haircut: the fringe stops above the eyes — a face that is all hair
  // is no face at all
  const hairCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.285, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), HAIR);
  hairCap.position.y = 0.17;
  hairCap.rotation.x = 0.1;
  neck.add(hairCap);
  // the back and sides fall lower than the fringe
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.282, 18, 12, Math.PI * 0.7, Math.PI * 1.6, 0, Math.PI * 0.68), HAIR);
  hairBack.position.set(0, 0.17, -0.01);
  neck.add(hairBack);

  // small bun, high on the back — doubles as the "hat" for the idle wobble
  const hat = new THREE.Group();
  const bun = new THREE.Mesh(new THREE.SphereGeometry(0.095, 12, 10), HAIR);
  bun.scale.set(1, 0.85, 1);
  const bunTie = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 14), SASH);
  bunTie.rotation.x = Math.PI / 2;
  bunTie.position.y = -0.055;
  hat.add(bun, bunTie);
  hat.position.set(0, 0.4, -0.13);
  neck.add(hat);

  // frangipani tucked over the right ear
  const flower = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const petal = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), PETAL);
    petal.scale.set(1, 0.45, 0.62);
    const a = (i / 5) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.038, 0, Math.sin(a) * 0.038);
    petal.rotation.y = -a;
    flower.add(petal);
  }
  const pistil = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), PISTIL);
  flower.add(pistil);
  flower.scale.setScalar(0.72);
  flower.position.set(0.225, 0.3, 0.055);
  flower.rotation.set(0.4, 0.3, -1.15);
  neck.add(flower);

  // face: two dark eyes and warm cheeks, nothing else
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.024, 2, 6), HAIR);
    eye.position.set(0.095 * s, 0.1, 0.245);
    neck.add(eye);
  }

  // stubby arms, bare with a short white sleeve
  const mkArm = () => {
    const g = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), TOP);
    sleeve.scale.set(1, 1.2, 1);
    sleeve.position.y = -0.03;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.14, 3, 8), SKIN);
    arm.position.y = -0.16;
    arm.castShadow = true;
    g.add(sleeve, arm);
    return g;
  };
  const shoulderL = new THREE.Group(); shoulderL.position.set(-0.21, 0.44, 0);
  const shoulderR = new THREE.Group(); shoulderR.position.set(0.21, 0.44, 0);
  shoulderL.add(mkArm());
  shoulderR.add(mkArm());
  shoulderL.rotation.z = 0.3;
  shoulderR.rotation.z = -0.3;
  hips.add(shoulderL, shoulderR);

  // tiny feet peeking from under the hem
  const mkFoot = () => {
    const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.07, 3, 8), SKIN);
    f.rotation.x = Math.PI / 2;
    f.position.set(0, -0.485, 0.05);
    f.castShadow = true;
    return f;
  };
  const hipL = new THREE.Group(); hipL.position.set(-0.09, 0, 0);
  const hipR = new THREE.Group(); hipR.position.set(0.09, 0, 0);
  hipL.add(mkFoot());
  hipR.add(mkFoot());
  hips.add(hipL, hipR);

  root.userData = { hips, neck, hat, shoulderL, shoulderR, hipL, hipR, cloak, scarfTail: sashTail, baseHipY: 0.5 };
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
    this.dist = 6.2;
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
    this.dist = 6.2;
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
      // camera-relative: forward is where you're looking.
      // right = fwd rotated -90° about +Y, i.e. (-fwd.z, fwd.x) in xz — the
      // previous sign was flipped, which swapped A and D.
      const fwd = new THREE.Vector2(Math.sin(this.yaw), Math.cos(this.yaw));
      const right = new THREE.Vector2(-fwd.y, fwd.x);
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
    u.hips.position.y = u.baseHipY + bob - sit * 0.3 + Math.sin(t * 1.8) * 0.012 * (1 - run);
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
        this.pos.x, this.pos.y + 1.3 + bob - this.sitBlend * 0.45, this.pos.z);
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

    const target = this._look.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
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
