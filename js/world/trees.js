import * as THREE from 'three';
import { makeRandom, clamp } from './noise.js';
import { heightAt, normalAt, POND, WATER_LEVEL } from './terrain.js';
import { barkTexture, foliageTexture } from './textures.js';
import { enableInstancedShadows } from './env.js';

/* ═══════════════════════════════════════════════════════════
   The valley's trees. Seven Balinese archetypes — broadleaf,
   flame, cemara, coconut, banana, frangipani and banyan — each
   one instanced geometry carrying its own bark and foliage
   maps. Trunks get real UVs so the bark runs along their
   length instead of smearing; canopies get a triplanar leaf
   normal, because a seam through a blob is worse than no
   detail at all. The three-band ramp survives on top of it
   all: that banding is still most of what makes it look drawn.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

/* Vertex classes. The fragment shader branches on these, and the vertex
   shader gives each its own wind: mass sways, blades hinge. */
const K_BARK = 0;
const K_CANOPY = 1;
const K_BLADE = 2;
const K_BLOOM = 3;

/* ───────────── little vector helpers ───────────── */

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* ───────────── mesh builder ───────────── */

const MeshBuf = () => ({
  pos: [], nrm: [], uv: [], clm: [], aux: [], idx: [], n: 0,
  kind: K_BARK, hue: 0, piv: [0, 0, 0],
});

/**
 * Everything pushed after this belongs to one part. The pivot is load
 * bearing: fronds rotate about it in the vertex shader, so it has to be the
 * point the leaf actually hinges on, not the tree's origin.
 */
function part(M, kind, hue, px, py, pz) {
  M.kind = kind; M.hue = hue;
  M.piv[0] = px; M.piv[1] = py; M.piv[2] = pz;
}

function vertex(M, x, y, z, nx, ny, nz, u, v, flut, ao) {
  M.pos.push(x, y, z);
  M.nrm.push(nx, ny, nz);
  M.uv.push(u, v);
  M.clm.push(M.piv[0], M.piv[1], M.piv[2]);
  M.aux.push(M.hue, M.kind, flut, ao);
  return M.n++;
}

function finishGeo(M, H) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M.pos), 3));
  g.setAttribute('nrm', new THREE.BufferAttribute(new Float32Array(M.nrm), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(M.uv), 2));
  g.setAttribute('clm', new THREE.BufferAttribute(new Float32Array(M.clm), 3));
  g.setAttribute('aux', new THREE.BufferAttribute(new Float32Array(M.aux), 4));
  g.setIndex(M.idx);
  g.userData.height = H;
  return g;
}

/* ───────────── primitives ───────────── */

/**
 * Tapered tube swept along a polyline. Each ring carries seg+1 vertices —
 * the duplicate closes the UV wrap, and without it the bark mirrors back on
 * itself down one side of every trunk.
 *
 * barkTexture stretches its ridges along v, so v runs up the trunk in metres
 * and u round the girth. That is the whole reason the bark reads as bark.
 */
function addTube(M, pts, radii, seg, o = {}) {
  const vScale = o.vScale === undefined ? 0.62 : o.vScale;
  const aoA = o.aoA === undefined ? 0.62 : o.aoA;
  const aoB = o.aoB === undefined ? 1.0 : o.aoB;
  const flutA = o.flutA === undefined ? 0 : o.flutA;
  const flutB = o.flutB === undefined ? 0 : o.flutB;
  const wob = o.wob === undefined ? 1 : o.wob;

  let rMax = 0;
  for (let i = 0; i < radii.length; i++) rMax = Math.max(rMax, radii[i]);
  // an integer count of repeats round the trunk, or the seam tears
  const uRep = Math.max(1, Math.round(TAU * rMax * 0.8));

  const rings = [];
  let run = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    let t;
    if (i === 0) t = sub3(pts[1], p);
    else if (i === pts.length - 1) t = sub3(p, pts[i - 1]);
    else t = sub3(pts[i + 1], pts[i - 1]);
    t = norm3(t);
    if (i > 0) run += dist3(p, pts[i - 1]);

    const up = Math.abs(t[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
    const s = norm3(cross3(t, up));
    const b = cross3(t, s);

    const k = i / (pts.length - 1);
    const ao = aoA + (aoB - aoA) * k;
    const fl = flutA + (flutB - flutA) * k;

    const ring = [];
    for (let j = 0; j <= seg; j++) {
      const a = ((j % seg) / seg) * TAU;
      const ca = Math.cos(a), sa = Math.sin(a);
      // a knuckled, organic trunk, not a lathed dowel
      const wb = 1 + (Math.sin(a * 3 + i) * 0.09 + Math.cos(a * 5 - i * 0.7) * 0.05) * wob;
      const rr = radii[i] * wb;
      const nx = s[0] * ca + b[0] * sa;
      const ny = s[1] * ca + b[1] * sa;
      const nz = s[2] * ca + b[2] * sa;
      ring.push(vertex(M, p[0] + nx * rr, p[1] + ny * rr, p[2] + nz * rr,
        nx, ny, nz, (j / seg) * uRep, run * vScale, fl, ao));
    }
    rings.push(ring);
  }

  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = rings[i][j], b2 = rings[i][j + 1];
      const c = rings[i + 1][j], d = rings[i + 1][j + 1];
      /* Wind these OUTWARD. The previous order made the front face the inside
         of the tube, and since the material is DoubleSide nothing was culled
         — instead the fragment shader's back-facing flip inverted the normal
         on every trunk, branch, aerial root and pseudostem in the forest, so
         the woody parts were lit from the opposite side to their own leaves. */
      M.idx.push(a, b2, c, b2, d, c);
    }
  }
}

/* Two icosphere resolutions. The coarse one is for blossom, coconuts and
   spear buds, where eighty triangles would be a waste of a millimetre. */
function icosphere(sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
    [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const cache = {};
  const mid = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a;
    if (cache[k] !== undefined) return cache[k];
    const p = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
    const l = Math.hypot(p[0], p[1], p[2]);
    v.push([p[0] / l, p[1] / l, p[2] / l]);
    return (cache[k] = v.length - 1);
  };
  for (let s = 0; s < sub; s++) {
    const nf = [];
    for (const tr of f) {
      const a = mid(tr[0], tr[1]), b = mid(tr[1], tr[2]), c = mid(tr[2], tr[0]);
      nf.push([tr[0], a, c], [tr[1], b, a], [tr[2], c, b], [a, b, c]);
    }
    f = nf;
  }
  return { v, f };
}
const ICO0 = icosphere(0);
const ICO1 = icosphere(1);

