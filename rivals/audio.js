/* =========================================================
   RIVALS 2050 — PROCEDURAL AUDIO ENGINE
   Web Audio synthesis. No external files. No dependencies.
   Respects autoplay policy via .resume() on user gesture.
   ========================================================= */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.5;
    this._lastLowHealth = 0;
    this._fireGate = 0;
    this._noiseBuf = null;
  }

  init() {
    if (this.ctx) return this.ctx;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? this.volume : 0;
      this.master.connect(this.ctx.destination);
    } catch (e) {
      console.warn('[AUDIO] init failed:', e);
    }
    return this.ctx;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (this.master) this.master.gain.value = this.enabled ? this.volume : 0;
  }

  _ready() {
    return this.ctx && this.enabled && this.volume > 0.005;
  }

  _tone(freq, duration, opts = {}) {
    if (!this._ready()) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = opts.type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.freqEnd !== undefined) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + duration);
      }
      const peak = Math.max(0.0002, opts.gain ?? 0.15);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, duration * 0.15));
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + duration + 0.03);
    } catch (_) {}
  }

  _noise(duration, opts = {}) {
    if (!this._ready()) return;
    try {
      if (!this._noiseBuf) {
        const sr = this.ctx.sampleRate;
        const len = Math.floor(sr * 0.4);
        this._noiseBuf = this.ctx.createBuffer(1, len, sr);
        const data = this._noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = opts.filterType || 'highpass';
      filter.frequency.value = opts.filterFreq || 900;
      const gain = this.ctx.createGain();
      const peak = Math.max(0.0002, opts.gain ?? 0.18);
      gain.gain.setValueAtTime(peak, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t, 0, duration);
      src.stop(t + duration + 0.02);
    } catch (_) {}
  }

  shoot() {
    const now = performance.now();
    if (now - this._fireGate < 60) return;
    this._fireGate = now;
    this._noise(0.06, { filterType: 'highpass', filterFreq: 1400, gain: 0.22 });
    this._tone(180, 0.07, { type: 'square', gain: 0.10, freqEnd: 90 });
  }

  hit() {
    this._tone(880, 0.08, { type: 'triangle', gain: 0.14 });
    this._tone(1320, 0.05, { type: 'sine', gain: 0.07 });
  }

  headshot() {
    this._tone(1320, 0.06, { type: 'triangle', gain: 0.16 });
    this._tone(1980, 0.10, { type: 'sine', gain: 0.11 });
  }

  kill() {
    this._tone(220, 0.16, { type: 'sawtooth', gain: 0.14, freqEnd: 80 });
    this._tone(440, 0.20, { type: 'triangle', gain: 0.10, freqEnd: 660 });
  }

  reloadStart() {
    this._tone(400, 0.08, { type: 'square', gain: 0.09 });
    setTimeout(() => this._tone(300, 0.06, { type: 'square', gain: 0.09 }), 120);
  }

  reloadEnd() {
    this._tone(600, 0.08, { type: 'square', gain: 0.11 });
    setTimeout(() => this._tone(800, 0.06, { type: 'square', gain: 0.11 }), 80);
  }

  dash() {
    this._noise(0.20, { filterType: 'bandpass', filterFreq: 650, gain: 0.16 });
    this._tone(300, 0.15, { type: 'sine', gain: 0.07, freqEnd: 900 });
  }

  jump() {
    this._tone(320, 0.10, { type: 'sine', gain: 0.09, freqEnd: 520 });
  }

  capture() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.20, { type: 'triangle', gain: 0.13 }), i * 70);
    });
  }

  death() {
    this._tone(200, 0.42, { type: 'sawtooth', gain: 0.14, freqEnd: 45 });
  }

  spawn() {
    this._tone(400, 0.28, { type: 'triangle', gain: 0.10, freqEnd: 1200 });
  }

  victory() {
    [523, 659, 784, 1047, 1319].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.42, { type: 'triangle', gain: 0.15 }), i * 100);
    });
  }

  defeat() {
    [523, 466, 415, 349].forEach((f, i) => {
      setTimeout(() => this._tone(f, 0.42, { type: 'sine', gain: 0.13 }), i * 130);
    });
  }

  uiClick() {
    this._tone(700, 0.05, { type: 'square', gain: 0.06 });
  }

  lowHealth() {
    const now = performance.now();
    if (now - this._lastLowHealth < 1200) return;
    this._lastLowHealth = now;
    this._tone(600, 0.20, { type: 'sine', gain: 0.07, freqEnd: 380 });
  }
}
