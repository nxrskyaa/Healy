import * as THREE from 'three';
import { clamp, makeRandom } from './noise.js';
import {
  pbr, skinTexture, clothTexture, batikTexture, furTexture, thatchTexture,
} from './textures.js';

/* ═══════════════════════════════════════════════════════════
   The avatar: a stylised figure at 5.5 head-heights, built on
   a real skeleton of nested joints.

   Three things this rebuild is organised around, each of them
   a fix for a mistake that shipped before.

   ONE. Proportion is a decision, not an accident. 5.5 heads on
   a 1.60 m figure. Below about 5 the language has to switch to
   chibi — thick stubby limbs, no neck, mitten hands — and the
   old figure sat at 3.7 heads with realistically thin adult
   limbs, which is the valley between the two and reads as a
   bobblehead. The head is now NARROWER than the shoulders
   (0.196 against 0.40), which is the single ratio that decides
   whether a character reads as a person.

   TWO. One function owns the head surface. skullPoint() is the
   only thing in this file that knows where the skull is, and
   the hair, the ears, the face patch and the glasses all ask
   it. Hair used to be placed against a sphere of radius R while
   the skull was flattened to 0.7R at the front, so it punched
   through the cheeks. That failure mode is now unreachable.
   The body has the same arrangement in BODY/slice(): a garment
   is cut from the body's own cross-sections, so a shirt cannot
   burst through the vest over it.

   THREE. The face is four marks. Gradient irises, limbal
   rings, lash flicks and blush painted onto a smooth 3D head
   land in the uncanny valley — the character stops reading as
   drawn and starts reading as a doll. Solid eye shapes, one
   highlight, thin brows, a small mouth. Everything expressive
   lives in the hair and the outfit.

   player.js animates by rotating joints, so every joint here is
   a genuine Group at a genuine anatomical position and every
   mesh is built with its origin AT its joint.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* Metres of surface per texture tile. Every loft below emits UVs in real
   world units instead of 0..1, so one weave is the same physical size on a
   sleeve as on a skirt — otherwise the cloth on a narrow forearm comes out
   four times finer than the cloth on the torso and reads as noise. */
const UV = 0.26;

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
  { id: 'none',       name: 'None' },
  { id: 'frangipani', name: 'Frangipani' },
  { id: 'kasa',       name: 'Straw hat' },
  { id: 'glasses',    name: 'Glasses' },
  { id: 'ribbon',     name: 'Ribbon' },
  { id: 'earcuff',    name: 'Ear flower' },
  { id: 'scarf',      name: 'Scarf' },
];

export const BUILDS = [
  { id: 'slight', name: 'Slight' },
  { id: 'sturdy', name: 'Sturdy' },
];

