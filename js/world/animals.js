import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom, clamp, damp, smoothstep } from './noise.js';
import { heightAt, normalAt, POND, WATER_LEVEL } from './terrain.js';
import {
  pbr, furTexture, featherTexture, skinTexture, normalFromCanvas,
} from './textures.js';

/* ═══════════════════════════════════════════════════════════
   The valley's inhabitants. Each animal is a small skeleton of
   nested Groups — spine, neck chain, three-joint legs, a tail
   that lags — driven by a gait cycle measured in DISTANCE, not
   time, so feet plant on the ground instead of sliding over it.
   ═══════════════════════════════════════════════════════════ */

/* ─────────── materials ─────────── */

const MATS = new Map();

/**
 * One Standard material per (surface, colour). Forty animals sharing a dozen
 * materials is what keeps the uniform uploads survivable; textures.js already
 * caches the canvases underneath, so this only memoises the material object.
 */
function coat(hex, kind = 'fur', rough = 0.9, tile = 3) {
  const key = `${kind}|${hex}|${rough}|${tile}`;
  const hit = MATS.get(key);
  if (hit) return hit;

  const map = kind === 'feather' ? featherTexture(hex)
    : kind === 'skin' ? skinTexture(hex)
      : furTexture(hex);

  /* Take the normal map the library already tuned for this surface — fur at
     3.0, feather at 2.6, skin at 1.8 — rather than re-Sobelling the same
     canvas at a third of the strength. Hides were coming out visibly flatter
     than every other surface in the valley, and each animal colour was
     minting a second normal texture to do it. If a species genuinely wants
     less relief, that is what normalScale is for. */
  const m = pbr({
    map,
    normalScale: kind === 'skin' ? 0.55 : 0.85,
    roughness: rough,
    metalness: 0,
    repeat: [tile, tile],
  });
  // main.js calibrates the world's env intensity once, before the menagerie is
  // rebuilt on a quality change, so each material carries its own value.
  m.envMapIntensity = 0.55;
  MATS.set(key, m);
  return m;
}

// low roughness on purpose: a real specular catchlight is most of what makes
// an eye look wet, and it is the one place in the valley worth the glint
const M_EYE = new THREE.MeshStandardMaterial({ color: 0x1b1618, roughness: 0.3, metalness: 0 });
const M_SHINE = new THREE.MeshStandardMaterial({ color: 0xf2f4f2, roughness: 0.5, metalness: 0 });

/* ─────────── geometry helpers ─────────── */

const GEO = new Map();

/** Species geometry is shared by every individual; only the Groups are per-animal. */
function cached(key, make) {
  let g = GEO.get(key);
  if (!g) { g = make(); GEO.set(key, g); }
  return g;
}

const _m4 = new THREE.Matrix4();
const _eu = new THREE.Euler();

function put(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx || ry || rz) g.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz)));
  if (x || y || z) g.translate(x, y, z);
  return g;
}

/** Ellipsoid. Spheres, not icosahedra — polyhedron UVs shred a tiling fur map. */
function ball(r, sx = 1, sy = 1, sz = 1, seg = 9) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 3));
  if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
  return g;
}

const tube = (r1, r2, h, seg = 6) => new THREE.CylinderGeometry(r1, r2, h, seg, 1, false);
const spike = (r, h, seg = 6) => new THREE.ConeGeometry(r, h, seg);

/**
 * Merge the rigid sub-parts of ONE bone into a single draw call. Deliberately
 * does not recompute normals — that would facet every sphere back into the
 * plastic look we are trying to leave behind.
 */
function weld(parts) {
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    }
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    }
    return n;
  });
  const merged = mergeGeometries(flat, false);
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  parts.forEach((g) => g.dispose());
  return merged;
}

/**
 * The sun's shadow map is 2048 over a 160 m box — about 8 cm a texel — so a
 * 5 cm shank never resolves. Only the big masses are worth a shadow draw.
 */
function bone(geo, mat, cast = false) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  // Receiving is a fragment lookup, not a draw, so every part can afford it —
  // and without it a deer under the canopy stays lit as brightly as one in
  // open sun, which is most of what made them read as pasted on.
  m.receiveShadow = true;
  return m;
}

/* ─────────── shared rig pieces ─────────── */

/** A limb bone hanging down -Y from its pivot, with a knuckle at the joint. */
function downBone(key, len, rTop, rBot, mat, tail = null) {
  return bone(cached(key, () => {
    const p = [put(tube(rTop, rBot, len), 0, -len * 0.5, 0), ball(rTop * 1.15, 1, 0.82, 1, 7)];
    if (tail) for (const g of tail()) p.push(g);
    return weld(p);
  }), mat, false);
}

/** A neck/torso riser standing up +Y from its pivot. */
function upBone(key, len, rBot, rTop, mat, cast = true) {
  return bone(cached(key, () => weld([
    put(tube(rTop, rBot, len, 7), 0, len * 0.5, 0),
    ball(rBot * 1.06, 1, 0.9, 1, 7),
  ])), mat, cast);
}

/** Eyes and their painted catchlight as one unit, so a blink squashes both. */
function eyeUnit(key, r, x, y, z) {
  const m = bone(cached(key, () => {
    const p = [];
    for (const s of [-1, 1]) p.push(put(ball(r, 1, 1.15, 0.85, 8), x * s, y, z));
    return weld(p);
  }), M_EYE, false);
  m.add(bone(cached(key + '.lit', () => {
    const p = [];
    for (const s of [-1, 1]) {
      p.push(put(ball(r * 0.3, 1, 1, 1, 5), x * s + r * 0.3 * s, y + r * 0.42, z + r * 0.5));
    }
    return weld(p);
  }), M_SHINE, false));
  return m;
}

/**
 * A chain of Groups, each holding one bone, extending backwards along -Z.
 * Used for tails: rotation.x on a link then reads as "lift the tail".
 */
function backChain(key, mat, n, len, r0, r1, rest) {
  const links = [];
  let parent = null;
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    g.position.z = i === 0 ? 0 : -len;
    g.rotation.x = rest[i] || 0;
    const rt = r0 + (r1 - r0) * (i / n);
    const rb = r0 + (r1 - r0) * ((i + 1) / n);
    g.add(bone(cached(`${key}.${i}`, () => weld([
      put(tube(rb, rt, len, 6), 0, 0, -len * 0.5, Math.PI / 2),
      ball(rt * 1.08, 1, 1, 1, 6),
    ])), mat, false));
    if (parent) parent.add(g);
    links.push({ g, rest: g.rotation.x, ax: g.rotation.x, ay: 0, vx: 0, vy: 0 });
    parent = g;
  }
  return links;
}

/* ─────────── leg assembly + inverse kinematics ─────────── */

/**
 * hip → knee → (ankle). Two bones are solved by IK; the third is driven from
 * the solved angles so the foot stays flat through stance and rolls off the
 * toe, which is the part the eye actually reads as "walking".
 */
function buildLeg(key, spec, parent, mats) {
  const side = spec.side;
  const hip = new THREE.Group();
  hip.position.set(spec.x * side, spec.y || 0, spec.z || 0);
  parent.add(hip);

  const id = spec.geo;
  hip.add(downBone(`${key}.${id}.up`, spec.upper, spec.r * 1.22, spec.r * 0.85, mats[spec.upMat || 'coat']));

  const knee = new THREE.Group();
  knee.position.y = -spec.upper;
  hip.add(knee);

  const paw = spec.ankle ? null : () => [
    put(ball(spec.r * 1.15, 0.85, 0.55, 1.5, 7), 0, -spec.lower + spec.r * 0.3, spec.toe || spec.r * 0.6),
  ];
  knee.add(downBone(`${key}.${id}.lo`, spec.lower, spec.r * 0.86, spec.r * 0.58,
    mats[spec.loMat || 'coat'], paw));

  let ankle = null;
  if (spec.ankle) {
    ankle = new THREE.Group();
    ankle.position.y = -spec.lower;
    knee.add(ankle);
    ankle.add(bone(cached(`${key}.${id}.ft`, () => weld(spec.ankle())), mats[spec.ftMat || 'trim'], false));
  }

  return {
    hip, knee, ankle, block: parent,
    upper: spec.upper, lower: spec.lower,
    bend: spec.bend,
    restX: spec.x * side,
    restZ: (parent.position.z || 0) + (spec.z || 0),
    stance: spec.stance || 0,
    id: spec.id, phase: 0,
    flat: spec.flat === undefined ? 0.8 : spec.flat,
  };
}

/**
 * Reach the foot to (xt, yt, zt) expressed in the leg root's own frame: the
 * sideways lean is taken as a roll at the hip, then the remaining two axes are
 * a plain two-bone solve. Clamping the target inside the leg's reach is what
 * makes a leaping animal's legs trail out straight for free.
 */
function solveLeg(leg, xt, yt, zt, toe) {
  const roll = clamp(Math.atan2(xt, -yt), -0.35, 0.35);
  const drop = -Math.hypot(xt, yt);
  const L1 = leg.upper, L2 = leg.lower;
  let d = Math.hypot(zt, drop);
  d = clamp(d, Math.abs(L1 - L2) + 0.004, (L1 + L2) * 0.995);
  const dir = Math.atan2(-zt, -drop);
  const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const g = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
  const hipA = dir - leg.bend * a;
  const kneeA = leg.bend * (Math.PI - g);
  leg.hip.rotation.set(hipA, 0, roll);
  leg.knee.rotation.x = kneeA;
  if (leg.ankle) leg.ankle.rotation.x = -(hipA + kneeA) * leg.flat + toe;
}

/* ─────────── species ─────────── */

/**
 * Phase offsets per foot. A leg is in stance while frac(gait + offset) < duty,
 * so it plants at gait = 1 - offset. The bound is laid out to leave one clean
 * flight window (FLIGHT_AT..+FLIGHT_LEN) with nothing on the ground at all.
 */
