/* Disaster City Challenge - Web Audio API generated sound effects (no audio files) */

const AudioFX = (function () {
  let ctx = null;
  let enabled = true;
  let noiseLoopNode = null;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function setEnabled(v) { enabled = v; }
  function isEnabled() { return enabled; }

  function tone(freq, duration, opts) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    opts = opts || {};
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime);
    if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), c.currentTime + duration);
    const vol = opts.volume != null ? opts.volume : 0.15;
    gain.gain.setValueAtTime(0.0001, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(vol, c.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    osc.connect(gain).connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + duration + 0.02);
  }

  function noiseBurst(duration, opts) {
    if (!enabled) return;
    const c = ensureCtx();
    if (!c) return;
    opts = opts || {};
    const bufferSize = Math.floor(c.sampleRate * duration);
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = c.createBufferSource();
    src.buffer = buffer;
    const filter = c.createBiquadFilter();
    filter.type = opts.filterType || 'lowpass';
    filter.frequency.value = opts.filterFreq || 1200;
    const gain = c.createGain();
    gain.gain.value = opts.volume != null ? opts.volume : 0.2;
    src.connect(filter).connect(gain).connect(c.destination);
    src.start();
  }

  return {
    setEnabled, isEnabled, ensureCtx,
    click()      { tone(520, 0.06, { type: 'square', volume: 0.08 }); },
    place()      { tone(340, 0.10, { type: 'triangle', sweepTo: 520, volume: 0.14 }); },
    undo()       { tone(300, 0.08, { type: 'sine', sweepTo: 180, volume: 0.1 }); },
    zoneFull()   { tone(200, 0.12, { type: 'square', volume: 0.1 }); },
    warning()    { tone(880, 0.18, { type: 'sawtooth', sweepTo: 440, volume: 0.16 }); },
    beep()       { tone(660, 0.09, { type: 'square', volume: 0.14 }); },
    beepUrgent() { tone(920, 0.12, { type: 'square', volume: 0.2 }); },
    wind()       { noiseBurst(0.6, { filterType: 'highpass', filterFreq: 800, volume: 0.06 }); },
    rumble()     { noiseBurst(0.9, { filterType: 'lowpass', filterFreq: 180, volume: 0.22 }); },
    simStart()   { tone(220, 0.4, { type: 'sawtooth', sweepTo: 60, volume: 0.2 }); },
    damage()     { tone(180, 0.25, { type: 'square', sweepTo: 60, volume: 0.18 }); },
    victory()    {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.22, { type: 'triangle', volume: 0.16 }), i * 110));
    },
    failure()    {
      [392, 349, 294].forEach((f, i) => setTimeout(() => tone(f, 0.3, { type: 'sawtooth', volume: 0.14 }), i * 140));
    }
  };
})();