export const EXPRESSIONS = [
  { id: 'calm',   name: 'Calm' },
  { id: 'smile',  name: 'Smiling' },
  { id: 'sleepy', name: 'Sleepy' },
  { id: 'bright', name: 'Bright' },
  { id: 'wink',   name: 'Wink' },
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

/* ───────────── the measurements ─────────────

   Every number below is a world height in metres with the soles at 0. They
   are laid out here rather than sprinkled through the builders because the
   whole figure has to agree about where a joint is: player.js rotates the
   joint, this file has to have hung the right mesh off it.

   Total 1.60 m at 5.5 head-heights (head chin-to-crown 0.29). Legs are 52.5%
   of standing height, which is the stylised-game convention — a shade longer
   than life, and what keeps a large head from reading as squat. */

const Y = {
  sole: 0.000,
  ankle: 0.075,
  knee: 0.440,
  hip: 0.840,     // the pelvis pivot, and baseHipY
  spine: 0.940,   // lumbar
  chest: 1.090,   // thoracic
  shoulder: 1.215,
  neck: 1.235,
  headJoint: 1.300,
};

const LIMB = {
  thigh: Y.hip - Y.knee,        // 0.400
  shin: Y.knee - Y.ankle,       // 0.365
  upperArm: 0.250,
  forearm: 0.225,
  hand: 0.120,                  // shoulder to fingertip 0.595
};

/* ───────────── the head surface ─────────────

   skullPoint() is the ONE function that knows the shape of the head. The mesh
   is generated from it, the ears sit on it, the face patch is bent onto it and
   every hair placement grows out of it. Nothing in this file hand-places a z
   against the head, which is what used to go wrong. */

const HEAD = {
  rx: 0.098,   // half width  -> 0.196 across, against a 0.40 shoulder span
  ry: 0.145,   // half height -> 0.290 chin to crown
  rz: 0.107,
  cy: 0.155,   // skull centre above the head joint (the joint sits at the jaw)
  cz: 0.010,   // and a little ahead of it, where the atlas actually is
};

/* A whole number of texture tiles around the skull. Deriving u from the raw
   azimuth leaves a fractional span, so the map never closes on itself and a
   seam runs down the back of the head — right where the hair's fur strokes
   are the loudest thing on the figure. */
const HEAD_USPAN = Math.max(1, Math.round(TAU * HEAD.rx / UV));

/** How far the skull draws in at a given height: a soft chin below, a slightly
    narrowed crown above. Shared with the face-patch mapping, so a mark painted
    at 0.7 of the half-width lands at 0.7 of the half-width. */
function jawTaper(ny) {
  return ny < 0 ? 1 - Math.pow(-ny, 1.7) * 0.40 : 1 - ny * 0.06;
}

/**
 * A point on the skull for any direction. `grow` scales the whole ovoid, so a
 * hair shell built at grow 1.08 is guaranteed to enclose the head everywhere —
 * that is the property the old sphere-versus-flattened-skull code lacked.
 */
function skullPoint(nx, ny, nz, grow = 1, out = new THREE.Vector3()) {
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  const k = jawTaper(ny);
  const x = nx * HEAD.rx * grow * k;
  const y = ny * HEAD.ry * grow;
  let z = nz * HEAD.rz * grow * k * (ny < 0 ? 0.96 : 1);
  if (z > 0) {
    // The front is pulled plane-ward. Features painted on a hemisphere smear
    // around the curve and the eyes end up looking off sideways; cartoon heads
    // are drawn with flat faces for exactly this reason.
    const f = z / (HEAD.rz * grow);
    z *= 1 - 0.26 * f * f;
  } else {
    z *= 0.97;
  }
  return out.set(x, y, z);
}

/* The face patch is parameterised by angle, not by x/y — so converting "the
   outer eye corner sits at 0.71 of the half-width" into a canvas coordinate is
   an arcsine, not a scale. Getting that wrong is what put the last version's
   eyes out on the cheekbones. */
const FACE_YAW = 1.10;
const FACE_PITCH = 0.86;

/** Yaw and pitch of a mark given as fractions of the skull's half-extents. */
function faceAngles(xFrac, yFrac) {
  const pitch = Math.asin(clamp(yFrac, -0.999, 0.999));
  const k = Math.cos(pitch) * jawTaper(Math.sin(pitch));
  return [Math.asin(clamp(xFrac / k, -0.999, 0.999)), pitch];
}

/** Unit direction toward a point named in face fractions. */
function faceDir(xFrac, yFrac) {
  const [yaw, pitch] = faceAngles(xFrac, yFrac);
  const cp = Math.cos(pitch);
  return [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
}

/** Where a face mark lands on the texture. */
const cU = (xFrac, yFrac) => 0.5 + 0.5 * faceAngles(xFrac, yFrac)[0] / FACE_YAW;
const cV = (yFrac) => 0.5 - 0.5 * faceAngles(0, yFrac)[1] / FACE_PITCH;

/* Face layout, in fractions of the skull half-width / half-height. The eye is
   0.50 of the half-width across — 25% of the whole head, which is where
   stylised sits: a real eye is ~20%, anime 25-30%, and the previous pass
   shrank these to 14% and tipped the character over into doll. */
const EYE = { x: 0.46, y: -0.16, hw: 0.25, hh: 0.10 };
const BROW = { y: 0.052, hw: 0.29, hh: 0.020 };
const MOUTH = { y: -0.57, hw: 0.15 };
const NOSE_Y = -0.37;

/* ───────────── the body surface ─────────────

   The same discipline as the head: one table of elliptical cross-sections
   describes the torso, and every garment is cut from it with slice(). A vest
   built at pad 0.012 physically cannot be inside the shirt built at pad 0.006.

   The sections are ellipses, not circles. A lathe gives depth == width and the
   result reads as turned pottery rather than a person; a human torso is closer
   to 1.6:1, which is the rz/rx ratio here. */

function bodySections(build) {
  const w = build === 'sturdy' ? 1.09 : 1.0;
  const d = build === 'sturdy' ? 1.11 : 1.0;
  return [
    { y: 0.755, rx: 0.088, rz: 0.062 },   // where the thighs leave the pelvis
    { y: 0.820, rx: 0.112, rz: 0.076 },   // hip shelf
    { y: 0.880, rx: 0.107, rz: 0.071 },
    { y: 0.940, rx: 0.095, rz: 0.062 },   // waist
    { y: 1.000, rx: 0.094, rz: 0.062 },
    { y: 1.060, rx: 0.104, rz: 0.068 },
    { y: 1.120, rx: 0.114, rz: 0.074 },   // chest
    { y: 1.180, rx: 0.119, rz: 0.072 },
    { y: 1.230, rx: 0.100, rz: 0.062 },   // the trapezius slope
    { y: 1.268, rx: 0.060, rz: 0.053 },   // neck root
  ].map((s) => ({ y: s.y, rx: s.rx * w, rz: s.rz * d }));
}

/** Half the distance between the shoulder joints. */
const shoulderHalf = (build) => (build === 'sturdy' ? 0.163 : 0.150);

const lerpSection = (a, b, t) => ({
  y: a.y + (b.y - a.y) * t,
  rx: a.rx + (b.rx - a.rx) * t,
  rz: a.rz + (b.rz - a.rz) * t,
  cz: (a.cz || 0) + ((b.cz || 0) - (a.cz || 0)) * t,
});

/** The cross-section at any height, interpolated. Sections run bottom-up. */
function sectionAt(list, y) {
  if (y <= list[0].y) return { ...list[0], y };
  const n = list.length;
  if (y >= list[n - 1].y) return { ...list[n - 1], y };
  let i = 1;
  while (list[i].y < y) i++;
  const a = list[i - 1], b = list[i];
  return lerpSection(a, b, (y - a.y) / (b.y - a.y));
}

/**
 * Cut a stack of sections between two heights, pushed out by `pad` and shifted
 * by `dy` into the local space of whichever joint carries it. This is how every
 * garment in the file is made, so nothing can ever be inside the body it wraps.
 */
function slice(list, y0, y1, pad = 0, dy = 0) {
  const out = [sectionAt(list, y0)];
  for (const s of list) if (s.y > y0 + 1e-4 && s.y < y1 - 1e-4) out.push({ ...s });
  out.push(sectionAt(list, y1));
  return out.map((s) => ({
    y: s.y + dy, rx: s.rx + pad, rz: s.rz + pad, cz: s.cz || 0,
  }));
}

/* ───────────── geometry helpers ───────────── */

/**
 * Loft a stack of elliptical cross-sections into a closed solid, bottom-up.
 *
 * Closed matters: the old torso was an uncapped lathe, so from any high camera
 * angle you looked down a 3 cm hole around the neck and out through the far
 * wall of the shirt. Both ends are capped here.
 *
 * `wave` scallops the radius into pleats, fading to nothing at the top where a
 * real pleat is stitched flat.
 */
function loft(sections, opts = {}) {
  const {
    seg = 20, capBottom = true, capTop = true, uvScale = UV, wave = 0, waveN = 12,
  } = opts;
  const rows = sections.length;
  const pos = [], uvs = [], idx = [];
  const y0 = sections[0].y;

  /* ONE u span for the whole loft, snapped to a whole number of tiles.
     Recomputing it per ring from that ring's own radii makes u at a fixed
     azimuth drift from row to row — a third of a tile across a waist, which
     shears a batik lattice into a visibly pinched motif — and leaving it
     unrounded means the seam never closes, so there is a ragged join running
     straight down the back of every garment. */
  const mid = sections[(rows / 2) | 0];
  const uSpan = Math.max(1, Math.round(Math.PI * (mid.rx + mid.rz) / uvScale));

  for (let r = 0; r < rows; r++) {
    const s = sections[r];
    const cz = s.cz || 0;
    const amp = wave * (1 - r / (rows - 1));
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const k = 1 + amp * Math.cos(a * waveN);
      pos.push(Math.cos(a) * s.rx * k, s.y, cz + Math.sin(a) * s.rz * k);
      uvs.push((i / seg) * uSpan, (s.y - y0) / uvScale);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < seg; i++) {
      const a = r * (seg + 1) + i, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const cap = (r, up) => {
    const c = pos.length / 3;
    const s = sections[r];
    pos.push(0, s.y, s.cz || 0);
    uvs.push(0, 0);
    const row = r * (seg + 1);
    for (let i = 0; i < seg; i++) {
      if (up) idx.push(c, row + i + 1, row + i);
      else idx.push(c, row + i, row + i + 1);
    }
  };
  if (capBottom) cap(0, false);
  if (capTop) cap(rows - 1, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Every primitive here has to be re-UV'd into the same world-unit scheme the
 * lofts use. Three's built-ins parameterise 0..1 regardless of size, so a
 * 4 cm hair lock and a 30 cm scalp would each show exactly one tile — the same
 * fur map appearing five times coarser on the bangs than on the head they are
 * lying against. Grain that changes scale across a seam is more distracting
 * than no grain at all.
 */
function worldUv(geo, uTiles, vTiles) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * uTiles, uv.getY(i) * vTiles);
  }
  return geo;
}

/** An ellipsoid with real UVs — used for the deltoid, buns, petals, ear. */
function blob(rx, ry, rz, seg = 14) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 4));
  g.scale(rx, ry, rz);
  return worldUv(g, Math.max(1, TAU * rx / UV), Math.max(1, Math.PI * ry / UV));
}

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
  return worldUv(g, Math.max(1, TAU * w0 / UV), Math.max(1, len / UV));
}

/**
 * A flat angular hair shard: broad at the root, drawn to a point at the tip,
 * hanging down from its origin. ConeGeometry puts its apex at +Y, so it has to
 * be turned over first — otherwise every lock is a spike pointing at the sky.
 */
function shard(w, len, thick = 0.045) {
  const g = new THREE.ConeGeometry(w, len, 4, 1);
  g.rotateX(Math.PI);
  g.scale(1, 1, thick / w);
  g.translate(0, -len / 2, 0);
  return worldUv(g, Math.max(1, 8 * w / UV), Math.max(1, len / UV));
}

/* ───────────── the face ─────────────

   Four marks. A detailed eye — gradient iris, limbal ring, lash flick, blush —
   painted onto a smooth 3D head does not read as anime, it reads as a doll,
   and a doll with a photographic stare is genuinely unpleasant to look at.
   Every stylised game that gets this right does the opposite: solid dark eye
   shapes, one highlight, thin brows, nothing else. The character then reads at
   six metres, which is where it is actually being seen. */

/** The eye outline, drawn in a unit box so it can be scaled into any bbox. */
function eyePath(ctx, expr) {
  ctx.beginPath();
  if (expr === 'sleepy') {
    // half-lidded: a shallow lid over a gentle lower curve
    ctx.moveTo(-0.5, -0.02);
    ctx.quadraticCurveTo(0, -0.36, 0.5, -0.02);
    ctx.quadraticCurveTo(0, 0.3, -0.5, -0.02);
  } else {
    const top = expr === 'bright' ? -0.62 : -0.54;
    ctx.moveTo(-0.5, 0.04);
    // the outer corner rides higher than the inner one; that tilt is the only
    // thing separating a friendly eye from a blank one
    ctx.bezierCurveTo(-0.46, top, 0.3, top, 0.5, -0.12);
    ctx.bezierCurveTo(0.36, 0.46, -0.3, 0.5, -0.5, 0.04);
  }
  ctx.closePath();
}

