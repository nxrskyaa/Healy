import * as THREE from 'three';
import { makeRandom, fbm, smoothstep, clamp } from './noise.js';
import { heightAt, WORLD_SIZE, POND, WATER_LEVEL } from './terrain.js';

/* ═══════════════════════════════════════════════════════════
   The grass sea.

   Three overlapping rings carry blades from underfoot to the
   far ridge. They exist only to switch tessellation and blade
   thickness — density itself is one continuous law:

       blades/m²(d) = B · min(1, (dn/d)^1.5)

   with B·dn^1.5 held constant between rings, so there is no
   density step anywhere. The exponent is 1.5 exactly because
   the shader can then evaluate it as x·x·inversesqrt(x) — three
   instructions instead of a ten-cycle pow, on every one of
   half a million blades, every frame.

   Every blade is a quadratic Bézier whose tip is solved for the
   balance of stiffness, gravity and wind. Its width is floored
   to an angular size, so distant grass thins in count but never
   in coverage, and never shimmers.
   ═══════════════════════════════════════════════════════════ */

/* ───────────── terrain lookup textures ─────────────
   R = height   G = grass mask   B = steepness   A = tint noise   */

export function buildTerrainTexture(size, span) {
  const half = span / 2;
  const step = span / size;
  const H = new Float32Array(size * size);
  const worldEdge = WORLD_SIZE / 2;

  for (let j = 0; j < size; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      H[j * size + i] = heightAt(-half + (i + 0.5) * step, z);
    }
  }

  const data = new Float32Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    const z = -half + (j + 0.5) * step;
    for (let i = 0; i < size; i++) {
      const x = -half + (i + 0.5) * step;
      const k = j * size + i;
      const h = H[k];

      const il = Math.max(0, i - 1), ir = Math.min(size - 1, i + 1);
      const jd = Math.max(0, j - 1), ju = Math.min(size - 1, j + 1);
      const dx = (H[j * size + ir] - H[j * size + il]) / ((ir - il) * step);
      const dz = (H[ju * size + i] - H[jd * size + i]) / ((ju - jd) * step);
      const ny = 1 / Math.sqrt(1 + dx * dx + dz * dz);

      let mask = smoothstep(WATER_LEVEL + 0.15, WATER_LEVEL + 1.1, h);
      mask *= smoothstep(0.5, 0.8, ny);

      const pd = Math.hypot(x - POND.x, z - POND.z);
      mask *= smoothstep(POND.r * 0.96, POND.r * 1.16, pd);

      // the footpath is worn bare
      const path = Math.abs(z + 4 - Math.sin(x * 0.06) * 6 - x * 0.42);
      const d = Math.hypot(x, z);
      mask *= 1 - smoothstep(3.4, 1.0, path) * smoothstep(72, 12, d) * 0.92;

      // ragged, noisy fade at the world's edge instead of a clean circle
      const ragged = worldEdge * (0.9 + fbm(x * 0.006, z * 0.006, 2) * 0.22);
      mask *= 1 - smoothstep(ragged * 0.82, ragged, d);

      // the sampler clamps at the border, so the outermost texels repeat
      // forever past the span — they must carry no grass at all, or the
      // horizon grows a solid hedge of the last texel's blades
      const border = (i < 2 || j < 2 || i >= size - 2 || j >= size - 2) ? 0 : 1;

      data[k * 4] = h;
      data[k * 4 + 1] = clamp(mask, 0, 1) * border;
      data[k * 4 + 2] = 1 - ny;
      data[k * 4 + 3] = fbm(x * 0.035, z * 0.035, 3) * 0.5 + 0.5;
    }
  }

  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

/* ───────────── blade geometry ─────────────
   A ladder of quads, `segments` tall. x is across the blade
   (-0.5 … 0.5), y is the parameter along it (0 … 1). */

