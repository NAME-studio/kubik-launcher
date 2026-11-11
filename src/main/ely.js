'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const net = require('./net');
const store = require('./store');
const { ensureDir, exists, uuidDashed, randomId } = require('./util');

const AUTH_SERVER = 'https://authserver.ely.by';
const SKIN_SYSTEM = 'https://skinsystem.ely.by';
const AUTH_INJECTOR_LATEST = 'https://authlib-injector.yushi.moe/artifact/latest.json';
const AUTH_INJECTOR_API_ROOT = 'https://account.ely.by/api/authlib-injector';

let injectorCache = null;

function textProperty(properties, name) {
  const item = (properties || []).find((p) => p.name === name);
  return item ? item.value : null;
}

async function authenticate(username, password, twoFactor) {
  const settings = store.getSettings();
  const clientToken = randomId(16);
  const body = {
    username,
    password,
    clientToken,
    agent: { name: 'Minecraft', version: 1 },
    requestUser: true,
  };
  if (twoFactor) body.password = `${password}:${twoFactor}`;

  try {
    const data = await net.fetchJson(`${AUTH_SERVER}/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeout: 30000,
    });
    const profile = data.selectedProfile || (data.availableProfiles && data.availableProfiles[0]);
    if (!profile) throw new Error('У аккаунта нет игрового профиля Minecraft');
    const account = {
      id: profile.id,
      type: 'ely',
      username: profile.name,
      uuid: uuidDashed(profile.id),
      accessToken: data.accessToken,
      clientToken: data.clientToken || clientToken,
      addedAt: Date.now(),
      skinModel: 'classic',
    };
    store.saveAccount(account);
    store.saveSettings({ firstRun: false });
    return { account, properties: (data.user && data.user.properties) || [] };
  } catch (error) {
    if (error.status === 401) {
      const message = String(error.message || '');
      if (/two factor|2fa/i.test(message)) {
        return { need2fa: true, error: 'Для аккаунта включена двухфакторная защита. Введите код из приложения.' };
      }
      if (/invalid credentials/i.test(message)) {
        return { error: 'Неверный логин или пароль Ely.by' };
      }
      return { error: message || 'Не удалось войти' };
    }
    if (error.status === 403) return { error: 'Аккаунт заблокирован или требует подтверждения' };
    return { error: error.message || 'Ошибка авторизации Ely.by' };
  }
}

async function refresh(account) {
  if (!account || account.type !== 'ely' || !account.accessToken) return account;
  try {
    const data = await net.fetchJson(`${AUTH_SERVER}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: account.accessToken, clientToken: account.clientToken, requestUser: true }),
      timeout: 30000,
    });
    const profile = data.selectedProfile || {};
    const updated = {
      ...account,
      accessToken: data.accessToken,
      username: profile.name || account.username,
      uuid: profile.id ? uuidDashed(profile.id) : account.uuid,
    };
    store.saveAccount(updated);
    return updated;
  } catch {
    return account;
  }
}