function drawEye(ctx, box, iris, mirror, expr) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  ctx.save();
  ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
  ctx.scale(mirror ? -w : w, h);

  const closed = expr === 'smile' || (expr === 'wink' && mirror);
  if (closed) {
    // a closed happy eye is an arc, not a shape — the classic ^ ^
    ctx.strokeStyle = '#3a3040';
    ctx.lineWidth = 0.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-0.42, 0.16);
    ctx.quadraticCurveTo(0, -0.42, 0.42, 0.12);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // A dark rim with the eye colour filling almost all of it. Painting the
  // colour as a translucent wash over near-black just muddies it — an umber
  // eye came out as dried blood.
  eyePath(ctx, expr);
  ctx.fillStyle = '#2f2836';
  ctx.fill();

  ctx.save();
  eyePath(ctx, expr);
  ctx.clip();
  const c = new THREE.Color(iris);
  ctx.fillStyle = c.clone().lerp(new THREE.Color('#ffffff'), 0.22).getStyle();
  ctx.beginPath();
  ctx.ellipse(0, 0.1, 0.4, 0.4, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(30,24,36,0.85)';
  ctx.beginPath();
  ctx.ellipse(0, 0.12, 0.17, 0.19, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // one highlight. Two is a doll; none is a void.
  if (expr !== 'sleepy') {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.ellipse(-0.17, -0.22, 0.15, 0.15, -0.35, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawBrow(ctx, box, color, mirror, expr) {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0, h = y1 - y0;
  ctx.save();
  ctx.translate((x0 + x1) / 2, (y0 + y1) / 2);
  ctx.scale(mirror ? -w : w, h);
  // thin, and well clear of the lash — a heavy brow close to the eye reads as
  // a scowl at any distance
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.82;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.34;
  const tilt = expr === 'bright' ? -0.3 : (expr === 'sleepy' ? 0.2 : 0);
  ctx.beginPath();
  ctx.moveTo(-0.46, 0.24 + tilt * 0.3);
  ctx.quadraticCurveTo(0, -0.3 + tilt, 0.46, 0.06 - tilt * 0.35);
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

  // A mark's box comes from the same arcsine mapping the patch geometry uses,
  // so "the eye is a quarter of the head wide" is true of the rendered head and
  // not just of the canvas.
  const box = (xa, xb, ya, yb) => [
    cU(xa, (ya + yb) / 2) * S, cV(yb) * S, cU(xb, (ya + yb) / 2) * S, cV(ya) * S,
  ];

  for (const side of [-1, 1]) {
    const cx = EYE.x * side;
    const inner = cx - EYE.hw * side, outer = cx + EYE.hw * side;
    drawEye(ctx,
      box(Math.min(inner, outer), Math.max(inner, outer), EYE.y - EYE.hh, EYE.y + EYE.hh),
      iris, side < 0, expr);
  }

  const browCol = new THREE.Color(hair.hex)
    .lerp(new THREE.Color('#ffffff'), 0.12).getStyle();
  for (const side of [-1, 1]) {
    const a = (EYE.x - BROW.hw) * side, b = (EYE.x + BROW.hw) * side;
    drawBrow(ctx,
      box(Math.min(a, b), Math.max(a, b), BROW.y - BROW.hh, BROW.y + BROW.hh),
      browCol, side < 0, expr);
  }

  // The faintest possible nose: without it the middle of the face is a void,
  // and anything more than a tick starts competing with the eyes.
  ctx.strokeStyle = 'rgba(150,110,96,0.20)';
  ctx.lineWidth = S * 0.006;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cU(-0.06, NOSE_Y) * S, cV(NOSE_Y + 0.02) * S);
  ctx.lineTo(cU(-0.02, NOSE_Y) * S, cV(NOSE_Y - 0.01) * S);
  ctx.stroke();

  // mouth: barely there, and gone entirely when the eyes are already smiling
  const mx0 = cU(-MOUTH.hw, MOUTH.y) * S, mx1 = cU(MOUTH.hw, MOUTH.y) * S;
  const my = cV(MOUTH.y) * S;
  const mw = (mx1 - mx0) / 2, mc = (mx0 + mx1) / 2;
  ctx.strokeStyle = 'rgba(150,90,84,0.75)';
  ctx.lineWidth = S * 0.008;
  ctx.beginPath();
  if (expr === 'sleepy') {
    ctx.moveTo(mc - mw * 0.5, my);
    ctx.lineTo(mc + mw * 0.5, my);
  } else if (expr === 'bright' || expr === 'smile') {
    ctx.moveTo(mc - mw * 0.9, my - S * 0.006);
    ctx.quadraticCurveTo(mc, my + S * 0.026, mc + mw * 0.9, my - S * 0.006);
  } else {
    ctx.moveTo(mc - mw * 0.62, my);
    ctx.quadraticCurveTo(mc, my + S * 0.014, mc + mw * 0.62, my);
  }
  ctx.stroke();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ───────────── the head ───────────── */

/** The skull mesh, generated straight out of skullPoint. */
function skullGeometry(grow = 1, segP = 32, segT = 24) {
  const pos = [], uvs = [], idx = [];
  const p = new THREE.Vector3();
  for (let r = 0; r <= segT; r++) {
    const t = (r / segT) * Math.PI;
    const st = Math.sin(t), ct = Math.cos(t);
    for (let i = 0; i <= segP; i++) {
      const phi = (i / segP) * TAU;
      skullPoint(Math.sin(phi) * st, ct, Math.cos(phi) * st, grow, p);
      pos.push(p.x, p.y, p.z);
      uvs.push((i / segP) * HEAD_USPAN, (p.y + HEAD.ry) / UV);
    }
  }
  for (let r = 0; r < segT; r++) {
    for (let i = 0; i < segP; i++) {
      const a = r * (segP + 1) + i, b = a + segP + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The face decal: a plane whose every vertex is evaluated on the skull itself,
 * so it can neither float proud of the head nor sink into it. Parameterising by
 * angle also means the patch follows the jaw inward on its own — the old
 * version solved the sphere by hand and its bottom corners collapsed to the
 * head centre, leaving flat wings beside the chin.
 */
function faceGeometry(seg = 16) {
  const g = new THREE.PlaneGeometry(2, 2, seg, seg);
  const pos = g.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const yaw = pos.getX(i) * FACE_YAW;
    const pitch = pos.getY(i) * FACE_PITCH;
    const cp = Math.cos(pitch);
    const nx = Math.sin(yaw) * cp, ny = Math.sin(pitch), nz = Math.cos(yaw) * cp;
    skullPoint(nx, ny, nz, 1, p);
    // a hair's breadth proud, backed up by polygonOffset on the material
    pos.setXYZ(i, p.x + nx * 0.0012, p.y + ny * 0.0012, p.z + nz * 0.0012);
  }
  g.computeVertexNormals();
  return g;
}

function buildHead(cfg, mats) {
  const g = new THREE.Group();

  const head = new THREE.Mesh(skullGeometry(), mats.skin);
  head.castShadow = true;
  g.add(head);

  // ears, sitting on the surface at the direction they belong to
  const earDir = [1, -0.10, -0.24];
  for (const s of [-1, 1]) {
    const at = skullPoint(earDir[0] * s, earDir[1], earDir[2], 0.90);
    const ear = new THREE.Mesh(blob(0.020, 0.031, 0.021, 10), mats.skin);
    ear.position.copy(at);
    ear.rotation.set(0, 0, -s * 0.18);
    g.add(ear);
    /* A concha in the darker skin tone, so the ear is a form and not a nub.
       It has to break the ear's surface to be seen at all — offset by less
       than the radius difference it stays strictly inside an opaque
       ellipsoid and never renders, which is what was happening. */
    const dent = new THREE.Mesh(blob(0.0072, 0.0153, 0.009, 8), mats.skinDeep);
    dent.position.copy(at);
    dent.position.x += s * 0.016;
    dent.position.z += 0.004;
    g.add(dent);
  }

  const face = new THREE.Mesh(faceGeometry(), mats.face);
  // The decal must not cast: with shadows on, eye-shaped shadows land on the
  // cheeks, which is exactly as unsettling as it sounds.
  face.castShadow = false;
  face.receiveShadow = false;
  g.add(face);

  return g;
}

/* ───────────── hair ─────────────

   Everything here grows out of skullPoint at grow >= 1.05, so no lock can be
   inside the skull no matter what the head shape does. */

const HAIR = {
  short:     { front: 1.12, back: 2.15, len: 0.00, side: 0.00, tuft: 1 },
  messy:     { front: 1.16, back: 2.32, len: 0.05, side: 0.06, tuft: 1 },
  bob:       { front: 1.12, back: 2.55, len: 0.15, side: 0.13 },
  long:      { front: 1.12, back: 2.60, len: 0.50, side: 0.28 },
  hime:      { front: 1.04, back: 2.60, len: 0.54, side: 0.34, blunt: 1 },
  ponytail:  { front: 1.15, back: 2.28, len: 0.05, side: 0.11, tail: 'pony' },
  twintails: { front: 1.15, back: 2.24, len: 0.05, side: 0.12, tail: 'twin' },
  bun:       { front: 1.14, back: 2.28, len: 0.04, side: 0.10, bun: 1 },
  undercut:  { front: 1.04, back: 1.60, len: 0.00, side: 0.00, tuft: 1 },
};

/** How far down the skull the cap comes, per azimuth. phi 0 faces forward. */
function hairline(phi, p) {
  const a = 0.5 + 0.5 * Math.cos(phi);          // 1 at the face, 0 at the nape
  return p.back + (p.front - p.back) * Math.pow(a, 0.8);
}

const dirAt = (phi, t) => [
  Math.sin(phi) * Math.sin(t), Math.cos(t), Math.cos(phi) * Math.sin(t),
];

/**
 * The cap: the skull's own shape at grow 1.08, cut off along the hairline and
 * curled back in at the edge so the rim reads as thickness rather than as a
 * paper-thin hole.
 */
function hairCap(p, segP = 34, segT = 14) {
  const rows = segT + 3;
  const pos = [], uvs = [], idx = [];
  const v = new THREE.Vector3();
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i <= segP; i++) {
      const phi = (i / segP) * TAU;
      const hl = hairline(phi, p);
      let t, grow;
      if (r <= segT) {
        t = (r / segT) * hl;
        grow = 1.08;
      } else {
        const k = (r - segT) / 2;
        t = hl + 0.09 * k;
        grow = 1.08 - 0.076 * k;
      }
      const d = dirAt(phi, t);
      skullPoint(d[0], d[1], d[2], grow, v);
      pos.push(v.x, v.y, v.z);
      uvs.push((i / segP) * HEAD_USPAN, t * HEAD.ry / UV);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let i = 0; i < segP; i++) {
      const a = r * (segP + 1) + i, b = a + segP + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * The length: a curtain rooted on the cap's own edge and falling from it, so
 * the join is exact whatever the hairline is doing at that azimuth.
 */
function hairCurtain(p, len, phi0, phiSpan, segP = 24, segL = 9) {
  const pos = [], uvs = [], idx = [];
  const root = new THREE.Vector3();
  for (let j = 0; j <= segL; j++) {
    const s = j / segL;
    const drop = len * s;
    /* Past the jaw the curtain has to clear the shoulders and the back. The
       chest is both wider and deeper than the skull, so hair falling straight
       down off the head sinks straight into it — the section therefore lerps
       from the skull's own outline onto a hair-volume ellipse set back from the
       spine, and it does so by how far it has actually dropped, not by how far
       along it is. A bob never gets there and stays a bob. */
    const k = clamp((drop - 0.10) / 0.14, 0, 1);
    const draw = 1 - 0.18 * s * s;
    for (let i = 0; i <= segP; i++) {
      const phi = phi0 + (i / segP) * phiSpan;
      const hl = hairline(phi, p) * 0.94;
      const d = dirAt(phi, hl);
      skullPoint(d[0], d[1], d[2], 1.09, root);
      const h = Math.hypot(root.x, root.z) || 1;
      const tx = (root.x / h) * 0.140;
      const tz = (root.z / h) * 0.115 - 0.035;
      pos.push(
        (root.x + (tx - root.x) * k) * draw,
        root.y - drop,
        (root.z + (tz - root.z) * k) * draw
      );
      uvs.push((i / segP) * phiSpan * HEAD.rx / UV, drop / UV);
    }
  }
  for (let j = 0; j < segL; j++) {
    for (let i = 0; i < segP; i++) {
      const a = j * (segP + 1) + i, b = a + segP + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildHair(cfg, mats) {
  const g = new THREE.Group();
  const p = HAIR[cfg.hair] || HAIR.short;
  const H = mats.hair;
  const rnd = makeRandom(cfg.hair.length * 977 + 13);

  /* Anything that should swing when she runs goes in here. Its pivot is the
     skull centre, which is where a ponytail actually hinges, so the animator
     rotates one group and styles with no tail get an empty one. */
  const tails = new THREE.Group();
  g.add(tails);
  g.userData.tails = tails;

  g.add(new THREE.Mesh(hairCap(p), H));

  /* The curtain is the BACK mass only. Carried round to the front it lands
     inside the deltoid, which no amount of flare fixes without skinning; the
     face-framing is done by the side locks below instead. */
  if (p.len > 0.02) {
    g.add(new THREE.Mesh(hairCurtain(p, p.len, Math.PI * 0.60, Math.PI * 0.80), H));
  }

  /* Bangs. Rooted on the hairline and stopping short of the brow: left at
     sphere depth they stand proud of the face, left long they hang over the
     eyes, and either way the character loses its face. */
  const bangN = p.tuft ? 5 : 7;
  for (let i = 0; i < bangN; i++) {
    const t = bangN === 1 ? 0.5 : i / (bangN - 1);
    const phi = (t - 0.5) * 1.75;
    const hl = hairline(phi, p) * 0.97;
    const d = dirAt(phi, hl);
    const at = skullPoint(d[0], d[1], d[2], 1.055);
    const len = 0.046 + Math.abs(t - 0.5) * 0.05 + (p.blunt ? 0.008 : 0);
    const s = new THREE.Mesh(shard(0.030, len, 0.014), H);
    s.rotation.order = 'YXZ';           // yaw first, so the tilt is in-plane
    s.position.copy(at);
    s.rotation.set(-0.13, phi, (t - 0.5) * 0.34);
    g.add(s);
  }

  /* Side locks framing the cheeks, set beside them rather than across them —
     plus, on the long cuts, a second pair behind the ear to close the strip the
     back curtain deliberately leaves bare. */
  if (p.side > 0.01) {
    const locks = [[0.38, p.side, p.blunt ? 0.026 : 0.017]];
    if (p.len > 0.25) locks.push([0.55, p.len * 0.72, 0.024]);
    for (const [turn, len, wide] of locks) {
      for (const sd of [-1, 1]) {
        const phi = sd * Math.PI * turn;
        const d = dirAt(phi, hairline(phi, p) * 0.78);
        const at = skullPoint(d[0], d[1], d[2], 1.06);
        const s = new THREE.Mesh(shard(wide, len, 0.014), H);
        s.rotation.order = 'YXZ';
        s.position.copy(at);
        s.rotation.set(0.04, phi, sd * 0.06);
        g.add(s);
      }
    }
  }

  // crown volume for the cropped and messy cuts, so they are not skullcaps
  if (p.tuft) {
    for (let i = 0; i < 9; i++) {
      const phi = (i / 9) * TAU;
      const d = dirAt(phi, 0.55 + rnd() * 0.35);
      const at = skullPoint(d[0], d[1], d[2], 1.07);
      const s = new THREE.Mesh(shard(0.016, 0.04 + rnd() * 0.03, 0.012), H);
      s.rotation.order = 'YXZ';
      s.position.copy(at);
      s.rotation.set(-0.9 + rnd() * 0.5, phi, (rnd() - 0.5) * 0.8);
      g.add(s);
    }
  }

  if (p.tail === 'pony') {
    const d = dirAt(Math.PI, 1.05);
    const at = skullPoint(d[0], d[1], d[2], 1.12);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.008, 6, 14), mats.accent);
    tie.rotation.x = Math.PI / 2;
    tie.position.copy(at);
    g.add(tie);
    /* No rest pitch on the tail. strand() already curves it backward, and that
       backward reach is doing real work: player.js swings scarfTail by -0.3 rad
       at a full run, which is FORWARD, and a tail that hung vertically at rest
       would be driven straight through the shoulder blades. Starting it behind
       the head is what keeps the run clear of the back. */
    const tail = new THREE.Mesh(strand(0.44, 0.05, 0.012, 0.9), H);
    tail.position.copy(at);
    tails.add(tail);
    for (const sd of [-1, 1]) {
      const w = new THREE.Mesh(strand(0.27, 0.028, 0.008, 1.0), H);
      w.position.copy(at);
      w.position.x += sd * 0.024;
      w.rotation.set(0, sd * 0.35, sd * 0.18);
      tails.add(w);
    }
  }

  if (p.tail === 'twin') {
    for (const sd of [-1, 1]) {
      const d = dirAt(sd * Math.PI * 0.44, 1.25);
      const at = skullPoint(d[0], d[1], d[2], 1.14);
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.007, 6, 12), mats.accent);
      tie.rotation.set(0, 0, Math.PI / 2);
      tie.position.copy(at);
      g.add(tie);
      const tail = new THREE.Mesh(strand(0.35, 0.044, 0.011, 1.1), H);
      tail.position.copy(at);
      tail.rotation.set(-0.12, 0, sd * 0.5);
      tails.add(tail);
    }
  }

  if (p.bun) {
    const d = dirAt(Math.PI, 0.72);
    const at = skullPoint(d[0], d[1], d[2], 1.1);
    const bun = new THREE.Mesh(blob(0.045, 0.039, 0.045, 14), H);
    bun.position.copy(at);
    g.add(bun);
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16), mats.accent);
    wrap.rotation.x = 0.5;
    wrap.position.copy(at);
    wrap.position.y -= 0.014;
    g.add(wrap);
  }

  /* Hair casts no shadow. A deliberate stylised-rendering choice, not a saving:
     a fringe over the brow throws the eyes into shade from almost every sun
     angle, and a character whose eyes are a dark smudge has no face at all. */
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  return g;
}

/* ───────────── limbs ─────────────

   Every limb mesh is lofted from y = 0 downward, so its origin is the joint it
   hangs from and rotating that joint does what you expect. */

const ARM_UPPER = [
  { y: -0.250, rx: 0.031, rz: 0.031 },
  { y: -0.170, rx: 0.035, rz: 0.035 },
  { y: -0.060, rx: 0.042, rz: 0.043 },
  { y:  0.020, rx: 0.048, rz: 0.049 },
  { y:  0.055, rx: 0.044, rz: 0.045 },
];

const ARM_FORE = [
  { y: -0.225, rx: 0.021, rz: 0.023 },   // wrist
  { y: -0.140, rx: 0.026, rz: 0.028 },
  { y: -0.050, rx: 0.032, rz: 0.034 },   // the flexor belly under the elbow
  { y:  0.030, rx: 0.031, rz: 0.032 },
];

const LEG_THIGH = [
  { y: -0.400, rx: 0.047, rz: 0.048 },   // knee
  { y: -0.280, rx: 0.054, rz: 0.056 },
  { y: -0.100, rx: 0.066, rz: 0.068 },
  { y:  0.030, rx: 0.072, rz: 0.073 },
];

const LEG_SHIN = [
  { y: -0.365, rx: 0.029, rz: 0.030 },                // ankle
  { y: -0.240, rx: 0.037, rz: 0.039, cz: -0.004 },
  { y: -0.110, rx: 0.052, rz: 0.058, cz: -0.011 },    // the calf, behind the axis
  { y: -0.020, rx: 0.048, rz: 0.050 },
  { y:  0.032, rx: 0.050, rz: 0.052, cz: 0.006 },     // kneecap
];

/* The shoe is lofted along its own length and then laid down, because a foot
   is long in z and a stack of rings up y is the wrong axis for it. After
   rotateX(+PI/2) a ring's +y becomes +z (forward) and its cz becomes -y, so
   cz is written here as height BELOW the ankle. Every ring's underside lands
   at -0.075, which is the sole. */
const SHOE = [
  { y: -0.058, rx: 0.036, rz: 0.036, cz: 0.039 },   // heel
  { y:  0.000, rx: 0.041, rz: 0.046, cz: 0.029 },   // instep, under the ankle
  { y:  0.062, rx: 0.044, rz: 0.036, cz: 0.039 },
  { y:  0.122, rx: 0.043, rz: 0.027, cz: 0.048 },
  { y:  0.168, rx: 0.033, rz: 0.018, cz: 0.057 },
  { y:  0.186, rx: 0.017, rz: 0.010, cz: 0.065 },   // toe
];

/** Lay a length-wise loft down onto the ground. */
function lieDown(geo) {
  geo.rotateX(Math.PI / 2);
  return geo;
}

/** A hand: a palm, a finger mass, and enough of a thumb to give it a facing. */
function buildHand(side, mats) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(loft([
    { y: -0.072, rx: 0.029, rz: 0.014 },
    { y: -0.030, rx: 0.030, rz: 0.016 },
    { y:  0.014, rx: 0.026, rz: 0.015 },
  ], { seg: 12 }), mats.skin);
  g.add(palm);

  const fingers = new THREE.Mesh(loft([
    { y: -LIMB.hand, rx: 0.019, rz: 0.010 },
    { y: -LIMB.hand + 0.020, rx: 0.026, rz: 0.013 },
    { y: -LIMB.hand + 0.052, rx: 0.029, rz: 0.014 },
  ], { seg: 12 }), mats.skin);
  g.add(fingers);

  // one thumb, angled out and forward. Without it a hand is a bead on a stick
  // and the arm has no direction.
  const thumb = new THREE.Group();
  thumb.position.set(side * 0.020, -0.024, 0.006);
  // forward and only a little out: swung wide it reads as a hitchhiker
  thumb.rotation.set(-0.7, 0, side * 0.55);
  thumb.add(new THREE.Mesh(loft([
    { y: -0.042, rx: 0.009, rz: 0.009 },
    { y: -0.020, rx: 0.012, rz: 0.012 },
    { y:  0.004, rx: 0.013, rz: 0.013 },
  ], { seg: 8 }), mats.skin));
  g.add(thumb);

  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

/**
 * One arm. `side` is -1 for the left, +1 for the right.
 *
 * player.js writes shoulder.rotation.z absolutely at 0.14 + run + sit, and the
 * creator never writes it at all, so 0.14 is the neutral both screens see. A
 * 0.14 splay on a 0.60 m arm would fold the hands into the hips, so the arm
 * carries a fixed counter-rotation of its own and the pair rests at 0.06
 * outward — which is where a relaxed arm actually hangs.
 */
function buildArm(side, mats, outfit) {
  const sleeve = outfit.sleeve;
  const shell = outfit.shell || mats.skin;
  const shoulder = new THREE.Group();

  const deltoid = new THREE.Mesh(blob(0.050, 0.056, 0.050, 12), shell);
  deltoid.position.set(side * 0.008, 0.008, 0);
  shoulder.add(deltoid);

  const inner = new THREE.Group();
  inner.rotation.z = side * 0.20;
  shoulder.add(inner);

  inner.add(new THREE.Mesh(loft(ARM_UPPER, { seg: 14 }), mats.skin));

  const elbow = new THREE.Group();
  elbow.position.y = -LIMB.upperArm;
  inner.add(elbow);
  elbow.add(new THREE.Mesh(loft(ARM_FORE, { seg: 14 }), mats.skin));

  const wrist = new THREE.Group();
  wrist.position.y = -LIMB.forearm;
  elbow.add(wrist);
  wrist.add(buildHand(side, mats));

  // sleeves, cut from the arm's own sections so they cannot pinch through
  if (sleeve === 'short') {
    inner.add(new THREE.Mesh(
      loft(slice(ARM_UPPER, -0.10, 0.06, 0.009), { seg: 14 }), shell));
  } else if (sleeve === 'long') {
    inner.add(new THREE.Mesh(
      loft(slice(ARM_UPPER, -0.245, 0.06, 0.010), { seg: 14 }), shell));
    elbow.add(new THREE.Mesh(
      loft(slice(ARM_FORE, -0.19, 0.035, 0.010), { seg: 14 }), shell));
  } else if (sleeve === 'wide') {
    inner.add(new THREE.Mesh(loft([
      { y: -0.290, rx: 0.088, rz: 0.070 },
      { y: -0.150, rx: 0.068, rz: 0.058 },
      { y:  0.010, rx: 0.058, rz: 0.058 },
      { y:  0.060, rx: 0.052, rz: 0.052 },
    ], { seg: 16, capBottom: false }), mats.clothOpen));
  }

  shoulder.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { shoulder, elbow, wrist };
}

/** One leg, with a knee, an ankle and a shoe that has a sole. */
function buildLeg(side, mats, outfit) {
  const hip = new THREE.Group();
  hip.add(new THREE.Mesh(loft(LEG_THIGH, { seg: 14 }), mats.skin));

  /* Trouser legs ride on the thigh, not on the pelvis. Hung off the hips as
     one rigid group they stay put while the leg swings 40 degrees straight out
     of them, which is what the old shorts did at a run. */
  if (outfit.thigh) {
    hip.add(new THREE.Mesh(
      loft(slice(LEG_THIGH, -outfit.thigh.len, 0.02, 0.012), { seg: 14 }),
      outfit.thigh.mat));
  }

  const knee = new THREE.Group();
  knee.position.y = -LIMB.thigh;
  hip.add(knee);
  knee.add(new THREE.Mesh(loft(LEG_SHIN, { seg: 14 }), mats.skin));

  const ankle = new THREE.Group();
  ankle.position.y = -LIMB.shin;
  knee.add(ankle);

  const shoe = new THREE.Mesh(lieDown(loft(SHOE, { seg: 14 })), mats.leather);
  ankle.add(shoe);
  // a sole in a second material: without the band the shoe is a dark lump and
  // the figure looks like it is standing on stumps
  const sole = SHOE.map((s) => ({ y: s.y, rx: s.rx + 0.003, rz: 0.011, cz: 0.064 }));
  ankle.add(new THREE.Mesh(lieDown(loft(sole, { seg: 14 })), mats.sole));
  ankle.rotation.y = side * 0.05;      // toes out, very slightly

  if (outfit.legs === 'socks') {
    knee.add(new THREE.Mesh(
      loft(slice(LEG_SHIN, -0.355, -0.06, 0.008), { seg: 14 }), mats.cloth2));
  }

  hip.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { hip, knee, ankle };
}

/* ───────────── outfits ─────────────

   Every garment is cut from the body's own cross-sections with slice(), so the
   layering is correct by construction: undershirt at pad 0.006, vest at 0.016,
   and no amount of fiddling can make the shirt burst through the vest. Anything
   that needs a surface point — a collar, a pocket, a strap — asks sectionAt()
   for it rather than guessing a z. */

function buildOutfit(cfg, mats, build) {
  const B = bodySections(build);
  const torso = new THREE.Group();   // hangs off the chest joint
  const lower = new THREE.Group();   // hangs off the pelvis: this is u.cloak
  /* `shell` is whatever material clothes the SHOULDER — the deltoid, the
     sleeve and the trapezius yoke all take it, so they cannot end up in three
     different colours over one joint. Null means the shoulder is bare. */
  const out = { torso, lower, legs: 'bare', sleeve: 'short', thigh: null, shell: null };
  const id = cfg.outfit;

  const dy = -Y.chest;               // torso pieces live in chest-local space
  const A = mats.cloth, C2 = mats.cloth2;

  /** A tube of cloth over the body between two world heights. */
  const shirt = (mat, y0, y1, pad, opts = {}) =>
    new THREE.Mesh(loft(slice(B, y0, y1, pad, dy), { seg: 22, ...opts }), mat);

  /**
   * A skirt hanging from the hips: top radius taken from the body, hem from
   * flare. Built on the double-sided cloth, because a hem swinging past the
   * legs shows its inside and a one-sided hem shows a hole instead.
   */
  const skirt = (top, hem, flare, opts = {}) => {
    const s = sectionAt(B, top);
    const rows = [];
    for (let i = 6; i >= 0; i--) {          // i = 6 is the hem, so this is bottom-up
      const t = i / 6;
      const k = 1 + t * flare;
      rows.push({
        y: top - t * (top - hem) - Y.hip,
        rx: (s.rx + 0.012) * k,
        rz: (s.rz + 0.012) * k * (1 + t * 0.25),   // the hem rounds toward circular
      });
    }
    /* capBottom must be off too. It defaults on, so every skirt was sealed
       shut by a solid disc across the hem with the legs punching straight
       through it — and since the cloth is DoubleSide you saw that ceiling from
       any camera below the hem plane. The open hem is the entire reason this
       material is double-sided in the first place. */
    return new THREE.Mesh(
      loft(rows, { seg: 26, capTop: false, capBottom: false, ...opts }), mats.clothOpen);
  };

  /** The seat of a pair of shorts. The legs of them ride on the thighs, which
      are a different joint entirely — see out.thigh and buildLeg. */
  const seat = (mat) =>
    new THREE.Mesh(loft(slice(B, 0.755, 0.885, 0.011, -Y.hip), { seg: 20 }), mat);

  if (id === 'kebaya') {
    torso.add(shirt(C2, 0.905, 1.252, 0.007));
    // the sash sits where the waist actually is, not at a guessed height
    torso.add(shirt(mats.accent, 0.915, 0.985, 0.015));
    lower.add(skirt(0.955, 0.400, 0.30));
    out.sleeve = 'short';
    out.shell = C2;
  } else if (id === 'yukata') {
    torso.add(shirt(A, 0.900, 1.250, 0.008));
    /* The crossed collar is the one shape that says yukata, and in the last
       version it was buried 5 mm inside the shirt and never rendered once.
       It is now built off the body section at its own height, plus the shirt's
       own padding, so it is always on the outside. */
    for (const s of [-1, 1]) {
      const sec = sectionAt(B, 1.150);
      const lap = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.30, 0.012), C2);
      lap.position.set(s * 0.036, 1.150 + dy, sec.rz + 0.017);
      lap.rotation.set(0, s * 0.12, s * 0.36);
      torso.add(lap);
    }
    torso.add(shirt(mats.accent, 0.930, 1.055, 0.017));
    const knot = new THREE.Mesh(blob(0.062, 0.048, 0.038, 12), mats.accent);
    knot.position.set(0, 0.995 + dy, -sectionAt(B, 0.995).rz - 0.038);
    torso.add(knot);
    lower.add(skirt(0.980, 0.360, 0.16));
    out.sleeve = 'wide';
    out.shell = A;
  } else if (id === 'hoodie') {
    torso.add(shirt(A, 0.880, 1.248, 0.012));
    /* A hood is a closed shell, not an open one. The old single-sided cap was
       back-face culled from the front, so it vanished and reappeared as you
       orbited. */
    const hood = new THREE.Mesh(loft([
      { y: 1.190 + dy, rx: 0.098, rz: 0.082, cz: -0.030 },
      { y: 1.250 + dy, rx: 0.108, rz: 0.092, cz: -0.038 },
      { y: 1.320 + dy, rx: 0.104, rz: 0.086, cz: -0.048 },
      { y: 1.372 + dy, rx: 0.074, rz: 0.062, cz: -0.058 },
    ], { seg: 20 }), A);
    torso.add(hood);
    const sec = sectionAt(B, 1.010);
    const pocket = new THREE.Mesh(loft([
      { y: 0.960 + dy, rx: sec.rx * 0.82, rz: sec.rz + 0.026 },
      { y: 1.045 + dy, rx: sec.rx * 0.88, rz: sec.rz + 0.026 },
    ], { seg: 20, capTop: false, capBottom: false }), C2);
    torso.add(pocket);
    lower.add(seat(C2));
    out.thigh = { mat: C2, len: 0.20 };
    out.sleeve = 'long';
    out.shell = A;
  } else if (id === 'uniform') {
    torso.add(shirt(C2, 0.910, 1.250, 0.007));
    // open blazer: a second shell over the shirt, cut away at the front
    torso.add(shirt(A, 0.930, 1.246, 0.017));
    for (const s of [-1, 1]) {
      const sec = sectionAt(B, 1.150);
      const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.052, 0.26, 0.011), C2);
      lapel.position.set(s * 0.052, 1.145 + dy, sec.rz + 0.026);
      lapel.rotation.z = s * 0.10;
      torso.add(lapel);
    }
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.13, 0.010), mats.accent);
    tie.position.set(0, 1.150 + dy, sectionAt(B, 1.150).rz + 0.026);
    torso.add(tie);
    /* Pleats are a scallop in the skirt's own radius. The old version put 12
       thin boxes at rotation.y = -a, which points their thin axis outward — so
       they were radial fins sticking out of the waist, not pleats. */
    lower.add(skirt(0.950, 0.610, 0.55, { wave: 0.045, waveN: 14 }));
    out.legs = 'socks';
    out.sleeve = 'long';
    out.shell = A;
  } else if (id === 'sundress') {
    torso.add(shirt(A, 0.900, 1.185, 0.009));
    // straps that actually reach the shoulder, from the bodice top to over it
    for (const s of [-1, 1]) {
      const top = sectionAt(B, 1.180);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.085, 0.020), A);
      strap.position.set(s * top.rx * 0.62, 1.212 + dy, top.rz * 0.28);
      strap.rotation.z = -s * 0.12;
      torso.add(strap);
    }
    lower.add(skirt(0.960, 0.440, 0.72));
    /* The hem is an ELLIPSE, so a circular torus matches it at the sides and
       floats two and a half centimetres clear of it front and back — a hoop
       hanging in mid-air. Derive both radii from the same section the skirt
       used, and squash the ring onto them. Scale is applied before rotation,
       so after the quarter turn the torus's local y is world z. */
    const hemS = sectionAt(B, 0.960);
    const hemRx = (hemS.rx + 0.012) * 1.72;
    const hemRz = (hemS.rz + 0.012) * 1.72 * 1.25;
    const trim = new THREE.Mesh(new THREE.TorusGeometry(hemRx, 0.010, 6, 30), C2);
    trim.rotation.x = Math.PI / 2;
    trim.scale.set(1, hemRz / hemRx, 1);
    trim.position.y = 0.440 - Y.hip;
    lower.add(trim);
    out.sleeve = 'none';
  } else {  // traveler
    torso.add(shirt(C2, 0.900, 1.248, 0.007));
    torso.add(shirt(A, 0.930, 1.220, 0.018));      // the vest, strictly outside
    torso.add(shirt(mats.accent, 0.925, 0.975, 0.026));
    lower.add(seat(C2));
    out.thigh = { mat: C2, len: 0.34 };
    out.sleeve = 'long';
    out.shell = A;
  }

  for (const grp of [torso, lower]) {
    grp.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }
  return out;
}

