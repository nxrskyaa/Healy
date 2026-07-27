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
    this.touchMove = null;

    /* Look used to be counted in raw pixels, which quietly made the controls
       worse the smaller the screen got: the same 0.0032 rad/px meant a full
       thumb-swipe on a phone turned you barely a quarter as far as a mouse
       drag across a desktop window. It is now a fraction of the short side of
       the viewport, so a swipe of a given *proportion* turns you the same
       amount everywhere, and a thumb gets extra gain on top because it has
       far less room to travel than a mouse. */
    this._pointers = new Map();     // live pointers on the canvas, for pinch
    this._pinch = 0;

    this._bindKeyboard();
    this._bindPointer();
  }

  /** Look delta as a fraction of the viewport's short side. */
  _lookScale(pointerType) {
    return (pointerType === 'touch' ? 2.15 : 1) / Math.min(innerWidth, innerHeight);
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
      if (k === 'v') this._fire('view');
      if (k === 'c') this._fire('character');
    });

    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());
  }

  _bindPointer() {
    const c = this.canvas;

    /** Finger spread, for pinch-zoom. Null unless exactly two are down. */
    const spread = () => {
      if (this._pointers.size !== 2) return null;
      const [a, b] = [...this._pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    c.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2) {
        // second finger down: this is a pinch, not a look
        this._dragId = null;
        this._pinch = spread();
        return;
      }
      if (this._dragId !== null) return;
      this._dragId = e.pointerId;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      c.style.cursor = 'grabbing';
    });

    c.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }

      const s = spread();
      if (s !== null) {
        // fingers apart pulls the camera in, which is the way every map works
        if (this._pinch) this.zoom -= (s - this._pinch) * 1.33;
        this._pinch = s;
        return;
      }

      if (e.pointerId !== this._dragId) return;
      const k = this._lookScale(e.pointerType);
      this.look.x += (e.clientX - this._lastX) * k;
      this.look.y += (e.clientY - this._lastY) * k;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
    });

    const end = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = 0;
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

  /* The stick used to be a fixed 128 px circle bolted to the bottom-left
     corner, so walking meant finding it before you could move — and its travel
     radius was 42 px inside a 64 px ring, so the outer third of the thing you
     could see did nothing. It now springs up wherever the thumb lands in the
     left zone, and its travel matches the ring you are actually looking at. */
  _bindTouch() {
    const zone = document.getElementById('stickzone');
    const stick = document.getElementById('stick');
    const knob = document.getElementById('stick-knob');
    const jump = document.getElementById('tjump');
    if (!zone || !stick || !knob || !jump) return;

    const R = 56;                       // == the ring's radius in style.css
    let ox = 0, oy = 0;

    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this._stickId !== null) return;
      this._stickId = e.pointerId;
      ox = e.clientX; oy = e.clientY;
      stick.style.left = `${ox}px`;
      stick.style.top = `${oy}px`;
      stick.classList.add('on');
      knob.style.transform = '';
      this.touchMove = { x: 0, y: 0 };
      zone.setPointerCapture(e.pointerId);
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._stickId) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMove = { x: dx / R, y: -dy / R };
    });

    const release = (e) => {
      if (e.pointerId !== this._stickId) return;
      this._stickId = null;
      knob.style.transform = '';
      stick.classList.remove('on');
      this.touchMove = null;
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    jump.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.jumpPressed = true;
      e.preventDefault();
    });
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
    // pushing the stick near its edge runs; 0.85 of full travel was a hair
    // under the point a thumb comfortably reaches, so it almost never fired
    this.run = k.has('shift') || (this.touchMove && Math.hypot(this.touchMove.x, this.touchMove.y) > 0.76);
  }
}
