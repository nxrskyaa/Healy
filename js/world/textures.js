/* ═══════════════════════════════════════════════════════════
   Every surface in Healy is painted here, on a 2D canvas, out of
   the project's own noise — there is not one image file in the
   repository and there never will be. Colour maps stay
   deliberately flat, around ±12% luminance; the contrast that
   actually reads as texture lives in the matching normal map,
   which every tiling texture carries on userData.normalMap.
   ═══════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { makeRandom, noise2, clamp, smoothstep } from './noise.js';

export const TEX_SIZE = 256;

/* ─────────── cache ─────────── */

const CACHE = new Map();

/* A cached texture is handed to dozens of materials at once. avatar.js frees
   material.map when creator.js rebuilds the figure — which happens on every
   option press — so the library's own copies refuse to be disposed, or the
   second rebuild would hand out a dead GPU texture. pbr() gives out clones
   when a caller needs its own repeat, and clones die normally. */
function protect(tex) {
  tex.userData.shared = true;
  tex.dispose = () => {};
  return tex;
}

const argKey = (a) =>
  a && typeof a === 'object' && !Array.isArray(a)
    ? Object.keys(a).sort().map((k) => k + ':' + a[k]).join(',')
    : String(a);

function cached(name, args, build) {
  const key = name + '(' + args.map(argKey).join('|') + ')';
  let tex = CACHE.get(key);
  if (!tex) { tex = protect(build()); CACHE.set(key, tex); }
  return tex;
}

/* ─────────── colour ─────────── */

/* The renderer outputs sRGB with tone mapping done in grade.js, so canvas
   bytes are sRGB while three's Color works in linear. Every mix and every
   brightness multiply below happens in linear and is encoded on the way out;
   doing it in sRGB bytes greys out anything saturated. */
const SRGB_LUT = (() => {
  const t = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) {
    const x = i / 1023;
    t[i] = Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  }
  return t;
})();

const enc = (x) => SRGB_LUT[x <= 0 ? 0 : x >= 1 ? 1023 : (x * 1023) | 0];

/** The inverse, per byte, so a multiply can be done where it means something. */
const DEC_LUT = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    t[i] = x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const _col = new THREE.Color();
const linearOf = (hex) => { _col.set(hex); return [_col.r, _col.g, _col.b]; };

function set3(out, c) { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; }

function mixInto(out, a, b, t) {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

function scale3(out, k) { out[0] *= k; out[1] *= k; out[2] *= k; return out; }

/** A canvas fill/stroke style from a linear triple, brightened by k. */
function css(lin, k = 1, alpha = 1) {
  const r = enc(lin[0] * k), g = enc(lin[1] * k), b = enc(lin[2] * k);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

/* ─────────── seamless noise ─────────── */

/* Perlin does not wrap, so sample it at the four corners of the tile and
   cross-fade. Costs a little contrast in the middle, which for a deliberately
   flat palette is a fair trade for having no seam at all. Any warp fed in as
   ox/oy stays seamless as long as the warp field is itself seamless, because
   all four corner samples share it. */
function tnoise(u, v, fx, fy, ox = 0, oy = 0) {
  const a = noise2(u * fx + ox, v * fy + oy);
  const b = noise2((u - 1) * fx + ox, v * fy + oy);
  const c = noise2(u * fx + ox, (v - 1) * fy + oy);
  const d = noise2((u - 1) * fx + ox, (v - 1) * fy + oy);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Octaves of tnoise. Lands around sd 0.12, hard limits about ±0.5. */
function tfbm(u, v, fx, fy, oct = 4, gain = 0.5, ox = 0, oy = 0) {
  let amp = 1, sum = 0, norm = 0, m = 1;
  for (let i = 0; i < oct; i++) {
    sum += amp * tnoise(u, v, fx * m, fy * m, ox, oy);
    norm += amp; amp *= gain; m *= 2;
  }
  return sum / norm;
}

/* A seamless sample costs four Perlin lookups per octave, and at 256² that is
   a visible hitch on load. A layer whose features are tens of texels across
   carries no per-texel information, so bake it once on a grid sized to its own
   frequency and read it back bilinearly — sixteen times cheaper for the broad
   layers, and identical on screen. Wrapped indices keep the tiling exact. */
function bake(S, fx, fy, oct = 3, ox = 0, oy = 0) {
  const detail = Math.max(fx, fy) * (1 << (oct - 1)) * 3;
  const R = Math.min(S, Math.max(16, 1 << Math.ceil(Math.log2(detail))));
  const a = new Float32Array(R * R);
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) a[y * R + x] = tfbm(x / R, y / R, fx, fy, oct, 0.5, ox, oy);
  }
  /* Smoothstep the interpolation weights rather than using them raw. Plain
     bilinear is continuous but its DERIVATIVE steps at every cell edge, and
     since these layers are Sobelled into normal maps that step is embossed
     into the surface as a perfectly axis-aligned quilt — the artefact that
     reads as "cheap engine" on an otherwise soft painted world. */
  const sm = (t) => t * t * (3 - 2 * t);
  return (u, v) => {
    const px = u * R, py = v * R;
    const x0 = Math.floor(px), y0 = Math.floor(py);
    const tx = sm(px - x0), ty = sm(py - y0);
    const i0 = ((x0 % R) + R) % R, i1 = (i0 + 1) % R;
    const j0 = ((y0 % R) + R) % R, j1 = (j0 + 1) % R;
    const r0 = j0 * R, r1 = j1 * R;
    const top = a[r0 + i0] + (a[r0 + i1] - a[r0 + i0]) * tx;
    const bot = a[r1 + i0] + (a[r1 + i1] - a[r1 + i0]) * tx;
    return top + (bot - top) * ty;
  };
}

/** Creases: peaks where t crosses zero, w wide, p sharp. */
const ridge = (t, w, p) => Math.pow(clamp(1 - Math.abs(t) / w, 0, 1), p);

/** Per-cell jitter that tiles for free, because cell indices already repeat. */
function ihash(a, b, s) {
  let h = (a * 374761393 + b * 668265263 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Two noise offsets from a seed, so two bark colours are not the same plank. */
const offsets = (seed) => [((seed * 37) % 211) * 1.7, ((seed * 91) % 173) * 2.3];

/* ─────────── canvas ─────────── */

function canvas2d(w, h = w) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return { cv, ctx: cv.getContext('2d', { willReadFrequently: true }) };
}

/** Fill the tile from a per-texel callback that writes a linear triple. */
function field(ctx, S, fn) {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const out = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      fn(x / S, v, out, x, y);
      const i = (y * S + x) << 2;
      d[i] = enc(out[0]); d[i + 1] = enc(out[1]); d[i + 2] = enc(out[2]); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Multiply everything already drawn by a per-texel factor. This is what keeps
    drawn shapes sitting IN the surface rather than pasted on top of it.

    The multiply happens in LINEAR, which is the rule stated at the top of this
    file and was not being followed here. Scaling sRGB bytes instead applies
    the factor after the transfer curve, so an intended k of 0.85..1.15 lands
    as a luminance factor of k^2.4 — a ±12% stain became a 5:1 blotch across
    ten of the fourteen textures, and stole the contrast budget that belongs
    to the normal map. */
function modulate(ctx, S, fn) {
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const k = fn(x / S, v, x, y);
      const i = (y * S + x) << 2;
      d[i] = enc(DEC_LUT[d[i]] * k);
      d[i + 1] = enc(DEC_LUT[d[i + 1]] * k);
      d[i + 2] = enc(DEC_LUT[d[i + 2]] * k);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** One pass of low-frequency dirt over the whole tile. */
function grime(ctx, S, amount, fx, fy, ox = 0, oy = 0) {
  const at = bake(S, fx, fy, 2, ox, oy);
  // a third of what it was: now that the multiply is linear, the old amounts
  // would be even louder than the sRGB bug made them
  modulate(ctx, S, (u, v) => 1 + at(u, v) * amount * 0.3);
}

/* Draws fn centred on (x, y) once for every wrap of the tile it touches, so a
   feature crossing an edge reappears on the far side. pad is the feature's
   half-size — too small and the wrapped copy gets clipped into a ghost.
   fn is called more than once for the same feature, so it must be pure:
   pull every random number out of the RNG BEFORE calling this, never inside,
   or the two halves of an edge-crossing feature will not match. */
function wrapped(ctx, S, x, y, pad, fn) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const px = x + ox * S, py = y + oy * S;
      if (px + pad < 0 || px - pad > S || py + pad < 0 || py - pad > S) continue;
      ctx.save();
      ctx.translate(px, py);
      fn(ctx);
      ctx.restore();
    }
  }
}

/** A wavy line that runs the full height of the tile; k whole waves so it meets
    itself top to bottom. Only x needs wrapping. */
function seamLine(ctx, S, x, amp, k, phase) {
  for (const off of [-S, 0, S]) {
    if (x + off + amp < 0 || x + off - amp > S) continue;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const px = x + off + Math.sin(t * Math.PI * 2 * k + phase) * amp;
      if (i) ctx.lineTo(px, t * S); else ctx.moveTo(px, 0);
    }
    ctx.stroke();
  }
}