/* ───────────── accessories ───────────── */

function buildAccessory(cfg, mats) {
  const id = cfg.accessory;
  const g = new THREE.Group();
  if (id === 'none') return g;

  if (id === 'frangipani' || id === 'earcuff') {
    const f = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(blob(0.026, 0.010, 0.017, 8), mats.petal);
      const a = (i / 5) * TAU;
      p.position.set(Math.cos(a) * 0.028, 0, Math.sin(a) * 0.028);
      p.rotation.y = -a;
      f.add(p);
    }
    f.add(new THREE.Mesh(blob(0.012, 0.010, 0.012, 8), mats.accent));
    const high = id === 'frangipani';
    const d = faceDir(high ? 0.86 : 0.95, high ? 0.30 : -0.06);
    f.position.copy(skullPoint(d[0], d[1], d[2], 1.13));
    f.rotation.set(0.35, 0.3, -1.05);
    g.add(f);
  }

  if (id === 'kasa') {
    const brim = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.13, 22, 1, true), mats.straw);
    brim.position.y = HEAD.ry * 0.92;
    brim.castShadow = true;
    const knob = new THREE.Mesh(blob(0.022, 0.020, 0.022, 8), mats.straw);
    knob.position.y = HEAD.ry * 0.92 + 0.078;
    g.add(brim, knob);
  }

  if (id === 'glasses') {
    // lens centres come from the same place the painted eyes do
    for (const s of [-1, 1]) {
      const d = faceDir(EYE.x * s, EYE.y);
      const at = skullPoint(d[0], d[1], d[2], 1.16);
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.030, 0.0035, 6, 20), mats.leather);
      lens.position.copy(at);
      lens.rotation.y = s * 0.42;
      g.add(lens);
      // the temple arm rides ON the side of the head, so it comes off the
      // surface too rather than out of a guessed x
      const back = faceDir(0.97 * s, EYE.y + 0.10);
      const on = skullPoint(back[0], back[1], back[2], 1.05);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.005, 0.10), mats.leather);
      arm.position.set(on.x, on.y, on.z - 0.052);
      arm.rotation.y = -s * 0.20;
      g.add(arm);
    }
    const dm = faceDir(0, EYE.y + 0.06);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.005, 0.005), mats.leather);
    bridge.position.copy(skullPoint(dm[0], dm[1], dm[2], 1.16));
    g.add(bridge);
  }

  if (id === 'ribbon') {
    const d = dirAt(Math.PI * 0.72, 0.62);
    const at = skullPoint(d[0], d[1], d[2], 1.14);
    const centre = new THREE.Mesh(blob(0.014, 0.014, 0.014, 8), mats.accent);
    centre.position.copy(at);
    g.add(centre);
    for (const s of [-1, 1]) {
      const loop = new THREE.Mesh(blob(0.038, 0.024, 0.016, 12), mats.accent);
      loop.position.copy(at);
      loop.position.x += s * 0.036;
      loop.rotation.z = s * 0.38;
      g.add(loop);
    }
  }

  g.traverse((o) => { if (o.isMesh && o.geometry.type !== 'PlaneGeometry') o.castShadow = true; });
  return g;
}

