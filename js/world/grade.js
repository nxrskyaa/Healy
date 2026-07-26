import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ═══════════════════════════════════════════════════════════
   The film print. This is where the render stops being a 3D
   engine: a custom tonemap, shadows pulled violet, highlights
   pulled cream, a lift so nothing is ever pure black, light
   shafts when the sun is in frame, paper grain, a warm-dark
   vignette, and an ordered dither so the sky can never band.
   ═══════════════════════════════════════════════════════════ */

const PrintShader = {
  uniforms: {
    tDiffuse: { value: null },
    uDepth: { value: null },
    uCamNear: { value: 0.1 },
    uCamFar: { value: 2200 },
    uInk: { value: 0.55 },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSunScreen: { value: new THREE.Vector2(0.5, 0.5) },
    uSunAmt: { value: 0 },          // 0..1 : sun visibility on screen × daylight
    uSunTint: { value: new THREE.Color('#ffd79c') },
    uExposure: { value: 1.06 },
    uPaint: { value: 1.0 },
    uVignette: { value: 0.8 },
    uGrain: { value: 1.0 },
    uNight: { value: 0 },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    uniform sampler2D uDepth;
    uniform float uTime, uExposure, uPaint, uVignette, uGrain, uSunAmt, uNight;
    uniform float uCamNear, uCamFar, uInk;
    uniform vec2  uRes, uSunScreen;
    uniform vec3  uSunTint;

    float linDepth(vec2 uv) {
      float z = texture2D(uDepth, uv).x * 2.0 - 1.0;
      return (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - z * (uCamFar - uCamNear));
    }

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float vn2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x),
                 mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
    }

    // the reference's print curve — a soft-shouldered rational, not Reinhard
    vec3 tonemap(vec3 x) {
      x = max(x, vec3(0.0));
      vec3 a = x * (x * 0.36 + 0.42);
      vec3 b = x * (x * 0.34 + 0.66) + 0.11;
      return clamp(a / b, 0.0, 1.0);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);

      vec3 c = texture2D(tDiffuse, uv).rgb;
      // last-chance firewall: a NaN must never reach the tonemap
      if (!(c.r <= 0.0 || c.r >= 0.0)) c = vec3(0.0);
      if (!(c.g <= 0.0 || c.g >= 0.0)) c = vec3(0.0);
      if (!(c.b <= 0.0 || c.b >= 0.0)) c = vec3(0.0);
      c = clamp(c, vec3(0.0), vec3(64.0));

      // ── light shafts: a cheap radial gather toward the sun ─────────────
      // Twelve taps marching toward the sun's screen position, keeping only
      // what is brighter than the shoulder — sky and lit cloud — so the beams
      // appear to pour between the trees rather than glow over them.
      if (uSunAmt > 0.004) {
        vec2 toSun = uSunScreen - uv;
        vec3 shaft = vec3(0.0);
        float w = 1.0;
        float wsum = 0.0;
        for (int i = 1; i <= 12; i++) {
          vec2 p = uv + toSun * (float(i) / 12.0) * 0.85;
          vec3 s = texture2D(tDiffuse, p).rgb;
          shaft += max(s - 0.55, 0.0) * w;
          wsum += w;
          w *= 0.87;
        }
        shaft /= wsum;
        float falloff = exp(-dot(toSun, toSun) * 2.2);
        c += shaft * uSunTint * uSunAmt * falloff * 0.5;
      }

      /* ── the ink line ────────────────────────────────────────────────────
         A hand-drawn outline wherever something stands in front of the world
         behind it. The threshold is RELATIVE depth, so grass blades against
         the ground just behind them stay clean, while a figure, a tree, a
         gate or the train against the far meadow takes a drawn edge — the
         single trick that pushes the frame from render toward illustration. */
      if (uInk > 0.01) {
        vec2 px = 1.4 / uRes;
        float dC = linDepth(uv);
        float gap = 0.0;
        gap = max(gap, linDepth(uv + vec2(px.x, 0.0)) - dC);
        gap = max(gap, linDepth(uv - vec2(px.x, 0.0)) - dC);
        gap = max(gap, linDepth(uv + vec2(0.0, px.y)) - dC);
        gap = max(gap, linDepth(uv - vec2(0.0, px.y)) - dC);
        // wobble the threshold so the line thickens and thins like a nib
        float wob = 0.8 + 0.4 * vn2(uv * uRes * 0.11);
        float ink = smoothstep(0.16 * dC * wob, 0.34 * dC * wob, gap);
        ink *= smoothstep(360.0, 90.0, dC);          // the far field stays soft
        c = mix(c, c * vec3(0.30, 0.34, 0.30) + vec3(0.006, 0.01, 0.012), ink * uInk);
      }

      // ── the print ───────────────────────────────────────────────────────
      c = c * uExposure;
      c = tonemap(c);

      // shadows to violet, highlights to cream — the single biggest lever
      float l = luma(c);
      vec3 shadowPush = mix(vec3(0.90, 0.95, 1.16), vec3(1.0), smoothstep(0.0, 0.34, l));
      vec3 highPush   = mix(vec3(1.0), vec3(1.055, 1.012, 0.925), smoothstep(0.44, 0.98, l));
      c *= mix(vec3(1.0), shadowPush, 0.85 * uPaint) * mix(vec3(1.0), highPush, 0.9 * uPaint);

      // lift: nothing in a painted frame is ever pure black
      vec3 lift = mix(vec3(0.017, 0.021, 0.036), vec3(0.010, 0.014, 0.030), uNight) * uPaint;
      c = c * (1.0 - lift) + lift;

      // gentle S and a nudge of saturation in the midtones only
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.16 * uPaint);
      l = luma(c);
      float satBoost = 1.0 + 0.16 * uPaint * smoothstep(0.10, 0.42, l) * (1.0 - smoothstep(0.62, 0.96, l));
      c = mix(vec3(l), c, satBoost);

      // ── paper tooth: a whisper, never a texture ─────────────────────────
      vec2 gp = uv * uRes / 2.4;
      float grain = vn2(gp * 0.5) * 0.62 + vn2(gp * 0.13 + 11.0) * 0.38;
      c *= 1.0 + (grain - 0.5) * 0.028 * uGrain;

      // ── warm-dark vignette ──────────────────────────────────────────────
      float vig = pow(clamp(1.0 - r2 * 1.15, 0.0, 1.0), 1.55);
      c *= mix(vec3(1.0), mix(vec3(0.62, 0.60, 0.66), vec3(1.0), vig), uVignette);

      // ── ordered dither: the sky must never band ─────────────────────────
      float dth = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909)));
      c += (dth - 0.5) / 255.0;

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createPrintPass() {
  return new ShaderPass(PrintShader);
}

const _v = new THREE.Vector3();

/**
 * Feed the pass everything it needs this frame. Sun visibility is the product
 * of daylight, whether the sun is in front of the camera, and how close to
 * frame centre it sits.
 */
export function updatePrintPass(pass, camera, sky, t, nightFactor, rain) {
  const u = pass.uniforms;
  u.uTime.value = t;
  u.uNight.value = nightFactor;

  _v.copy(sky.sunDir).multiplyScalar(1000).add(camera.position).project(camera);
  const inFront = _v.z < 1;
  const sx = _v.x * 0.5 + 0.5, sy = _v.y * 0.5 + 0.5;
  u.uSunScreen.value.set(sx, sy);

  const margin = 0.55;
  const onScreen = inFront
    ? Math.max(0, 1 - Math.max(Math.abs(_v.x), Math.abs(_v.y)) / (1 + margin))
    : 0;
  u.uSunAmt.value = onScreen * sky.sunUp * (1 - rain * 0.85);
  u.uSunTint.value.copy(sky.sunColor);
  u.uExposure.value = 1.06 - rain * 0.08;
}