const ORDER = {
  lateral: { FL: 0.25, FR: 0.75, HL: 0.0, HR: 0.5 },
  diagonal: { FL: 0.0, FR: 0.5, HL: 0.5, HR: 0.0 },
  bound: { FL: 0.0, FR: 0.04, HL: 0.65, HR: 0.69 },
  biped: { L: 0.0, R: 0.5 },
};
const FLIGHT_AT = 0.65;
const FLIGHT_LEN = 0.35;

const SPECIES = {};

/* deer / stag ─ the shy grazer of the upper meadow */
function deerSpec(antlers) {
  const key = antlers ? 'stag' : 'deer';
  return {
    key,
    mats: {
      coat: () => coat('#b3855c', 'fur', 0.93, 3),
      mark: () => coat('#e6d6bb', 'fur', 0.93, 3),
      dark: () => coat('#5d4534', 'fur', 0.88, 2),
      trim: () => coat('#4a3a33', 'skin', 0.7, 2),
    },
    gait: {
      walk: 1.3, run: 5.0, stride: 0.80, lift: 0.13,
      duty: 0.63, dutyRun: 0.42, bob: 0.028, roll: 0.022, hop: 0,
      slow: 'lateral', fast: 'diagonal',
    },
    brain: {
      shy: 8, curious: 0, roam: 30, notice: 26, graze: 0.62, rest: 0.1,
      groom: 0.12, idleMin: 3.5, idleMax: 9, earRate: 0.5, blink: [2.4, 5],
    },
    build(mats) {
      const K = key;
      const rig = { legs: [] };
      const root = new THREE.Group(); root.rotation.order = 'YXZ';
      const body = new THREE.Group(); body.position.y = 0.76; root.add(body);

      const chest = new THREE.Group(); chest.position.z = 0.30; body.add(chest);
      chest.add(bone(cached(K + '.chest', () => weld([
        put(ball(0.28, 1.0, 0.95, 1.55, 10), 0, 0.02, 0),
        put(ball(0.19, 1.0, 0.9, 1.0, 8), 0, 0.10, 0.24),
      ])), mats.coat, true));
      chest.add(bone(cached(K + '.bib', () => weld([
        put(ball(0.16, 0.9, 0.7, 1.3, 8), 0, -0.15, 0.06),
      ])), mats.mark, false));

      const hips = new THREE.Group(); hips.position.z = -0.30; body.add(hips);
      hips.add(bone(cached(K + '.hips', () => weld([
        put(ball(0.26, 1.0, 1.0, 1.3, 10), 0, 0.02, 0),
        put(ball(0.10, 1, 1, 1, 7), 0, 0.14, -0.28),
      ])), mats.coat, true));

      // neck: two links so the head can swing down to the grass and back up
      const n0 = new THREE.Group(); n0.position.set(0, 0.14, 0.36); n0.rotation.x = 0.52; chest.add(n0);
      n0.add(upBone(K + '.n0', 0.24, 0.105, 0.085, mats.coat));
      const n1 = new THREE.Group(); n1.position.y = 0.24; n1.rotation.x = 0.10; n0.add(n1);
      n1.add(upBone(K + '.n1', 0.22, 0.085, 0.068, mats.coat));

      const head = new THREE.Group(); head.position.y = 0.22; n1.add(head);
      head.add(bone(cached(K + '.head', () => {
        const p = [
          put(ball(0.105, 1.0, 0.98, 1.2, 9), 0, 0.02, 0.02),
          put(tube(0.052, 0.082, 0.20, 7), 0, -0.012, 0.15, Math.PI / 2),
        ];
        if (antlers) {
          for (const s of [-1, 1]) {
            p.push(put(tube(0.014, 0.022, 0.30, 5), s * 0.055, 0.20, -0.01, 0, 0, s * 0.42));
            p.push(put(tube(0.010, 0.015, 0.17, 5), s * 0.145, 0.33, 0.03, 0.5, 0, s * 0.85));
            p.push(put(tube(0.010, 0.014, 0.14, 5), s * 0.115, 0.34, -0.08, -0.6, 0, s * 0.5));
          }
        }
        return weld(p);
      }), mats.coat, true));
      head.add(bone(cached(K + '.nose', () => weld([
        put(ball(0.042, 1.05, 0.8, 0.8, 7), 0, -0.005, 0.245),
      ])), mats.trim, false));
      const eyes = eyeUnit(K + '.eyes', 0.027, 0.070, 0.045, 0.062);
      head.add(eyes);

      const ears = [];
      for (const s of [-1, 1]) {
        const e = new THREE.Group();
        e.position.set(s * 0.072, 0.075, -0.03);
        e.rotation.set(-0.2, 0, s * 0.55);
        head.add(e);
        e.add(bone(cached(K + '.ear', () => weld([
          put(ball(0.048, 0.5, 1.9, 0.32, 7), 0, 0.075, 0),
        ])), mats.coat, false));
        ears.push({ g: e, rx: e.rotation.x, rz: e.rotation.z, side: s, f: 0 });
      }

      const tail = backChain(K + '.tail', mats.mark, 2, 0.09, 0.045, 0.028, [-0.7, -0.4]);
      tail[0].g.position.set(0, 0.16, -0.24);
      hips.add(tail[0].g);

      const F = { r: 0.052, upper: 0.44, lower: 0.42, bend: -1, front: true, y: -0.02, loMat: 'dark' };
      const H = { r: 0.056, upper: 0.45, lower: 0.44, bend: 1, front: false, y: -0.02, loMat: 'dark' };
      rig.legs.push(buildLeg(K, { ...F, id: 'FL', geo: 'fl', side: -1, x: 0.145, z: 0.04 }, chest, mats));
      rig.legs.push(buildLeg(K, { ...F, id: 'FR', geo: 'fl', side: 1, x: 0.145, z: 0.04 }, chest, mats));
      rig.legs.push(buildLeg(K, { ...H, id: 'HL', geo: 'hl', side: -1, x: 0.155, z: -0.02 }, hips, mats));
      rig.legs.push(buildLeg(K, { ...H, id: 'HR', geo: 'hl', side: 1, x: 0.155, z: -0.02 }, hips, mats));

      Object.assign(rig, { root, body, chest, hips, neck: [n0, n1], head, eyes, ears, tail, stand: 0.76 });
      return rig;
    },
  };
}
SPECIES.deer = deerSpec(false);
SPECIES.stag = deerSpec(true);

/* cat ─ the one that comes to you */
SPECIES.cat = {
  key: 'cat',
  mats: {
    coat: () => coat('#c99a63', 'fur', 0.92, 4),
    mark: () => coat('#f2e6d2', 'fur', 0.92, 4),
    trim: () => coat('#c9808a', 'skin', 0.6, 2),
  },
  gait: {
    walk: 1.15, run: 4.2, stride: 0.30, lift: 0.075,
    duty: 0.62, dutyRun: 0.42, bob: 0.016, roll: 0.03, hop: 0,
    slow: 'lateral', fast: 'diagonal',
  },
  brain: {
    shy: 0, curious: 16, roam: 20, notice: 22, graze: 0, rest: 0.3,
    groom: 0.34, idleMin: 2.5, idleMax: 7, earRate: 0.9, blink: [1.8, 4.5],
  },
  build(mats) {
    const K = 'cat';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.26; root.add(body);

    const chest = new THREE.Group(); chest.position.z = 0.12; body.add(chest);
    chest.add(bone(cached(K + '.chest', () => weld([
      put(ball(0.125, 1.05, 0.96, 1.5, 9), 0, 0.01, 0),
    ])), mats.coat, true));
    chest.add(bone(cached(K + '.bib', () => weld([
      put(ball(0.085, 0.9, 0.6, 1.1, 7), 0, -0.07, 0.05),
    ])), mats.mark, false));

    const hips = new THREE.Group(); hips.position.z = -0.14; body.add(hips);
    hips.add(bone(cached(K + '.hips', () => weld([
      put(ball(0.125, 1.0, 1.0, 1.35, 9), 0, 0.01, 0),
    ])), mats.coat, true));

    const n0 = new THREE.Group(); n0.position.set(0, 0.06, 0.16); n0.rotation.x = 0.55; chest.add(n0);
    n0.add(upBone(K + '.n0', 0.08, 0.062, 0.055, mats.coat));
    const n1 = new THREE.Group(); n1.position.y = 0.08; n1.rotation.x = 0.08; n0.add(n1);
    n1.add(upBone(K + '.n1', 0.06, 0.055, 0.05, mats.coat));

    const head = new THREE.Group(); head.position.y = 0.06; n1.add(head);
    head.add(bone(cached(K + '.head', () => weld([
      put(ball(0.093, 1.05, 0.95, 1.0, 9), 0, 0.01, 0.01),
      put(ball(0.055, 1.1, 0.75, 0.9, 8), 0, -0.028, 0.075),
    ])), mats.coat, true));
    head.add(bone(cached(K + '.nose', () => weld([
      put(ball(0.018, 1.2, 0.8, 0.8, 6), 0, -0.012, 0.122),
    ])), mats.trim, false));
    const eyes = eyeUnit(K + '.eyes', 0.030, 0.052, 0.022, 0.070);
    head.add(eyes);

    const ears = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 0.052, 0.062, -0.005);
      e.rotation.set(-0.1, 0, s * 0.26);
      head.add(e);
      e.add(bone(cached(K + '.ear', () => weld([
        put(spike(0.038, 0.075, 6), 0, 0.038, 0),
      ])), mats.coat, false));
      ears.push({ g: e, rx: e.rotation.x, rz: e.rotation.z, side: s, f: 0 });
    }

    // four links: the swish is most of what makes a cat read as a cat
    const tail = backChain(K + '.tail', mats.coat, 4, 0.10, 0.026, 0.016, [0.5, 0.35, 0.2, 0.1]);
    tail[0].g.position.set(0, 0.09, -0.15);
    hips.add(tail[0].g);

    const F = { r: 0.028, upper: 0.16, lower: 0.15, bend: -1, front: true, y: -0.02, loMat: 'mark', toe: 0.02 };
    const H = { r: 0.031, upper: 0.17, lower: 0.16, bend: 1, front: false, y: -0.02, loMat: 'mark', toe: 0.02 };
    rig.legs.push(buildLeg(K, { ...F, id: 'FL', geo: 'fl', side: -1, x: 0.062, z: 0.02 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...F, id: 'FR', geo: 'fl', side: 1, x: 0.062, z: 0.02 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HL', geo: 'hl', side: -1, x: 0.066, z: -0.01 }, hips, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HR', geo: 'hl', side: 1, x: 0.066, z: -0.01 }, hips, mats));

    Object.assign(rig, { root, body, chest, hips, neck: [n0, n1], head, eyes, ears, tail, stand: 0.26 });
    return rig;
  },
};