/* ───────────── materials ───────────── */

function buildMaterials(c) {
  const skin = find(SKINS, c.skin);
  const hair = find(HAIR_COLORS, c.hairColor);
  const cloth = find(OUTFIT_COLORS, c.outfitColor);
  const accentHex = new THREE.Color(cloth.hex)
    .lerp(new THREE.Color('#f2c45a'), 0.55).getStyle();

  /* Standard, not Lambert. Lambert has no specular term at all, so brick,
     thatch, cloth and skin all resolved to the same matte plastic — the whole
     of the "looks untextured" complaint. envMapIntensity has to be set here
     rather than left to main.js: SkyEnvironment.applyIntensity runs once at
     world build and player.setAvatar rebuilds the figure long afterwards. */
  const ENV = 0.55;
  const m = (opts) => pbr({ envMapIntensity: ENV, ...opts });

  // Batik on the wrapped garments, plain weave on the rest. The motif is worth
  // a real texture; a hoodie is not.
  const batik = c.outfit === 'kebaya' || c.outfit === 'yukata';
  const clothMap = batik
    ? batikTexture(cloth.hex, cloth.alt, { cells: 5 })
    : clothTexture(cloth.hex, { thread: 4 });

  const mats = {
    skin: m({ color: '#ffffff', map: skinTexture(skin.hex), roughness: 0.74, normalScale: 0.55 }),
    skinDeep: m({ color: '#ffffff', map: skinTexture(skin.shade), roughness: 0.78 }),
    hair: m({
      color: '#ffffff', map: furTexture(hair.hex, { seed: 21 }),
      roughness: 0.58, normalScale: 1.3, side: THREE.DoubleSide,
    }),
    cloth: m({ color: '#ffffff', map: clothMap, roughness: 0.88, normalScale: 1.1 }),
    // skirts and wide sleeves: anything whose inside face the camera can catch
    clothOpen: m({
      color: '#ffffff', map: clothMap, roughness: 0.88,
      normalScale: 1.1, side: THREE.DoubleSide,
    }),
    cloth2: m({
      color: '#ffffff', map: clothTexture(cloth.alt, { thread: 4 }),
      roughness: 0.9, normalScale: 1.1,
    }),
    accent: m({
      color: '#ffffff', map: clothTexture(accentHex, { thread: 2 }),
      roughness: 0.72, normalScale: 1.0,
    }),
    leather: m({
      color: '#ffffff', map: clothTexture('#2a262e', { thread: 2 }),
      roughness: 0.52, normalScale: 0.9,
    }),
    sole: m({ color: '#ffffff', map: clothTexture('#4a463f', { thread: 8 }), roughness: 0.95 }),
    petal: m({ color: '#ffffff', map: clothTexture('#f8f2e4', { thread: 2 }), roughness: 0.9 }),
    straw: m({
      color: '#ffffff', map: thatchTexture('#c9a86a'),
      roughness: 0.94, normalScale: 1.2, side: THREE.DoubleSide,
    }),
  };

  /* The face is a cutout decal, not a transparent one: alphaTest discards the
     empty pixels in the opaque pass, so it never writes depth over the bare
     skull and never has to be sorted against the hair. Its map already carries
     final colours, so the tint stays white. */
  const faceTex = faceTexture(c);
  mats.face = pbr({
    color: '#ffffff', map: faceTex, normalMap: null,
    roughness: 0.72, envMapIntensity: ENV, alphaTest: 0.04, transparent: false,
  });
  mats.face.polygonOffset = true;
  mats.face.polygonOffsetFactor = -4;
  mats.face.polygonOffsetUnits = -4;
  mats.face.userData.owned = faceTex;

  return mats;
}

