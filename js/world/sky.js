import * as THREE from 'three';
import { makeRandom, fbm, clamp } from './noise.js';

/* ═══════════════════════════════════════════════════════════
   Sky, sun & moon, painterly clouds, distant ridgelines.
   One `time` value in [0,1) drives the whole day:
     0.00 sunrise · 0.25 noon · 0.50 sunset · 0.75 midnight
   ═══════════════════════════════════════════════════════════ */

const KEYS = [
  { t: 0.00, top: '#3b5f92', mid: '#c98f8a', bot: '#f6c88f', sun: '#ffcf99', sunI: 0.55, amb: '#7d7f9c', ambI: 0.62, fog: '#e0bda6', cloud: '#ffd9b8', cloudLo: '#a48099', stars: 0.25 },
  { t: 0.12, top: '#3f8ccb', mid: '#a7d6ec', bot: '#e6f3f4', sun: '#fff0cf', sunI: 1.15, amb: '#a6c6dc', ambI: 0.88, fog: '#dcf0f4', cloud: '#fffdf6', cloudLo: '#c8d8e4', stars: 0.0 },
  { t: 0.25, top: '#2f7ec6', mid: '#8fc9e9', bot: '#e9f5f3', sun: '#fff8e6', sunI: 1.35, amb: '#b0cfe0', ambI: 0.95, fog: '#e0f1f4', cloud: '#ffffff', cloudLo: '#c2d4e2', stars: 0.0 },
  { t: 0.40, top: '#3a84c4', mid: '#a5cfe4', bot: '#f2eddc', sun: '#ffeec6', sunI: 1.2,  amb: '#b4c8d2', ambI: 0.9,  fog: '#e6ecec', cloud: '#fff9ec', cloudLo: '#c9cfda', stars: 0.0 },
  { t: 0.50, top: '#2d4f80', mid: '#e08f68', bot: '#f8cd8c', sun: '#ff9a52', sunI: 0.85, amb: '#94778c', ambI: 0.62, fog: '#e8b593', cloud: '#ffcba0', cloudLo: '#96708c', stars: 0.12 },
  { t: 0.58, top: '#1b2c50', mid: '#5b5580', bot: '#b07c8c', sun: '#c98ba0', sunI: 0.32, amb: '#4e5578', ambI: 0.46, fog: '#8f7d94', cloud: '#b795a8', cloudLo: '#5a5175', stars: 0.55 },
  { t: 0.70, top: '#0a1226', mid: '#132241', bot: '#2b3b58', sun: '#9db6e8', sunI: 0.2,  amb: '#2b3a5e', ambI: 0.36, fog: '#1d2b44', cloud: '#5f7096', cloudLo: '#2a3552', stars: 1.0 },
  { t: 0.88, top: '#080f20', mid: '#101d38', bot: '#243350', sun: '#a8c0ee', sunI: 0.2,  amb: '#2a3a60', ambI: 0.36, fog: '#1a2740', cloud: '#63749b', cloudLo: '#2b3654', stars: 1.0 },
  { t: 1.00, top: '#3b5f92', mid: '#c98f8a', bot: '#f6c88f', sun: '#ffcf99', sunI: 0.55, amb: '#7d7f9c', ambI: 0.62, fog: '#e0bda6', cloud: '#ffd9b8', cloudLo: '#a48099', stars: 0.25 },
];

// pre-parse the hex strings once
const PALETTE = KEYS.map((k) => ({
  t: k.t,
  top: new THREE.Color(k.top), mid: new THREE.Color(k.mid), bot: new THREE.Color(k.bot),
  sun: new THREE.Color(k.sun), amb: new THREE.Color(k.amb),
  fog: new THREE.Color(k.fog), cloud: new THREE.Color(k.cloud), cloudLo: new THREE.Color(k.cloudLo),
  sunI: k.sunI, ambI: k.ambI, stars: k.stars,
}));

const SILHOUETTE = new THREE.Color('#4d6a66');

