import { makeRandom, clamp } from '../world/noise.js';

/* ═══════════════════════════════════════════════════════════
   All synthesised. No samples — noise buffers, oscillators,
   biquads, and one convolution reverb whose impulse response
   is a valley, not a room.

   The score is sparse: felted bell tones walking a pentatonic
   scale a long way off, the way the reference does it. No
   drum machine. The weather is the rhythm section here.
   ═══════════════════════════════════════════════════════════ */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.musicOn = true;
    this.rain = 0;
    this.night = 0;
    this._nextNote = 0;
    this._nextBird = 0;
    this._nextDrop = 0;
    this._scaleIdx = 4;
  }

  /* ── boot (must follow a user gesture) ── */
  async start() {
    if (this.ready) { await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    await ctx.resume();

    // ── master chain: warm low shelf, soft top, gentle glue ──
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    const warm = ctx.createBiquadFilter();
    warm.type = 'lowshelf'; warm.frequency.value = 220; warm.gain.value = 2.5;
    const air = ctx.createBiquadFilter();
    air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = -3;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 22; comp.ratio.value = 3.2;
    comp.attack.value = 0.02; comp.release.value = 0.35;
    this.master.connect(warm).connect(air).connect(comp).connect(ctx.destination);

    // ── the valley: long decaying-noise IR with sparse early reflections ──
    const rvLen = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, rvLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      const r = makeRandom(999 + ch * 7);
      for (let i = 0; i < rvLen; i++) {
        const u = i / rvLen;
        let e = Math.pow(1 - u, 2.6) * Math.exp(-u * 2.1);
        if (i < ctx.sampleRate * 0.35) {
          const tt = i / ctx.sampleRate;
          e *= 1 + 2.4 * Math.exp(-Math.pow((tt - 0.031) / 0.004, 2))
            + 1.9 * Math.exp(-Math.pow((tt - 0.068) / 0.005, 2))
            + 1.4 * Math.exp(-Math.pow((tt - 0.121) / 0.008, 2))
            + 1.1 * Math.exp(-Math.pow((tt - 0.205) / 0.012, 2));
        }
        d[i] = (r() * 2 - 1) * e;
      }
      let lp = 0;
      for (let i = 0; i < rvLen; i++) { lp += (d[i] - lp) * 0.3; d[i] = lp; }
    }
    this.conv = ctx.createConvolver();
    this.conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    this.conv.connect(wet).connect(this.master);

    // ── noise sources ──
    const mkNoise = (sec, pink) => {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
      const d = b.getChannelData(0);
      const r = makeRandom(pink ? 4242 : 1234);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = r() * 2 - 1;
        if (pink) {
          b0 = 0.99765 * b0 + w * 0.099046;
          b1 = 0.963 * b1 + w * 0.2965164;
          b2 = 0.57 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.22;
        } else d[i] = w * 0.42;
      }
      return b;
    };
    this.nWhite = mkNoise(7, false);
    this.nPink = mkNoise(9, true);
    const src = (buf) => {
      const s = ctx.createBufferSource();
      s.buffer = buf; s.loop = true; s.start();
      return s;
    };

    // ── WIND: three pink-noise bands whose gains track the wind speed ──
    const wSrc = src(this.nPink);
    const mkBand = (type, f, q, g) => {
      const bq = ctx.createBiquadFilter();
      bq.type = type; bq.frequency.value = f; bq.Q.value = q;
      const gn = ctx.createGain(); gn.gain.value = g;
      wSrc.connect(bq); bq.connect(gn); gn.connect(this.master);
      const sd = ctx.createGain(); sd.gain.value = 0.32;
      gn.connect(sd); sd.connect(this.conv);
      return { bq, gn };
    };
    this.wind = {
      low: mkBand('lowpass', 150, 0.8, 0.08),
      mid: mkBand('bandpass', 520, 0.7, 0.045),
      hiss: mkBand('bandpass', 2600, 0.9, 0.02),
    };
    // grass rustle — brighter, faster to respond
    const gSrc = src(this.nWhite);
    const gbq = ctx.createBiquadFilter();
    gbq.type = 'bandpass'; gbq.frequency.value = 4200; gbq.Q.value = 0.6;
    const gg = ctx.createGain(); gg.gain.value = 0;
    gSrc.connect(gbq).connect(gg).connect(this.master);
    this.rustle = gg;

    /* ── RAIN, three layers ──
       body: pink noise, dark and wide — rain heard across a field
       sheet: white noise band up high — rain on the leaves around you
       drops: individual filtered ticks, scheduled a dozen a second —
              the patter, and the reason it no longer sounds like static */
    const rb = src(this.nPink);
    const rbLp = ctx.createBiquadFilter();
    rbLp.type = 'lowpass'; rbLp.frequency.value = 480; rbLp.Q.value = 0.4;
    this.rainBody = ctx.createGain(); this.rainBody.gain.value = 0;
    rb.connect(rbLp).connect(this.rainBody).connect(this.master);

    const rs = src(this.nWhite);
    const rsBp = ctx.createBiquadFilter();
    rsBp.type = 'bandpass'; rsBp.frequency.value = 5200; rsBp.Q.value = 0.5;
    const rsHs = ctx.createBiquadFilter();
    rsHs.type = 'highshelf'; rsHs.frequency.value = 8500; rsHs.gain.value = -6;
    this.rainSheet = ctx.createGain(); this.rainSheet.gain.value = 0;
    rs.connect(rsBp).connect(rsHs).connect(this.rainSheet).connect(this.master);
    const shSend = ctx.createGain(); shSend.gain.value = 0.3;
    this.rainSheet.connect(shSend).connect(this.conv);

    this.dropBus = ctx.createGain();
    this.dropBus.gain.value = 1;
    this.dropBus.connect(this.master);
    const dSend = ctx.createGain(); dSend.gain.value = 0.45;
    this.dropBus.connect(dSend).connect(this.conv);

    // ── crickets ──
    const cSrc = src(this.nWhite);
    const cBp = ctx.createBiquadFilter();
    cBp.type = 'bandpass'; cBp.frequency.value = 4600; cBp.Q.value = 11;
    const cAm = ctx.createGain(); cAm.gain.value = 1;
    const cLfo = ctx.createOscillator();
    cLfo.type = 'square'; cLfo.frequency.value = 11;
    const cLfg = ctx.createGain(); cLfg.gain.value = 0.5;
    cLfo.connect(cLfg).connect(cAm.gain); cLfo.start();
    this.crickets = ctx.createGain(); this.crickets.gain.value = 0;
    cSrc.connect(cBp).connect(cAm).connect(this.crickets).connect(this.master);

    // ── TRAIN bus ──
    this.train = {
      pan: ctx.createStereoPanner(),
      lp: ctx.createBiquadFilter(),
      gain: ctx.createGain(),
    };
    this.train.lp.type = 'lowpass'; this.train.lp.frequency.value = 4000;
    this.train.gain.gain.value = 0;
    this.train.gain.connect(this.train.lp).connect(this.train.pan).connect(this.master);
    const tSend = ctx.createGain(); tSend.gain.value = 0.5;
    this.train.pan.connect(tSend).connect(this.conv);
    const tSrc = src(this.nWhite);
    const trb = ctx.createBiquadFilter();
    trb.type = 'lowpass'; trb.frequency.value = 110; trb.Q.value = 1.2;
    this.train.rumble = ctx.createGain(); this.train.rumble.gain.value = 0;
    tSrc.connect(trb).connect(this.train.rumble).connect(this.train.gain);

    // ── MUSIC and BIRD buses ──
    this.mus = ctx.createGain(); this.mus.gain.value = 0;
    this.mus.connect(this.master);
    const mSend = ctx.createGain(); mSend.gain.value = 0.85;
    this.mus.connect(mSend).connect(this.conv);

    this.birdBus = ctx.createGain(); this.birdBus.gain.value = 0.5;
    this.birdBus.connect(this.master);
    const bSend = ctx.createGain(); bSend.gain.value = 0.75;
    this.birdBus.connect(bSend).connect(this.conv);

    this.ready = true;
    this._nextNote = ctx.currentTime + 3;
    this._nextBird = ctx.currentTime + 1.5;

    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(0.72, ctx.currentTime + 3.5);
  }

  stop() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ready) this.ctx.resume(); }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    return this.musicOn;
  }

  /* ── one-shots ─────────────────────────────────────────── */

  /** one raindrop: a filtered tick, panned somewhere nearby */
  _drop(level) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.nWhite;
    s.loopStart = Math.random() * 5; s.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 4800;
    bp.Q.value = 3 + Math.random() * 9;
    const g = ctx.createGain();
    const dur = 0.02 + Math.random() * 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level * (0.4 + Math.random() * 0.6), t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.85;
    s.connect(bp).connect(g).connect(pan).connect(this.dropBus);
    s.start(t); s.stop(t + dur + 0.02);
  }

  footstep(spd, wet) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.nWhite; s.loop = true;
    s.loopStart = Math.random() * 5;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const bq = ctx.createBiquadFilter();
    bq.type = 'lowpass';
    bq.frequency.setValueAtTime(wet ? 2100 : 1500, t);
    bq.frequency.exponentialRampToValueAtTime(420, t + 0.12);
    const g = ctx.createGain();
    const lv = 0.020 + 0.036 * clamp(spd / 3, 0, 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(lv, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    s.connect(bq).connect(g).connect(this.master);
    const sd = ctx.createGain(); sd.gain.value = 0.35;
    g.connect(sd).connect(this.conv);
    s.start(t); s.stop(t + 0.24);
  }

  chuff(level) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = this.nWhite;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    s.loopStart = Math.random() * 4; s.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = 'bandpass'; bq.Q.value = 1.1;
    bq.frequency.setValueAtTime(1500, t);
    bq.frequency.exponentialRampToValueAtTime(280, t + 0.22);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 150;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level * 0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    s.connect(bq).connect(hp).connect(g).connect(this.train.gain);
    s.start(t); s.stop(t + 0.34);
  }

  whistle() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // a steam whistle is a chord: root, minor third, fifth, octave, detuned
    const root = 452, ratios = [1, 1.189, 1.498, 2.002];
    const level = 0.20;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(level, t + 0.16);
    out.gain.setValueAtTime(level, t + 1.05);
    out.gain.exponentialRampToValueAtTime(level * 0.55, t + 1.45);
    out.gain.linearRampToValueAtTime(level * 0.9, t + 1.6);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3400;
    out.connect(lp).connect(this.train.gain);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.4;
    const vg = ctx.createGain(); vg.gain.value = 4.2;
    vib.connect(vg); vib.start(t); vib.stop(t + 2.6);
    ratios.forEach((rt, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.value = root * rt * (1 + (Math.random() - 0.5) * 0.006);
      vg.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.value = [0.5, 0.34, 0.26, 0.12][i];
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = root * rt; bp.Q.value = 6;
      o.connect(bp).connect(g).connect(out);
      o.start(t); o.stop(t + 2.6);
    });
    // breath
    const s = ctx.createBufferSource();
    s.buffer = this.nWhite; s.loop = true;
    const nb = ctx.createBiquadFilter();
    nb.type = 'bandpass'; nb.frequency.value = 1800; nb.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(level * 0.42, t + 0.12);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    s.connect(nb).connect(ng).connect(out);
    s.start(t); s.stop(t + 2.5);
  }

  _bird() {
    const ctx = this.ctx, t = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() * 2 - 1) * 0.8;
    pan.connect(this.birdBus);
    const n = 2 + ((Math.random() * 4) | 0);
    const base = 1900 + Math.random() * 2400;
    const species = Math.random();
    let tt = t;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = species < 0.5 ? 'sine' : 'triangle';
      const f0 = base * (0.82 + Math.random() * 0.5);
      const f1 = f0 * (species < 0.35 ? 1.5 + Math.random() : 0.55 + Math.random() * 0.4);
      const dur = 0.055 + Math.random() * 0.1;
      o.frequency.setValueAtTime(f0, tt);
      o.frequency.exponentialRampToValueAtTime(Math.max(220, f1), tt + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.045, tt + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
      o.connect(g).connect(pan);
      o.start(tt); o.stop(tt + dur + 0.02);
      tt += dur + 0.02 + Math.random() * 0.09;
    }
  }

  /** a felted bell: additive partials, slightly stretched, long decay */
  _note(freq, level, dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(this.mus);
    const parts = [1, 2, 3, 4.02, 5.05, 6.1, 8.2];
    const amps = [1, 0.42, 0.24, 0.14, 0.09, 0.05, 0.03];
    for (let i = 0; i < parts.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * parts[i] * (1 + (Math.random() - 0.5) * 0.001);
      const g = ctx.createGain();
      const a = 0.012 + i * 0.004, d = dur * (1 - i * 0.085);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(level * amps[i], t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.4, d));
      o.connect(g).connect(out);
      o.start(t); o.stop(t + Math.max(0.5, d) + 0.05);
    }
  }

  /* ── per-frame ─────────────────────────────────────────── */
  update(dt, { rain = 0, night = 0, wind = 0.5, train = null } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = clamp(dt * 4, 0, 1);
    const ease = (node, v, kk = k) => { node.gain.value += (v - node.gain.value) * kk; };

    this.rain = rain;
    this.night = night;

    // wind bands ride the same value that bends the grass
    const s = wind * 5;
    ease(this.wind.low.gn, 0.028 + 0.05 * clamp(s / 6, 0, 1.6));
    ease(this.wind.mid.gn, 0.010 + 0.042 * clamp(s / 5, 0, 1.7));
    ease(this.wind.hiss.gn, 0.003 + 0.024 * clamp((s - 0.6) / 5, 0, 1.6));
    this.wind.mid.bq.frequency.value += (420 + 190 * clamp(s / 6, 0, 1.5) - this.wind.mid.bq.frequency.value) * k;
    ease(this.rustle, 0.004 + 0.028 * clamp((s - 0.4) / 4.5, 0, 1.5));

    // rain: body swells first, sheet second, drops carry the detail
    ease(this.rainBody, rain * 0.11, k * 0.5);
    ease(this.rainSheet, Math.pow(rain, 1.6) * 0.035, k * 0.5);
    if (rain > 0.04 && t > this._nextDrop) {
      this._drop(0.05 + rain * 0.06);
      if (rain > 0.5 && Math.random() < 0.5) this._drop(0.04 + rain * 0.05);
      this._nextDrop = t + (0.03 + Math.random() * 0.12) / (0.25 + rain);
    }

    ease(this.crickets, night * (1 - rain) * 0.011, k * 0.35);

    // train
    if (train && train.active) {
      const d = train.dist;
      ease(this.train.gain, clamp(140 / (40 + d), 0, 1) * 0.8, clamp(dt * 3, 0, 1));
      this.train.lp.frequency.value += (clamp(11000 - d * 22, 700, 11000) - this.train.lp.frequency.value) * clamp(dt * 3, 0, 1);
      this.train.pan.pan.value += (train.pan - this.train.pan.pan.value) * clamp(dt * 4, 0, 1);
      ease(this.train.rumble, 0.14 * clamp(90 / (30 + d), 0, 1), clamp(dt * 2, 0, 1));
    } else {
      ease(this.train.gain, 0, clamp(dt * 1.5, 0, 1));
      ease(this.train.rumble, 0, clamp(dt * 1.5, 0, 1));
    }

    // birds, daytime and dry
    if (t > this._nextBird) {
      if (night < 0.4 && rain < 0.35 && Math.random() < 0.8) this._bird();
      this._nextBird = t + 1.4 + Math.random() * 6.5;
    }

    // the score: a slow pentatonic walk on D, felted bells, far away
    ease(this.mus, this.musicOn ? 0.3 : 0, clamp(dt, 0, 1));
    if (this.musicOn && t > this._nextNote) {
      const root = 146.83;   // D3
      const pent = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
      const step = [-2, -1, -1, 0, 1, 1, 2, 3][(Math.random() * 8) | 0];
      this._scaleIdx = clamp(this._scaleIdx + step, 0, pent.length - 1);
      const f = root * Math.pow(2, pent[this._scaleIdx] / 12);
      const lvl = 0.02 + Math.random() * 0.016;
      this._note(f, lvl, 3.2 + Math.random() * 2.6);
      if (Math.random() < 0.34) {
        const j = clamp(this._scaleIdx + (Math.random() < 0.5 ? 2 : 3), 0, pent.length - 1);
        setTimeout(() => this.ready && this._note(root * Math.pow(2, pent[j] / 12), lvl * 0.65, 3), 90 + Math.random() * 180);
      }
      // rain slows the melody down — fewer notes, further apart
      this._nextNote = t + 1.6 + Math.random() * 4.4 + rain * 2.5 + (Math.random() < 0.18 ? 4.5 : 0);
    }
  }
}
