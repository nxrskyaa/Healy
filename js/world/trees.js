import * as THREE from 'three';
import { makeRandom, clamp } from './noise.js';
import { heightAt, normalAt, POND, WATER_LEVEL } from './terrain.js';

/* ═══════════════════════════════════════════════════════════
   Trees. Trunks are tapered tubes swept along a curve;
   canopies are clusters of scalloped clumps, because painted
   foliage reads as sculpted mass, not leaves. Every clump
   takes its own hue from a four-green mosaic, and the whole
   thing is lit with a three-band ramp rather than Lambert —
   that banding is most of what makes it look drawn.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* ───────────── mesh builder ───────────── */

const MeshBuf = () => ({ pos: [], nrm: [], clm: [], hue: [], leaf: [], idx: [], n: 0 });

function pushVert(M, x, y, z, nx, ny, nz, cx, cy, cz, hueV, leaf) {
  M.pos.push(x, y, z); M.nrm.push(nx, ny, nz); M.clm.push(cx, cy, cz);
  M.hue.push(hueV); M.leaf.push(leaf);
  return M.n++;
}

/** tapered tube swept along a polyline */
function addTube(M, pts, radii, seg) {
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let t;
    if (i === 0) t = [pts[1][0] - p[0], pts[1][1] - p[1], pts[1][2] - p[2]];
    else if (i === pts.length - 1) t = [p[0] - pts[i - 1][0], p[1] - pts[i - 1][1], p[2] - pts[i - 1][2]];
    else t = [pts[i + 1][0] - pts[i - 1][0], pts[i + 1][1] - pts[i - 1][1], pts[i + 1][2] - pts[i - 1][2]];
    const L = Math.hypot(t[0], t[1], t[2]) || 1;
    t = [t[0] / L, t[1] / L, t[2] / L];
    let up = [0, 1, 0];
    if (Math.abs(t[1]) > 0.94) up = [1, 0, 0];
    let s = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
    const sl = Math.hypot(s[0], s[1], s[2]) || 1;
    s = [s[0] / sl, s[1] / sl, s[2] / sl];
    const u = [t[1] * s[2] - t[2] * s[1], t[2] * s[0] - t[0] * s[2], t[0] * s[1] - t[1] * s[0]];
    const ring = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // a knuckled, organic trunk, not a lathed dowel
      const wob = 1 + Math.sin(a * 3 + i) * 0.09 + Math.cos(a * 5 - i * 0.7) * 0.05;
      const r = radii[i] * wob;
      const nx = s[0] * ca + u[0] * sa, ny = s[1] * ca + u[1] * sa, nz = s[2] * ca + u[2] * sa;
      ring.push(pushVert(M, p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, p[0], p[1], p[2], 0, 0));
    }
    rings.push(ring);
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % seg], c = rings[i + 1][j], d = rings[i + 1][(j + 1) % seg];
      M.idx.push(a, c, b, b, c, d);
    }
  }
}

/* one shared icosphere, subdivided once */
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const cache = {};
  const mid = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a;
    if (cache[k] !== undefined) return cache[k];
    const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
    const l = Math.hypot(...p);
    v.push([p[0] / l, p[1] / l, p[2] / l]);
    return (cache[k] = v.length - 1);
  };
  const nf = [];
  for (const tr of f) {
    const a = mid(tr[0], tr[1]), b = mid(tr[1], tr[2]), c = mid(tr[2], tr[0]);
    nf.push([tr[0], a, c], [tr[1], b, a], [tr[2], c, b], [a, b, c]);
  }
  return { v, f: nf };
})();

/** a scalloped canopy clump: the icosphere pushed around by sines */
function addClump(M, cx, cy, cz, rx, ry, rz, seed, hueV) {
  const base = M.n;
  const r = makeRandom((seed * 7919) | 0);
  const ph = [r() * 10, r() * 10, r() * 10];
  for (const p of ICO.v) {
    // cauliflower lobes, not a smooth ball
    const d = 1
      + 0.20 * Math.sin(p[0] * 4.1 + ph[0]) * Math.sin(p[1] * 3.7 + ph[1])
      + 0.14 * Math.sin(p[2] * 6.3 + ph[2]) * Math.cos(p[0] * 5.1 + ph[1]);
    pushVert(M, cx + p[0] * rx * d, cy + p[1] * ry * d, cz + p[2] * rz * d,
      p[0], p[1], p[2], cx, cy, cz, hueV, 1);
  }
  for (const f of ICO.f) M.idx.push(base + f[0], base + f[1], base + f[2]);
}

