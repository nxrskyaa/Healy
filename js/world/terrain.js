import * as THREE from 'three';
import { fbm, makeRandom, smoothstep, clamp } from './noise.js';

/* ═══════════════════════════════════════════════════════════
   The land: the height field everything else is built on, plus
   the pond, flowers, stones and lily pads.
   The grass itself lives in grass.js — it needed its own engine.
   ═══════════════════════════════════════════════════════════ */

export const WORLD_SIZE = 300;
export const POND = { x: 38, z: -30, r: 21 };
export const WATER_LEVEL = 1.55;

const lerp = (a, b, t) => a + (b - a) * t;

/** Ground height at any world position. Single source of truth. */
export function heightAt(x, z) {
  let h = fbm(x * 0.0082, z * 0.0082, 5) * 17.0 + 5.0;
  h += fbm(x * 0.031 + 11.3, z * 0.031 - 4.7, 3) * 1.9;
  h += fbm(x * 0.12 - 2.1, z * 0.12 + 8.4, 2) * 0.35;

  // the meadow you spawn in — softly flattened, framed by hills
  const d = Math.hypot(x, z);
  h = lerp(h, 3.1, smoothstep(78, 14, d) * 0.86);

  // pond: level the rim, then scoop out the basin
  const pd = Math.hypot(x - POND.x, z - POND.z);
  h = lerp(h, 2.5, smoothstep(POND.r * 1.9, POND.r * 0.65, pd) * 0.92);
  h -= smoothstep(POND.r, POND.r * 0.18, pd) * 4.8;

  // a shallow footpath winding from the meadow to the pond
  const path = smoothstep(4.5, 1.2, Math.abs(z + 4 - Math.sin(x * 0.06) * 6 - x * 0.42));
  h -= path * smoothstep(60, 8, d) * 0.28;

  return h;
}

/** Approximate surface normal via finite differences. */
export function normalAt(x, z, e = 0.6) {
  const hl = heightAt(x - e, z), hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e), hu = heightAt(x, z + e);
  return new THREE.Vector3(hl - hr, 2 * e, hd - hu).normalize();
}

/* ───────────────────────── ground mesh ───────────────────────── */

const C_GRASS_LIGHT = new THREE.Color('#8fb46a');
const C_GRASS_DARK  = new THREE.Color('#4e7a4a');
const C_GRASS_DEEP  = new THREE.Color('#375c3f');
const C_SAND        = new THREE.Color('#d9c89a');
const C_DIRT        = new THREE.Color('#9b7f5c');
const C_ROCK        = new THREE.Color('#8d9188');

function groundColor(x, z, h, steep, out) {
  const v = fbm(x * 0.06, z * 0.06, 3);
  out.copy(C_GRASS_DARK).lerp(C_GRASS_LIGHT, clamp(v * 0.5 + 0.55, 0, 1));

  // damp, darker grass only where water actually collects
  out.lerp(C_GRASS_DEEP, smoothstep(3.2, 1.9, h) * 0.5);

  // sandy shoreline hugging the pond
  const pd = Math.hypot(x - POND.x, z - POND.z);
  const shore = smoothstep(POND.r * 1.06, POND.r * 0.72, pd) * smoothstep(4.6, 1.2, Math.abs(h - WATER_LEVEL));
  out.lerp(C_SAND, clamp(shore, 0, 1) * 0.9);

  // worn footpath
  const path = smoothstep(3.6, 0.9, Math.abs(z + 4 - Math.sin(x * 0.06) * 6 - x * 0.42));
  out.lerp(C_DIRT, path * smoothstep(62, 10, Math.hypot(x, z)) * 0.6);

  // rock showing through on the steep hillsides
  out.lerp(C_ROCK, smoothstep(0.42, 0.78, steep) * 0.75);
  return out;
}

export function createGround() {
  const seg = 200;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = normalAt(x, z, 1.0);
    groundColor(x, z, h, 1 - n.y, c);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/**
 * A coarse skirt of land carrying the valley out past the detailed mesh, so
 * the far grass rings have something to stand on and the eye reaches the
 * ridgeline over ground rather than over a cliff edge. Sits fractionally
 * lower than the fine mesh, which therefore always wins where they overlap.
 */
export function createOuterGround() {
  const SPAN = 1200;
  const seg = 120;
  const geo = new THREE.PlaneGeometry(SPAN, SPAN, seg, seg);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h - 0.35);
    const n = normalAt(x, z, 4.0);
    groundColor(x, z, h, 1 - n.y, c);
    // the far ground is seen through more air — let it drift toward the hills
    const k = smoothstep(150, 520, Math.hypot(x, z));
    c.lerp(new THREE.Color('#749072'), k * 0.3);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true }));
  mesh.name = 'outerGround';
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return mesh;
}