/* rabbit ─ bounds, then freezes bolt upright */
SPECIES.rabbit = {
  key: 'rabbit',
  mats: {
    coat: () => coat('#d9cdb8', 'fur', 0.94, 4),
    trim: () => coat('#dc9aa4', 'skin', 0.62, 2),
  },
  gait: {
    walk: 1.5, run: 4.6, stride: 0.45, lift: 0.055,
    duty: 0.30, dutyRun: 0.24, bob: 0.012, roll: 0.008, hop: 0.15,
    slow: 'bound', fast: 'bound',
  },
  brain: {
    shy: 6.5, curious: 0, roam: 14, notice: 16, graze: 0.5, rest: 0.06,
    groom: 0.2, idleMin: 1.2, idleMax: 4, earRate: 1.6, blink: [1.4, 3.4],
  },
  build(mats) {
    const K = 'rabbit';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.17; root.add(body);

    const chest = new THREE.Group(); chest.position.z = 0.07; body.add(chest);
    chest.add(bone(cached(K + '.chest', () => weld([
      put(ball(0.105, 1.0, 0.98, 1.25, 9), 0, 0.01, 0),
    ])), mats.coat, true));

    const hips = new THREE.Group(); hips.position.z = -0.09; body.add(hips);
    hips.add(bone(cached(K + '.hips', () => weld([
      put(ball(0.125, 1.0, 1.1, 1.2, 9), 0, 0.02, 0),
      put(ball(0.055, 1, 1, 1, 7), 0, 0.03, -0.15),   // scut, merged: it never moves alone
    ])), mats.coat, true));

    const n0 = new THREE.Group(); n0.position.set(0, 0.07, 0.11); n0.rotation.x = 0.42; chest.add(n0);
    n0.add(upBone(K + '.n0', 0.055, 0.055, 0.05, mats.coat));

    const head = new THREE.Group(); head.position.y = 0.055; n0.add(head);
    head.add(bone(cached(K + '.head', () => weld([
      put(ball(0.078, 1.0, 0.95, 1.15, 9), 0, 0.01, 0.01),
      put(ball(0.045, 1.0, 0.8, 1.0, 7), 0, -0.022, 0.072),
    ])), mats.coat, true));
    head.add(bone(cached(K + '.nose', () => weld([
      put(ball(0.016, 1.2, 0.8, 0.8, 6), 0, -0.012, 0.112),
    ])), mats.trim, false));
    const eyes = eyeUnit(K + '.eyes', 0.029, 0.058, 0.026, 0.048);
    head.add(eyes);

    const ears = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 0.036, 0.055, -0.015);
      e.rotation.set(-0.12, 0, s * 0.14);
      head.add(e);
      e.add(bone(cached(K + '.ear', () => weld([
        put(ball(0.036, 0.62, 3.0, 0.34, 7), 0, 0.098, 0),
      ])), mats.coat, false));
      ears.push({ g: e, rx: e.rotation.x, rz: e.rotation.z, side: s, f: 0 });
    }

    const F = { r: 0.023, upper: 0.100, lower: 0.095, bend: -1, front: true, y: 0.0, toe: 0.02 };
    const H = { r: 0.030, upper: 0.125, lower: 0.135, bend: 1, front: false, y: 0.03, toe: 0.045, flat: 1.0 };
    rig.legs.push(buildLeg(K, { ...F, id: 'FL', geo: 'fl', side: -1, x: 0.048, z: 0.02 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...F, id: 'FR', geo: 'fl', side: 1, x: 0.048, z: 0.02 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HL', geo: 'hl', side: -1, x: 0.058, z: -0.02 }, hips, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HR', geo: 'hl', side: 1, x: 0.058, z: -0.02 }, hips, mats));

    Object.assign(rig, { root, body, chest, hips, neck: [n0], head, eyes, ears, tail: [], stand: 0.17 });
    return rig;
  },
};

/* duckling ─ two legs, a waddle, and a great deal of preening */
SPECIES.duckling = {
  key: 'duckling',
  mats: {
    coat: () => coat('#efdc9c', 'feather', 0.9, 3),
    mark: () => coat('#f8ecc2', 'feather', 0.9, 3),
    dark: () => coat('#dfc87f', 'feather', 0.9, 3),
    trim: () => coat('#e0a04d', 'skin', 0.66, 2),
  },
  gait: {
    walk: 0.7, run: 2.2, stride: 0.15, lift: 0.05,
    duty: 0.60, dutyRun: 0.5, bob: 0.012, roll: 0.11, hop: 0,
    slow: 'biped', fast: 'biped',
  },
  brain: {
    shy: 3.2, curious: 0, roam: 11, notice: 12, graze: 0.45, rest: 0.12,
    groom: 0.3, idleMin: 0.7, idleMax: 2.6, earRate: 0, blink: [1.2, 3],
  },
  build(mats) {
    const K = 'duckling';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.155; root.add(body);

    const chest = new THREE.Group(); body.add(chest);
    chest.add(bone(cached(K + '.body', () => weld([
      put(ball(0.105, 1.05, 0.95, 1.3, 9), 0, 0.01, 0),
      put(spike(0.05, 0.10, 6), 0, 0.05, -0.145, -Math.PI / 2),
    ])), mats.coat, true));
    const hips = chest;

    const n0 = new THREE.Group(); n0.position.set(0, 0.08, 0.07); n0.rotation.x = 0.16; chest.add(n0);
    n0.add(upBone(K + '.n0', 0.06, 0.042, 0.036, mats.coat));

    const head = new THREE.Group(); head.position.y = 0.06; n0.add(head);
    head.add(bone(cached(K + '.head', () => weld([
      put(ball(0.062, 1.0, 1.0, 1.05, 9), 0, 0.01, 0.005),
    ])), mats.mark, false));
    head.add(bone(cached(K + '.bill', () => weld([
      put(ball(0.036, 1.15, 0.42, 1.4, 7), 0, -0.006, 0.062),
    ])), mats.trim, false));
    const eyes = eyeUnit(K + '.eyes', 0.017, 0.040, 0.024, 0.042);
    head.add(eyes);

    // stubby wings on their own pivots so preening has something to reach for
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.100, 0.03, 0.01);
      w.rotation.z = s * 0.1;
      chest.add(w);
      w.add(bone(cached(K + '.wing', () => weld([
        put(ball(0.062, 0.32, 0.75, 1.25, 7), 0, -0.01, 0),
      ])), mats.dark, false));
      wings.push({ g: w, rz: w.rotation.z, side: s });
    }

    const foot = () => [put(ball(0.042, 1.25, 0.28, 1.5, 7), 0, 0.008, 0.022)];
    // bend -1: a bird's visible mid-joint is the hock and it folds backwards
    const L = {
      r: 0.016, upper: 0.070, lower: 0.068, bend: -1, front: false, y: -0.05,
      ankle: foot, ftMat: 'trim', flat: 1.0,
    };
    rig.legs.push(buildLeg(K, { ...L, id: 'L', geo: 'lg', side: -1, x: 0.042, z: -0.01 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...L, id: 'R', geo: 'lg', side: 1, x: 0.042, z: -0.01 }, chest, mats));

    Object.assign(rig, {
      root, body, chest, hips, neck: [n0], head, eyes, ears: [], tail: [], wings, stand: 0.155,
    });
    return rig;
  },
};

/* frog ─ folded, patient, then gone in one arc */
SPECIES.frog = {
  key: 'frog',
  mats: {
    coat: () => coat('#7aa85f', 'skin', 0.62, 4),
    mark: () => coat('#c9d69a', 'skin', 0.6, 4),
  },
  gait: {
    walk: 1.1, run: 3.0, stride: 0.45, lift: 0.04,
    duty: 0.26, dutyRun: 0.22, bob: 0.01, roll: 0, hop: 0.20,
    slow: 'bound', fast: 'bound',
  },
  brain: {
    shy: 3.4, curious: 0, roam: 4.5, notice: 9, graze: 0, rest: 0.1,
    groom: 0, idleMin: 2.2, idleMax: 6.5, earRate: 0, blink: [1.0, 2.6],
  },
  build(mats) {
    const K = 'frog';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.115; root.add(body);

    const chest = new THREE.Group(); body.add(chest);
    chest.add(bone(cached(K + '.body', () => weld([
      put(ball(0.10, 1.2, 0.78, 1.35, 10), 0, 0, 0),
      put(ball(0.072, 1.15, 0.85, 1.0, 8), 0, 0.02, 0.10),
    ])), mats.coat, true));
    // the throat is its own mesh purely so it can pulse
    const throat = bone(cached(K + '.throat', () => weld([
      put(ball(0.045, 1.05, 0.7, 0.9, 7), 0, -0.045, 0.08),
    ])), mats.mark, false);
    chest.add(throat);
    const hips = chest;

    const head = new THREE.Group(); head.position.set(0, 0.02, 0.06); chest.add(head);
    const eyes = eyeUnit(K + '.eyes', 0.030, 0.058, 0.055, 0.038);
    head.add(eyes);
    // the green bulge sits behind the eye so the dark dome still pokes out front
    head.add(bone(cached(K + '.bulge', () => weld([
      put(ball(0.042, 1, 0.95, 1, 7), -0.058, 0.048, 0.008),
      put(ball(0.042, 1, 0.95, 1, 7), 0.058, 0.048, 0.008),
    ])), mats.coat, false));

    const F = { r: 0.017, upper: 0.062, lower: 0.062, bend: -1, front: true, y: -0.03, toe: 0.028 };
    const H = { r: 0.024, upper: 0.10, lower: 0.10, bend: 1, front: false, y: -0.02, toe: 0.05, flat: 1.0 };
    rig.legs.push(buildLeg(K, { ...F, id: 'FL', geo: 'fl', side: -1, x: 0.055, z: 0.055 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...F, id: 'FR', geo: 'fl', side: 1, x: 0.055, z: 0.055 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HL', geo: 'hl', side: -1, x: 0.070, z: -0.06 }, hips, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HR', geo: 'hl', side: 1, x: 0.070, z: -0.06 }, hips, mats));

    Object.assign(rig, {
      root, body, chest, hips, neck: [], head, eyes, ears: [], tail: [], throat, stand: 0.115,
    });
    return rig;
  },
};

