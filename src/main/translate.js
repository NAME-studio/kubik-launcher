'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const net = require('./net');
const { ensureDir } = require('./util');

const CYRILLIC = /[а-яё]/i;
const MAX_ENTRIES = 3000;

let cache = null;
let saveTimer = null;

function cacheFile() {
  return path.join(paths.cache(), 'translations.json');
}

function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (!cache || typeof cache !== 'object') cache = {};
  } catch {
    cache = {};
  }
  return cache;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const data = loadCache();
      const keys = Object.keys(data);
      if (keys.length > MAX_ENTRIES) {
        for (const key of keys.slice(0, keys.length - MAX_ENTRIES)) delete data[key];
      }
      ensureDir(paths.cache());
      fs.writeFileSync(cacheFile(), JSON.stringify(data), 'utf8');
    } catch {
      /* кэш не критичен */
    }
  }, 900);
}

async function viaGoogle(text, from, to) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const data = await net.fetchJson(url, { timeout: 12000 });
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error('Пустой ответ переводчика');
  const parts = data[0].map((chunk) => (chunk && chunk[0]) || '').filter(Boolean);
  const result = parts.join('').trim();
  if (!result) throw new Error('Пустой перевод');
  return result;
}

async function viaMyMemory(text, from, to) {
  const pair = `${from === 'auto' ? 'en' : from}|${to}`;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(pair)}`;
  const data = await net.fetchJson(url, { timeout: 12000 });
  const value = data && data.responseData && data.responseData.translatedText;
  if (!value || typeof value !== 'string') throw new Error('Переводчик не ответил');
  return value.trim();
}

async function viaAny(text, from, to) {
  const attempts = [viaGoogle(text, from, to), viaMyMemory(text, from, to)];
  const wrapped = attempts.map((promise, index) =>
    promise.then((value) => ({ value, provider: index === 0 ? 'google' : 'mymemory' })),
  );
  try {
    return await Promise.any(wrapped);
  } catch {
    throw new Error('Сервисы перевода недоступны');
  }
}

async function translate(text, options = {}) {
  const source = String(text || '').replace(/\r/g, '').trim();
  if (!source) return { text: '', cached: false, skipped: true };

  const to = options.to || 'ru';
  const from = options.from || 'auto';

  if (to === 'ru' && CYRILLIC.test(source)) {
    return { text: source, cached: false, skipped: true };
  }

  const key = crypto.createHash('sha1').update(`${to}:${source}`).digest('hex');
  const store = loadCache();
  if (store[key]) return { text: store[key], cached: true };

  const result = await viaAny(source, from, to);

  store[key] = result.value;
  scheduleSave();
  return { text: result.value, cached: false, provider: result.provider };
}

function stats() {
  const data = loadCache();
  return { entries: Object.keys(data).length };
}

module.exports = { translate, stats };
