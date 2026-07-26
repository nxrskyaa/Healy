import * as THREE from 'three';
import { makeRandom, clamp } from './noise.js';
import { heightAt, WATER_LEVEL } from './terrain.js';

/* ═══════════════════════════════════════════════════════════
   Rain. Streaks live entirely on the GPU inside a box that
   follows the camera; splashes are pooled and stamped onto
   the ground wherever you happen to be standing.
   ═══════════════════════════════════════════════════════════ */

const BOX_R = 34;   // horizontal half-extent of the rain volume
const BOX_H = 46;   // vertical extent

const rainVert = /* glsl */`
  attribute vec3  aOffset;
  attribute float aSpeed;
  attribute float aScale;
  uniform float uTime;
  uniform vec3  uCenter;
  uniform float uSlant;
  varying float vY;
  varying float vRand;

  void main() {
    // wrap the drop into a box centred on the camera
    vec3 p;
    p.x = uCenter.x + mod(aOffset.x - uCenter.x + ${BOX_R}.0, ${BOX_R * 2}.0) - ${BOX_R}.0;
    p.z = uCenter.z + mod(aOffset.z - uCenter.z + ${BOX_R}.0, ${BOX_R * 2}.0) - ${BOX_R}.0;
    float fall = mod(aOffset.y - uTime * aSpeed * 14.0, ${BOX_H}.0);
    p.y = uCenter.y - ${BOX_H / 2}.0 + fall;

    vec4 mv = viewMatrix * vec4(p, 1.0);
    float len = aScale * 1.05;
    mv.x += position.x * 0.028 + position.y * uSlant * len;
    mv.y += position.y * len;

    vY = position.y;
    vRand = aScale;
    gl_Position = projectionMatrix * mv;
  }
`;

const rainFrag = /* glsl */`
  precision mediump float;
  varying float vY;
  varying float vRand;
  uniform float uOpacity;
  uniform vec3  uColor;
  void main() {
    float a = smoothstep(0.0, 0.25, vY) * smoothstep(1.0, 0.55, vY);
    gl_FragColor = vec4(uColor, a * uOpacity * (0.45 + vRand * 0.4));
  }
`;

function createStreaks(count) {
  const base = new THREE.PlaneGeometry(1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.index);
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  geo.instanceCount = count;

  const rnd = makeRandom(60606);
  const off = new Float32Array(count * 3);
  const spd = new Float32Array(count);
  const scl = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    off[i * 3] = (rnd() - 0.5) * BOX_R * 2;
    off[i * 3 + 1] = rnd() * BOX_H;
    off[i * 3 + 2] = (rnd() - 0.5) * BOX_R * 2;
    spd[i] = 0.75 + rnd() * 0.65;
    scl[i] = 0.35 + rnd() * 0.9;
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(spd, 1));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scl, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    vertexShader: rainVert,
    fragmentShader: rainFrag,
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uOpacity: { value: 0 },
      uSlant: { value: 0.16 },
      uColor: { value: new THREE.Color('#dceaf2') },
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'rainStreaks';
  return mesh;
}

/* ───────────────────────── splashes ───────────────────────── */

const splashVert = /* glsl */`
  attribute float aStart;
  attribute float aSize;
  uniform float uTime;
  uniform float uLife;
  varying float vAge;
  void main() {
    float age = (uTime - aStart) / uLife;
    vAge = age;
    vec3 p = position * (0.18 + age * 0.85) * aSize;
    vec4 wp = instanceMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * wp;
  }
`;

const splashFrag = /* glsl */`
  precision mediump float;
  varying float vAge;
  uniform float uOpacity;
  void main() {
    if (vAge < 0.0 || vAge > 1.0) discard;
    float a = (1.0 - vAge) * uOpacity * 0.34;
    gl_FragColor = vec4(0.88, 0.94, 0.98, a);
  }
`;

