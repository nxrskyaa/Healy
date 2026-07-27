import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom, fbm, noise2, clamp, smoothstep } from './noise.js';
import { heightAt, normalAt, POND, WATER_LEVEL, WORLD_SIZE } from './terrain.js';
import {
  pbr, barkTexture, foliageTexture, groundTexture, rockTexture, brickTexture,
  thatchTexture, woodTexture, clothTexture, batikTexture, waterNormal, normalFromCanvas,
} from './textures.js';

/* ═══════════════════════════════════════════════════════════
   Everything that turns the valley from a lawn with three
   monuments on it into somewhere people live: a flooded rice
   terrace cut into the south-east basin, a spring-fed cascade
   running down to the pond, a walled village either side of
   the footpath, bamboo, coconut palms, frangipani, guardian
   statues, roadside shrines and the offerings left at them.

   One entry point, one per-frame call. Nothing here edits the
   height field — every object is sited by querying it.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* Matched to trees.js so the whole valley leans the same way. */
const WIND_DIR = new THREE.Vector2(0.86, 0.51).normalize();

/* Shared by every swaying material, so one write a frame moves the bamboo,
   the palms, the rice and the laundry together. */
const windU = { t: { value: 0 }, w: { value: 0.6 } };

/* env.js calibrates the world to 0.55 once at build time and never again.
   Materials made here have to set it themselves or they read washed out. */
const ENV = 0.55;

/* ─────────── siting ─────────── */

const pathZ = (x) => x * 0.42 + Math.sin(x * 0.06) * 6 - 4;
const pathOffset = (x, z) => Math.abs(z - pathZ(x));

/** Unit direction the footpath runs in at x, as [dx, dz]. */
function pathDir(x) {
  const s = 0.42 + Math.cos(x * 0.06) * 0.36;
  const l = Math.hypot(1, s);
  return [1 / l, s / l];
}

/** The Y rotation that turns an object's local +Z to face a world direction. */
const yawTo = (dx, dz) => Math.atan2(dx, dz);

/* The terraces claim a rectangle of the basin. Everything scattered stays
   out of it; the terrace builder itself obviously does not. */
const T = { x0: 6, x1: 84, z0: 26, z1: 108, base: -3.6, step: 0.42, levels: 12, lift: 0.16 };
const T_TOP = T.base + T.levels * T.step;

const inTerraceRect = (x, z) => x > T.x0 - 3 && x < T.x1 + 3 && z > T.z0 - 3 && z < T.z1 + 3;

/* Deliberate landmarks register a circle here so the scatter passes that run
   afterwards do not drop a palm through somebody's roof. */
const claims = [];
const claim = (x, z, r) => { claims.push({ x, z, r }); };

/**
 * The union of every keep-out rule in the project plus our own claims.
 * One predicate on purpose: the moment it is copied per feature the copies
 * drift and something ends up standing in the pond.
 */
function openGround(x, z, opts = {}) {
  const { minH = WATER_LEVEL + 0.65, near = 0, pathClear = 5.5, wet = false } = opts;
  const d = Math.hypot(x, z);
  if (d < near || d > WORLD_SIZE / 2 - 18) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.18) return false;
  if (pathOffset(x, z) < pathClear && d < 72) return false;
  if (z < -62 && z > -112) return false;                       // railway corridor
  if (Math.hypot(x - 22, z - 26) < 9) return false;            // bale clearing
  if (Math.hypot(x - 55, z + 44) < 10) return false;           // five-tier meru
  if (Math.hypot(x + 34, z + 6) < 8) return false;             // three-tier meru
  if (Math.hypot(x - 9, z - 2.87) < 6) return false;           // candi bentar
  if (Math.hypot(x + 26, z - 20) < 8) return false;            // the great tree
  if (!wet && inTerraceRect(x, z) && heightAt(x, z) < T_TOP + 1.0) return false;
  if (heightAt(x, z) < minH) return false;
  for (const c of claims) if (Math.hypot(x - c.x, z - c.z) < c.r) return false;
  return true;
}

/* ─────────── materials ───────────
   One MeshStandardMaterial per surface kind, built once. Every one carries a
   colour map AND the normal map Sobelled out of that same canvas — a Standard
   material with no normal map looks no better than the Lambert it replaced,
   the surface response is the whole point of the swap. */



/**
 * Let pbr() take the normal map the texture library already tuned for this
 * surface. Passing one explicitly at a flat strength of 1 — which is what
 * every call site here was doing, since nothing ever supplied `bump` —
 * replaced maps built at 2.6 to 3.8 with something roughly three times
 * flatter. Ask for less relief with normalScale, not by re-Sobelling weakly.
 */
function surface(tex, o) {
  const m = pbr({ ...o, map: tex });
  m.envMapIntensity = ENV;
  m.userData.envFixed = true;
  return m;
}

/** Water wants the ripple normal and no colour map at all. */
function liquid(o) {
  const m = pbr({ ...o, normalMap: waterNormal() });
  m.envMapIntensity = ENV * 2.1;
  m.userData.envFixed = true;
  return m;
}

function buildMaterials() {
  const M = {};
  const soil = groundTexture();

  M.rock    = surface(rockTexture('#7c7568'),  { color: '#ffffff', roughness: 0.94, normalScale: 1.15, repeat: [3, 3] });
  M.rockWet = surface(rockTexture('#5a5b56'),  { color: '#ffffff', roughness: 0.58, normalScale: 1.3, repeat: [3, 3] });
  M.stone   = surface(rockTexture('#867e70'),  { color: '#ffffff', roughness: 0.9, normalScale: 1.0, repeat: [2, 2] });
  M.stoneD  = surface(rockTexture('#5f584e'),  { color: '#ffffff', roughness: 0.92, normalScale: 1.05, repeat: [2, 2] });
  M.brick   = surface(brickTexture('#8a4a36'), { color: '#ffffff', roughness: 0.88, normalScale: 1.25, repeat: [2, 1] });
  M.thatch  = surface(thatchTexture('#3a2c20'), { color: '#ffffff', roughness: 0.97, normalScale: 1.5, repeat: [4, 4] });
  M.wood    = surface(woodTexture('#6b4f38'),  { color: '#ffffff', roughness: 0.85, normalScale: 0.9, repeat: [1, 3] });
  M.woodPale = surface(woodTexture('#a98d5f'), { color: '#ffffff', roughness: 0.82, normalScale: 0.9, repeat: [1, 3] });
  M.mud     = surface(soil, { color: '#9c8063', roughness: 0.99, normalScale: 1.25, repeat: [7, 7] });
  M.mudBank = surface(soil, { color: '#8a7458', roughness: 0.99, normalScale: 1.35, repeat: [5, 2] });

  M.bambooDry = surface(barkTexture('#b9bd74'), { color: '#ffffff', roughness: 0.72, normalScale: 0.75, repeat: [1, 4] });
  M.bamboo  = surface(barkTexture('#b9bd74'), { color: '#ffffff', roughness: 0.7, normalScale: 0.75, repeat: [1, 6] });
  M.palmBark = surface(barkTexture('#8b7a5e'), { color: '#ffffff', roughness: 0.92, normalScale: 1.3, repeat: [1, 5] });
  M.plumBark = surface(barkTexture('#a8a08c'), { color: '#ffffff', roughness: 0.88, normalScale: 1.1, repeat: [1, 3] });
  M.coconut = surface(barkTexture('#6f5c42'), { color: '#ffffff', roughness: 0.9, normalScale: 1.0, repeat: [1, 1] });

  const leaf = { normalScale: 0.8, side: THREE.DoubleSide, repeat: [1, 1], color: '#ffffff' };
  M.frond      = surface(foliageTexture('#5d7c3e'), { ...leaf, roughness: 0.86 });
  M.bambooLeaf = surface(foliageTexture('#6f8b45'), { ...leaf, roughness: 0.84 });
  M.plumLeaf   = surface(foliageTexture('#40603a'), { ...leaf, roughness: 0.80 });
  M.rice       = surface(foliageTexture('#93a94f'), { ...leaf, roughness: 0.88, normalScale: 0.6 });
  M.offering   = surface(foliageTexture('#7f9a4a'), { ...leaf, roughness: 0.90, normalScale: 0.6 });

  const cloth = { normalScale: 0.75, side: THREE.DoubleSide, roughness: 0.95, color: '#ffffff' };
  M.poleng     = surface(batikTexture('#20201e', '#e9e3d4'), { ...cloth, repeat: [2, 2] });
  M.banner     = surface(batikTexture('#7a2b24', '#e0cc9a'), { ...cloth, repeat: [2, 3] });
  M.awning     = surface(batikTexture('#7a2b24', '#e0cc9a'), { ...cloth, repeat: [2, 2] });
  M.laundry    = surface(batikTexture('#2b4a5c', '#d9c9a4'), { ...cloth, repeat: [2, 2] });
  M.blossom    = surface(clothTexture('#fbf3dc'), { ...cloth, roughness: 0.78, normalScale: 0.5 });

  /* Brass. Kept only half metallic: env.js may or may not have run before we
     are built, and a fully metallic material with no environment is black. */
  M.gold = pbr({ color: '#c9992e', roughness: 0.38, metalness: 0.45 });
  M.gold.envMapIntensity = ENV * 1.6;

  /* Water. Roughness stays well clear of a mirror finish on purpose — the
     bloom threshold is 0.82, and a true specular pinpoint spread over 6000 m²
     of paddy would set the whole basin alight at sunset. The ripple normal
     does the reflecting instead, broken into a thousand small highlights. */
  M.paddy = liquid({ color: '#e9efee', roughness: 0.30, metalness: 0.0, normalScale: 0.42, vertexColors: true, repeat: [8, 8] });
  M.flow  = liquid({ color: '#cfe2e2', roughness: 0.24, metalness: 0.0, normalScale: 0.9, repeat: [1, 3] });
  M.fall  = liquid({ color: '#e8f3f3', roughness: 0.20, metalness: 0.0, normalScale: 1.1, repeat: [2, 5] });
  M.fall.transparent = true;
  M.fall.opacity = 0.84;

  M.mist = surface(clothTexture('#f2f7f7'), { color: '#ffffff', roughness: 1.0, side: THREE.DoubleSide, repeat: [2, 2] });
  M.mist.transparent = true;
  M.mist.opacity = 0.14;
  M.mist.depthWrite = false;

  M.lamp = pbr({ color: '#e8c489', roughness: 0.55 });
  M.lamp.emissive = new THREE.Color('#ffb765');
  M.lamp.emissiveIntensity = 0;
  M.lamp.envMapIntensity = ENV;

  return M;
}