function bladeGeometry(segments) {
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // taper: full width at the base, drawn to a point at the tip
    const w = 0.5 * (1 - t * t * 0.5) * (1 - smoothstep(0.78, 1.0, t));
    pos.push(-w, t, 0, w, t, 0);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/* ───────────── shared GLSL ───────────── */

const GL_NOISE = /* glsl */`
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm2(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    p *= 2.03; a *= 0.5;
  }
  return s;
}
`;

/* Cloud shadows. The real thing would bake a coverage map from the sky's
   cumulus field; two octaves of warped noise, projected along the sun, is
   two instructions' worth of the same idea and reads identically on grass. */
const GL_CLOUD = /* glsl */`
uniform vec2  uCloudDrift;
uniform float uCloudAmount;
uniform vec3  uSunDir;
float cloudShadow(vec3 wp) {
  float t = (240.0 - wp.y) / max(uSunDir.y, 0.14);
  vec2 q = (wp.xz + uSunDir.xz * t - uCloudDrift) * 0.0055;
  vec2 w = vec2(fbm2(q * 1.6 + 11.3, 2), fbm2(q * 1.6 + 37.1, 2));
  float f = fbm2(q + w * 0.7, 3);
  float c = smoothstep(0.36, 0.62, f) * uCloudAmount;
  return 1.0 - 0.52 * c;
}
`;

const vert = /* glsl */`
precision highp float;

attribute vec2  aCell;
attribute vec4  aRand;

uniform sampler2D uMap;
uniform float uMapSize;
uniform float uMapSpan;
uniform vec3  uCenter;
uniform float uRadius;
uniform float uTime;
uniform float uWind;
uniform float uRain;
uniform vec2  uWindDir;
uniform vec4  uLod;      // near, nearFade, far, farFade
uniform vec3  uLodB;     // angular width floor, height scale, density distance
uniform vec3  uCull;     // flattened view direction xy, cosine of the view cone

varying vec3  vColor;
varying vec3  vNormal;
varying vec3  vWorld;
varying float vDist;
varying float vT;
varying float vBend;
varying float vShadow;

${GL_NOISE}
${GL_CLOUD}

void degenerate() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }

vec4 terrain(vec2 xz) {
  vec2 uvp = (xz + uMapSpan * 0.5) / uMapSpan;
  vec2 t = uvp * uMapSize - 0.5;
  vec2 f = fract(t);
  vec2 b = (floor(t) + 0.5) / uMapSize;
  float e = 1.0 / uMapSize;
  vec4 s00 = texture2D(uMap, b);
  vec4 s10 = texture2D(uMap, b + vec2(e, 0.0));
  vec4 s01 = texture2D(uMap, b + vec2(0.0, e));
  vec4 s11 = texture2D(uMap, b + vec2(e, e));
  return mix(mix(s00, s10, f.x), mix(s01, s11, f.x), f.y);
}

// slow directional flow, cross currents, and gust fronts that sweep past
vec3 windAt(vec2 p) {
  float a = sin(dot(p, vec2(0.071, 0.049)) - uTime * 1.05);
  float b = sin(dot(p, vec2(-0.043, 0.088)) - uTime * 0.71 + 1.7);
  float c = sin(dot(p, vec2(0.19, 0.13)) - uTime * 2.15 + 3.1);
  float field = a * 0.5 + b * 0.33 + c * 0.17;

  vec2 q = p - uWindDir * uTime * 9.0;
  float front = fbm2(q * 0.012, 3) * 2.0 - 0.6;
  float gust = clamp(0.35 + front * 1.15, 0.0, 1.7);

  return vec3(field, gust, front);
}

void main() {
  float R = uRadius;
  vec2 root;
  root.x = uCenter.x + mod(aCell.x - uCenter.x + R, R * 2.0) - R;
  root.y = uCenter.z + mod(aCell.y - uCenter.z + R, R * 2.0) - R;

  vec2 toB = root - uCenter.xz;
  float d2 = dot(toB, toB);
  float invD = inversesqrt(max(d2, 1e-4));
  float dist = d2 * invD;

  /* Lateral view-cone rejection, five instructions and no memory access, as
     the very first thing the shader does. The wrap box is centred on the
     camera, so well over half of every ring is behind your head. uCull.xy is
     the view direction flattened onto the ground and uCull.z the cosine of
     the widest frustum corner, padded for blade width and wind lean. Blades
     within a few metres are exempt: at that range a blade's own width
     subtends more than the pad. */
  if (d2 > 25.0 && dot(toB, uCull.xy) * invD < uCull.z) { degenerate(); return; }

  // ── overlapping ring fades: blades grow in and shrink out, never pop ──
  float fadeIn  = uLod.x <= 0.01 ? 1.0 : smoothstep(uLod.x - uLod.y, uLod.x + uLod.y, dist);
  float fadeOut = uLod.z <= 0.0  ? 1.0 : 1.0 - smoothstep(uLod.z - uLod.w, uLod.z, dist);
  float fade = fadeIn * fadeOut;
  if (fade < 0.006) { degenerate(); return; }

  // ── the density law, resolved per blade ──
  // (dn/d)^1.5 as x·x·inversesqrt(x)
  float xr = min(uLodB.z / max(dist, uLodB.z), 1.0);
  float keep = xr * xr * inversesqrt(max(xr, 1e-6));
  float need = aRand.x;
  if (need > keep) { degenerate(); return; }

  vec4 T = terrain(root);
  float ground = T.r;
  float mask = T.g;
  float tint = T.a;
  if (mask < 0.04) { degenerate(); return; }

  // The last fifth of the acceptance window is a growth ramp rather than a
  // hard gate: a blade rises out of the sward instead of popping into it,
  // and a field of popping blades is most of what reads as shimmer.
  float thr = keep * (0.74 + 0.26 * mask);
  float grow = clamp((thr - need) / max(thr * 0.24, 1e-5), 0.0, 1.0);
  if (grow <= 0.004) { degenerate(); return; }
  fade *= grow;

  /* ── the blade ──
     A wild hay meadow, not a lawn: height clusters at two scales, metre-wide
     tussocks sitting inside decametre swales. Without this the sward is an
     even pile and reads as mown turf however dense it gets.

     The three factors below MULTIPLY, which is how the old numbers ran away:
     0.92 × 1.48 × 1.28 put the tallest near blades at 1.74 m, against a figure
     who stands 1.6 m. The meadow was over her shoulders and every sense of
     scale in the valley went with it. Retuned so the typical blade is about
     shin height and the rankest tussock reaches a little over the knee. */
  float clumpA = vnoise(root * 0.85);             // ~1.2 m tussocks
  float clumpB = tint;                            // ~29 m swales
  float hgt = (0.155 + aRand.y * aRand.y * 0.295) * mix(0.62, 1.0, mask) * uLodB.y * fade;
  hgt *= 0.70 + 0.55 * clumpB;                    // ×1.25 at worst
  hgt *= 0.82 + 0.34 * clumpA;                    // ×1.16 at worst
  if (hgt < 0.02) { degenerate(); return; }

  float wid = (0.011 + aRand.z * 0.010) * (0.85 + 0.35 * clumpA);
  // angular floor — a blade is never allowed to fall below about a pixel
  wid = max(wid, dist * uLodB.x);

  float stiff = 0.5 + aRand.z * 0.5;

  float orient = aRand.w * 6.2831853 + tint * 2.4;
  vec3 axis = vec3(cos(orient), 0.0, sin(orient));
  // at distance, swing the blade to face the eye so it can never vanish edge-on
  vec3 toCam = normalize(vec3(-toB.x, 0.0, -toB.y) + vec3(1e-5));
  axis = normalize(mix(axis, normalize(cross(vec3(0.0, 1.0, 0.0), toCam)),
                       smoothstep(14.0, 70.0, dist) * 0.9));

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 side = normalize(cross(up, axis) + vec3(1e-6));
  vec3 front = normalize(cross(side, up));

  vec3 p0 = vec3(root.x, ground - 0.03, root.y);
  // the blade already arcs over under its own weight, before any wind
  vec3 tip = p0 + up * hgt * 0.94 + front * hgt * (0.18 + aRand.y * 0.4);

  vec3 W = windAt(root);
  float strength = uWind * (0.25 + W.y * 0.8) * (0.6 + 0.4 * W.x) + uRain * 0.3;
  vec2 wdir = normalize(uWindDir + vec2(W.x, -W.x) * 0.4);
  vec3 wind3 = vec3(wdir.x, 0.0, wdir.y) * strength;

  // quasi-static balance of stiffness against wind and gravity
  vec3 gravity = vec3(0.0, -1.0, 0.0) * (0.12 + 0.1 * aRand.y);
  vec3 push = wind3 * (0.35 + 0.75 * hgt);
  tip += (gravity + push) / max(stiff, 0.2);

  // ringing: a gust front leaves the blade quivering at its own frequency
  float osc = sin(uTime * (9.0 + aRand.z * 7.0) + aRand.x * 31.0);
  tip += vec3(wdir.x, 0.0, wdir.y) * osc * hgt * 0.035 * (0.3 + W.y * 0.7);
  tip += side * sin(uTime * 6.4 * (0.7 + aRand.z) + aRand.w * 19.0) * hgt * 0.022;

  // quadratic Bézier: the control point keeps the base planted and vertical
  float t = position.y;
  vec3 ctrl = p0 + up * hgt * 0.55;
  float mt = 1.0 - t;
  vec3 spine = mt * mt * p0 + 2.0 * mt * t * ctrl + t * t * tip;
  vec3 tangent = normalize(2.0 * mt * (ctrl - p0) + 2.0 * t * (tip - ctrl) + vec3(1e-6));

  vec3 p = spine + side * position.x * wid * 2.0;

  // ── painterly base colour, resolved here so the fragment stage stays cheap ──
  vec3 deep  = vec3(0.055, 0.130, 0.108);
  vec3 low   = vec3(0.130, 0.275, 0.150);
  vec3 mid   = vec3(0.290, 0.455, 0.180);
  vec3 upper = vec3(0.470, 0.605, 0.216);
  vec3 tipc  = vec3(0.663, 0.729, 0.310);
  vec3 dry   = vec3(0.706, 0.620, 0.298);

  float s1 = smoothstep(0.0, 0.42, t);
  float s2 = smoothstep(0.30, 0.78, t);
  float s3 = smoothstep(0.62, 1.0, t);
  vec3 col = mix(deep, low, s1);
  col = mix(col, mid, s2);
  col = mix(col, mix(upper, tipc, s3), s3);
  // dry, seeding heads on the swale shoulders
  float dryness = smoothstep(0.5, 0.95, tint) * 0.55 + smoothstep(0.62, 1.0, clumpA) * 0.3;
  col = mix(col, dry, clamp(dryness, 0.0, 0.85) * smoothstep(0.25, 1.0, t));

  // broad patches of cooler and warmer grass — a meadow never settles on one
  // green. Warm on both ends: the cool patches go deep, not minty.
  col *= mix(vec3(0.84, 1.0, 0.86), vec3(1.2, 1.02, 0.68), tint);
  col *= mix(vec3(0.93, 1.0, 0.94), vec3(1.06, 1.0, 0.9), clumpA);
  col *= 0.76 + aRand.z * 0.46;

  // occlusion down in the sward, which is what sells the density
  col *= mix(0.24, 1.0, smoothstep(0.0, 0.7, t));
  col = mix(col, col * vec3(0.6, 0.7, 0.72), uRain * 0.5);

  vColor = col;
  vNormal = normalize(cross(tangent, side));
  vWorld = p;
  vT = t;
  vBend = clamp(length(tip - p0 - up * hgt) / max(hgt, 0.01), 0.0, 1.0);
  vShadow = cloudShadow(p);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */`
precision highp float;

varying vec3  vColor;
varying vec3  vNormal;
varying vec3  vWorld;
varying float vDist;
varying float vT;
varying float vBend;
varying float vShadow;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbSky;
uniform vec3  uAmbGround;
uniform float uAmbIntensity;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec3  uCamPos;
uniform vec3  uTransCol;

uniform sampler2D uShadowMap;
uniform mat4  uShadowMat;
uniform vec2  uShadowTexel;
uniform float uShadowOn;

/* Three packs shadow depth into RGBA rather than using a depth texture, so
   reading its shadow map by hand means unpacking it the same way its own
   shaders do. Getting this wrong is silent: you just get a meadow that is
   uniformly lit, which is exactly what it was before. */
float unpackRGBAToDepth(vec4 v) {
  const vec4 F = vec4(255.0 / 256.0) / vec4(16777216.0, 65536.0, 256.0, 1.0);
  return dot(v, F);
}

/* The grass does not CAST into the shadow map — a million blades in the depth
   pass would cost more than the whole rest of the frame — but it very much
   needs to RECEIVE. Without this, trees and buildings float on an evenly lit
   lawn and nothing in the valley feels like it is standing on the ground. */
float sunShadow(vec3 wp, vec3 n) {
  if (uShadowOn < 0.5) return 1.0;
  vec4 sc = uShadowMat * vec4(wp + n * 0.05, 1.0);
  sc.xyz /= sc.w;
  if (sc.z > 1.0) return 1.0;
  vec2 e = abs(sc.xy - 0.5);
  float edge = max(e.x, e.y);
  if (edge > 0.5) return 1.0;

  float z = sc.z - 0.0018;
  vec2 ts = uShadowTexel;
  float s =
      step(z, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2( ts.x,  ts.y))))
    + step(z, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(-ts.x,  ts.y))))
    + step(z, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2( ts.x, -ts.y))))
    + step(z, unpackRGBAToDepth(texture2D(uShadowMap, sc.xy + vec2(-ts.x, -ts.y))));
  // dissolve the boundary of the shadow camera instead of ending it in a line
  return mix(1.0, s * 0.25, 1.0 - smoothstep(0.4, 0.5, edge));
}

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  // a blade is a sheet: whichever face we see, it faces us
  if (dot(N, V) < 0.0) N = -N;

  // cloud shadow and cast shadow are the same currency to everything below
  float lit = vShadow * mix(0.42, 1.0, sunShadow(vWorld, N));

  float ndl = dot(N, uSunDir);
  // Half-lambert. A low sun grazes upright grass; plain Lambert would drop the
  // whole meadow into shade and golden hour would read as dusk.
  float wrap = clamp(ndl * 0.6 + 0.46, 0.0, 1.0) * mix(0.62, 1.0, lit);

  vec3 col = vColor * (uSunColor * wrap + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * uAmbIntensity * 0.45);

  // subsurface transmission: light coming THROUGH the blade, strongest when
  // the blade is edge-on to the sun and we are looking into it
  float toward = pow(clamp(dot(V, -uSunDir), 0.0, 1.0), 3.0);
  float thin = pow(clamp(1.0 - abs(ndl), 0.0, 1.0), 2.0);
  col += uTransCol * uSunColor * toward * thin * vT * 0.55 * lit;

  // backlight rim along the bent-over tips — the connective tissue of the image
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  col += uSunColor * fres * toward * (0.25 + vBend * 0.5) * 0.5 * lit;

  // sky bounce on the tips
  col += uAmbSky * vColor * vT * vT * 0.2 * uAmbIntensity;

  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ───────────── the field ───────────── */