/** A scalloped canopy clump: the icosphere pushed around by sines. */
function addClump(M, cx, cy, cz, rx, ry, rz, seed, hue, o = {}) {
  const ico = o.level === 0 ? ICO0 : ICO1;
  const kind = o.kind === undefined ? K_CANOPY : o.kind;
  const aoK = o.ao === undefined ? 1 : o.ao;
  const lobe = o.lobe === undefined ? 1 : o.lobe;
  const uRep = o.uRep === undefined ? 2 : o.uRep;

  part(M, kind, hue, cx, cy, cz);
  const base = M.n;
  const r = makeRandom((seed * 7919) | 0);
  const ph = [r() * 10, r() * 10, r() * 10];
  for (const p of ico.v) {
    // cauliflower lobes, not a smooth ball
    const d = 1
      + 0.20 * lobe * Math.sin(p[0] * 4.1 + ph[0]) * Math.sin(p[1] * 3.7 + ph[1])
      + 0.14 * lobe * Math.sin(p[2] * 6.3 + ph[2]) * Math.cos(p[0] * 5.1 + ph[1]);
    // the underside of a clump sits in the crown's own shade
    const ao = aoK * (0.56 + 0.44 * (p[1] * 0.5 + 0.5));
    const u = (Math.atan2(p[2], p[0]) / TAU + 0.5) * uRep;
    const v = (p[1] * 0.5 + 0.5) * uRep;
    vertex(M, cx + p[0] * rx * d, cy + p[1] * ry * d, cz + p[2] * rz * d,
      p[0], p[1], p[2], u, v, 0.3, ao);
  }
  for (const f of ico.f) M.idx.push(base + f[0], base + f[1], base + f[2]);
}

/**
 * A folded blade: three columns of vertices — edge, midrib, edge — walked
 * along a spine. The fold is what keeps a banana leaf from reading as a sheet
 * of paper, and it gives the normal map a crease to catch light on.
 * Stations are { p, t, s, w, fold, flut, ao } in tree space.
 */
function addBlade(M, st) {
  const cols = [[], [], []];
  let run = 0;
  for (let i = 0; i < st.length; i++) {
    const q = st[i];
    if (i > 0) run += dist3(q.p, st[i - 1].p);
    // right-handed (s, t, n), so winding stays consistent with the normal and
    // gl_FrontFacing can be trusted to tell top from bottom
    const n = norm3(cross3(q.s, q.t));
    const cf = Math.cos(q.fold), sf = Math.sin(q.fold);
    const v = run * 1.15;

    const mp = add3(q.p, mul3(n, q.w * 0.06));
    cols[1].push(vertex(M, mp[0], mp[1], mp[2], n[0], n[1], n[2], 1, v, q.flut, q.ao));
    for (const side of [1, -1]) {
      const e = add3(q.p, add3(mul3(q.s, side * q.w * cf), mul3(n, -q.w * sf)));
      const en = norm3([
        n[0] * cf + q.s[0] * side * sf,
        n[1] * cf + q.s[1] * side * sf,
        n[2] * cf + q.s[2] * side * sf,
      ]);
      cols[side > 0 ? 0 : 2].push(
        vertex(M, e[0], e[1], e[2], en[0], en[1], en[2], side > 0 ? 0 : 2, v, q.flut, q.ao * 0.94));
    }
  }
  for (let i = 0; i < st.length - 1; i++) {
    const a0 = cols[0][i], a1 = cols[0][i + 1];
    const m0 = cols[1][i], m1 = cols[1][i + 1];
    const b0 = cols[2][i], b1 = cols[2][i + 1];
    M.idx.push(a0, a1, m0, a1, m1, m0);
    M.idx.push(m0, m1, b0, m1, b1, b0);
  }
}

/**
 * One coconut frond: a thin rachis with two ranks of leaflets. Discrete
 * leaflets cost about 160 vertices and are the entire difference between a
 * palm and a feather duster on a stick.
 */
function addFrond(M, bx, by, bz, azim, len, hue, seed, o = {}) {
  const r = makeRandom(seed | 0);
  const tilt = o.tilt === undefined ? 0.7 : o.tilt;
  const droop = o.droop === undefined ? 1.6 : o.droop;
  const N = 6;
  const ca = Math.cos(azim), sa = Math.sin(azim);
  const side = [-sa, 0, ca];

  const spine = [], tang = [];
  let a = 0, b = 0;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const th = -tilt + droop * u * u;
    spine.push([bx + ca * a, by + b, bz + sa * a]);
    tang.push(norm3([ca * Math.cos(th), -Math.sin(th), sa * Math.cos(th)]));
    const step = len / N;
    a += Math.cos(th) * step;
    b += -Math.sin(th) * step;
  }

  part(M, K_BLADE, hue, bx, by, bz);
  addTube(M, spine, spine.map((_, i) => len * (0.020 - 0.014 * (i / N))), 5,
    { vScale: 1.4, aoA: 0.85, aoB: 1.0, flutA: 0.25, flutB: 1.0, wob: 0.3 });

  const NL = 9;
  for (let i = 0; i < NL; i++) {
    const u = 0.14 + 0.83 * (i / (NL - 1));
    const fi = u * N;
    const k = Math.min(N - 1, Math.floor(fi));
    const fr = fi - k;
    const p = [
      spine[k][0] + (spine[k + 1][0] - spine[k][0]) * fr,
      spine[k][1] + (spine[k + 1][1] - spine[k][1]) * fr,
      spine[k][2] + (spine[k + 1][2] - spine[k][2]) * fr,
    ];
    const t = tang[k];
    const n = norm3(cross3(side, t));
    const LL = len * (0.11 + 0.13 * Math.sin(Math.PI * u)) * (0.85 + r() * 0.3);
    const fan = 0.30 + 0.55 * u;    // leaflets sweep back toward the tip
    const drop = 0.35 + 0.85 * u;   // and hang further the further out they are

    for (const sg of [1, -1]) {
      const dir = norm3([
        side[0] * sg * Math.cos(fan) + t[0] * Math.sin(fan) - n[0] * drop * 0.5,
        side[1] * sg * Math.cos(fan) + t[1] * Math.sin(fan) - n[1] * drop * 0.5,
        side[2] * sg * Math.cos(fan) + t[2] * Math.sin(fan) - n[2] * drop * 0.5,
      ]);
      const ln = norm3(cross3(t, dir));
      part(M, K_BLADE, hue, bx, by, bz);
      const base = M.n;
      for (let s = 0; s < 3; s++) {
        const q = s / 2;
        const sag = q * q * LL * 0.5;
        const c = [
          p[0] + dir[0] * LL * q - n[0] * sag,
          p[1] + dir[1] * LL * q - n[1] * sag,
          p[2] + dir[2] * LL * q - n[2] * sag,
        ];
        const hw = LL * 0.062 * (1 - 0.88 * q);
        const fl = Math.min(1, 0.35 + 0.5 * u + 0.35 * q);
        vertex(M, c[0] + t[0] * hw, c[1] + t[1] * hw, c[2] + t[2] * hw,
          ln[0], ln[1], ln[2], 0, q * 2.2, fl, 0.92);
        vertex(M, c[0] - t[0] * hw, c[1] - t[1] * hw, c[2] - t[2] * hw,
          ln[0], ln[1], ln[2], 1, q * 2.2, fl, 0.92);
      }
      M.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      M.idx.push(base + 2, base + 4, base + 3, base + 3, base + 4, base + 5);
    }
  }
}