/** Wrap a finished canvas as a tiling colour map, with its normal map attached
    where pbr() can find it without the caller having to ask. */
function finish(cv, normalStrength = 0) {
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (normalStrength > 0) {
    /* Non-enumerable, and lazy. Three's Texture.copy() deep-copies userData
       with JSON.parse(JSON.stringify(...)), so an enumerable Texture here
       makes every pbr({repeat}) clone serialise a whole PNG through
       canvas.toDataURL — dozens of deflate passes over high-entropy noise at
       load, all discarded — and hands back a plain object where a Texture is
       expected. JSON skips non-enumerable properties, so this costs nothing
       and the map is only Sobelled if somebody actually asks for it. */
    Object.defineProperty(tex.userData, 'normalMap', {
      get: () => normalFromCanvas(cv, normalStrength),
      enumerable: false,
      configurable: true,
    });
  }
  return tex;
}

/* ─────────── normal maps ─────────── */

const NORMALS = new WeakMap();

/**
 * Sobel the luminance of a canvas into a tangent-space normal map.
 *
 * Green-up, the OpenGL convention three.js expects: the top of a bump reads
 * bright green. Canvas rows run downward while UV v runs upward (CanvasTexture
 * flips on upload), so the v derivative changes sign and ny ends up as +dh/dy
 * in canvas space. Get that backwards and every surface looks pressed in.
 *
 * strength 1 is the raw Sobel sum over 0..1 luminance, which on these
 * low-contrast maps is roughly a 10-15 degree tilt. Weak colour maps want 2-6.
 * Accepts a canvas or any texture holding one.
 */
