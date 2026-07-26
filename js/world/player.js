import * as THREE from 'three';
import { heightAt, POND, WATER_LEVEL, WORLD_SIZE } from './terrain.js';
import { clamp, damp } from './noise.js';
import { buildAvatar } from './avatar.js';

/* ═══════════════════════════════════════════════════════════
   The wanderer, and the third-person camera that trails
   politely behind — or her own eyes, if you press V.
   The figure itself is built by avatar.js from whatever the
   creator screen was left on.
   ═══════════════════════════════════════════════════════════ */

const HALF = WORLD_SIZE / 2 - 12;

export class Player {
  constructor(scene, camera, avatarConfig) {
    this.scene = scene;
    this.avatarConfig = avatarConfig;
    this.mesh = buildAvatar(avatarConfig);
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

  /** Swap the figure without disturbing where she is standing. */
  setAvatar(config) {
    this.avatarConfig = config;
    this.scene.remove(this.mesh);
    this.mesh.userData.dispose?.();
    this.mesh = buildAvatar(config);
    this.mesh.visible = !this.firstPerson;
    this.scene.add(this.mesh);
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
    // hair swings from the head, lagging the stride and lifting as she runs
    u.scarfTail.rotation.x = -run * 0.3 - Math.sin(this.stride * 2 - 0.8) * 0.12 * run
      - Math.sin(t * 1.3) * 0.02;
    u.scarfTail.rotation.z = Math.sin(this.stride - 0.5) * 0.1 * run;
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
