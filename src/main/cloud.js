'use strict';

const https = require('https');
const store = require('./store');
const auth = require('./firebase-auth');

const HOST = 'firestore.googleapis.com';

let blockedUntil = 0;
let backoffMs = 0;

function nextBackoff() {
  backoffMs = backoffMs ? Math.min(backoffMs * 2, 15 * 60 * 1000) : 2 * 60 * 1000;
  blockedUntil = Date.now() + backoffMs;
  return backoffMs;
}

function resetBackoff() {
  blockedUntil = 0;
  backoffMs = 0;
  blockedReason = '';
}

function waitSeconds() {
  return Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000));
}

// Сколько ещё ждать; 0 — ограничений нет (waitSeconds всегда возвращает минимум 1).
function blockedSeconds() {
  return blockedUntil > Date.now() ? waitSeconds() : 0;
}

let blockedReason = '';

function isPtMidnight(ts) {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
  return text === '00:00';
}

function quotaResetAt() {
  const step = 15 * 60 * 1000;
  const start = Math.ceil((Date.now() + 60 * 1000) / step) * step;
  for (let ts = start; ts < start + 2 * 24 * 60 * 60 * 1000; ts += step) {
    if (isPtMidnight(ts)) return ts;
  }
  return start + 24 * 60 * 60 * 1000;
}

function formatMsk(ts) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

function quotaMessage() {
  return `Дневная квота Firestore исчерпана (бесплатный тариф). Обнулится ${formatMsk(blockedUntil)} по МСК — до этого друзья и общие сборки недоступны.`;
}

function config() {
  const settings = store.getSettings();
  return {
    apiKey: String(settings.firebaseApiKey || '').trim(),
    projectId: String(settings.firebaseProjectId || '').trim(),
  };
}

function ready() {
  const { apiKey, projectId } = config();
  return Boolean(apiKey && projectId);
}

function base() {
  const { projectId } = config();
  return `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

function request(path, { method = 'GET', body, retriedAuth = false } = {}) {
  if (Date.now() < blockedUntil) {
    const error = new Error(blockedReason === 'quota' ? quotaMessage() : `Firestore ограничил запросы (429). Повтор через ${waitSeconds()} с.`);
    error.status = 429;
    error.retryIn = waitSeconds();
    return Promise.reject(error);
  }
  const send = (forceToken = false) => rawRequest(path, { method, body, forceToken });
  return send().catch((error) => {
    if (error.status === 401 && !retriedAuth) return request(path, { method, body, retriedAuth: true });
    if (/ETIMEDOUT|EAI_AGAIN|ECONNRESET|timeout/i.test(String(error.message))) return send(retriedAuth);
    throw error;
  });
}

async function rawRequest(path, { method = 'GET', body, forceToken = false } = {}) {
  const { apiKey } = config();
  const token = await auth.idToken({ force: forceToken }).catch(() => '');
  const payload = body ? JSON.stringify(body) : '';
  const url = `${base()}${path.startsWith(':') ? path : `/${path}`}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(apiKey)}`;
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        path: url,
        method,
        family: 4,
        headers,
        timeout: 20000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = { raw: data };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resetBackoff();
            if (process.env.KUBIK_CLOUD_DEBUG) console.log('[cloud]', method, url, res.statusCode);
            resolve(parsed);
            return;
          }
          if (process.env.KUBIK_CLOUD_DEBUG) console.log('[cloud]', method, url, res.statusCode, String(data).slice(0, 300), payload.slice(0, 160));
          const message = (parsed && parsed.error && parsed.error.message) || `Ошибка Firestore ${res.statusCode}`;
          if (res.statusCode === 429 || res.statusCode === 503) {
            const quota = /quota exceeded/i.test(message);
            let wait = 0;
            if (quota) {
              blockedUntil = quotaResetAt();
              backoffMs = blockedUntil - Date.now();
              blockedReason = 'quota';
              wait = backoffMs;
            } else {
              wait = nextBackoff();
            }
            const error = new Error(quota ? quotaMessage() : `Firestore ограничил запросы (429). Повтор через ${Math.ceil(wait / 1000)} с.`);
            error.status = res.statusCode;
            error.retryIn = Math.ceil(wait / 1000);
            reject(error);
            return;
          }
          if (/has not been used|is disabled|PERMISSION_DENIED/i.test(message)) {
            const error = new Error(
              'Firestore не включён или правила закрыты. Включите Firestore Database в проекте kubik-launcher (Build → Firestore Database → Create database) и выберите тестовые правила.',
            );
            error.status = res.statusCode;
            reject(error);
            return;
          }
          if (res.statusCode === 404) {
            const error = new Error('База Firestore не создана: Build → Firestore Database → Create database');
            error.status = res.statusCode;
            reject(error);
            return;
          }
          const error = new Error(message);
          error.status = res.statusCode;
          reject(error);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Firestore не ответил за 20 секунд')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function encode(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) fields[key] = encode(item);
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return Date.parse(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) out[key] = decodeValue(value);
  return out;
}

function docToObject(doc) {
  if (!doc || !doc.name) return null;
  const id = doc.name.split('/').pop();
  return { id, ...decodeFields(doc.fields) };
}

async function getDoc(collection, id) {
  try {
    const doc = await request(`${collection}/${encodeURIComponent(id)}`);
    return docToObject(doc);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

async function batchGet(collection, ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return {};
  const { projectId } = config();
  const documents = list.map(
    (id) => `projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`,
  );
  const result = await request(':batchGet', { method: 'POST', body: { documents } });
  const rows = Array.isArray(result) ? result : [];
  const map = {};
  for (const row of rows) {
    if (row && row.found) {
      const doc = docToObject(row.found);
      if (doc) map[doc.id] = doc;
    }
  }
  return map;
}

async function setDoc(collection, id, data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = encode(value);
  const doc = await request(`${collection}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { fields },
  });
  return docToObject(doc);
}

