import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { startMenuArt } from './menuart.js';
import { Input } from './input.js';
import { AudioEngine } from './audio/lofi.js';
import { Sky } from './world/sky.js';
import { Weather } from './world/rain.js';
import { Wildlife } from './world/animals.js';
import { Player } from './world/player.js';
import { clamp, damp } from './world/noise.js';
import { GrassField } from './world/grass.js';
import { createPainterlyPass } from './world/grade.js';
import {
  createGround, createOuterGround, createFlowers, createStones,
  createWater, createLilyPads, WATER_LEVEL,
} from './world/terrain.js';
import {
  createForest, createGreatTree, createCottage, createShrine,
  createLanterns, createJetty, createMushrooms,
  createPetals, updatePetals, createFireflies, updateFireflies,
} from './world/props.js';

/* ═══════════════════════════════════════════════════════════
   Healy — main loop and screen flow.
   ═══════════════════════════════════════════════════════════ */

const $ = (id) => document.getElementById(id);
const screens = ['menu', 'controls', 'about', 'loading', 'pause'];

const el = {
  canvas: $('scene'),
  menuArt: $('menu-art'),
  hud: $('hud'),
  toast: $('toast'),
  bar: $('bar-fill'),
  loadTxt: document.querySelector('.load-txt'),
  chipTime: $('chip-time').querySelector('span'),
  chipWeather: $('chip-weather').querySelector('span'),
  chipMusic: $('chip-music').querySelector('span'),
  touch: $('touch'),
};

const state = {
  screen: 'menu',
  returnTo: 'menu',
  built: false,
  running: false,
  timeScale: 1,
  hudVisible: true,
};

const audio = new AudioEngine();
const input = new Input(el.canvas);
let stopMenuArt = startMenuArt($('menu-canvas'));

/* ───────────────────────── screens ───────────────────────── */

function show(name) {
  for (const s of screens) $(s).classList.toggle('active', s === name);
  state.screen = name;
}

function openPanel(name) {
  state.returnTo = (state.screen === 'pause' || state.screen === 'menu') ? state.screen : 'menu';
  input.enabled = false;
  show(name);
}

function toast(msg, ms = 1900) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('show'), ms);
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'start') enterWorld();
  else if (action === 'controls') openPanel('controls');
  else if (action === 'about') openPanel('about');
  else if (action === 'back') show(state.returnTo);
  else if (action === 'resume') resumeWorld();
  else if (action === 'quit') quitToMenu();
});

input.on('escape', () => {
  if (state.screen === 'controls' || state.screen === 'about') show(state.returnTo);
  else if (state.screen === 'pause') resumeWorld();
  else if (state.screen === null || state.screen === 'world') pauseWorld();
});

/* ───────────────────────── renderer ───────────────────────── */

let renderer, scene, camera, composer, bloom, painterly;
let sky, weather, wildlife, player, water, petals, fireflies, lilies, cottage, lanterns, grass;
let windUniforms;
const LOW_END = matchMedia('(hover: none) and (pointer: coarse)').matches;
const clock = new THREE.Clock();
let nightFactor = 0;

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: el.canvas, antialias: true, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2200);
  camera.position.set(0, 6, 16);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.34, 0.7, 0.86);
  composer.addPass(bloom);
  painterly = createPainterlyPass();
  composer.addPass(painterly);
  composer.addPass(new OutputPass());

  addEventListener('resize', onResize);
}

function onResize() {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}

/* ───────────────────────── world build ───────────────────────── */

// A macrotask yield rather than rAF: the loader has to keep making progress
// even when the tab is in the background and animation frames are throttled.
const yieldToUI = () => new Promise((r) => setTimeout(r, 16));