/* heron ─ the pond's punctuation mark */
SPECIES.heron = {
  key: 'heron',
  mats: {
    coat: () => coat('#cfd6d4', 'feather', 0.88, 3),
    mark: () => coat('#f0f2ee', 'feather', 0.88, 3),
    dark: () => coat('#5b6668', 'feather', 0.86, 3),
    trim: () => coat('#d8a94e', 'skin', 0.6, 2),
  },
  gait: {
    walk: 0.55, run: 1.7, stride: 0.55, lift: 0.16,
    duty: 0.66, dutyRun: 0.55, bob: 0.014, roll: 0.03, hop: 0,
    slow: 'biped', fast: 'biped',
  },
  brain: {
    shy: 9, curious: 0, roam: 8, notice: 20, graze: 0.5, rest: 0.06,
    groom: 0.42, idleMin: 4, idleMax: 11, earRate: 0, blink: [2.2, 6],
  },
  build(mats) {
    const K = 'heron';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.66; root.add(body);

    const chest = new THREE.Group(); body.add(chest);
    chest.add(bone(cached(K + '.body', () => weld([
      put(ball(0.11, 1.0, 0.95, 1.7, 10), 0, 0, 0),
      put(spike(0.06, 0.24, 7), 0, -0.02, -0.28, -Math.PI / 2),
    ])), mats.coat, true));
    const hips = chest;

    // three links: the S-curve of the neck is the whole silhouette
    const rest = [0.75, -0.95, 0.42];
    const neck = [];
    let parent = chest, y0 = 0.09, z0 = 0.08;
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      if (i === 0) g.position.set(0, y0, z0); else g.position.y = 0.15;
      g.rotation.x = rest[i];
      parent.add(g);
      g.add(upBone(`${K}.n${i}`, 0.15, 0.035 - i * 0.004, 0.031 - i * 0.004, mats.mark, false));
      neck.push(g);
      parent = g;
    }

    const head = new THREE.Group(); head.position.y = 0.15; parent.add(head);
    head.add(bone(cached(K + '.head', () => weld([
      put(ball(0.040, 1.0, 0.9, 1.25, 8), 0, 0, 0.01),
      put(ball(0.030, 1.1, 1.6, 0.5, 7), 0, 0.026, -0.03),
    ])), mats.mark, false));
    head.add(bone(cached(K + '.bill', () => weld([
      put(spike(0.020, 0.19, 6), 0, -0.004, 0.13, Math.PI / 2),
    ])), mats.trim, false));
    const eyes = eyeUnit(K + '.eyes', 0.013, 0.030, 0.010, 0.030);
    head.add(eyes);

    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.098, 0.03, -0.02);
      w.rotation.z = s * 0.06;
      chest.add(w);
      w.add(bone(cached(K + '.wing', () => weld([
        put(ball(0.10, 0.26, 0.62, 1.5, 8), 0, -0.02, -0.02),
      ])), mats.dark, false));
      wings.push({ g: w, rz: w.rotation.z, side: s });
    }

    const foot = () => [
      put(ball(0.030, 1.1, 0.24, 2.0, 7), 0, 0.006, 0.026),
      put(tube(0.008, 0.008, 0.05, 5), 0, 0.006, -0.026, Math.PI / 2),
    ];
    const L = {
      r: 0.013, upper: 0.34, lower: 0.36, bend: -1, front: false, y: -0.03,
      ankle: foot, ftMat: 'trim', upMat: 'trim', loMat: 'trim', flat: 1.0,
    };
    rig.legs.push(buildLeg(K, { ...L, id: 'L', geo: 'lg', side: -1, x: 0.038, z: -0.02 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...L, id: 'R', geo: 'lg', side: 1, x: 0.038, z: -0.02 }, chest, mats));

    Object.assign(rig, {
      root, body, chest, hips, neck, head, eyes, ears: [], tail: [], wings, stand: 0.66,
    });
    return rig;
  },
};

/* macaque ─ the temple troop */
SPECIES.macaque = {
  key: 'macaque',
  mats: {
    coat: () => coat('#8e7c68', 'fur', 0.94, 4),
    dark: () => coat('#5c4f42', 'fur', 0.92, 3),
    trim: () => coat('#c8a08c', 'skin', 0.62, 2),
  },
  gait: {
    walk: 1.25, run: 3.6, stride: 0.42, lift: 0.09,
    duty: 0.60, dutyRun: 0.44, bob: 0.024, roll: 0.045, hop: 0,
    slow: 'lateral', fast: 'diagonal',
  },
  brain: {
    shy: 4.5, curious: 11, roam: 16, notice: 20, graze: 0.24, rest: 0.14,
    groom: 0.42, idleMin: 1.6, idleMax: 5, earRate: 0.7, blink: [1.4, 3.6],
  },
  build(mats) {
    const K = 'macaque';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.34; root.add(body);

    const chest = new THREE.Group(); chest.position.z = 0.13; body.add(chest);
    chest.add(bone(cached(K + '.chest', () => weld([
      put(ball(0.135, 1.0, 1.0, 1.25, 9), 0, 0.02, 0),
    ])), mats.coat, true));

    const hips = new THREE.Group(); hips.position.z = -0.13; body.add(hips);
    hips.add(bone(cached(K + '.hips', () => weld([
      put(ball(0.125, 1.0, 1.0, 1.1, 9), 0, 0, 0),
    ])), mats.coat, true));

    const n0 = new THREE.Group(); n0.position.set(0, 0.10, 0.12); n0.rotation.x = 0.30; chest.add(n0);
    n0.add(upBone(K + '.n0', 0.09, 0.058, 0.05, mats.coat));

    const head = new THREE.Group(); head.position.y = 0.09; n0.add(head);
    head.add(bone(cached(K + '.head', () => weld([
      put(ball(0.088, 1.0, 1.0, 0.95, 9), 0, 0.015, -0.005),
    ])), mats.coat, true));
    head.add(bone(cached(K + '.face', () => weld([
      put(ball(0.058, 0.92, 0.85, 0.9, 8), 0, -0.012, 0.055),
      put(ball(0.028, 1.0, 0.6, 0.9, 7), 0, -0.030, 0.088),
    ])), mats.trim, false));
    const eyes = eyeUnit(K + '.eyes', 0.021, 0.038, 0.022, 0.088);
    head.add(eyes);

    const ears = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 0.082, 0.02, -0.01);
      e.rotation.set(0, 0, s * 0.1);
      head.add(e);
      e.add(bone(cached(K + '.ear', () => weld([
        put(ball(0.030, 0.35, 1.0, 0.9, 7), 0, 0, 0),
      ])), mats.trim, false));
      ears.push({ g: e, rx: e.rotation.x, rz: e.rotation.z, side: s, f: 0 });
    }

    const tail = backChain(K + '.tail', mats.dark, 3, 0.12, 0.020, 0.011, [0.9, -0.3, -0.5]);
    tail[0].g.position.set(0, 0.09, -0.13);
    hips.add(tail[0].g);

    const F = { r: 0.026, upper: 0.20, lower: 0.19, bend: -1, front: true, y: -0.02, loMat: 'dark', toe: 0.03 };
    const H = { r: 0.030, upper: 0.20, lower: 0.20, bend: 1, front: false, y: -0.02, loMat: 'dark', toe: 0.035 };
    rig.legs.push(buildLeg(K, { ...F, id: 'FL', geo: 'fl', side: -1, x: 0.072, z: 0.03 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...F, id: 'FR', geo: 'fl', side: 1, x: 0.072, z: 0.03 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HL', geo: 'hl', side: -1, x: 0.070, z: -0.02 }, hips, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HR', geo: 'hl', side: 1, x: 0.070, z: -0.02 }, hips, mats));

    Object.assign(rig, { root, body, chest, hips, neck: [n0], head, eyes, ears, tail, stand: 0.34 });
    return rig;
  },
};

