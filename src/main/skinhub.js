'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { app } = require('electron');

const MIRROR_HOST = 'api.mineskin.org';
const TEXTURE_TIMEOUT = 4000;
const LIST_TIMEOUT = 3000;
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_STALE = 7 * 24 * 60 * 60 * 1000;

const skinsAgent = new https.Agent({ keepAlive: true, maxSockets: 8, family: 4 });

function galleryDir() {
  const target = path.join(app.getPath('userData'), 'skins', 'gallery');
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function cacheFile() {
  const dir = path.join(app.getPath('userData'), 'cache');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'skins-catalog.json');
}

function request(url, headers = {}, timeout = TEXTURE_TIMEOUT, redirects = 2) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { family: 4, agent: skinsAgent, timeout, headers: { 'User-Agent': 'KubikLauncher/1.1.8 (skins)', ...headers } },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location && redirects > 0) {
          response.resume();
          const next = new URL(response.headers.location, url).toString();
          request(next, headers, timeout, redirects - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('таймаут'));
    });
    req.on('error', reject);
  });
}

function download(url, headers = {}, timeout = TEXTURE_TIMEOUT) {
  return request(url, headers, timeout);
}

async function downloadWithRetry(url, headers = {}, { timeout = LIST_TIMEOUT, attempts = 2 } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await request(url, headers, timeout);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError || new Error('нет ответа');
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
      const buffer = await downloadWithRetry(url, {}, { timeout: 8000, attempts: 2 });
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

function readDiskCache() {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeDiskCache(data) {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(data));
  } catch {
    /* кэш не критичен */
  }
}

function cachedResult(entry, stale) {
  return {
    page: entry.page,
    total: entry.total || 0,
    hasMore: Boolean(entry.hasMore),
    items: entry.items || [],
    cached: true,
    stale: Boolean(stale),
    at: entry.at || 0,
  };
}

async function fetchPage(pageNumber, pageSize) {
  const listUrl = `https://api.mineskin.org/get/list/${pageNumber}?size=${pageSize}`;
  const started = Date.now();
  const raw = await downloadWithRetry(listUrl, { Accept: 'application/json' }, { attempts: 3 });
  const listMs = Date.now() - started;
  let payload = null;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new Error('Каталог вернул неожиданный ответ');
  }

  const list = Array.isArray(payload.skins) ? payload.skins : [];
  const items = new Array(list.length).fill(null);
  const worker = async (entry, index) => {
    const url = String(entry.url || '').replace('http://', 'https://');
    if (!url) return;
    try {
      const buffer = await download(url, {}, TEXTURE_TIMEOUT);
      if (!looksLikeSkin(buffer)) return;
      items[index] = { id: entry.id, at: entry.time || 0, dataUrl: toDataUrl(buffer) };
    } catch {
      /* пропускаем медленные и битые текстуры */
    }
  };

  const concurrency = Math.max(1, Math.min(list.length, 8));
  let cursor = 0;
  const runners = new Array(Math.min(concurrency, list.length)).fill(0).map(async () => {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  const texturesMs = Date.now() - started - listMs;

  const index = payload.page && payload.page.index ? payload.page.index : pageNumber;
  const pages = payload.page && payload.page.amount ? payload.page.amount : 0;
  return {
    page: index,
    total: pages,
    hasMore: pages ? index < pages : items.filter(Boolean).length > 0,
    items: items.filter(Boolean),
    cached: false,
    stale: false,
    at: Date.now(),
    timing: { list: listMs, textures: texturesMs },
  };
}

async function browse({ page = 1, size = 30, refresh = false } = {}) {
  const pageNumber = Math.max(1, Math.min(500, Number(page) || 1));
  const pageSize = Math.max(6, Math.min(40, Number(size) || 30));
  const key = `${pageNumber}:${pageSize}`;

  if (!refresh && catalogCache.has(key)) return catalogCache.get(key);

  const disk = readDiskCache();
  const stored = disk[key];
  const fresh = stored && Date.now() - (stored.at || 0) < CACHE_TTL;
  if (!refresh && fresh) {
    const result = cachedResult(stored, false);
    catalogCache.set(key, result);
    return result;
  }

  try {
    const result = await fetchPage(pageNumber, pageSize);
    if (!result.items.length && stored && (stored.items || []).length) {
      const fallback = cachedResult(stored, true);
      catalogCache.set(key, fallback);
      return fallback;
    }
    catalogCache.set(key, result);
    const nextDisk = readDiskCache();
    nextDisk[key] = { page: result.page, total: result.total, hasMore: result.hasMore, items: result.items, at: result.at };
    writeDiskCache(nextDisk);
    return result;
  } catch (error) {
    if (process.env.KUBIK_SKINS_DEBUG) console.log('[skins] browse failed:', error && error.message, error && error.code);
    if (stored && Date.now() - (stored.at || 0) < CACHE_STALE) {
      const result = cachedResult(stored, true);
      catalogCache.set(key, result);
      return result;
    }
    throw new Error(
      error && /HTTP 429/.test(error.message)
        ? 'MineSkin ограничил частоту запросов — попробуйте через минуту'
        : `MineSkin не отвечает (${error && error.message ? error.message : 'нет ответа'})`,
    );
  }
}

module.exports = { fetchByNick, gallery, saveToGallery, removeFromGallery, browse, MIRROR_HOST };