/* ───────────── archetypes ───────────── */

function makeTree(kind, seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = kind === 'poplar' ? 12 + r() * 4 : 9 + r() * 4;
  const lean = (r() - 0.5) * 0.5;

  if (kind === 'poplar') {
    const pts = [], rad = [];
    for (let i = 0; i <= 7; i++) {
      const u = i / 7;
      pts.push([Math.sin(u * 3.0) * 0.5, u * H, Math.cos(u * 2.2) * 0.45]);
      rad.push(H * 0.028 * (1 - u) + H * 0.005 * u);
    }
    addTube(M, pts, rad, 6);
    const n = 9;
    for (let i = 0; i < n; i++) {
      const u = 0.2 + 0.78 * (i / (n - 1));
      const rr = H * (0.17 - 0.08 * Math.abs(u - 0.55) * 1.4);
      addClump(M, Math.sin(u * 7) * 0.5, u * H, Math.cos(u * 6) * 0.45,
        rr * 0.9, rr * 1.35, rr * 0.9, seed + i * 29, 0.2 + r() * 0.7);
    }
  } else {
    // broadleaf: the camphor / oak silhouette
    const pts = [], rad = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push([lean * u * u * H * 0.14 + Math.sin(u * 3.4) * 0.35, u * H * 0.52, Math.cos(u * 2.6) * 0.35]);
      rad.push(H * 0.062 * (1 - u) + H * 0.026 * u);
    }
    addTube(M, pts, rad, 6);
    // a few limbs reaching out of the crown
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + r() * 0.9;
      const bl = H * (0.26 + r() * 0.16);
      const bp = [], br = [];
      for (let j = 0; j <= 3; j++) {
        const u = j / 3;
        bp.push([Math.cos(a) * bl * u * 0.9, H * 0.5 + u * bl * 0.72 - u * u * bl * 0.12, Math.sin(a) * bl * u * 0.9]);
        br.push(H * 0.02 * (1 - u) + H * 0.006 * u);
      }
      addTube(M, bp, br, 4);
    }
    const n = 13;
    const CR = H * 0.4;
    for (let i = 0; i < n; i++) {
      let cx, cy, cz, rr;
      if (i === 0) { cx = 0; cy = H * 0.78; cz = 0; rr = CR * 0.72; }
      else {
        const a = r() * TAU, dd = Math.pow(r(), 0.55) * CR * 1.02;
        cx = Math.cos(a) * dd; cz = Math.sin(a) * dd * 0.92;
        cy = H * 0.74 + (r() - 0.44) * CR * 0.95 - dd * 0.2;
        rr = CR * (0.26 + r() * 0.26);
      }
      addClump(M, cx, cy, cz, rr * 1.12, rr * 0.86, rr * 1.12, seed + i * 53, r());
    }
  }

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M.pos), 3));
  g.setAttribute('nrm', new THREE.BufferAttribute(new Float32Array(M.nrm), 3));
  g.setAttribute('clm', new THREE.BufferAttribute(new Float32Array(M.clm), 3));
  g.setAttribute('hue', new THREE.BufferAttribute(new Float32Array(M.hue), 1));
  g.setAttribute('leaf', new THREE.BufferAttribute(new Float32Array(M.leaf), 1));
  g.setIndex(M.idx);
  g.userData.height = H;
  return g;
}

/* ───────────── shader ───────────── */