/** One banana leaf: arches up, flops over, and shreds along the veins. */
function addBananaLeaf(M, bx, by, bz, azim, len, hue, seed) {
  const r = makeRandom(seed | 0);
  const N = 7;
  const ca = Math.cos(azim), sa = Math.sin(azim);
  const side = [-sa, 0, ca];
  const flop = 1.7 + r() * 0.5;

  const st = [];
  let a = 0, b = 0;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const th = -1.15 + flop * (u * u * 0.85 + u * 0.15);
    // a banana leaf is in tatters within a week of opening, and the gaps are
    // most of what identifies it from across a field
    const tear = r() < 0.28 ? 0.42 + r() * 0.3 : 1;
    st.push({
      p: [bx + ca * a, by + b, bz + sa * a],
      t: norm3([ca * Math.cos(th), -Math.sin(th), sa * Math.cos(th)]),
      s: side,
      w: len * 0.17 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.55) * tear + 0.004,
      fold: 0.30 + 0.55 * u,
      flut: 0.18 + 0.82 * u,
      ao: 0.72 + 0.28 * u,
    });
    const step = len / N;
    a += Math.cos(th) * step;
    b += -Math.sin(th) * step;
  }
  part(M, K_BLADE, hue, bx, by, bz);
  addBlade(M, st);
}

/* ───────────── archetypes ───────────── */

function buildBroadleaf(seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = 9 + r() * 4;
  const lean = (r() - 0.5) * 0.5;

  const pts = [], rad = [];
  for (let i = 0; i <= 6; i++) {
    const u = i / 6;
    pts.push([lean * u * u * H * 0.14 + Math.sin(u * 3.4) * 0.35, u * H * 0.52, Math.cos(u * 2.6) * 0.35]);
    // the flare at the foot is what makes a trunk sit in the ground
    rad.push(H * 0.060 * (1 - u) + H * 0.026 * u + H * 0.030 * Math.exp(-u * 9));
  }
  part(M, K_BARK, 0.5, 0, 0, 0);
  addTube(M, pts, rad, 7, { vScale: 0.55, aoA: 0.5, aoB: 0.95 });

  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + r() * 0.9;
    const bl = H * (0.26 + r() * 0.18);
    const bp = [], br = [];
    for (let j = 0; j <= 3; j++) {
      const u = j / 3;
      bp.push([Math.cos(a) * bl * u * 0.9, H * 0.5 + u * bl * 0.72 - u * u * bl * 0.12, Math.sin(a) * bl * u * 0.9]);
      br.push(H * 0.020 * (1 - u) + H * 0.006 * u);
    }
    part(M, K_BARK, 0.5, 0, 0, 0);
    addTube(M, bp, br, 5, { vScale: 0.7, aoA: 0.85, aoB: 1.0 });
  }

  const n = 15;
  const CR = H * 0.4;
  for (let i = 0; i < n; i++) {
    let cx, cy, cz, rr, ao;
    if (i === 0) { cx = 0; cy = H * 0.78; cz = 0; rr = CR * 0.72; ao = 0.78; }
    else {
      const a = r() * TAU, dd = Math.pow(r(), 0.55) * CR * 1.02;
      cx = Math.cos(a) * dd; cz = Math.sin(a) * dd * 0.92;
      cy = H * 0.74 + (r() - 0.44) * CR * 0.95 - dd * 0.2;
      rr = CR * (0.26 + r() * 0.26);
      // clumps buried in the middle of a crown never see the sky
      ao = 0.68 + 0.32 * (dd / CR);
    }
    addClump(M, cx, cy, cz, rr * 1.12, rr * 0.86, rr * 1.12, seed + i * 53, r(), { ao });
  }
  return finishGeo(M, H);
}

/** The flame tree: a flat parasol crown that throws real shade. */
function buildUmbrella(seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = 10 + r() * 3;

  const pts = [], rad = [];
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    pts.push([Math.sin(u * 2.1) * 0.3, u * H * 0.5, Math.cos(u * 1.7) * 0.25]);
    rad.push(H * 0.056 * (1 - u * 0.55) + H * 0.034 * Math.exp(-u * 8));
  }
  part(M, K_BARK, 0.5, 0, 0, 0);
  addTube(M, pts, rad, 7, { vScale: 0.55, aoA: 0.5, aoB: 0.95 });

  const CR = H * 0.55;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + r() * 0.4;
    const bp = [], br = [];
    for (let j = 0; j <= 4; j++) {
      const u = j / 4;
      // limbs leave the trunk steeply and then level off — that is the parasol
      bp.push([Math.cos(a) * CR * u, H * 0.5 + Math.sin(u * 1.25) * H * 0.26, Math.sin(a) * CR * u]);
      br.push(H * 0.024 * (1 - u * 0.8) + H * 0.005);
    }
    part(M, K_BARK, 0.5, 0, 0, 0);
    addTube(M, bp, br, 5, { vScale: 0.7, aoA: 0.85, aoB: 1.0 });
  }

  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + r() * 0.4;
    const dd = Math.sqrt((i + 0.5) / n) * CR * 1.05;
    const rr = CR * (0.18 + r() * 0.13) * (1.15 - (dd / CR) * 0.3);
    const cy = H * 0.80 - (dd / CR) * H * 0.10 + (r() - 0.5) * H * 0.04;
    addClump(M, Math.cos(a) * dd, cy, Math.sin(a) * dd,
      rr * 1.35, rr * 0.52, rr * 1.35, seed + i * 37, r(),
      { ao: 0.70 + 0.30 * (dd / CR), lobe: 0.8 });
  }
  return finishGeo(M, H);
}

/** Cemara: the slim coastal spire that gives the skyline a vertical. */
function buildCemara(seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = 13 + r() * 4;

  const pts = [], rad = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    pts.push([Math.sin(u * 3.0) * 0.5, u * H, Math.cos(u * 2.2) * 0.45]);
    rad.push(H * 0.024 * (1 - u) + H * 0.004 * u + H * 0.014 * Math.exp(-u * 10));
  }
  part(M, K_BARK, 0.5, 0, 0, 0);
  addTube(M, pts, rad, 6, { vScale: 0.6, aoA: 0.55, aoB: 0.95 });

  const n = 13;
  for (let i = 0; i < n; i++) {
    const u = 0.18 + 0.80 * (i / (n - 1));
    const rr = H * (0.145 - 0.075 * Math.abs(u - 0.5) * 1.5);
    const jx = Math.sin(u * 7) * 0.5 + (r() - 0.5) * rr * 0.5;
    const jz = Math.cos(u * 6) * 0.45 + (r() - 0.5) * rr * 0.5;
    addClump(M, jx, u * H, jz, rr * 0.88, rr * 1.4, rr * 0.88,
      seed + i * 29, 0.2 + r() * 0.7, { ao: 0.72 + 0.28 * u, lobe: 1.15 });
  }
  return finishGeo(M, H);
}

