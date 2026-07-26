/* ═══════════════════════════════════════════════════════════
   Keyboard, mouse-drag and touch, folded into one small state
   object the player controller reads each frame.
   ═══════════════════════════════════════════════════════════ */

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 };
    this.zoom = 0;
    this.run = false;
    this.jumpPressed = false;
    this.enabled = false;
    this.keys = new Set();
    this.actions = new Map();
    this.isTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;

    this._dragId = null;
    this._lastX = 0;
    this._lastY = 0;
    this._stickId = null;

    this._bindKeyboard();
    this._bindPointer();
  }

  on(key, fn) { this.actions.set(key, fn); return this; }

  consumeLook() { this.look.x = 0; this.look.y = 0; this.zoom = 0; }
  consumeJump() { this.jumpPressed = false; }

  _fire(name) { const fn = this.actions.get(name); if (fn) fn(); }

  _bindKeyboard() {
    addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'escape') { this._fire('escape'); return; }
      if (!this.enabled) return;
      if (this.keys.has(k)) return;                       // ignore auto-repeat
      this.keys.add(k);
      if (k === ' ') { this.jumpPressed = true; e.preventDefault(); }
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (k === 'e') this._fire('sit');
      if (k === 'r') this._fire('weather');
      if (k === 't') this._fire('time');
      if (k === 'm') this._fire('music');
      if (k === 'h') this._fire('hud');
      if (k === 'p') this._fire('photo');
    });

    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  _bindPointer() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (this._dragId !== null) return;
      this._dragId = e.pointerId;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      c.style.cursor = 'grabbing';
    });

    const moveHandler = (e) => {
      if (e.pointerId !== this._dragId) return;
      this.look.x += e.clientX - this._lastX;
      this.look.y += e.clientY - this._lastY;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    };
    c.addEventListener('pointermove', moveHandler);

    const end = (e) => {
      if (e.pointerId !== this._dragId) return;
      this._dragId = null;
      c.style.cursor = 'grab';
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.zoom += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    this._bindTouch();
  }

  _bindTouch() {
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const jump = document.getElementById('tjump');
    if (!stick || !knob || !jump) return;

    const R = 42;
    let ox = 0, oy = 0;

    stick.addEventListener('pointerdown', (e) => {
      this._stickId = e.pointerId;
      const r = stick.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
      stick.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });

    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMove = { x: dx / R, y: -dy / R };
      e.stopPropagation();
    });

    const release = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      knob.style.transform = '';
      this.touchMove = null;
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);

    jump.addEventListener('pointerdown', (e) => { this.jumpPressed = true; e.stopPropagation(); });
  }

  /** Fold keyboard + joystick into this.move; call once per frame. */
  sample() {
    if (!this.enabled) { this.move.x = 0; this.move.y = 0; this.run = false; return; }
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;

    if (this.touchMove) { x += this.touchMove.x; y += this.touchMove.y; }

    this.move.x = x;
    this.move.y = y;
    this.run = k.has('shift') || (this.touchMove && Math.hypot(this.touchMove.x, this.touchMove.y) > 0.85);
  }
}
