/* ═══════════════════════════════════════════════════════════
   Everything you hear is generated here — no audio files.
   A slow lofi loop (pads, Rhodes-ish keys, brushed drums,
   vinyl crackle) plus a living ambience layer: rain, wind,
   birdsong by day, crickets by night.
   ═══════════════════════════════════════════════════════════ */

const BPM = 72;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// two-bar chords, eight bars around: Fmaj7 · Am7 · Dm7 · B♭maj7
const PROG = [
  { root: 41, voice: [60, 64, 65, 69], mel: [65, 69, 72, 77] },
  { root: 45, voice: [60, 64, 67, 69], mel: [64, 67, 72, 76] },
  { root: 38, voice: [57, 62, 65, 69], mel: [62, 65, 69, 74] },
  { root: 46, voice: [58, 62, 65, 69], mel: [65, 70, 74, 77] },
];

const PENTA = [65, 67, 69, 72, 74, 77, 79];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.musicOn = true;
    this.master = null;
    this._timer = null;
    this._nextTime = 0;
    this._step = 0;              // 16th-note counter
    this.rain = 0;
    this.night = 0;
    this._rnd = Math.random;
  }

  /* ── boot (must follow a user gesture) ── */
  async start() {
    if (this.ready) { await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 3.2;
    comp.attack.value = 0.006;
    comp.release.value = 0.28;
    this.master.connect(comp).connect(ctx.destination);

    // ── shared reverb ──
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.9, 2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.34;
    this.reverb.connect(this.reverbGain).connect(this.master);

    // ── music bus: warm lowpass → tape wobble → master ──
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.85;

    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2400;
    tone.Q.value = 0.6;

    const cut = ctx.createBiquadFilter();       // shave the sub so it stays cosy
    cut.type = 'highpass';
    cut.frequency.value = 42;

    const wobble = ctx.createDelay(0.05);
    wobble.delayTime.value = 0.006;
    const wowLfo = ctx.createOscillator();
    const wowAmt = ctx.createGain();
    wowLfo.frequency.value = 0.28;
    wowAmt.gain.value = 0.0022;
    wowLfo.connect(wowAmt).connect(wobble.delayTime);
    wowLfo.start();

    this.musicOut = ctx.createGain();
    this.musicOut.gain.value = 1;
    this.musicBus.connect(tone).connect(cut).connect(wobble).connect(this.musicOut).connect(this.master);

    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.5;
    this.musicOut.connect(this.musicSend).connect(this.reverb);

    // ── ambience ──
    this._buildAmbience();
    this._buildVinyl();

    this.ready = true;
    this._nextTime = ctx.currentTime + 0.1;
    this._step = 0;
    this._timer = setInterval(() => this._scheduler(), 26);

    // gentle fade-in — nothing in Healy arrives abruptly
    this.master.gain.setValueAtTime(0.0001, ctx.currentTime);
    this.master.gain.exponentialRampToValueAtTime(0.75, ctx.currentTime + 3.5);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.ctx) this.ctx.suspend();
  }

  resume() {
    if (!this.ready) return;
    this.ctx.resume();
    if (!this._timer) {
      this._nextTime = this.ctx.currentTime + 0.1;
      this._timer = setInterval(() => this._scheduler(), 26);
    }
  }

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.ready) {
      const t = this.ctx.currentTime;
      this.musicOut.gain.cancelScheduledValues(t);
      this.musicOut.gain.setTargetAtTime(this.musicOn ? 1 : 0, t, 0.4);
    }
    return this.musicOn;
  }

  /* ── noise + impulse helpers ── */
  _noiseBuffer(seconds = 2, kind = 'white') {
    // percussion asks for these dozens of times a bar — build each shape once
    this._noiseCache = this._noiseCache || new Map();
    const key = `${kind}:${seconds}`;
    if (this._noiseCache.has(key)) return this._noiseCache.get(key);

    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
        else if (kind === 'pink') { last = 0.98 * last + 0.02 * w; d[i] = (w * 0.3 + last * 0.9); }
        else d[i] = w;
      }
    }
    this._noiseCache.set(key, buf);
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.2);
      }
    }
    return buf;
  }

  _loopNoise(kind, gainValue, filter) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3, kind);
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gainValue;
    let node = src;
    if (filter) { node = src.connect(filter); }
    node.connect(g);
    src.start();
    return { src, gain: g, filter };
  }

  /* ── ambience layers ── */
  _buildAmbience() {
    const ctx = this.ctx;
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = 1;
    this.ambBus.connect(this.master);

    // wind — brown noise through a slowly opening lowpass
    const windLp = ctx.createBiquadFilter();
    windLp.type = 'lowpass';
    windLp.frequency.value = 420;
    this.wind = this._loopNoise('brown', 0.09, windLp);
    this.wind.gain.connect(this.ambBus);
    const windLfo = ctx.createOscillator();
    const windAmt = ctx.createGain();
    windLfo.frequency.value = 0.06;
    windAmt.gain.value = 240;
    windLfo.connect(windAmt).connect(windLp.frequency);
    windLfo.start();
    const swellLfo = ctx.createOscillator();
    const swellAmt = ctx.createGain();
    swellLfo.frequency.value = 0.043;
    swellAmt.gain.value = 0.05;
    swellLfo.connect(swellAmt).connect(this.wind.gain.gain);
    swellLfo.start();

    // rain — a bright hiss plus a low roar, both driven by one amount
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'bandpass';
    rainHp.frequency.value = 2600;
    rainHp.Q.value = 0.45;
    this.rainHi = this._loopNoise('white', 0, rainHp);
    this.rainHi.gain.connect(this.ambBus);

    const rainLp = ctx.createBiquadFilter();
    rainLp.type = 'lowpass';
    rainLp.frequency.value = 620;
    this.rainLo = this._loopNoise('brown', 0, rainLp);
    this.rainLo.gain.connect(this.ambBus);

    // a touch of the rain into the reverb so it sounds like a wide field
    this.rainSend = ctx.createGain();
    this.rainSend.gain.value = 0.25;
    this.rainHi.gain.connect(this.rainSend).connect(this.reverb);

    // crickets — a shimmering band that only wakes at night
    const criBp = ctx.createBiquadFilter();
    criBp.type = 'bandpass';
    criBp.frequency.value = 4600;
    criBp.Q.value = 12;
    this.crickets = this._loopNoise('white', 0, criBp);
    this.crickets.gain.connect(this.ambBus);
    const criLfo = ctx.createOscillator();
    const criAmt = ctx.createGain();
    criLfo.type = 'square';
    criLfo.frequency.value = 11;
    criAmt.gain.value = 0.5;
    criLfo.connect(criAmt).connect(this.crickets.gain.gain);
    criLfo.start();

    this._birdTimer = 3;
  }

  _buildVinyl() {
    const ctx = this.ctx;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    this.vinyl = this._loopNoise('white', 0.02, hp);
    this.vinyl.gain.connect(this.musicBus);
  }

  /* ── one-shot voices ── */
  _env(node, t, a, d, s, r, peak = 1) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak * s), t + a + d);
    g.exponentialRampToValueAtTime(0.0001, t + a + d + r);
  }

  _keys(midi, t, dur, vel = 0.5) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.musicBus);

    // FM: sine carrier bent by a sine modulator = electric-piano bell
    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = f * 2.01;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 2.4 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.7);
    mod.connect(modGain).connect(car.frequency);

    car.connect(out);
    this._env(out, t, 0.008, 0.16, 0.32, dur, vel * 0.34);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.4); mod.stop(t + dur + 0.4);

    const send = ctx.createGain();
    send.gain.value = 0.42;
    out.connect(send).connect(this.reverb);
  }

  _pad(midis, t, dur, vel = 0.22) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(650, t + dur);
    out.connect(lp).connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    lp.connect(send).connect(this.reverb);

    for (const m of midis) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(m - 12);
        o.detune.value = det;
        o.connect(out);
        o.start(t);
        o.stop(t + dur + 1.2);
      }
    }
    this._env(out, t, dur * 0.35, dur * 0.25, 0.7, dur * 0.6, vel);
  }

  _bass(midi, t, dur, vel = 0.5) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    out.connect(lp).connect(this.musicBus);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(mtof(midi) * 1.01, t);
    o.frequency.exponentialRampToValueAtTime(mtof(midi), t + 0.06);
    o.connect(out);
    o.start(t); o.stop(t + dur + 0.3);
    this._env(out, t, 0.02, 0.1, 0.6, dur, vel);
  }

  _kick(t, vel = 0.9) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.musicBus);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    o.connect(out);
    o.start(t); o.stop(t + 0.4);
    this._env(out, t, 0.004, 0.06, 0.25, 0.2, vel * 0.7);
  }

  _snare(t, vel = 0.5) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.4, 'white');
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(bp).connect(out).connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    out.connect(send).connect(this.reverb);
    this._env(out, t, 0.004, 0.05, 0.2, 0.16, vel * 0.34);
    src.start(t); src.stop(t + 0.4);
  }

  _hat(t, vel = 0.3) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.2, 'white');
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const out = ctx.createGain();
    out.gain.value = 0;
    src.connect(hp).connect(out).connect(this.musicBus);
    this._env(out, t, 0.002, 0.02, 0.1, 0.05, vel * 0.18);
    src.start(t); src.stop(t + 0.2);
  }

  /** a short two-note whistle, used for the birds */
  chirp() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.ambBus);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    out.connect(send).connect(this.reverb);

    const o = ctx.createOscillator();
    o.type = 'sine';
    const base = 1800 + Math.random() * 1400;
    o.frequency.setValueAtTime(base, t);
    o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), t + 0.07);
    o.frequency.exponentialRampToValueAtTime(base * 0.85, t + 0.16);
    o.connect(out);
    this._env(out, t, 0.01, 0.05, 0.4, 0.12, 0.06);
    o.start(t); o.stop(t + 0.4);
  }

  /* ── the clock ── */
  _scheduler() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const stepDur = BEAT / 4;
    while (this._nextTime < ctx.currentTime + 0.2) {
      this._playStep(this._step, this._nextTime);
      this._step++;
      this._nextTime += stepDur;
    }
  }

  _playStep(step, t) {
    const inBar = step % 16;
    const bar = Math.floor(step / 16);
    const chord = PROG[Math.floor(bar / 2) % PROG.length];
    // lay the 2nd and 4th sixteenths back a hair — that's the shuffle
    const swing = (inBar % 4 === 2) ? BEAT * 0.055 : 0;
    const at = t + swing;

    if (inBar === 0) {
      if (bar % 2 === 0) this._pad(chord.voice, t, BAR * 2 - 0.15, 0.2);
      this._bass(chord.root, t, BEAT * 1.6, 0.5);
    }
    if (inBar === 10) this._bass(chord.root + 7, at, BEAT * 0.8, 0.32);

    // drums
    if (inBar === 0) this._kick(t, 0.95);
    if (inBar === 6) this._kick(at, 0.55);
    if (inBar === 10 && bar % 2 === 1) this._kick(at, 0.6);
    if (inBar === 4 || inBar === 12) this._snare(t, 0.55);
    if (inBar % 2 === 0) this._hat(at, inBar % 4 === 0 ? 0.36 : 0.2);
    if (inBar === 14 && Math.random() < 0.35) this._hat(at + stepNudge(), 0.14);

    // keys: a loose arpeggio, never quite the same twice
    if (inBar % 4 === 0 || (inBar % 2 === 0 && Math.random() < 0.35)) {
      const n = chord.voice[Math.floor(Math.random() * chord.voice.length)];
      this._keys(n, at, BEAT * (0.8 + Math.random()), 0.35 + Math.random() * 0.3);
    }
    if (inBar === 8 && Math.random() < 0.6) {
      this._keys(chord.voice[0] + 12, at, BEAT * 1.4, 0.28);
    }

    // melody: sparse, so it always feels like an afterthought
    if (inBar === 0 && bar % 4 === 2 && Math.random() < 0.75) {
      const n = PENTA[Math.floor(Math.random() * PENTA.length)];
      this._keys(n, t + BEAT * 0.5, BEAT * 2.2, 0.4);
      if (Math.random() < 0.6) {
        this._keys(PENTA[Math.floor(Math.random() * PENTA.length)], t + BEAT * 1.8, BEAT * 1.6, 0.3);
      }
    }

    // stray vinyl pop
    if (Math.random() < 0.02) this._pop(t);
  }

  _pop(t) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.musicBus);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 900 + Math.random() * 2500;
    o.connect(out);
    this._env(out, t, 0.001, 0.006, 0.05, 0.02, 0.05);
    o.start(t); o.stop(t + 0.06);
  }

  /* ── continuous state from the world ── */
  update(dt, { rain = 0, night = 0, wind = 0.5, moving = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const set = (param, v, tau = 0.6) => param.setTargetAtTime(v, t, tau);

    this.rain = rain;
    this.night = night;

    set(this.rainHi.gain.gain, rain * 0.12, 0.8);
    set(this.rainLo.gain.gain, rain * 0.16, 0.8);
    set(this.crickets.gain.gain, night * (1 - rain) * 0.012, 1.5);
    set(this.wind.gain.gain, 0.06 + wind * 0.05, 1.2);

    // the music ducks a touch under heavy rain, like a radio in another room
    set(this.musicBus.gain, 0.85 - rain * 0.18, 0.9);

    // birdsong: daytime, dry weather only
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 2 + Math.random() * 7;
      if (night < 0.35 && rain < 0.3 && Math.random() < 0.7) {
        this.chirp();
        if (Math.random() < 0.4) setTimeout(() => this.chirp(), 180 + Math.random() * 260);
      }
    }
  }
}

function stepNudge() { return (Math.random() - 0.5) * 0.02; }