const skyVert = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = /* glsl */`
  precision highp float;
  varying vec3 vDir;
  uniform vec3  uTop, uMid, uBot, uSunCol;
  uniform vec3  uSunDir, uMoonDir;
  uniform float uStars, uSunUp, uTime;

  float hash31(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);

    // three-stop vertical wash — horizon haze, mid band, deep zenith
    vec3 col = mix(uBot, uMid, smoothstep(-0.06, 0.28, h));
    col = mix(col, uTop, smoothstep(0.20, 0.78, h));

    /* The air is not the same colour in every direction: it warms toward
       the sun right down at the horizon and cools away from it. This one
       asymmetry is most of what separates a painted sky from a gradient. */
    vec2 dxz = normalize(d.xz + vec2(1e-5));
    vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
    float toSun = dot(dxz, sxz) * 0.5 + 0.5;
    float horiz = 1.0 - smoothstep(0.0, 0.5, h);
    col = mix(col, uSunCol, pow(toSun, 3.5) * horiz * uSunUp * 0.42);
    col *= mix(vec3(1.0), vec3(0.93, 0.97, 1.05), pow(1.0 - toSun, 2.5) * horiz * uSunUp * 0.6);
    // and the zenith saturates a little toward the anti-solar side
    col *= mix(vec3(1.0), vec3(0.96, 0.985, 1.03), smoothstep(0.3, 0.9, h) * uSunUp * 0.5);

    // stars (fixed to the dome, twinkling gently)
    if (uStars > 0.01) {
      vec3 g = floor(d * 260.0);
      float r = hash31(g);
      float s = smoothstep(0.9975, 0.99985, r);
      float tw = 0.65 + 0.35 * sin(uTime * 2.4 + r * 90.0);
      col += vec3(0.85, 0.9, 1.0) * s * tw * uStars * smoothstep(-0.02, 0.25, h) * 1.6;
    }

    // sun: hot core, wide warm bloom
    float sd = max(dot(d, uSunDir), 0.0);
    float disc = smoothstep(0.9985, 0.99955, sd);
    float glow = pow(sd, 220.0) * 0.55 + pow(sd, 14.0) * 0.20 + pow(sd, 3.0) * 0.07;
    col += uSunCol * (disc * 1.5 + glow) * uSunUp;

    // moon: crisp disc plus a cool halo
    float md = max(dot(d, uMoonDir), 0.0);
    float mdisc = smoothstep(0.9992, 0.99975, md);
    float mglow = pow(md, 400.0) * 0.4 + pow(md, 24.0) * 0.08;
    float night = 1.0 - uSunUp;
    col += vec3(0.92, 0.95, 1.0) * (mdisc * 1.25 + mglow) * night;

    // faint band of high cirrus so the sky is never flat
    float band = sin(d.x * 6.0 + d.z * 4.0 + uTime * 0.03) * 0.5 + 0.5;
    col += vec3(0.06, 0.05, 0.04) * band * smoothstep(0.05, 0.5, h) * uSunUp;

    // dither the dome itself; a sky gradient must never band
    float dth = hash31(d * 719.7);
    col += (dth - 0.5) / 200.0;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/* ───────────────────────── cloud sprite texture ───────────────────────── */

function cloudTexture(seed) {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const rnd = makeRandom(seed);

  const puffs = 18;
  for (let i = 0; i < puffs; i++) {
    const nx = (rnd() - 0.5) * 1.55;                      // -0.78 … 0.78
    const px = S * (0.5 + nx * 0.5);
    const lift = Math.pow(Math.max(0, 1 - Math.abs(nx)), 1.4);
    const py = S * (0.66 - lift * (0.16 + rnd() * 0.2));
    const r = S * (0.09 + rnd() * 0.15) * (0.55 + lift * 0.75);

    const g = ctx.createRadialGradient(px, py - r * 0.3, r * 0.06, px, py, r);
    g.addColorStop(0.0, 'rgba(255,255,255,0.98)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.62)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // soften the base so clouds sit on an invisible shelf, like painted cumulus
  const fade = ctx.createLinearGradient(0, S * 0.6, 0, S * 0.92);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = fade;
  ctx.fillRect(0, S * 0.6, S, S * 0.4);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ───────────────────────── distant ridgelines ───────────────────────── */

function createRidges() {
  const group = new THREE.Group();
  group.name = 'ridges';
  const rnd = makeRandom(8080);

  const layers = [
    { r: 330, h: 58, color: '#7c9a8e', op: 0.95, n: 16 },
    { r: 450, h: 78, color: '#8fa9b4', op: 0.8,  n: 14 },
    { r: 580, h: 96, color: '#a8bcc8', op: 0.6,  n: 12 },
  ];

  for (const L of layers) {
    const mat = new THREE.MeshBasicMaterial({
      color: L.color, transparent: true, opacity: L.op, fog: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    for (let i = 0; i < L.n; i++) {
      const a = (i / L.n) * Math.PI * 2 + rnd() * 0.25;
      const rad = L.r * (0.9 + rnd() * 0.2);
      const height = L.h * (0.55 + rnd() * 0.75);
      const width = L.r * (0.42 + rnd() * 0.3);

      const geo = new THREE.ConeGeometry(width, height, 5, 1, false);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(Math.cos(a) * rad, height * 0.5 - 24, Math.sin(a) * rad);
      m.rotation.y = rnd() * Math.PI;
      m.renderOrder = -5;
      group.add(m);
    }
  }
  return group;
}

/* ───────────────────────── the system ───────────────────────── */

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.09;             // mid-morning, sun still low and warm
    this.speed = 1 / 1500;        // one full day ≈ 25 real minutes

    this.sunDir = new THREE.Vector3(0, 1, 0.35).normalize();
    this.moonDir = new THREE.Vector3();
    this.fogColor = new THREE.Color('#dcf0f4');
    this.cloudTint = new THREE.Color('#ffffff');
    this.sunColor = new THREE.Color('#fff0cf');
    this.sunIntensity = 1.15;
    this.sunUp = 1;

    // dome
    const geo = new THREE.SphereGeometry(900, 40, 26);
    this.uniforms = {
      uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() },
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uStars: { value: 0 }, uSunUp: { value: 1 }, uTime: { value: 0 },
    };
    this.dome = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // clouds
    this.clouds = new THREE.Group();
    this.clouds.name = 'clouds';
    this.cloudMats = [0, 1, 2].map((i) => new THREE.SpriteMaterial({
      map: cloudTexture(1000 + i * 37),
      transparent: true, depthWrite: false, fog: false,
      opacity: 0.9, color: 0xffffff,
    }));
    const rnd = makeRandom(5150);
    this.cloudData = [];
    for (let i = 0; i < 90; i++) {
      const mat = this.cloudMats[i % 3];
      const s = new THREE.Sprite(mat);
      const ring = 130 + rnd() * 330;
      const a = rnd() * Math.PI * 2;
      const scale = 80 + rnd() * 170;
      s.position.set(Math.cos(a) * ring, 46 + rnd() * 120, Math.sin(a) * ring);
      s.scale.set(scale, scale * (0.42 + rnd() * 0.2), 1);
      s.renderOrder = -8;
      s.material.rotation = 0;
      this.clouds.add(s);
      this.cloudData.push({ sprite: s, speed: 0.5 + rnd() * 1.9, ring, base: s.position.y, ph: rnd() * 9 });
    }
    scene.add(this.clouds);

    this.ridges = createRidges();
    scene.add(this.ridges);

    // lights driven by the sky
    this.sun = new THREE.DirectionalLight(0xffffff, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    /* 60 metres, not 80. The map is a fixed 2048², so shrinking the frustum
       buys 1.8x the texel density AND drops every caster in the discarded
       ring out of the depth pass — the shadow pass was costing nearly forty
       percent of the frame. Past sixty metres the grass has thinned and the
       aerial fog has taken over anyway, so nothing visible is lost. */
    const S = 60;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.05;
    this.sunTarget = new THREE.Object3D();
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);

    this.ambient = new THREE.HemisphereLight(0xbfe0f0, 0x54683f, 0.9);
    scene.add(this.ambient);

    this.fillLight = new THREE.DirectionalLight(0x9fc4e0, 0.22);
    this.fillLight.position.set(-1, 0.6, -0.8);
    scene.add(this.fillLight);

    scene.fog = new THREE.FogExp2(0xdcf0f4, 0.0048);
    this._sample(this.time);
  }

  /** Blend the palette keyframes at a normalised time of day. */
  _sample(t) {
    t = ((t % 1) + 1) % 1;
    let i = 0;
    while (i < PALETTE.length - 2 && PALETTE[i + 1].t <= t) i++;
    const a = PALETTE[i], b = PALETTE[i + 1];
    const k = clamp((t - a.t) / Math.max(1e-5, b.t - a.t), 0, 1);
    const e = k * k * (3 - 2 * k);

    this.uniforms.uTop.value.copy(a.top).lerp(b.top, e);
    this.uniforms.uMid.value.copy(a.mid).lerp(b.mid, e);
    this.uniforms.uBot.value.copy(a.bot).lerp(b.bot, e);
    this.uniforms.uSunCol.value.copy(a.sun).lerp(b.sun, e);
    this.uniforms.uStars.value = a.stars + (b.stars - a.stars) * e;

    this.fogColor.copy(a.fog).lerp(b.fog, e);
    this.sunColor.copy(a.sun).lerp(b.sun, e);
    this.sunIntensity = (a.sunI + (b.sunI - a.sunI) * e) * 1.18;

    this.ambient.color.copy(a.amb).lerp(b.amb, e).lerp(new THREE.Color('#ffffff'), 0.35);
    this.ambient.intensity = (a.ambI + (b.ambI - a.ambI) * e) * 1.3;
    this.ambient.groundColor.set('#54683f').lerp(new THREE.Color('#1e2a24'), 1 - clamp(this.ambient.intensity, 0, 1));

    this.cloudTint.copy(a.cloud).lerp(b.cloud, e);
    this.cloudLo = (this.cloudLo || new THREE.Color()).copy(a.cloudLo).lerp(b.cloudLo, e);
  }

  setTime(t) { this.time = ((t % 1) + 1) % 1; }

  /** Human-readable label for the HUD. */
  label() {
    const t = this.time;
    if (t < 0.06) return 'Dawn';
    if (t < 0.20) return 'Morning';
    if (t < 0.33) return 'Midday';
    if (t < 0.46) return 'Afternoon';
    if (t < 0.55) return 'Golden hour';
    if (t < 0.64) return 'Dusk';
    return 'Night';
  }

  update(dt, elapsed, camera, timeScale = 1) {
    this.time = (this.time + dt * this.speed * timeScale) % 1;
    this._sample(this.time);

    // The sun sweeps a strongly tilted arc and tops out around 50° rather than
    // overhead: a high sun flattens grass into a green plane, a raking one is
    // what gives every blade a lit edge and a long shadow.
    const a = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.sin(a) * 0.88, Math.cos(a) * 0.8, 0.62).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);

    const up = clamp((this.sunDir.y + 0.12) / 0.35, 0, 1);
    this.sunUp = up;
    this.uniforms.uSunUp.value = up;
    this.uniforms.uTime.value = elapsed;

    // below the horizon the moon takes over as the key light
    const dir = up > 0.02 ? this.sunDir : this.moonDir;
    this.sun.position.copy(dir).multiplyScalar(120);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = this.sunIntensity;

    if (camera) {
      this.dome.position.copy(camera.position);
      this.clouds.position.set(camera.position.x * 0.35, 0, camera.position.z * 0.35);
      this.sun.position.add(new THREE.Vector3(camera.position.x, 0, camera.position.z));
      this.sunTarget.position.set(camera.position.x, 0, camera.position.z);
    }

    // drifting clouds, wrapping around the ring
    for (const c of this.cloudData) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 640) c.sprite.position.x = -640;
      c.sprite.position.y = c.base + Math.sin(elapsed * 0.12 + c.ph) * 4.5;
    }
    // lit from the sun side, shaded on the other
    const litFactor = clamp(this.sunDir.y * 0.5 + 0.6, 0, 1);
    for (let i = 0; i < this.cloudMats.length; i++) {
      const m = this.cloudMats[i];
      m.color.copy(this.cloudLo).lerp(this.cloudTint, litFactor * (0.55 + i * 0.22));
    }

    // fog + ridges wash toward the sky colour
    this.scene.fog.color.copy(this.fogColor);
    // Ridges are silhouettes, not lit geometry: keep them close to the fog
    // colour, only a little darker, so they never out-glow the sky.
    this.ridgeTint = this.ridgeTint || new THREE.Color();
    this.ridges.children.forEach((m, i) => {
      const depth = 0.3 + (i % 3) * 0.22;
      this.ridgeTint.copy(this.fogColor).multiplyScalar(1 - depth * 0.42);
      this.ridgeTint.lerp(SILHOUETTE, (1 - depth) * 0.28);
      m.material.color.lerp(this.ridgeTint, 0.2);
    });
  }

  /** Rain flattens the light and pulls the fog in. */
  applyWeather(rain) {
    const r = clamp(rain, 0, 1);
    this.sun.intensity = this.sunIntensity * (1 - r * 0.62);
    this.ambient.intensity *= (1 - r * 0.2);
    this.scene.fog.density = 0.0048 + r * 0.011;
    this.scene.fog.color.lerp(new THREE.Color('#93a8ae'), r * 0.55);
    this.fogColor.copy(this.scene.fog.color);
    for (const m of this.cloudMats) m.color.lerp(new THREE.Color('#7d8b96'), r * 0.6);
  }

  windAt(x, z, t) {
    return fbm(x * 0.01 + t * 0.05, z * 0.01, 2);
  }
}
