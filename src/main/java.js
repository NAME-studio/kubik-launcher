'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const os = require('os');
const paths = require('./paths');
const net = require('./net');
const store = require('./store');
const { ensureDir, exists, isDir, formatBytes } = require('./util');
const zip = require('./zip');

let cache = null;
let cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000;

function parseVersion(output) {
  const text = String(output || '');
  const match = text.match(/version "([^"]+)"/i) || text.match(/openjdk (\S+)/i);
  if (!match) return null;
  const raw = match[1];
  const parts = raw.split(/[._+-]/);
  let major = parseInt(parts[0], 10);
  if (major === 1 && parts[1]) major = parseInt(parts[1], 10);
  return { raw, major };
}

function probe(javaPath, timeout = 15000) {
  return new Promise((resolve) => {
    const child = execFile(javaPath, ['-version'], { windowsHide: true, timeout }, (error, stdout, stderr) => {
      const info = parseVersion(`${stderr}\n${stdout}`);
      if (info && info.major) resolve({ path: javaPath, version: info.raw, major: info.major, ok: true });
      else resolve({ path: javaPath, ok: false, error: error ? error.message : 'Не удалось определить версию Java' });
    });
    child.on('error', () => resolve({ path: javaPath, ok: false }));
  });
}

function rememberJava(info) {
  if (!info || !info.ok || !info.path) return;
  const settings = store.getSettings();
  const cache = settings.javaCache && typeof settings.javaCache === 'object' ? settings.javaCache : {};
  const byMajor = { ...(cache.byMajor || {}) };
  const key = String(info.major);
  const existing = byMajor[key];
  if (existing && existing.path === info.path && existing.version === info.version) return;
  byMajor[key] = { path: info.path, version: info.version, major: info.major, at: Date.now() };
  store.saveSettings({ javaCache: { ...cache, byMajor } });
}

function cachedJava(required) {
  const cache = store.getSettings().javaCache || {};
  const byMajor = cache.byMajor || {};
  const floor = required <= 8 ? 8 : required;
  const key = String(required);
  const direct = byMajor[key];
  if (direct && direct.path && exists(direct.path) && direct.major >= floor) {
    return { path: direct.path, version: direct.version, major: direct.major, ok: true };
  }
  const candidates = Object.values(byMajor)
    .filter((entry) => entry && entry.path && exists(entry.path) && entry.major >= floor)
    .sort((a, b) => a.major - b.major);
  const pick = candidates[0];
  return pick ? { path: pick.path, version: pick.version, major: pick.major, ok: true } : null;
}

