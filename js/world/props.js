import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRandom, clamp } from './noise.js';
import { heightAt, normalAt, POND, WATER_LEVEL } from './terrain.js';

/* ═══════════════════════════════════════════════════════════
   Everything that stands on the land: trees, the great tree,
   a cottage, a torii, lanterns, a jetty, mushrooms, petals.
   ═══════════════════════════════════════════════════════════ */

/** Attach a (slightly jittered) vertex colour to a geometry so trees can merge. */
export function paint(geo, hex, jitter = 0.05, rnd = Math.random) {
  const base = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    c.copy(base).offsetHSL((rnd() - 0.5) * jitter * 0.35, (rnd() - 0.5) * jitter, (rnd() - 0.5) * jitter);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Merging demands a uniform attribute set and a uniform index state, so we
 * flatten everything to non-indexed with exactly position/normal/uv/color.
 */
function toMergeable(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const key of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'uv', 'color'].includes(key)) g.deleteAttribute(key);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/** Merge a pile of painted parts into one geometry and clean up after itself. */
export function mergeParts(parts) {
  const flat = parts.map(toMergeable);
  const merged = mergeGeometries(flat, false);
  merged.computeVertexNormals();
  flat.forEach((g, i) => { if (g !== parts[i]) g.dispose(); });
  parts.forEach((g) => g.dispose());
  return merged;
}

const GREENS = ['#4f7f45', '#5f9350', '#6ba75a', '#43703f', '#79ac63'];
const AUTUMN = ['#c98a3f', '#d8a94b', '#b96f3a', '#e0bb5c'];
const BARKS  = ['#6b5140', '#7a5c45', '#5c4536'];

/** One merged, vertex-coloured tree ready to be instanced. */
function buildTreeProto(seed, kind = 'round') {
  const rnd = makeRandom(seed);
  const parts = [];

  const trunkH = kind === 'tall' ? 6.4 + rnd() * 2.2 : 3.4 + rnd() * 1.4;
  const trunkR = kind === 'tall' ? 0.28 : 0.34;
  const trunk = new THREE.CylinderGeometry(trunkR * 0.72, trunkR * 1.5, trunkH, 7, 1);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(paint(trunk, BARKS[(rnd() * BARKS.length) | 0], 0.06, rnd));

  // a couple of limbs reaching out of the trunk
  const limbs = kind === 'tall' ? 2 : 3;
  for (let i = 0; i < limbs; i++) {
    const len = 1.1 + rnd() * 1.3;
    const g = new THREE.CylinderGeometry(0.07, 0.15, len, 5);
    g.translate(0, len / 2, 0);
    const a = rnd() * Math.PI * 2;
    const tilt = 0.55 + rnd() * 0.45;
    g.rotateZ(tilt);
    g.rotateY(a);
    g.translate(0, trunkH * (0.55 + rnd() * 0.3), 0);
    parts.push(paint(g, BARKS[0], 0.05, rnd));
  }

  const pal = kind === 'autumn' ? AUTUMN : GREENS;
  const blobs = kind === 'tall' ? 5 : 7 + ((rnd() * 3) | 0);
  const canopyY = trunkH + (kind === 'tall' ? 1.1 : 0.9);
  const spread = kind === 'tall' ? 1.5 : 2.3;

  for (let i = 0; i < blobs; i++) {
    const r = (kind === 'tall' ? 1.1 : 1.35) * (0.62 + rnd() * 0.7);
    const g = new THREE.IcosahedronGeometry(r, 1);
    const a = (i / blobs) * Math.PI * 2 + rnd() * 0.8;
    const rad = i === 0 ? 0 : spread * (0.35 + rnd() * 0.7);
    g.translate(
      Math.cos(a) * rad,
      canopyY + (i === 0 ? 0.5 : 0) + (rnd() - 0.4) * 1.3,
      Math.sin(a) * rad
    );
    g.scale(1, 0.82 + rnd() * 0.2, 1);
    parts.push(paint(g, pal[(rnd() * pal.length) | 0], 0.09, rnd));
  }

  return mergeParts(parts);
}

