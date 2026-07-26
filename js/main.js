import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { LuminosityHighPassShader } from 'three/addons/shaders/LuminosityHighPassShader.js';

/* NaN firewall on the bloom's bright pass. One non-finite texel anywhere in
   the frame gets smeared across a whole neighbourhood by the downsample
   chain and comes back as a huge dark rectangle. NaN fails every comparison
   with itself, which is the only way to test for it in GLSL ES 1.00. */
LuminosityHighPassShader.fragmentShader = LuminosityHighPassShader.fragmentShader.replace(
  'vec4 texel = texture2D( tDiffuse, vUv );',
  `vec4 texel = texture2D( tDiffuse, vUv );
   if (!(texel.r <= 0.0 || texel.r >= 0.0)) texel = vec4(0.0);
   if (!(texel.g <= 0.0 || texel.g >= 0.0)) texel = vec4(0.0);
   if (!(texel.b <= 0.0 || texel.b >= 0.0)) texel = vec4(0.0);
   texel.rgb = clamp(texel.rgb, vec3(0.0), vec3(48.0));`
);

import { startMenuArt } from './menuart.js';
import { Input } from './input.js';
import { AudioEngine } from './audio/lofi.js';
import { Sky } from './world/sky.js';
import { Weather } from './world/rain.js';
import { Wildlife } from './world/animals.js';
import { Player } from './world/player.js';
import { clamp, damp } from './world/noise.js';
import { GrassField } from './world/grass.js';
import { Forest } from './world/trees.js';
import { Railway } from './world/train.js';
import { createPrintPass, updatePrintPass } from './world/grade.js';
import {
  createGround, createOuterGround, createFlowers, createStones,
  createWater, createLilyPads, WATER_LEVEL,
} from './world/terrain.js';
import { buildBali } from './world/bali.js';
import {
  createJetty, createMushrooms,
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

const LOW_END = matchMedia('(hover: none) and (pointer: coarse)').matches;

// Adaptive resolution: measure the real frame time once running and give
// back pixels twice if it asks. There is no other honest way to know what
// GPU this is.
const quality = { ss: LOW_END ? 0.8 : 1.0, frames: 0, sum: 0, steps: 0 };

const audio = new AudioEngine();
const input = new Input(el.canvas);
startMenuArt($('menu-canvas'));

/* ── screens ── */

function show(name) {
  for (const s of screens) $(s).classList.toggle('active', s === name);
  state.screen = name;
}

function openPanel(name) {
  state.returnTo = (state.screen === 'pause' || state.screen === 'menu') ? state.screen : 'menu';
  input.enabled = false;
  show(name);
}

function toast(msg, ms = 2100) {
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

/* ── renderer ── */

let renderer, scene, camera, composer, bloom, print, fxaa;
let sky, weather, wildlife, player, water, petals, fireflies, lilies;
let bali, grass, forest, railway;
const clock = new THREE.Clock();
let nightFactor = 0;

function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: el.canvas, antialias: false, powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * quality.ss, LOW_END ? 1.6 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = !LOW_END;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 2200);
  camera.position.set(0, 6, 16);

  // The composer's target replaces the renderer's own antialiasing, so it has
  // to be multisampled itself — a grass field is nothing but edges.
  const dbs = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(dbs.x, dbs.y, {
    type: THREE.HalfFloatType,
    samples: LOW_END ? 0 : 2,
  });

  composer = new EffectComposer(renderer, target);
  /* The scene itself is drawn into the composer's SECOND buffer (RenderPass
     renders into the read buffer), so that is the one whose depth the ink
     pass needs. It must never hang off the first buffer: the print pass
     renders INTO that one while sampling depth, which is a feedback loop and
     comes out as garbage rectangles. */
  composer.renderTarget2.depthTexture = new THREE.DepthTexture(dbs.x, dbs.y);

  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.75, 0.82);
  composer.addPass(bloom);
  print = createPrintPass();
  print.uniforms.uDepth.value = composer.renderTarget2.depthTexture;
  print.uniforms.uCamNear.value = camera.near;
  print.uniforms.uCamFar.value = camera.far;
  composer.addPass(print);
  fxaa = new ShaderPass(FXAAShader);
  composer.addPass(fxaa);
  composer.addPass(new OutputPass());

  addEventListener('resize', onResize);
  onResize();
}