/** Coconut palm. The trunk carries leaf-scar rings; the crown is all hinge. */
function buildPalm(seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = 9 + r() * 5;
  const lean = 0.5 + r() * 1.0;

  const N = 8;
  const pts = [], rad = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push([Math.sin(u * 1.35) * lean, u * H, Math.sin(u * 0.7) * lean * 0.25]);
    rad.push(H * 0.017 + H * 0.016 * Math.exp(-u * 6.5) - H * 0.004 * u);
  }
  part(M, K_BARK, 0.5, 0, 0, 0);
  addTube(M, pts, rad, 8, { vScale: 0.75, aoA: 0.55, aoB: 1.0, wob: 0.5 });

  const top = pts[N];
  const nf = 9 + Math.floor(r() * 4);
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * TAU + r() * 0.4;
    // some fronds still ride high, some have already dropped below horizontal
    const tilt = 0.85 - (i % 3) * 0.30 + r() * 0.18;
    addFrond(M, top[0], top[1] - 0.12, top[2], a, H * (0.44 + r() * 0.14), r(),
      seed + i * 131, { tilt, droop: 1.45 + r() * 0.55 });
  }
  for (let i = 0; i < 2; i++) {
    // two spears still unrolling at the heart
    addFrond(M, top[0], top[1] - 0.04, top[2], r() * TAU, H * 0.26, r(),
      seed + 900 + i, { tilt: 1.32, droop: 0.55 });
  }
  const nn = 3 + Math.floor(r() * 3);
  for (let i = 0; i < nn; i++) {
    const a = r() * TAU, dd = 0.16 + r() * 0.14;
    // nuts hang under the crown, which is also the only place they read
    addClump(M, top[0] + Math.cos(a) * dd, top[1] - 0.28 - r() * 0.16, top[2] + Math.sin(a) * dd,
      0.13, 0.15, 0.13, seed + 400 + i * 17, 0.5,
      { level: 0, kind: K_BARK, lobe: 0.3, uRep: 1 });
  }
  return finishGeo(M, H);
}

/** Banana: a sheath of a stem and half a dozen enormous shredded leaves. */
function buildBanana(seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = 2.8 + r() * 1.5;

  const stem = (ox, oz, k, sd) => {
    const sr = makeRandom(sd | 0);
    const pts = [], rad = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      pts.push([ox + Math.sin(u * 0.5) * 0.08 * k, u * H * 0.66 * k, oz]);
      rad.push(H * 0.082 * k * (1 - u * 0.40));
    }
    part(M, K_BARK, 0.4, ox, 0, oz);
    addTube(M, pts, rad, 8, { vScale: 1.0, aoA: 0.5, aoB: 1.0, wob: 0.35 });

    const top = pts[5];
    const nl = 5 + Math.floor(sr() * 3);
    for (let i = 0; i < nl; i++) {
      addBananaLeaf(M, top[0], top[1] - 0.10, top[2], (i / nl) * TAU + sr() * 0.6,
        H * k * (0.78 + sr() * 0.42), sr(), (sd + i * 97) | 0);
    }
    // the youngest leaf has not unrolled yet
    addClump(M, top[0], top[1] + H * k * 0.16, top[2],
      0.055 * k, H * k * 0.20, 0.055 * k, (sd + 55) | 0, 0.85, { level: 0, lobe: 0.2 });
  };

  stem(0, 0, 1, seed);
  // bananas never grow alone — the sucker beside the stool is half the read
  stem(0.42 + r() * 0.2, -0.30 + r() * 0.2, 0.62 + r() * 0.15, seed + 311);
  if (r() < 0.6) stem(-0.36 - r() * 0.2, 0.28 + r() * 0.2, 0.40 + r() * 0.15, seed + 577);

  return finishGeo(M, H);
}

/**
 * Frangipani. Thick blunt forks carrying almost no leaf and a scatter of
 * blossom at every tip — the tree that stands in every temple courtyard.
 */
function buildFrangipani(seed) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = 3.6 + r() * 1.8;
  const tips = [];

  const limb = (o, dir, len, rad, depth) => {
    const lift = 0.4 + r() * 0.45;
    const pts = [], rr = [];
    for (let i = 0; i <= 3; i++) {
      const u = i / 3;
      const d = norm3([dir[0] * (1 - u * 0.35), dir[1] + u * lift, dir[2] * (1 - u * 0.35)]);
      pts.push([o[0] + d[0] * len * u, o[1] + d[1] * len * u, o[2] + d[2] * len * u]);
      rr.push(rad * (1 - u * 0.42));
    }
    part(M, K_BARK, 0.3, 0, 0, 0);
    addTube(M, pts, rr, 6, { vScale: 0.85, aoA: 0.8, aoB: 1.0, wob: 0.6 });
    const tip = pts[3];
    if (depth <= 0) { tips.push(tip); return; }
    const nd = norm3(sub3(tip, pts[2]));
    const perp = norm3(cross3(nd, [0, 1, 0]));
    for (let i = 0; i < 2; i++) {
      const sp = (i === 0 ? 1 : -1) * (0.45 + r() * 0.3);
      limb(tip, norm3([nd[0] + perp[0] * sp, nd[1] * 0.7, nd[2] + perp[2] * sp]),
        len * (0.66 + r() * 0.14), rad * 0.66, depth - 1);
    }
  };

  const pts = [], rad = [];
  for (let i = 0; i <= 4; i++) {
    const u = i / 4;
    pts.push([Math.sin(u * 1.1) * 0.16, u * H * 0.33, Math.cos(u * 0.8) * 0.10]);
    rad.push(H * 0.052 * (1 - u * 0.22) + H * 0.024 * Math.exp(-u * 8));
  }
  part(M, K_BARK, 0.3, 0, 0, 0);
  addTube(M, pts, rad, 7, { vScale: 0.7, aoA: 0.5, aoB: 0.95 });

  const fork = pts[4];
  const nb = 3 + Math.floor(r() * 2);
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * TAU + r() * 0.5;
    limb(fork, norm3([Math.cos(a), 0.85 + r() * 0.3, Math.sin(a)]), H * 0.36, H * 0.038, 1);
  }

  let bi = 0;
  for (const tp of tips) {
    // a rosette right at the tip and bare wood behind it, which is the shape
    for (let i = 0; i < 3; i++) {
      const a = r() * TAU, dd = 0.10 + r() * 0.16;
      addClump(M, tp[0] + Math.cos(a) * dd, tp[1] + 0.06 + r() * 0.12, tp[2] + Math.sin(a) * dd,
        0.30, 0.11, 0.24, seed + bi * 13 + i, r(), { ao: 0.88, lobe: 0.7 });
    }
    for (let i = 0; i < 3; i++) {
      const a = r() * TAU, dd = 0.08 + r() * 0.14;
      addClump(M, tp[0] + Math.cos(a) * dd, tp[1] + 0.16 + r() * 0.12, tp[2] + Math.sin(a) * dd,
        0.075, 0.045, 0.075, seed + 700 + bi * 7 + i, r(),
        { level: 0, kind: K_BLOOM, lobe: 0.35 });
    }
    bi++;
  }
  return finishGeo(M, H);
}

/**
 * Banyan. A bundle of fused stems, a crown wider than it is tall, and aerial
 * roots — half of them still hanging short of the soil, because a root that
 * has landed is just another trunk and one that has not is the whole picture.
 */
