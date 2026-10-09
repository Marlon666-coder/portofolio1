/*
 * Generative ambient score built with the Web Audio API — no audio files.
 * A detuned drone + pad glides to a new root per chapter; filtered noise
 * swells with scroll velocity; chapter changes trigger a delayed chime.
 */
(function () {
  // Root note (Hz) for each chapter.
  const ROOTS = [55.0, 49.0, 58.27, 43.65, 51.91, 46.25, 61.74, 55.0];
  const PAD_RATIOS = [1.5, 2, 3, 4.5];

  const Audio = {
    ctx: null,
    enabled: false,
    chapter: 0,

    start() {
      if (this.ctx) return this.setEnabled(true);
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const now = ctx.currentTime;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(comp);

      // feedback delay "space"
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.42;
      const fb = ctx.createGain();
      fb.gain.value = 0.45;
      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      const damp = ctx.createBiquadFilter();
      damp.type = "lowpass";
      damp.frequency.value = 2400;
      delay.connect(damp).connect(fb).connect(delay);
      damp.connect(wet).connect(this.master);
      this.send = delay;

      // drone
      this.filter = ctx.createBiquadFilter();
      this.filter.type = "lowpass";
      this.filter.frequency.value = 320;
      this.filter.Q.value = 6;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0.16;
      this.filter.connect(droneGain).connect(this.master);

      const root = ROOTS[0];
      this.drone = [-7, 0, 6].map((det) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = root;
        o.detune.value = det;
        o.connect(this.filter);
        o.start(now);
        return o;
      });
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = root / 2;
      const subG = ctx.createGain();
      subG.gain.value = 0.22;
      sub.connect(subG).connect(this.master);
      sub.start(now);
      this.sub = sub;

      // slow filter LFO
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 180;
      lfo.connect(lfoG).connect(this.filter.frequency);
      lfo.start(now);

      // pad
      const padBus = ctx.createGain();
      padBus.gain.value = 0.05;
      padBus.connect(this.master);
      padBus.connect(this.send);
      this.pad = PAD_RATIOS.map((r, i) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = root * r;
        const g = ctx.createGain();
        g.gain.value = 0.5;
        const trem = ctx.createOscillator();
        trem.frequency.value = 0.05 + i * 0.031;
        const tg = ctx.createGain();
        tg.gain.value = 0.45;
        trem.connect(tg).connect(g.gain);
        o.connect(g).connect(padBus);
        o.start(now); trem.start(now);
        return { o, r };
      });

      // wind / data-flow noise
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      this.noiseFilter = ctx.createBiquadFilter();
      this.noiseFilter.type = "bandpass";
      this.noiseFilter.frequency.value = 600;
      this.noiseFilter.Q.value = 0.8;
      this.noiseGain = ctx.createGain();
      this.noiseGain.gain.value = 0.01;
      noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
      this.noiseGain.connect(this.send);
      noise.start(now);

      this.setEnabled(true);
    },

    setEnabled(on) {
      this.enabled = on;
      if (!this.ctx) return;
      if (on && this.ctx.state === "suspended") this.ctx.resume();
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 0.8 : 0.25);
    },

    toggle() {
      if (!this.ctx) this.start();
      else this.setEnabled(!this.enabled);
      return this.enabled;
    },

    /** Called every frame with scroll velocity (chapters / second). */
    update(velocity) {
      if (!this.ctx || !this.enabled) return;
      const t = this.ctx.currentTime;
      const v = Math.min(1, Math.abs(velocity) * 1.4);
      this.noiseGain.gain.setTargetAtTime(0.008 + v * 0.11, t, 0.12);
      this.noiseFilter.frequency.setTargetAtTime(400 + v * 2600, t, 0.15);
      this.filter.Q.setTargetAtTime(6 + v * 6, t, 0.2);
    },

    setChapter(i) {
      if (i === this.chapter) return;
      this.chapter = i;
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const root = ROOTS[i % ROOTS.length];
      this.drone.forEach((o) => o.frequency.setTargetAtTime(root, t, 0.6));
      this.sub.frequency.setTargetAtTime(root / 2, t, 0.6);
      this.pad.forEach(({ o, r }) => o.frequency.setTargetAtTime(root * r, t, 0.9));
      this.chime(root * 8, 0.12);
      this.chime(root * 12, 0.06, 0.09);
    },

    chime(freq, vol = 0.1, delay = 0) {
      if (!this.ctx || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(g);
      g.connect(this.master);
      g.connect(this.send);
      o.start(t);
      o.stop(t + 2.4);
    },

    tick() {
      if (!this.ctx || !this.enabled) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(2400, t);
      o.frequency.exponentialRampToValueAtTime(1200, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.1);
    },
  };

  window.EdolusAudio = Audio;
})();
