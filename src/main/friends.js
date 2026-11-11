'use strict';

const store = require('./store');
const instances = require('./instances');
const modrinth = require('./modrinth');
const cloud = require('./cloud');

const ONLINE_MS = 90 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function settings() {
  return store.getSettings();
}

function myName() {
  const account = store.currentAccount();
  return String(settings().friendName || (account && account.username) || '').trim();
}

function myAbout() {
  return String(settings().friendAbout || '').trim().slice(0, 140);
}

function newId() {
  return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function myId() {
  const current = settings().friendId;
  if (current) return current;
  const id = newId();
  store.saveSettings({ friendId: id });
  return id;
}

function makeCode() {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

function myCode() {
  const current = settings().friendCode;
  if (current) return current;
  const code = makeCode();
  store.saveSettings({ friendCode: code });
  return code;
}

function friendList() {
  const list = settings().friends;
  return Array.isArray(list) ? list : [];
}

function saveFriendList(list) {
  store.saveSettings({ friends: list });
}

function pairId(a, b) {
  return [a, b].sort().join('__');
}

function configured() {
  return cloud.ready();
}

async function publish(doc = {}) {
  if (!configured()) return null;
  const patch = {
    name: myName() || myCode(),
    code: myCode(),
    about: myAbout(),
    updated: Date.now(),
  };
  if (doc.status !== undefined) patch.status = doc.status;
  return cloud.patchDoc('users', myId(), patch);
}

async function heartbeat(status) {
  if (!configured()) return null;
  return publish({ status: { ...(status || {}), at: Date.now() } });
}

function statusFromLaunch(payload) {
  if (!configured()) return;
  try {
    if (payload.state === 'running') {
      const instance = instances.readInstance(payload.instanceId);
      publish({
        status: {
          state: 'game',
          instanceId: payload.instanceId,
          instanceName: instance ? instance.name : '',
          at: Date.now(),
        },
      }).catch(() => {});
    } else if (payload.state === 'exited') {
      publish({ status: { state: 'launcher', at: Date.now() } }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

async function readMessages(peerId) {
  if (!configured() || !peerId) return [];
  const rows = await cloud.query('messages', {
    where: [{ field: 'pair', op: 'EQUAL', value: pairId(myId(), peerId) }],
    limit: 300,
  });
  return rows.sort((a, b) => (a.at || 0) - (b.at || 0));
}

async function send({ friendId, text, kind, payload }) {
  if (!friendId) throw new Error('Не выбран друг');
  if (!configured()) throw new Error('Друзья не настроены');
  const body = String(text || '').slice(0, 4000);
  if (!body && !kind) throw new Error('Пустое сообщение');
  const chatId = pairId(myId(), friendId);
  const doc = await cloud.createDoc('messages', {
    pair: chatId,
    from: myId(),
    to: friendId,
    at: Date.now(),
    text: body,
    kind: kind || 'text',
    payload: payload || null,
  });
  cloud
    .patchDoc('chats', chatId, {
      members: [myId(), friendId],
      lastFrom: myId(),
      lastText: body.slice(0, 140),
      lastKind: kind || 'text',
      lastAt: (doc && doc.at) || Date.now(),
    })
    .catch(() => {});
  return doc;
}

async function addFriend(rawCode) {
  if (!configured()) throw new Error('Firebase не настроен');
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) throw new Error('Код слишком короткий');
  if (code === myCode()) throw new Error('Это ваш собственный код');
  const rows = await cloud.query('users', {
    where: [{ field: 'code', op: 'EQUAL', value: code }],
    limit: 5,
  });
  const found = rows.find((row) => row.id !== myId());
  if (!found) throw new Error('Такой код не найден. Друг должен запустить лаунчер и открыть «Друзья»');

  const mine = (await cloud.getDoc('users', myId())) || {};
  const myFriends = new Set(Array.isArray(mine.friends) ? mine.friends : []);
  myFriends.add(found.id);
  await cloud.patchDoc('users', myId(), {
    name: myName() || myCode(),
    code: myCode(),
    friends: [...myFriends],
    updated: Date.now(),
  });

  const theirs = new Set(Array.isArray(found.friends) ? found.friends : []);
  if (!theirs.has(myId())) {
    theirs.add(myId());
    await cloud.patchDoc('users', found.id, { friends: [...theirs] });
  }

  const list = friendList().filter((friend) => friend.id !== found.id);
  list.push({ id: found.id, name: found.name || code });
  saveFriendList(list);
  return { id: found.id, name: found.name || code };
}

async function removeFriend(friendId) {
  if (!friendId) return false;
  saveFriendList(friendList().filter((friend) => friend.id !== friendId));
  if (configured()) {
    try {
      const mine = (await cloud.getDoc('users', myId())) || {};
      const myFriends = (Array.isArray(mine.friends) ? mine.friends : []).filter((id) => id !== friendId);
      await cloud.patchDoc('users', myId(), { friends: myFriends });
      const peer = await cloud.getDoc('users', friendId);
      if (peer && Array.isArray(peer.friends)) {
        await cloud.patchDoc('users', friendId, { friends: peer.friends.filter((id) => id !== myId()) });
      }
    } catch {
      /* локальный список уже обновлён */
    }
  }
  return true;
}

async function cloudFriendIds() {
  if (!configured()) return [];
  try {
    const mine = await cloud.getDoc('users', myId());
    return Array.isArray(mine && mine.friends) ? mine.friends.filter(Boolean) : [];
  } catch (error) {
    if (error.status === 429) throw error;
    return [];
  }
}

async function listPacks() {
  if (!configured()) return [];
  const rows = await cloud.query('packs', {
    where: [{ field: 'members', op: 'ARRAY_CONTAINS', value: myId() }],
    limit: 50,
  });
  return rows.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

async function readPack(packId) {
  const pack = await cloud.getDoc('packs', packId);
  if (!pack) throw new Error('Сборка не найдена в облаке');
  return pack;
}

function instanceModProjects(instanceId) {
  try {
    return (modrinth.installed(instanceId).items || [])
      .filter((item) => item.projectId)
      .map((item) => ({ projectId: item.projectId, title: item.title || '', projectType: item.projectType || 'mod' }));
  } catch {
    return [];
  }
}

async function sharePack({ instanceId, friendIds }) {
  const instance = instances.readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  if (!configured()) throw new Error('Друзья не настроены');
  const mods = instanceModProjects(instanceId);
  const pack = await cloud.createDoc('packs', {
    name: instance.name,
    mcVersion: instance.mcVersion,
    loader: JSON.stringify(instance.loader || { type: 'vanilla', version: null }),
    cover: instance.cover || 'autumn',
    creator: myId(),
    creatorName: myName() || myCode(),
    members: [myId(), ...(friendIds || []).filter(Boolean)],
    mods,
    updated: Date.now(),
  });
  try {
    instances.updateInstance(instanceId, { sharedPack: pack.id });
  } catch {
    /* ignore */
  }
  for (const friendId of friendIds || []) {
    await send({
      friendId,
      text: `Поделился сборкой «${pack.name}»`,
      kind: 'pack',
      payload: { packId: pack.id, name: pack.name, mcVersion: pack.mcVersion, mods: mods.length },
    });
  }
  return pack;
}

function parseLoader(loader) {
  if (!loader) return { type: 'vanilla', version: null };
  if (typeof loader === 'object') return loader;
  try {
    return JSON.parse(loader);
  } catch {
    return { type: 'vanilla', version: null };
  }
}

async function addPack({ packId }) {
  const pack = await readPack(packId);
  const instance = await instances.createInstance({
    name: pack.name,
    mcVersion: pack.mcVersion,
    loader: parseLoader(pack.loader),
    cover: pack.cover || 'autumn',
  });
  try {
    instances.updateInstance(instance.id, { sharedPack: pack.id });
  } catch {
    /* ignore */
  }
  const failures = [];
  for (const mod of pack.mods || []) {
    try {
      await modrinth.installContent(instance.id, mod.projectId, { autoDeps: true });
    } catch (error) {
      failures.push(`${mod.title || mod.projectId}: ${error.message}`);
    }
  }
  return { instance, failures };
}

async function syncPack({ packId }) {
  const pack = await readPack(packId);
  const instance = instances.listInstances().find((item) => item.sharedPack === packId);
  if (!instance) throw new Error('У вас нет сборки, связанной с этой общей');
  const local = instanceModProjects(instance.id);
  const localIds = new Set(local.map((mod) => mod.projectId));
  const packIds = new Set((pack.mods || []).map((mod) => mod.projectId));

  const missing = (pack.mods || []).filter((mod) => !localIds.has(mod.projectId));
  const additions = local.filter((mod) => !packIds.has(mod.projectId));

  const failures = [];
  for (const mod of missing) {
    try {
      await modrinth.installContent(instance.id, mod.projectId, { autoDeps: true });
    } catch (error) {
      failures.push(`${mod.title || mod.projectId}: ${error.message}`);
    }
  }

  if (additions.length) {
    await cloud.patchDoc('packs', pack.id, {
      mods: [...(pack.mods || []), ...additions],
      updated: Date.now(),
    });
  }

  return { instance, installed: missing.length - failures.length, uploaded: additions.length, failures };
}

async function state() {
  if (!configured()) {
    return {
      configured: false,
      cloud: false,
      me: { id: myId(), name: myName() || '', about: myAbout(), avatar: settings().friendAvatar || '', banner: settings().friendBanner || '', code: myCode() },
      friends: [],
      packs: [],
    };
  }
  if (stateCache.data && Date.now() - stateCache.at < 10000) return stateCache.data;
  const readMap = settings().friendsRead || {};
  try {
    const remoteIds = await cloudFriendIds();
    const known = new Map(friendList().map((friend) => [friend.id, friend]));
    let merged = false;
    for (const id of remoteIds) {
      if (!known.has(id)) {
        known.set(id, { id, name: '' });
        merged = true;
      }
    }
    const list = [...known.values()];
    if (merged) saveFriendList(list);

    const ids = list.map((friend) => friend.id).filter(Boolean);
    const docs = ids.length ? await cloud.batchGet('users', ids) : {};
    const chats = ids.length ? await cloud.batchGet('chats', ids.map((id) => pairId(myId(), id))).catch(() => ({})) : {};
    const friends = [];
    for (const friend of list) {
      const doc = docs[friend.id] || null;
      const chat = chats[pairId(myId(), friend.id)] || null;
      const lastRead = readMap[friend.id] || 0;
      const lastMessage = chat && chat.lastAt ? { from: chat.lastFrom, text: chat.lastText, kind: chat.lastKind, at: chat.lastAt } : null;
      friends.push({
        id: friend.id,
        name: (doc && doc.name) || friend.name,
        avatar: (doc && doc.avatar) || '',
        about: (doc && doc.about) || '',
        online: doc ? Date.now() - (doc.updated || 0) < ONLINE_MS : false,
        updated: doc ? doc.updated : 0,
        status: (doc && doc.status) || { state: 'offline' },
        unread: chat && chat.lastFrom === friend.id && (chat.lastAt || 0) > lastRead ? 1 : 0,
        lastMessage,
      });
    }
    friends.sort((a, b) => Number(b.online) - Number(a.online) || (b.updated || 0) - (a.updated || 0));

    let packs = [];
    try {
      packs = await listPacks();
    } catch {
      packs = [];
    }

    const data = {
      configured: true,
      cloud: true,
      me: { id: myId(), name: myName() || myCode(), about: myAbout(), avatar: settings().friendAvatar || '', banner: settings().friendBanner || '', code: myCode() },
      friends,
      packs,
    };
    const blocked = cloud.blockedSeconds ? cloud.blockedSeconds() : 0;
    if (blocked > 0) {
      data.warning = `Firestore ограничил запросы (429): сработал лимит бесплатного тарифа. Повтор через ${blocked} с, суточная квота обнуляется утром по МСК.`;
      data.retryIn = blocked;
    }
    stateCache = { at: Date.now(), data };
    return data;
  } catch (error) {
    if (stateCache.data) return { ...stateCache.data, warning: error.message, retryIn: error.retryIn || 0 };
    return {
      configured: true,
      cloud: false,
      me: { id: myId(), name: myName() || myCode(), about: myAbout(), avatar: settings().friendAvatar || '', banner: settings().friendBanner || '', code: myCode() },
      friends: [],
      packs: [],
      warning: error.message,
      retryIn: error.retryIn || (cloud.blockedSeconds ? cloud.blockedSeconds() : 0),
    };
  }
}

function markRead({ friendId }) {
  if (!friendId) return false;
  const map = { ...(settings().friendsRead || {}) };
  map[friendId] = Date.now();
  store.saveSettings({ friendsRead: map });
  return true;
}

function messages({ friendId }) {
  return readMessages(friendId);
}

async function setup({ name, about }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('Введите имя для друзей');
  store.saveSettings({
    friendName: trimmed,
    friendAbout: String(about || '').trim().slice(0, 140),
  });
  await publish({ status: { state: 'launcher', at: Date.now() } });
  return { id: myId(), code: myCode(), name: trimmed };
}

async function clearChat({ friendId }) {
  if (!configured()) throw new Error('Firebase не настроен');
  if (!friendId) throw new Error('Не выбран друг');
  const rows = await cloud.query('messages', {
    where: [{ field: 'pair', op: 'EQUAL', value: pairId(myId(), friendId) }],
    limit: 300,
  });
  for (const row of rows) {
    await cloud.removeDoc('messages', row.id);
  }
  const readMap = { ...(settings().friendsRead || {}) };
  readMap[friendId] = Date.now();
  store.saveSettings({ friendsRead: readMap });
  return { removed: rows.length };
}

async function friendProfile({ friendId }) {
  if (!configured()) throw new Error('Firebase не настроен');
  const doc = await cloud.getDoc('users', friendId);
  if (!doc) throw new Error('Профиль друга не найден');
  let messages = [];
  try {
    messages = await readMessages(friendId);
  } catch {
    messages = [];
  }
  return {
    id: friendId,
    name: doc.name || '',
    about: doc.about || '',
    avatar: doc.avatar || '',
    banner: doc.banner || '',
    code: doc.code || '',
    online: Date.now() - (doc.updated || 0) < ONLINE_MS,
    updated: doc.updated || 0,
    status: doc.status || { state: 'offline' },
    messages: messages.length,
    lastMessageAt: messages.length ? messages[messages.length - 1].at : null,
  };
}

async function updateProfile({ name, about, avatar, banner }) {
  if (!configured()) throw new Error('Firebase не настроен');
  const patch = { updated: Date.now() };
  if (typeof name === 'string' && name.trim()) {
    store.saveSettings({ friendName: name.trim() });
    patch.name = name.trim();
  }
  if (typeof about === 'string') {
    store.saveSettings({ friendAbout: about.trim().slice(0, 140) });
    patch.about = about.trim().slice(0, 140);
  }
  if (typeof avatar === 'string') {
    if (avatar.length > 220000) throw new Error('Аватар слишком большой');
    store.saveSettings({ friendAvatar: avatar });
    patch.avatar = avatar;
  }
  if (typeof banner === 'string') {
    if (banner.length > 700000) throw new Error('Баннер слишком большой');
    store.saveSettings({ friendBanner: banner });
    patch.banner = banner;
  }
  patch.code = myCode();
  await cloud.patchDoc('users', myId(), patch);
  return { name: patch.name, about: patch.about, avatar: patch.avatar, banner: patch.banner };
}

async function leavePack({ packId }) {
  if (!configured()) throw new Error('Firebase не настроен');
  if (!packId) throw new Error('Не указана общая сборка');
  const pack = await readPack(packId);
  const me = myId();
  if (pack.creator === me) {
    await cloud.removeDoc('packs', packId);
    return { deleted: true, packName: pack.name || '' };
  }
  const members = (pack.members || []).filter((id) => id !== me);
  await cloud.patchDoc('packs', packId, { members, updated: Date.now() });
  return { deleted: false, packName: pack.name || '', members: members.length };
}

async function deleteSharedBuild({ instanceId }) {
  const instance = instances.readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  if (!instance.sharedPack) throw new Error('Это обычная сборка — удалите её кнопкой в настройках сборки');
  const result = await leavePack({ packId: instance.sharedPack });
  await instances.deleteInstance(instanceId);
  return { ...result, instanceName: instance.name };
}

async function syncLinkedPacks() {
  if (!configured()) return { synced: 0 };
  const linked = instances.listInstances().filter((instance) => instance.sharedPack);
  let synced = 0;
  for (const instance of linked) {
    try {
      const result = await syncPack({ packId: instance.sharedPack });
      if (result.installed || result.uploaded) synced += 1;
    } catch {
      /* сборка удалена или нет доступа */
    }
  }
  return { synced };
}

async function ensureSharedInstances() {
  if (!configured()) return { created: 0 };
  let created = 0;
  try {
    const packs = await listPacks();
    const linked = new Set(instances.listInstances().filter((instance) => instance.sharedPack).map((instance) => instance.sharedPack));
    const me = myId();
    for (const pack of packs) {
      if (linked.has(pack.id)) continue;
      if (pack.creator === me) continue;
      if (!Array.isArray(pack.members) || !pack.members.includes(me)) continue;
      try {
        const instance = await instances.createInstance({
          name: pack.name,
          mcVersion: pack.mcVersion,
          loader: parseLoader(pack.loader),
          cover: pack.cover || 'autumn',
        });
        instances.updateInstance(instance.id, { sharedPack: pack.id });
        created += 1;
      } catch {
        /* пропускаем сборку, если не удалось создать */
      }
    }
  } catch {
    /* облако недоступно */
  }
  return { created };
}

let cachedSummary = { configured: false, unread: 0, online: 0, friends: [] };
let stateCache = { at: 0, data: null };
let beatTimer = null;
let syncTimer = null;

async function refreshSummary() {
  try {
    const data = await state();
    cachedSummary = {
      configured: data.configured,
      unread: data.friends.reduce((total, friend) => total + (friend.unread || 0), 0),
      online: data.friends.filter((friend) => friend.online).length,
      friends: data.friends.map((friend) => ({
        id: friend.id,
        name: friend.name,
        online: friend.online,
        unread: friend.unread,
      })),
    };
  } catch {
    cachedSummary = { ...cachedSummary, configured: configured() };
  }
  return cachedSummary;
}

function summary() {
  return cachedSummary;
}

function stopSync() {
  clearInterval(beatTimer);
  clearInterval(syncTimer);
  beatTimer = null;
  syncTimer = null;
}

function startSync(window, getStatus) {
  stopSync();
  if (!configured()) return;
  const beat = () => {
    try {
      if (!configured()) return;
      const status = typeof getStatus === 'function' ? getStatus() : { state: 'launcher' };
      heartbeat(status).catch(() => {});
    } catch {
      /* попробуем позже */
    }
  };
  beat();
  beatTimer = setInterval(beat, 60000);
  const tick = async () => {
    if (window && !window.isDestroyed() && typeof window.isVisible === 'function' && !window.isVisible()) return;
    await refreshSummary();
    if (window && !window.isDestroyed()) window.webContents.send('friends:update', cachedSummary);
  };
  let ticks = 0;
  setTimeout(() => {
    tick().catch(() => {});
  }, 1200);
  syncTimer = setInterval(() => {
    tick().catch(() => {});
    ticks += 1;
    if (ticks % 3 === 0) ensureSharedInstances().catch(() => {});
    if (ticks % 3 === 0) syncLinkedPacks().catch(() => {});
  }, 20000);
}

module.exports = {
  state,
  summary,
  refreshSummary,
  startSync,
  stopSync,
  heartbeat,
  statusFromLaunch,
  send,
  messages,
  markRead,
  sharePack,
  addPack,
  syncPack,
  listPacks,
  readPack,
  myId,
  myCode,
  addFriend,
  removeFriend,
  setup,
  clearChat,
  friendProfile,
  updateProfile,
  leavePack,
  deleteSharedBuild,
  syncLinkedPacks,
  ensureSharedInstances,
  configured,
};