async function validate(accessToken) {
  try {
    await net.fetchJson(`${AUTH_SERVER}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
      timeout: 20000,
    });
    return true;
  } catch {
    return false;
  }
}

function parseTextures(profile) {
  const raw = profile && textProperty(profile.properties, 'textures');
  if (!raw) return { skin: null, cape: null, model: 'classic', profile };
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const textures = decoded.textures || {};
    const skin = textures.SKIN || null;
    const cape = textures.CAPE || null;
    return {
      skin: skin ? skin.url : null,
      cape: cape ? cape.url : null,
      model: skin && skin.metadata && skin.metadata.model === 'slim' ? 'slim' : 'classic',
      uuid: decoded.profileId || null,
      name: decoded.profileName || null,
      raw: decoded,
    };
  } catch {
    return { skin: null, cape: null, model: 'classic' };
  }
}

async function resolveUuid(name) {
  const list = await net.fetchJson(`${AUTH_INJECTOR_API_ROOT}/api/profiles/minecraft`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([name]),
    timeout: 20000,
  });
  if (!Array.isArray(list) || !list.length) return null;
  const row = list.find((item) => String(item.name || '').toLowerCase() === name.toLowerCase()) || list[0];
  return row && row.id ? { id: row.id, name: row.name || name } : null;
}

async function skinProfile(nickname) {
  const name = String(nickname || '').trim();
  if (!name) throw new Error('Не указан ник');
  try {
    const found = await resolveUuid(name);
    if (!found) return { skin: null, cape: null, model: 'classic', name, empty: true };
    const profile = await net.fetchJson(
      `${AUTH_INJECTOR_API_ROOT}/sessionserver/session/minecraft/profile/${encodeURIComponent(found.id)}`,
      { timeout: 20000 },
    );
    const parsed = parseTextures(profile);
    return { ...parsed, name: (profile && profile.name) || found.name, id: found.id, empty: !parsed.skin };
  } catch (error) {
    if (error.status === 204) return { skin: null, cape: null, model: 'classic', name, empty: true };
    return { skin: null, cape: null, model: 'classic', name, error: error.message };
  }
}

async function downloadSkinTexture(nickname) {
  const name = String(nickname || '').trim();
  if (!name) return null;
  const urls = [
    `${SKIN_SYSTEM}/skins/${encodeURIComponent(name)}.png?version=2`,
    `${SKIN_SYSTEM}/skins/${encodeURIComponent(name)}.png`,
  ];
  for (const url of urls) {
    try {
      const response = await net.request(url, { timeout: 20000 });
      if (!response.ok) continue;
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length >= 64) return buffer;
    } catch {
      /* пробуем следующий адрес */
    }
  }
  return null;
}

async function skinDataUrl(nickname) {
  const buffer = await downloadSkinTexture(nickname);
  if (!buffer) return null;
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

async function urlDataUrl(url) {
  if (!url) return null;
  try {
    const response = await net.request(url);
    if (!response.ok) return null;
    return `data:image/png;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`;
  } catch {
    return null;
  }
}

function localSkinFile(account) {
  return path.join(paths.skins(), `${account.id}.png`);
}

async function accountSkin(account) {
  if (!account) return { dataUrl: null, model: 'classic' };
  if (account.type === 'local') {
    const file = localSkinFile(account);
    if (exists(file)) return { dataUrl: fileDataUrl(file), model: account.skinModel || 'classic' };
    return { dataUrl: null, model: account.skinModel || 'classic', fallback: true };
  }
  if (account.type === 'microsoft') {
    if (account.skinUrl) {
      const dataUrl = await urlDataUrl(account.skinUrl);
      if (dataUrl) return { dataUrl, model: account.skinModel || 'classic' };
    }
    return { dataUrl: null, model: account.skinModel || 'classic', fallback: true };
  }
  const profile = await skinProfile(account.username);
  let dataUrl = null;
  if (profile && profile.skin) dataUrl = await urlDataUrl(profile.skin);
  if (!dataUrl) dataUrl = await skinDataUrl(account.username);
  return { dataUrl, model: account.skinModel || (profile && profile.model) || 'classic', fallback: !dataUrl };
}

function fileDataUrl(file) {
  try {
    return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

function setLocalSkin(account, dataUrl, model) {
  if (!account) throw new Error('Сначала создайте аккаунт');
  const base64 = String(dataUrl || '').replace(/^data:image\/png;base64,/, '');
  if (!base64) throw new Error('Скин не выбран');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length < 64) throw new Error('Файл скина повреждён');
  ensureDir(paths.skins());
  const file = localSkinFile(account);
  fs.writeFileSync(file, buffer);
  const updated = { ...account, skinModel: model === 'slim' ? 'slim' : 'classic', skinFile: file };
  store.saveAccount(updated);
  return { dataUrl: `data:image/png;base64,${buffer.toString('base64')}`, model: updated.skinModel };
}

async function ensureAuthlibInjector() {
  if (injectorCache && exists(injectorCache)) return injectorCache;
  try {
    const latest = await net.fetchJson(AUTH_INJECTOR_LATEST, { timeout: 20000 });
    const dir = ensureDir(path.join(paths.authlib(), latest.version));
    const dest = path.join(dir, `authlib-injector-${latest.version}.jar`);
    const expectedSha256 = latest.checksums && latest.checksums.sha256;
    if (exists(dest) && expectedSha256) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
      if (actual === expectedSha256) {
        injectorCache = dest;
        return dest;
      }
    }
    await net.downloadFile(latest.download_url, dest, { retries: 2, timeout: 120000 });
    injectorCache = dest;
    fs.writeFileSync(path.join(paths.authlib(), 'api-root.txt'), AUTH_INJECTOR_API_ROOT, 'utf8');
    return dest;
  } catch {
    return null;
  }
}

function offlineAccount(username) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('Ник должен быть 3–16 символов: латиница, цифры и «_»');
  }
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  const account = {
    id: `local-${hex}`,
    type: 'local',
    username: name,
    uuid: uuidDashed(hex),
    accessToken: '0',
    clientToken: '',
    addedAt: Date.now(),
    skinModel: 'classic',
  };
  store.saveAccount(account);
  store.saveSettings({ firstRun: false });
  return account;
}

module.exports = {
  AUTH_SERVER,
  SKIN_SYSTEM,
  AUTH_INJECTOR_API_ROOT,
  authenticate,
  refresh,
  validate,
  skinProfile,
  downloadSkinTexture,
  skinDataUrl,
  accountSkin,
  setLocalSkin,
  localSkinFile,
  ensureAuthlibInjector,
  offlineAccount,
  parseTextures,
};