export function normalFromCanvas(canvas, strength = 1) {
  const cv = canvas && canvas.isTexture ? canvas.image : canvas;
  let byStrength = NORMALS.get(cv);
  if (!byStrength) { byStrength = new Map(); NORMALS.set(cv, byStrength); }
  const hit = byStrength.get(strength);
  if (hit) return hit;

  const W = cv.width, H = cv.height;
  const src = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;

  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (src[p] * 0.2126 + src[p + 1] * 0.7152 + src[p + 2] * 0.0722) / 255;
  }

  const { cv: out, ctx } = canvas2d(W, H);
  const img = ctx.createImageData(W, H);
  const d = img.data;

  for (let y = 0; y < H; y++) {
    // wrapped rows, so the normal map tiles wherever its colour map does
    const y0 = ((y - 1) + H) % H, y1 = (y + 1) % H;
    for (let x = 0; x < W; x++) {
      const x0 = ((x - 1) + W) % W, x1 = (x + 1) % W;

      const tl = lum[y0 * W + x0], tm = lum[y0 * W + x], tr = lum[y0 * W + x1];
      const ml = lum[y * W + x0], mr = lum[y * W + x1];
      const bl = lum[y1 * W + x0], bm = lum[y1 * W + x], br = lum[y1 * W + x1];

      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bm + br) - (tl + 2 * tm + tr);

      const nx = -gx * strength, ny = gy * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const i = (y * W + x) << 2;
      d[i] = (nx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(out);
  // normal maps are data, never colour — leave them linear or lighting inverts
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  protect(tex);
  byStrength.set(strength, tex);
  return tex;
}

/* ─────────── material helper ─────────── */

/**
 * MeshStandardMaterial with the colour space and wrapping already right.
 *
 * If normalMap is not given it is taken from map.userData.normalMap, which
 * every texture in this file supplies — so pbr({ color, map: barkTexture(c) })
 * is already a fully normal-mapped surface.
 *
 * repeat clones the maps first: the library's textures are shared by everyone,
 * and repeat lives on the texture, so setting it in place would retile half
 * the world. Clones share the GPU source, so this is cheap.
 */
export function pbr(opts = {}) {
  const { map = null, normalMap, repeat = null, normalScale = 1, ...rest } = opts;

  let colorMap = map;
  let nrm = normalMap === undefined ? (map && map.userData.normalMap) || null : normalMap;

  if (repeat) {
    const [rx, ry] = Array.isArray(repeat) ? repeat : [repeat, repeat];
    const retile = (t) => {
      if (!t) return null;
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(rx, ry);
      return c;
    };
    colorMap = retile(colorMap);
    nrm = retile(nrm);
  }

  if (colorMap) colorMap.colorSpace = THREE.SRGBColorSpace;
  if (nrm) nrm.colorSpace = THREE.NoColorSpace;

  const params = {
    roughness: 0.85,
    metalness: 0,
    // the world is lit from a PMREM of the sky dome (env.js), calibrated at
    // roughly half strength; a material built later must match or it glows
    envMapIntensity: 0.6,
    ...rest,
  };
  for (const k of Object.keys(params)) if (params[k] === undefined) delete params[k];
  if (colorMap) params.map = colorMap;
  if (nrm) params.normalMap = nrm;

  const mat = new THREE.MeshStandardMaterial(params);
  if (nrm) {
    const [sx, sy] = Array.isArray(normalScale) ? normalScale : [normalScale, normalScale];
    mat.normalScale.set(sx, sy);
  }
  return mat;
}

/* ─────────── bark ─────────── */

/** Trunks: vertical fissures, a lichen bloom, and lenticel dashes. */
export function barkTexture(hex = '#6b4f38', opts = {}) {
  return cached('bark', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 41;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const moss = linearOf(opts.moss || '#6f7a53');
    const mossy = opts.moss === false ? 0 : (opts.mossiness ?? 0.24);
    const { cv, ctx } = canvas2d(S);

    const warpAt = bake(S, 3, 2, 1, ox, oy);
    const mossAt = bake(S, 4, 3.5, 2, ox + 31, oy - 17);
    field(ctx, S, (u, v, out) => {
      // ridges run up the trunk, so the field is stretched hard along v
      const warp = warpAt(u, v) * 6;
      const g = tfbm(u, v, 28, 2.5, 3, 0.5, ox + warp, oy);
      // two crack scales: the wide split and the fine checking between splits
      const crack = ridge(tnoise(u, v, 13, 1.8, ox + warp, oy + 11), 0.13, 1.6);
      const check = ridge(tnoise(u, v, 46, 6, ox + warp, oy - 21), 0.1, 1.4);
      const fine = tnoise(u, v, 70, 16, ox, oy);
      const k = 1 + g * 0.5 + fine * 0.24 - crack * 0.45 - check * 0.16;
      scale3(mixInto(out, base, moss, mossy * smoothstep(0.05, 0.28, mossAt(u, v))), k);
    });

    // the deep fissures, and the pale lip alongside each — the lip is what
    // actually catches the light and reads as a ridge rather than a stain
    ctx.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const x = rnd() * S, amp = 3 + rnd() * 8, k = 1 + ((rnd() * 2) | 0), ph = rnd() * 6.28;
      ctx.strokeStyle = css(base, 0.42, 0.75);
      ctx.lineWidth = 1.5 + rnd() * 3.5;
      seamLine(ctx, S, x, amp, k, ph);
      ctx.strokeStyle = css(base, 1.5, 0.4);
      ctx.lineWidth = 1 + rnd() * 1.4;
      seamLine(ctx, S, x + 2.5 + rnd() * 3, amp, k, ph);
    }

    for (let i = 0; i < 26; i++) {
      const w = S * (0.02 + rnd() * 0.05), h = S * 0.006;
      wrapped(ctx, S, rnd() * S, rnd() * S, w, (c) => {
        c.fillStyle = css(base, 1.22, 0.4);
        c.beginPath();
        c.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
        c.fill();
      });
    }

    grime(ctx, S, 0.9, 3, 2, ox + 5, oy + 5);
    return finish(cv, 3.2);
  });
}

/* ─────────── foliage ─────────── */

