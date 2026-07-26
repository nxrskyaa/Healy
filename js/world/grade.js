import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/* ═══════════════════════════════════════════════════════════
   The painterly pass. Everything that makes the render stop
   looking like a 3D engine: split toning, a soft contrast
   curve, a breath of paper grain and a wide vignette.
   ═══════════════════════════════════════════════════════════ */

const PainterlyShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uWarm: { value: new THREE.Color('#ffd9a8') },
    uCool: { value: new THREE.Color('#5f7c9c') },
    uAmount: { value: 1.0 },
    uVignette: { value: 0.32 },
    uGrain: { value: 0.016 },
    uSaturation: { value: 1.12 },
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
    uniform float uTime, uAmount, uVignette, uGrain, uSaturation;
    uniform vec3 uWarm, uCool;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));

      // split toning — cool in the shadows, warm in the light
      vec3 tone = mix(uCool, uWarm, smoothstep(0.12, 0.78, l));
      c = mix(c, c * tone * 1.35, 0.22 * uAmount);

      // soft filmic shoulder; keeps highlights off paper white without
      // lifting the midtones into milk
      c = c / (c + 0.88) * 1.78;

      // gouache-ish saturation lift, pulled back at the very top end
      float g = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(g), c, uSaturation - smoothstep(0.75, 1.0, g) * 0.3);

      // wide, gentle vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * uVignette * 2.6;
      c *= clamp(vig, 0.0, 1.0);

      // paper tooth: static-ish grain, barely there
      float n = hash(floor(vUv * 900.0) + floor(uTime * 8.0) * 0.017);
      c += (n - 0.5) * uGrain;

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function createPainterlyPass() {
  const pass = new ShaderPass(PainterlyShader);
  pass.uniforms.uAmount.value = 1.0;
  return pass;
}
