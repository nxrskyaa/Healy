import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════
   The avatar.

   Anime characters do not read from geometry — they read from
   the FACE. So the head is a tapered ovoid with a chin, and
   the eyes are drawn on a canvas and wrapped onto the front of
   it: big irises with a gradient, a heavy upper lash line, two
   highlights. That one texture does more than any amount of
   polygon detail.

   Everything else is built to a five-head stylised proportion
   and is fully parametric, because the creator screen rebuilds
   this whole figure every time you press an arrow.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* ───────────── palettes ───────────── */

export const SKINS = [
  { id: 'porcelain', name: 'Porcelain', hex: '#f7ded0', shade: '#e0b8a4' },
  { id: 'light',     name: 'Light',     hex: '#f2d2b6', shade: '#d8ab8b' },
  { id: 'warm',      name: 'Warm',      hex: '#e8bc94', shade: '#c9946c' },
  { id: 'honey',     name: 'Honey',     hex: '#d6a273', shade: '#b47c52' },
  { id: 'bronze',    name: 'Bronze',    hex: '#b57c50', shade: '#8f5c38' },
  { id: 'deep',      name: 'Deep',      hex: '#8a5636', shade: '#663c25' },
  { id: 'ebony',     name: 'Ebony',     hex: '#5f3a26', shade: '#42271a' },
];

export const HAIR_COLORS = [
  { id: 'ink',      name: 'Ink',      hex: '#22212a', hi: '#4a4757' },
  { id: 'espresso', name: 'Espresso', hex: '#3d2a20', hi: '#63483a' },
  { id: 'chestnut', name: 'Chestnut', hex: '#6b4227', hi: '#9a6a44' },
  { id: 'honey',    name: 'Honey',    hex: '#b98847', hi: '#e0b571' },
  { id: 'platinum', name: 'Platinum', hex: '#ded4c2', hi: '#fbf6ea' },
  { id: 'ash',      name: 'Ash',      hex: '#8d8f98', hi: '#b9bcc6' },
  { id: 'rose',     name: 'Rose',     hex: '#c8788c', hi: '#eda6b6' },
  { id: 'sakura',   name: 'Sakura',   hex: '#e7b3c4', hi: '#ffd9e4' },
  { id: 'ocean',    name: 'Ocean',    hex: '#3f6f8e', hi: '#6d9fbd' },
  { id: 'mint',     name: 'Mint',     hex: '#6fa88c', hi: '#9ed3b8' },
  { id: 'violet',   name: 'Violet',   hex: '#8065a8', hi: '#ab90d0' },
  { id: 'ember',    name: 'Ember',    hex: '#b1503a', hi: '#dc7d5f' },
];

export const EYE_COLORS = [
  { id: 'umber',   name: 'Umber',   hex: '#6b4326' },
  { id: 'amber',   name: 'Amber',   hex: '#c98a2e' },
  { id: 'moss',    name: 'Moss',    hex: '#4d7a45' },
  { id: 'teal',    name: 'Teal',    hex: '#2f7f86' },
  { id: 'sky',     name: 'Sky',     hex: '#4a7fc1' },
  { id: 'violet',  name: 'Violet',  hex: '#7a5aa8' },
  { id: 'rose',    name: 'Rose',    hex: '#b8546a' },
  { id: 'slate',   name: 'Slate',   hex: '#5b6470' },
];

export const OUTFIT_COLORS = [
  { id: 'terracotta', name: 'Terracotta', hex: '#a8543c', alt: '#d8b46a' },
  { id: 'indigo',     name: 'Indigo',     hex: '#3f4d70', alt: '#d9d2bd' },
  { id: 'moss',       name: 'Moss',       hex: '#4f6b47', alt: '#e0d8bc' },
  { id: 'plum',       name: 'Plum',       hex: '#6a4258', alt: '#e6c9a8' },
  { id: 'saffron',    name: 'Saffron',    hex: '#c98a2e', alt: '#f2ead6' },
  { id: 'ocean',      name: 'Ocean',      hex: '#356273', alt: '#efe6cc' },
  { id: 'clay',       name: 'Clay',       hex: '#8a6b4e', alt: '#f0e7d2' },
  { id: 'charcoal',   name: 'Charcoal',   hex: '#3a3a42', alt: '#cfc7b4' },
  { id: 'rose',       name: 'Rose',       hex: '#b06b74', alt: '#f6e8dd' },
  { id: 'ivory',      name: 'Ivory',      hex: '#e3d8bf', alt: '#8a7454' },
];

export const HAIR_STYLES = [
  { id: 'short',     name: 'Cropped' },
  { id: 'messy',     name: 'Messy' },
  { id: 'bob',       name: 'Bob' },
  { id: 'long',      name: 'Long' },
  { id: 'hime',      name: 'Hime' },
  { id: 'ponytail',  name: 'Ponytail' },
  { id: 'twintails', name: 'Twintails' },
  { id: 'bun',       name: 'Bun' },
  { id: 'undercut',  name: 'Undercut' },
];