async function buildWorld() {
  const steps = [
    ['menyiapkan kanvas…', () => initRenderer()],
    ['melukis langit…', () => { sky = new Sky(scene); }],
    ['membentuk perbukitan…', () => {
      windUniforms = { uTime: { value: 0 }, uWind: { value: 0.6 } };
      scene.add(createGround(), createOuterGround());
    }],
    ['menumbuhkan setengah juta helai rumput…', () => {
      grass = new GrassField(scene, LOW_END
        ? { lowEnd: true, mapSize: 384 }
        : { mapSize: 512 });
    }],
    ['menyemai bunga liar…', () => { scene.add(createFlowers(2400)); scene.add(createStones(120)); }],
    ['menanam hutan…', () => { scene.add(createForest(windUniforms, 180)); }],
    ['membangunkan pohon tua…', () => { scene.add(createGreatTree(windUniforms)); scene.add(createMushrooms(70)); }],
    ['menuang air ke telaga…', () => {
      water = createWater();
      lilies = createLilyPads(32);
      scene.add(water, lilies, createJetty());
    }],
    ['mendirikan rumah kecil…', () => {
      cottage = createCottage();
      lanterns = createLanterns([[6, 4], [-4, -12], [14, -18], [-16, 6], [26, 12], [-30, 30]]);
      scene.add(cottage, lanterns, createShrine());
    }],
    ['memanggil penghuni…', () => { wildlife = new Wildlife(scene); }],
    ['menurunkan hujan…', () => { weather = new Weather(scene); }],
    ['menebar kelopak…', () => {
      petals = createPetals(400);
      fireflies = createFireflies(280);
      scene.add(petals, fireflies);
    }],
    ['menyiapkan langkah pertama…', () => {
      player = new Player(scene, camera);
      player.splashCallback = (pos, size) => weather && weather.stamp(pos, size);
    }],
  ];

  for (let i = 0; i < steps.length; i++) {
    const [label, fn] = steps[i];
    el.loadTxt.textContent = label;
    el.bar.style.width = `${Math.round((i / steps.length) * 100)}%`;
    await yieldToUI();
    fn();
  }
  el.bar.style.width = '100%';
  state.built = true;
  window.__healy = { renderer, scene, camera, composer, sky, weather, player, grass, wildlife, audio, state, step };
}

/* ───────────────────────── flow ───────────────────────── */

async function enterWorld() {
  audio.start().catch(() => {});
  if (!state.built) {
    show('loading');
    try {
      await buildWorld();
    } catch (err) {
      console.error(err);
      el.loadTxt.textContent = 'aduh, dunianya gagal tumbuh — coba muat ulang halaman.';
      return;
    }
    await new Promise((r) => setTimeout(r, 380));
  }

  el.menuArt.classList.add('gone');
  el.canvas.classList.add('visible');
  show(null);
  for (const s of screens) $(s).classList.remove('active');
  el.hud.classList.remove('hidden');
  if (input.isTouch) el.touch.classList.remove('hidden');
  el.canvas.style.cursor = 'grab';

  input.enabled = true;
  state.screen = 'world';
  state.running = true;
  clock.getDelta();
  refreshChips();
  toast('Selamat datang di Healy');
  audio.resume();
}

function pauseWorld() {
  if (!state.running) return;
  state.running = false;
  input.enabled = false;
  state.returnTo = 'pause';
  show('pause');
}

function resumeWorld() {
  show(null);
  for (const s of screens) $(s).classList.remove('active');
  state.screen = 'world';
  state.running = true;
  input.enabled = true;
  clock.getDelta();
  audio.resume();
}

function quitToMenu() {
  state.running = false;
  input.enabled = false;
  el.hud.classList.add('hidden');
  el.touch.classList.add('hidden');
  el.menuArt.classList.remove('gone');
  el.canvas.classList.remove('visible');
  state.returnTo = 'menu';
  show('menu');
  if (player) player.reset();
}

/* ───────────────────────── hud ───────────────────────── */

function refreshChips() {
  if (!sky || !weather) return;
  const [ti, tl] = sky.label();
  const [wi, wl] = weather.label();
  $('chip-time').firstChild.textContent = ti + ' ';
  el.chipTime.textContent = tl;
  $('chip-weather').firstChild.textContent = wi + ' ';
  el.chipWeather.textContent = wl;
  el.chipMusic.textContent = audio.musicOn ? 'Lofi' : 'Sunyi';
}

input.on('weather', () => {
  const on = weather.toggle();
  toast(on ? 'Hujan turun pelan-pelan' : 'Langit mulai cerah');
  refreshChips();
});

input.on('time', () => {
  state.timeScale = state.timeScale > 1 ? 1 : 40;
  toast(state.timeScale > 1 ? 'Waktu dipercepat' : 'Waktu kembali tenang');
});