function buildBanyan(seed, o = {}) {
  const M = MeshBuf();
  const r = makeRandom(seed);
  const H = o.H === undefined ? 11 + r() * 3 : o.H;
  const roots = o.roots === undefined ? 14 : o.roots;

  const trunk = (ox, oz, k) => {
    const pts = [], rad = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      const grip = 1 - u;   // the satellite stems fuse into the main one
      pts.push([ox * grip + Math.sin(u * 2.6) * 0.3, u * H * 0.46, oz * grip + Math.cos(u * 2.1) * 0.28]);
      rad.push((H * 0.052 * (1 - u * 0.5) + H * 0.040 * Math.exp(-u * 5)) * k);
    }
    part(M, K_BARK, 0.5, 0, 0, 0);
    addTube(M, pts, rad, 8, { vScale: 0.5, aoA: 0.45, aoB: 0.95, wob: 1.3 });
  };
  trunk(0, 0, 1);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + r() * 0.7;
    const dd = H * (0.055 + r() * 0.035);
    trunk(Math.cos(a) * dd, Math.sin(a) * dd, 0.52 + r() * 0.2);
  }

  const CR = H * 0.62;
  const limbPts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + r() * 0.45;
    const bl = CR * (0.85 + r() * 0.3);
    const bp = [], br = [];
    for (let j = 0; j <= 4; j++) {
      const u = j / 4;
      bp.push([Math.cos(a) * bl * u, H * 0.46 + Math.sin(u * 1.05) * H * 0.20, Math.sin(a) * bl * u]);
      br.push(H * 0.028 * (1 - u * 0.75) + H * 0.006);
    }
    part(M, K_BARK, 0.5, 0, 0, 0);
    addTube(M, bp, br, 6, { vScale: 0.6, aoA: 0.8, aoB: 1.0 });
    for (let j = 2; j <= 4; j++) limbPts.push(bp[j]);
  }

  for (let i = 0; i < roots; i++) {
    const src = limbPts[(r() * limbPts.length) | 0];
    const reach = r() < 0.55 ? 1 : 0.35 + r() * 0.35;
    const drop = src[1] * reach;
    const wob = (r() - 0.5) * 0.5;
    const pts = [], rad = [];
    for (let j = 0; j <= 4; j++) {
      const u = j / 4;
      pts.push([src[0] + wob * u * u, src[1] - drop * u, src[2] + wob * 0.7 * u * u]);
      // a root that has reached the soil starts thickening into a trunk
      rad.push(0.035 + (reach > 0.99 ? 0.055 * u * u : 0.01 * u));
    }
    part(M, K_BARK, 0.5, 0, 0, 0);
    addTube(M, pts, rad, 4, { vScale: 1.1, aoA: 0.95, aoB: 0.6, wob: 0.4 });
  }

  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + r() * 0.5;
    const dd = Math.sqrt((i + 0.4) / n) * CR * 1.08;
    const rr = CR * (0.17 + r() * 0.11);
    const cy = H * 0.74 - (dd / CR) * H * 0.14 + (r() - 0.5) * H * 0.07;
    addClump(M, Math.cos(a) * dd, cy, Math.sin(a) * dd,
      rr * 1.25, rr * 0.80, rr * 1.25, seed + i * 41, r(),
      { ao: 0.64 + 0.36 * (dd / CR) });
  }
  return finishGeo(M, H);
}

/* ───────────── shaders ───────────── */

const vert = /* glsl */`
precision highp float;

attribute vec3  nrm;
attribute vec3  clm;   // the part's pivot, in tree space
attribute vec4  aux;   // hue, kind, flutter weight, baked AO
attribute vec4  iPos;  // xyz root, w scale
attribute vec4  iVar;  // rot, bloom, phase, sway

uniform float uTime;
uniform float uWind;
uniform vec2  uWindDir;
uniform float uTreeH;

varying vec3  vN;
varying vec3  vW;
varying vec3  vTex;
varying vec2  vUv;
varying float vHue;
varying float vKind;
varying float vAO;
varying float vBloom;
varying float vDist;
varying float vUp;
varying float vTip;

vec3 spin(vec3 v, float c, float s) {
  return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c);
}

vec3 rotAxis(vec3 v, vec3 axis, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  float sc = iPos.w;
  float c = cos(iVar.x), s = sin(iVar.x);
  vec3 rp = spin(position * sc, c, s);
  vec3 rn = spin(nrm, c, s);
  vec3 rc = spin(clm * sc, c, s);
  float H = uTreeH * sc;
  float kind = aux.y;

  /* The triplanar leaf lookup has to key off the tree's REST position. Keying
     it off the wind-displaced one drags the colour and normal maps across the
     crown as it sways — up to seven tenths of a tile of lateral crawl on a
     cemara, plus a high-frequency boil from the flutter term — which reads as
     the whole canopy simmering. Captured here, before any wind is applied. */
  vTex = rp + iPos.xyz;

  // one phase for the whole tree and one per part: the trunk has to move as a
  // single mass or the canopy visibly shears off it
  float tph = iVar.z;
  float pph = iVar.z + aux.x * 6.2832;

  // the whole tree bends from the root, and the pivot rides the same bend so
  // the hinge below stays anchored to the crown
  float gust = sin(uTime * 0.8 + tph) * 0.6 + sin(uTime * 1.9 + tph * 1.7) * 0.4;
  vec2 push = uWindDir * gust * uWind * iVar.w * H * 0.02;
  rp.xz += push * pow(clamp(rp.y / max(H, 1.0), 0.0, 1.0), 1.6);
  rc.xz += push * pow(clamp(rc.y / max(H, 1.0), 0.0, 1.0), 1.6);

  if (kind > 1.5 && kind < 2.5) {
    // a frond is a lever, not a flag. Swinging the arm about the crown keeps
    // the blade's length honest, and it is the reason a palm reads tropical
    // where the same wind on a solid canopy reads as a hedge.
    vec3 axis = normalize(vec3(-uWindDir.y, 0.0, uWindDir.x));
    float w = aux.z;
    float swing = sin(uTime * 1.6 + pph) * 0.62 + sin(uTime * 3.4 + pph * 1.9) * 0.38;
    float ang = swing * uWind * (0.10 + 0.30 * w) * w;
    vec3 arm = rotAxis(rp - rc, axis, ang);
    arm.y += sin(uTime * 4.9 + pph * 2.3 + arm.x * 1.6 + arm.z * 1.1) * uWind * 0.07 * w * w * sc;
    rp = rc + arm;
    rn = rotAxis(rn, axis, ang);
  } else if (kind > 0.5 && kind < 1.5) {
    float fl = sin(uTime * 2.6 + pph + rc.x * 1.7 + rc.y * 0.9) * 0.5
             + sin(uTime * 5.1 + pph * 2.3 + rc.z * 2.1) * 0.3;
    rp += rn * fl * uWind * 0.07 * sc;
  }

  vec3 wp = rp + iPos.xyz;
  vN = rn;
  vW = wp;
  vUv = uv;
  vHue = fract(aux.x + iVar.z * 0.3170);
  vKind = kind;
  vAO = aux.w;
  vBloom = iVar.y;
  vUp = clamp(rp.y / max(H, 1.0), 0.0, 1.0);
  vTip = aux.z;

  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const frag = /* glsl */`
