/**
 * Лёгкий синтезатор звуков на Web Audio API (sound.js)
 * В оригинальном Monopoly.ipa звуки занимают сотни мегабайт в файлах .resource,
 * а мы генерируем приятные щелчки кубиков, шагов и монет прямо на лету — вес 2 КБ!
 */
(function (root) {
  let ctx = null;
  let enabled = true;

  function ensureCtx() {
    if (!enabled) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!ctx) ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function tone(freq, duration, type = 'sine', vol = 0.08, delay = 0) {
    const c = ensureCtx();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  root.GameSound = {
    isEnabled() {
      return enabled;
    },
    toggle() {
      enabled = !enabled;
      if (enabled) this.click();
      return enabled;
    },
    click() {
      tone(520, 0.05, 'triangle', 0.06);
    },
    dice() {
      [0, 0.06, 0.12, 0.19, 0.27].forEach((d, i) => {
        tone(240 + i * 55 + Math.random() * 60, 0.045, 'square', 0.035, d);
      });
    },
    step() {
      tone(380 + Math.random() * 50, 0.045, 'triangle', 0.05);
    },
    buy() {
      tone(523.25, 0.09, 'sine', 0.08, 0);
      tone(659.25, 0.09, 'sine', 0.08, 0.08);
      tone(783.99, 0.16, 'sine', 0.09, 0.16);
    },
    pay() {
      tone(440, 0.09, 'sawtooth', 0.045, 0);
      tone(330, 0.15, 'sawtooth', 0.045, 0.09);
    },
    card() {
      tone(587.33, 0.08, 'triangle', 0.07, 0);
      tone(880, 0.14, 'triangle', 0.07, 0.07);
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone(f, 0.22, 'triangle', 0.09, i * 0.11);
      });
    }
  };
})(window);