export const OUTFITS = [
  { id: 'kebaya',   name: 'Kebaya' },
  { id: 'yukata',   name: 'Yukata' },
  { id: 'hoodie',   name: 'Hoodie' },
  { id: 'uniform',  name: 'Uniform' },
  { id: 'sundress', name: 'Sundress' },
  { id: 'traveler', name: 'Traveler' },
];

export const ACCESSORIES = [
  { id: 'none',      name: 'None' },
  { id: 'frangipani', name: 'Frangipani' },
  { id: 'kasa',      name: 'Straw hat' },
  { id: 'glasses',   name: 'Glasses' },
  { id: 'ribbon',    name: 'Ribbon' },
  { id: 'earcuff',   name: 'Ear flower' },
  { id: 'scarf',     name: 'Scarf' },
];

export const BUILDS = [
  { id: 'slight', name: 'Slight' },
  { id: 'sturdy', name: 'Sturdy' },
];

export const EXPRESSIONS = [
  { id: 'calm',    name: 'Calm' },
  { id: 'smile',   name: 'Smiling' },
  { id: 'sleepy',  name: 'Sleepy' },
  { id: 'bright',  name: 'Bright' },
];

/** The list the creator screen walks. Order is the order on screen. */
export const AVATAR_FIELDS = [
  { key: 'build',       label: 'Build',      options: BUILDS,        kind: 'text' },
  { key: 'skin',        label: 'Skin',       options: SKINS,         kind: 'swatch' },
  { key: 'hair',        label: 'Hair',       options: HAIR_STYLES,   kind: 'text' },
  { key: 'hairColor',   label: 'Hair tone',  options: HAIR_COLORS,   kind: 'swatch' },
  { key: 'eyes',        label: 'Eyes',       options: EYE_COLORS,    kind: 'swatch' },
  { key: 'expression',  label: 'Look',       options: EXPRESSIONS,   kind: 'text' },
  { key: 'outfit',      label: 'Outfit',     options: OUTFITS,       kind: 'text' },
  { key: 'outfitColor', label: 'Cloth',      options: OUTFIT_COLORS, kind: 'swatch' },
  { key: 'accessory',   label: 'Accessory',  options: ACCESSORIES,   kind: 'text' },
];

export function defaultAvatar() {
  return {
    build: 'slight', skin: 'warm', hair: 'ponytail', hairColor: 'ink',
    eyes: 'umber', expression: 'calm', outfit: 'kebaya',
    outfitColor: 'terracotta', accessory: 'frangipani',
  };
}

export function randomAvatar(rnd = Math.random) {
  const pick = (arr) => arr[(rnd() * arr.length) | 0].id;
  return {
    build: pick(BUILDS), skin: pick(SKINS), hair: pick(HAIR_STYLES),
    hairColor: pick(HAIR_COLORS), eyes: pick(EYE_COLORS),
    expression: pick(EXPRESSIONS), outfit: pick(OUTFITS),
    outfitColor: pick(OUTFIT_COLORS), accessory: pick(ACCESSORIES),
  };
}

const find = (arr, id) => arr.find((o) => o.id === id) || arr[0];

/* ───────────── the face ─────────────
   Drawn once per avatar into a 512² canvas and wrapped onto the
   front of the skull. This is the whole trick. */