/* water buffalo ─ the slow mass a rice valley needs */
SPECIES.buffalo = {
  key: 'buffalo',
  mats: {
    coat: () => coat('#6e6a68', 'fur', 0.95, 3),
    dark: () => coat('#4a4744', 'fur', 0.9, 2),
    trim: () => coat('#d6cec2', 'skin', 0.66, 2),
  },
  gait: {
    walk: 0.85, run: 2.6, stride: 0.75, lift: 0.10,
    duty: 0.70, dutyRun: 0.55, bob: 0.026, roll: 0.05, hop: 0,
    slow: 'lateral', fast: 'lateral',
  },
  brain: {
    shy: 3.0, curious: 0, roam: 18, notice: 18, graze: 0.78, rest: 0.16,
    groom: 0.06, idleMin: 5, idleMax: 13, earRate: 1.1, blink: [2.6, 6],
  },
  build(mats) {
    const K = 'buffalo';
    const rig = { legs: [] };
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const body = new THREE.Group(); body.position.y = 0.78; root.add(body);

    const chest = new THREE.Group(); chest.position.z = 0.34; body.add(chest);
    chest.add(bone(cached(K + '.chest', () => weld([
      put(ball(0.40, 1.0, 0.95, 1.5, 11), 0, 0.02, 0),
      put(ball(0.24, 1.0, 0.85, 0.9, 8), 0, 0.20, 0.10),   // withers hump
    ])), mats.coat, true));

    const hips = new THREE.Group(); hips.position.z = -0.36; body.add(hips);
    hips.add(bone(cached(K + '.hips', () => weld([
      put(ball(0.36, 1.0, 1.0, 1.25, 11), 0, 0.0, 0),
    ])), mats.coat, true));

    const n0 = new THREE.Group(); n0.position.set(0, 0.10, 0.44); n0.rotation.x = 0.75; chest.add(n0);
    n0.add(upBone(K + '.n0', 0.24, 0.18, 0.15, mats.coat));

    const head = new THREE.Group(); head.position.y = 0.24; n0.add(head);
    head.add(bone(cached(K + '.head', () => {
      const p = [
        put(ball(0.135, 1.0, 0.95, 1.35, 9), 0, 0, 0.02),
        put(tube(0.085, 0.115, 0.19, 8), 0, -0.03, 0.20, Math.PI / 2),
      ];
      // the crescent horns sweep back and up — three cones a side reads enough
      for (const s of [-1, 1]) {
        p.push(put(tube(0.026, 0.038, 0.22, 6), s * 0.16, 0.10, -0.02, 0, 0, s * 1.25));
        p.push(put(tube(0.018, 0.026, 0.18, 6), s * 0.30, 0.16, -0.03, -0.3, 0, s * 0.75));
        p.push(put(spike(0.017, 0.13, 6), s * 0.35, 0.30, -0.02, -0.2, 0, s * 0.25));
      }
      return weld(p);
    }), mats.coat, true));
    head.add(bone(cached(K + '.muzzle', () => weld([
      put(ball(0.085, 1.05, 0.75, 0.7, 8), 0, -0.03, 0.28),
    ])), mats.trim, false));
    const eyes = eyeUnit(K + '.eyes', 0.030, 0.105, 0.045, 0.055);
    head.add(eyes);

    const ears = [];
    for (const s of [-1, 1]) {
      const e = new THREE.Group();
      e.position.set(s * 0.115, 0.045, -0.03);
      e.rotation.set(-0.05, 0, s * 1.15);
      head.add(e);
      e.add(bone(cached(K + '.ear', () => weld([
        put(ball(0.055, 0.42, 1.5, 0.4, 7), 0, 0.065, 0),
      ])), mats.coat, false));
      ears.push({ g: e, rx: e.rotation.x, rz: e.rotation.z, side: s, f: 0 });
    }

    const tail = backChain(K + '.tail', mats.dark, 2, 0.22, 0.030, 0.016, [-1.3, -0.2]);
    tail[0].g.position.set(0, 0.28, -0.30);
    hips.add(tail[0].g);

    const F = { r: 0.075, upper: 0.45, lower: 0.43, bend: -1, front: true, y: -0.04, loMat: 'dark', toe: 0.03 };
    const H = { r: 0.080, upper: 0.46, lower: 0.44, bend: 1, front: false, y: -0.04, loMat: 'dark', toe: 0.03 };
    rig.legs.push(buildLeg(K, { ...F, id: 'FL', geo: 'fl', side: -1, x: 0.21, z: 0.04 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...F, id: 'FR', geo: 'fl', side: 1, x: 0.21, z: 0.04 }, chest, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HL', geo: 'hl', side: -1, x: 0.22, z: -0.02 }, hips, mats));
    rig.legs.push(buildLeg(K, { ...H, id: 'HR', geo: 'hl', side: 1, x: 0.22, z: -0.02 }, hips, mats));

    Object.assign(rig, { root, body, chest, hips, neck: [n0], head, eyes, ears, tail, stand: 0.78 });
    return rig;
  },
};

/* ─────────── where a given animal is allowed to stand ─────────── */

const onLand = (x, z) => {
  const h = heightAt(x, z);
  return h > WATER_LEVEL + 0.4 && Math.hypot(x - POND.x, z - POND.z) > POND.r * 1.05;
};

/** The heron wants the opposite: shallow water, close in to the reeds. */
const onShallow = (x, z) => {
  const pd = Math.hypot(x - POND.x, z - POND.z);
  if (pd > POND.r * 1.16) return false;
  const h = heightAt(x, z);
  return h > WATER_LEVEL - 0.42 && h < WATER_LEVEL + 0.9;
};

/* ─────────── the creature ─────────── */

const TWO_PI = Math.PI * 2;
const _qBody = new THREE.Quaternion();
const _qBlock = new THREE.Quaternion();
const _qLeg = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();
const _pBlock = new THREE.Vector3();
const _pLeg = new THREE.Vector3();
const _pFoot = new THREE.Vector3();

const frac = (v) => v - Math.floor(v);
const wrapPi = (a) => {
  let d = a;
  while (d > Math.PI) d -= TWO_PI;
  while (d < -Math.PI) d += TWO_PI;
  return d;
};

class Creature {
  constructor(spec, rig, opts, rnd) {
    this.spec = spec;
    this.rig = rig;
    this.root = rig.root;
    // gathered once so the shadow policy below can flip them without walking
    // the hierarchy every frame
    this.casters = [];
    rig.root.traverse((o) => { if (o.isMesh && o.castShadow) this.casters.push(o); });
    this.casting = true;
    this.gaitCfg = spec.gait;
    this.brain = { ...spec.brain, ...(opts.brain || {}) };
    this.scale = opts.scale || 1;
    this.stand = rig.stand;
    this.walkSpeed = spec.gait.walk * (0.85 + 0.3 * rnd());
    this.standOn = opts.standOn || onLand;
    this.groundY = opts.groundY || heightAt;

    this.root.scale.setScalar(this.scale);
    this.pos = new THREE.Vector2(opts.x, opts.z);
    this.home = this.pos.clone();
    this.target = this.pos.clone();

    this.heading = rnd() * TWO_PI;
    this.prevHeading = this.heading;
    this.yawRate = 0;
    this.spd = 0;
    this.gait = rnd();
    this.fastK = 0;
    this.hopY = 0;
    this.tiltX = 0; this.tiltZ = 0; this.lean = 0;
    this.state = 'stand';
    this.timer = 0.5 + rnd() * 3;
    this.sub = 0;
    this.groomLeg = 2;
    this.blinkIn = 1 + rnd() * 3;
    this.blink = 0;
    this.breath = rnd() * TWO_PI;

    // target pose vs. the damped pose actually written to the rig; every
    // behaviour is just a different set of targets, so transitions blend free
    this.p = { neck: 0, pitch: 0, yaw: 0, crouch: 0, alert: 0, fold: 0, tail: 0 };
    this.q = { ...this.p };
    this.q.groomK = 0;
    this.groomT = 0;
  }

  /* ─── behaviour ─── */

  _pick(rnd) {
    const b = this.brain;
    const r = rnd();
    let acc = b.graze;
    if (r < acc) return 'graze';
    acc += b.groom;
    if (r < acc) return 'groom';
    acc += b.rest;
    if (r < acc) return 'rest';
    return rnd() < 0.55 ? 'stand' : 'walk';
  }

  _retarget(rnd, range, cx = this.home.x, cz = this.home.y) {
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TWO_PI;
      const r = 1 + rnd() * range;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      if (this.standOn(x, z)) { this.target.set(x, z); return true; }
    }
    this.target.copy(this.home);
    return false;
  }

  _think(dt, near, dx, dz, rnd) {
    const b = this.brain;

    if (b.shy > 0 && near < b.shy) {
      const l = Math.max(0.001, near);
      const fx = this.pos.x - (dx / l) * 9;
      const fz = this.pos.y - (dz / l) * 9;
      if (this.standOn(fx, fz)) this.target.set(fx, fz);
      this.state = 'flee';
      this.timer = 1.4;
      return;
    }
    if (b.curious > 0 && near < b.curious && near > 2.4 && this.state !== 'groom' && this.state !== 'rest') {
      this.target.set(this.pos.x + dx * 0.72, this.pos.y + dz * 0.72);
      if (this.state !== 'walk') { this.state = 'walk'; this.timer = 4; }
    }

    this.timer -= dt;
    if (this.timer > 0) return;

    const next = this.state === 'walk' || this.state === 'flee' ? this._pick(rnd) : 'walk';
    this.state = next;
    if (next === 'walk') {
      this._retarget(rnd, b.roam);
      this.timer = 3 + rnd() * 5;
    } else if (next === 'graze') {
      this.timer = 4 + rnd() * 7;
      this.sub = 0.8 + rnd() * 1.6;
    } else if (next === 'groom') {
      this.timer = 1.6 + rnd() * 1.8;
      this.groomLeg = 2 + ((rnd() * 2) | 0);
    } else if (next === 'rest') {
      this.timer = 8 + rnd() * 14;
    } else {
      this.timer = b.idleMin + rnd() * (b.idleMax - b.idleMin);
      this.sub = rnd() < 0.6 ? (rnd() - 0.5) * 2.0 : 0;   // glance somewhere
    }
  }

  /* ─── locomotion ─── */

  _move(dt, rnd) {
    const g = this.gaitCfg;
    let want = 0;

    if (this.state === 'graze') {
      // grazing is a walk with the brakes on: a nibble, two steps, a nibble
      this.sub -= dt;
      if (this.sub <= 0) {
        this.sub = 2.5 + rnd() * 4;
        this._retarget(rnd, 1.6, this.pos.x, this.pos.y);
      }
      want = g.walk * 0.26;
    } else if (this.state === 'walk') {
      want = this.walkSpeed;
    } else if (this.state === 'flee') {
      want = g.run;
    }

    if (want > 0) {
      const tx = this.target.x - this.pos.x, tz = this.target.y - this.pos.y;
      const dist = Math.hypot(tx, tz);
      if (dist < 0.45) {
        want = 0;
        if (this.state === 'walk') { this.state = 'stand'; this.timer = Math.min(this.timer, 0.4); }
      } else {
        const diff = wrapPi(Math.atan2(tx, tz) - this.heading);
        const rate = this.state === 'flee' ? 3.6 : 2.1;
        this.heading += clamp(diff, -rate * dt, rate * dt);
        // do not sprint sideways — bleed speed off while the turn is wide
        want *= 1 - clamp(Math.abs(diff) / Math.PI, 0, 1) * 0.55;
      }
    }

    this.spd = damp(this.spd, want, this.state === 'flee' ? 5.5 : 3.0, dt);

    if (this.spd > 0.01) {
      const step = this.spd * dt;
      const nx = this.pos.x + Math.sin(this.heading) * step;
      const nz = this.pos.y + Math.cos(this.heading) * step;
      if (this.standOn(nx, nz)) {
        this.pos.set(nx, nz);
        // phase advances per METRE travelled, which is what kills foot slide
        this.gait = frac(this.gait + step / this.strideLen);
      } else {
        this._retarget(rnd, this.brain.roam);
      }
    }

    this.yawRate = damp(this.yawRate, wrapPi(this.heading - this.prevHeading) / Math.max(dt, 1e-4), 8, dt);
    this.prevHeading = this.heading;
  }

  get strideLen() {
    const g = this.gaitCfg;
    return g.stride * this.scale * (0.62 + 0.5 * clamp(this.spd / g.walk, 0, 2.2));
  }

  /* ─── pose ─── */

  _poseTargets(near, dx, dz) {
    const p = this.p;
    const b = this.brain;
    p.neck = 0; p.pitch = 0; p.yaw = 0; p.crouch = 0; p.fold = 0; p.tail = 0;
    p.alert = near < b.notice ? smoothstep(b.notice, b.notice * 0.35, near) : 0;

    if (this.state === 'graze') {
      p.neck = 1.5; p.pitch = 1.55; p.alert *= 0.3;
    } else if (this.state === 'groom') {
      p.neck = 0.55; p.pitch = 0.9; p.yaw = 0.5;
    } else if (this.state === 'rest') {
      p.crouch = 1; p.fold = 1; p.neck = 0.1; p.alert *= 0.5;
    } else if (this.state === 'flee') {
      p.neck = -0.16; p.alert = 1; p.tail = 0.7;
    } else if (this.state === 'stand') {
      p.yaw = this.sub;
    }

    // a near visitor wins the head: they turn to look, everything else fades
    if (p.alert > 0.05 && this.state !== 'rest') {
      const look = wrapPi(Math.atan2(dx, dz) - this.heading);
      p.yaw = p.yaw * (1 - p.alert) + clamp(look, -1.25, 1.25) * p.alert;
      p.pitch = p.pitch * (1 - p.alert * 0.7);
      p.neck *= 1 - p.alert * 0.7;
    }
  }

  /**
   * Foot targets are authored in ROOT space, where the ground is the y=0 plane,
   * and only then pushed back through the body/spine transform. Solving in the
   * leg's own frame instead lets every wobble of the torso drag the feet with
   * it, which is exactly the skating this rewrite exists to kill.
   */
  _writeLegs() {
    const g = this.gaitCfg;
    const legs = this.rig.legs;
    const body = this.rig.body;
    const moving = clamp(this.spd / g.walk, 0, 1.6);
    const duty = g.duty + (g.dutyRun - g.duty) * this.fastK;
    // stance must carry the foot back exactly as far as the body travels while
    // it is down, or the animal skates. That distance is duty x stride.
    const sweep = (this.strideLen / this.scale) * duty;
    const swing = smoothstep(0.05, 0.28, this.spd);
    const lift = g.lift * (0.55 + 0.55 * moving);

    _qBody.setFromEuler(body.rotation);
    let block = null;

    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      if (leg.block !== block) {
        block = leg.block;
        _qBlock.setFromEuler(block.rotation);
        _qLeg.copy(_qBody).multiply(_qBlock);
        _qInv.copy(_qLeg).invert();
        _pBlock.copy(block.position).applyQuaternion(_qBody).add(body.position);
      }
      _pLeg.copy(leg.hip.position).applyQuaternion(_qLeg).add(_pBlock);

      const reach = Math.min(sweep, (leg.upper + leg.lower) * 0.7) * swing;
      const ph = frac(this.gait + leg.phase);
      let fz, fy, toe;
      if (ph < duty) {
        const u = ph / duty;
        fz = reach * (0.5 - u);
        fy = 0;
        toe = smoothstep(0.65, 1.0, u) * 0.45;             // push off the toe
      } else {
        const u = (ph - duty) / (1 - duty);
        fz = reach * (u - 0.5);
        fy = Math.sin(Math.PI * u) * lift * swing;
        toe = -Math.sin(Math.PI * u) * 0.3;                 // and reach with it
      }

      // in flight the feet tuck up with the body instead of dangling at grass level
      if (fy > 0) fy += this.hopY;
      _pFoot.set(leg.restX, fy, leg.restZ + fz + leg.stance).sub(_pLeg).applyQuaternion(_qInv);
      solveLeg(leg, _pFoot.x, _pFoot.y, _pFoot.z, toe * swing);
    }

    if (this.q.fold > 0.02) this._fold(this.q.fold);
    if (this.q.groomK > 0.02) this._groomLeg(this.q.groomK);
  }

  /** Blend the solved legs toward a folded, lying-down pose. */
  _fold(k) {
    const legs = this.rig.legs;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const hipA = leg.bend > 0 ? -1.15 : 1.05;
      const kneeA = leg.bend * 2.35;
      leg.hip.rotation.x += (hipA - leg.hip.rotation.x) * k;
      leg.knee.rotation.x += (kneeA - leg.knee.rotation.x) * k;
      if (leg.ankle) leg.ankle.rotation.x += (0.5 - leg.ankle.rotation.x) * k;
    }
  }

  /** One hind leg comes up to scratch behind the ear. */
  _groomLeg(k) {
    const leg = this.rig.legs[Math.min(this.groomLeg, this.rig.legs.length - 1)];
    if (!leg) return;
    const buzz = Math.sin(this.groomT * 26) * 0.16;
    leg.hip.rotation.x += (-1.5 + buzz - leg.hip.rotation.x) * k;
    leg.knee.rotation.x += (leg.bend * 2.1 - leg.knee.rotation.x) * k;
    leg.hip.rotation.z = 0.5 * k;
  }

  _writeSpine(bob, bodyPitch) {
    const r = this.rig;
    const q = this.q;
    const moving = clamp(this.spd / this.gaitCfg.walk, 0, 1.6);
    const sway = Math.sin(TWO_PI * this.gait) * 0.05 * moving;

    r.chest.rotation.x = -bodyPitch * 0.45 + q.neck * 0.10;
    r.chest.rotation.y = sway * 0.7;
    if (r.hips !== r.chest) {
      r.hips.rotation.x = bodyPitch * 0.35;
      r.hips.rotation.y = -sway;
    }

    // How far the neck's root rises this frame, and the neck pitch that cancels
    // it — rotating the neck by rise/reach holds the head at a fixed height, and
    // a stable head is the single strongest "alive" cue an animal has. The hop
    // is left out: a bounding rabbit's head is supposed to ride the arc.
    // (A positive rotation.x drops whatever sits forward of the pivot, hence the
    // minus on the pitch arm.)
    const rise = (bob - this.hopY) - r.neckArm * bodyPitch;
    // capped at ten degrees: a short, near-vertical neck physically cannot
    // cancel much, and forcing it to try reads as a mechanical nod
    const comp = clamp(rise / r.neckReach, -0.18, 0.18) * 0.85;

    let neckSum = 0;
    const n = r.neck.length;
    for (let i = 0; i < n; i++) {
      const g = r.neck[i];
      const w = i === 0 ? 0.62 : 0.38 / Math.max(1, n - 1);
      const bend = (q.neck + comp) * w;
      g.rotation.x = g.userData.rest + bend;
      g.rotation.y = q.yaw * (0.34 / n);
      g.rotation.z = Math.sin(TWO_PI * this.gait + i) * 0.02 * moving;
      neckSum += bend;
    }
    if (r.head) {
      r.head.rotation.x = -(neckSum + bodyPitch + r.chest.rotation.x) * 0.9 + q.pitch;
      r.head.rotation.y = q.yaw * 0.66;
      r.head.rotation.z = q.yaw * 0.12;
    }
  }

  _writeTail(dt, bob) {
    const chain = this.rig.tail;
    if (!chain.length) return;
    let driveX = this.q.tail * 0.9 - bob * 2.2;
    let driveY = clamp(-this.yawRate * 0.30, -0.7, 0.7);
    for (let i = 0; i < chain.length; i++) {
      const l = chain[i];
      const stiff = 60 - i * 12;
      const dampK = 9 - i * 1.2;
      l.vx += ((l.rest + driveX - l.ax) * stiff - l.vx * dampK) * dt;
      l.vy += ((driveY - l.ay) * stiff - l.vy * dampK) * dt;
      l.ax += l.vx * dt; l.ay += l.vy * dt;
      l.g.rotation.x = l.ax;
      l.g.rotation.y = l.ay;
      // each link chases the one before it, which is what makes a tail whip
      driveX = (l.ax - l.rest) * 0.55;
      driveY = l.ay * 0.7;
    }
  }

  _writeEars(dt, rnd) {
    for (const e of this.rig.ears) {
      if (e.f > 0) {
        e.f = Math.max(0, e.f - dt * 2.6);
      } else if (rnd() < dt * (this.brain.earRate || 0)) {
        e.f = 1;
      }
      const k = e.f * e.f;
      e.g.rotation.z = e.rz + Math.sin(e.f * 30) * 0.4 * k * e.side;
      e.g.rotation.x = e.rx - this.q.alert * 0.30 + this.q.crouch * 0.2;
    }
  }

  _writeFace(dt, rnd) {
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      const b = this.brain.blink;
      this.blinkIn = b[0] + rnd() * (b[1] - b[0]);
      this.blink = 0.14;
    }
    if (this.blink > 0) {
      this.blink -= dt;
      const open = Math.abs(this.blink / 0.07 - 1);
      this.rig.eyes.scale.y = 0.07 + 0.93 * clamp(open, 0, 1);
    } else if (this.rig.eyes.scale.y !== 1) {
      this.rig.eyes.scale.y = 1;
    }
  }

  update(dt, t, player, rnd, detail) {
    const dx = player.x - this.pos.x, dz = player.z - this.pos.y;
    const near = Math.hypot(dx, dz);

    this._think(dt, near, dx, dz, rnd);
    this._move(dt, rnd);

    const gy = this.groundY(this.pos.x, this.pos.y);
    this.root.position.set(this.pos.x, gy, this.pos.y);
    this.root.rotation.y = this.heading;

    if (!detail) return;

    this._poseTargets(near, dx, dz);
    const q = this.q;
    for (const k in this.p) q[k] = damp(q[k], this.p[k], 3.4, dt);
    q.groomK = damp(q.groomK, this.state === 'groom' ? 1 : 0, 5.5, dt);
    this.groomT += dt;

    const g = this.gaitCfg;
    this.fastK = damp(this.fastK, this.spd > g.walk * 1.5 ? 1 : 0, 2.5, dt);
    for (const leg of this.rig.legs) {
      leg.phase = leg.phaseSlow + (leg.phaseFast - leg.phaseSlow) * this.fastK;
    }

    // stand on the slope rather than through it
    const n = normalAt(this.pos.x, this.pos.y, 1.2);
    const ny = Math.max(0.25, n.y);
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.tiltX = damp(this.tiltX, Math.atan((n.x * fx + n.z * fz) / ny), 4, dt);
    this.tiltZ = damp(this.tiltZ, Math.atan(-(n.x * fz - n.z * fx) / ny), 4, dt);
    this.lean = damp(this.lean, clamp(-this.yawRate * 0.10 * clamp(this.spd, 0, 4), -0.2, 0.2), 5, dt);
    this.root.rotation.x = this.tiltX;
    this.root.rotation.z = this.tiltZ + this.lean;

    const moving = clamp(this.spd / g.walk, 0, 1.6);
    this.breath += dt * 1.9;
    // the body drops twice a cycle, once under each supporting pair
    let bob = -g.bob * Math.cos(4 * Math.PI * this.gait) * moving;
    this.hopY = 0;
    if (g.hop > 0) {
      const u = frac(this.gait - FLIGHT_AT) / FLIGHT_LEN;
      this.hopY = u < 1 ? g.hop * Math.sin(Math.PI * u) * moving : 0;
      bob += this.hopY;
    }
    bob += Math.sin(this.breath) * 0.006 * (1.2 - moving * 0.5);   // breathing, always
    const bodyPitch = g.bob * 1.4 * Math.sin(4 * Math.PI * this.gait) * moving;
    const bodyRoll = g.roll * Math.sin(TWO_PI * this.gait) * moving;

    const bodyY = this.stand * (1 - q.crouch * 0.62) + bob;
    this.rig.body.position.y = bodyY;
    this.rig.body.rotation.x = bodyPitch;
    this.rig.body.rotation.z = bodyRoll;

    // spine first: the leg solve reads the block rotations it leaves behind
    this._writeSpine(bob, bodyPitch);
    this._writeLegs();
    this._writeTail(dt, bob);
    this._writeEars(dt, rnd);
    this._writeFace(dt, rnd);

    if (this.rig.wings) this._writeWings(t, q);
    if (this.rig.throat) {
      const pulse = 1 + Math.max(0, Math.sin(this.breath * 1.6)) * 0.26;
      this.rig.throat.scale.set(pulse, pulse, 1 + (pulse - 1) * 0.4);
    }
  }

  /** Folded wings that lift for a preen and part a little when startled. */
  _writeWings(t, q) {
    const flick = this.state === 'groom' ? 1 : 0;
    for (const w of this.rig.wings) {
      const open = flick * (0.45 + Math.sin(t * 9) * 0.22) + q.alert * 0.10;
      w.g.rotation.z = w.rz + open * w.side;
      w.g.rotation.x = -open * 0.3;
    }
  }
}