/* ───────────── the derived joints ─────────────

   player.js knows about eight joints and writes them absolutely every frame.
   The elbows, knees, wrists and ankles are inferred from those eight rather
   than driven, so this file can have a real skeleton without player.js having
   to be rewritten in the same pass. It is hung off updateMatrixWorld so it
   runs after whatever wrote the rotations, in the game and in the creator
   alike, and it is idempotent so a second call costs nothing. */

function applyDerived(rig) {
  // The pelvis tips forward into a run, and the legs are its children — left
  // alone that shoves both feet out behind her. Give most of it back.
  rig.legRoot.rotation.x = -rig.hips.rotation.x * 0.75;

  for (const leg of rig.legs) {
    const h = leg.hip.rotation.x;
    // A knee only bends one way, and only while the leg is swinging through.
    // The quadratic term is what turns the deep sitting pose (hip at -1.5) into
    // a shin that hangs vertically instead of a mid-air pike.
    const f = Math.max(0, -h);
    const bend = f * (0.75 + 0.35 * Math.min(1, f / 1.5));
    leg.knee.rotation.x = bend;
    // and the ankle keeps the sole roughly level, so the toe stops stabbing
    // into the ground on every stride
    leg.ankle.rotation.x = clamp(-(h + bend) * 0.5, -0.45, 0.5);
  }

  for (const arm of rig.arms) {
    const s = arm.shoulder.rotation.x;
    const bend = 0.17 + Math.max(0, -s) * 0.55 + Math.max(0, s) * 0.10;
    arm.elbow.rotation.x = -bend;
    arm.wrist.rotation.x = bend * 0.2;
  }

  // a spine that gives a little back against the pelvis sway reads as a spine
  rig.spine.rotation.z = -rig.hips.rotation.z * 0.45;
  rig.chest.rotation.z = -rig.hips.rotation.z * 0.30;
}

