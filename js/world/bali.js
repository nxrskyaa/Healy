import * as THREE from 'three';
import { makeRandom } from './noise.js';
import { heightAt, POND } from './terrain.js';

/* ═══════════════════════════════════════════════════════════
   The Balinese set. A candi bentar split gate astride the
   footpath, a five-tiered meru beside the pond, a bale
   pavilion to shelter in, penjor poles arcing over the path,
   and strings of paper lanterns that come alive after dark.

   Everything is boxes, lathes and cones — the silhouettes are
   what read, and Balinese architecture is nothing but strong
   silhouettes.
   ═══════════════════════════════════════════════════════════ */

const TAU = Math.PI * 2;

const M = {
  brick:  new THREE.MeshLambertMaterial({ color: '#8a4a36' }),
  brick2: new THREE.MeshLambertMaterial({ color: '#7a4030' }),
  stone:  new THREE.MeshLambertMaterial({ color: '#7d7568' }),
  stoneD: new THREE.MeshLambertMaterial({ color: '#5f584e' }),
  thatch: new THREE.MeshLambertMaterial({ color: '#28211b' }),
  wood:   new THREE.MeshLambertMaterial({ color: '#6b4f38' }),
  gold:   new THREE.MeshLambertMaterial({ color: '#c9992e' }),
  bambooM: new THREE.MeshLambertMaterial({ color: '#a8a05e' }),
  leaf:   new THREE.MeshLambertMaterial({ color: '#c9c069' }),
  cloth:  new THREE.MeshLambertMaterial({ color: '#e8e0c8', side: THREE.DoubleSide }),
};

const box = (w, h, d, mat, x, y, z, ry = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  return m;
};

/* ───────────── candi bentar: the split gate ─────────────
   Two mirrored towers of shrinking brick tiers with stone
   caps, a clean vertical inner face, and a gap you walk
   through. The profile IS the architecture. */

function candiBentar() {
  const g = new THREE.Group();
  g.name = 'candiBentar';
  const GAP = 0.85;                 // half-width of the walkway

  // tier widths/heights from plinth to crown, hand-shaped
  const tiers = [
    [1.35, 0.5, M.stone], [1.2, 0.42, M.brick], [1.05, 0.4, M.brick2],
    [0.95, 0.55, M.brick], [0.8, 0.34, M.stone], [0.66, 0.42, M.brick],
    [0.5, 0.34, M.brick2], [0.36, 0.3, M.brick], [0.22, 0.34, M.stone],
  ];
  for (const side of [-1, 1]) {
    let y = 0;
    for (const [w, h, mat] of tiers) {
      // the inner faces stay flush: the gate is a single silhouette split in two
      const cx = side * (GAP + w / 2);
      g.add(box(w, h, w * 0.82, mat, cx, y + h / 2, 0));
      // a thin stone lip between tiers, jutting slightly
      if (h > 0.38) {
        g.add(box(w * 1.14, 0.07, w * 0.94, M.stoneD, cx, y + h + 0.035, 0));
      }
      y += h + 0.075;
    }
    // curled finial hinting at the carved wings
    const wing = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), M.stone);
    wing.scale.set(0.6, 1.4, 0.6);
    wing.position.set(side * (GAP + 0.18), y + 0.1, 0);
    g.add(wing);
  }

  // steps through the gap
  for (let i = 0; i < 3; i++) {
    g.add(box(GAP * 2 + 0.5, 0.12, 1.6 - i * 0.35, M.stoneD, 0, 0.06 + i * 0.12, 0));
  }
  return g;
}

/* ───────────── meru: the tiered tower ───────────── */

