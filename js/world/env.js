import * as THREE from 'three';

/* ═══════════════════════════════════════════════════════════
   Image-based lighting from the sky itself.

   A MeshStandardMaterial with no environment has nothing to
   reflect, so it falls back on the analytic lights alone and
   comes out looking like coloured plastic — which is a large
   part of why this world read as "untextured" even where it
   had detail. Prefiltering the sky dome into a PMREM gives
   every surface a real ambient response: wet stone picks up
   the sky, gold picks up the sun, cloth stays matte but sits
   in the same light as everything around it.

   The dome is prefiltered on its own in a throwaway scene, so
   this costs six tiny renders of a single sphere rather than
   six renders of a million blades of grass. It is refreshed
   only when the hour has actually moved.
   ═══════════════════════════════════════════════════════════ */

export class SkyEnvironment {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene   the real scene, whose .environment we set
   * @param {object} sky          the Sky instance; we borrow its dome
   */
  constructor(renderer, scene, sky) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = sky;

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    /* The clone shares the dome's geometry AND its ShaderMaterial, so it is
       always showing exactly the sky the player is standing under — no
       uniforms to mirror, nothing to keep in sync. */
    this.envScene = new THREE.Scene();
    this.domeClone = new THREE.Mesh(sky.dome.geometry, sky.dome.material);
    this.domeClone.frustumCulled = false;
    this.envScene.add(this.domeClone);

    this.target = null;
    this.lastTime = -1;
    this.lastRain = -1;
    this.refresh(0);
  }

  /** Rebuild the prefiltered environment from the sky as it stands now. */
  refresh(rain = 0) {
    const old = this.target;
    // sigma blurs the source a little before prefiltering; the sky is already
    // smooth, so a small value is enough to kill the star speckle
    this.target = this.pmrem.fromScene(this.envScene, 0.03);
    this.scene.environment = this.target.texture;
    if (old) old.dispose();
    this.lastTime = this.sky.time;
    this.lastRain = rain;
  }

  /**
   * Refresh lazily. The sky moves slowly, and a PMREM every frame would be
   * six renders and a full mip chain for a gradient that has barely changed.
   */
  update(rain = 0) {
    const dt = Math.abs(this.sky.time - this.lastTime);
    const wrapped = Math.min(dt, 1 - dt);          // the day wraps at 1.0
    if (wrapped > 0.0025 || Math.abs(rain - this.lastRain) > 0.12) {
      this.refresh(rain);
    }
  }

  /**
   * Standard materials reflect the environment at full strength by default,
   * which on an overcast painted sky washes the colour straight out. Dial it
   * back once, at build time, across everything in the scene.
   */
  static applyIntensity(root, intensity = 0.55) {
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m || !m.isMeshStandardMaterial) continue;
        /* A blind assign flattens every deliberate choice made elsewhere —
           gilt finials and standing water are lifted on purpose, and having
           the calibration pass silently drag them back to the house value is
           how those decisions quietly stop existing. Opt out by marking the
           material; anything unmarked is happy to be calibrated. */
        if (m.userData && m.userData.envFixed) continue;
        m.envMapIntensity = intensity;
      }
    });
  }

  dispose() {
    if (this.target) this.target.dispose();
    this.pmrem.dispose();
  }
}

/* ─────────── shadows for custom-shader instanced meshes ─────────── */

/**
 * A mesh that positions itself in its own vertex shader — instanced trees,
 * bamboo, anything holding its transform in an attribute rather than a model
 * matrix — cannot use the built-in depth material. Three would draw the
 * shadow pass with MeshDepthMaterial, which knows nothing about those
 * attributes, and every instance would stack its shadow at the world origin.
 *
 * Reusing the SAME vertex shader is the fix: it already computes the correct
 * gl_Position, so the depth pass lands exactly where the beauty pass does,
 * wind sway and all. Only the fragment stage differs, and all it has to do is
 * pack depth the way three's own shadow reader expects.
 *
 * @param {string} vertexShader  the beauty material's vertex shader, verbatim
 * @param {object} uniforms      the SAME uniforms object, shared not copied,
 *                               so the sway stays in step between passes
 */
export function instancedDepthMaterial(vertexShader, uniforms, opts = {}) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: /* glsl */`
      precision highp float;
      ${THREE.ShaderChunk.packing}
      void main() {
        gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
      }
    `,
    uniforms,
    side: opts.side ?? THREE.DoubleSide,
  });
}

/**
 * Attach one to a mesh. Three picks up `customDepthMaterial` automatically
 * during the shadow pass; it just never guesses that you need one.
 */
export function enableInstancedShadows(mesh, vertexShader, uniforms, opts) {
  mesh.castShadow = true;
  mesh.customDepthMaterial = instancedDepthMaterial(vertexShader, uniforms, opts);
  return mesh;
}
