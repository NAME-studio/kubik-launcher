'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const net = require('./net');
const { ensureDir } = require('./util');

const CYRILLIC = /[а-яё]/i;
const MAX_ENTRIES = 3000;
const CHUNK = 450;
const MAX_TOTAL = 8000;
const BROKEN = /QUERY LENGTH LIMIT|MAX ALLOWED QUERY|MYMEMORY WARNING|INVALID SOURCE LANGUAGE|PLEASE SELECT TWO DISTINCT/i;

function splitText(text, limit) {
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf('. ', limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf(' ', limit);
    if (cut <= 0) cut = limit;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) chunks.push(rest.trim());
  return chunks.filter(Boolean);
}

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
  const status = data && Number(data.responseStatus);
  const value = data && data.responseData && data.responseData.translatedText;
  if (status && status !== 200) throw new Error('MyMemory: ' + status);
  if (!value || typeof value !== 'string') throw new Error('Переводчик не ответил');
  if (BROKEN.test(value)) throw new Error('MyMemory: лимит запроса');
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

  if (to === 'en' && !CYRILLIC.test(source) && /[a-z]/i.test(source)) {
    return { text: source, cached: false, skipped: true };
  }

  const key = crypto.createHash('sha1').update(`${to}:${source}`).digest('hex');
  const store = loadCache();
  if (store[key]) return { text: store[key], cached: true };

  const clipped = source.length > MAX_TOTAL ? source.slice(0, MAX_TOTAL) : source;
  const chunks = clipped.length > CHUNK ? splitText(clipped, CHUNK) : [clipped];

  const parts = [];
  for (const chunk of chunks) {
    const result = await viaAny(chunk, from, to);
    parts.push(result.value);
  }

  let value = parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  if (source.length > MAX_TOTAL) value += '\n\n… (описание обрезано)';
  if (!value) throw new Error('Пустой перевод');

  store[key] = value;
  scheduleSave();
  return { text: value, cached: false, provider: 'chunked' };
}

function stats() {
  const data = loadCache();
  return { entries: Object.keys(data).length };
}

module.exports = { translate, stats };