/** The surface of a leaf cluster: overlapping blades, gaps, a little autumn. */
export function foliageTexture(hex = '#5f8a4e', opts = {}) {
  return cached('foliage', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 77;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const dark = linearOf(opts.shade || '#2f4a2c');
    const warm = linearOf(opts.tip || '#9db85a');
    const { cv, ctx } = canvas2d(S);

    const clumpAt = bake(S, 7, 7, 3, ox, oy);
    field(ctx, S, (u, v, out) => {
      mixInto(out, base, dark, clamp(0.34 - clumpAt(u, v) * 1.5, 0, 0.6));
      scale3(out, 1 + tfbm(u, v, 30, 30, 2, 0.5, ox, oy) * 0.36);
    });

    const leaves = opts.leaves || 90;
    for (let i = 0; i < leaves; i++) {
      const x = rnd() * S, y = rnd() * S;
      const len = S * (0.05 + rnd() * 0.07), wid = len * (0.34 + rnd() * 0.2);
      const rot = rnd() * Math.PI * 2;
      const t = rnd();
      const lit = t < 0.25 ? css(warm, 0.95 + rnd() * 0.2, 0.75)
        : t < 0.7 ? css(base, 1.06 + rnd() * 0.16, 0.7)
          : css(dark, 1.1, 0.55);
      wrapped(ctx, S, x, y, len, (c) => {
        c.rotate(rot);
        c.fillStyle = lit;
        c.beginPath();
        c.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
        c.fill();
        // one vein: enough to break the blob into a leaf under the normal map
        c.strokeStyle = css(dark, 1.05, 0.35);
        c.lineWidth = 0.9;
        c.beginPath();
        c.moveTo(-len * 0.9, 0);
        c.lineTo(len * 0.9, 0);
        c.stroke();
      });
    }

    grime(ctx, S, 1.0, 3, 3, ox + 3, oy - 8);
    return finish(cv, 2.6);
  });
}

/* ─────────── ground ─────────── */

/** Soil, grass litter and pebbles. Tiles hard — this goes on a 300 m plane. */
export function groundTexture(opts = {}) {
  return cached('ground', [opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 5;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const soil = linearOf(opts.soil || '#6a5942');
    const grass = linearOf(opts.grass || '#5d7d47');
    const dry = linearOf(opts.dry || '#8a8557');
    const { cv, ctx } = canvas2d(S);

    const patchAt = bake(S, 4, 4, 3, ox, oy);
    const strawAt = bake(S, 9, 9, 2, ox + 19, oy + 7);
    field(ctx, S, (u, v, out) => {
      mixInto(out, soil, grass, clamp(0.5 + patchAt(u, v) * 2.4, 0, 1));
      mixInto(out, out, dry, clamp(strawAt(u, v) * 2.2, 0, 1) * 0.35);
      scale3(out, 1 + tfbm(u, v, 42, 42, 2, 0.5, ox, oy) * 0.4);
    });

    const pebbles = opts.pebbles ?? 46;
    for (let i = 0; i < pebbles; i++) {
      const r = S * (0.006 + rnd() * 0.016);
      const ry = r * (0.6 + rnd() * 0.3);
      const rot = rnd() * 3.14;
      const k = 1.1 + rnd() * 0.35;
      wrapped(ctx, S, rnd() * S, rnd() * S, r * 2, (c) => {
        c.rotate(rot);
        c.fillStyle = css(soil, k, 0.8);
        c.beginPath();
        c.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2);
        c.fill();
        // the sliver of shadow where it beds into the soil
        c.fillStyle = css(soil, k * 0.6, 0.5);
        c.beginPath();
        c.ellipse(0, ry * 0.55, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
        c.fill();
      });
    }

    // short litter blades, laid down flat, all pointing nowhere in particular
    ctx.lineCap = 'round';
    const blades = opts.blades ?? 220;
    for (let i = 0; i < blades; i++) {
      const len = S * (0.012 + rnd() * 0.03);
      const rot = rnd() * Math.PI * 2;
      const style = css(rnd() < 0.35 ? dry : grass, 1.05 + rnd() * 0.3, 0.55);
      const w = 0.8 + rnd() * 0.8;
      wrapped(ctx, S, rnd() * S, rnd() * S, len, (c) => {
        c.rotate(rot);
        c.strokeStyle = style;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(-len, 0);
        c.quadraticCurveTo(0, -len * 0.25, len, 0);
        c.stroke();
      });
    }

    grime(ctx, S, 0.85, 2, 2, ox - 12, oy + 4);
    return finish(cv, 2.8);
  });
}

/* ─────────── rock ─────────── */

/** Granite: mottle, feldspar speckle, a vein and a couple of hairline cracks. */
export function rockTexture(hex = '#8d9188', opts = {}) {
  return cached('rock', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 23;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const vein = linearOf(opts.vein || '#c8c6bb');
    const { cv, ctx } = canvas2d(S);

    const mottleAt = bake(S, 6, 6, 3, ox, oy);
    const bandAt = bake(S, 3, 5, 2, ox + 40, oy);
    field(ctx, S, (u, v, out) => {
      // the crystal scale matters more than the broad mottle; too much of the
      // latter and granite turns into marble
      const crystal = tnoise(u, v, 30, 30, ox, oy);
      const grit = tnoise(u, v, 84, 84, ox, oy);
      mixInto(out, base, vein, ridge(bandAt(u, v), 0.1, 1.5) * 0.3);
      scale3(out, 1 + mottleAt(u, v) * 0.24 + crystal * 0.3 + grit * 0.24);
    });

    // speckle is what actually reads as stone; keep it small, dense and hard.
    // integer coordinates only, or fillRect antialiases the grain into mush
    const specks = opts.specks ?? 2600;
    for (let i = 0; i < specks; i++) {
      const x = (rnd() * S) | 0, y = (rnd() * S) | 0;
      const t = rnd();
      const s = t < 0.72 ? 1 : t < 0.95 ? 2 : 3;
      ctx.fillStyle = rnd() < 0.5 ? css(base, 1.6, 0.7) : css(base, 0.42, 0.6);
      for (const dx of x + s > S ? [0, -S] : [0]) {
        for (const dy of y + s > S ? [0, -S] : [0]) ctx.fillRect(x + dx, y + dy, s, s);
      }
    }

    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = css(base, 0.55, 0.45);
      ctx.lineWidth = 0.9 + rnd();
      seamLine(ctx, S, rnd() * S, 8 + rnd() * 20, 1 + ((rnd() * 3) | 0), rnd() * 6.28);
    }

    grime(ctx, S, 0.75, 2, 2, ox + 60, oy - 30);
    return finish(cv, 3.6);
  });
}