/* ─────────── birds on the wing ─────────── */

function buildFlier(rnd) {
  const hue = ['#8fb6d8', '#a9bfd0', '#c3cbd6'][(rnd() * 3) | 0];
  const mBody = coat(hue, 'feather', 0.88, 3);
  const mWing = coat('#7a9cbc', 'feather', 0.88, 3);

  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  root.add(bone(cached('flier.body.' + hue, () => weld([
    ball(0.14, 1.0, 0.9, 1.6, 9),
    put(ball(0.085, 1, 1, 1, 8), 0, 0.05, 0.17),
    put(spike(0.032, 0.10, 6), 0, 0.045, 0.27, Math.PI / 2),
    put(spike(0.085, 0.26, 6), 0, 0.01, -0.29, -Math.PI / 2),
  ])), mBody, false));

  const wings = [];
  for (const s of [-1, 1]) {
    // mirrored geometry rather than a negative scale — flipping x would invert
    // the winding and the whole left wing would render inside out
    const inner = new THREE.Group();
    inner.position.set(s * 0.07, 0.05, 0.01);
    root.add(inner);
    inner.add(bone(cached('flier.win' + s, () => weld([
      put(ball(0.13, 1.5, 0.16, 0.85, 7), s * 0.13, 0, 0),
    ])), mWing, false));

    const outer = new THREE.Group();
    outer.position.x = s * 0.26;
    inner.add(outer);
    outer.add(bone(cached('flier.wout' + s, () => weld([
      put(ball(0.14, 1.55, 0.10, 0.7, 7), s * 0.14, 0, -0.03),
    ])), mWing, false));
    wings.push({ inner, outer, side: s });
  }
  return { root, wings };
}