function meru(tiersN = 5) {
  const g = new THREE.Group();
  g.name = 'meru';

  // stone base, two steps
  g.add(box(3.4, 0.5, 3.4, M.stoneD, 0, 0.25, 0));
  g.add(box(2.7, 0.5, 2.7, M.stone, 0, 0.75, 0));

  // brick body with a gold door on the front
  g.add(box(1.7, 1.5, 1.7, M.brick, 0, 1.75, 0));
  const door = box(0.55, 0.9, 0.08, M.gold, 0, 1.65, 0.87);
  g.add(door);
  const lamp = new THREE.PointLight(0xffb35c, 0, 9, 2);
  lamp.position.set(0, 1.8, 1.3);
  g.add(lamp);

  // the stacked fibre roofs — the skyline of every Balinese village
  let y = 2.6;
  for (let i = 0; i < tiersN; i++) {
    const t = i / (tiersN - 1);
    const r = 1.9 * (1 - t * 0.72);
    const h = 0.62 - t * 0.1;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r, h, 4), M.thatch);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = y + h / 2;
    roof.castShadow = true;
    g.add(roof);
    // short neck between tiers
    if (i < tiersN - 1) {
      g.add(box(r * 0.5, 0.34, r * 0.5, M.wood, 0, y + h + 0.17, 0));
    }
    y += h + 0.36;
  }
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), M.gold);
  finial.position.y = y + 0.02;
  g.add(finial);

  g.userData.lamp = lamp;
  return g;
}

/* ───────────── bale: the open pavilion ───────────── */

function bale() {
  const g = new THREE.Group();
  g.name = 'bale';

  g.add(box(3.4, 0.45, 2.8, M.stone, 0, 0.22, 0));
  g.add(box(3.0, 0.25, 2.4, M.stoneD, 0, 0.57, 0));

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.9, 8), M.wood);
      post.position.set(sx * 1.2, 1.6, sz * 0.95);
      post.castShadow = true;
      g.add(post);
    }
  }
  g.add(box(2.9, 0.12, 2.3, M.wood, 0, 2.55, 0));

  // two-tier hip roof in dark thatch
  const r1 = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.15, 4), M.thatch);
  r1.rotation.y = Math.PI / 4;
  r1.scale.z = 0.82;
  r1.position.y = 3.15;
  r1.castShadow = true;
  const r2 = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.8, 4), M.thatch);
  r2.rotation.y = Math.PI / 4;
  r2.scale.z = 0.82;
  r2.position.y = 4.05;
  r2.castShadow = true;
  g.add(r1, r2);

  const lamp = new THREE.PointLight(0xffb765, 0, 12, 2);
  lamp.position.set(0, 2.2, 0);
  g.add(lamp);
  g.userData.lamp = lamp;
  return g;
}

/* ───────────── penjor: the bowed bamboo poles ───────────── */

function penjor(rnd) {
  const g = new THREE.Group();
  const bend = 1.9 + rnd() * 0.9;
  const H = 4.6 + rnd() * 1.2;
  const pts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.05, H * 0.45, 0),
    new THREE.Vector3(bend * 0.28, H * 0.82, 0),
    new THREE.Vector3(bend * 0.75, H * 0.98, 0),
    new THREE.Vector3(bend * 1.25, H * 0.92, 0),
  ];
  const curve = new THREE.CatmullRomCurve3(pts);
  const pole = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.05, 6), M.bambooM);
  pole.castShadow = true;
  g.add(pole);

  // fringe of young-coconut leaf along the arc
  for (let i = 0; i < 5; i++) {
    const u = 0.55 + (i / 5) * 0.44;
    const p = curve.getPoint(u);
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.5 + rnd() * 0.25, 5), M.leaf);
    tuft.position.set(p.x, p.y - 0.28, p.z);
    tuft.rotation.z = 0.15 - rnd() * 0.3;
    g.add(tuft);
  }
  // the hanging sampian at the tip
  const tip = curve.getPoint(1);
  const tassel = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.55, 6), M.leaf);
  tassel.position.set(tip.x, tip.y - 0.4, tip.z);
  g.add(tassel);
  return g;
}

/* ───────────── lantern strings ───────────── */

const LANTERN_TINTS = ['#d96f4a', '#e6c46a', '#bf4b3e', '#e5ddc2', '#c98a4a'];

