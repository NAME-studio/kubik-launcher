'use strict';

(() => {
  const PALETTES = {
    lime: { accent: '#8ce86a', accent2: '#3fd0a8', rgb: '140, 232, 106', rgb2: '63, 208, 168', soft: 'rgba(140, 232, 106, 0.14)' },
    blue: { accent: '#6fb5ff', accent2: '#45d0ff', rgb: '111, 181, 255', rgb2: '69, 208, 255', soft: 'rgba(111, 181, 255, 0.16)' },
    violet: { accent: '#b79cff', accent2: '#e07bff', rgb: '183, 156, 255', rgb2: '224, 123, 255', soft: 'rgba(183, 156, 255, 0.16)' },
    red: { accent: '#ff7d6e', accent2: '#ff5c9e', rgb: '255, 125, 110', rgb2: '255, 92, 158', soft: 'rgba(255, 125, 110, 0.16)' },
    orange: { accent: '#ffb45c', accent2: '#ffd166', rgb: '255, 180, 92', rgb2: '255, 209, 102', soft: 'rgba(255, 180, 92, 0.16)' },
  };

  let soundEnabled = true;
  let context = null;

  function applyAccent(name) {
    const palette = PALETTES[name] || PALETTES.lime;
    const root = document.documentElement;
    root.style.setProperty('--accent', palette.accent);
    root.style.setProperty('--accent-2', palette.accent2);
    root.style.setProperty('--accent-soft', palette.soft);
    root.style.setProperty('--accent-rgb', palette.rgb);
    root.style.setProperty('--accent2-rgb', palette.rgb2);
    root.dataset.accent = PALETTES[name] ? name : 'lime';
  }

  function audio() {
    if (!soundEnabled) return null;
    try {
      if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
      if (context.state === 'suspended') context.resume();
      return context;
    } catch {
      return null;
    }
  }

  function tone(frequency, duration, options = {}) {
    const ctx = audio();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime;
    osc.type = options.type || 'sine';
    osc.frequency.setValueAtTime(frequency, at);
    if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.05, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  function sound(type) {
    if (!soundEnabled) return;
    if (type === 'click') tone(760, 0.045, { volume: 0.028 });
    else if (type === 'success') {
      tone(620, 0.09, { volume: 0.045 });
      setTimeout(() => tone(940, 0.11, { volume: 0.04 }), 70);
    } else if (type === 'error') {
      tone(220, 0.16, { type: 'triangle', volume: 0.05, slideTo: 160 });
    } else if (type === 'open') tone(520, 0.06, { volume: 0.03, slideTo: 700 });
  }

  function bindClicks() {
    document.addEventListener(
      'pointerdown',
      (event) => {
        const target = event.target.closest('button, .chip, .nav-item, .accent-chip, .switch');
        if (target && !target.disabled) sound('click');
      },
      true,
    );
  }

  function accentColor() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return value || '#8ce86a';
  }

  function accentRgba(alpha) {
    const rgb = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
    return `rgba(${rgb || '140, 232, 106'}, ${alpha})`;
  }

  window.accentColor = accentColor;
  window.accentRgba = accentRgba;

  window.Effects = {
    palettes: Object.keys(PALETTES),
    applyAccent,
    sound,
    bindClicks,
    setSoundEnabled(value) {
      soundEnabled = value !== false;
    },
    soundEnabled: () => soundEnabled,
  };
})();