function drawEye(ctx, cx, cy, w, h, iris, mirror, expr) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mirror) ctx.scale(-1, 1);

  const sleepy = expr === 'sleepy';
  const bright = expr === 'bright';
  const openTop = sleepy ? -h * 0.24 : -h * (bright ? 0.58 : 0.5);

  // ── the eye opening: a rounded almond, wider at the outer corner ──
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, h * 0.06);
  ctx.bezierCurveTo(-w * 0.42, openTop, w * 0.26, openTop * 1.05, w * 0.5, -h * 0.1);
  ctx.bezierCurveTo(w * 0.34, h * 0.42, -w * 0.28, h * 0.46, -w * 0.5, h * 0.06);
  ctx.closePath();
  ctx.save();
  ctx.clip();

  // sclera
  ctx.fillStyle = '#fdfbf6';
  ctx.fillRect(-w, -h, w * 2, h * 2);

  // iris: tall oval, dark rim, light floor — the anime standard
  const ir = h * (bright ? 0.55 : 0.5);
  const ix = w * 0.02, iy = h * 0.02;
  const g = ctx.createLinearGradient(0, iy - ir, 0, iy + ir);
  const c = new THREE.Color(iris);
  // lift the whole ramp: a literal eye colour reads as a dark dot at
  // arm's length, where anime irises glow
  const base = c.clone().lerp(new THREE.Color('#ffffff'), 0.16);
  const dark = c.clone().multiplyScalar(0.62).getStyle();
  const lite = c.clone().lerp(new THREE.Color('#ffffff'), 0.62).getStyle();
  g.addColorStop(0, dark);
  g.addColorStop(0.42, base.getStyle());
  g.addColorStop(1, lite);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.82, ir, 0, 0, TAU);
  ctx.fill();

  // limbal ring
  ctx.strokeStyle = dark;
  ctx.lineWidth = h * 0.06;
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.82, ir, 0, 0, TAU);
  ctx.stroke();

  // pupil
  ctx.fillStyle = '#1a1620';
  ctx.beginPath();
  ctx.ellipse(ix, iy, ir * 0.34, ir * 0.46, 0, 0, TAU);
  ctx.fill();

  // highlights: one big upper-left, one small lower-right
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.beginPath();
  ctx.ellipse(ix - ir * 0.34, iy - ir * 0.42, ir * 0.3, ir * 0.26, -0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(ix + ir * 0.3, iy + ir * 0.42, ir * 0.14, ir * 0.12, 0, 0, TAU);
  ctx.fill();

  ctx.restore();

  // ── upper lash line: heavy, tapering, flicked at the outer corner ──
  ctx.strokeStyle = '#221c26';
  ctx.lineCap = 'round';
  ctx.lineWidth = h * (sleepy ? 0.2 : 0.24);
  ctx.beginPath();
  ctx.moveTo(-w * 0.52, h * 0.06);
  ctx.bezierCurveTo(-w * 0.42, openTop, w * 0.26, openTop * 1.05, w * 0.54, -h * 0.14);
  ctx.stroke();
  // the flick
  ctx.lineWidth = h * 0.16;
  ctx.beginPath();
  ctx.moveTo(w * 0.46, -h * 0.08);
  ctx.lineTo(w * 0.66, -h * 0.3);
  ctx.stroke();
  // lower lid, much lighter
  ctx.lineWidth = h * 0.08;
  ctx.strokeStyle = 'rgba(34,28,38,0.5)';
  ctx.beginPath();
  ctx.moveTo(-w * 0.34, h * 0.3);
  ctx.bezierCurveTo(-w * 0.1, h * 0.44, w * 0.24, h * 0.4, w * 0.46, h * 0.14);
  ctx.stroke();

  ctx.restore();
}

function drawBrow(ctx, cx, cy, w, h, color, mirror, expr) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mirror) ctx.scale(-1, 1);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = h * 0.42;
  const tilt = expr === 'bright' ? -h * 0.25 : (expr === 'sleepy' ? h * 0.16 : 0);
  ctx.beginPath();
  ctx.moveTo(-w * 0.5, h * 0.3 + tilt * 0.3);
  ctx.quadraticCurveTo(-w * 0.05, -h * 0.45 + tilt, w * 0.5, h * 0.05 - tilt * 0.4);
  ctx.stroke();
  ctx.restore();
}

function faceTexture(cfg) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, S, S);

  const iris = find(EYE_COLORS, cfg.eyes).hex;
  const hair = find(HAIR_COLORS, cfg.hairColor);
  const skin = find(SKINS, cfg.skin);
  const expr = cfg.expression;

  // Big. Anime eyes take up most of the space between brow and nose, and
  // undersized ones are the single fastest way to make a face look wrong.
  const eyeW = S * 0.275, eyeH = S * 0.245;
  const eyeY = S * 0.5;
  const dx = S * 0.2;

  // cheeks first, under everything — a hint, not rouge
  for (const s of [-1, 1]) {
    const bx = S * 0.5 + s * dx * 1.2, by = eyeY + S * 0.155;
    const bl = ctx.createRadialGradient(bx, by, 2, bx, by, S * 0.1);
    bl.addColorStop(0, 'rgba(214,128,116,0.13)');
    bl.addColorStop(0.55, 'rgba(214,128,116,0.07)');
    bl.addColorStop(1, 'rgba(214,128,116,0)');
    ctx.fillStyle = bl;
    ctx.fillRect(bx - S * 0.12, by - S * 0.12, S * 0.24, S * 0.24);
  }

  // The mirror flag puts the lash flick on the OUTER corner. Canvas +x is
  // screen right, so the screen-left eye is the mirrored one.
  drawEye(ctx, S * 0.5 - dx, eyeY, eyeW, eyeH, iris, true, expr);
  drawEye(ctx, S * 0.5 + dx, eyeY, eyeW, eyeH, iris, false, expr);

  drawBrow(ctx, S * 0.5 - dx, eyeY - S * 0.2, S * 0.19, S * 0.045, hair.hex, true, expr);
  drawBrow(ctx, S * 0.5 + dx, eyeY - S * 0.2, S * 0.19, S * 0.045, hair.hex, false, expr);

  // nose: the faintest tick
  ctx.strokeStyle = new THREE.Color(skin.shade).multiplyScalar(0.9).getStyle();
  ctx.lineWidth = S * 0.008;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(S * 0.5 - S * 0.012, S * 0.665);
  ctx.lineTo(S * 0.5 + S * 0.016, S * 0.675);
  ctx.stroke();

  // mouth: a small mark, and never a dark blob
  ctx.strokeStyle = 'rgba(150,74,70,0.9)';
  ctx.lineWidth = S * 0.009;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const my = S * 0.735;
  if (expr === 'smile' || expr === 'bright') {
    ctx.moveTo(S * 0.5 - S * 0.032, my - S * 0.005);
    ctx.quadraticCurveTo(S * 0.5, my + S * 0.024, S * 0.5 + S * 0.032, my - S * 0.005);
  } else if (expr === 'sleepy') {
    ctx.moveTo(S * 0.5 - S * 0.018, my);
    ctx.lineTo(S * 0.5 + S * 0.018, my);
  } else {
    ctx.moveTo(S * 0.5 - S * 0.02, my);
    ctx.quadraticCurveTo(S * 0.5, my + S * 0.012, S * 0.5 + S * 0.02, my);
  }
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ───────────── geometry helpers ───────────── */