/* ───────────── assembly ───────────── */

export function buildAvatar(cfg) {
  const c = { ...defaultAvatar(), ...cfg };
  const mats = buildMaterials(c);
  const B = bodySections(c.build);
  const SH = shoulderHalf(c.build);

  const root = new THREE.Group();
  root.name = 'player';

  /* ── spine chain ── */
  const hips = new THREE.Group();
  hips.position.y = Y.hip;
  root.add(hips);

  const spine = new THREE.Group();
  spine.position.y = Y.spine - Y.hip;
  hips.add(spine);

  const chest = new THREE.Group();
  chest.position.y = Y.chest - Y.spine;
  spine.add(chest);

  const neck = new THREE.Group();
  neck.position.y = Y.neck - Y.chest;
  chest.add(neck);

  const head = new THREE.Group();
  head.position.y = Y.headJoint - Y.neck;
  neck.add(head);

  /* The body is three overlapping shells rather than one, because a single
     torso mesh cannot be a child of three joints at once. They share their
     cross-sections at the seams, so the small counter-rotations the spine and
     chest take never open a gap. */
  const mkBody = (y0, y1, joint) =>
    new THREE.Mesh(loft(slice(B, y0, y1, 0, -joint), { seg: 22 }), mats.skin);
  const pelvisMesh = mkBody(0.752, 0.958, Y.hip);
  const waistMesh = mkBody(0.925, 1.078, Y.spine);
  const chestMesh = mkBody(1.058, 1.268, Y.chest);
  for (const mesh of [pelvisMesh, waistMesh, chestMesh]) mesh.castShadow = true;

  // legs hang off their own root so the run lean can be taken out of them
  const legRoot = new THREE.Group();
  hips.add(legRoot, pelvisMesh);
  spine.add(waistMesh);
  chest.add(chestMesh);

  const outfit = buildOutfit(c, mats, c.build);
  chest.add(outfit.torso);
  hips.add(outfit.lower);

  /* The trapezius. A stack of ellipses cannot get from a 0.06 neck root to a
     0.15 shoulder joint without turning the chest into a slab, so the slope
     from the neck out to the deltoid is its own piece — without it there is a
     2 cm hole over the collarbone, which is the "no shoulders" complaint
     arriving by a different route. */
  for (const side of [-1, 1]) {
    const yoke = new THREE.Mesh(blob(0.096, 0.030, 0.062, 16),
      outfit.shell || mats.skin);
    yoke.position.set(side * 0.076, Y.shoulder - Y.chest + 0.007, 0);
    yoke.castShadow = true;
    chest.add(yoke);
  }

  /* ── neck and head ── */
  const neckMesh = new THREE.Mesh(loft([
    { y: -0.048, rx: 0.052, rz: 0.049 },
    { y:  0.005, rx: 0.043, rz: 0.041 },
    { y:  0.048, rx: 0.040, rz: 0.038 },
    { y:  0.072, rx: 0.043, rz: 0.041 },   // flares up under the jaw
  ], { seg: 14 }), mats.skin);
  neckMesh.castShadow = true;
  neck.add(neckMesh);

  /* Head parts all live in skull-centre space, which is exactly the space
     skullPoint works in — so nothing has to add an offset by hand, and the
     hair's pivot ends up at the skull centre where a 0.05 rad wobble moves it
     7 mm against a 10 mm clearance instead of punching through. */
  const skullOrigin = [0, HEAD.cy, HEAD.cz];
  const headGroup = buildHead(c, mats);
  headGroup.position.set(...skullOrigin);
  head.add(headGroup);

  const hairGroup = buildHair(c, mats);
  hairGroup.position.set(...skullOrigin);
  head.add(hairGroup);

  const acc = buildAccessory(c, mats);
  acc.position.set(...skullOrigin);
  head.add(acc);

  if (c.accessory === 'scarf') {
    const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.020, 8, 20), mats.accent);
    wrap.rotation.x = Math.PI / 2;
    wrap.position.y = 0.012;
    wrap.castShadow = true;
    neck.add(wrap);
    const tail = new THREE.Mesh(loft([
      { y: -0.20, rx: 0.028, rz: 0.010 },
      { y: -0.05, rx: 0.034, rz: 0.012 },
      { y:  0.01, rx: 0.030, rz: 0.014 },
    ], { seg: 10 }), mats.accent);
    tail.position.set(0.036, 0.005, -0.052);
    tail.rotation.x = 0.22;
    tail.castShadow = true;
    neck.add(tail);
  }

  /* ── arms ── */
  const arms = [];
  const shoulders = [];
  for (const side of [-1, 1]) {
    const arm = buildArm(side, mats, outfit);
    arm.shoulder.position.set(side * SH, Y.shoulder - Y.chest, 0);
    arm.shoulder.rotation.z = -side * 0.14;      // the neutral both screens see
    chest.add(arm.shoulder);
    arms.push(arm);
    shoulders.push(arm.shoulder);
  }

  /* ── legs ── */
  const legs = [];
  for (const side of [-1, 1]) {
    const leg = buildLeg(side, mats, outfit);
    leg.hip.position.set(side * 0.078, 0, 0);
    legRoot.add(leg.hip);
    legs.push(leg);
  }

  /* Self-shadowing is most of what makes a Standard-lit figure read as solid
     rather than as a flat cut-out. The face decal is the one exception, in both
     directions — it must not catch the brow's own shadow across the eyes. */
  root.traverse((o) => {
    if (o.isMesh && o.material !== mats.face) o.receiveShadow = true;
  });

  const rig = { hips, spine, chest, legRoot, legs, arms };

  /* One override, so the inferred joints are always in step with whatever wrote
     the driven ones this frame. Group has no updateMatrixWorld of its own. */
  root.updateMatrixWorld = function (force) {
    applyDerived(rig);
    THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
  };

  root.userData = {
    // the contract player.js and creator.js read
    hips, neck, hat: hairGroup,
    shoulderL: shoulders[0], shoulderR: shoulders[1],
    hipL: legs[0].hip, hipR: legs[1].hip,
    cloak: outfit.lower, scarfTail: hairGroup.userData.tails,
    baseHipY: Y.hip, config: c,

    // the rest of the skeleton, for whoever drives it next
    spine, chest, head, legRoot,
    elbowL: arms[0].elbow, elbowR: arms[1].elbow,
    wristL: arms[0].wrist, wristR: arms[1].wrist,
    kneeL: legs[0].knee, kneeR: legs[1].knee,
    ankleL: legs[0].ankle, ankleR: legs[1].ankle,

    dispose() {
      /* The texture library hands out shared, cached maps whose dispose() is a
         no-op on purpose, so freeing material.map here is safe — but the face
         canvas is ours alone and nothing else will ever free it. */
      const seen = new Set();
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.geometry.dispose();
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const mm of list) {
          if (!mm || seen.has(mm)) continue;
          seen.add(mm);
          if (mm.userData.owned) mm.userData.owned.dispose();
          mm.dispose();
        }
      });
    },
  };
  return root;
}