function lanternString(A, B, glowMats, rnd, sag = 1.1) {
  const g = new THREE.Group();
  const N = 7;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    pts.push(new THREE.Vector3(
      A.x + (B.x - A.x) * u,
      A.y + (B.y - A.y) * u - Math.sin(u * Math.PI) * sag,
      A.z + (B.z - A.z) * u
    ));
  }
  // the cord
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 4), M.wood);
    seg.position.copy(a).add(b).multiplyScalar(0.5);
    seg.lookAt(b);
    seg.rotateX(Math.PI / 2);
    g.add(seg);
  }
  // the lanterns, one per interior knot
  for (let i = 1; i < N; i++) {
    const tint = LANTERN_TINTS[(rnd() * LANTERN_TINTS.length) | 0];
    const mat = new THREE.MeshLambertMaterial({
      color: tint, emissive: new THREE.Color(tint), emissiveIntensity: 0,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mat);
    shell.scale.y = 1.25;
    shell.position.copy(pts[i]);
    shell.position.y -= 0.16;
    g.add(shell);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 8), M.wood);
    cap.position.copy(shell.position);
    cap.position.y += 0.17;
    g.add(cap);
    glowMats.push(mat);
  }
  return g;
}

function pole(h = 2.6) {
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 6), M.wood);
  p.position.y = h / 2;
  p.castShadow = true;
  return p;
}

/* ───────────── assembly ───────────── */

const pathZ = (x) => x * 0.42 + Math.sin(x * 0.06) * 6 - 4;
const pathTangent = (x) => Math.atan2(1, 0.42 + Math.cos(x * 0.06) * 0.36);

export function buildBali(scene) {
  const rnd = makeRandom(8899);
  const group = new THREE.Group();
  group.name = 'bali';
  const glowMats = [];
  const lights = [];

  const place = (obj, x, z, ry = 0, sink = 0.08) => {
    obj.position.set(x, heightAt(x, z) - sink, z);
    obj.rotation.y = ry;
    group.add(obj);
    return obj;
  };

  // the split gate astride the footpath
  const gate = candiBentar();
  place(gate, 9, pathZ(9), pathTangent(9), 0.15);

  // meru by the pond, doubled in the water on still days
  const mr = meru(5);
  place(mr, 55, -44, -0.9);
  lights.push(mr.userData.lamp);

  // bale on the knoll where the cottage used to sit
  const bl = bale();
  place(bl, 22, 26, -0.6);
  lights.push(bl.userData.lamp);

  // a second, smaller meru shrine on the west rise
  const mr2 = meru(3);
  mr2.scale.setScalar(0.62);
  place(mr2, -34, -6, 0.7);

  // penjor bowing over the path, alternating sides
  for (let i = 0; i < 6; i++) {
    const x = -14 + i * 8;
    const side = i % 2 === 0 ? 1 : -1;
    const p = penjor(rnd);
    const z = pathZ(x) + side * 2.6;
    p.position.set(x, heightAt(x, z) - 0.05, z);
    // bow across the path
    p.rotation.y = side > 0 ? Math.PI + pathTangent(x) : pathTangent(x);
    group.add(p);
  }

  // lantern strings: gate → bale direction, and around the bale
  const strings = [
    [[11.5, pathZ(11.5) + 1.5], [16, 16]],
    [[16, 16], [21, 24.2]],
    [[23.5, 27.8], [30, 30]],
    [[4, 6], [-3, 10]],
  ];
  for (const [[ax, az], [bx, bz]] of strings) {
    const ah = heightAt(ax, az), bh = heightAt(bx, bz);
    const pa = pole(2.7); pa.position.set(ax, ah, az); group.add(pa);
    const pb = pole(2.7); pb.position.set(bx, bh, bz); group.add(pb);
    group.add(lanternString(
      new THREE.Vector3(ax, ah + 2.62, az),
      new THREE.Vector3(bx, bh + 2.62, bz),
      glowMats, rnd, 0.8 + rnd() * 0.5
    ));
  }

  // two string-light points get real light
  const sl1 = new THREE.PointLight(0xffa860, 0, 10, 2);
  sl1.position.set(16, heightAt(16, 16) + 2.2, 16);
  const sl2 = new THREE.PointLight(0xffa860, 0, 10, 2);
  sl2.position.set(0.5, heightAt(0.5, 8) + 2.2, 8);
  group.add(sl1, sl2);
  lights.push(sl1, sl2);

  scene.add(group);
  return { group, glowMats, lights };
}