// B·dn^1.5 is held constant across rings so density is continuous.
/* `wpx` is the minimum width a blade of this ring is allowed to have ON SCREEN,
   in pixels. It is converted to a world-space slope against the real viewport
   every resize. Getting this wrong is what makes distant grass shatter: below
   about a pixel and a half a blade stops being a shape and becomes a stochastic
   sliver that flickers on and off as the camera moves. */
const RINGS = [
  { radius:  20, count: 240000, segments: 4, dn:  8, hs: 1.00, wpx: 1.9 }, // 150/m²
  { radius:  72, count: 420000, segments: 3, dn: 30, hs: 1.15, wpx: 2.7 }, //  20/m²
  { radius: 160, count: 340000, segments: 2, dn: 70, hs: 1.50, wpx: 4.4 }, // 3.3/m²
];

/* A sampler uniform must point at something real from the first compile —
   the shadow map does not exist until the renderer has drawn one frame. */
const WHITE_1PX = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE_1PX.needsUpdate = true;

const LOW_RINGS = [
  { radius:  18, count:  70000, segments: 3, dn:  7, hs: 1.00, wpx: 2.2 },
  { radius:  62, count: 110000, segments: 2, dn: 22, hs: 1.20, wpx: 3.2 },
  { radius: 140, count:  90000, segments: 2, dn: 60, hs: 1.55, wpx: 5.0 },
];

