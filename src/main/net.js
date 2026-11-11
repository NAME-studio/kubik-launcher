'use strict';

const fs = require('fs');
const path = require('path');
const dns = require('dns');
const https = require('https');
const http = require('http');
const { once } = require('events');
const { ensureDir, exists, sizeOf, sha1File, sleep } = require('./util');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch {
  /* старые версии Node */
}

function nodeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'http:' ? http : https;
    const request = lib.request(
      {
        hostname: target.hostname,
        port: target.port || (target.protocol === 'http:' ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        method: options.method || 'GET',
        headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
        family: 4,
        timeout: options.timeout || 30000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on('timeout', () => request.destroy(new Error('Превышено время ожидания')));
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

const USER_AGENT = 'KubikLauncher/1.0.0 (Minecraft launcher; +https://github.com/kubik-launcher)';
const DEFAULT_HEADERS = { 'User-Agent': USER_AGENT };

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      body: options.body,
      signal: controller.signal,
      redirect: 'follow',
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  let response;
  let text = null;
  try {
    response = await request(url, options);
    text = await response.text();
  } catch (error) {
    const fallback = await nodeRequest(url, options);
    response = { ok: fallback.status >= 200 && fallback.status < 300, status: fallback.status };
    text = fallback.body.toString('utf8');
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data && (data.errorMessage || data.error_description || data.error || data.message)) || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = data;
    error.url = url;
    throw error;
  }
  return data;
}

async function fetchText(url, options = {}) {
  try {
    const response = await request(url, options);
    const text = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status} для ${url}`);
    return text;
  } catch (error) {
    const fallback = await nodeRequest(url, options);
    if (fallback.status < 200 || fallback.status >= 300) throw new Error(`HTTP ${fallback.status} для ${url}`);
    return fallback.body.toString('utf8');
  }
}

async function downloadFile(url, dest, options = {}) {
  const { sha1, size, onBytes, retries = 3, headers, timeout = 60000 } = options;
  ensureDir(path.dirname(dest));

  if (exists(dest)) {
    const same = size == null || sizeOf(dest) === size;
    if (same && (!sha1 || sha1File(dest) === sha1)) return { skipped: true, bytes: sizeOf(dest) };
    if (same && !sha1) return { skipped: true, bytes: sizeOf(dest) };
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...(headers || {}) },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} для ${url}`);
      const total = Number(response.headers.get('content-length')) || 0;
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      let received = 0;
      for await (const chunk of response.body) {
        received += chunk.length;
        if (!out.write(chunk)) await once(out, 'drain');
        if (onBytes) onBytes(chunk.length, { received, total });
      }
      await new Promise((resolve, reject) => {
        out.end(() => resolve());
        out.on('error', reject);
      });
      if (sha1) {
        const actual = sha1File(tmp);
        if (actual !== sha1) throw new Error(`Несовпадение SHA1: ${path.basename(dest)}`);
      }
      if (size != null && sizeOf(tmp) !== size) throw new Error(`Неверный размер файла: ${path.basename(dest)}`);
      fs.renameSync(tmp, dest);
      return { skipped: false, bytes: received };
    } catch (error) {
      lastError = error;
      try {
        fs.rmSync(`${dest}.part`, { force: true });
      } catch {
        /* ignore */
      }
      if (attempt < retries) await sleep(500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Не удалось скачать ${url}`);
}

async function pool(items, concurrency, worker, onProgress) {
  const total = items.length;
  let index = 0;
  let done = 0;
  let failed = 0;
  const errors = [];
  const workers = new Array(Math.max(1, Math.min(concurrency, total))).fill(0).map(async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      try {
        await worker(items[current], current);
      } catch (error) {
        failed += 1;
        errors.push(error);
        if (errors.length > 40) throw error;
      }
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  });
  await Promise.all(workers);
  if (failed > 0 && failed === total) throw errors[0];
  return { done, failed, errors };
}

module.exports = { USER_AGENT, request, fetchJson, fetchText, downloadFile, pool };