/* ─────────── brick ─────────── */

/** Balinese bata merah: thin courses, wide soft mortar, heavy weathering. */
export function brickTexture(hex = '#8a4a36', opts = {}) {
  return cached('brick', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 12;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const mortar = linearOf(opts.mortar || '#b3a894');
    // even course count, or the half-brick offset will not meet itself
    const rows = (opts.courses || 6) & ~1;
    const cols = opts.per || 3;
    const rh = S / rows, cw = S / cols;
    const gap = opts.gap ?? Math.max(1.5, S * 0.008);
    const { cv, ctx } = canvas2d(S);

    const roughAt = bake(S, 20, 20, 2, ox, oy);
    field(ctx, S, (u, v, out) => {
      scale3(set3(out, mortar), 1 + roughAt(u, v) * 0.35);
    });

    for (let r = 0; r < rows; r++) {
      const shift = (r & 1) ? cw * 0.5 : 0;
      for (let c = 0; c < cols; c++) {
        const cx = c * cw + shift + cw * 0.5;
        const cy = r * rh + rh * 0.5;
        const tone = 0.82 + ihash(c, r, seed) * 0.4;
        const lean = (ihash(c, r, seed + 7) - 0.5) * 0.02;
        wrapped(ctx, S, cx, cy, Math.max(cw, rh), (k) => {
          k.rotate(lean);
          k.fillStyle = css(base, tone);
          k.beginPath();
          const w = cw * 0.5 - gap, h = rh * 0.5 - gap, rr = Math.min(w, h) * 0.28;
          k.moveTo(-w + rr, -h);
          k.arcTo(w, -h, w, h, rr);
          k.arcTo(w, h, -w, h, rr);
          k.arcTo(-w, h, -w, -h, rr);
          k.arcTo(-w, -h, w, -h, rr);
          k.closePath();
          k.fill();
          // the worn top arris — the one highlight that says "fired clay"
          k.strokeStyle = css(base, tone * 1.35, 0.5);
          k.lineWidth = 1.1;
          k.beginPath();
          k.moveTo(-w + rr, -h + 0.6);
          k.lineTo(w - rr, -h + 0.6);
          k.stroke();
          k.strokeStyle = css(base, tone * 0.62, 0.45);
          k.beginPath();
          k.moveTo(-w + rr, h - 0.6);
          k.lineTo(w - rr, h - 0.6);
          k.stroke();
        });
      }
    }

    // pitting: fired brick is never smooth, and this is what the normal reads
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() < 0.6 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.09)';
      ctx.fillRect((rnd() * S) | 0, (rnd() * S) | 0, 1, 1);
    }

    grime(ctx, S, 0.9, 3, 3, ox + 9, oy + 2);
    return finish(cv, 3.0);
  });
}

/* ─────────── thatch ─────────── */

/** Alang-alang roof: hard directional fibre, bundled into courses. */
export function thatchTexture(hex = '#4a3b28', opts = {}) {
  return cached('thatch', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 61;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const pale = linearOf(opts.pale || '#a08a5e');
    const courses = opts.courses || 4;
    const { cv, ctx } = canvas2d(S);

    field(ctx, S, (u, v, out) => {
      const g = tfbm(u, v, 3, 26, 2, 0.5, ox, oy);
      scale3(mixInto(out, base, pale, clamp(0.2 + g * 1.2, 0, 0.5)), 0.82 + g * 0.4);
    });

    ctx.lineCap = 'round';
    const strands = opts.strands ?? 620;
    for (let i = 0; i < strands; i++) {
      const len = S * (0.09 + rnd() * 0.17);
      const lean = (rnd() - 0.5) * 0.34;
      const t = rnd();
      const style = css(t < 0.3 ? pale : base, 0.7 + t * 0.9, 0.6);
      const w = 0.9 + rnd() * 1.5;
      wrapped(ctx, S, rnd() * S, rnd() * S, len, (c) => {
        c.rotate(lean);
        c.strokeStyle = style;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(0, -len);
        c.lineTo(0, len);
        c.stroke();
      });
    }

    // the shadow under each course goes on LAST, over the fibre — it is the
    // overlap of one layer onto the next, not something buried in the pile.
    // the band at y = S supplies the part of the y = 0 band that hangs off top
    for (let i = 0; i <= courses; i++) {
      const y = (i / courses) * S;
      const grad = ctx.createLinearGradient(0, y - S * 0.07, 0, y + S * 0.015);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.82, 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, y - S * 0.07, S, S * 0.085);
    }

    grime(ctx, S, 1.0, 4, 3, ox - 6, oy + 14);
    return finish(cv, 3.8);
  });
}

/* ─────────── wood ─────────── */