/* ─────────── fish in the pond ─────────── */

function buildSwimmer(rnd) {
  const hue = ['#e2874f', '#e8a765', '#d8d2be'][(rnd() * 3) | 0];
  const mBody = coat(hue, 'skin', 0.55, 4);

  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  root.add(bone(cached('fish.front.' + hue, () => weld([
    ball(0.15, 0.62, 1.0, 1.5, 9),
    put(ball(0.05, 0.28, 1.0, 0.85, 6), 0.085, -0.01, 0.02),
    put(ball(0.05, 0.28, 1.0, 0.85, 6), -0.085, -0.01, 0.02),
    put(ball(0.06, 0.14, 1.1, 1.4, 6), 0, 0.12, -0.02),
  ])), mBody, false));

  const mid = new THREE.Group();
  mid.position.z = -0.16;
  root.add(mid);
  mid.add(bone(cached('fish.mid.' + hue, () => weld([
    put(ball(0.10, 0.52, 0.9, 1.3, 8), 0, 0, -0.09),
  ])), mBody, false));

  const tail = new THREE.Group();
  tail.position.z = -0.20;
  mid.add(tail);
  tail.add(bone(cached('fish.tail.' + hue, () => weld([
    put(ball(0.12, 0.10, 1.15, 1.0, 7), 0, 0, -0.10),
  ])), mBody, false));

  root.add(eyeUnit('fish.eyes', 0.024, 0.058, 0.03, 0.14));

  return { root, mid, tail };
}

/* ─────────── kodama ─────────── */

function buildSpirit(glowMat) {
  const root = new THREE.Group();
  root.add(bone(cached('kodama.body', () => weld([
    put(ball(0.085, 1, 1.4, 0.7, 8), 0, 0.14, 0),
    put(tube(0.020, 0.024, 0.14, 6), -0.055, 0.06, 0),
    put(tube(0.020, 0.024, 0.14, 6), 0.055, 0.06, 0),
  ])), glowMat, false));

  const head = new THREE.Group();
  head.position.y = 0.30;
  root.add(head);
  head.add(bone(cached('kodama.head', () => weld([
    ball(0.18, 1, 1.08, 0.95, 10),
  ])), glowMat, false));
  // the three hollows have to be their own mesh or they vanish into the glow
  head.add(bone(cached('kodama.face', () => weld([
    put(ball(0.038, 1, 1, 0.55, 7), -0.068, 0.045, 0.155),
    put(ball(0.038, 1, 1, 0.55, 7), 0.068, 0.045, 0.155),
    put(ball(0.034, 1, 0.65, 0.55, 7), 0, -0.055, 0.165),
  ])), M_EYE, false));

  return { root, head };
}

/* ─────────── the menagerie ─────────── */

export class Wildlife {
  constructor(scene, opts = {}) {
    this.group = new THREE.Group();
    this.group.name = 'wildlife';
    scene.add(this.group);

    this.rnd = makeRandom(24680);
    this.walkers = [];
    this.fliers = [];
    this.swimmers = [];
    this.spirits = [];
    this.thin = !!opts.lowEnd;

    // beyond this a deer is a handful of pixels; hiding the whole Group is the
    // only LOD that actually buys back draw calls
    this.cullSq = 92 * 92;
    this.detailSq = 42 * 42;

    this.glowMaterial = pbr({
      map: skinTexture('#eef3ea'),
      roughness: 0.85,
      metalness: 0,
      repeat: [2, 2],
    });
    this.glowMaterial.emissive = new THREE.Color(0x5c6b58);
    this.glowMaterial.emissiveIntensity = 0;
    this.glowMaterial.envMapIntensity = 0.55;

    this._spawnLand();
    this._spawnFliers();
    this._spawnSwimmers();
    this._spawnSpirits();
  }

  /* ─── placement ─── */

  _findSpot(cx, cz, spread, test) {
    for (let i = 0; i < 40; i++) {
      const a = this.rnd() * TWO_PI;
      const r = Math.sqrt(this.rnd()) * spread;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (test(x, z)) return [x, z];
    }
    return [cx, cz];
  }