/* ───────────────────────── flowers ───────────────────────── */

export function createFlowers(count = 2600) {
  const group = new THREE.Group();
  group.name = 'flowers';

  const petal = new THREE.CircleGeometry(0.11, 6);
  const stem = new THREE.CylinderGeometry(0.012, 0.016, 0.42, 4);
  stem.translate(0, 0.21, 0);

  const palette = ['#f6f2e2', '#f3c9d8', '#f7d97a', '#c9b6ea', '#ffb4a2'];
  const perColor = Math.floor(count / palette.length);

  const stemMat = new THREE.MeshStandardMaterial({ color: '#5c8450' });
  const stems = new THREE.InstancedMesh(stem, stemMat, count);
  const rnd = makeRandom(909);
  const dummy = new THREE.Object3D();

  const heads = palette.map((hex) => {
    const m = new THREE.MeshStandardMaterial({ color: hex, side: THREE.DoubleSide, emissive: new THREE.Color(hex).multiplyScalar(0.12) });
    const im = new THREE.InstancedMesh(petal, m, perColor);
    im.frustumCulled = false;
    return im;
  });
  const headCounts = new Array(palette.length).fill(0);

  let placed = 0, guard = 0;
  while (placed < count && guard < count * 15) {
    guard++;
    const r = Math.sqrt(rnd()) * 92;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < WATER_LEVEL + 0.5) continue;
    if (normalAt(x, z, 1.0).y < 0.72) continue;
    // flowers like company — clump them with a noise field
    if (fbm(x * 0.07, z * 0.07, 3) < 0.06) continue;

    const s = 0.75 + rnd() * 0.7;
    dummy.position.set(x, h, z);
    dummy.rotation.set(0, rnd() * Math.PI, (rnd() - 0.5) * 0.18);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    stems.setMatrixAt(placed, dummy.matrix);

    const ci = (rnd() * palette.length) | 0;
    if (headCounts[ci] < perColor) {
      dummy.position.y = h + 0.42 * s;
      dummy.rotation.set(-Math.PI / 2 + (rnd() - 0.5) * 0.7, 0, rnd() * Math.PI);
      dummy.updateMatrix();
      heads[ci].setMatrixAt(headCounts[ci]++, dummy.matrix);
    }
    placed++;
  }
  stems.count = placed;
  stems.instanceMatrix.needsUpdate = true;
  group.add(stems);
  heads.forEach((im, i) => { im.count = headCounts[i]; im.instanceMatrix.needsUpdate = true; group.add(im); });

  return group;
}

/* ───────────────────────── stones ───────────────────────── */

export function createStones(count = 130) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#8d9188', flatShading: true, vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const rnd = makeRandom(77);
  const dummy = new THREE.Object3D();
  const colors = new Float32Array(count * 3);
  const c = new THREE.Color();

  let placed = 0, guard = 0;
  while (placed < count && guard < count * 20) {
    guard++;
    const r = 8 + Math.sqrt(rnd()) * 100;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < WATER_LEVEL - 0.8) continue;

    const s = 0.3 + rnd() * 0.9;
    dummy.position.set(x, h - s * 0.35, z);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s * (0.8 + rnd() * 0.5), s * (0.6 + rnd() * 0.4), s * (0.8 + rnd() * 0.5));
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    c.setHSL(0.13, 0.1, 0.55 + rnd() * 0.18);
    colors[placed * 3] = c.r; colors[placed * 3 + 1] = c.g; colors[placed * 3 + 2] = c.b;
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  geo.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));
  return mesh;
}

/* ───────────────────────── water ───────────────────────── */