const lam = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

/** A tapered, slightly curved hair strand — the anime wedge. */
function strand(len, w0, w1, bend = 0.3, seg = 5) {
  const pts = [];
  // hangs down and drifts BACKWARD; bending it sideways made ponytails swing
  // out across the face like a slab
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(new THREE.Vector3(0, -t * len, -Math.sin(t * bend) * len * 0.34));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg * 2, 1, 4, false);
  // taper the tube by scaling each ring
  const pos = g.attributes.position;
  const rings = seg * 2 + 1;
  const perRing = 5;
  for (let r = 0; r < rings; r++) {
    const t = r / (rings - 1);
    const rr = w0 + (w1 - w0) * t;
    const c = curve.getPoint(t);
    for (let k = 0; k < perRing; k++) {
      const i = r * perRing + k;
      pos.setX(i, c.x + (pos.getX(i) - c.x) * rr);
      pos.setY(i, c.y + (pos.getY(i) - c.y) * rr);
      pos.setZ(i, c.z + (pos.getZ(i) - c.z) * rr);
    }
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A flat angular hair shard: broad at the root, drawn to a point at the tip,
 * hanging down from its origin. ConeGeometry puts its apex at +Y, so it has
 * to be turned over first — otherwise every lock of hair is a spike pointing
 * at the sky.
 */
function shard(w, len, thick = 0.045) {
  const g = new THREE.ConeGeometry(w, len, 4, 1);
  g.rotateX(Math.PI);
  g.scale(1, 1, thick / w);
  g.translate(0, -len / 2, 0);
  return g;
}

/* ───────────── the head ───────────── */

function buildHead(cfg, mats) {
  const g = new THREE.Group();
  const R = 0.205;

  // skull: an ovoid drawn in toward a chin, flattened at the back
  const geo = new THREE.SphereGeometry(R, 26, 22);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / R;                       // -1 bottom … 1 top
    if (t < 0) {
      // jaw narrows and comes to a soft chin
      const k = 1 - Math.pow(-t, 1.7) * 0.52;
      v.x *= k;
      v.z *= k * 0.98;
      v.y *= 1.14;                            // lengthen the lower face
    } else {
      v.x *= 1 - t * 0.04;
    }
    v.z *= v.z < 0 ? 0.9 : 1.0;               // flatten the back of the skull
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const head = new THREE.Mesh(geo, mats.skin);
  head.castShadow = true;
  g.add(head);

  // ears
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(R * 0.26, 8, 8), mats.skin);
    ear.scale.set(0.4, 1, 0.7);
    ear.position.set(s * R * 0.96, -R * 0.06, -R * 0.02);
    g.add(ear);
  }

  /* The face is a plane bent onto the skull. A plane keeps its UVs at
     0..1 with no remapping, which is what lets the canvas be authored
     as a straightforward portrait. */
  const FW = R * 1.72, FH = R * 1.96;
  const fg = new THREE.PlaneGeometry(FW, FH, 14, 14);
  const fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    let y = fp.getY(i);
    // the face sits on the lower-front of the skull, and the jaw narrows,
    // so squeeze the plane's lower corners inward to follow it
    const t = (y + FH / 2) / FH;              // 0 bottom … 1 top
    const narrow = 1 - Math.pow(1 - t, 2.0) * 0.34;
    const px = x * narrow;
    const sy = y * 1.0;
    const d2 = px * px + sy * sy;
    const rr = R * 1.005;
    const z = Math.sqrt(Math.max(0.0001, rr * rr - Math.min(d2, rr * rr * 0.94)));
    fp.setXYZ(i, px, sy, z);
  }
  fg.computeVertexNormals();
  const face = new THREE.Mesh(fg, mats.face);
  face.position.y = -R * 0.06;
  g.add(face);

  return { group: g, R };
}

/* ───────────── hair ───────────── */