async function patchDoc(collection, id, data) {
  const fields = {};
  const mask = [];
  for (const [key, value] of Object.entries(data)) {
    fields[key] = encode(value);
    mask.push(`updateMask.fieldPaths=${encodeURIComponent(key)}`);
  }
  const doc = await request(`${collection}/${encodeURIComponent(id)}?${mask.join('&')}`, {
    method: 'PATCH',
    body: { fields },
  });
  return docToObject(doc);
}

async function createDoc(collection, data) {
  const fields = {};
  for (const [key, value] of Object.entries(data)) fields[key] = encode(value);
  const doc = await request(collection, { method: 'POST', body: { fields } });
  return docToObject(doc);
}

function filterValue(value) {
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  return encode(value);
}

async function query(collection, { where = [], orderBy = [], limit = 100, from } = {}) {
  const structuredQuery = {
    from: [{ collectionId: from || collection }],
    limit,
  };
  if (where.length) {
    structuredQuery.where = {
      compositeFilter: {
        op: 'AND',
        filters: where.map((item) => ({
          fieldFilter: {
            field: { fieldPath: item.field },
            op: item.op || 'EQUAL',
            value: filterValue(item.value),
          },
        })),
      },
    };
  }
  if (orderBy.length) {
    structuredQuery.orderBy = orderBy.map((item) => ({
      field: { fieldPath: item.field },
      direction: item.direction || 'ASCENDING',
    }));
  }
  const result = await request(':runQuery', { method: 'POST', body: { structuredQuery } });
  const rows = Array.isArray(result) ? result : [result];
  return rows
    .filter((row) => row && row.document)
    .map((row) => docToObject(row.document));
}

async function removeDoc(collection, id) {
  try {
    await request(`${collection}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

module.exports = { ready, config, getDoc, batchGet, setDoc, patchDoc, createDoc, query, removeDoc, blockedSeconds };