/** Planks and posts. planks:0 gives bare grain for a turned or squared post. */
export function woodTexture(hex = '#8a6a48', opts = {}) {
  return cached('wood', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 33;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const dark = linearOf(opts.grainColor || '#4a3323');
    const planks = opts.planks ?? 4;
    const rings = opts.rings ?? 7;
    const { cv, ctx } = canvas2d(S);

    const warpAt = bake(S, 2, 7, 3, ox, oy);
    field(ctx, S, (u, v, out) => {
      const p = planks ? Math.floor(v * planks) : 0;
      // each plank comes off a different part of the log
      const jitter = planks ? ihash(0, p, seed) : 0;
      const warp = warpAt(u, v) * 7;
      const g = Math.sin((u * rings + jitter) * Math.PI * 2 + warp);
      const grain = Math.pow(0.5 + 0.5 * g, 3);
      const fibre = tnoise(u, v, 8, 90, ox, oy);
      mixInto(out, base, dark, grain * 0.42);
      scale3(out, (planks ? 0.94 + jitter * 0.16 : 1) * (1 + fibre * 0.4));

      if (planks) {
        const edge = Math.abs(v * planks - Math.round(v * planks)) / planks;
        scale3(out, 1 - smoothstep(0.012, 0, edge) * 0.5);
      }
    });

    // knots: two or three, wrapped, each with its own swirl of grain
    const knots = opts.knots ?? 2;
    for (let i = 0; i < knots; i++) {
      const r = S * (0.02 + rnd() * 0.025);
      wrapped(ctx, S, rnd() * S, rnd() * S, r * 3, (c) => {
        for (let j = 6; j >= 1; j--) {
          c.strokeStyle = css(dark, 0.9 + j * 0.08, 0.32);
          c.lineWidth = 1.2;
          c.beginPath();
          c.ellipse(0, 0, r * j * 0.42, r * j * 0.26, 0.5, 0, Math.PI * 2);
          c.stroke();
        }
        c.fillStyle = css(dark, 0.8, 0.75);
        c.beginPath();
        c.ellipse(0, 0, r * 0.5, r * 0.32, 0.5, 0, Math.PI * 2);
        c.fill();
      });
    }

    grime(ctx, S, 0.7, 3, 2, ox + 21, oy - 11);
    return finish(cv, 2.8);
  });
}

/* ─────────── cloth ─────────── */

/** Plain weave. thread must divide the tile, so it is snapped to 2/4/8. */
export function clothTexture(hex = '#e8e0c8', opts = {}) {
  return cached('cloth', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 88;
    const [ox, oy] = offsets(seed);
    const base = linearOf(hex);
    const want = opts.thread || 4;
    const th = want <= 2 ? 2 : want <= 4 ? 4 : 8;
    const { cv, ctx } = canvas2d(S);
    const foldAt = bake(S, 5, 5, 3, ox, oy);

    field(ctx, S, (u, v, out, x, y) => {
      const tx = (x / th) | 0, ty = (y / th) | 0;
      const over = ((tx + ty) & 1) === 0;
      const across = over ? ((y % th) + 0.5) / th : ((x % th) + 0.5) / th;
      // the round of the thread where it crosses over, flatter where it dives.
      // keep the two directions close: push them apart and a plain weave stops
      // reading as cloth and starts reading as gingham
      const roll = Math.sin(Math.PI * across);
      const k = over ? 0.99 + roll * 0.08 : 0.93 + roll * 0.06;
      // slub: real yarn is never the same thickness twice, and per-thread
      // variation is what stops a weave reading as gingham
      const slub = ihash(over ? tx : ty, over ? 0 : 1, seed) * 0.12 - 0.06;
      scale3(set3(out, base), k + slub + foldAt(u, v) * 0.2);
      if (ihash(tx, ty, seed + 3) > 0.985) scale3(out, 0.86);
    });

    return finish(cv, 3.0);
  });
}

/* ─────────── batik ─────────── */

/* Two motifs, both real ones. kawung is the four-petal lattice off the aren
   palm fruit; parang is the diagonal blade with its mlinjon strip between.
   These go on a sarong and on temple cloth, both read at arm's length, so
   they are drawn at twice the usual size and get their outlines and cecek. */

function kawung(ctx, S, cells, A, B, ink) {
  const c = S / cells;
  const petal = (k, d, rx, ry, rot) => {
    k.save();
    k.rotate(rot);
    k.beginPath();
    k.ellipse(d, 0, rx, ry, 0, 0, Math.PI * 2);
    k.fill();
    k.stroke();
    // cecek: the fine dot fill inside each petal
    k.fillStyle = ink;
    for (let i = 0; i < 3; i++) {
      k.beginPath();
      k.arc(d + (i - 1) * rx * 0.42, 0, Math.max(0.8, c * 0.012), 0, Math.PI * 2);
      k.fill();
    }
    k.restore();
  };

  const flower = (k) => {
    k.fillStyle = css(A, 1);
    k.strokeStyle = ink;
    k.lineWidth = Math.max(1, c * 0.022);
    for (let q = 0; q < 4; q++) {
      k.fillStyle = css(A, q & 1 ? 1.06 : 0.94);
      petal(k, c * 0.245, c * 0.225, c * 0.135, q * Math.PI * 0.5);
    }
    k.fillStyle = ink;
    k.beginPath();
    k.arc(0, 0, c * 0.035, 0, Math.PI * 2);
    k.fill();
  };

  // strictly one flower per lattice point — wrapped() supplies the copies, and
  // going one past the edge as well would double-draw the ink at x = 0
  const dots = (k) => {
    k.fillStyle = css(B, 1.6);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      k.beginPath();
      k.arc(dx * c * 0.05, dy * c * 0.05, Math.max(1, c * 0.016), 0, Math.PI * 2);
      k.fill();
    }
  };
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      wrapped(ctx, S, i * c, j * c, c * 0.5, flower);
      wrapped(ctx, S, (i + 0.5) * c, (j + 0.5) * c, c * 0.5, flower);
      // isen-isen: the little four-dot cluster that fills the gaps
      wrapped(ctx, S, (i + 0.5) * c, j * c, c * 0.1, dots);
      wrapped(ctx, S, i * c, (j + 0.5) * c, c * 0.1, dots);
    }
  }
}

