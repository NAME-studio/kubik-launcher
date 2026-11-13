'use strict';

const https = require('node:https');

const IDENTITY_HOST = 'identitytoolkit.googleapis.com';
const TOKEN_HOST = 'securetoken.googleapis.com';

function settings() {
  return require('./store').getSettings();
}

function save(patch) {
  require('./store').saveSettings(patch);
}

function post(host, path, payload, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const body = contentType === 'application/json' ? JSON.stringify(payload) : payload;
    const req = https.request(
      {
        host,
        path,
        method: 'POST',
        family: 4,
        timeout: 15000,
        headers: { 'content-type': contentType, 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = data ? JSON.parse(data) : {};
          } catch {
            parsed = {};
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }
          const reason = (parsed.error && parsed.error.message) || `HTTP ${res.statusCode}`;
          const error = new Error(reason);
          error.status = res.statusCode;
          error.reason = reason;
          reject(error);
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Firebase не ответил за 15 секунд')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function friendly(error) {
  const reason = String((error && error.reason) || '');
  if (/CONFIGURATION_NOT_FOUND|ADMIN_ONLY_OPERATION|OPERATION_NOT_ALLOWED/.test(reason)) {
    const hint = new Error(
      'Анонимный вход в Firebase не включён. Откройте консоль Firebase → Authentication → Sign-in method → Anonymous → Enable, затем перезапустите лаунчер.',
    );
    hint.code = 'AUTH_DISABLED';
    return hint;
  }
  if (/API key not valid|API_KEY_INVALID/.test(reason)) {
    const badKey = new Error('Неверный Firebase API-ключ — проверьте ключ в настройках лаунчера.');
    badKey.code = 'BAD_KEY';
    return badKey;
  }
  if (/TOO_MANY_ATTEMPTS_TRY_LATER/.test(reason)) {
    const busy = new Error('Firebase временно ограничил вход. Попробуйте через минуту.');
    busy.code = 'AUTH_BUSY';
    return busy;
  }
  return error;
}

async function signIn(apiKey) {
  const data = await post(`${IDENTITY_HOST}`, `/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, { returnSecureToken: true });
  const expiresAt = Date.now() + (Number(data.expiresIn) || 3600) * 1000;
  save({
    firebaseUid: data.localId || '',
    firebaseIdToken: data.idToken || '',
    firebaseRefreshToken: data.refreshToken || '',
    firebaseTokenExp: expiresAt,
  });
  return { token: data.idToken, uid: data.localId, expiresAt };
}

async function refresh(apiKey, refreshToken) {
  const body = `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`;
  const data = await post(`${TOKEN_HOST}`, `/v1/token?key=${encodeURIComponent(apiKey)}`, body, 'application/x-www-form-urlencoded');
  const expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  save({
    firebaseUid: data.user_id || settings().firebaseUid || '',
    firebaseIdToken: data.id_token || '',
    firebaseRefreshToken: data.refresh_token || refreshToken,
    firebaseTokenExp: expiresAt,
  });
  return { token: data.id_token, uid: data.user_id, expiresAt };
}

let pending = null;

async function ensureSession({ force = false } = {}) {
  const current = settings();
  const apiKey = String(current.firebaseApiKey || '').trim();
  if (!apiKey) {
    const error = new Error('Не задан Firebase API-ключ — друзья и общие сборки недоступны.');
    error.code = 'NO_KEY';
    throw error;
  }
  const fresh = current.firebaseIdToken && Number(current.firebaseTokenExp || 0) - 60000 > Date.now();
  if (!force && fresh) return { token: current.firebaseIdToken, uid: current.firebaseUid };

  if (pending) return pending;
  pending = (async () => {
    try {
      if (current.firebaseRefreshToken) {
        try {
          return await refresh(apiKey, current.firebaseRefreshToken);
        } catch (error) {
          if (error.code === 'AUTH_DISABLED' || error.code === 'BAD_KEY') throw friendly(error);
          if (/INVALID_REFRESH_TOKEN|TOKEN_EXPIRED|USER_NOT_FOUND|INVALID_GRANT/i.test(String(error.reason || ''))) {
            return await signIn(apiKey);
          }
          throw friendly(error);
        }
      }
      return await signIn(apiKey);
    } catch (error) {
      throw friendly(error);
    } finally {
      pending = null;
    }
  })();
  return pending;
}

async function idToken({ force = false } = {}) {
  const session = await ensureSession({ force });
  return session.token || '';
}

function uid() {
  return String(settings().firebaseUid || '');
}

function reset() {
  save({ firebaseIdToken: '', firebaseRefreshToken: '', firebaseTokenExp: 0, firebaseUid: '' });
}

module.exports = { ensureSession, idToken, uid, reset, signIn, refresh };