function candidatePaths() {
  const list = [];
  const settings = store.getSettings();
  if (settings.javaPath) list.push(settings.javaPath);
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  list.push('java.exe');

  const roots = [
    'C:/Program Files/Java',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files/AdoptOpenJDK',
    'C:/Program Files/Microsoft',
    'C:/Program Files/Zulu',
    'C:/Program Files/BellSoft',
    'C:/Program Files/Amazon Corretto',
    'C:/Program Files (x86)/Java',
    'C:/Program Files (x86)/Eclipse Adoptium',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft'),
    path.join(os.homedir(), '.jdks'),
  ];

  for (const root of roots) {
    if (!root || !isDir(root)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      list.push(path.join(root, entry.name, 'bin', 'java.exe'));
      list.push(path.join(root, entry.name, 'Contents', 'Home', 'bin', 'java.exe'));
    }
    list.push(path.join(root, 'bin', 'java.exe'));
  }

  const runtimeDir = paths.runtime();
  if (isDir(runtimeDir)) {
    for (const entry of fs.readdirSync(runtimeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      list.push(path.join(runtimeDir, entry.name, 'bin', 'java.exe'));
      const nested = path.join(runtimeDir, entry.name);
      try {
        for (const sub of fs.readdirSync(nested, { withFileTypes: true })) {
          if (sub.isDirectory()) list.push(path.join(nested, sub.name, 'bin', 'java.exe'));
        }
      } catch {
        /* ignore */
      }
    }
  }

  const seen = new Set();
  return list.filter((item) => {
    const key = path.resolve(item).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function listJava(force = false) {
  if (cache && !force && Date.now() - cacheAt < CACHE_TTL) return cache;
  const candidates = candidatePaths().filter((candidate) => candidate === 'java.exe' || exists(candidate));
  const probed = [];
  let index = 0;
  const worker = async () => {
    while (index < candidates.length) {
      const current = candidates[index];
      index += 1;
      const info = await probe(current, 4000);
      if (info.ok) probed.push(info);
    }
  };
  const workers = Math.max(1, Math.min(6, candidates.length));
  await Promise.all(new Array(workers).fill(0).map(worker));

  const found = [];
  for (const info of probed) {
    const real = info.path === 'java.exe' ? 'java.exe (PATH)' : info.path;
    if (!found.some((f) => f.major === info.major && f.version === info.version)) {
      found.push({ ...info, path: real });
    }
  }
  found.sort((a, b) => b.major - a.major);
  cache = found;
  cacheAt = Date.now();
  for (const entry of found) rememberJava(entry);
  return found;
}

function suitable(javaList, requiredMajor) {
  const list = javaList || [];
  const required = requiredMajor || 8;
  const floor = required <= 8 ? 8 : required;
  const ok = list.filter((j) => j.major >= floor);
  if (!ok.length) return null;
  const exact = ok.find((j) => j.major === required);
  if (exact) return exact;
  if (required <= 8) {
    const legacy = ok.filter((j) => j.major <= 11).sort((a, b) => a.major - b.major);
    if (legacy.length) return legacy[0];
  }
  return ok.sort((a, b) => a.major - b.major)[0];
}

async function ensureJava(requiredMajor, onProgress, preferredPath) {
  const settings = store.getSettings();
  const floor = !requiredMajor || requiredMajor <= 8 ? 8 : requiredMajor;
  const explicit = [preferredPath, settings.javaPath].filter(Boolean);
  for (const candidate of explicit) {
    if (!exists(candidate)) continue;
    const info = await probe(candidate, 6000);
    if (info.ok && info.major >= floor) {
      rememberJava(info);
      return { ...info, source: candidate === preferredPath ? 'instance' : 'settings' };
    }
  }

  const cached = cachedJava(requiredMajor || 8);
  if (cached) return { ...cached, source: 'cache' };

  let list = await listJava();
  let found = suitable(list, requiredMajor);
  if (!found) {
    list = await listJava(true);
    found = suitable(list, requiredMajor);
  }
  if (found) {
    rememberJava(found);
    return { ...found, source: 'system' };
  }

  const major = requiredMajor && requiredMajor >= 9 ? requiredMajor : requiredMajor === 8 ? 8 : 17;
  const downloaded = await downloadRuntime(major, onProgress);
  cache = null;
  return { ...downloaded, source: 'download' };
}

async function downloadRuntime(major, onProgress) {
  const targetDir = ensureDir(path.join(paths.runtime(), `java-${major}`));
  const existing = path.join(targetDir, 'bin', 'java.exe');
  if (exists(existing)) {
    const info = await probe(existing);
    if (info.ok) return info;
  }
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  const archive = path.join(paths.cache(), `jre-${major}.zip`);
  if (onProgress) onProgress({ stage: 'java', detail: `Скачиваю Java ${major}`, percent: 0 });
  await net.downloadFile(url, archive, {
    retries: 2,
    timeout: 300000,
    onBytes: (bytes, meta) => {
      if (!onProgress) return;
      const total = meta && meta.total;
      const percent = total ? Math.min(88, Math.round((meta.received / total) * 85)) : 0;
      onProgress({ stage: 'java', detail: `Скачиваю Java ${major}`, percent, bytes });
    },
  });
  if (onProgress) onProgress({ stage: 'java', detail: 'Распаковываю Java', percent: 90 });
  const tmp = path.join(paths.cache(), `jre-${major}-unpack`);
  require('./util').unlinkQuiet(tmp);
  ensureDir(tmp);
  zip.extract(archive, tmp, { stripPrefix: 0 });
  const children = fs.readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isDirectory());
  const source = children.length === 1 ? path.join(tmp, children[0].name) : tmp;
  require('./util').unlinkQuiet(targetDir);
  fs.renameSync(source, targetDir);
  require('./util').unlinkQuiet(tmp);
  try {
    fs.rmSync(archive, { force: true });
  } catch {
    /* ignore */
  }
  const info = await probe(path.join(targetDir, 'bin', 'java.exe'));
  if (!info.ok) throw new Error('Не удалось установить Java');
  if (onProgress) onProgress({ stage: 'java', detail: `Java ${major} готова`, percent: 100 });
  return info;
}

module.exports = { listJava, ensureJava, downloadRuntime, probe, suitable };