const vert = /* glsl */`
precision highp float;

attribute vec3 nrm;
attribute vec3 clm;
attribute float hue;
attribute float leaf;
attribute vec4 iPos;   // xyz root, w scale
attribute vec4 iVar;   // rot, autumn, phase, sway

uniform float uTime;
uniform float uWind;
uniform vec2  uWindDir;
uniform float uTreeH;

varying vec3  vN;
varying vec3  vW;
varying float vHue;
varying float vLeaf;
varying float vAutumn;
varying float vAO;
varying float vDist;

void main() {
  float sc = iPos.w;
  float c = cos(iVar.x), s = sin(iVar.x);
  vec3 lp = position * sc;
  vec3 lc = clm * sc;
  vec3 rp = vec3(lp.x * c - lp.z * s, lp.y, lp.x * s + lp.z * c);
  vec3 rn = vec3(nrm.x * c - nrm.z * s, nrm.y, nrm.x * s + nrm.z * c);
  vec3 rc = vec3(lc.x * c - lc.z * s, lc.y, lc.x * s + lc.z * c);
  float H = uTreeH * sc;

  // the whole tree bends from the root; clumps ride rigidly on that sway,
  // then flutter in their own normals — mass first, chatter second
  float bendK = pow(clamp(rp.y / max(H, 1.0), 0.0, 1.0), 1.6);
  float ph = iVar.z;
  float gust = sin(uTime * 0.8 + ph) * 0.6 + sin(uTime * 1.9 + ph * 1.7) * 0.4;
  vec2 sway = uWindDir * gust * uWind * iVar.w * bendK * H * 0.02;
  rp.xz += sway;

  if (leaf > 0.5) {
    float fl = sin(uTime * 2.6 + ph + rc.x * 1.7 + rc.y * 0.9) * 0.5
             + sin(uTime * 5.1 + ph * 2.3 + rc.z * 2.1) * 0.3;
    rp += rn * fl * uWind * 0.07 * sc;
  }

  // baked AO: canopy verts darken toward the clump's underside and interior
  float inner = leaf > 0.5 ? clamp(0.55 + nrm.y * 0.45, 0.0, 1.0) : 1.0;
  vAO = inner;

  vec3 wp = rp + iPos.xyz;
  vN = rn;
  vW = wp;
  vHue = hue;
  vLeaf = leaf;
  vAutumn = iVar.y;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */`
precision highp float;

varying vec3  vN;
varying vec3  vW;
varying float vHue;
varying float vLeaf;
varying float vAutumn;
varying float vAO;
varying float vDist;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbSky;
uniform vec3  uAmbGround;
uniform float uAmbIntensity;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec3  uCamPos;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1,0)), f.x),
             mix(hash12(i + vec2(0,1)), hash12(i + vec2(1,1)), f.x), f.y);
}

// three-colour ramp; the soft-but-visible banding is the painted look
vec3 ramp3(float t, vec3 shade, vec3 mid, vec3 lit, float soft, float jit) {
  float a = smoothstep(0.30 - soft + jit, 0.30 + soft + jit, t);
  float b = smoothstep(0.62 - soft + jit, 0.62 + soft + jit, t);
  return mix(mix(shade, mid, a), lit, b);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCamPos - vW);
  float ndl = dot(N, uSunDir);
  float wrap = clamp(ndl * 0.55 + 0.48, 0.0, 1.0);

  // painterly wobble of the band edges, in world space — faded with
  // distance, or far canopies shimmer with stripes
  float jit = (vnoise(vW.xz * 2.1 + vW.y * 0.8) - 0.5) * 0.14 / (1.0 + vDist * 0.02);

  vec3 col;
  if (vLeaf > 0.5) {
    // four-green mosaic per clump
    vec3 gShade = vec3(0.033, 0.098, 0.076);
    vec3 gMid   = vec3(0.098, 0.216, 0.086);
    vec3 gLit   = vec3(0.243, 0.404, 0.106);
    vec3 varA   = vec3(0.318, 0.412, 0.063);
    vec3 varB   = vec3(0.145, 0.302, 0.058);
    vec3 varC   = vec3(0.400, 0.463, 0.118);
    vec3 tintM = vHue < 0.33 ? varA : (vHue < 0.66 ? varB : varC);
    gMid = mix(gMid, tintM, 0.45);
    gLit = mix(gLit, tintM * 1.25, 0.4);

    // autumn instances slide the whole ramp toward ochre
    vec3 aShade = vec3(0.161, 0.078, 0.029);
    vec3 aMid   = vec3(0.437, 0.196, 0.043);
    vec3 aLit   = vec3(0.716, 0.416, 0.090);
    gShade = mix(gShade, aShade, vAutumn);
    gMid   = mix(gMid,   aMid,   vAutumn);
    gLit   = mix(gLit,   aLit,   vAutumn);

    col = ramp3(wrap, gShade, gMid, gLit, 0.14, jit);

    // translucency at the rim when the sun is behind the crown
    float back = smoothstep(0.05, 0.85, dot(V, -uSunDir));
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.4);
    col += uSunColor * fres * back * 0.5;
  } else {
    vec3 tShade = vec3(0.075, 0.055, 0.040);
    vec3 tMid   = vec3(0.173, 0.125, 0.086);
    vec3 tLit   = vec3(0.278, 0.192, 0.118);
    col = ramp3(wrap, tShade, tMid, tLit, 0.2, jit);
  }

  col *= uSunColor * 0.85 + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * uAmbIntensity * 0.5;
  col *= mix(0.55, 1.0, vAO);

  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}