function parang(ctx, S, cells, A, B, ink) {
  // drawn per-texel in sheared coordinates: both (x+y) and (x-y) repeat with
  // the tile, so a band pattern in those two is seamless by construction
  const w = S / cells;
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const inkL = linearOf(ink);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = (((x + y) % w) + w) % w;          // across the band
      const b = (((x - y) % w) + w) % w;          // along the band
      const edge = 0.30 * w + Math.sin((b / w) * Math.PI * 2) * 0.055 * w;
      let col = B, k = 1;
      if (a > edge && a < w - 0.14 * w) {
        // the blade itself, with its blunt nose repeating along the band
        col = A;
        k = 1 + Math.sin((b / w) * Math.PI * 4) * 0.06;
        if (a < edge + 0.045 * w) { col = inkL; k = 1; }
      } else if (a <= edge) {
        // mlinjon: the narrow strip of lozenges between blades
        const bb = ((b % (w * 0.5)) + w * 0.5) % (w * 0.5);
        const inside = Math.abs(bb - w * 0.25) / (w * 0.16) + Math.abs(a - edge * 0.5) / (w * 0.1);
        col = inside < 1 ? A : B;
        k = 0.94;
      } else {
        col = inkL;
      }
      const i = (y * S + x) << 2;
      d[i] = enc(col[0] * k); d[i + 1] = enc(col[1] * k); d[i + 2] = enc(col[2] * k); d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Batik. motif: 'kawung' (default) or 'parang'. */
export function batikTexture(hexA = '#e8dcc0', hexB = '#4a2a1c', opts = {}) {
  return cached('batik', [hexA, hexB, opts], () => {
    // twice the usual resolution: this one is read at arm's length
    const S = opts.size || TEX_SIZE * 2;
    const seed = opts.seed ?? 7;
    const [ox, oy] = offsets(seed);
    const A = linearOf(hexA);
    const B = linearOf(hexB);
    const inkStyle = css(linearOf(opts.ink || '#2b1a10'), 1, 0.9);
    const cells = opts.cells || 4;
    const { cv, ctx } = canvas2d(S);
    const motif = opts.motif || 'kawung';

    // parang paints every texel itself, so priming the ground would be wasted
    if (motif !== 'parang') {
      const dyeAt = bake(S, 6, 6, 3, ox, oy);
      field(ctx, S, (u, v, out) => scale3(set3(out, B), 1 + dyeAt(u, v) * 0.16));
    }

    if (motif === 'parang') {
      parang(ctx, S, cells, A, B, opts.ink || '#2b1a10');
      grime(ctx, S, 0.3, 6, 6, ox, oy);
    } else {
      kawung(ctx, S, cells, A, B, inkStyle);
    }

    // the wax crackle that makes a batik a batik rather than a print
    if (opts.crackle !== false) {
      ctx.lineCap = 'round';
      const rnd = makeRandom(seed + 500);
      for (let i = 0; i < 10; i++) {
        ctx.strokeStyle = 'rgba(30,18,10,0.16)';
        ctx.lineWidth = 0.8 + rnd() * 0.7;
        seamLine(ctx, S, rnd() * S, 10 + rnd() * 40, 1 + ((rnd() * 3) | 0), rnd() * 6.28);
      }
    }

    // and the cloth it is printed on, pressed back through the motif
    const th = 4;
    modulate(ctx, S, (u, v, x, y) => {
      const tx = (x / th) | 0, ty = (y / th) | 0;
      const over = ((tx + ty) & 1) === 0;
      const across = over ? ((y % th) + 0.5) / th : ((x % th) + 0.5) / th;
      return 0.93 + Math.sin(Math.PI * across) * (over ? 0.09 : 0.05);
    });

    return finish(cv, 1.8);
  });
}

/* ─────────── fur ─────────── */

/** Short animal fur: strokes following a flow field, dark roots, light tips. */
export function furTexture(hex = '#a98564', opts = {}) {
  return cached('fur', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 55;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const under = linearOf(opts.under || '#5d452f');
    const flow = opts.dir ?? Math.PI * 0.5;
    const { cv, ctx } = canvas2d(S);

    const patchAt = bake(S, 5, 5, 3, ox, oy);
    field(ctx, S, (u, v, out) => {
      // keep the undercoat quiet; the hairs have to be the loudest thing here
      mixInto(out, base, under, clamp(0.4 - patchAt(u, v) * 1.6, 0, 0.7));
      scale3(out, 1 + tnoise(u, v, 34, 34, ox, oy) * 0.16);
    });

    ctx.lineCap = 'round';
    const hairs = opts.hairs ?? 2600;
    for (let i = 0; i < hairs; i++) {
      const x = rnd() * S, y = rnd() * S;
      const ang = flow + tnoise(x / S, y / S, 3, 3, ox, oy) * 1.6;
      const len = S * (0.026 + rnd() * 0.04);
      const t = rnd();
      const style = t < 0.42 ? css(under, 0.66, 0.6) : css(base, 1.2 + t * 0.5, 0.62);
      const w = 0.7 + rnd() * 0.9;
      wrapped(ctx, S, x, y, len, (c) => {
        c.rotate(ang);
        c.strokeStyle = style;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(0, -len);
        c.quadraticCurveTo(len * 0.18, 0, len * 0.1, len);
        c.stroke();
      });
    }

    grime(ctx, S, 0.85, 3, 3, ox + 17, oy - 5);
    return finish(cv, 3.0);
  });
}

/* ─────────── feather ─────────── */

