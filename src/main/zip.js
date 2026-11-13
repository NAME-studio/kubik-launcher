'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ensureDir } = require('./util');

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function findEocd(buf) {
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Файл не является ZIP-архивом');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL_SIG) break;
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const uncompressedSize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString(flags & 0x0800 ? 'utf8' : 'utf8', offset + 46, offset + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(buf, entry) {
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== LOCAL_SIG) throw new Error(`Повреждённая запись ZIP: ${entry.name}`);
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`Неподдерживаемый метод сжатия ${entry.method} в ${entry.name}`);
}

function list(zipPath) {
  const buf = fs.readFileSync(zipPath);
  return readEntries(buf).map((e) => ({
    name: e.name,
    size: e.uncompressedSize,
    dir: e.name.endsWith('/'),
  }));
}

function readFile(zipPath, entryName, buf) {
  const source = buf || fs.readFileSync(zipPath);
  const entries = readEntries(source);
  const entry = entries.find((e) => e.name === entryName);
  if (!entry) return null;
  return readEntry(source, entry);
}

// Путь из архива не должен выходить за пределы папки назначения
// (защита от ../, абсолютных путей и дисков вида C:).
function safeJoin(baseDir, relative) {
  const rel = String(relative || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) return null;
  if (rel.includes('..') || /^[a-zA-Z]:/.test(rel)) return null;
  const root = path.resolve(baseDir);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function extract(zipPath, destDir, options = {}) {
  const buf = fs.readFileSync(zipPath);
  const entries = readEntries(buf);
  const prefix = options.prefix ? options.prefix.replace(/^\/+/, '') : null;
  const strip = options.stripPrefix || 0;
  let files = 0;
  let bytes = 0;

  for (const entry of entries) {
    let target = entry.name;
    if (target.startsWith('__MACOSX/')) continue;
    if (prefix) {
      if (!target.startsWith(prefix)) continue;
      target = target.slice(prefix.length);
    }
    if (strip) {
      target = target.split('/').slice(strip).join('/');
    }
    if (!target || target.endsWith('/')) {
      const dir = target ? safeJoin(destDir, target) : null;
      if (dir) ensureDir(dir);
      continue;
    }
    if (options.filter && !options.filter(target)) continue;
    const full = safeJoin(destDir, target);
    if (!full) continue;
    ensureDir(path.dirname(full));
    const data = readEntry(buf, entry);
    fs.writeFileSync(full, data);
    files += 1;
    bytes += data.length;
  }
  return { files, bytes };
}

function readJson(zipPath, entryName) {
  const data = readFile(zipPath, entryName);
  if (!data) return null;
  return JSON.parse(data.toString('utf8'));
}

module.exports = { list, readFile, readJson, extract, safeJoin };