`;

/* ───────────── the forest ───────────── */

function goodSpot(x, z) {
  const d = Math.hypot(x, z);
  if (d < 15 || d > 138) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.15) return false;
  const h = heightAt(x, z);
  if (h < WATER_LEVEL + 0.6) return false;
  if (normalAt(x, z, 1.2).y < 0.72) return false;
  const path = Math.abs(z + 4 - Math.sin(x * 0.06) * 6 - x * 0.42);
  if (path < 5 && d < 70) return false;
  // keep the railway corridor clear
  if (z < -62 && z > -112) return false;
  return true;
}

export class Forest {
  constructor(scene) {
    this.materials = [];
    const rnd = makeRandom(1123);

    const archetypes = [
      { geo: makeTree('broadleaf', 11), n: 72, sway: 0.6 },
      { geo: makeTree('broadleaf', 47), n: 62, sway: 0.6 },
      { geo: makeTree('poplar', 89),    n: 26, sway: 1.0 },
    ];

    for (const arch of archetypes) {
      const iPos = new Float32Array(arch.n * 4);
      const iVar = new Float32Array(arch.n * 4);
      let placed = 0, guard = 0;
      while (placed < arch.n && guard < arch.n * 60) {
        guard++;
        const a = rnd() * TAU;
        const r = 15 + Math.sqrt(rnd()) * 110;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (!goodSpot(x, z)) continue;
        const sc = 0.6 + rnd() * 0.7 + (r > 85 ? 0.2 : 0);
        iPos[placed * 4] = x;
        iPos[placed * 4 + 1] = heightAt(x, z) - 0.25;
        iPos[placed * 4 + 2] = z;
        iPos[placed * 4 + 3] = sc;
        iVar[placed * 4] = rnd() * TAU;
        iVar[placed * 4 + 1] = rnd() < 0.16 ? 0.65 + rnd() * 0.35 : 0.0;   // autumn
        iVar[placed * 4 + 2] = rnd() * 10;
        iVar[placed * 4 + 3] = arch.sway * (0.7 + rnd() * 0.6);
        placed++;
      }

      const geo = arch.geo;
      geo.instanceCount = placed;
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
      geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(iVar, 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

      const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: 0.5 },
          uWindDir: { value: new THREE.Vector2(0.86, 0.51).normalize() },
          uTreeH: { value: geo.userData.height },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color(1, 1, 1) },
          uAmbSky: { value: new THREE.Color(0.6, 0.75, 0.9) },
          uAmbGround: { value: new THREE.Color(0.4, 0.36, 0.24) },
          uAmbIntensity: { value: 1 },
          uFogColor: { value: new THREE.Color(0.85, 0.9, 0.92) },
          uFogDensity: { value: 0.007 },
          uCamPos: { value: new THREE.Vector3() },
        },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.materials.push(mat);
    }

    // one great tree presiding over the meadow's west side
    const great = makeTree('broadleaf', 777);
    const gPos = new Float32Array([-26, heightAt(-26, 20) - 0.4, 20, 2.6]);
    const gVar = new Float32Array([0.8, 0, 3.1, 0.4]);
    great.instanceCount = 1;
    great.setAttribute('iPos', new THREE.InstancedBufferAttribute(gPos, 4));
    great.setAttribute('iVar', new THREE.InstancedBufferAttribute(gVar, 4));
    great.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const gm = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: THREE.UniformsUtils.clone(this.materials[0].uniforms),
    });
    gm.uniforms.uTreeH.value = great.userData.height;
    const gMesh = new THREE.Mesh(great, gm);
    gMesh.frustumCulled = false;
    scene.add(gMesh);
    this.materials.push(gm);
  }

  update(t, camera, sky, wind, rain) {
    for (const m of this.materials) {
      const u = m.uniforms;
      u.uTime.value = t;
      u.uWind.value = wind;
      u.uSunDir.value.copy(sky.sunUp > 0.02 ? sky.sunDir : sky.moonDir);
      u.uSunColor.value.copy(sky.sun.color).multiplyScalar(clamp(sky.sun.intensity, 0, 2) * 0.6 + 0.25);
      u.uAmbSky.value.copy(sky.ambient.color);
      u.uAmbGround.value.copy(sky.ambient.groundColor);
      u.uAmbIntensity.value = sky.ambient.intensity;
      u.uFogColor.value.copy(sky.scene.fog.color);
      u.uFogDensity.value = sky.scene.fog.density;
      u.uCamPos.value.copy(camera.position);
    }
  }
}
