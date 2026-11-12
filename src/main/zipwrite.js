'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ensureDir } = require('./util');

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

let crcTable = null;

function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

const COMPRESSED_EXT = /\.(jar|zip|png|jpe?g|gif|webp|ogg|mp3|wav|pack|lzma|gz)$/i;

function shouldCompress(name, size) {
  if (size === 0 || size > 24 * 1024 * 1024) return false;
  return !COMPRESSED_EXT.test(name);
}

function collectFiles(root, options = {}) {
  const skip = new Set(options.skip || []);
  const result = [];
  const walk = (dir, prefix) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, name);
        continue;
      }
      if (!entry.isFile()) continue;
      let stat = null;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      result.push({ name, path: full, size: stat.size });
    }
  };
  walk(root, '');
  return result;
}

function create(zipPath, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = entry.data || fs.readFileSync(entry.path);
    const nameBuf = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data);
    const wantsDeflate = entry.compress === undefined ? shouldCompress(entry.name, data.length) : Boolean(entry.compress);
    let body = data;
    let method = 0;
    if (wantsDeflate) {
      const compressed = zlib.deflateRawSync(data, { level: 6 });
      if (compressed.length < data.length) {
        body = compressed;
        method = 8;
      }
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, body);

    const cent = Buffer.alloc(46);
    cent.writeUInt32LE(CENTRAL_SIG, 0);
    cent.writeUInt16LE(20, 4);
    cent.writeUInt16LE(20, 6);
    cent.writeUInt16LE(0x0800, 8);
    cent.writeUInt16LE(method, 10);
    cent.writeUInt16LE(0, 12);
    cent.writeUInt16LE(0x21, 14);
    cent.writeUInt32LE(crc, 16);
    cent.writeUInt32LE(body.length, 20);
    cent.writeUInt32LE(data.length, 24);
    cent.writeUInt16LE(nameBuf.length, 28);
    cent.writeUInt16LE(0, 30);
    cent.writeUInt16LE(0, 32);
    cent.writeUInt16LE(0, 34);
    cent.writeUInt16LE(0, 36);
    cent.writeUInt32LE(0, 38);
    cent.writeUInt32LE(offset, 42);
    central.push(cent, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  ensureDir(path.dirname(zipPath));
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, centralBuf, eocd]));
  return { entries: entries.length, bytes: offset + centralBuf.length + 22 };
}

module.exports = { create, collectFiles, crc32 };