function buildHair(cfg, mats, R) {
  const g = new THREE.Group();
  const style = cfg.hair;
  const H = mats.hair;

  /* Anything that should swing when she runs goes in here. Its pivot is the
     head centre, which is exactly where a ponytail hinges — so the animator
     only has to rotate one group, and styles with no tail get an empty one. */
  const tails = new THREE.Group();
  g.add(tails);
  g.userData.tails = tails;

  /* The cap stops ABOVE the brow. Taking it any lower buries the eyes, and
     a face with no forehead is the difference between a character and a
     lump. The back is a separate, deeper shell so the skull is still
     covered from behind. */
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.06, 26, 18, 0, TAU, 0, Math.PI * 0.44), H);
  cap.position.y = R * 0.04;
  cap.scale.z = 1.0;
  cap.castShadow = true;
  g.add(cap);

  /* The rear mass is a CLOSED sphere pushed back into the skull rather than
     a partial shell. A partial shell has open edges, and you end up seeing
     its inside face as a stray black triangle from three-quarter angles. */
  const backCap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.99, 22, 16), H);
  backCap.position.set(0, R * 0.02, -R * 0.3);
  backCap.scale.set(1.03, 1.02, 1.1);
  backCap.castShadow = true;
  g.add(backCap);

  // ── bangs: broad locks hanging from the hairline to just above the brow ──
  // Broad and overlapping. Narrow shards spaced apart read as a paper
  // zigzag; hair is a mass with points cut into its edge.
  const bangN = style === 'undercut' ? 5 : 7;
  const bangLen = style === 'hime' ? R * 0.6 : R * 0.5;
  for (let i = 0; i < bangN; i++) {
    const t = bangN === 1 ? 0.5 : i / (bangN - 1);
    const a = (t - 0.5) * 1.75;
    const len = bangLen * (0.78 + 0.5 * Math.abs(t - 0.5) * 2);
    const s = new THREE.Mesh(shard(R * 0.42, len, 0.06), H);
    s.position.set(Math.sin(a) * R * 0.78, R * 0.4, Math.cos(a) * R * 0.79);
    s.rotation.set(0.16, a, (t - 0.5) * 0.42);
    g.add(s);
  }

  // ── side locks framing the cheeks ──
  if (style !== 'undercut' && style !== 'short') {
    const sideLen = (style === 'hime' || style === 'long' || style === 'twintails')
      ? R * 2.0 : R * 1.0;
    for (const sd of [-1, 1]) {
      const s = new THREE.Mesh(shard(R * 0.22, sideLen, 0.06), H);
      s.position.set(sd * R * 0.92, R * 0.3, R * 0.24);
      s.rotation.set(0.06, 0, sd * 0.13);
      g.add(s);
    }
  }

  // ── the back mass ──
  const backLen = { short: 0, undercut: 0, messy: 0.1, bob: 0.42, long: 1.5,
    hime: 1.55, ponytail: 0.16, twintails: 0.2, bun: 0.14 }[style] ?? 0.3;
  if (backLen > 0.02) {
    const prof = [];
    const L = R * (1 + backLen * 2.1);
    for (let i = 8; i >= 0; i--) {         // bottom-up, or the lathe inverts
      const t = i / 8;
      const w = R * (1.06 - Math.pow(t, 2.2) * 0.44);
      prof.push(new THREE.Vector2(w, R * 0.5 - t * L));
    }
    const back = new THREE.Mesh(new THREE.LatheGeometry(prof, 20, Math.PI * 0.42, Math.PI * 1.16), H);
    back.castShadow = true;
    g.add(back);
    // a couple of shards over it so the mass is not a solid shell
    for (const sd of [-1, 0.35]) {
      const s = new THREE.Mesh(shard(R * 0.24, L * 0.92, 0.06), H);
      s.position.set(sd * R * 0.55, R * 0.45, -R * 0.72);
      s.rotation.set(-0.12, 0, sd * 0.08);
      g.add(s);
    }
  }

  // ── style-specific volume ──
  if (style === 'messy' || style === 'short' || style === 'undercut') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      const s = new THREE.Mesh(shard(R * 0.16, R * (0.4 + (i % 3) * 0.16), 0.05), H);
      s.position.set(Math.cos(a) * R * 0.68, R * 0.86, Math.sin(a) * R * 0.62);
      s.rotation.set(-0.9 + Math.sin(i) * 0.4, a, Math.cos(i * 2) * 0.5);
      g.add(s);
    }
  }

  if (style === 'ponytail') {
    const tie = new THREE.Mesh(new THREE.TorusGeometry(R * 0.2, R * 0.05, 6, 14), mats.accent);
    tie.rotation.x = Math.PI / 2;
    tie.position.set(0, R * 0.72, -R * 0.82);
    g.add(tie);
    const tail = new THREE.Mesh(strand(R * 3.1, 0.055, 0.013, 0.9), H);
    tail.position.set(0, R * 0.78, -R * 0.9);
    tail.rotation.set(-0.5, 0, 0);
    tail.castShadow = true;
    tails.add(tail);
    for (const sd of [-1, 1]) {
      const w = new THREE.Mesh(strand(R * 1.9, 0.03, 0.008, 1.0), H);
      w.position.set(sd * R * 0.24, R * 0.7, -R * 0.86);
      w.rotation.set(-0.45, sd * 0.4, sd * 0.2);
      tails.add(w);
    }
  }

  if (style === 'twintails') {
    for (const sd of [-1, 1]) {
      const tie = new THREE.Mesh(new THREE.TorusGeometry(R * 0.17, R * 0.045, 6, 12), mats.accent);
      tie.rotation.set(0, 0, Math.PI / 2);
      tie.position.set(sd * R * 1.0, R * 0.6, -R * 0.2);
      g.add(tie);
      const tail = new THREE.Mesh(strand(R * 2.5, 0.048, 0.012, 1.1), H);
      tail.position.set(sd * R * 1.1, R * 0.62, -R * 0.24);
      tail.rotation.set(-0.15, 0, sd * 0.55);
      tail.castShadow = true;
      tails.add(tail);
    }
  }

  if (style === 'bun') {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(R * 0.44, 14, 12), H);
    bun.scale.set(1, 0.86, 1);
    bun.position.set(0, R * 1.02, -R * 0.42);
    bun.castShadow = true;
    g.add(bun);
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(R * 0.44, R * 0.055, 6, 16), mats.accent);
    wrap.rotation.x = 0.5;
    wrap.position.set(0, R * 0.86, -R * 0.42);
    g.add(wrap);
    for (const sd of [-1, 1]) {
      const w = new THREE.Mesh(shard(R * 0.12, R * 0.9, 0.04), H);
      w.position.set(sd * R * 0.86, R * 0.3, R * 0.18);
      w.rotation.z = sd * 0.16;
      g.add(w);
    }
  }

  if (style === 'hime') {
    // the blunt sidelocks that define a hime cut
    for (const sd of [-1, 1]) {
      const s = new THREE.Mesh(shard(R * 0.26, R * 1.5, 0.07), H);
      s.position.set(sd * R * 0.82, R * 0.45, R * 0.18);
      s.rotation.set(0, 0, sd * 0.04);
      g.add(s);
    }
  }

  return g;
}

