/* ═══════════════════════════════════════════════════════════
   Deterministic noise helpers — everything in Healy is grown
   from these numbers, so the world looks the same every visit.
   ═══════════════════════════════════════════════════════════ */

/** Mulberry32 — tiny, fast, seedable PRNG. */
export function makeRandom(seed = 1337) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = new Uint8Array(512);
(function buildPermutation() {
  const rnd = makeRandom(20260726);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

function grad2(hash, x, y) {
  switch (hash & 7) {
    case 0: return  x + y;
    case 1: return  x - y;
    case 2: return -x + y;
    case 3: return -x - y;
    case 4: return  x;
    case 5: return -x;
    case 6: return  y;
    default: return -y;
  }
}

/** Classic 2D Perlin noise, roughly in [-1, 1]. */
export function noise2(x, y) {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);

  const aa = P[P[xi] + yi];
  const ab = P[P[xi] + yi + 1];
  const ba = P[P[xi + 1] + yi];
  const bb = P[P[xi + 1] + yi + 1];

  const x1 = lerp(grad2(aa, xf, yf),     grad2(ba, xf - 1, yf),     u);
  const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v);
}

/** Fractal brownian motion — stacked octaves of Perlin. */
export function fbm(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
