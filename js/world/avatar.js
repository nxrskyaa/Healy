import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════
   The avatar.

   The rule this is built on, learned the hard way: a stylised
   3D character reads through its SILHOUETTE and a very simple
   face. Detail on the face is not a bonus — past a certain
   point it actively hurts, because a smooth 3D head wearing a
   finely painted stare lands squarely in the uncanny valley.

   So the face is four marks: two eye shapes, two thin brows,
   one highlight each, a small mouth. The front of the skull is
   flattened so those marks sit on a near-flat plane and never
   smear around the curve. Everything expressive lives in the
   hair and the outfit, where it belongs.

   All of it is parametric — the creator screen rebuilds the
   whole figure on every arrow press.
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
   Simplicity is the whole point here.

   A detailed eye — gradient iris, limbal ring, lash flick, blush — painted
   onto a smooth 3D head does not read as anime. It reads as a doll, and a
   doll with a photographic stare is genuinely unpleasant to look at. Every
   stylised 3D game that gets this right does the opposite: solid dark eye
   shapes, one highlight, thin brows, and nothing else. The character then
   reads at six metres, which is where it is actually being seen.

   So: no gradients, no blush, no lash lines. Two shapes and a dot. */

/** the eye outline: a soft rounded almond, taller than it is round */
function eyePath(ctx, w, h, expr) {
  ctx.beginPath();
  if (expr === 'sleepy') {
    // half-lidded: the top is a shallow lid, the bottom a gentle curve
    ctx.moveTo(-w * 0.5, -h * 0.02);
    ctx.quadraticCurveTo(0, -h * 0.34, w * 0.5, -h * 0.02);
    ctx.quadraticCurveTo(0, h * 0.3, -w * 0.5, -h * 0.02);
  } else {
    const top = expr === 'bright' ? -h * 0.62 : -h * 0.54;
    ctx.moveTo(-w * 0.5, h * 0.04);
    // outer corner slightly higher than the inner one: that tilt is the
    // only thing separating a friendly eye from a blank one
    ctx.bezierCurveTo(-w * 0.46, top, w * 0.3, top, w * 0.5, -h * 0.12);
    ctx.bezierCurveTo(w * 0.36, h * 0.46, -w * 0.3, h * 0.5, -w * 0.5, h * 0.04);
  }
  ctx.closePath();
}

