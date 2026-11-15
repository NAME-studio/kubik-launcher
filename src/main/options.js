'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { ensureDir, exists } = require('./util');

const DEFAULTS = {
  lang: 'ru_ru',
  graphicsMode: 'fancy',
  renderDistance: '8',
  simulationDistance: '8',
  guiScale: '0',
  particles: 'all',
  maxFps: '120',
  enableVsync: 'true',
  fov: '70',
  gamma: '0.5',
  soundCategory_master: '1.0',
  pauseOnLostFocus: 'true',
  onboardAccessibility: 'false',
  skipMultiplayerWarning: 'true',
  tutorialStep: 'none',
};

const ONBOARD_KEYS = {
  onboardAccessibility: 'false',
  skipMultiplayerWarning: 'true',
  tutorialStep: 'none',
};

function fileFor(instanceId) {
  return path.join(paths.instanceDir(instanceId), 'options.txt');
}

function read(instanceId) {
  const result = { ...DEFAULTS };
  const file = fileFor(instanceId);
  if (!exists(file)) return result;
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const index = line.indexOf(':');
      if (index <= 0) continue;
      result[line.slice(0, index)] = line.slice(index + 1);
    }
  } catch {
    /* повреждённый файл — вернём значения по умолчанию */
  }
  return result;
}

function write(instanceId, patch) {
  const merged = read(instanceId);
  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null || value === '') continue;
    merged[key] = String(value);
  }
  const file = fileFor(instanceId);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${Object.entries(merged).map(([k, v]) => `${k}:${v}`).join('\n')}\n`, 'utf8');
  return merged;
}

function ensureOnboardingSkipped(instanceId) {
  const file = fileFor(instanceId);
  let raw = '';
  if (exists(file)) {
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      raw = '';
    }
  }
  const missing = {};
  for (const [key, value] of Object.entries(ONBOARD_KEYS)) {
    const found = new RegExp(`^${key}:(.*)$`, 'm').exec(raw);
    if (!found || String(found[1]).trim() !== value) missing[key] = value;
  }
  if (!raw || Object.keys(missing).length) write(instanceId, missing);
  return missing;
}

module.exports = { DEFAULTS, ONBOARD_KEYS, read, write, fileFor, ensureOnboardingSkipped };
