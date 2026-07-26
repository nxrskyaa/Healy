import { makeRandom } from './world/noise.js';

/* ═══════════════════════════════════════════════════════════
   The painted 2D scene behind the menu — cheap enough to run
   before Three.js has even finished loading.
   ═══════════════════════════════════════════════════════════ */

export function startMenuArt(canvas) {
  const ctx = canvas.getContext('2d');
  const rnd = makeRandom(717);
  let W = 0, H = 0, dpr = 1, raf = 0, t0 = performance.now();

  const clouds = Array.from({ length: 14 }, () => ({
    x: rnd(), y: 0.05 + rnd() * 0.34, s: 0.5 + rnd() * 1.5,
    v: 0.004 + rnd() * 0.012, a: 0.3 + rnd() * 0.5,
  }));

  const birds = Array.from({ length: 9 }, () => ({
    x: rnd(), y: 0.14 + rnd() * 0.24, v: 0.012 + rnd() * 0.02,
    s: 0.5 + rnd() * 0.8, ph: rnd() * 9,
  }));

  const motes = Array.from({ length: 70 }, () => ({
    x: rnd(), y: rnd(), r: 0.6 + rnd() * 2.2,
    v: 0.004 + rnd() * 0.014, ph: rnd() * 9, a: 0.15 + rnd() * 0.5,
  }));

  const hills = [
    { y: 0.62, amp: 0.045, freq: 1.6, c1: '#7fa48f', c2: '#6b9080', trees: 0, off: 0.1 },
    { y: 0.72, amp: 0.055, freq: 1.1, c1: '#5b8570', c2: '#4a7160', trees: 16, off: 0.6 },
    { y: 0.84, amp: 0.04,  freq: 2.2, c1: '#3d5f4f', c2: '#31503f', trees: 22, off: 1.4 },
  ];

  const blades = Array.from({ length: 200 }, () => ({
    x: rnd(), h: 0.05 + rnd() * 0.16, w: 1 + rnd() * 2.4,
    ph: rnd() * 9, lean: (rnd() - 0.5) * 0.5, c: rnd(),
  }));

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hillPath(h, phase) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const y = H * (h.y
        + Math.sin(u * Math.PI * h.freq * 2 + h.off + phase * 0.08) * h.amp
        + Math.sin(u * Math.PI * h.freq * 5.3 + h.off * 2) * h.amp * 0.28);
      ctx.lineTo(u * W, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
  }

  function hillY(h, u, phase) {
    return H * (h.y
      + Math.sin(u * Math.PI * h.freq * 2 + h.off + phase * 0.08) * h.amp
      + Math.sin(u * Math.PI * h.freq * 5.3 + h.off * 2) * h.amp * 0.28);
  }

  function cloud(x, y, s, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(x, y - 8 * s, 2, x, y, 46 * s);
    g.addColorStop(0, 'rgba(255,250,240,0.95)');
    g.addColorStop(0.55, 'rgba(255,244,228,0.55)');
    g.addColorStop(1, 'rgba(255,238,220,0)');
    ctx.fillStyle = g;
    for (const [ox, oy, r] of [[-34, 6, 26], [-10, -8, 34], [18, 2, 28], [40, 8, 20], [4, 12, 24]]) {
      ctx.beginPath();
      ctx.arc(x + ox * s, y + oy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    if (canvas.clientWidth !== W || canvas.clientHeight !== H) resize();

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0.00, '#2f4f7a');
    sky.addColorStop(0.32, '#7c96b8');
    sky.addColorStop(0.58, '#e5b190');
    sky.addColorStop(0.78, '#f7d9a8');
    sky.addColorStop(1.00, '#f3e2bd');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // sun
    const sx = W * 0.72, sy = H * 0.52;
    const halo = ctx.createRadialGradient(sx, sy, 4, sx, sy, H * 0.42);
    halo.addColorStop(0, 'rgba(255,239,199,0.95)');
    halo.addColorStop(0.18, 'rgba(255,222,163,0.45)');
    halo.addColorStop(1, 'rgba(255,210,150,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.arc(sx, sy, H * 0.055 + Math.sin(t * 0.6) * 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,247,224,0.92)';
    ctx.fill();

    // clouds
    for (const c of clouds) {
      c.x += c.v * 0.016;
      if (c.x > 1.25) c.x = -0.25;
      cloud(c.x * W, c.y * H, c.s * (H / 700 + 0.5), c.a);
    }

    // birds
    ctx.strokeStyle = 'rgba(50,60,70,0.5)';
    ctx.lineWidth = 1.4;
    for (const b of birds) {
      b.x += b.v * 0.014;
      if (b.x > 1.15) { b.x = -0.15; b.y = 0.14 + Math.random() * 0.24; }
      const x = b.x * W, y = b.y * H + Math.sin(t * 0.8 + b.ph) * 6;
      const s = 6 * b.s;
      const flap = Math.sin(t * 5 + b.ph) * 0.5 + 0.5;
      ctx.beginPath();
      ctx.moveTo(x - s, y + flap * s * 0.5);
      ctx.quadraticCurveTo(x, y - s * 0.4, x + s, y + flap * s * 0.5);
      ctx.stroke();
    }

    // hills + tree silhouettes
    hills.forEach((h, i) => {
      hillPath(h, t);
      const g = ctx.createLinearGradient(0, H * h.y - 40, 0, H);
      g.addColorStop(0, h.c1);
      g.addColorStop(1, h.c2);
      ctx.fillStyle = g;
      ctx.fill();

      if (h.trees) {
        ctx.fillStyle = h.c2;
        for (let k = 0; k < h.trees; k++) {
          const u = ((k * 0.137 + i * 0.31) % 1);
          const x = u * W;
          const y = hillY(h, u, t) + 2;
          const th = (10 + ((k * 37) % 13)) * (H / 700 + 0.4) * (i === 2 ? 1.5 : 1);
          ctx.beginPath();
          ctx.moveTo(x - th * 0.42, y);
          ctx.quadraticCurveTo(x, y - th * 1.9, x + th * 0.42, y);
          ctx.closePath();
          ctx.fill();
        }
      }
    });

    // foreground grass
    ctx.lineCap = 'round';
    for (const b of blades) {
      const x = b.x * W;
      const h = b.h * H;
      const sway = Math.sin(t * 1.1 + b.ph) * 0.06 + Math.sin(t * 2.7 + b.ph * 2) * 0.02;
      ctx.strokeStyle = b.c > 0.5 ? 'rgba(30,52,42,0.9)' : 'rgba(44,70,54,0.85)';
      ctx.lineWidth = b.w;
      ctx.beginPath();
      ctx.moveTo(x, H + 2);
      ctx.quadraticCurveTo(
        x + (b.lean + sway) * h * 0.5, H - h * 0.55,
        x + (b.lean + sway) * h * 1.6, H - h
      );
      ctx.stroke();
    }

    // drifting motes
    for (const m of motes) {
      m.y -= m.v * 0.004;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      const x = (m.x + Math.sin(t * 0.5 + m.ph) * 0.012) * W;
      const y = m.y * H;
      ctx.globalAlpha = m.a * (0.5 + 0.5 * Math.sin(t * 1.7 + m.ph));
      ctx.fillStyle = '#fff6dc';
      ctx.beginPath();
      ctx.arc(x, y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    raf = requestAnimationFrame(frame);
  }

  resize();
  addEventListener('resize', resize);
  raf = requestAnimationFrame(frame);

  return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); };
}
