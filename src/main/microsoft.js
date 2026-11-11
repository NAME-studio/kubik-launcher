'use strict';

const net = require('./net');
const store = require('./store');
const { uuidDashed, sleep } = require('./util');

const LOGIN_HOST = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';
const XBL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';

const pending = new Map();

function clientId() {
  return String(store.getSettings().microsoftClientId || '').trim();
}

function requireClientId() {
  const id = clientId();
  if (!id) {
    throw new Error(
      'Для входа через Microsoft нужен Client ID приложения Azure. Укажите его в настройках аккаунта — инструкция рядом.',
    );
  }
  return id;
}

function form(data) {
  return new URLSearchParams(data).toString();
}

async function startDeviceCode() {
  const id = requireClientId();
  const data = await net.fetchJson(`${LOGIN_HOST}/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: id, scope: SCOPE }),
    timeout: 30000,
  });
  const session = {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    interval: Math.max(3, Number(data.interval) || 5),
    expiresAt: Date.now() + (Number(data.expires_in) || 900) * 1000,
    clientId: id,
  };
  pending.set(session.deviceCode, session);
  return {
    deviceCode: session.deviceCode,
    userCode: session.userCode,
    verificationUri: session.verificationUri,
    interval: session.interval,
    expiresIn: Math.round((session.expiresAt - Date.now()) / 1000),
  };
}

async function pollOnce(deviceCode) {
  const session = pending.get(deviceCode);
  if (!session) throw new Error('Код устарел — начните вход заново');
  if (Date.now() > session.expiresAt) {
    pending.delete(deviceCode);
    return { state: 'expired', error: 'Код истёк, начните вход заново' };
  }
  let data;
  try {
    data = await net.fetchJson(`${LOGIN_HOST}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: session.clientId,
        device_code: deviceCode,
      }),
      timeout: 30000,
    });
  } catch (error) {
    const text = String(error.message || '');
    if (/authorization_pending|slow_down/i.test(text)) {
      return { state: 'pending' };
    }
    if (/authorization_declined|expired_token|bad_verification_code/i.test(text)) {
      pending.delete(deviceCode);
      return { state: 'failed', error: 'Вход отменён или код истёк' };
    }
    throw error;
  }
  pending.delete(deviceCode);
  const account = await exchangeMsa(data);
  store.saveAccount(account);
  store.saveSettings({ firstRun: false });
  return { state: 'ok', account };
}

async function exchangeMsa(tokens) {
  const xbl = await net.fetchJson(XBL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${tokens.access_token}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
    timeout: 30000,
  });

  let xsts;
  try {
    xsts = await net.fetchJson(XSTS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT',
      }),
      timeout: 30000,
    });
  } catch (error) {
    const text = String(error.message || '');
    if (/2148916233/.test(text)) throw new Error('У этого аккаунта Microsoft нет профиля Xbox — создайте его на xbox.com');
    if (/2148916238/.test(text)) throw new Error('Аккаунт несовершеннолетний и не добавлен в семейную группу Microsoft');
    throw new Error(`Xbox Live отклонил вход: ${text}`);
  }

  const uhs = xsts.DisplayClaims && xsts.DisplayClaims.xui && xsts.DisplayClaims.xui[0]
    ? xsts.DisplayClaims.xui[0].uhs
    : null;
  if (!uhs) throw new Error('Не удалось получить UHS из ответа Xbox Live');

  const mc = await net.fetchJson(MC_LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }),
    timeout: 30000,
  });

  let profile;
  try {
    profile = await net.fetchJson(MC_PROFILE, {
      headers: { Authorization: `Bearer ${mc.access_token}`, Accept: 'application/json' },
      timeout: 30000,
    });
  } catch (error) {
    throw new Error('У аккаунта Microsoft нет купленной Minecraft: Java Edition');
  }
  if (!profile || !profile.id) throw new Error('У аккаунта Microsoft нет профиля Minecraft');

  const skin = profile.skins && profile.skins[0] ? profile.skins[0] : null;
  return {
    id: profile.id,
    type: 'microsoft',
    username: profile.name,
    uuid: uuidDashed(profile.id),
    accessToken: mc.access_token,
    refreshToken: tokens.refresh_token || '',
    xuid: profile.id,
    clientId: clientId(),
    skinUrl: skin ? skin.url : null,
    skinModel: 'classic',
    addedAt: Date.now(),
  };
}

async function refresh(account) {
  if (!account || account.type !== 'microsoft' || !account.refreshToken) return account;
  try {
    const data = await net.fetchJson(`${LOGIN_HOST}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({
        grant_type: 'refresh_token',
        client_id: account.clientId || requireClientId(),
        refresh_token: account.refreshToken,
        scope: SCOPE,
      }),
      timeout: 30000,
    });
    const fresh = await exchangeMsa(data);
    const updated = { ...account, ...fresh, id: account.id, addedAt: account.addedAt, skinModel: account.skinModel };
    store.saveAccount(updated);
    return updated;
  } catch {
    return account;
  }
}

async function pollUntilDone(deviceCode, timeoutMs = 900000) {
  const session = pending.get(deviceCode);
  const interval = (session && session.interval ? session.interval : 5) * 1000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await pollOnce(deviceCode);
    if (result.state !== 'pending') return result;
    await sleep(interval);
  }
  return { state: 'expired', error: 'Время ожидания входа истекло' };
}

module.exports = {
  startDeviceCode,
  pollOnce,
  pollUntilDone,
  refresh,
  clientId,
};