  _add(name, cx, cz, spread, opts = {}) {
    const spec = SPECIES[name];
    const test = opts.standOn || onLand;
    const [x, z] = this._findSpot(cx, cz, spread, test);

    const mats = {};
    for (const k of Object.keys(spec.mats)) mats[k] = spec.mats[k]();
    const rig = spec.build(mats);
    this.group.add(rig.root);

    const slow = ORDER[spec.gait.slow], fast = ORDER[spec.gait.fast];
    for (const leg of rig.legs) {
      leg.phaseSlow = slow[leg.id] || 0;
      leg.phaseFast = fast[leg.id] || 0;
      leg.phase = leg.phaseSlow;
    }
    for (const g of rig.neck) g.userData.rest = g.rotation.x;

    // measured once from the rest pose: how far forward the neck root sits from
    // the body pivot, and how far forward of that root the head hangs
    rig.root.updateMatrixWorld(true);
    rig.neckArm = 0;
    rig.neckReach = 1;
    if (rig.neck.length) {
      const base = rig.neck[0].getWorldPosition(_pBlock).z;
      rig.neckArm = base;
      rig.neckReach = Math.max(0.06, rig.head.getWorldPosition(_pLeg).z - base);
    }

    const c = new Creature(spec, rig, { ...opts, x, z }, this.rnd);
    this.walkers.push(c);
    return c;
  }

  _spawnLand() {
    const n = (full, low) => (this.thin ? low : full);
    const R = this.rnd;

    for (let i = 0; i < n(9, 6); i++) {
      this._add('duckling', POND.x - 22, POND.z + 13, 13, { scale: 0.85 + R() * 0.3 });
    }
    for (let i = 0; i < n(4, 3); i++) {
      this._add('cat', 18, 20, 22, { scale: 0.92 + R() * 0.22 });
    }
    for (let i = 0; i < n(8, 5); i++) {
      this._add('rabbit', (R() - 0.5) * 95, (R() - 0.5) * 95, 16, { scale: 0.85 + R() * 0.3 });
    }
    for (let i = 0; i < n(4, 2); i++) {
      this._add('deer', (R() - 0.5) * 130, (R() - 0.5) * 130, 26, { scale: 0.92 + R() * 0.24 });
    }
    this._add('stag', -52, -34, 22, { scale: 1.1 + R() * 0.14 });

    for (let i = 0; i < n(4, 2); i++) {
      const a = R() * TWO_PI;
      const r = POND.r * (1.12 + R() * 0.16);
      this._add('frog', POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, 3.5, { scale: 1.0 + R() * 0.3 });
    }

    // the pond's waders — they stand in the shallows, so the ground floor lifts
    for (let i = 0; i < n(2, 1); i++) {
      this._add('heron', POND.x, POND.z, POND.r * 1.05, {
        scale: 0.95 + R() * 0.2,
        standOn: onShallow,
        groundY: (x, z) => Math.max(heightAt(x, z), WATER_LEVEL - 0.30),
      });
    }

    // a small troop around the bale and the gate
    for (let i = 0; i < n(3, 2); i++) {
      this._add('macaque', 20 - i * 6, 24 - i * 8, 12, { scale: 0.9 + R() * 0.25 });
    }
    for (let i = 0; i < n(2, 1); i++) {
      this._add('buffalo', -30 - i * 14, -12 + i * 9, 16, { scale: 1.0 + R() * 0.16 });
    }
  }

  _spawnFliers() {
    const count = this.thin ? 9 : 16;
    for (let i = 0; i < count; i++) {
      const f = buildFlier(this.rnd);
      this.group.add(f.root);
      const s = 0.8 + this.rnd() * 0.6;
      f.root.scale.setScalar(s);
      this.fliers.push({
        rig: f,
        a: this.rnd() * TWO_PI,
        r: 24 + this.rnd() * 58,
        y: 15 + this.rnd() * 17,
        sp: (0.11 + this.rnd() * 0.16) * (this.rnd() < 0.5 ? 1 : -1),
        ph: this.rnd() * 9,
        cx: (this.rnd() - 0.5) * 70,
        cz: (this.rnd() - 0.5) * 70,
        glide: 0,
        flap: this.rnd(),
        rate: 5.2 + this.rnd() * 2.4,
      });
    }
  }

  _spawnSwimmers() {
    const count = this.thin ? 7 : 12;
    for (let i = 0; i < count; i++) {
      const f = buildSwimmer(this.rnd);
      this.group.add(f.root);
      f.root.scale.setScalar(0.7 + this.rnd() * 0.6);
      this.swimmers.push({
        rig: f,
        a: this.rnd() * TWO_PI,
        r: 3 + this.rnd() * (POND.r * 0.6),
        sp: (0.2 + this.rnd() * 0.34) * (this.rnd() < 0.5 ? 1 : -1),
        ph: this.rnd() * 9,
        jump: 4 + this.rnd() * 16,
        depth: 0.25 + this.rnd() * 0.4,
      });
    }
  }

  _spawnSpirits() {
    const count = this.thin ? 5 : 9;
    for (let i = 0; i < count; i++) {
      const [x, z] = this._findSpot((this.rnd() - 0.5) * 110, (this.rnd() - 0.5) * 110, 20, onLand);
      const s = buildSpirit(this.glowMaterial);
      this.group.add(s.root);
      const size = 0.85 + this.rnd() * 0.5;
      s.root.position.set(x, heightAt(x, z), z);
      s.root.scale.setScalar(size);
      s.root.visible = false;
      this.spirits.push({ rig: s, x, z, size, ph: this.rnd() * 9, sp: 0.4 + this.rnd() * 0.5, k: 0 });
    }
  }

  /* ─── per frame ─── */

  update(dt, t, playerPos, nightFactor) {
    const px = playerPos.x, pz = playerPos.z;

    // Steering is cheap and keeps the far meadow alive; the skeleton is not, so
    // only animals close enough to read get posed at all.
    for (const c of this.walkers) {
      const ddx = c.pos.x - px, ddz = c.pos.y - pz;
      const d2 = ddx * ddx + ddz * ddz;
      const seen = d2 < this.cullSq;
      if (c.root.visible !== seen) c.root.visible = seen;
      c.update(dt, t, playerPos, this.rnd, seen && d2 < this.detailSq);

      /* Cast only from what is near enough for the shadow to resolve. A herd
         of forty animals contributes over a hundred draws to the depth pass,
         and at thirty metres a deer's shadow is four texels of mush — all
         cost, no image. Toggling the flag is free; the draw it saves is not. */
      const near = d2 < 900;
      if (c.casting !== near) {
        c.casting = near;
        for (const m of c.casters) m.castShadow = near;
      }
    }

    for (const b of this.fliers) {
      b.a += b.sp * dt;
      // a bird that circles forever reads as a mobile; let them coast sometimes
      b.glide -= dt;
      if (b.glide < -1.2) b.glide = this.rnd() < 0.5 ? 1.6 + this.rnd() * 2.2 : -1.19;
      const gliding = b.glide > 0;
      b.flap += dt * (gliding ? 0.6 : b.rate);

      const x = b.cx + Math.cos(b.a) * b.r;
      const z = b.cz + Math.sin(b.a) * b.r;
      const y = b.y + Math.sin(t * 0.7 + b.ph) * 1.7 + (gliding ? -1.4 : 0);
      b.rig.root.position.set(x, y, z);
      // The body is built nose-at-+Z and the flight path is a circle, so the
      // heading is atan2 of the velocity, which is -a one way round and PI-a
      // the other. The old quarter-turn had every bird crabbing wing-first.
      b.rig.root.rotation.y = -b.a + (b.sp > 0 ? 0 : Math.PI);
      b.rig.root.rotation.z = clamp(b.sp * 2.2, -0.6, 0.6);
      b.rig.root.rotation.x = Math.sin(t * 0.9 + b.ph) * 0.08;

      const beat = Math.sin(b.flap * TWO_PI);
      const amp = gliding ? 0.10 : 0.72;
      for (const w of b.rig.wings) {
        // the outer wing lags the inner one, which is the whole flap read
        w.inner.rotation.z = (0.12 + beat * amp) * w.side;
        w.outer.rotation.z = (0.05 + Math.sin((b.flap - 0.16) * TWO_PI) * amp * 0.8) * w.side;
      }
    }

    for (const f of this.swimmers) {
      f.a += f.sp * dt;
      const x = POND.x + Math.cos(f.a) * f.r;
      const z = POND.z + Math.sin(f.a) * f.r;
      f.jump -= dt;
      let y = WATER_LEVEL - f.depth + Math.sin(t * 1.4 + f.ph) * 0.1;
      let pitch = 0;
      if (f.jump < 0 && f.jump > -0.75) {
        const k = (f.jump + 0.75) / 0.75;
        y += Math.sin(k * Math.PI) * 1.05;
        pitch = Math.cos(k * Math.PI) * 0.9;
      } else if (f.jump <= -0.75) {
        f.jump = 8 + this.rnd() * 16;
      }
      f.rig.root.position.set(x, y, z);
      // same circle, same +Z-forward body: the two branches were swapped, so
      // every fish swam — and leapt — tail first
      f.rig.root.rotation.set(pitch, -f.a + (f.sp > 0 ? 0 : Math.PI), 0);
      // lateral wave down the body, not a barrel roll
      const beat = t * 5.5 + f.ph;
      f.rig.mid.rotation.y = Math.sin(beat) * 0.22;
      f.rig.tail.rotation.y = Math.sin(beat - 0.9) * 0.42;
    }

    const glow = clamp(nightFactor, 0, 1);
    this.glowMaterial.emissiveIntensity = glow * 0.85;
    for (const s of this.spirits) {
      s.k = damp(s.k, glow > 0.08 ? 1 : 0, 2.2, dt);
      const on = s.k > 0.02;
      if (s.rig.root.visible !== on) s.rig.root.visible = on;
      if (!on) continue;
      s.rig.root.scale.setScalar(s.size * s.k);
      s.rig.root.position.y = heightAt(s.x, s.z) + 0.04 + Math.sin(t * s.sp * 2 + s.ph) * 0.05;
      s.rig.head.rotation.y = Math.sin(t * s.sp * 3.4 + s.ph) * 0.85;
      s.rig.head.rotation.z = Math.sin(t * s.sp * 7 + s.ph) * 0.07;
    }
  }
}