function drawEye(ctx, cx, cy, w, h, iris, mirror, expr) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mirror) ctx.scale(-1, 1);

  if (expr === 'smile') {
    // a closed happy eye is an arc, not a shape — the classic ^ ^
    ctx.strokeStyle = '#3a3040';
    ctx.lineWidth = h * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, h * 0.16);
    ctx.quadraticCurveTo(0, -h * 0.42, w * 0.42, h * 0.12);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // A dark rim with the eye colour filling almost all of it. Painting the
  // colour as a translucent wash over near-black just muddies it — an umber
  // eye came out as dried blood.
  eyePath(ctx, w, h, expr);
  ctx.fillStyle = '#2f2836';
  ctx.fill();

  ctx.save();
  eyePath(ctx, w, h, expr);
  ctx.clip();
  const c = new THREE.Color(iris);
  ctx.fillStyle = c.clone().lerp(new THREE.Color('#ffffff'), 0.22).getStyle();
  ctx.beginPath();
  ctx.ellipse(0, h * 0.1, w * 0.4, h * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  // pupil, just dark enough to give the eye a centre
  ctx.fillStyle = 'rgba(30,24,36,0.85)';
  ctx.beginPath();
  ctx.ellipse(0, h * 0.12, w * 0.17, h * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // one highlight. Two is a doll; none is a void.
  if (expr !== 'sleepy') {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(-w * 0.17, -h * 0.22, w * 0.15, h * 0.15, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawBrow(ctx, cx, cy, w, h, color, mirror, expr) {
  ctx.save();
  ctx.translate(cx, cy);
  if (mirror) ctx.scale(-1, 1);
  // brows sit well clear of the eye and stay thin — a heavy brow close to
  // the lash reads as a scowl at any distance
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.lineCap = 'round';
  ctx.lineWidth = h * 0.34;
  const tilt = expr === 'bright' ? -h * 0.3 : (expr === 'sleepy' ? h * 0.2 : 0);
  ctx.beginPath();
  ctx.moveTo(-w * 0.46, h * 0.24 + tilt * 0.3);
  ctx.quadraticCurveTo(0, -h * 0.3 + tilt, w * 0.46, h * 0.06 - tilt * 0.35);
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
  const expr = cfg.expression;

  // Modest. The earlier version made these nearly a third of the face wide,
  // which is where "cute" tips over into "staring".
  const eyeW = S * 0.19, eyeH = S * 0.2;
  const eyeY = S * 0.53;
  const dx = S * 0.155;

  drawEye(ctx, S * 0.5 - dx, eyeY, eyeW, eyeH, iris, true, expr);
  drawEye(ctx, S * 0.5 + dx, eyeY, eyeW, eyeH, iris, false, expr);

  const browCol = new THREE.Color(hair.hex).lerp(new THREE.Color('#ffffff'), 0.12).getStyle();
  drawBrow(ctx, S * 0.5 - dx, eyeY - S * 0.145, S * 0.14, S * 0.038, browCol, true, expr);
  drawBrow(ctx, S * 0.5 + dx, eyeY - S * 0.145, S * 0.14, S * 0.038, browCol, false, expr);

  // mouth: barely there, and gone entirely when the eyes are already smiling
  if (expr !== 'smile') {
    ctx.strokeStyle = 'rgba(150,90,84,0.75)';
    ctx.lineWidth = S * 0.0075;
    ctx.lineCap = 'round';
    const my = S * 0.7;
    ctx.beginPath();
    if (expr === 'bright') {
      ctx.moveTo(S * 0.5 - S * 0.024, my - S * 0.004);
      ctx.quadraticCurveTo(S * 0.5, my + S * 0.02, S * 0.5 + S * 0.024, my - S * 0.004);
    } else if (expr === 'sleepy') {
      ctx.moveTo(S * 0.5 - S * 0.014, my);
      ctx.lineTo(S * 0.5 + S * 0.014, my);
    } else {
      ctx.moveTo(S * 0.5 - S * 0.016, my);
      ctx.quadraticCurveTo(S * 0.5, my + S * 0.011, S * 0.5 + S * 0.016, my);
    }
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(150,90,84,0.75)';
    ctx.lineWidth = S * 0.0085;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(S * 0.5 - S * 0.026, S * 0.695);
    ctx.quadraticCurveTo(S * 0.5, S * 0.722, S * 0.5 + S * 0.026, S * 0.695);
    ctx.stroke();
  }

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

  /* The skull: an ovoid drawn in toward a soft chin, and — the important
     part — flattened across the FRONT. A face painted onto a hemisphere
     smears its features around the curve and the eyes end up staring off
     sideways. Flattening the front gives the marks a plane to sit on, which
     is the same reason cartoon heads are drawn with flat faces. */
  const geo = new THREE.SphereGeometry(R, 26, 22);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = v.y / R;                       // -1 bottom … 1 top
    if (t < 0) {
      // jaw narrows and comes to a soft chin
      const k = 1 - Math.pow(-t, 1.6) * 0.46;
      v.x *= k;
      v.z *= k * 0.98;
      v.y *= 1.1;
    } else {
      v.x *= 1 - t * 0.03;
    }
    if (v.z > 0) {
      // pull the front face plane-ward, most strongly at its centre
      const f = v.z / R;
      v.z *= 1 - 0.3 * f * f;
    } else {
      v.z *= 0.92;                            // and round off the back
    }
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
  const FW = R * 1.5, FH = R * 1.7;
  const FY = -R * 0.06;                       // where the plane sits on the head
  const fg = new THREE.PlaneGeometry(FW, FH, 12, 12);
  const fp = fg.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    const y = fp.getY(i);
    // follow the jaw inward at the bottom
    const t = (y + FH / 2) / FH;              // 0 bottom … 1 top
    const px = x * (1 - Math.pow(1 - t, 2.0) * 0.3);

    /* Sit the plane ON the flattened skull, not in front of it. Solve the
       same two steps the skull went through — sphere, then the front-flatten
       — for this point. Floating the face even a fraction proud of the head
       is not a subtle error: it lights separately, and with shadows on it
       casts eye-shaped shadows onto the cheeks, which is exactly as
       unsettling as it sounds. */
    const hy = y + FY;                        // height in head space
    const r2 = Math.max(0, R * R - px * px - hy * hy);
    const zs = Math.sqrt(r2);
    const f = zs / R;
    const z = zs * (1 - 0.3 * f * f) + R * 0.008;
    fp.setXYZ(i, px, y, z);
  }
  fg.computeVertexNormals();
  const face = new THREE.Mesh(fg, mats.face);
  face.position.y = FY;
  face.castShadow = false;
  face.receiveShadow = false;
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
  /* Its FRONT extent has to stay behind the flattened face. The skull's front
     is at roughly 0.7R, not the 1.0R of a round sphere, so a rear mass sized
     for a round head bulges straight through the cheeks and reads as a dark
     mask over the eyes. Front here reaches 0.48R — comfortably buried. */
  const backCap = new THREE.Mesh(new THREE.SphereGeometry(R * 0.99, 22, 16), H);
  backCap.position.set(0, R * 0.02, -R * 0.36);
  backCap.scale.set(1.04, 1.02, 0.85);
  g.add(backCap);

  // ── bangs: broad locks hanging from the hairline to just above the brow ──
  /* Bangs hug the FLATTENED front (about 0.7R, not the 1.0R of a round
     skull) and stop short of the brow. Left at sphere depth they stand proud
     of the face; left at full length they hang over the eyes. Either way the
     character loses its face, which is most of what made the last version
     look like something out of a horror film. */
  const bangN = style === 'undercut' ? 5 : 7;
  const bangLen = style === 'hime' ? R * 0.46 : R * 0.4;
  for (let i = 0; i < bangN; i++) {
    const t = bangN === 1 ? 0.5 : i / (bangN - 1);
    const a = (t - 0.5) * 1.7;
    const len = bangLen * (0.8 + 0.45 * Math.abs(t - 0.5) * 2);
    const s = new THREE.Mesh(shard(R * 0.36, len, 0.055), H);
    s.position.set(Math.sin(a) * R * 0.66, R * 0.46, Math.cos(a) * R * 0.75);
    s.rotation.set(0.1, a, (t - 0.5) * 0.36);
    g.add(s);
  }

  // ── side locks framing the cheeks ──
  if (style !== 'undercut' && style !== 'short') {
    const sideLen = (style === 'hime' || style === 'long' || style === 'twintails')
      ? R * 1.8 : R * 0.95;
    for (const sd of [-1, 1]) {
      // narrow, and set back beside the cheek rather than across it
      const s = new THREE.Mesh(shard(R * 0.16, sideLen, 0.055), H);
      s.position.set(sd * R * 0.9, R * 0.34, R * 0.06);
      s.rotation.set(0.04, sd * 0.25, sd * 0.1);
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

  /* Hair casts no shadow. It is a deliberate stylised-rendering choice, not
     a saving: a fringe hanging over the brow throws the eyes into shade from
     almost every sun angle, and a character whose eyes are a dark smudge has
     no face at all. Every cel-shaded game drops this shadow for the same
     reason. */
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });

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