function createSplashes(count) {
  const ring = new THREE.RingGeometry(0.55, 0.72, 14);
  ring.rotateX(-Math.PI / 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(ring.index);
  geo.setAttribute('position', ring.attributes.position);
  geo.setAttribute('normal', ring.attributes.normal);
  geo.setAttribute('uv', ring.attributes.uv);
  geo.instanceCount = count;

  const start = new Float32Array(count).fill(-999);
  const size = new Float32Array(count).fill(1);
  geo.setAttribute('aStart', new THREE.InstancedBufferAttribute(start, 1));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const mat = new THREE.ShaderMaterial({
    vertexShader: splashVert,
    fragmentShader: splashFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uLife: { value: 0.75 }, uOpacity: { value: 0 } },
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'splashes';
  // park every instance out of sight until it is spawned
  const d = new THREE.Object3D();
  d.position.set(0, -9999, 0);
  d.updateMatrix();
  for (let i = 0; i < count; i++) mesh.setMatrixAt(i, d.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/* ───────────────────────── weather system ───────────────────────── */

export class Weather {
  constructor(scene, { streaks = 4200, splashes = 220 } = {}) {
    this.target = 0;        // 0 = clear, 1 = downpour
    this.value = 0;
    this.streaks = createStreaks(streaks);
    this.splashes = createSplashes(splashes);
    scene.add(this.streaks, this.splashes);

    this._splashIdx = 0;
    this._splashAcc = 0;
    this._dummy = new THREE.Object3D();
    this._rnd = makeRandom(80808);
  }

  set(v) { this.target = clamp(v, 0, 1); }
  toggle() { this.set(this.target > 0.05 ? 0 : 0.85); return this.target > 0.05; }

  label() {
    if (this.target < 0.05) return ['🌤', 'Cerah'];
    if (this.target < 0.45) return ['🌦', 'Gerimis'];
    if (this.target < 0.8) return ['🌧', 'Hujan'];
    return ['⛈', 'Hujan Deras'];
  }

  /** Stamp a single ripple on the ground — used for footfalls and landings. */
  stamp(pos, size = 1) {
    const starts = this.splashes.geometry.attributes.aStart;
    const sizes = this.splashes.geometry.attributes.aSize;
    const i = this._splashIdx++ % this.splashes.count;
    this._dummy.position.set(pos.x, heightAt(pos.x, pos.z) + 0.04, pos.z);
    this._dummy.updateMatrix();
    this.splashes.setMatrixAt(i, this._dummy.matrix);
    starts.array[i] = this.splashes.material.uniforms.uTime.value;
    sizes.array[i] = size * 0.5;
    this.splashes.instanceMatrix.needsUpdate = true;
    starts.needsUpdate = true;
    sizes.needsUpdate = true;
  }

  update(dt, elapsed, camera) {
    this.value += (this.target - this.value) * Math.min(1, dt * 0.7);
    const v = this.value;

    const su = this.streaks.material.uniforms;
    su.uTime.value = elapsed;
    su.uCenter.value.copy(camera.position);
    su.uOpacity.value = v;
    su.uSlant.value = 0.12 + Math.sin(elapsed * 0.25) * 0.06;
    this.streaks.visible = v > 0.01;

    const pu = this.splashes.material.uniforms;
    pu.uTime.value = elapsed;
    pu.uOpacity.value = v;
    this.splashes.visible = v > 0.01;

    if (v > 0.05) {
      const rate = 70 * v;
      this._splashAcc += rate * dt;
      const n = Math.min(24, Math.floor(this._splashAcc));
      this._splashAcc -= n;
      const starts = this.splashes.geometry.attributes.aStart;
      const sizes = this.splashes.geometry.attributes.aSize;
      for (let k = 0; k < n; k++) {
        const a = this._rnd() * Math.PI * 2;
        const r = Math.sqrt(this._rnd()) * 22;
        const x = camera.position.x + Math.cos(a) * r;
        const z = camera.position.z + Math.sin(a) * r;
        const h = heightAt(x, z);
        if (h < WATER_LEVEL) continue;                  // the pond shader handles its own rings
        const i = this._splashIdx++ % this.splashes.count;
        this._dummy.position.set(x, h + 0.03, z);
        this._dummy.updateMatrix();
        this.splashes.setMatrixAt(i, this._dummy.matrix);
        starts.array[i] = elapsed;
        sizes.array[i] = 0.22 + this._rnd() * 0.4;
      }
      if (n > 0) {
        this.splashes.instanceMatrix.needsUpdate = true;
        starts.needsUpdate = true;
        sizes.needsUpdate = true;
      }
    }
    return v;
  }
}