export class GrassField {
  constructor(scene, { lowEnd = false, mapSize = 512, mapSpan = 340 } = {}) {
    this.map = buildTerrainTexture(mapSize, mapSpan);
    this.rings = [];
    this.materials = [];
    this.cloudDrift = new THREE.Vector2();

    this.specs = lowEnd ? LOW_RINGS : RINGS;
    const specs = this.specs;
    const rnd = makeRandom(13579);

    specs.forEach((spec, i) => {
      const base = bladeGeometry(spec.segments);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setIndex(base.index);
      geo.setAttribute('position', base.attributes.position);
      geo.instanceCount = spec.count;

      // stratified placement: a jittered grid covers the box far more evenly
      // than pure random, which clumps and leaves bald patches
      const side = Math.ceil(Math.sqrt(spec.count));
      const cell = (spec.radius * 2) / side;
      const cells = new Float32Array(spec.count * 2);
      const rand = new Float32Array(spec.count * 4);
      for (let k = 0; k < spec.count; k++) {
        cells[k * 2] = -spec.radius + ((k % side) + rnd()) * cell;
        cells[k * 2 + 1] = -spec.radius + (((k / side) | 0) + rnd()) * cell;
        rand[k * 4] = rnd();
        rand[k * 4 + 1] = rnd();
        rand[k * 4 + 2] = rnd();
        rand[k * 4 + 3] = rnd();
      }
      geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
      geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rand, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const near = i === 0 ? 0 : specs[i - 1].radius * 0.72;
      const far = i === specs.length - 1 ? 0 : spec.radius * 0.98;

      const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        side: THREE.DoubleSide,
        uniforms: {
          uMap: { value: this.map },
          uMapSize: { value: mapSize },
          uMapSpan: { value: mapSpan },
          uCenter: { value: new THREE.Vector3() },
          uRadius: { value: spec.radius },
          uTime: { value: 0 },
          uWind: { value: 0.5 },
          uRain: { value: 0 },
          uWindDir: { value: new THREE.Vector2(0.86, 0.51).normalize() },
          uLod: { value: new THREE.Vector4(near, near * 0.35 + 0.01, far, far * 0.18 + 0.01) },
          uLodB: { value: new THREE.Vector3(spec.wpx * 0.0011, spec.hs, spec.dn) },
          uCull: { value: new THREE.Vector3(0, 1, -1) },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uAmbSky: { value: new THREE.Color(0.62, 0.78, 0.9) },
          uAmbGround: { value: new THREE.Color(0.42, 0.38, 0.25) },
          uAmbIntensity: { value: 1 },
          uFogColor: { value: new THREE.Color(0.85, 0.9, 0.92) },
          uFogDensity: { value: 0.007 },
          uCamPos: { value: new THREE.Vector3() },
          uTransCol: { value: new THREE.Color('#c9de6e') },
          uShadowMap: { value: WHITE_1PX },
          uShadowMat: { value: new THREE.Matrix4() },
          uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
          uShadowOn: { value: 0 },
          uCloudDrift: { value: this.cloudDrift },
          uCloudAmount: { value: 0.75 },
        },
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.name = `grassRing${i}`;
      mesh.renderOrder = 1;
      scene.add(mesh);

      this.rings.push(mesh);
      this.materials.push(mat);
    });
  }