/* ───────────── outfits ───────────── */

function buildOutfit(cfg, mats, build) {
  const out = { torso: new THREE.Group(), lower: new THREE.Group(), legs: 'bare', sleeve: 'short' };
  const id = cfg.outfit;
  const A = mats.cloth;       // primary
  const B = mats.cloth2;      // secondary / trim
  const wide = build === 'sturdy';

  const SH = wide ? 0.2 : 0.172;     // half shoulder width
  const WA = wide ? 0.135 : 0.113;   // half waist
  const HI = wide ? 0.152 : 0.155;   // half hip

  /* LatheGeometry winds its faces assuming the profile runs BOTTOM to TOP.
     Hand it a top-down profile and every normal points inward: the front of
     the garment is back-face culled and you see straight through to the
     legs. So every profile here is built upward. */
  const mkTorso = (mat, topY = 0.42, hem = 0.0) => {
    const prof = [
      [WA * 0.9, hem], [WA * 1.1, hem + 0.02], [WA * 1.02, topY - 0.3],
      [WA * 1.2, topY - 0.22], [SH * 1.0, topY - 0.11], [SH * 0.95, topY - 0.035],
      [SH * 0.44, topY],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), mat);
    m.castShadow = true;
    return m;
  };

  // a wrap skirt / sarong lathe, also built upward
  const mkSkirt = (mat, top, bottom, flare) => {
    const prof = [];
    for (let i = 6; i >= 0; i--) {
      const t = i / 6;
      prof.push(new THREE.Vector2(HI * (1.0 + t * flare), top - t * (top - bottom)));
    }
    const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 24), mat);
    m.castShadow = true;
    return m;
  };

  const mkShorts = (mat, len) => {
    const g = new THREE.Group();
    const hip = new THREE.Mesh(new THREE.CylinderGeometry(HI * 1.02, HI * 1.04, 0.14, 18), mat);
    hip.position.y = -0.07;
    g.add(hip);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(HI * 0.56, HI * 0.5, len, 12), mat);
      leg.position.set(s * HI * 0.5, -0.14 - len / 2, 0);
      g.add(leg);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  };

  if (id === 'kebaya') {
    out.torso.add(mkTorso(B, 0.42, 0.0));
    const sash = new THREE.Mesh(new THREE.CylinderGeometry(WA * 1.16, WA * 1.2, 0.075, 20), mats.accent);
    sash.position.y = 0.03;
    out.torso.add(sash);
    out.lower.add(mkSkirt(A, 0.05, -0.5, 0.24));
    out.sleeve = 'short';
  } else if (id === 'yukata') {
    out.torso.add(mkTorso(A, 0.43, 0.0));
    // the crossed collar — the one shape that says yukata
    for (const s of [-1, 1]) {
      const lap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.32, 0.012), B);
      lap.position.set(s * 0.045, 0.3, SH * 0.86);
      lap.rotation.z = s * 0.34;
      out.torso.add(lap);
    }
    const obi = new THREE.Mesh(new THREE.CylinderGeometry(WA * 1.22, WA * 1.24, 0.13, 20), mats.accent);
    obi.position.y = 0.055;
    out.torso.add(obi);
    const knot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.07), mats.accent);
    knot.position.set(0, 0.055, -WA * 1.3);
    out.torso.add(knot);
    out.lower.add(mkSkirt(A, 0.06, -0.54, 0.16));
    out.sleeve = 'wide';
  } else if (id === 'hoodie') {
    out.torso.add(mkTorso(A, 0.44, -0.06));
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10, 0, TAU, 0, Math.PI * 0.55), A);
    hood.rotation.x = -0.7;
    hood.position.set(0, 0.44, -0.075);
    out.torso.add(hood);
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.03), B);
    pocket.position.set(0, 0.06, WA * 1.1);
    out.torso.add(pocket);
    out.lower.add(mkShorts(B, 0.2));
    out.sleeve = 'long';
  } else if (id === 'uniform') {
    out.torso.add(mkTorso(B, 0.44, -0.02));
    // open blazer: two front panels
    for (const s of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.4, 0.02), A);
      panel.position.set(s * 0.075, 0.26, SH * 0.82);
      panel.rotation.z = s * 0.06;
      out.torso.add(panel);
      const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.16), A);
      shoulder.position.set(s * SH * 0.92, 0.28, 0);
      out.torso.add(shoulder);
    }
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.15, 0.015), mats.accent);
    tie.position.set(0, 0.29, SH * 0.88);
    out.torso.add(tie);
    // pleated skirt
    const skirt = mkSkirt(A, 0.02, -0.26, 0.5);
    out.lower.add(skirt);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.28, 0.03), B);
      pl.position.set(Math.cos(a) * HI * 1.34, -0.12, Math.sin(a) * HI * 1.34);
      pl.rotation.y = -a;
      out.lower.add(pl);
    }
    out.legs = 'socks';
    out.sleeve = 'long';
  } else if (id === 'sundress') {
    out.torso.add(mkTorso(A, 0.40, 0.0));
    for (const s of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.14, 0.02), A);
      st.position.set(s * SH * 0.6, 0.5, SH * 0.3);
      out.torso.add(st);
    }
    const sk = mkSkirt(A, 0.05, -0.46, 0.62);
    out.lower.add(sk);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(HI * 1.62, 0.014, 6, 26), B);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = -0.46;
    out.lower.add(trim);
    out.sleeve = 'none';
  } else { // traveler
    out.torso.add(mkTorso(B, 0.43, -0.04));
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(SH * 1.02, WA * 1.16, 0.42, 18, 1, true), A);
    vest.position.y = 0.24;
    out.torso.add(vest);
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(WA * 1.2, WA * 1.22, 0.055, 18), mats.accent);
    belt.position.y = 0.03;
    out.torso.add(belt);
    out.lower.add(mkShorts(B, 0.34));
    out.sleeve = 'long';
  }

  out.torso.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  out.lower.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  out.SH = SH;
  return out;
}

