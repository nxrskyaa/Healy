import * as THREE from 'three';
import {
  AVATAR_FIELDS, buildAvatar, defaultAvatar, randomAvatar,
} from './world/avatar.js';

/* ═══════════════════════════════════════════════════════════
   The character creator.

   Runs its own small renderer on its own canvas so it can live
   entirely before the world exists — you can make someone
   without paying for a million blades of grass first.
   ═══════════════════════════════════════════════════════════ */

const STORE_KEY = 'healy.avatar.v1';

export function loadAvatarConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...defaultAvatar(), ...JSON.parse(raw) };
  } catch { /* private mode, or a stale shape — fall through */ }
  return defaultAvatar();
}

function saveAvatarConfig(cfg) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export class Creator {
  constructor({ canvas, list, onDone }) {
    this.canvas = canvas;
    this.list = list;
    this.onDone = onDone;
    this.config = loadAvatarConfig();
    this.avatar = null;
    this.running = false;
    this.spin = 0;
    this.targetSpin = 0;
    this.dragging = false;
    this._lastX = 0;

    this._initGL();
    this._buildList();
    this._rebuild();
    this._bindDrag();
  }

  _initGL() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
    this.camera.position.set(0, 1.15, 4.4);
    this.camera.lookAt(0, 0.95, 0);

    // Three-point-ish: a warm key from the front left, a cool sky fill, and
    // a rim from behind to cut the silhouette off the backdrop.
    const key = new THREE.DirectionalLight(0xfff0d8, 2.0);
    key.position.set(-2.4, 3.4, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 12;
    Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 2.6, bottom: -0.6 });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0012;
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xbcd6f0, 1.1);
    rim.position.set(2.6, 2.0, -3.0);
    this.scene.add(rim);

    this.scene.add(new THREE.HemisphereLight(0xdceaf4, 0x9a8b6e, 1.25));

    // a soft disc for the figure to stand on and cast onto
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 48),
      new THREE.MeshLambertMaterial({ color: 0xd8cdb4, transparent: true, opacity: 0.55 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.receiveShadow = true;
    this.scene.add(disc);

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
  }

  _bindDrag() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this._lastX = e.clientX;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.targetSpin -= (e.clientX - this._lastX) * 0.012;
      this._lastX = e.clientX;
    });
    const end = () => { this.dragging = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  /* ── the option list ── */

  _buildList() {
    this.list.innerHTML = '';
    this.rows = {};

    for (const field of AVATAR_FIELDS) {
      const row = document.createElement('div');
      row.className = 'crow';

      const label = document.createElement('span');
      label.className = 'clabel';
      label.textContent = field.label;
      row.appendChild(label);

      if (field.kind === 'swatch') {
        const wrap = document.createElement('div');
        wrap.className = 'cswatches';
        for (const opt of field.options) {
          const b = document.createElement('button');
          b.className = 'cswatch';
          b.style.setProperty('--c', opt.hex);
          b.title = opt.name;
          b.setAttribute('aria-label', `${field.label}: ${opt.name}`);
          b.addEventListener('click', () => this._set(field.key, opt.id));
          wrap.appendChild(b);
          b.dataset.id = opt.id;
        }
        row.appendChild(wrap);
        this.rows[field.key] = { field, el: wrap };
      } else {
        const stepper = document.createElement('div');
        stepper.className = 'cstepper';

        const prev = document.createElement('button');
        prev.className = 'carrow';
        prev.setAttribute('aria-label', `Previous ${field.label}`);
        prev.textContent = '‹';
        prev.addEventListener('click', () => this._cycle(field.key, -1));

        const value = document.createElement('span');
        value.className = 'cvalue';

        const next = document.createElement('button');
        next.className = 'carrow';
        next.setAttribute('aria-label', `Next ${field.label}`);
        next.textContent = '›';
        next.addEventListener('click', () => this._cycle(field.key, 1));

        stepper.append(prev, value, next);
        row.appendChild(stepper);
        this.rows[field.key] = { field, el: value };
      }
      this.list.appendChild(row);
    }
  }

  _syncList() {
    for (const key of Object.keys(this.rows)) {
      const { field, el } = this.rows[key];
      const id = this.config[key];
      if (field.kind === 'swatch') {
        for (const b of el.children) b.classList.toggle('on', b.dataset.id === id);
      } else {
        const opt = field.options.find((o) => o.id === id) || field.options[0];
        el.textContent = opt.name;
      }
    }
  }

  _cycle(key, dir) {
    const field = AVATAR_FIELDS.find((f) => f.key === key);
    const i = field.options.findIndex((o) => o.id === this.config[key]);
    const n = field.options.length;
    this._set(key, field.options[((i + dir) % n + n) % n].id);
  }

  _set(key, id) {
    if (this.config[key] === id) return;
    this.config[key] = id;
    this._rebuild();
  }

  randomize() {
    this.config = randomAvatar();
    this._rebuild();
  }

  _rebuild() {
    if (this.avatar) {
      this.pivot.remove(this.avatar);
      this.avatar.userData.dispose?.();
    }
    this.avatar = buildAvatar(this.config);
    this.avatar.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.pivot.add(this.avatar);
    this._syncList();
    saveAvatarConfig(this.config);
  }

  /* ── lifecycle ── */

  start() {
    this.running = true;
    this._resize();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this._resize();
      // ease toward the dragged angle, and drift slowly when left alone
      if (!this.dragging) this.targetSpin += 0.0022;
      this.spin += (this.targetSpin - this.spin) * 0.12;
      this.pivot.rotation.y = this.spin;
      // a breath, so the preview is never a mannequin
      const t = performance.now() / 1000;
      const u = this.avatar.userData;
      u.hips.position.y = u.baseHipY + Math.sin(t * 1.5) * 0.006;
      u.neck.rotation.z = Math.sin(t * 0.9) * 0.02;
      u.shoulderL.rotation.x = Math.sin(t * 1.5) * 0.03;
      u.shoulderR.rotation.x = -Math.sin(t * 1.5) * 0.03;
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  _resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // pull back a little on narrow screens so the figure always fits
    this.camera.position.z = w / h < 0.9 ? 5.2 : 4.4;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(0, 0.95, 0);
  }

  done() {
    saveAvatarConfig(this.config);
    this.onDone(this.config);
  }
}