  /**
   * Convert each ring's pixel-width floor into a world-space slope for the
   * actual viewport: one pixel subtends 2·tan(fov/2)/height radians, so a blade
   * at distance d needs `wpx · that · d` metres of width to hold its ground.
   */
  setViewport(fovDeg, heightPx) {
    const perPixel = (2 * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, heightPx);
    this.specs.forEach((spec, i) => {
      this.materials[i].uniforms.uLodB.value.x = spec.wpx * perPixel;
    });
  }

  update(t, camera, sky, wind, rain) {
    this.cloudDrift.set(t * 3.4, t * 1.9);

    // View cone, measured from the real camera each frame: the flattened look
    // direction, and the cosine of the half-angle to the widest frustum corner
    // with a pad for blade width and wind lean.
    camera.getWorldDirection(this._fwd || (this._fwd = new THREE.Vector3()));
    const fx = this._fwd.x, fz = this._fwd.z;
    const flat = Math.hypot(fx, fz) || 1e-5;
    const vFov = (camera.fov * Math.PI) / 180;
    const halfDiag = Math.atan(Math.tan(vFov / 2) * Math.hypot(1, camera.aspect));
    // pitch tilts the cone's ground projection open, so widen by it too
    const pitch = Math.asin(clamp(-this._fwd.y, -1, 1));
    const cosCone = Math.cos(Math.min(Math.PI * 0.98, halfDiag + Math.abs(pitch) + 0.28));

    for (const m of this.materials) {
      const u = m.uniforms;
      u.uTime.value = t;
      u.uWind.value = wind;
      u.uRain.value = rain;
      u.uCenter.value.copy(camera.position);
      u.uCamPos.value.copy(camera.position);
      u.uSunDir.value.copy(sky.sunUp > 0.02 ? sky.sunDir : sky.moonDir);
      u.uSunColor.value.copy(sky.sun.color).multiplyScalar(sky.sun.intensity * 0.62);
      u.uAmbSky.value.copy(sky.ambient.color);
      u.uAmbGround.value.copy(sky.ambient.groundColor);
      u.uAmbIntensity.value = sky.ambient.intensity * 0.85;
      u.uFogColor.value.copy(sky.scene.fog.color);
      u.uFogDensity.value = sky.scene.fog.density;
      u.uCull.value.set(fx / flat, fz / flat, cosCone);
      u.uCloudAmount.value = 0.55 + rain * 0.4;

      // the sun's shadow map, borrowed from the light three already renders
      const sh = sky.sun.shadow;
      if (sh && sh.map && sh.map.texture) {
        u.uShadowMap.value = sh.map.texture;
        u.uShadowMat.value.copy(sh.matrix);
        u.uShadowTexel.value.set(1 / sh.mapSize.x, 1 / sh.mapSize.y);
        u.uShadowOn.value = sky.sunUp > 0.03 ? 1 : 0;
      } else {
        u.uShadowOn.value = 0;
      }
      u.uTransCol.value.setRGB(0.79, 0.87, 0.43).multiplyScalar(1 - rain * 0.4);
    }
  }
}