input.on('music', () => {
  const on = audio.toggleMusic();
  toast(on ? 'Musik kembali' : 'Hening sejenak');
  refreshChips();
});

input.on('sit', () => {
  const sitting = player.toggleSit();
  toast(sitting ? 'Duduk sebentar…' : 'Berdiri lagi');
});

input.on('hud', () => {
  state.hudVisible = !state.hudVisible;
  el.hud.classList.toggle('faded', !state.hudVisible);
});

/* ───────────────────────── loop ───────────────────────── */

let chipTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  if (!state.built) return;          // nothing to draw until the world exists
  step(Math.min(0.05, clock.getDelta()), clock.elapsedTime);
}

function step(dt, t) {

  if (state.running) {
    input.sample();
    player.update(dt, t, input);
  } else {
    input.consumeLook();             // paused: swallow any stray drag
  }

  const p = player ? player.pos : new THREE.Vector3();

  sky.update(state.running ? dt : 0, t, camera, state.timeScale);
  nightFactor = damp(nightFactor, 1 - clamp(sky.sunUp * 1.6, 0, 1), 2.5, dt);

  const rain = weather.update(state.running ? dt : dt * 0.25, t, camera);
  sky.applyWeather(rain);

  // wind picks up with the rain
  const wind = 0.45 + rain * 0.85 + Math.sin(t * 0.11) * 0.2;
  windUniforms.uTime.value = t;
  windUniforms.uWind.value = wind;
  grass.update(t, camera, sky, wind, rain);
  painterly.uniforms.uTime.value = t;
  painterly.uniforms.uWarm.value.copy(sky.sunColor);
  painterly.uniforms.uCool.value.copy(sky.ambient.color).multiplyScalar(0.85);
  painterly.uniforms.uSaturation.value = 1.14 - rain * 0.16;
  painterly.uniforms.uVignette.value = 0.3 + nightFactor * 0.22;

  // water
  const wu = water.material.uniforms;
  wu.uTime.value = t;
  wu.uRain.value = rain;
  wu.uCam.value.copy(camera.position);
  wu.uSunDir.value.copy(sky.sunDir);
  wu.uSky.value.copy(sky.uniforms.uMid.value);
  wu.uSun.value.copy(sky.sunColor).multiplyScalar(0.6 + sky.sunUp * 0.6);
  wu.uFogColor.value.copy(scene.fog.color);
  wu.uFogDensity.value = scene.fog.density;
  wu.uShallow.value.setRGB(0.44, 0.72, 0.69).lerp(sky.fogColor, nightFactor * 0.55);
  wu.uDeep.value.setRGB(0.11, 0.27, 0.31).multiplyScalar(1 - nightFactor * 0.5);

  // lily pads riding the surface
  for (const pad of lilies.children) {
    if (pad.userData.bob === undefined) continue;
    pad.position.y = WATER_LEVEL + 0.03 + Math.sin(t * 1.3 + pad.userData.bob) * 0.045 * (1 + rain);
    pad.rotation.z += 0.04 * dt;
  }

  // warm windows and lantern flames after dusk
  const lampK = clamp(nightFactor * 1.2, 0, 1);
  for (const g of cottage.userData.glows) g.material.opacity = lampK * 0.95;
  cottage.userData.lamp.intensity = lampK * 1.5;
  const flicker = 0.85 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 13.7) * 0.07;
  for (const g of lanterns.userData.glows) g.material.opacity = lampK * flicker;
  for (const l of lanterns.userData.lights) l.intensity = lampK * flicker * 1.6;

  updatePetals(petals, dt, t, p, wind * 0.5);
  updateFireflies(fireflies, dt, t, nightFactor * (1 - rain * 0.6));
  wildlife.update(dt, t, p, nightFactor);

  bloom.strength = 0.16 + nightFactor * 0.38 + rain * 0.05;

  audio.update(dt, {
    rain,
    night: nightFactor,
    wind: clamp(wind * 0.6, 0, 1),
    moving: player ? player.speed / 6.6 : 0,
  });

  chipTimer -= dt;
  if (chipTimer <= 0) { chipTimer = 1.5; refreshChips(); }

  composer.render();
}

requestAnimationFrame(animate);

/* keep the tab quiet when it is not being looked at */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.stop();
  else audio.resume();
});