precision highp float;

uniform sampler2D uBark;
uniform sampler2D uBarkN;
uniform sampler2D uLeaf;
uniform sampler2D uLeafN;

uniform vec3  uLeafCol;
uniform vec3  uBarkTint;
uniform vec3  uBloomCol;
uniform float uBarkRing;
uniform float uBarkFibre;
uniform float uLeafScale;
uniform float uNormalScale;
uniform float uRain;

uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbSky;
uniform vec3  uAmbGround;
uniform float uAmbIntensity;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec3  uCamPos;

varying vec3  vN;
varying vec3  vW;
varying vec3  vTex;
varying vec2  vUv;
varying float vHue;
varying float vKind;
varying float vAO;
varying float vBloom;
varying float vDist;
varying float vUp;
varying float vTip;

const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);

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

// Three-band ramp; the soft-but-visible banding is the painted look. It stays
// greyscale-ish and multiplies the albedo, so the texture maps supply colour
// and the ramp supplies the poster.
vec3 ramp3(float t, float soft, float jit) {
  float a = smoothstep(0.30 - soft + jit, 0.30 + soft + jit, t);
  float b = smoothstep(0.62 - soft + jit, 0.62 + soft + jit, t);
  return mix(mix(vec3(0.26, 0.31, 0.34), vec3(0.74, 0.78, 0.70), a),
             vec3(1.16, 1.12, 0.88), b);
}

// this geometry has no tangents, so the frame comes off screen derivatives
vec3 perturb(vec3 N, vec3 P, vec2 uvc, vec3 mapN) {
  vec3 dp1 = dFdx(P), dp2 = dFdy(P);
  vec2 du1 = dFdx(uvc), du2 = dFdy(uvc);
  vec3 q2 = cross(dp2, N), q1 = cross(N, dp1);
  vec3 T = q2 * du1.x + q1 * du2.x;
  vec3 B = q2 * du1.y + q1 * du2.y;
  float m = max(dot(T, T), dot(B, B));
  if (m < 1e-12) return N;
  float inv = inversesqrt(m);
  return normalize(T * (inv * mapN.x) + B * (inv * mapN.y) + N * mapN.z);
}

// whiteout triplanar for the clumps: a scalloped blob has no sane UV, and a
// seam across a canopy is worse than no detail at all
vec3 triNormal(sampler2D t, vec3 p, vec3 N, vec3 w, float sc) {
  vec3 nx = texture2D(t, p.zy * sc).xyz * 2.0 - 1.0;
  vec3 ny = texture2D(t, p.xz * sc).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(t, p.xy * sc).xyz * 2.0 - 1.0;
  vec3 bx = vec3(nx.xy + N.zy, abs(nx.z) * N.x).zyx;
  vec3 by = vec3(ny.xy + N.xz, abs(ny.z) * N.y).xzy;
  vec3 bz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
  return normalize(bx * w.x + by * w.y + bz * w.z);
}

vec3 triColor(sampler2D t, vec3 p, vec3 w, float sc) {
  return texture2D(t, p.zy * sc).rgb * w.x
       + texture2D(t, p.xz * sc).rgb * w.y
       + texture2D(t, p.xy * sc).rgb * w.z;
}