const waterVert = /* glsl */`
  varying vec2 vUvW;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uRain;
  void main() {
    vUvW = uv;
    vec3 p = position;
    float w = sin(p.x * 0.55 + uTime * 0.9) * 0.055
            + sin(p.y * 0.47 - uTime * 1.15) * 0.045
            + sin((p.x + p.y) * 1.3 + uTime * 2.1) * 0.02 * (0.4 + uRain);
    p.z += w;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const waterFrag = /* glsl */`
  precision highp float;
  varying vec2 vUvW;
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uRain;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uSky;
  uniform vec3  uSun;
  uniform vec3  uSunDir;
  uniform vec3  uCam;
  uniform float uFogDensity;
  uniform vec3  uFogColor;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    vec2 c = vUvW - 0.5;
    float edge = smoothstep(0.5, 0.34, length(c));

    // drifting ripple bands
    float r = sin(vWorld.x * 1.7 + uTime * 1.1) * 0.5 + sin(vWorld.z * 1.9 - uTime * 0.8) * 0.5;
    float shimmer = 0.5 + 0.5 * sin(vWorld.x * 5.0 + vWorld.z * 4.2 + uTime * 2.4);

    vec3 col = mix(uDeep, uShallow, smoothstep(0.15, 0.5, length(c)) * 0.85 + r * 0.06);

    // fresnel toward the sky
    vec3 V = normalize(uCam - vWorld);
    float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 2.6);
    col = mix(col, uSky, fres * 0.72);

    // sun glitter
    float spec = pow(max(dot(normalize(vec3(uSunDir.x, 1.0, uSunDir.z)), V), 0.0), 24.0);
    col += uSun * spec * (0.35 + shimmer * 0.25);
    col += uSun * shimmer * 0.035;

    // rain stipple — thousands of tiny impacts
    if (uRain > 0.01) {
      vec2 g = floor(vWorld.xz * 3.4);
      float t = fract(uTime * 1.6 + hash(g) * 3.0);
      vec2 f = fract(vWorld.xz * 3.4) - 0.5;
      float ring = smoothstep(0.02, 0.0, abs(length(f) - t * 0.45)) * (1.0 - t);
      col += vec3(0.9, 0.96, 1.0) * ring * uRain * 0.5;
    }

    // match the scene fog so the far shore melts away
    float d = length(uCam - vWorld);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
    col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(col, edge * (0.82 + fres * 0.18));
  }
`;

export function createWater() {
  const geo = new THREE.PlaneGeometry(POND.r * 2.15, POND.r * 2.15, 96, 96);
  const mat = new THREE.ShaderMaterial({
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uRain: { value: 0 },
      uShallow: { value: new THREE.Color('#6fb6b0') },
      uDeep: { value: new THREE.Color('#1d4650') },
      uSky: { value: new THREE.Color('#bfe0ef') },
      uSun: { value: new THREE.Color('#ffe9b8') },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      uCam: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color('#cfe2e8') },
      uFogDensity: { value: 0.008 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(POND.x, WATER_LEVEL, POND.z);
  mesh.renderOrder = 2;
  mesh.name = 'water';
  return mesh;
}

/* ───────────────────────── lily pads ───────────────────────── */

export function createLilyPads(count = 34) {
  const group = new THREE.Group();
  group.name = 'lilies';
  const padGeo = new THREE.CircleGeometry(0.62, 12);
  // notch the pad so it reads as a lily leaf from above
  const padMat = new THREE.MeshStandardMaterial({ color: '#5d9457', side: THREE.DoubleSide });
  const flowerGeo = new THREE.SphereGeometry(0.16, 8, 6);
  const flowerMat = new THREE.MeshStandardMaterial({ color: '#f7e2ec', emissive: '#3a1f2a' });

  const rnd = makeRandom(31415);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2 + Math.sqrt(rnd()) * (POND.r * 0.78);
    const x = POND.x + Math.cos(a) * r;
    const z = POND.z + Math.sin(a) * r;

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rnd() * Math.PI;
    pad.position.set(x, WATER_LEVEL + 0.03, z);
    pad.scale.setScalar(0.7 + rnd() * 0.8);
    pad.userData.bob = rnd() * Math.PI * 2;
    group.add(pad);

    if (rnd() < 0.28) {
      const f = new THREE.Mesh(flowerGeo, flowerMat);
      f.position.set(x, WATER_LEVEL + 0.16, z);
      f.scale.y = 1.4;
      group.add(f);
    }
  }
  return group;
}