/* ─────────── wind ───────────
   A shear injected into the standard vertex shader. Every swaying material is
   used ONLY on InstancedMeshes carrying `aSway` = (local wind x, local wind z,
   phase); resolving the world wind direction into instance space on the CPU is
   what lets randomly-yawed instances all lean the same way in the world. */

function addSway(mat, key, { h, amp, speed = 1.0, curve = 1.7, metric = 'abs(transformed.y)' }) {
  const patch = (shader) => {
    shader.uniforms.uSwayT = windU.t;
    shader.uniforms.uSwayW = windU.w;
    shader.vertexShader = `
      attribute vec3 aSway;
      uniform float uSwayT;
      uniform float uSwayW;
    ` + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      {
        float sk = pow(clamp(${metric} / ${h.toFixed(3)}, 0.0, 1.0), ${curve.toFixed(2)});
        float ph = aSway.z;
        float gust = sin(uSwayT * ${speed.toFixed(3)} + ph) * 0.72
                   + sin(uSwayT * ${(speed * 2.13).toFixed(3)} + ph * 1.71) * 0.28;
        transformed.xz += aSway.xy * (gust * sk * ${amp.toFixed(3)} * uSwayW);
      }
    `);
  };
  mat.onBeforeCompile = patch;

  /* The shadow pass runs three's own MeshDepthMaterial, which handles
     instanceMatrix but has never heard of aSway — so a twelve-metre bamboo
     culm would sway while its shadow stayed bolted upright. The depth
     material takes the identical patch at the identical injection point.
     Callers hand this to the mesh as `customDepthMaterial`. */
  mat.userData.swayDepth = () => {
    const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    d.onBeforeCompile = patch;
    d.customProgramCacheKey = () => 'healy-sway-depth-' + key;
    return d;
  };
  /* The default cache key is onBeforeCompile.toString(), which is identical
     for all of these — the numbers only differ after interpolation. Without a
     distinct key every swaying material would be handed the first program. */
  mat.customProgramCacheKey = () => 'healy-sway-' + key;
}

/* ─────────── geometry plumbing ─────────── */

const _o = new THREE.Object3D();

/** Position/rotate/scale a geometry in place. All of this runs once, at build. */
function xf(geo, px, py, pz, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _o.position.set(px, py, pz);
  _o.rotation.set(rx, ry, rz);
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}

const gBox = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const gCyl = (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const gCone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const gSph = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const gPlane = (w, h, ws = 1, hs = 1) => new THREE.PlaneGeometry(w, h, ws, hs);

/** Flatten to one attribute set so mergeGeometries will accept the pile. */
function mergeAll(parts) {
  if (!parts.length) return null;
  const flat = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    }
    if (!n.attributes.uv) {
      n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    }
    if (!n.attributes.normal) n.computeVertexNormals();
    return n;
  });
  const merged = mergeGeometries(flat, false);
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  parts.forEach((g) => g.dispose());
  return merged;
}

/**
 * Static geometry is collected per material and merged at the end, so a whole
 * village of two thousand boxes costs one draw call per surface kind rather
 * than one per box. `solid` splits the pile only into shadow-casting and not,
 * because every extra flag combination is another draw call.
 */
class Batch {
  constructor() { this.slots = new Map(); }

  add(geo, mat, solid = true) {
    const key = mat.uuid + (solid ? '/s' : '/l');
    let slot = this.slots.get(key);
    if (!slot) { slot = { mat, solid, parts: [] }; this.slots.set(key, slot); }
    slot.parts.push(geo);
    return geo;
  }

  flush(group) {
    for (const slot of this.slots.values()) {
      const geo = mergeAll(slot.parts);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, slot.mat);
      mesh.castShadow = slot.solid;
      mesh.receiveShadow = slot.solid;
      group.add(mesh);
    }
    this.slots.clear();
  }
}

/** Rows of instances, with the wind direction resolved into instance space. */
class Herd {
  constructor(geo, mat, sway = false) { this.geo = geo; this.mat = mat; this.sway = sway; this.rows = []; }

  put(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0, phase = 0) {
    _o.position.set(x, y, z);
    _o.rotation.set(rx, ry, rz);
    _o.scale.set(sx, sy, sz);
    _o.updateMatrix();
    this.rows.push({ m: _o.matrix.clone(), ry, phase: phase + x * 0.16 + z * 0.13 });
  }

  build(group, { cast = true, receive = false } = {}) {
    if (!this.rows.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.rows.length);
    im.castShadow = cast;
    im.receiveShadow = receive;
    const sway = this.sway ? new Float32Array(this.rows.length * 3) : null;
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i];
      im.setMatrixAt(i, r.m);
      if (!sway) continue;
      const c = Math.cos(r.ry), s = Math.sin(r.ry);
      sway[i * 3] = c * WIND_DIR.x - s * WIND_DIR.y;
      sway[i * 3 + 1] = s * WIND_DIR.x + c * WIND_DIR.y;
      sway[i * 3 + 2] = r.phase;
    }
    if (sway) this.geo.setAttribute('aSway', new THREE.InstancedBufferAttribute(sway, 3));
    /* A swaying caster needs a depth material that sways with it, or the
       shadow of a twelve-metre culm stays bolted upright while the culm
       leans. addSway leaves one ready on the material. */
    if (sway && cast && this.mat.userData && this.mat.userData.swayDepth) {
      im.customDepthMaterial = this.mat.userData.swayDepth();
    }
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
    return im;
  }
}

/** Raw triangle pusher. `hint` flips the winding so the face points that way. */
function tri(V, N, U, a, b, c, ua, ub, uc, hint) {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  const bx = c[0] - a[0], by = c[1] - a[1], bz = c[2] - a[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  let p = b, q = c, up = ub, uq = uc;
  if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
    p = c; q = b; up = uc; uq = ub;
    nx = -nx; ny = -ny; nz = -nz;
  }
  V.push(a[0], a[1], a[2], p[0], p[1], p[2], q[0], q[1], q[2]);
  N.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  U.push(ua[0], ua[1], up[0], up[1], uq[0], uq[1]);
}

function rawGeometry(V, N, U, C) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  if (C) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  g.computeBoundingSphere();
  return g;
}

/* ═══════════════ rice terraces ═══════════════

   The south-east basin is the emptiest ground in the world and, because
   grass.js culls every blade below h≈1.81, it is also the only large region
   with no grass to stand up through a water surface. That is what makes
   flooded paddies possible here and nowhere else on the map.

   A terrace is the set of ground whose height falls in one 0.42 m band. Its
   pan is flat at the TOP of that band plus a small lift, and the bund wall
   stands on the band's lower contour — which is exactly how a paddy is cut
   and filled. Contours come from clipping each grid cell against the two
   levels, so the edges follow the real land instead of stair-stepping along
   the sample grid, and neighbouring cells agree exactly on shared edges. */

/** Sutherland-Hodgman against one level, carrying the height per vertex. */
function clipLevel(poly, level, keepAbove) {
  const out = [];
  const cut = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = (a[2] - level) * (keepAbove ? 1 : -1);
    const db = (b[2] - level) * (keepAbove ? 1 : -1);
    const ain = da >= 0, bin = db >= 0;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = da / (da - db);
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, level];
      out.push(p);
      cut.push(p);
    }
  }
  return [out, cut];
}

function terraceOpen(x, z) {
  if (Math.hypot(x - 22, z - 26) < 9) return false;
  if (Math.hypot(x, z) > WORLD_SIZE / 2 - 18) return false;
  if (pathOffset(x, z) < 6 && Math.hypot(x, z) < 72) return false;
  return true;
}

/** Which terrace a point stands in, or -1 for dry land. */
function bandAt(x, z) {
  const h = heightAt(x, z);
  if (h >= T_TOP) return -1;
  return clamp(Math.floor((h - T.base) / T.step), 0, T.levels - 1);
}

const panY = (k) => T.base + (k + 1) * T.step + T.lift;

/** One bund segment: a crest ribbon plus the face dropping to the pan below. */
function bund(V, N, U, a, b, topY, lowY) {
  const ax = a[0], az = a[1], bx = b[0], bz = b[1];
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 1e-3) return;

  // the contour's own perpendicular, turned to face downhill
  let px = -dz / len, pz = dx / len;
  const e = 0.9;
  const gx = heightAt(ax + e, az) - heightAt(ax - e, az);
  const gz = heightAt(ax, az + e) - heightAt(ax, az - e);
  if (px * -gx + pz * -gz < 0) { px = -px; pz = -pz; }

  const W = 0.27;
  const crest = topY + 0.11;
  const foot = lowY - 0.4;
  const u1 = len * 0.4;

  const ai = [ax - px * W, crest, az - pz * W];
  const ao = [ax + px * W, crest, az + pz * W];
  const bi = [bx - px * W, crest, bz - pz * W];
  const bo = [bx + px * W, crest, bz + pz * W];
  const up = [0, 1, 0];
  tri(V, N, U, ai, ao, bo, [0, 0], [1, 0], [1, u1], up);
  tri(V, N, U, ai, bo, bi, [0, 0], [1, u1], [0, u1], up);

  const out = [px, 0, pz];
  const ad = [ao[0], foot, ao[2]];
  const bd = [bo[0], foot, bo[2]];
  tri(V, N, U, ao, bo, bd, [0, 1], [u1, 1], [u1, 0], out);
  tri(V, N, U, ao, bd, ad, [0, 1], [u1, 0], [0, 0], out);
}

/* Four blades of two segments each. There are thousands of these, so every
   triangle spent here costs about five thousand across the basin. */
function riceTuft() {
  const parts = [];
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * TAU + 0.4;
    const blade = gPlane(0.05, 1, 1, 2);
    blade.translate(0, 0.5, 0);
    const p = blade.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i);
      p.setZ(i, p.getZ(i) + t * t * 0.34);            // the leaf arcs over as it grows
      p.setX(i, p.getX(i) * (1 - t * 0.55));
    }
    blade.computeVertexNormals();
    parts.push(xf(blade, 0, 0, 0.02, a));
  }
  return mergeAll(parts);
}

function plantRice(rnd, herds, crop, lowEnd) {
  const want = lowEnd ? 1500 : 4200;
  const herd = herds.rice;
  let guard = 0;
  while (herd.rows.length < want && guard < want * 8) {
    guard++;
    const x = T.x0 + rnd() * (T.x1 - T.x0);
    const z = T.z0 + rnd() * (T.z1 - T.z0);
    if (!terraceOpen(x, z)) continue;
    const k = bandAt(x, z);
    if (k < 0 || crop[k] === 0) continue;
    const s = (crop[k] === 1 ? 0.5 : 0.85) + rnd() * 0.32;
    herd.put(x, panY(k) - 0.06, z, rnd() * TAU,
      s * (0.85 + rnd() * 0.3), s, s * (0.85 + rnd() * 0.3), 0, 0, rnd() * 4);
  }
}

/** A flight of slabs bridging the bunds, so the terraces read as walkable. */
function terraceStair(rnd, herds) {
  const herd = herds.slab;
  let x = 48, z = T.z0 + 1.5;
  let last = bandAt(x, z);
  for (let step = 0; step < 90; step++) {
    z += 0.9;
    x += Math.sin(step * 0.17) * 0.5;
    if (z > T.z1 - 2) break;
    const k = bandAt(x, z);
    if (k === last || k < 0) continue;
    const yTop = panY(Math.max(k, last));
    const yBot = panY(Math.min(k, last));
    for (let s = 0; s < 3; s++) {
      herd.put(x, yBot + (yTop - yBot) * (s / 2) + 0.04, z + (s - 1) * 0.42,
        rnd() * 0.5, 0.7 + rnd() * 0.25, 0.55, 0.5 + rnd() * 0.2);
    }
    last = k;
  }
}

/** The subak channel's last few metres: a split bamboo flume feeding the top pan. */
function subakSpout(group, batch, M) {
  const x = 44, z = T.z0 + 1.0;
  const k = bandAt(x, z);
  if (k < 0) return;
  const y = panY(k);
  const g = heightAt(x, z);

  for (const sx of [-0.5, 0.5]) {
    batch.add(xf(gCyl(0.06, 0.075, 1.6, 6), x + sx, g + 0.8, z - 0.6), M.bambooDry);
  }
  batch.add(xf(gCyl(0.13, 0.13, 3.4, 8, true), x, g + 1.55, z - 0.2, 0, 1, 1, 1, Math.PI / 2 - 0.16, 0), M.bambooDry);

  // the pour itself, scrolled with the rest of the moving water
  const drop = Math.max(0.3, g + 1.35 - y);
  const jet = new THREE.Mesh(xf(gPlane(0.26, drop, 1, 2), x, (g + 1.35 + y) * 0.5, z + 1.35), M.fall);
  jet.name = 'spout';
  group.add(jet);
  claim(x, z, 3);
}

function buildTerraces(rnd, group, batch, M, herds, lowEnd) {
  const cell = lowEnd ? 2.2 : 1.6;
  const NX = Math.round((T.x1 - T.x0) / cell);
  const NZ = Math.round((T.z1 - T.z0) / cell);

  const H = new Float32Array((NX + 1) * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    for (let i = 0; i <= NX; i++) H[j * (NX + 1) + i] = heightAt(T.x0 + i * cell, T.z0 + j * cell);
  }

  /* A working terrace is a patchwork: some pans lie flooded and empty waiting
     to be planted, some carry young rice, some are nearly ripe. */
  const crop = [];
  for (let k = 0; k < T.levels; k++) {
    const r = rnd();
    crop.push(r < 0.34 ? 0 : r < 0.66 ? 1 : 2);
  }
  const PAN_TINT = [
    new THREE.Color('#b9c8c6'),   // bare water, mirroring the sky
    new THREE.Color('#8fa585'),   // just transplanted
    new THREE.Color('#7d9862'),   // grown in
  ];

  const V = [], N = [], U = [], C = [];
  const wV = [], wN = [], wU = [];
  const tint = new THREE.Color();

  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x0 = T.x0 + i * cell, z0 = T.z0 + j * cell;
      const cx = x0 + cell * 0.5, cz = z0 + cell * 0.5;
      if (!terraceOpen(cx, cz)) continue;

      const h00 = H[j * (NX + 1) + i];
      const h10 = H[j * (NX + 1) + i + 1];
      const h11 = H[(j + 1) * (NX + 1) + i + 1];
      const h01 = H[(j + 1) * (NX + 1) + i];
      if (Math.min(h00, h10, h11, h01) >= T_TOP) continue;

      for (let k = 0; k < T.levels; k++) {
        const lo = k === 0 ? -1e4 : T.base + k * T.step;
        const hi = T.base + (k + 1) * T.step;

        let poly = [[x0, z0, h00], [x0 + cell, z0, h10], [x0 + cell, z0 + cell, h11], [x0, z0 + cell, h01]];
        let cut;
        [poly, cut] = clipLevel(poly, lo, true);
        if (poly.length < 3) continue;
        [poly] = clipLevel(poly, hi, false);
        if (poly.length < 3) continue;

        const y = panY(k);
        // a slow noise so no two pans read as the same flat wash of colour
        tint.copy(PAN_TINT[crop[k]]).multiplyScalar(0.9 + fbm(cx * 0.045, cz * 0.045, 2) * 0.16);

        for (let q = 1; q < poly.length - 1; q++) {
          const a = poly[0], b = poly[q], c = poly[q + 1];
          tri(V, N, U,
            [a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]],
            [a[0] * 0.09, a[1] * 0.09], [b[0] * 0.09, b[1] * 0.09], [c[0] * 0.09, c[1] * 0.09],
            [0, 1, 0]);
          for (let v = 0; v < 3; v++) C.push(tint.r, tint.g, tint.b);
        }

        if (k === 0) continue;              // the deepest pan has nothing below it
        for (let s = 0; s + 1 < cut.length; s += 2) bund(wV, wN, wU, cut[s], cut[s + 1], y, panY(k - 1));
      }
    }
  }

  const pans = new THREE.Mesh(rawGeometry(V, N, U, C), M.paddy);
  pans.receiveShadow = true;
  pans.name = 'paddies';
  group.add(pans);

  const bunds = new THREE.Mesh(rawGeometry(wV, wN, wU), M.mudBank);
  bunds.castShadow = true;
  bunds.receiveShadow = true;
  bunds.name = 'bunds';
  group.add(bunds);

  plantRice(rnd, herds, crop, lowEnd);
  terraceStair(rnd, herds);
  subakSpout(group, batch, M);
}

/* ═══════════════ the cascade ═══════════════

   The height field has no cliff anywhere — the steepest ground in the world
   is 0.117 — so the bluff is built, not found. The watercourse below it is a
   raised rock spine rather than a cut channel: grass grows everywhere above
   h≈1.81, and a stream sunk into the ground would have blades standing up
   through it, so the bed sits proud of the land and hides its own grass. */

const FALL = { x: 80.5, z: -31.5 };

function rockLump(rnd, r) {
  const g = new THREE.DodecahedronGeometry(r, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + (rnd() - 0.5) * 0.34;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function buildCascade(rnd, group, batch, M, herds) {
  const base = heightAt(FALL.x, FALL.z);
  const lipY = base + 8.0;
  claim(FALL.x, FALL.z, 10);

  /* The watercourse first, because its head decides where the plunge pool
     sits and therefore how far the water actually falls. */
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(FALL.x - 2.2, 0, FALL.z + 1.0),
    new THREE.Vector3(72, 0, -30.2),
    new THREE.Vector3(66.5, 0, -31.6),
    new THREE.Vector3(61, 0, -29.4),
    new THREE.Vector3(57, 0, -30.0),
    new THREE.Vector3(53.6, 0, -30.2),
  ]);

  const SEG = 46;
  const rings = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const pd = Math.hypot(p.x - POND.x, p.z - POND.z);
    const terr = heightAt(p.x, p.z);
    /* The bed has to stand clear of the tallest blade rooted underneath it,
       or the grass grows straight up through the stream. Inside the pond's
       own radius grass.js already refuses to grow anything, so the berm can
       sink back down to the land and let the water run out into the shallows. */
    const want = terr + 0.26 + 1.65 * smoothstep(16.0, 21.5, pd);
    rings.push({ p, nx: -tan.z, nz: tan.x, t, terr, want, surf: 0 });
  }
  /* Resolved from the mouth upstream, so the surface can only ever descend.
     Taking the terrain plus a clearance directly would have the water running
     uphill wherever the land dips under the berm. */
  rings[SEG].surf = rings[SEG].want;
  for (let i = SEG - 1; i >= 0; i--) rings[i].surf = Math.max(rings[i].want, rings[i + 1].surf + 0.035);
  const poolY = rings[0].surf;

  // the bluff: a heap of blocks with a notch bitten out of the front
  for (let i = 0; i < 30; i++) {
    const a = rnd() * TAU;
    const rr = 1.2 + rnd() * 4.4;
    const bx = FALL.x + Math.cos(a) * rr * 1.15 + 1.2;
    const bz = FALL.z + Math.sin(a) * rr;
    const swell = smoothstep(6.6, 0.6, Math.hypot(bx - FALL.x - 1.4, bz - FALL.z));
    const y = heightAt(bx, bz) + swell * (3.6 + rnd() * 5.4) - 1.0;
    const s = 1.0 + rnd() * 2.1;
    batch.add(xf(rockLump(rnd, s), bx, y, bz, rnd() * TAU, 1, 0.85 + rnd() * 0.5, 1,
      (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4), M.rock);
  }
  // the lip the water leaves from, kept square so the sheet has a clean edge
  batch.add(xf(gBox(2.9, 0.5, 1.5), FALL.x + 0.6, lipY - 0.2, FALL.z), M.rockWet);

  // the shelf the pool stands on, or it would hang in mid-air off the bluff
  const shelfBase = base - 1.4;
  batch.add(xf(gCyl(3.1, 3.9, poolY - 0.3 - shelfBase, 14), FALL.x + 0.2,
    (poolY - 0.3 + shelfBase) * 0.5, FALL.z - 1.0), M.rock);
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * TAU + 0.2;
    const s = 0.5 + rnd() * 0.7;
    batch.add(xf(rockLump(rnd, s), FALL.x + 0.2 + Math.cos(a) * 3.0, poolY - 0.18,
      FALL.z - 1.0 + Math.sin(a) * 3.0, rnd() * TAU, 1, 0.8, 1,
      (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5), M.rockWet);
  }

  const drop = lipY - poolY;
  const sheet = gPlane(2.2, drop, 3, 14);
  const sp = sheet.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    // clamped because the top row lands a rounding error below zero and
    // Math.pow of a negative base is NaN, which poisons the whole sheet
    const t = clamp(0.5 - sp.getY(i) / drop, 0, 1);           // 0 at the lip, 1 at the pool
    sp.setX(i, sp.getX(i) * (1 + t * 0.5));
    sp.setZ(i, sp.getZ(i) - Math.pow(t, 1.7) * 1.5);          // it falls away from the rock
  }
  sheet.computeVertexNormals();
  const curtain = new THREE.Mesh(xf(sheet, FALL.x + 0.55, (lipY + poolY) * 0.5, FALL.z - 0.65), M.fall);
  curtain.name = 'waterfall';
  group.add(curtain);

  /* Spray, as a few crossed sheets rather than a particle system. Built in
     LOCAL space and then placed: baking the world position into the vertices
     leaves the mesh origin back at (0,0,0), and the slow turn applied to it
     each frame then swings the whole thing on an 87-metre radius — the spray
     detaches from the fall and slides out across open meadow. */
  const mistParts = [];
  for (let i = 0; i < 5; i++) {
    mistParts.push(xf(gPlane(3.6 + i * 0.5, 2.6), 0, 0.9 + i * 0.24, 0, (i / 5) * Math.PI));
  }
  const mist = new THREE.Mesh(mergeAll(mistParts), M.mist);
  mist.position.set(FALL.x + 0.55, poolY, FALL.z - 1.5);
  mist.name = 'spray';
  group.add(mist);

  /* the berm: a rock spine carrying the channel, its skirt buried in the land
     and its top hollowed out either side of the water */
  const bV = [], bN = [], bU = [];
  const fV = [], fN = [], fU = [];
  const lipAt = (o) => o.surf + 0.24;
  const bedAt = (o) => o.surf - 0.26;
  const footAt = (o) => Math.min(o.terr, o.surf - 0.5) - 0.25;
  const S = (o, w, y) => [o.p.x + o.nx * w, y, o.p.z + o.nz * w];

  for (let i = 1; i <= SEG; i++) {
    const prev = rings[i - 1], ring = rings[i];
    const strip = (w0, y0, w1, y1, v0, v1) => {
      const a = S(prev, w0, y0(prev)), b = S(prev, w1, y1(prev));
      const c = S(ring, w1, y1(ring)), d = S(ring, w0, y0(ring));
      tri(bV, bN, bU, a, b, c, [v0, prev.t * 14], [v1, prev.t * 14], [v1, ring.t * 14], [0, 1, 0]);
      tri(bV, bN, bU, a, c, d, [v0, prev.t * 14], [v1, ring.t * 14], [v0, ring.t * 14], [0, 1, 0]);
    };
    for (const side of [-1, 1]) {
      strip(2.9 * side, footAt, 1.25 * side, lipAt, 0, 0.5);
      strip(1.25 * side, lipAt, 0.85 * side, bedAt, 0.5, 0.8);
    }
    strip(-0.85, bedAt, 0.85, bedAt, 0.8, 1.0);

    // the moving surface, a hand's width above the bed
    const W = (o) => [S(o, -0.8, o.surf), S(o, 0.8, o.surf)];
    const [pa, pb] = W(prev), [ra, rb] = W(ring);
    tri(fV, fN, fU, pa, pb, rb, [0, prev.t * 6], [1, prev.t * 6], [1, ring.t * 6], [0, 1, 0]);
    tri(fV, fN, fU, pa, rb, ra, [0, prev.t * 6], [1, ring.t * 6], [0, ring.t * 6], [0, 1, 0]);
  }
  for (let i = 0; i <= SEG; i += 4) claim(rings[i].p.x, rings[i].p.z, 3.4);

  // the plunge basin, fanned round the foot of the fall
  const pc = [FALL.x + 0.2, poolY, FALL.z - 1.0];
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * TAU, a1 = ((i + 1) / 16) * TAU;
    const R = 2.5;
    tri(fV, fN, fU, pc,
      [pc[0] + Math.cos(a0) * R, poolY, pc[2] + Math.sin(a0) * R],
      [pc[0] + Math.cos(a1) * R, poolY, pc[2] + Math.sin(a1) * R],
      [0.5, 0.5], [0.5 + Math.cos(a0) * 0.5, 0.5 + Math.sin(a0) * 0.5],
      [0.5 + Math.cos(a1) * 0.5, 0.5 + Math.sin(a1) * 0.5], [0, 1, 0]);
  }

  const berm = new THREE.Mesh(rawGeometry(bV, bN, bU), M.rockWet);
  berm.castShadow = true;
  berm.receiveShadow = true;
  berm.name = 'watercourse';
  group.add(berm);

  const flow = new THREE.Mesh(rawGeometry(fV, fN, fU), M.flow);
  flow.name = 'stream';
  group.add(flow);

  // boulders along the banks, and spilled round the foot of the bluff
  for (let i = 0; i < 52; i++) {
    const t = rnd();
    const p = curve.getPoint(t);
    const tan = curve.getTangent(t);
    const w = (2.4 + rnd() * 2.6) * (rnd() < 0.5 ? -1 : 1);
    const bx = p.x - tan.z * w, bz = p.z + tan.x * w;
    // no rocks out in open water; the shore itself is where they belong
    if (Math.hypot(bx - POND.x, bz - POND.z) < 15.5) continue;
    const s = 0.35 + rnd() * 0.8;
    herds.boulder.put(bx, heightAt(bx, bz) + s * 0.25, bz, rnd() * TAU,
      s * (0.9 + rnd() * 0.5), s, s * (0.9 + rnd() * 0.5), (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.5);
  }
  for (let i = 0; i < 20; i++) {
    const a = rnd() * TAU, rr = 4.0 + rnd() * 3.4;
    const bx = FALL.x + Math.cos(a) * rr, bz = FALL.z + Math.sin(a) * rr;
    const s = 0.3 + rnd() * 0.6;
    herds.boulder.put(bx, heightAt(bx, bz) + s * 0.2, bz, rnd() * TAU, s, s * 0.75, s,
      (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.6);
  }
}

/* ═══════════════ the village ═══════════════

   A Balinese house is a walled yard, not a building: a brick penyengker with
   one narrow gate, an aling-aling screen straight behind it so the street
   cannot see in, open pavilions round the edge, a rice barn on stilts and the
   family shrine in the corner nearest the mountain. Four of them sit either
   side of the footpath where it runs west, which turns that stretch of path
   into a lane instead of a line on the ground. */

function thatchRoof(w, d, h, tiers = 1) {
  const parts = [];
  let ww = w, dd = d, hh = h, y = 0;
  for (let i = 0; i < tiers; i++) {
    const cone = gCone(ww * 0.5, hh, 4);
    cone.rotateY(Math.PI / 4);
    cone.scale(1, 1, dd / ww);
    parts.push(xf(cone, 0, y + hh * 0.5, 0));
    y += hh * 0.72;
    ww *= 0.56; dd *= 0.56; hh *= 0.72;
  }
  return mergeAll(parts);
}

function compound(rnd, batch, herds, M, cx, cz, yaw, span) {
  const pad = heightAt(cx, cz);
  const B = new THREE.Matrix4().compose(
    new THREE.Vector3(cx, pad, cz),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1));
  const emit = (geo, mat, solid = true) => batch.add(geo.applyMatrix4(B), mat, solid);
  const toWorld = (px, pz) => new THREE.Vector3(px, 0, pz).applyMatrix4(B);

  const HW = span * 0.5, HD = span * 0.42;
  claim(cx, cz, span * 0.78);

  // the yard, raised a hand above the land so the ground never cuts through
  emit(xf(gBox(span + 0.8, 0.34, span * 0.84 + 0.8), 0, 0.05, 0), M.mud);

  const WALL_H = 1.65, WALL_T = 0.3, GATE = 1.5;
  const run = (x, z, w, d) => {
    emit(xf(gBox(w, WALL_H, d), x, 0.22 + WALL_H * 0.5, z), M.brick);
    emit(xf(gBox(w + 0.12, 0.13, d + 0.12), x, 0.22 + WALL_H + 0.06, z), M.stoneD);
  };
  run(0, HD, span, WALL_T);
  run(-HW, 0, WALL_T, HD * 2);
  run(HW, 0, WALL_T, HD * 2);
  const sideRun = (span - GATE * 2) * 0.5;
  run(-(GATE + sideRun * 0.5), -HD, sideRun, WALL_T);
  run(+(GATE + sideRun * 0.5), -HD, sideRun, WALL_T);

  // angkul-angkul: two tiered piers, a lintel and a little roof
  for (const s of [-1, 1]) {
    let y = 0.22;
    for (const [w, h, mat] of [[0.86, 0.4, M.stoneD], [0.74, 0.5, M.brick], [0.62, 0.42, M.brick], [0.5, 0.34, M.stone]]) {
      emit(xf(gBox(w, h, w * 0.82), s * (GATE + 0.42), y + h * 0.5, -HD), mat);
      y += h + 0.05;
    }
    emit(xf(gSph(0.13, 8, 6), s * (GATE + 0.42), y + 0.12, -HD), M.stone);
  }
  emit(xf(gBox(GATE * 2 + 1.9, 0.26, 0.62), 0, 2.05, -HD), M.wood);
  emit(xf(thatchRoof(GATE * 2 + 2.4, 1.3, 0.7), 0, 2.2, -HD), M.thatch);
  // the aling-aling, the screen wall you have to walk around
  emit(xf(gBox(2.5, 1.7, 0.26), 0, 1.07, -HD + 1.9), M.brick);
  emit(xf(gBox(2.7, 0.12, 0.4), 0, 1.98, -HD + 1.9), M.stoneD);
  for (let i = 0; i < 3; i++) {
    emit(xf(gBox(GATE * 2 + 0.4, 0.14, 1.5 - i * 0.4), 0, 0.07 + i * 0.13, -HD - 0.9 - i * 0.35), M.stoneD);
  }
  // the lantern hung under the gate roof
  emit(xf(gSph(0.15, 10, 8), 0, 1.86, -HD + 0.1, 0, 1, 1.3, 1), M.lamp, false);

  /* bale: an open pavilion on a plinth */
  const bale = (bx, bz, bw, bd) => {
    emit(xf(gBox(bw + 0.5, 0.42, bd + 0.5), bx, 0.43, bz), M.stone);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      emit(xf(gCyl(0.085, 0.1, 1.85, 8), bx + sx * bw * 0.42, 1.57, bz + sz * bd * 0.42), M.wood);
    }
    emit(xf(gBox(bw + 0.4, 0.12, bd + 0.4), bx, 2.55, bz), M.wood);
    emit(xf(thatchRoof(bw + 1.5, bd + 1.3, 1.0, 2), bx, 2.6, bz), M.thatch);
  };
  bale(-HW + 2.2, 1.4, 2.6, 2.2);
  if (span > 12.5) bale(HW - 2.4, -1.2, 2.2, 2.0);

  /* lumbung: the rice barn. A fat curved roof on four stilts with the rat-guard
     discs — the one silhouette that says "village" entirely on its own. */
  const lx = HW - 2.6, lz = HD - 2.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    emit(xf(gCyl(0.09, 0.11, 1.5, 8), lx + sx * 0.72, 0.95, lz + sz * 0.6), M.wood);
    emit(xf(gCyl(0.28, 0.28, 0.08, 10), lx + sx * 0.72, 1.72, lz + sz * 0.6), M.stone);
  }
  emit(xf(gBox(2.1, 1.15, 1.7), lx, 2.4, lz), M.woodPale);
  const barn = gCone(2.05, 1.9, 4);
  barn.rotateY(Math.PI / 4);
  barn.scale(1, 1, 0.86);
  emit(xf(barn, lx, 3.9, lz), M.thatch);

  /* sanggah: the family shrine, three little seats on a brick plinth */
  const sx0 = -HW + 1.6, sz0 = HD - 1.8;
  emit(xf(gBox(3.4, 0.6, 1.8), sx0 + 0.8, 0.5, sz0), M.brick);
  for (let i = 0; i < 3; i++) {
    const px = sx0 + i * 0.95;
    emit(xf(gCyl(0.11, 0.13, 1.25, 6), px, 1.42, sz0), M.wood);
    emit(xf(gBox(0.62, 0.2, 0.62), px, 2.13, sz0), M.stone);
    emit(xf(thatchRoof(0.95, 0.95, 0.5), px, 2.22, sz0), M.thatch);
    const w = toWorld(px + 0.1, sz0 - 0.9);
    herds.canang.put(w.x, pad + 0.24, w.z, rnd() * TAU);
  }
  emit(xf(gCyl(0.15, 0.15, 0.5, 8, true), sx0 + 0.95, 1.3, sz0), M.poleng, false);

  /* laundry on a bamboo rack — the thing that makes a yard look inhabited */
  const rx = 0.4, rz = -1.8;
  for (const s of [-1, 1]) emit(xf(gCyl(0.05, 0.06, 1.9, 6), rx + s * 1.8, 1.15, rz), M.bambooDry);
  emit(xf(gCyl(0.035, 0.035, 3.7, 6), rx, 2.05, rz, 0, 1, 1, 1, 0, Math.PI / 2), M.bambooDry);
  for (let i = 0; i < 4; i++) {
    const w = toWorld(rx - 1.3 + i * 0.87, rz);
    herds.laundry.put(w.x, pad + 2.0, w.z, yaw + (rnd() - 0.5) * 0.3,
      0.55 + rnd() * 0.35, 0.75 + rnd() * 0.4, 1, 0, 0, rnd() * 5);
  }

  // water jars against the wall
  for (let i = 0; i < 3; i++) {
    const pot = new THREE.LatheGeometry([
      new THREE.Vector2(0.01, 0), new THREE.Vector2(0.17, 0.06), new THREE.Vector2(0.24, 0.26),
      new THREE.Vector2(0.16, 0.44), new THREE.Vector2(0.19, 0.5),
    ], 10);
    emit(xf(pot, -HW + 0.9 + i * 0.7, 0.22, -HD + 2.9 + rnd() * 0.6, rnd() * TAU), M.brick);
  }
}

function marketStall(rnd, batch, herds, M, x, z, yaw) {
  const g = heightAt(x, z);
  const B = new THREE.Matrix4().compose(
    new THREE.Vector3(x, g, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1));
  const emit = (geo, mat, solid = true) => batch.add(geo.applyMatrix4(B), mat, solid);
  claim(x, z, 2.4);

  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    emit(xf(gCyl(0.045, 0.055, 2.1, 6), sx * 1.05, 1.05, sz * 0.7), M.bambooDry);
  }
  emit(xf(gBox(2.3, 0.09, 1.55), 0, 0.86, 0), M.woodPale);
  emit(xf(gBox(2.5, 0.06, 1.75), 0, 2.12, 0, 0, 1, 1, 1, 0.09, 0), M.awning, false);

  // produce heaped in flat baskets
  for (let i = 0; i < 7; i++) {
    const bx = -0.85 + rnd() * 1.7, bz = -0.45 + rnd() * 0.9;
    emit(xf(gCyl(0.22, 0.16, 0.1, 8), bx, 0.95, bz), M.woodPale);
    emit(xf(gSph(0.17, 6, 4), bx, 1.03, bz, 0, 1, 0.55 + rnd() * 0.3, 1), M.offering);
  }
  const w = new THREE.Vector3(0, 0, -1.0).applyMatrix4(B);
  herds.laundry.put(w.x, g + 2.05, w.z, yaw, 0.9, 0.45, 1, 0, 0, rnd() * 6);
}

function buildVillage(rnd, batch, herds, M, lights) {
  /* Four yards, offset either side of the lane so the walking line stays open.
     Ground here runs 5.3-7.0 m and is as flat as this world gets. */
  const yards = [
    [-38.5, -15.5, 0.30, 13.5],
    [-45.5, -34.5, 2.86, 14.5],
    [-55.0, -16.0, 0.46, 12.0],
    [-58.0, -35.0, 2.70, 12.5],
  ];
  for (const [x, z, yaw, span] of yards) compound(rnd, batch, herds, M, x, z, yaw, span);

  // the market strung along the lane itself
  for (let i = 0; i < 6; i++) {
    const lx = -37 - i * 4.6;
    const side = i % 2 === 0 ? 1 : -1;
    const [dx, dz] = pathDir(lx);
    // the counter turns square to the lane, not square to the world
    marketStall(rnd, batch, herds, M, lx, pathZ(lx) + side * 4.3, yawTo(dz * side, -dx * side));
  }

  // two lantern posts, the only point lights this module adds
  for (const [lx, dz] of [[-42, 2.8], [-53, -3.0]]) {
    const lz = pathZ(lx) + dz;
    const g = heightAt(lx, lz);
    batch.add(xf(gCyl(0.055, 0.08, 2.9, 6), lx, g + 1.45, lz), M.wood);
    batch.add(xf(gSph(0.19, 10, 8), lx, g + 2.82, lz, 0, 1, 1.35, 1), M.lamp, false);
    const pl = new THREE.PointLight(0xffa860, 0, 13, 2);
    pl.position.set(lx, g + 2.85, lz);
    lights.push(pl);
    claim(lx, lz, 1.4);
  }
}

/* ═══════════════ planting ═══════════════ */

function bambooCulm(H) {
  const geo = new THREE.CylinderGeometry(0.05, 0.085, H, 6, 11, true);
  geo.translate(0, H * 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / H;
    const k = 1 + Math.sin(t * TAU * 7) * 0.06;              // pinched at the nodes
    // and it leans out under its own weight once tall enough to feel it
    p.setXYZ(i, p.getX(i) * k + t * t * 1.15, y, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function bambooSpray() {
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.3;
    const leaf = gPlane(0.09, 0.85, 1, 2);
    leaf.translate(0, 0.42, 0);
    parts.push(xf(leaf, Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16, a, 1, 1, 1, -0.5 - (i % 3) * 0.22, 0));
  }
  return mergeAll(parts);
}

const CULM_H = 12.5;

function buildBamboo(rnd, herds, lowEnd) {
  /* Clumps ring the paddies rather than standing in them — the terrace guard
     inside openGround is what keeps them out of the water. */
  const anchors = [
    [70, -44], [74.5, -18], [-64, -34], [-32, -44], [-20, -32], [30, -6],
    [-4, 32], [-10, 24], [90, 40], [92, 74], [-14, 46], [-70, 6], [88, 60], [-48, 14],
  ];
  const perClump = lowEnd ? 9 : 17;
  for (const [ax, az] of anchors) {
    if (!openGround(ax, az, { minH: WATER_LEVEL - 0.3, pathClear: 5 })) continue;
    claim(ax, az, 5.5);
    for (let i = 0; i < perClump; i++) {
      const a = rnd() * TAU;
      const r = Math.sqrt(rnd()) * 2.6;
      const x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
      const s = 0.72 + rnd() * 0.55;
      const sy = s * (0.85 + rnd() * 0.4);
      const yaw = rnd() * TAU;
      const foot = heightAt(x, z) - 0.12;
      herds.culm.put(x, foot, z, yaw, s, sy, s, (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.14, rnd() * 5);
      // sprays hung near the top, in the culm's own leaning frame
      for (let k = 0; k < 3; k++) {
        const t = 0.62 + k * 0.15;
        const lean = t * t * 1.15 * s;
        herds.bambooLeaf.put(
          x + Math.cos(yaw) * lean + (rnd() - 0.5) * 0.5,
          foot + CULM_H * sy * t,
          z - Math.sin(yaw) * lean + (rnd() - 0.5) * 0.5,
          rnd() * TAU, 1.1 + rnd() * 0.6, 1, 1, 0, 0, rnd() * 6);
      }
    }
  }
}

const PALM_H = 11.5;
const PALM_LEAN = Math.sin(1.35) * 1.5;

function palmTrunk(H) {
  const geo = new THREE.CylinderGeometry(0.15, 0.31, H, 7, 13, true);
  geo.translate(0, H * 0.5, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / H;
    const k = 1 + Math.sin(t * TAU * 12) * 0.055;            // old frond scars
    p.setXYZ(i, p.getX(i) * k + Math.sin(t * 1.35) * 1.5 * t, y, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const FROND_L = 3.7;

function palmFrond() {
  const parts = [];
  const N = 13;
  const py = (t) => FROND_L * (0.40 * t - 0.66 * t * t);

  /* The rachis is one bent ribbon, not a chain of boxes — a box per station
     costs 168 triangles a frond and there are four hundred fronds. */
  const rachis = gPlane(0.07, FROND_L, 1, N);
  rachis.rotateX(-Math.PI / 2);
  rachis.translate(0, 0, FROND_L * 0.5);
  const rp = rachis.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const t = clamp(rp.getZ(i) / FROND_L, 0, 1);
    rp.setY(i, py(t));
    rp.setX(i, rp.getX(i) * (1 - t * 0.6));
  }
  rachis.computeVertexNormals();
  parts.push(rachis);

  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const z = FROND_L * t, y = py(t);
    const l = 0.34 * FROND_L * Math.pow(Math.sin(t * Math.PI), 0.55);
    for (const s of [-1, 1]) {
      const leaflet = gPlane(l, 0.075);
      leaflet.translate(s * l * 0.5, 0, 0);
      const lp = leaflet.attributes.position;
      for (let v = 0; v < lp.count; v++) {
        const u = Math.abs(lp.getX(v)) / l;
        lp.setY(v, lp.getY(v) - u * u * l * 0.55);            // the leaflet droops
      }
      leaflet.computeVertexNormals();
      parts.push(xf(leaflet, 0, y, z, 0, 1, 1, 1, Math.PI / 2, s * 0.28));
    }
  }
  return mergeAll(parts);
}

function buildPalms(rnd, herds, lowEnd) {
  const want = lowEnd ? 26 : 52;
  let placed = 0, guard = 0;
  while (placed < want && guard < want * 60) {
    guard++;
    /* sqrt weighting still throws some out toward the tree ring, so the
       middle distance gains mass without becoming a wall of trunks. */
    const a = rnd() * TAU;
    const r = 20 + Math.sqrt(rnd()) * 96;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!openGround(x, z, { minH: WATER_LEVEL + 0.6, near: 18, pathClear: 6.5 })) continue;
    if (fbm(x * 0.026, z * 0.026, 2) < -0.08) continue;       // they grow in company
    claim(x, z, 4.2);

    const s = 0.8 + rnd() * 0.55;
    const sy = s * (0.9 + rnd() * 0.35);
    const yaw = rnd() * TAU;
    const foot = heightAt(x, z) - 0.2;
    herds.palm.put(x, foot, z, yaw, s, sy, s, 0, 0, rnd() * 5);

    const lean = PALM_LEAN * s;
    const cx = x + Math.cos(yaw) * lean, cz = z - Math.sin(yaw) * lean;
    const crown = foot + PALM_H * sy;
    const n = 7 + ((rnd() * 3) | 0);
    for (let f = 0; f < n; f++) {
      herds.frond.put(cx, crown - 0.15, cz, (f / n) * TAU + rnd() * 0.2,
        s * (0.9 + rnd() * 0.25), s, s, -0.42 - rnd() * 0.4, 0, rnd() * 6);
    }
    for (let c = 0; c < 3; c++) {
      const ca = rnd() * TAU;
      herds.coconut.put(cx + Math.cos(ca) * 0.32, crown - 0.42, cz + Math.sin(ca) * 0.32,
        rnd() * TAU, 0.13 + rnd() * 0.04);
    }
    placed++;
  }
}

function plumeriaLimb(rnd) {
  const parts = [];
  const walk = (x, y, z, dir, r, depth) => {
    const len = 0.75 + rnd() * 0.5;
    const nx = x + dir.x * len, ny = y + dir.y * len, nz = z + dir.z * len;
    const seg = gCyl(r * 0.72, r, len, 6);
    seg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    seg.translate((x + nx) / 2, (y + ny) / 2, (z + nz) / 2);
    parts.push(seg);
    if (depth === 0) return;
    for (const s of [-1, 1]) {
      const b = rnd() * TAU;
      const v = dir.clone()
        .applyAxisAngle(new THREE.Vector3(Math.cos(b), 0, Math.sin(b)), s * (0.5 + rnd() * 0.4));
      v.y = v.y * 0.9 + 0.18;
      walk(nx, ny, nz, v.normalize(), r * 0.72, depth - 1);
    }
  };
  walk(0, 0, 0, new THREE.Vector3(0, 1, 0), 0.17, 2);
  return mergeAll(parts);
}

function plumeriaLeaves() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU;
    const leaf = gPlane(0.16, 0.62, 1, 2);
    leaf.translate(0, 0.3, 0);
    parts.push(xf(leaf, Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09, a, 1, 1, 1, -0.75 - (i % 3) * 0.2, 0));
  }
  return mergeAll(parts);
}

function plumeriaFlower() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    const petal = gPlane(0.075, 0.13);
    petal.translate(0, 0.06, 0);
    parts.push(xf(petal, Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04, a, 1, 1, 1, -1.35, 0.35));
  }
  return mergeAll(parts);
}

/**
 * Frangipani belong AT the temples, so they cannot go through openGround —
 * every spot worth planting is inside its own landmark's keep-out circle.
 * They get the terrain rules and a clear radius per spot instead.
 */
function templeGround(x, z) {
  const d = Math.hypot(x, z);
  if (d > WORLD_SIZE / 2 - 18) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.06) return false;
  if (z < -62 && z > -112) return false;
  if (pathOffset(x, z) < 3.0 && d < 72) return false;
  if (inTerraceRect(x, z) && heightAt(x, z) < T_TOP + 0.6) return false;
  return heightAt(x, z) > WATER_LEVEL + 0.4;
}

function buildFrangipani(rnd, herds, spots, lowEnd) {
  const per = lowEnd ? 4 : 7;
  const planted = [];
  for (const [ax, az, clear] of spots) {
    for (let i = 0; i < 3; i++) {
      let x = 0, z = 0, ok = false;
      for (let attempt = 0; attempt < 26 && !ok; attempt++) {
        const a = rnd() * TAU, r = clear + rnd() * 3.5;
        x = ax + Math.cos(a) * r; z = az + Math.sin(a) * r;
        ok = templeGround(x, z) && planted.every((q) => Math.hypot(x - q[0], z - q[1]) > 3.4);
      }
      if (!ok) continue;
      planted.push([x, z]);
      claim(x, z, 2.6);
      const s = 0.85 + rnd() * 0.6;
      const foot = heightAt(x, z) - 0.1;
      herds.plumeria.put(x, foot, z, rnd() * TAU, s);
      for (let k = 0; k < per; k++) {
        const ka = rnd() * TAU, kr = (0.7 + rnd() * 1.5) * s;
        const kx = x + Math.cos(ka) * kr, kz = z + Math.sin(ka) * kr;
        const ky = foot + (2.1 + rnd() * 1.5) * s;
        herds.plumLeaf.put(kx, ky, kz, rnd() * TAU, 0.9 + rnd() * 0.5, 1, 1, 0, 0, rnd() * 6);
        if (rnd() < 0.8) {
          herds.blossom.put(kx + (rnd() - 0.5) * 0.5, ky + 0.2, kz + (rnd() - 0.5) * 0.5,
            rnd() * TAU, 0.9 + rnd() * 0.5, 1, 1, (rnd() - 0.5) * 0.6, 0, rnd() * 6);
        }
      }
    }
  }
}

/* ═══════════════ statues, shrines, offerings ═══════════════ */

/** A dwarapala: squat, furious, and almost entirely silhouette. */
function dwarapala(batch, M, x, z, facing) {
  const B = new THREE.Matrix4().compose(
    new THREE.Vector3(x, heightAt(x, z), z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing),
    new THREE.Vector3(1, 1, 1));
  const emit = (geo, mat, solid = true) => batch.add(geo.applyMatrix4(B), mat, solid);
  claim(x, z, 1.6);

  emit(xf(gBox(1.5, 0.32, 1.5), 0, 0.06, 0), M.stoneD);
  emit(xf(gBox(1.24, 0.5, 1.24), 0, 0.47, 0), M.stone);
  emit(xf(gBox(1.05, 0.16, 1.05), 0, 0.8, 0), M.stoneD);

  // a heavy crouching body, far wider at the shoulders than the hips
  const torso = new THREE.LatheGeometry([
    new THREE.Vector2(0.01, 0), new THREE.Vector2(0.4, 0.05), new THREE.Vector2(0.44, 0.4),
    new THREE.Vector2(0.5, 0.85), new THREE.Vector2(0.42, 1.05), new THREE.Vector2(0.24, 1.15),
    new THREE.Vector2(0.01, 1.18),
  ], 12);
  emit(xf(torso, 0, 0.88, 0, 0, 1, 1, 0.8), M.stone);

  // knees drawn up, arms folded round a club
  for (const s of [-1, 1]) {
    emit(xf(gSph(0.23, 8, 6), s * 0.34, 1.06, 0.24, 0, 1, 0.85, 1.1), M.stone);
    emit(xf(gCyl(0.11, 0.13, 0.62, 7), s * 0.46, 1.42, 0.16, 0, 1, 1, 1, 0.5, s * 0.35), M.stone);
  }
  emit(xf(gCyl(0.075, 0.11, 0.95, 7), 0, 1.62, 0.3, 0, 1, 1, 1, 0.32, 0), M.stone);
  emit(xf(gSph(0.15, 8, 6), 0, 2.05, 0.44), M.stone);

  // head: broad jaw, bulging eyes, tusks, a crown
  emit(xf(gSph(0.29, 10, 8), 0, 2.18, 0.02, 0, 1.05, 0.95, 0.92), M.stone);
  for (const s of [-1, 1]) {
    emit(xf(gSph(0.085, 7, 6), s * 0.12, 2.24, 0.25), M.stoneD);
    emit(xf(gCone(0.05, 0.16, 6), s * 0.11, 2.02, 0.22, 0, 1, 1, 1, Math.PI, 0), M.stone);
    emit(xf(gSph(0.1, 7, 6), s * 0.29, 2.16, -0.02, 0, 0.6, 1.1, 0.8), M.stone);
  }
  emit(xf(gCone(0.26, 0.34, 8), 0, 2.55, 0), M.stone);
  emit(xf(gSph(0.07, 7, 6), 0, 2.76, 0), M.gold);
  // the checked cloth every guardian wears
  emit(xf(gCyl(0.46, 0.5, 0.42, 12, true), 0, 1.02, 0), M.poleng, false);
}

function shrinePost(rnd, batch, herds, M, x, z, yaw, scale = 1) {
  const g = heightAt(x, z);
  const B = new THREE.Matrix4().compose(
    new THREE.Vector3(x, g, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(scale, scale, scale));
  const emit = (geo, mat, solid = true) => batch.add(geo.applyMatrix4(B), mat, solid);
  claim(x, z, 2.2 * scale);

  emit(xf(gBox(1.15, 0.28, 1.15), 0, 0.05, 0), M.stoneD);
  emit(xf(gBox(0.95, 0.45, 0.95), 0, 0.42, 0), M.brick);
  emit(xf(gBox(1.05, 0.1, 1.05), 0, 0.69, 0), M.stone);
  emit(xf(gCyl(0.14, 0.17, 1.5, 8), 0, 1.5, 0), M.wood);
  emit(xf(gCyl(0.2, 0.2, 0.55, 10, true), 0, 1.35, 0), M.poleng, false);
  emit(xf(gBox(0.78, 0.24, 0.78), 0, 2.36, 0), M.stone);
  emit(xf(thatchRoof(1.35, 1.35, 0.62, 2), 0, 2.46, 0), M.thatch);
  emit(xf(gSph(0.08, 8, 6), 0, 3.35, 0), M.gold);

  for (let i = 0; i < 3; i++) {
    const a = rnd() * TAU, r = (0.75 + rnd() * 0.5) * scale;
    const ox = x + Math.cos(a) * r, oz = z + Math.sin(a) * r;
    herds.canang.put(ox, heightAt(ox, oz) + 0.03, oz, rnd() * TAU, 0.9 + rnd() * 0.3);
  }
}

function canangGeo() {
  const parts = [];
  parts.push(xf(gBox(0.3, 0.045, 0.3), 0, 0.022, 0));
  for (const s of [-1, 1]) {
    parts.push(xf(gBox(0.32, 0.07, 0.03), 0, 0.055, s * 0.15));
    parts.push(xf(gBox(0.03, 0.07, 0.32), s * 0.15, 0.055, 0));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.6;
    parts.push(xf(gSph(0.062, 5, 3), Math.cos(a) * 0.075, 0.07, Math.sin(a) * 0.075, 0, 1, 0.5, 1));
  }
  parts.push(xf(gCone(0.02, 0.16, 5), 0, 0.13, 0));
  return mergeAll(parts);
}

const BANNER_H = 3.4;

function bannerCloth() {
  const geo = gPlane(0.55, BANNER_H, 2, 8);
  geo.translate(0, -BANNER_H * 0.5, 0);         // hangs from the origin downward
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = -p.getY(i) / BANNER_H;
    p.setZ(i, p.getZ(i) + Math.sin(t * 6.0) * 0.09 * t);      // a standing ripple in the cloth
  }
  geo.computeVertexNormals();
  return geo;
}

function buildShrinesAndGates(rnd, batch, herds, M) {
  /* Guardians on the approach to the candi bentar. The footpath keep-out does
     not apply to them — flanking the path is the entire job. */
  const gx = 9, gz = pathZ(9);
  const [dx, dz] = pathDir(gx);
  for (const s of [-1, 1]) {
    // set back from the gate, one either side, both staring back down the path
    dwarapala(batch, M,
      gx - dx * 4.0 - dz * 2.6 * s, gz - dz * 4.0 + dx * 2.6 * s,
      yawTo(-dx, -dz));
  }
  for (let i = 0; i < 5; i++) {
    const t = (rnd() - 0.5) * 3.0;
    const ox = gx - dx * 2.2 - dz * t, oz = gz - dz * 2.2 + dx * t;
    herds.canang.put(ox, heightAt(ox, oz) + 0.06, oz, rnd() * TAU);
  }

  /* Roadside shrines, plus the one overlooking the terraces where the subak's
     water enters the top pan. */
  const posts = [
    [50, 22, 3.5, 1.15],
    [-30.5, pathZ(-30.5) + 6.2, 1.2, 1.0],
    [21, pathZ(21) - 6.4, 4.3, 0.9],
    [-70, pathZ(-70) + 7.0, 1.6, 0.95],
    [43, -12, 2.1, 1.0],
    [-16, 36, 0.6, 0.9],
  ];
  for (const [x, z, yaw, s] of posts) shrinePost(rnd, batch, herds, M, x, z, yaw, s);

  /* umbul-umbul: tall bamboo banners lining the path either side of the gate */
  for (let i = 0; i < 9; i++) {
    const px = -18 + i * 6.5;
    const side = i % 2 === 0 ? 1 : -1;
    const pz = pathZ(px) + side * 3.4;
    if (Math.hypot(px - gx, pz - gz) < 3.2) continue;
    const g = heightAt(px, pz);
    const [dx2, dz2] = pathDir(px);
    batch.add(xf(gCyl(0.035, 0.06, 5.4, 6), px, g + 2.7, pz, 0, 1, 1, 1, side * 0.06, 0), M.bambooDry);
    herds.banner.put(px + 0.24 * side, g + 5.2, pz,
      yawTo(dz2 * side, -dx2 * side), 1, 1, 1, 0, 0, rnd() * 6);
  }
}

/* ═══════════════ jukung on the shore ═══════════════ */

function jukungHull() {
  const parts = [];
  const L = 4.6, N = 11;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const taper = Math.pow(Math.sin(Math.PI * (0.08 + t * 0.84)), 0.6);
    const w = 0.42 * taper, h = 0.4 * taper;
    const rise = Math.pow(Math.abs(t - 0.5) * 2, 3) * 0.55;   // both ends sweep up
    parts.push(xf(gBox(w, h, L / N * 1.15), 0, rise + h * 0.5, -L * 0.5 + t * L));
  }
  for (const s of [-1, 1]) {
    parts.push(xf(gCone(0.07, 0.75, 6), 0, 0.78, s * L * 0.52, 0, 1, 1, 1, s * 0.5, 0));
  }
  return mergeAll(parts);
}

function buildBoats(rnd, batch, herds, M) {
  for (const [deg, r] of [[176, 17.8], [206, 18.4]]) {
    const a = deg * Math.PI / 180;
    const x = POND.x + Math.cos(a) * r, z = POND.z + Math.sin(a) * r;
    const g = heightAt(x, z);
    const n = normalAt(x, z, 1.4);
    const yaw = Math.atan2(POND.x - x, POND.z - z) + (rnd() - 0.5) * 0.4;
    const B = new THREE.Matrix4().compose(
      new THREE.Vector3(x, g + 0.06, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(-n.z * 0.5, yaw, n.x * 0.5)),
      new THREE.Vector3(1, 1, 1));
    const emit = (geo, mat, solid = true) => batch.add(geo.applyMatrix4(B), mat, solid);
    claim(x, z, 3.4);

    emit(jukungHull(), M.woodPale);
    emit(xf(gBox(0.5, 0.06, 3.6), 0, 0.46, 0), M.wood);
    // two cross booms carrying a bamboo float either side
    for (const cz of [-1.35, 1.35]) {
      emit(xf(gCyl(0.045, 0.045, 3.6, 6), 0, 0.66, cz, 0, 1, 1, 1, 0, Math.PI / 2), M.bambooDry);
    }
    for (const s of [-1, 1]) {
      emit(xf(gCyl(0.06, 0.06, 2.9, 6), s * 1.68, 0.26, 0, 0, 1, 1, 1, Math.PI / 2, 0), M.bambooDry);
      emit(xf(gCone(0.06, 0.5, 6), s * 1.68, 0.3, 1.7, 0, 1, 1, 1, Math.PI / 2, 0), M.bambooDry);
    }
    // a short mast with a sail furled against it
    emit(xf(gCyl(0.045, 0.06, 2.6, 6), 0, 1.5, -0.5), M.bambooDry);
    herds.laundry.put(x, g + 1.9, z, yaw + 0.2, 0.8, 0.55, 1, 0, 0, rnd() * 6);
    // gear heaped on the sand beside it
    for (let i = 0; i < 3; i++) {
      emit(xf(gCyl(0.24, 0.2, 0.16, 8), (rnd() - 0.5) * 1.2, 0.1, 2.6 + rnd() * 1.2), M.woodPale);
    }
  }
}

/* ═══════════════ assembly ═══════════════ */

export function buildScatter(scene, opts = {}) {
  const { lowEnd = false, seed = 60724 } = opts;
  const rnd = makeRandom(seed);

  claims.length = 0;                          // a second build must not inherit the first
  const group = new THREE.Group();
  group.name = 'scatter';
  const lights = [];
  const M = buildMaterials();
  const glowMats = [M.lamp];
  const batch = new Batch();

  /* Everything that repeats is an InstancedMesh; the swaying ones share the
     wind uniforms and carry their own aSway attribute. */
  const herds = {
    rice:       new Herd(riceTuft(), M.rice, true),
    slab:       new Herd(rockLump(rnd, 0.5), M.stone),
    boulder:    new Herd(rockLump(rnd, 0.6), M.rockWet),
    culm:       new Herd(bambooCulm(CULM_H), M.bamboo, true),
    bambooLeaf: new Herd(bambooSpray(), M.bambooLeaf, true),
    palm:       new Herd(palmTrunk(PALM_H), M.palmBark, true),
    frond:      new Herd(palmFrond(), M.frond, true),
    coconut:    new Herd(gSph(1, 6, 5), M.coconut),
    plumeria:   new Herd(plumeriaLimb(rnd), M.plumBark),
    plumLeaf:   new Herd(plumeriaLeaves(), M.plumLeaf, true),
    blossom:    new Herd(plumeriaFlower(), M.blossom, true),
    canang:     new Herd(canangGeo(), M.offering),
    laundry:    new Herd(gPlane(1.4, 1.5, 3, 3).translate(0, -0.75, 0), M.laundry, true),
    banner:     new Herd(bannerCloth(), M.banner, true),
  };

  addSway(M.rice, 'rice', { h: 1.0, amp: 0.16, speed: 1.55, curve: 1.5 });
  addSway(M.bamboo, 'culm', { h: CULM_H, amp: 0.85, speed: 0.62, curve: 1.9 });
  addSway(M.bambooLeaf, 'bleaf', { h: 0.9, amp: 0.34, speed: 1.70, curve: 0.7 });
  addSway(M.palmBark, 'palm', { h: PALM_H, amp: 0.55, speed: 0.50, curve: 2.1 });
  addSway(M.frond, 'frond', { h: FROND_L, amp: 0.50, speed: 1.05, curve: 0.8, metric: 'max(transformed.z, 0.0)' });
  addSway(M.plumLeaf, 'pleaf', { h: 0.6, amp: 0.20, speed: 1.30, curve: 0.6 });
  addSway(M.blossom, 'blossom', { h: 0.2, amp: 0.14, speed: 1.50, curve: 0.5 });
  addSway(M.laundry, 'laundry', { h: 1.5, amp: 0.30, speed: 1.25, curve: 0.9 });
  addSway(M.banner, 'banner', { h: BANNER_H, amp: 0.42, speed: 0.95, curve: 0.9 });

  /* Order matters: the deliberate landmarks stake their claims first, then the
     scatter passes fill whatever ground is left. */
  buildCascade(rnd, group, batch, M, herds);
  buildVillage(rnd, batch, herds, M, lights);
  buildShrinesAndGates(rnd, batch, herds, M);
  buildBoats(rnd, batch, herds, M);
  buildTerraces(rnd, group, batch, M, herds, lowEnd);
  buildBamboo(rnd, herds, lowEnd);
  /* [x, z, clear] — clear is the radius that gets the tree outside whatever
     landmark it is planted beside. */
  buildFrangipani(rnd, herds, [
    [9, pathZ(9), 7.5], [22, 26, 10.5], [55, -44, 11.5], [-34, -6, 9.0],
    [50, 22, 3.2], [-30.5, pathZ(-30.5) + 6.2, 3.2], [21, pathZ(21) - 6.4, 3.2],
    [-70, pathZ(-70) + 7.0, 3.2], [43, -12, 3.2], [-16, 36, 3.2],
    [-46, -25.5, 11.0], [30, 6, 3.0],
  ], lowEnd);
  buildPalms(rnd, herds, lowEnd);

  batch.flush(group);
  herds.rice.build(group, { cast: false });
  herds.slab.build(group, { cast: true, receive: true });
  herds.boulder.build(group, { cast: true, receive: true });
  herds.culm.build(group, { cast: true });
  herds.bambooLeaf.build(group, { cast: false });
  herds.palm.build(group, { cast: true });
  herds.frond.build(group, { cast: true });
  herds.coconut.build(group, { cast: false });
  herds.plumeria.build(group, { cast: true });
  herds.plumLeaf.build(group, { cast: false });
  herds.blossom.build(group, { cast: false });
  herds.canang.build(group, { cast: false, receive: true });
  herds.laundry.build(group, { cast: true });
  herds.banner.build(group, { cast: false });

  for (const l of lights) group.add(l);
  scene.add(group);

  // grabbed once so the per-frame call does no scene lookups
  const flowN = M.flow.normalMap;
  const fallN = M.fall.normalMap;
  const paddyN = M.paddy.normalMap;
  const mist = group.getObjectByName('spray');

  return {
    group,
    lights,
    glowMats,

    /**
     * `wind` is optional. main.js already computes one but does not pass it,
     * so when it is absent we build our own out of the same slow terms.
     */
    update(dt, t, camera, sky, nightFactor = 0, wind = null) {
      windU.t.value = t;
      windU.w.value = wind !== null
        ? clamp(wind * 0.8, 0.15, 2.2)
        : 0.55 + Math.sin(t * 0.11) * 0.2 + noise2(t * 0.07, 3.1) * 0.25;

      /* Wrapped at 1 because that is exactly one tile: left to accumulate, an
         hour of play walks the offset far enough out that float32 starts
         quantising the ripple. */
      if (flowN) flowN.offset.y = (flowN.offset.y - dt * 0.62) % 1;
      if (fallN) { fallN.offset.y = (fallN.offset.y - dt * 2.1) % 1; fallN.offset.x = Math.sin(t * 0.7) * 0.04; }
      if (paddyN) {
        paddyN.offset.x = (paddyN.offset.x + dt * 0.004) % 1;
        paddyN.offset.y = (paddyN.offset.y + dt * 0.0026) % 1;
      }
      if (mist) {
        mist.material.opacity = 0.11 + Math.sin(t * 0.9) * 0.03 + Math.sin(t * 0.37) * 0.02;
        mist.rotation.y = Math.sin(t * 0.13) * 0.08;
      }

      // the village comes on at dusk, on the curve bali.js already uses
      const lamp = clamp(nightFactor * 1.4, 0, 1);
      const flicker = 0.85 + noise2(t * 1.7, 11.3) * 0.15;
      for (const m of glowMats) m.emissiveIntensity = lamp * (0.55 + flicker * 0.6);
      for (const l of lights) l.intensity = lamp * flicker * 1.5;
    },
  };
}