/** Shared foliage material with a wind sway baked into the vertex stage. */
function foliageMaterial(uniforms, { amp = 1, instanced = true } = {}) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWind = uniforms.uWind;
    shader.uniforms.uAmp = { value: amp };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `
        #include <common>
        uniform float uTime; uniform float uWind; uniform float uAmp;
      `)
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        ${instanced
          ? 'vec3 orig = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;'
          : 'vec3 orig = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;'}
        float ph = orig.x * 0.11 + orig.z * 0.13;
        float sway = (sin(uTime * 0.65 + ph) * 0.7 + sin(uTime * 1.45 + ph * 2.1) * 0.3) * uWind * uAmp;
        float k = smoothstep(0.6, 5.0, transformed.y) * 0.16 + transformed.y * 0.006;
        transformed.x += sway * k;
        transformed.z += sway * k * 0.55;
      `);
  };
  return mat;
}

/* ───────────────────────── forest ───────────────────────── */

function goodTreeSpot(x, z, rnd) {
  const d = Math.hypot(x, z);
  if (d < 16) return false;                                       // keep the meadow open
  if (d > 132) return false;
  const pd = Math.hypot(x - POND.x, z - POND.z);
  if (pd < POND.r * 1.12) return false;                           // stay out of the water
  const h = heightAt(x, z);
  if (h < WATER_LEVEL + 0.6) return false;
  if (normalAt(x, z, 1.2).y < 0.74) return false;                 // no trees on cliffs
  const path = Math.abs(z + 4 - Math.sin(x * 0.06) * 6 - x * 0.42);
  if (path < 5 && d < 70) return false;                           // leave the footpath clear
  return true;
}

export function createForest(uniforms, count = 190) {
  const group = new THREE.Group();
  group.name = 'forest';

  const protos = [
    { geo: buildTreeProto(11, 'round'),  weight: 0.42 },
    { geo: buildTreeProto(23, 'round'),  weight: 0.22 },
    { geo: buildTreeProto(37, 'tall'),   weight: 0.24 },
    { geo: buildTreeProto(53, 'autumn'), weight: 0.12 },
  ];

  const rnd = makeRandom(2468);
  const buckets = protos.map(() => []);
  const dummy = new THREE.Object3D();

  let placed = 0, guard = 0;
  while (placed < count && guard < count * 40) {
    guard++;
    const r = 16 + Math.sqrt(rnd()) * 116;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!goodTreeSpot(x, z, rnd)) continue;

    // pick a prototype by weight
    let roll = rnd(), pi = 0;
    for (; pi < protos.length - 1; pi++) { roll -= protos[pi].weight; if (roll <= 0) break; }

    const s = 0.7 + rnd() * 0.85 + (r > 80 ? 0.3 : 0);
    dummy.position.set(x, heightAt(x, z) - 0.2, z);
    dummy.rotation.set((rnd() - 0.5) * 0.08, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.08);
    dummy.scale.set(s * (0.9 + rnd() * 0.2), s, s * (0.9 + rnd() * 0.2));
    dummy.updateMatrix();
    buckets[pi].push(dummy.matrix.clone());
    placed++;
  }

  protos.forEach((p, i) => {
    const list = buckets[i];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(p.geo, foliageMaterial(uniforms, { amp: 1 }), list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });

  group.userData.trees = buckets.flat().map((m) => new THREE.Vector3().setFromMatrixPosition(m));
  return group;
}

/* ───────────────────────── the great tree ───────────────────────── */

export function createGreatTree(uniforms) {
  const group = new THREE.Group();
  group.name = 'greatTree';
  const rnd = makeRandom(999);
  const parts = [];

  const H = 17;
  const trunk = new THREE.CylinderGeometry(1.5, 3.4, H, 12, 3);
  trunk.translate(0, H / 2, 0);
  // gently swell the trunk so it isn't a perfect cone
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + Math.sin(y * 0.6) * 0.05;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  parts.push(paint(trunk, '#6d5340', 0.06, rnd));

  // buttress roots
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.3;
    const g = new THREE.CylinderGeometry(0.35, 1.0, 4.2, 6);
    g.translate(0, 1.6, 0);
    g.rotateZ(0.85);
    g.rotateY(a);
    g.translate(Math.cos(a) * 2.1, -0.4, Math.sin(a) * 2.1);
    parts.push(paint(g, '#5e4736', 0.05, rnd));
  }

  // limbs
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.5;
    const len = 5 + rnd() * 3;
    const g = new THREE.CylinderGeometry(0.28, 0.75, len, 6);
    g.translate(0, len / 2, 0);
    g.rotateZ(0.75 + rnd() * 0.25);
    g.rotateY(a);
    g.translate(0, H * (0.66 + rnd() * 0.2), 0);
    parts.push(paint(g, '#6d5340', 0.05, rnd));
  }

  // huge billowing canopy
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const rad = Math.pow(rnd(), 0.55) * 9.5;
    const r = 3.4 * (0.55 + rnd() * 0.7) * (1 - rad / 16);
    const g = new THREE.IcosahedronGeometry(Math.max(1.2, r), 1);
    g.scale(1, 0.78, 1);
    g.translate(Math.cos(a) * rad, H + 3.2 + (rnd() - 0.35) * 4.5 - rad * 0.18, Math.sin(a) * rad);
    parts.push(paint(g, GREENS[(rnd() * GREENS.length) | 0], 0.1, rnd));
  }

  const geo = mergeParts(parts);
  const mesh = new THREE.Mesh(geo, foliageMaterial(uniforms, { amp: 0.7, instanced: false }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  // a rope swing hanging from one limb
  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 6.4, 5),
    new THREE.MeshLambertMaterial({ color: '#b9a37c' })
  );
  rope.position.set(3.6, H * 0.72 - 3.2, 1.2);
  group.add(rope);
  const plank = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.12, 0.5),
    new THREE.MeshLambertMaterial({ color: '#a8825c' })
  );
  plank.position.set(3.6, H * 0.72 - 6.4, 1.2);
  plank.castShadow = true;
  group.add(plank);
  group.userData.swing = { rope, plank, pivotY: H * 0.72 };

  const gx = -26, gz = 20;
  group.position.set(gx, heightAt(gx, gz) - 0.5, gz);
  return group;
}

/* ───────────────────────── cottage ───────────────────────── */

export function createCottage() {
  const group = new THREE.Group();
  group.name = 'cottage';

  const wallMat = new THREE.MeshLambertMaterial({ color: '#e8dfc6' });
  const beamMat = new THREE.MeshLambertMaterial({ color: '#7d6144' });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#7f6a52', flatShading: true });

  const body = new THREE.Mesh(new THREE.BoxGeometry(6.4, 3.5, 5.2), wallMat);
  body.position.y = 1.75;
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 3.1, 4), roofMat);
  roof.position.y = 5.0;
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.86);
  roof.castShadow = true;
  group.add(roof);

  // half-timbered beams
  const beams = [
    [0, 0.15, 2.62, 6.4, 0.3, 0.16], [0, 3.4, 2.62, 6.4, 0.3, 0.16],
    [-3.1, 1.75, 2.62, 0.28, 3.5, 0.16], [3.1, 1.75, 2.62, 0.28, 3.5, 0.16],
  ];
  for (const [x, y, z, w, h, d] of beams) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), beamMat);
    b.position.set(x, y, z);
    group.add(b);
  }

  const door = new THREE.Mesh(new THREE.BoxGeometry(1.25, 2.1, 0.2), beamMat);
  door.position.set(-1.4, 1.05, 2.63);
  group.add(door);

  // windows that glow once the sun goes down
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd48a', transparent: true, opacity: 0 });
  const winFrames = [[1.5, 2.0, 2.63, 0], [3.25, 2.0, 0.6, Math.PI / 2]];
  const glows = [];
  for (const [x, y, z, ry] of winFrames) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.3, 0.16), beamMat);
    frame.position.set(x, y, z); frame.rotation.y = ry;
    group.add(frame);
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.05), glowMat.clone());
    g.position.set(x + Math.sin(ry) * 0.11, y, z + Math.cos(ry) * 0.11);
    g.rotation.y = ry;
    group.add(g);
    glows.push(g);
  }

  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.4, 0.9), new THREE.MeshLambertMaterial({ color: '#9c8874' }));
  chimney.position.set(-2.0, 5.2, -1.2);
  chimney.castShadow = true;
  group.add(chimney);

  const lamp = new THREE.PointLight(0xffb765, 0, 16, 2);
  lamp.position.set(0, 2.4, 3.4);
  group.add(lamp);

  const cx = 22, cz = 26;
  group.position.set(cx, heightAt(cx, cz) - 0.1, cz);
  group.rotation.y = -0.6;
  group.userData = { glows, lamp };
  return group;
}

/* ───────────────────────── torii + lanterns + jetty ───────────────────────── */

export function createShrine() {
  const group = new THREE.Group();
  group.name = 'shrine';
  const red = new THREE.MeshLambertMaterial({ color: '#c1503f' });
  const dark = new THREE.MeshLambertMaterial({ color: '#3c2b25' });

  const mk = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = true;
    group.add(m); return m;
  };

  const pillar = new THREE.CylinderGeometry(0.26, 0.32, 5.2, 10);
  mk(pillar, red, -2.3, 2.6, 0);
  mk(pillar, red,  2.3, 2.6, 0);
  const top = new THREE.BoxGeometry(6.4, 0.34, 0.62);
  mk(top, dark, 0, 5.3, 0);
  mk(new THREE.BoxGeometry(5.4, 0.26, 0.5), red, 0, 4.6, 0);
  mk(new THREE.BoxGeometry(0.36, 0.5, 0.36), red, 0, 5.0, 0);

  const sx = -6, sz = -34;
  group.position.set(sx, heightAt(sx, sz), sz);
  group.rotation.y = 0.5;
  return group;
}

export function createLanterns(spots) {
  const group = new THREE.Group();
  group.name = 'lanterns';
  const stone = new THREE.MeshLambertMaterial({ color: '#a9a396' });
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffc978' });
  const glows = [];
  const lights = [];

  spots.forEach(([x, z], i) => {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 0.5, 8), stone);
    base.position.y = 0.25;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.1, 8), stone);
    stem.position.y = 1.0;
    const box = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.4, 0.62, 6), stone);
    box.position.y = 1.85;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.5, 6), stone);
    cap.position.y = 2.42;
    const fire = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), glowMat.clone());
    fire.position.y = 1.85;
    fire.material.transparent = true;
    fire.material.opacity = 0;
    [base, stem, box, cap].forEach((m) => { m.castShadow = true; g.add(m); });
    g.add(fire);
    glows.push(fire);

    if (i < 4) {
      const pl = new THREE.PointLight(0xffb35c, 0, 13, 2);
      pl.position.y = 1.9;
      g.add(pl);
      lights.push(pl);
    }
    g.position.set(x, heightAt(x, z) - 0.1, z);
    group.add(g);
  });

  group.userData = { glows, lights };
  return group;
}

export function createJetty() {
  const group = new THREE.Group();
  group.name = 'jetty';
  const wood = new THREE.MeshLambertMaterial({ color: '#9b7a55' });

  const dirX = -1, dirZ = 0.35;
  const len = Math.hypot(dirX, dirZ);
  const ux = dirX / len, uz = dirZ / len;
  const startX = POND.x - ux * (POND.r * 0.98);
  const startZ = POND.z - uz * (POND.r * 0.98);

  for (let i = 0; i < 9; i++) {
    const px = startX + ux * i * 0.95;
    const pz = startZ + uz * i * 0.95;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 2.1), wood);
    plank.position.set(px, WATER_LEVEL + 0.42, pz);
    plank.rotation.y = Math.atan2(uz, ux);
    plank.castShadow = true; plank.receiveShadow = true;
    group.add(plank);
    if (i % 3 === 0) {
      for (const s of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.4, 6), wood);
        post.position.set(px - uz * s * 0.9, WATER_LEVEL - 0.5, pz + ux * s * 0.9);
        group.add(post);
      }
    }
  }
  return group;
}

export function createMushrooms(count = 70) {
  const group = new THREE.Group();
  group.name = 'mushrooms';
  const capGeo = new THREE.SphereGeometry(0.26, 10, 7, 0, Math.PI * 2, 0, Math.PI / 2);
  const stemGeo = new THREE.CylinderGeometry(0.07, 0.1, 0.3, 6);
  const capMat = new THREE.MeshLambertMaterial({ color: '#d0685c', emissive: '#2a0e0c' });
  const capMat2 = new THREE.MeshLambertMaterial({ color: '#e8dcc0' });
  const stemMat = new THREE.MeshLambertMaterial({ color: '#f2ead6' });

  const caps = new THREE.InstancedMesh(capGeo, capMat, count);
  const caps2 = new THREE.InstancedMesh(capGeo, capMat2, count);
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, count * 2);
  const rnd = makeRandom(606);
  const d = new THREE.Object3D();
  let a = 0, b = 0, s = 0, guard = 0;

  while (a + b < count && guard < count * 30) {
    guard++;
    const r = 20 + Math.sqrt(rnd()) * 100;
    const ang = rnd() * Math.PI * 2;
    const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
    const h = heightAt(x, z);
    if (h < WATER_LEVEL + 0.5) continue;
    if (normalAt(x, z, 1.0).y < 0.8) continue;

    const sc = 0.7 + rnd() * 1.1;
    d.position.set(x, h + 0.3 * sc, z);
    d.rotation.set(0, rnd() * 3, 0);
    d.scale.setScalar(sc);
    d.updateMatrix();
    if (rnd() < 0.6) caps.setMatrixAt(a++, d.matrix); else caps2.setMatrixAt(b++, d.matrix);

    d.position.y = h + 0.15 * sc;
    d.updateMatrix();
    stems.setMatrixAt(s++, d.matrix);
  }
  caps.count = a; caps2.count = b; stems.count = s;
  [caps, caps2, stems].forEach((m) => { m.instanceMatrix.needsUpdate = true; m.castShadow = true; group.add(m); });
  return group;
}

/* ───────────────────────── point sprites ─────────────────────────
   Bare PointsMaterial draws hard squares, which look like debris.
   Both particle systems get a soft procedural sprite instead. */

function spriteTexture(draw, size = 64) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const glowSprite = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,244,190,0.85)');
  g.addColorStop(0.55, 'rgba(255,220,120,0.28)');
  g.addColorStop(1.0, 'rgba(255,210,100,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const petalSprite = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s * 0.45, s * 0.4, 0, s * 0.5, s * 0.5, s * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.save();
  ctx.translate(s / 2, s / 2);
  ctx.rotate(-0.5);
  ctx.scale(1, 0.62);                       // a leaf, not a ball
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
});

/* ───────────────────────── drifting petals ───────────────────────── */

export function createPetals(count = 420) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const rnd = makeRandom(1212);
  const data = [];
  const c = new THREE.Color();
  const tints = ['#f7d6de', '#fbeccd', '#dcecc8', '#f6f0dd'];

  for (let i = 0; i < count; i++) {
    const x = (rnd() - 0.5) * 150, z = (rnd() - 0.5) * 150;
    const y = 1 + rnd() * 22;
    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    c.set(tints[(rnd() * tints.length) | 0]);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    data.push({ ph: rnd() * Math.PI * 2, spin: 0.3 + rnd() * 0.8, fall: 0.25 + rnd() * 0.5 });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.19, map: petalSprite(), vertexColors: true,
    transparent: true, opacity: 0.9, alphaTest: 0.02,
    depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'petals';
  pts.userData = { data };
  return pts;
}

export function updatePetals(pts, dt, elapsed, center, wind) {
  const pos = pts.geometry.attributes.position;
  const d = pts.userData.data;
  for (let i = 0; i < d.length; i++) {
    const o = d[i];
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    y -= o.fall * dt * (0.6 + wind * 0.8);
    x += Math.sin(elapsed * o.spin + o.ph) * dt * 1.4 + wind * dt * 1.6;
    z += Math.cos(elapsed * o.spin * 0.8 + o.ph) * dt * 1.0;

    // recycle around the camera so petals are always where you're looking
    if (y < heightAt(x, z) - 0.5) { y = 22 + Math.random() * 6; }
    const dx = x - center.x, dz = z - center.z;
    if (Math.abs(dx) > 78) x -= Math.sign(dx) * 156;
    if (Math.abs(dz) > 78) z -= Math.sign(dz) * 156;

    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
}

/* ───────────────────────── fireflies ───────────────────────── */

export function createFireflies(count = 300) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const rnd = makeRandom(3141);
  const data = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 6 + Math.sqrt(rnd()) * 70;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pos[i * 3] = x; pos[i * 3 + 1] = heightAt(x, z) + 0.6 + rnd() * 3; pos[i * 3 + 2] = z;
    data.push({ ph: rnd() * 9, sp: 0.3 + rnd() * 0.9, r: 0.5 + rnd() * 1.6, ox: x, oz: z });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffe4a0, size: 0.3, map: glowSprite(), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'fireflies';
  pts.userData = { data };
  return pts;
}

export function updateFireflies(pts, dt, elapsed, nightFactor) {
  pts.material.opacity = clamp(nightFactor, 0, 1) * 0.95;
  if (pts.material.opacity < 0.02) return;
  const pos = pts.geometry.attributes.position;
  const d = pts.userData.data;
  for (let i = 0; i < d.length; i++) {
    const o = d[i];
    const x = o.ox + Math.sin(elapsed * o.sp + o.ph) * o.r * 2.2;
    const z = o.oz + Math.cos(elapsed * o.sp * 0.7 + o.ph * 1.3) * o.r * 2.2;
    const y = heightAt(x, z) + 0.7 + Math.sin(elapsed * o.sp * 1.6 + o.ph) * 0.8 + o.r;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
}
