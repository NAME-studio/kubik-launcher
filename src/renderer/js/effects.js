'use strict';

(() => {
  const PALETTES = {
    lime: { accent: '#7ee787', accent2: '#4fd6b0' },
    blue: { accent: '#6cb2ff', accent2: '#8fd0ff' },
    violet: { accent: '#a98bff', accent2: '#c9a6ff' },
    red: { accent: '#ff8b7a', accent2: '#ffab9c' },
    orange: { accent: '#ffb547', accent2: '#ffd479' },
    graphite: { accent: '#c7d2e0', accent2: '#a4b3c6' },
  };

  let soundEnabled = true;
  let context = null;

  function hexToRgb(hex) {
    const clean = String(hex || '').trim().replace('#', '');
    const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  function rgbToHex({ r, g, b }) {
    const part = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${part(r)}${part(g)}${part(b)}`;
  }

  function rgbToHsl({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
    return { h, s, l };
  }

  function hslToRgb({ h, s, l }) {
    if (s === 0) {
      const value = l * 255;
      return { r: value, g: value, b: value };
    }
    const hue = (p, q, t) => {
      let tt = t;
      if (tt < 0) tt += 1;
      if (tt > 1) tt -= 1;
      if (tt < 1 / 6) return p + (q - p) * 6 * tt;
      if (tt < 1 / 2) return q;
      if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: hue(p, q, h + 1 / 3) * 255,
      g: hue(p, q, h) * 255,
      b: hue(p, q, h - 1 / 3) * 255,
    };
  }

  function shift(hex, degrees, lightness) {
    const rgb = hexToRgb(hex);
    if (!rgb) return hex;
    const hsl = rgbToHsl(rgb);
    hsl.h = (hsl.h + degrees / 360 + 1) % 1;
    if (lightness) hsl.l = Math.max(0.08, Math.min(0.92, hsl.l + lightness));
    return rgbToHex(hslToRgb(hsl));
  }

  function luminance({ r, g, b }) {
    const f = (value) => {
      const s = value / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  function applyAccent(value) {
    const key = String(value || '').trim().toLowerCase();
    const preset = PALETTES[key];
    const custom = !preset && hexToRgb(key);
    const base = preset ? preset.accent : custom ? rgbToHex(custom) : PALETTES.lime.accent;
    const secondary = preset ? preset.accent2 : shift(base, 18, 0.1);
    const rgb = hexToRgb(base) || { r: 126, g: 231, b: 135 };
    const rgb2 = hexToRgb(secondary) || rgb;
    const root = document.documentElement;
    root.style.setProperty('--accent', base);
    root.style.setProperty('--accent-2', secondary);
    root.style.setProperty('--accent-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.14)`);
    root.style.setProperty('--accent-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.28)`);
    root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty('--accent2-rgb', `${rgb2.r}, ${rgb2.g}, ${rgb2.b}`);
    root.style.setProperty('--on-accent', luminance(rgb) > 0.45 ? '#08110b' : '#ffffff');
    root.dataset.accent = preset ? key : 'custom';
  }

  function accentPresets() {
    return Object.entries(PALETTES).map(([name, value]) => ({ name, ...value }));
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

  function applyTheme(name) {
    document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
  }

  window.Effects = {
    palettes: Object.keys(PALETTES),
    accentPresets,
    applyAccent,
    applyTheme,
    sound,
    bindClicks,
    setSoundEnabled(value) {
      soundEnabled = value !== false;
    },
    soundEnabled: () => soundEnabled,
  };
})();