/* ───────────── accessories ───────────── */

function buildAccessory(cfg, mats, R) {
  const id = cfg.accessory;
  const g = new THREE.Group();
  if (id === 'none') return g;

  if (id === 'frangipani' || id === 'earcuff') {
    const f = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), mats.petal);
      p.scale.set(1, 0.4, 0.66);
      const a = (i / 5) * TAU;
      p.position.set(Math.cos(a) * 0.034, 0, Math.sin(a) * 0.034);
      p.rotation.y = -a;
      f.add(p);
    }
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), mats.accent);
    f.add(c);
    f.position.set(R * 1.02, R * 0.42, R * 0.1);
    f.rotation.set(0.4, 0.3, -1.1);
    g.add(f);
  }

  if (id === 'kasa') {
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.15, 20, 1, true), mats.straw);
    brim.material = mats.straw.clone();
    brim.material.side = THREE.DoubleSide;
    brim.position.y = R * 1.06;
    brim.castShadow = true;
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mats.straw);
    knob.position.y = R * 1.06 + 0.09;
    g.add(brim, knob);
  }

  if (id === 'glasses') {
    const frame = mats.dark;
    for (const s of [-1, 1]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.008, 6, 18), frame);
      lens.position.set(s * 0.068, R * 0.02, R * 0.96);
      g.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.007, 0.007), frame);
    bridge.position.set(0, R * 0.04, R * 0.98);
    g.add(bridge);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.007, 0.14), frame);
      arm.position.set(s * 0.115, R * 0.02, R * 0.55);
      g.add(arm);
    }
  }

  if (id === 'ribbon') {
    const centre = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), mats.accent);
    centre.position.set(R * 0.5, R * 0.92, -R * 0.1);
    g.add(centre);
    for (const s of [-1, 1]) {
      const loop = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mats.accent);
      loop.scale.set(1, 0.6, 0.42);
      loop.position.set(R * 0.5 + s * 0.05, R * 0.93, -R * 0.1);
      loop.rotation.z = s * 0.35;
      g.add(loop);
    }
  }

  if (id === 'scarf') {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.028, 7, 18), mats.accent);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = -R * 1.15;
    g.add(wrap);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.24, 0.018), mats.accent);
    tail.position.set(0.05, -R * 1.15 - 0.13, -0.06);
    tail.rotation.x = 0.2;
    g.add(tail);
  }

  return g;
}

/* ───────────── assembly ───────────── */

