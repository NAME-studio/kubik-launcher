'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

function galleryDir() {
  const target = path.join(app.getPath('userData'), 'skins', 'gallery');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function download(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { family: 4, timeout: 45000, headers: { 'User-Agent': 'KubikLauncher/1.1.3 (skins)', ...extraHeaders } },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('таймаут загрузки'));
    });
    req.on('error', reject);
  });
}

function looksLikeSkin(buffer) {
  if (!buffer || buffer.length < 128) return false;
  if (buffer.slice(1, 4).toString('ascii') !== 'PNG') return false;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width === 64 && (height === 64 || height === 32);
}

function toDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/);
  if (!match) throw new Error('Ожидается PNG');
  return Buffer.from(match[1], 'base64');
}

function safeName(value) {
  return String(value || 'skin').replace(/[^\w.-]+/g, '_').slice(0, 48) || 'skin';
}

function filePath(name) {
  const file = path.join(galleryDir(), `${safeName(name)}.png`);
  if (path.dirname(file) !== galleryDir()) throw new Error('Недопустимое имя файла');
  return file;
}

async function fetchByNick(rawNick) {
  const nick = String(rawNick || '').trim().replace(/[^\w-]/g, '');
  if (nick.length < 2) throw new Error('Введите ник игрока');
  const sources = [
    `https://mc-heads.net/skin/${nick}`,
    `https://minotar.net/skin/${nick}`,
  ];
  let lastError = null;
  for (const url of sources) {
    try {
      const buffer = await download(url);
      if (!looksLikeSkin(buffer)) throw new Error('ответ не похож на скин 64×64');
      return { nick, dataUrl: toDataUrl(buffer) };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Не удалось получить скин: ${lastError ? lastError.message : 'нет ответа'}`);
}

function gallery() {
  const dir = galleryDir();
  const files = fs.readdirSync(dir).filter((file) => file.toLowerCase().endsWith('.png'));
  return files
    .map((file) => {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      return {
        name: file.replace(/\.png$/i, ''),
        at: stat.mtimeMs,
        dataUrl: toDataUrl(fs.readFileSync(full)),
      };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);
}

function saveToGallery({ dataUrl, name }) {
  const buffer = decodeDataUrl(dataUrl);
  if (!looksLikeSkin(buffer)) throw new Error('Это не скин 64×64');
  const clean = safeName(name);
  fs.writeFileSync(filePath(clean), buffer);
  return { name: clean, dataUrl: toDataUrl(buffer) };
}

function removeFromGallery({ name }) {
  const file = filePath(name);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return { name: safeName(name), removed: !fs.existsSync(file) };
}

const catalogCache = new Map();

async function browse({ page = 1, size = 30 } = {}) {
  const pageNumber = Math.max(1, Math.min(500, Number(page) || 1));
  const pageSize = Math.max(6, Math.min(40, Number(size) || 30));
  const key = `${pageNumber}:${pageSize}`;
  if (catalogCache.has(key)) return catalogCache.get(key);

  const listUrl = `https://api.mineskin.org/get/list/${pageNumber}?size=${pageSize}`;
  let raw = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      raw = await download(listUrl, { Accept: 'application/json' });
      break;
    } catch (error) {
      if (attempt === 2) throw new Error(`Каталог недоступен: ${error.message}`);
    }
  }
  let payload = null;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('Каталог вернул неожиданный ответ');
  }

  const list = Array.isArray(payload.skins) ? payload.skins : [];
  const items = [];
  const worker = async (entry) => {
    const url = String(entry.url || '').replace('http://', 'https://');
    if (!url) return;
    try {
      const buffer = await download(url);
      if (!looksLikeSkin(buffer)) return;
      items.push({ id: entry.id, at: entry.time || 0, dataUrl: toDataUrl(buffer) });
    } catch {
      /* пропускаем битые текстуры */
    }
  };

  for (let index = 0; index < list.length; index += 5) {
    await Promise.all(list.slice(index, index + 5).map(worker));
  }

  const index = payload.page && payload.page.index ? payload.page.index : pageNumber;
  const pages = payload.page && payload.page.amount ? payload.page.amount : 0;
  const result = {
    page: index,
    total: 0,
    hasMore: pages ? index < pages : items.length > 0,
    items,
  };
  catalogCache.set(key, result);
  return result;
}

module.exports = { fetchByNick, gallery, saveToGallery, removeFromGallery, browse };
