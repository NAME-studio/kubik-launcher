'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const zipwrite = require('./zipwrite');
const { ensureDir, exists } = require('./util');

function savesDir(instanceId) {
  return path.join(paths.instanceGameDir(instanceId), 'saves');
}

function readLevelName(folder) {
  try {
    const data = fs.readFileSync(path.join(folder, 'level.dat'), 'utf8');
    const match = data.match(/LevelName\s*[\x00-\x20]*([\x20-\x7e\u0400-\u04ff]+)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
  }
}

function folderSize(folder) {
  let total = 0;
  const stack = [folder];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* пропускаем недоступный файл */
        }
      }
    }
  }
  return total;
}

function list(instanceId) {
  const dir = savesDir(instanceId);
  if (!exists(dir)) return [];
  const worlds = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(full, 'level.dat')).mtimeMs;
    } catch {
      try {
        mtime = fs.statSync(full).mtimeMs;
      } catch {
        /* ignore */
      }
    }
    worlds.push({
      folder: entry.name,
      title: readLevelName(full) || entry.name,
      size: folderSize(full),
      modified: mtime,
    });
  }
  return worlds.sort((a, b) => b.modified - a.modified);
}

async function backup(instanceId, folder) {
  const source = path.join(savesDir(instanceId), folder);
  if (!exists(source)) throw new Error('Мир не найден');
  const targetDir = path.join(paths.instanceGameDir(instanceId), 'backups');
  ensureDir(targetDir);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const target = path.join(targetDir, `${folder}-${stamp}.zip`);
  const files = zipwrite.collectFiles(source).map((entry) => ({ ...entry, name: `${folder}/${entry.name}` }));
  if (!files.length) throw new Error('В мире нет файлов для копии');
  zipwrite.create(target, files);
  return { file: target, files: files.length };
}

function remove(instanceId, folder) {
  const source = path.join(savesDir(instanceId), folder);
  if (!exists(source)) return false;
  const trash = path.join(paths.root(), 'trash', `world-${folder}-${Date.now()}`);
  ensureDir(path.dirname(trash));
  fs.renameSync(source, trash);
  return true;
}

function openFolder(instanceId, folder) {
  const target = folder ? path.join(savesDir(instanceId), folder) : savesDir(instanceId);
  ensureDir(target);
  return target;
}

module.exports = { list, backup, remove, openFolder, savesDir };
