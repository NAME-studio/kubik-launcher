'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PLATFORM = 'windows';
const ARCH = 'x64';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function sizeOf(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1;
  }
}

function unlinkQuiet(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function sha1File(p) {
  const hash = crypto.createHash('sha1');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read = 0;
    while ((read = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function sha1Buffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex');
}

function randomId(len = 16) {
  return crypto.randomBytes(len).toString('hex');
}

function uuidDashed(hex) {
  const clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '').padEnd(32, '0').slice(0, 32);
  return `${clean.slice(0, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}-${clean.slice(16, 20)}-${clean.slice(20)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ruleMatches(rule, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== PLATFORM) return false;
    if (rule.os.arch && rule.os.arch !== ARCH) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(os.release())) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if (Boolean(features[key]) !== Boolean(value)) return false;
    }
  }
  return true;
}

function isAllowed(rules, features = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow';
  }
  return allowed;
}

function parseMaven(name) {
  let raw = String(name);
  let ext = 'jar';
  if (raw.includes('@')) {
    const idx = raw.lastIndexOf('@');
    ext = raw.slice(idx + 1);
    raw = raw.slice(0, idx);
  }
  const parts = raw.split(':');
  const [group, artifact, version, classifier] = parts;
  return { group, artifact, version, classifier, ext };
}

function mavenPath(name) {
  const m = parseMaven(name);
  const file = `${m.artifact}-${m.version}${m.classifier ? `-${m.classifier}` : ''}.${m.ext}`;
  return `${m.group.replace(/\./g, '/')}/${m.artifact}/${m.version}/${file}`;
}

function libraryKey(name) {
  const m = parseMaven(name);
  return `${m.group}:${m.artifact}:${m.classifier || ''}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function slugify(text) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
    х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  };
  return String(text || '')
    .toLowerCase()
    .split('')
    .map((ch) => (map[ch] !== undefined ? map[ch] : ch))
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `instance-${Date.now().toString(36)}`;
}

module.exports = {
  PLATFORM,
  ARCH,
  ensureDir,
  exists,
  isDir,
  sizeOf,
  unlinkQuiet,
  sha1File,
  sha1Buffer,
  randomId,
  uuidDashed,
  sleep,
  isAllowed,
  parseMaven,
  mavenPath,
  libraryKey,
  formatBytes,
  slugify,
};