void main() {
  vec3 Ng = normalize(vN);
  if (!gl_FrontFacing) Ng = -Ng;
  vec3 V = normalize(uCamPos - vW);
  vec3 L = uSunDir;

  // surface detail has to die with distance or the far ring of trees boils
  float detail = 1.0 - smoothstep(26.0, 82.0, vDist);

  vec3 N = Ng;
  vec3 albedo;
  vec3 tcol = vec3(0.0);
  float soft = 0.16;
  float trans = 0.0;

  if (vKind < 0.5) {
    vec3 mapN = texture2D(uBarkN, vUv).xyz * 2.0 - 1.0;
    mapN.xy *= uNormalScale * detail;
    N = perturb(Ng, vW, vUv, normalize(mapN));
    // leaf-scar rings for a palm, vertical fibre for a banana sheath
    float ring = 1.0 - uBarkRing * detail * 0.24 * smoothstep(0.1, 0.95, sin(vUv.y * 26.0));
    // eight stripes per wrap: an exact multiple of 2pi, or the seam steps
    float fib  = 1.0 - uBarkFibre * detail * 0.20 * smoothstep(0.0, 0.9, sin(vUv.x * 50.2655));
    albedo = texture2D(uBark, vUv).rgb * uBarkTint * ring * fib;
    albedo *= mix(1.0, 0.74, uRain * 0.8);
    soft = 0.20;
  } else if (vKind < 1.5) {
    vec3 w = pow(abs(Ng), vec3(4.0));
    w /= (w.x + w.y + w.z);
    N = normalize(mix(Ng, triNormal(uLeafN, vTex, Ng, w, uLeafScale), uNormalScale * detail));
    // the map IS the leaf colour, so everything below only tints it — deriving
    // albedo from a flat colour and the map's luminance darkens it twice
    vec3 lc = triColor(uLeaf, vTex, w, uLeafScale);

    float hs = vHue - 0.5;
    vec3 tint = vec3(1.0 + hs * 0.30, 1.0 + hs * 0.10, 1.0 - hs * 0.34);
    // the top of a crown bleaches toward gold while the inside stays deep
    tint *= mix(vec3(0.74, 0.86, 0.86), vec3(1.18, 1.08, 0.72), smoothstep(0.22, 0.95, vUp));
    albedo = lc * tint;
    albedo = mix(albedo, uBloomCol * (0.82 + dot(lc, LUM)), vBloom);
    trans = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.8);
    tcol = mix(uLeafCol * vec3(1.7, 1.5, 0.65), uBloomCol * 1.2, vBloom);
    soft = 0.14;
  } else if (vKind < 2.5) {
    // blades own real UVs, so they take an aligned normal at two taps instead
    // of six — and nothing stretches down the length of a frond
    vec2 lu = vUv * vec2(1.0, 0.65);
    vec3 mapN = texture2D(uLeafN, lu).xyz * 2.0 - 1.0;
    mapN.xy *= uNormalScale * detail * 1.2;
    N = perturb(Ng, vW, lu, normalize(mapN));
    vec3 lc = texture2D(uLeaf, lu).rgb;
    float hs = vHue - 0.5;
    vec3 tint = vec3(1.0 + hs * 0.24, 1.0 + hs * 0.10, 1.0 - hs * 0.28);
    // a frond dries from the tip back, and vTip is already the along-blade
    // parameter the wind hinge runs on
    tint *= mix(vec3(1.0), vec3(1.30, 1.10, 0.58), smoothstep(0.35, 1.0, vTip));
    albedo = lc * tint;
    trans = 0.9;
    tcol = uLeafCol * vec3(1.8, 1.55, 0.6);
    soft = 0.18;
  } else {
    albedo = uBloomCol * 0.85;
    trans = 0.5;
    tcol = uBloomCol * 1.2;
    soft = 0.26;
  }

  // painterly wobble of the band edges, in world space and faded with
  // distance, or far canopies shimmer with stripes
  float jit = (vnoise(vW.xz * 2.1 + vW.y * 0.8) - 0.5) * 0.14 / (1.0 + vDist * 0.02);

  // bands follow the silhouette normal, surface response follows the mapped
  // one — mixing them is what stops leaf detail eating the poster look
  float ndl = mix(dot(Ng, L), dot(N, L), 0.65);
  vec3 col = albedo * ramp3(clamp(ndl * 0.55 + 0.48, 0.0, 1.0), soft, jit);

  if (vKind > 0.5) {
    // undersides sit in the canopy's own shadow whatever the sun is doing
    col *= mix(0.60, 1.0, smoothstep(-0.85, 0.30, N.y));
    // and light comes through a thin leaf green-gold when the sun is behind it
    float back = smoothstep(-0.05, 0.85, dot(V, -L));
    col += uSunColor * tcol * back * trans * 0.45;
  }

  col *= uSunColor * 0.85 + mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * uAmbIntensity * 0.5;
  col *= mix(0.50, 1.0, vAO);

  // wet bark picks up a sheen; nothing else in this valley is allowed to
  if (vKind < 0.5 && uRain > 0.01) {
    col += uSunColor * pow(max(dot(reflect(-L, N), V), 0.0), 26.0) * uRain * 0.22;
  }

  float f = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
  gl_FragColor = vec4(mix(col, uFogColor, clamp(f, 0.0, 1.0)), 1.0);
}
`;

/* ───────────── the species table ───────────── */

/* Each entry owns its own bark and foliage maps. textures.js caches by
   argument, so two species sharing a hex share the canvas and the upload. */
const SPECIES = [
  {
    key: 'broadleaf', build: buildBroadleaf, seeds: [11, 47], n: 44,
    sway: 0.55, gap: 7.0, scale: [0.62, 0.72], bloom: 0.14,
    bark: ['#5b4632', { seed: 41, mossiness: 0.3 }],
    leaf: ['#3f6a2c', { seed: 77, shade: '#22401f', tip: '#93b455' }],
    barkTint: [1.0, 0.98, 0.94], ring: 0, fibre: 0,
    leafScale: 1.9, bloomCol: '#c08a34', normalScale: 1.0,
    place: { mode: 'ring', a: 17, b: 132, bias: 0.72, minH: 2.05, rIn: 15, path: 5 },
  },
  {
    key: 'flame', build: buildUmbrella, seeds: [131, 233], n: 22,
    sway: 0.5, gap: 9.0, scale: [0.7, 0.55], bloom: 0.4,
    bark: ['#6b5540', { seed: 12, mossiness: 0.14 }],
    leaf: ['#4b7534', { seed: 5, shade: '#2b4a24', tip: '#a8bf62', leaves: 120 }],
    barkTint: [1.0, 0.99, 0.96], ring: 0, fibre: 0,
    leafScale: 2.3, bloomCol: '#c9481c', normalScale: 1.0,
    place: { mode: 'ring', a: 22, b: 126, bias: 0.85, minH: 2.05, rIn: 20, path: 6 },
  },
  {
    key: 'cemara', build: buildCemara, seeds: [89], n: 18,
    sway: 1.0, gap: 6.0, scale: [0.62, 0.66], bloom: 0.0,
    bark: ['#4e3f30', { seed: 63, mossiness: 0.34 }],
    leaf: ['#2f5b3a', { seed: 19, shade: '#1c3826', tip: '#6f9a58', leaves: 150 }],
    barkTint: [0.96, 0.96, 0.98], ring: 0, fibre: 0,
    leafScale: 2.6, bloomCol: '#9c8a44', normalScale: 1.1,
    place: { mode: 'ring', a: 30, b: 132, bias: 0.6, minH: 2.4, rIn: 26, path: 5 },
  },
  {
    key: 'coconut', build: buildPalm, seeds: [401, 419], n: 28,
    sway: 0.9, gap: 5.5, scale: [0.78, 0.4], bloom: 0.0,
    bark: ['#8a7455', { seed: 8, moss: false }],
    leaf: ['#5c8a2e', { seed: 31, shade: '#33591f', tip: '#b0c85e', leaves: 60 }],
    barkTint: [1.02, 0.99, 0.92], ring: 1, fibre: 0,
    leafScale: 2.0, bloomCol: '#c9b45a', normalScale: 1.15,
    // coconuts belong on low ground and along the water, which is also the
    // emptiest ground in the whole valley
    place: { mode: 'shore', minH: 0.7, rIn: 14, path: 4.5, share: 0.55 },
  },
  {
    key: 'banana', build: buildBanana, seeds: [613], n: 24,
    sway: 1.5, gap: 3.4, scale: [0.82, 0.5], bloom: 0.0,
    bark: ['#7d7a4a', { seed: 26, moss: false }],
    leaf: ['#6d9a30', { seed: 44, shade: '#3d6420', tip: '#c2d268', leaves: 40 }],
    barkTint: [0.98, 1.0, 0.9], ring: 0, fibre: 1,
    leafScale: 1.6, bloomCol: '#cbbe52', normalScale: 1.25,
    place: { mode: 'grove', per: 5, spread: 7.5, a: 22, b: 108, bias: 0.9, minH: 0.7, rIn: 20, path: 5 },
  },
  {
    key: 'frangipani', build: buildFrangipani, seeds: [727], n: 20,
    sway: 0.75, gap: 4.5, scale: [0.72, 0.5], bloom: 0.0,
    bark: ['#8e8071', { seed: 91, moss: false }],
    leaf: ['#37662c', { seed: 58, shade: '#1e3d1a', tip: '#7fa348', leaves: 70 }],
    barkTint: [1.0, 0.99, 0.97], ring: 0, fibre: 0,
    leafScale: 1.7, bloomCol: '#f2e4c2', normalScale: 1.0,
    // the tree that lines every temple approach, so it lines the footpath
    place: { mode: 'path', minH: 1.8, rIn: 14, path: 5.5, pathMax: 13 },
  },
  {
    key: 'banyan', build: buildBanyan, seeds: [853], n: 8,
    sway: 0.4, gap: 20.0, scale: [0.9, 0.5], bloom: 0.0,
    bark: ['#6a5847', { seed: 73, mossiness: 0.4 }],
    leaf: ['#39682e', { seed: 66, shade: '#204020', tip: '#8fb055', leaves: 110 }],
    barkTint: [0.99, 0.98, 0.96], ring: 0, fibre: 0,
    leafScale: 2.2, bloomCol: '#b08a3a', normalScale: 1.0,
    place: { mode: 'ring', a: 34, b: 124, bias: 0.8, minH: 2.3, rIn: 32, path: 8 },
  },
];

/* ───────────── placement ───────────── */

/**
 * Every keep-out in the world, in one place. The railway band is narrower
 * than it used to be: the line only ever occupies z -80..-72, and the old
 * fifty-metre exclusion was sterilising a sixth of the valley for nothing.
 */
function goodSpot(x, z, p) {
  const d = Math.hypot(x, z);
  if (d < p.rIn || d > 134) return false;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.15) return false;

  const h = heightAt(x, z);
  if (h < p.minH || h < WATER_LEVEL - 0.9) return false;
  if (normalAt(x, z, 1.2).y < 0.72) return false;

  const path = Math.abs(z + 4 - Math.sin(x * 0.06) * 6 - x * 0.42);
  if (path < p.path && d < 70) return false;
  if (p.pathMax && (path > p.pathMax || d > 92)) return false;

  if (z < -64 && z > -92) return false;

  // the temple grounds, the gate and the great banyan each keep their air
  if (Math.hypot(x - 22, z - 26) < 8) return false;
  if (Math.hypot(x - 55, z + 44) < 9) return false;
  if (Math.hypot(x + 34, z + 6) < 7) return false;
  if (Math.hypot(x - 9, z - 2.9) < 6.5) return false;
  if (Math.hypot(x + 26, z - 20) < 13) return false;
  return true;
}

function sampleSpot(rnd, p, state) {
  if (p.mode === 'shore') {
    // half hug the pond, half take the low south-east ground nobody uses
    if (rnd() < p.share) {
      const a = rnd() * TAU, r = POND.r * 1.22 + rnd() * 20;
      return [POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r];
    }
    const a = rnd() * TAU, r = 24 + Math.pow(rnd(), 0.8) * 92;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
  if (p.mode === 'path') {
    const x = -46 + rnd() * 124;
    const zc = -4 + Math.sin(x * 0.06) * 6 + x * 0.42;
    return [x, zc + (rnd() < 0.5 ? -1 : 1) * (6.2 + rnd() * 5.4)];
  }
  if (p.mode === 'grove') {
    if (state.left <= 0 || !state.c) {
      const a = rnd() * TAU, r = p.a + Math.pow(rnd(), p.bias) * (p.b - p.a);
      state.c = [Math.cos(a) * r, Math.sin(a) * r];
      state.left = p.per;
    }
    state.left--;
    return [state.c[0] + (rnd() - 0.5) * p.spread, state.c[1] + (rnd() - 0.5) * p.spread];
  }
  const a = rnd() * TAU, r = p.a + Math.pow(rnd(), p.bias) * (p.b - p.a);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/* ───────────── the forest ───────────── */

export class Forest {
  constructor(scene) {
    this.materials = [];
    this.meshes = [];
    const rnd = makeRandom(1123);
    const taken = [];

    const mkMaterial = (sp, geo) => {
      const bark = barkTexture(sp.bark[0], sp.bark[1]);
      const leaf = foliageTexture(sp.leaf[0], sp.leaf[1]);
      const mat = new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        // fronds, banana blades and leaflets are single sheets; the fragment
        // flips the normal by facing so both sides light correctly
        side: THREE.DoubleSide,
        extensions: { derivatives: true },
        uniforms: {
          uTime: { value: 0 },
          uWind: { value: 0.5 },
          uWindDir: { value: new THREE.Vector2(0.86, 0.51).normalize() },
          uTreeH: { value: geo.userData.height },
          uBark: { value: bark },
          uBarkN: { value: bark.userData.normalMap },
          uLeaf: { value: leaf },
          uLeafN: { value: leaf.userData.normalMap },
          // ColorManagement is on, so Color already holds linear working
          // values — converting again would darken every leaf by a gamma
          uLeafCol: { value: new THREE.Color(sp.leaf[0]) },
          uBarkTint: { value: new THREE.Vector3(...sp.barkTint) },
          uBloomCol: { value: new THREE.Color(sp.bloomCol) },
          uBarkRing: { value: sp.ring },
          uBarkFibre: { value: sp.fibre },
          uLeafScale: { value: sp.leafScale },
          uNormalScale: { value: sp.normalScale },
          uRain: { value: 0 },
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
      this.materials.push(mat);
      return mat;
    };

    const addMesh = (geo, mat) => {
      // instances are scattered over the whole valley, so a per-mesh bounding
      // volume can only ever be wrong
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      // the trees hold their transform in an instance attribute, so the depth
      // pass has to run their own vertex shader or every shadow lands at the
      // world origin
      enableInstancedShadows(mesh, vert, mat.uniforms);
      scene.add(mesh);
      this.meshes.push(mesh);
    };

    for (const sp of SPECIES) {
      const slots = sp.seeds.map(() => []);
      const state = { c: null, left: 0 };
      let placed = 0, guard = 0;

      while (placed < sp.n && guard < sp.n * 90) {
        guard++;
        const spot = sampleSpot(rnd, sp.place, state);
        if (!goodSpot(spot[0], spot[1], sp.place)) continue;

        let clash = false;
        for (let i = 0; i < taken.length; i++) {
          const t = taken[i];
          if (Math.hypot(spot[0] - t[0], spot[1] - t[1]) < (sp.gap + t[2]) * 0.5) { clash = true; break; }
        }
        if (clash) continue;

        taken.push([spot[0], spot[1], sp.gap]);
        // variants are dealt round-robin so the two seeds interleave on the
        // ground instead of colonising opposite halves of the map
        slots[placed % slots.length].push(spot);
        placed++;
      }

      sp.seeds.forEach((seed, vi) => {
        const spots = slots[vi];
        if (!spots.length) return;
        const geo = sp.build(seed);
        const iPos = new Float32Array(spots.length * 4);
        const iVar = new Float32Array(spots.length * 4);
        for (let i = 0; i < spots.length; i++) {
          const x = spots[i][0], z = spots[i][1];
          const far = Math.hypot(x, z) > 85 ? 0.18 : 0;
          iPos[i * 4] = x;
          iPos[i * 4 + 1] = heightAt(x, z) - 0.25;
          iPos[i * 4 + 2] = z;
          iPos[i * 4 + 3] = sp.scale[0] + rnd() * sp.scale[1] + far;
          iVar[i * 4] = rnd() * TAU;
          iVar[i * 4 + 1] = rnd() < sp.bloom ? 0.6 + rnd() * 0.4 : 0;
          iVar[i * 4 + 2] = rnd() * 10;
          iVar[i * 4 + 3] = sp.sway * (0.7 + rnd() * 0.6);
        }
        geo.instanceCount = spots.length;
        geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
        geo.setAttribute('iVar', new THREE.InstancedBufferAttribute(iVar, 4));
        addMesh(geo, mkMaterial(sp, geo));
      });
    }

    // the great banyan presiding over the meadow's west side — still the only
    // thing over eight metres anywhere inside the inner ring
    const great = buildBanyan(777, { H: 13, roots: 26 });
    great.instanceCount = 1;
    great.setAttribute('iPos', new THREE.InstancedBufferAttribute(
      new Float32Array([-26, heightAt(-26, 20) - 0.4, 20, 2.35]), 4));
    great.setAttribute('iVar', new THREE.InstancedBufferAttribute(
      new Float32Array([0.8, 0, 3.1, 0.34]), 4));
    addMesh(great, mkMaterial(SPECIES.find((sp) => sp.key === 'banyan'), great));
  }

  update(t, camera, sky, wind, rain) {
    for (const m of this.materials) {
      const u = m.uniforms;
      u.uTime.value = t;
      u.uWind.value = wind;
      u.uRain.value = rain;
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