/** Plumage: overlapping scallops in even rows, each with a shaft and barbs. */
export function featherTexture(hex = '#b8ab8e', opts = {}) {
  return cached('feather', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 91;
    const [ox, oy] = offsets(seed);
    const base = linearOf(hex);
    const edge = linearOf(opts.edge || '#6b6250');
    const rows = (opts.rows || 6) & ~1;                 // even, so the offset wraps
    const cols = opts.cols || 5;
    const rh = S / rows, cw = S / cols;
    const { cv, ctx } = canvas2d(S);

    const downAt = bake(S, 10, 10, 3, ox, oy);
    field(ctx, S, (u, v, out) => {
      mixInto(out, base, edge, 0.45);
      scale3(out, 1 + downAt(u, v) * 0.2);
    });

    for (let r = 0; r < rows; r++) {
      const shift = (r & 1) ? cw * 0.5 : 0;
      for (let c = 0; c < cols; c++) {
        const cx = c * cw + shift, cy = r * rh;
        const tone = 0.9 + ihash(c, r, seed) * 0.28;
        const w = cw * 0.62, h = rh * 1.25;
        wrapped(ctx, S, cx, cy, Math.max(w, h) * 1.2, (k) => {
          const g = k.createLinearGradient(0, -h * 0.2, 0, h);
          g.addColorStop(0, css(base, tone * 1.12));
          g.addColorStop(0.72, css(base, tone * 0.94));
          g.addColorStop(1, css(edge, tone * 0.9));
          k.fillStyle = g;
          k.beginPath();
          k.moveTo(-w, 0);
          k.quadraticCurveTo(-w * 0.92, h, 0, h);
          k.quadraticCurveTo(w * 0.92, h, w, 0);
          k.quadraticCurveTo(0, -h * 0.28, -w, 0);
          k.closePath();
          k.fill();
          k.strokeStyle = css(edge, 0.85, 0.5);
          k.lineWidth = 1;
          k.stroke();
          // shaft, then barbs raked back off it
          k.strokeStyle = css(base, tone * 1.3, 0.55);
          k.lineWidth = 1.2;
          k.beginPath();
          k.moveTo(0, -h * 0.12);
          k.lineTo(0, h * 0.9);
          k.stroke();
          k.lineWidth = 0.7;
          k.strokeStyle = css(edge, 1.15, 0.32);
          for (let b = 1; b < 7; b++) {
            const t = b / 7;
            k.beginPath();
            k.moveTo(0, h * t * 0.85);
            k.lineTo(-w * 0.8 * (1 - t * 0.3), h * (t * 0.85 + 0.14));
            k.moveTo(0, h * t * 0.85);
            k.lineTo(w * 0.8 * (1 - t * 0.3), h * (t * 0.85 + 0.14));
            k.stroke();
          }
        });
      }
    }

    grime(ctx, S, 0.8, 3, 3, ox + 4, oy + 9);
    return finish(cv, 2.6);
  });
}

/* ─────────── skin ─────────── */

/** Barely anything: a mottle and open pores. Skin that shows its texture
    reads as leather, so this is tuned well under the ±12% house limit. */
export function skinTexture(hex = '#f2cfae', opts = {}) {
  return cached('skin', [hex, opts], () => {
    const S = opts.size || TEX_SIZE;
    const seed = opts.seed ?? 3;
    const [ox, oy] = offsets(seed);
    const rnd = makeRandom(seed);
    const base = linearOf(hex);
    const blush = linearOf(opts.blush || '#e0997f');
    const { cv, ctx } = canvas2d(S);

    const mottleAt = bake(S, 4, 4, 3, ox, oy);
    field(ctx, S, (u, v, out) => {
      const g = mottleAt(u, v);
      const pore = tnoise(u, v, 70, 70, ox, oy);
      mixInto(out, base, blush, clamp(0.12 + g * 0.8, 0, 0.3));
      scale3(out, 1 + g * 0.1 + pore * 0.09);
    });

    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rnd() < 0.7 ? 'rgba(120,80,60,0.07)' : 'rgba(255,246,236,0.08)';
      ctx.fillRect((rnd() * S) | 0, (rnd() * S) | 0, 1, 1);
    }

    return finish(cv, 1.8);
  });
}

/* ─────────── water ─────────── */

/** A ripple normal for the pond. Whole-number wave vectors, so it tiles, and
    the caller can scroll .offset without a seam crawling across the surface. */
export function waterNormal() {
  return cached('waterNormal', [], () => {
    const S = TEX_SIZE;
    const { cv, ctx } = canvas2d(S);
    const waves = [
      [1, 0, 1.0, 0.0], [0, 1, 0.85, 1.7], [2, 1, 0.6, 3.1],
      [1, -2, 0.5, 0.4], [3, 2, 0.32, 2.2], [-2, 3, 0.26, 5.0],
    ];

    const chopAt = bake(S, 14, 14, 2, 0, 0);
    field(ctx, S, (u, v, out) => {
      let h = 0, n = 0;
      for (const [kx, ky, a, ph] of waves) {
        h += a * Math.sin((kx * u + ky * v) * Math.PI * 2 + ph);
        n += a;
      }
      h = h / n * 0.6 + chopAt(u, v) * 1.6;
      const g = clamp(0.5 + h * 0.5, 0, 1);
      out[0] = out[1] = out[2] = g;
    });

    const tex = normalFromCanvas(cv, 1.6);
    // the cache holds the normal itself here; a colour map would be pointless
    return tex;
  });
}

/* ─────────── paper ─────────── */

/** For UI and backdrops: laid paper, warm, with fibre and a few flecks. */
export function paperTexture() {
  return cached('paper', [], () => {
    const S = TEX_SIZE;
    const rnd = makeRandom(404);
    const base = linearOf('#efe7d5');
    const stain = linearOf('#d8caa8');
    const { cv, ctx } = canvas2d(S);
    const stainAt = bake(S, 3, 3, 3, 0, 0);

    field(ctx, S, (u, v, out) => {
      const grain = tnoise(u, v, 90, 90, 11, 7);
      mixInto(out, base, stain, clamp(0.2 + stainAt(u, v) * 1.4, 0, 0.5));
      scale3(out, 1 + grain * 0.1);
    });

    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const len = S * (0.01 + rnd() * 0.05);
      const rot = rnd() * Math.PI * 2;
      const style = rnd() < 0.5 ? 'rgba(255,252,244,0.35)' : 'rgba(150,132,102,0.16)';
      const w = 0.7 + rnd() * 0.6;
      wrapped(ctx, S, rnd() * S, rnd() * S, len, (c) => {
        c.rotate(rot);
        c.strokeStyle = style;
        c.lineWidth = w;
        c.beginPath();
        c.moveTo(-len, 0);
        c.quadraticCurveTo(0, len * 0.12, len, 0);
        c.stroke();
      });
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(120,100,72,0.13)';
      ctx.fillRect((rnd() * S) | 0, (rnd() * S) | 0, 1, 1);
    }

    return finish(cv, 1.2);
  });
}
