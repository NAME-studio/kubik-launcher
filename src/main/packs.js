'use strict';

const path = require('path');
const paths = require('./paths');
const options = require('./options');
const { exists } = require('./util');
const fs = require('fs');

function parse(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return text
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((item) => item.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  }
}

function nameOf(filename) {
  return `file/${String(filename || '').replace(/\\/g, '/')}`;
}

function list(instanceId) {
  return parse(options.read(instanceId).resourcePacks);
}

function save(instanceId, packs) {
  options.write(instanceId, { resourcePacks: JSON.stringify(packs) });
  return packs;
}

function toggle(instanceId, filename) {
  const name = nameOf(filename);
  const current = list(instanceId);
  const base = String(filename || '');
  const dir = path.join(paths.instanceGameDir(instanceId), 'resourcepacks');
  const disabledFile = path.join(dir, `${base}.disabled`);
  const activeFile = path.join(dir, base);

  if (exists(disabledFile) && !exists(activeFile)) fs.renameSync(disabledFile, activeFile);

  const index = current.indexOf(name);
  if (index >= 0) {
    current.splice(index, 1);
    return { active: false, list: save(instanceId, current) };
  }
  current.push(name);
  return { active: true, list: save(instanceId, current) };
}

// В options.txt порядок обратный списку в игре: последний элемент — самый приоритетный.
function move(instanceId, filename, direction) {
  const name = nameOf(filename);
  const current = list(instanceId);
  const index = current.indexOf(name);
  if (index < 0) return { list: current };
  const target = direction === 'up' ? index + 1 : index - 1;
  if (target < 0 || target >= current.length) return { list: current };
  const [item] = current.splice(index, 1);
  current.splice(target, 0, item);
  return { list: save(instanceId, current) };
}

// Порядок сверху вниз — как он выглядит в игре.
function ordered(instanceId) {
  return list(instanceId).slice().reverse();
}

module.exports = { list, ordered, toggle, move };