function onResize() {
  if (!renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);

  const dbs = renderer.getDrawingBufferSize(new THREE.Vector2());
  fxaa.material.uniforms.resolution.value.set(1 / dbs.x, 1 / dbs.y);
  print.uniforms.uRes.value.set(dbs.x, dbs.y);
  if (grass) grass.setViewport(camera.fov, dbs.y);

  // setSize does not reallocate an attached depth texture, and a stale-sized
  // depth attachment makes the whole framebuffer undefined — rebuild it
  const rt2 = composer.renderTarget2;
  if (rt2.depthTexture && (rt2.depthTexture.image.width !== dbs.x || rt2.depthTexture.image.height !== dbs.y)) {
    rt2.depthTexture.dispose();
    rt2.depthTexture = new THREE.DepthTexture(dbs.x, dbs.y);
    rt2.dispose();
    print.uniforms.uDepth.value = rt2.depthTexture;
  }
}

/* ── world build ── */

const yieldToUI = () => new Promise((r) => setTimeout(r, 16));

async function buildWorld() {
  const steps = [
    ['preparing the canvas', () => initRenderer()],
    ['painting the sky', () => { sky = new Sky(scene); }],
    ['shaping the hills', () => { scene.add(createGround(), createOuterGround()); }],
    ['growing the meadow', () => {
      grass = new GrassField(scene, LOW_END
        ? { lowEnd: true, mapSize: 384 }
        : { mapSize: 512 });
      onResize();
    }],
    ['scattering wildflowers', () => { scene.add(createFlowers(LOW_END ? 900 : 2200), createStones(110)); }],
    ['planting the forest', () => { forest = new Forest(scene); }],
    ['laying the railway', () => { railway = new Railway(scene); }],
    ['filling the pond', () => {
      water = createWater();
      lilies = createLilyPads(30);
      scene.add(water, lilies, createJetty());
    }],
    ['raising the temple gates', () => {
      bali = buildBali(scene);
      scene.add(createMushrooms(60));
    }],
    ['waking the animals', () => { wildlife = new Wildlife(scene); }],
    ['seeding the clouds', () => { weather = new Weather(scene, LOW_END ? { streaks: 2200, splashes: 120 } : {}); }],
    ['letting the petals go', () => {
      petals = createPetals(LOW_END ? 180 : 380);
      fireflies = createFireflies(LOW_END ? 140 : 260);
      scene.add(petals, fireflies);
    }],
    ['finding your feet', () => {
      player = new Player(scene, camera);
      player.splashCallback = (pos, size) => weather && weather.stamp(pos, size);
      player.stepCallback = (spd) => audio.footstep(spd, weather ? weather.value > 0.3 : false);
      railway.onChuff = (s) => audio.chuff(s);
      railway.onWhistle = () => audio.whistle();
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
  window.__healy = { renderer, scene, camera, composer, sky, weather, player, grass, forest, railway, bali, wildlife, audio, state, step };
}

/* ── flow ── */

async function enterWorld() {
  audio.start().catch(() => {});
  if (!state.built) {
    show('loading');
    try {
      await buildWorld();
    } catch (err) {
      console.error(err);
      el.loadTxt.textContent = 'something went wrong — please reload the page';
      return;
    }
    await new Promise((r) => setTimeout(r, 350));
  }

  el.menuArt.classList.add('gone');
  el.canvas.classList.add('visible');
  for (const s of screens) $(s).classList.remove('active');
  el.hud.classList.remove('hidden');
  if (input.isTouch) el.touch.classList.remove('hidden');
  el.canvas.style.cursor = 'grab';

  input.enabled = true;
  state.screen = 'world';
  state.running = true;
  clock.getDelta();
  refreshChips();
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

/* ── hud ── */

function refreshChips() {
  if (!sky || !weather) return;
  el.chipTime.textContent = sky.label();
  el.chipWeather.textContent = weather.label();
  el.chipMusic.textContent = audio.musicOn ? 'Music on' : 'Music off';
}

input.on('weather', () => {
  const on = weather.toggle();
  toast(on ? 'Rain drifts in' : 'The sky clears');
  refreshChips();
});

input.on('time', () => {
  state.timeScale = state.timeScale > 1 ? 1 : 40;
  toast(state.timeScale > 1 ? 'The day hurries on' : 'Time slows back down');
});

input.on('music', () => {
  const on = audio.toggleMusic();
  toast(on ? 'The music returns' : 'Just the valley now');
  refreshChips();
});

input.on('sit', () => {
  const sitting = player.toggleSit();
  toast(sitting ? 'Sitting a while' : 'Up again');
});

input.on('view', () => {
  const fp = player.toggleView();
  toast(fp ? 'Through your own eyes' : 'From a few steps back');
});

input.on('hud', () => {
  state.hudVisible = !state.hudVisible;
  el.hud.classList.toggle('faded', !state.hudVisible);
});

/* ── loop ── */

let chipTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  if (!state.built) return;
  step(Math.min(0.05, clock.getDelta()), clock.elapsedTime);
}

function step(dt, t) {
  if (state.running) {
    input.sample();
    player.update(dt, t, input);
  } else {
    input.consumeLook();
  }

  const p = player ? player.pos : new THREE.Vector3();

  sky.update(state.running ? dt : 0, t, camera, state.timeScale);
  nightFactor = damp(nightFactor, 1 - clamp(sky.sunUp * 1.6, 0, 1), 2.5, dt);

  const rain = weather.update(state.running ? dt : dt * 0.25, t, camera);
  sky.applyWeather(rain);

  const wind = 0.45 + rain * 0.85 + Math.sin(t * 0.11) * 0.2;
  grass.update(t, camera, sky, wind, rain);
  forest.update(t, camera, sky, wind, rain);
  railway.update(dt, t, camera, nightFactor);

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

  for (const pad of lilies.children) {
    if (pad.userData.bob === undefined) continue;
    pad.position.y = WATER_LEVEL + 0.03 + Math.sin(t * 1.3 + pad.userData.bob) * 0.045 * (1 + rain);
    pad.rotation.z += 0.04 * dt;
  }

  // the lanterns come alive after dusk — and glow faintly under rain-dark skies
  const lampK = clamp(nightFactor * 1.2 + rain * 0.25, 0, 1);
  const flicker = 0.85 + Math.sin(t * 7.3) * 0.08 + Math.sin(t * 13.7) * 0.07;
  for (const m of bali.glowMats) m.emissiveIntensity = lampK * (0.55 + flicker * 0.6);
  for (const l of bali.lights) l.intensity = lampK * flicker * 1.7;

  updatePetals(petals, dt, t, p, wind * 0.5);
  updateFireflies(fireflies, dt, t, nightFactor * (1 - rain * 0.6));
  wildlife.update(dt, t, p, nightFactor);

  bloom.strength = 0.22 + nightFactor * 0.3 + rain * 0.04;
  updatePrintPass(print, camera, sky, t, nightFactor, rain);

  audio.update(dt, {
    rain,
    night: nightFactor,
    wind: clamp(wind * 0.6, 0, 1),
    train: railway ? { active: railway.active, dist: railway.dist, pan: railway.pan } : null,
  });

  chipTimer -= dt;
  if (chipTimer <= 0) { chipTimer = 1.5; refreshChips(); }

  composer.render();
  governQuality(dt);
}

/** Two chances to shed resolution, then leave it alone. */
function governQuality(dt) {
  if (quality.steps >= 2 || !state.running) return;
  quality.frames++;
  quality.sum += dt;
  if (quality.frames < 90) return;

  const avg = quality.sum / quality.frames;
  quality.frames = 0;
  quality.sum = 0;
  if (avg > 0.028 && quality.ss > 0.55) {
    quality.steps++;
    quality.ss *= 0.78;
    renderer.setPixelRatio(Math.min((window.devicePixelRatio || 1) * quality.ss, 2));
    onResize();
  } else if (avg < 0.014) {
    quality.steps = 2;
  }
}

requestAnimationFrame(animate);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) audio.stop();
  else audio.resume();
});