export function buildAvatar(cfg) {
  const c = { ...defaultAvatar(), ...cfg };
  const skin = find(SKINS, c.skin);
  const hair = find(HAIR_COLORS, c.hairColor);
  const cloth = find(OUTFIT_COLORS, c.outfitColor);

  const mats = {
    skin: lam(skin.hex),
    hair: lam(hair.hex),
    cloth: lam(cloth.hex),
    cloth2: lam(cloth.alt),
    accent: lam(new THREE.Color(cloth.hex).lerp(new THREE.Color('#f2c45a'), 0.55).getStyle()),
    dark: lam('#26232b'),
    petal: lam('#f8f2e4'),
    straw: lam('#d8b878'),
    /* A cutout decal, not a transparent one: alphaTest discards the empty
       pixels in the opaque pass, so the face never writes depth over the
       bare skull and never has to be sorted against the hair. The map
       already carries its own final colours, so the tint stays white. */
    face: new THREE.MeshLambertMaterial({
      map: faceTexture(c),
      alphaTest: 0.04,
      transparent: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  };

  const root = new THREE.Group();
  root.name = 'player';

  const HIP_Y = 0.72;
  const hips = new THREE.Group();
  hips.position.y = HIP_Y;
  root.add(hips);

  const outfit = buildOutfit(c, mats, c.build);
  hips.add(outfit.torso, outfit.lower);

  // neck: short and set low, so the head sits ON the shoulders
  const neckPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.056, 0.07, 12), mats.skin);
  neckPost.position.y = 0.425;
  hips.add(neckPost);

  const neck = new THREE.Group();
  neck.position.y = 0.45;
  hips.add(neck);

  const { group: headGroup, R } = buildHead(c, mats);
  headGroup.position.y = R * 0.98;
  neck.add(headGroup);

  const hairGroup = buildHair(c, mats, R);
  hairGroup.position.y = R * 0.98;
  neck.add(hairGroup);

  const acc = buildAccessory(c, mats, R);
  acc.position.y = R * 0.98;
  neck.add(acc);

  // ── arms ──
  const SH = outfit.SH;
  const mkArm = () => {
    const g = new THREE.Group();
    if (outfit.sleeve === 'long') {
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.043, 0.036, 0.3, 10), mats.cloth);
      sl.position.y = -0.15;
      sl.castShadow = true;
      g.add(sl);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 8), mats.skin);
      hand.position.y = -0.32;
      g.add(hand);
    } else if (outfit.sleeve === 'wide') {
      const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.26, 10), mats.cloth);
      sl.position.y = -0.13;
      sl.castShadow = true;
      g.add(sl);
      const fore = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.08, 3, 8), mats.skin);
      fore.position.y = -0.31;
      g.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 8), mats.skin);
      hand.position.y = -0.38;
      g.add(hand);
    } else {
      if (outfit.sleeve === 'short') {
        const sl = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.042, 0.1, 10), mats.cloth2);
        sl.position.y = -0.05;
        g.add(sl);
      }
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.033, 0.2, 3, 8), mats.skin);
      arm.position.y = -0.19;
      arm.castShadow = true;
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.034, 8, 8), mats.skin);
      hand.position.y = -0.32;
      g.add(hand);
    }
    return g;
  };
  const shoulderL = new THREE.Group(); shoulderL.position.set(-SH * 1.0, 0.38, 0);
  const shoulderR = new THREE.Group(); shoulderR.position.set(SH * 1.0, 0.38, 0);
  shoulderL.add(mkArm());
  shoulderR.add(mkArm());
  shoulderL.rotation.z = 0.14;
  shoulderR.rotation.z = -0.14;
  hips.add(shoulderL, shoulderR);

  // ── legs ──
  const mkLeg = () => {
    const g = new THREE.Group();
    // one continuous leg rather than a thigh floating above a shoe
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.052, 0.44, 4, 12), mats.skin);
    leg.position.y = -0.36;
    leg.castShadow = true;
    g.add(leg);
    if (outfit.legs === 'socks') {
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.052, 0.24, 12), mats.cloth2);
      sock.position.y = -0.52;
      g.add(sock);
    }
    const shoe = new THREE.Mesh(new THREE.CapsuleGeometry(0.054, 0.07, 3, 10), mats.dark);
    shoe.rotation.x = Math.PI / 2;
    shoe.position.set(0, -0.66, 0.028);
    shoe.castShadow = true;
    g.add(shoe);
    return g;
  };
  const hipL = new THREE.Group(); hipL.position.set(-0.075, 0, 0);
  const hipR = new THREE.Group(); hipR.position.set(0.075, 0, 0);
  hipL.add(mkLeg());
  hipR.add(mkLeg());
  hips.add(hipL, hipR);

  root.userData = {
    hips, neck, hat: hairGroup, shoulderL, shoulderR, hipL, hipR,
    cloak: outfit.lower, scarfTail: hairGroup.userData.tails,
    baseHipY: HIP_Y, config: c,
    dispose() {
      root.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          const m = Array.isArray(o.material) ? o.material : [o.material];
          m.forEach((mm) => { if (mm.map) mm.map.dispose(); mm.dispose(); });
        }
      });
    },
  };
  return root;
}
