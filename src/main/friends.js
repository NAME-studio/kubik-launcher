'use strict';

const store = require('./store');
const instances = require('./instances');
const modrinth = require('./modrinth');
const cloud = require('./cloud');
const auth = require('./firebase-auth');

const ONLINE_MS = 90 * 1000;
const CODE_VERSION = 2;
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
  const uid = auth.uid();
  if (uid) return uid;
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

async function migrateIdentity() {
  if (!configured()) return '';
  let uid = '';
  try {
    uid = (await auth.ensureSession()).uid || '';
  } catch {
    return '';
  }
  if (!uid) return '';

  const legacy = String(settings().friendId || '');
  let merged = { uid, code: myCode(), name: myName() || myCode(), updated: Date.now() };
  if (legacy && legacy !== uid) {
    try {
      const old = await cloud.getDoc('users', legacy);
      if (old) merged = { ...old, ...merged };
    } catch {
      /* старый документ недоступен — начнём с чистого */
    }
  }

  const localIds = friendList().map((f) => f.id).filter(Boolean);
  const ids = new Set([...(Array.isArray(merged.friends) ? merged.friends : []), ...localIds]);
  const map = new Map();
  for (const id of ids) {
    if (!id || id === uid || id === legacy) continue;
    try {
      const doc = await cloud.getDoc('users', id);
      if (doc && doc.uid && doc.uid !== id) map.set(id, doc.uid);
    } catch {
      /* нет доступа — оставляем прежний id */
    }
  }
  const remap = (id) => map.get(id) || id;
  const remappedLocal = localIds.map(remap);
  merged.friends = [...new Set([...(Array.isArray(merged.friends) ? merged.friends : []).map(remap), ...remappedLocal])]
    .filter((id) => id && id !== uid);
  merged.friendId = legacy || uid;

  if (settings().identityMigrated === uid) {
    try {
      const current = await cloud.getDoc('users', uid);
      const have = new Set(Array.isArray(current && current.friends) ? current.friends : []);
      if (remappedLocal.every((id) => have.has(id))) return uid;
    } catch {
      /* прочитаем заново на следующем старте */
    }
  }


  saveFriendList(friendList().map((friend) => ({ ...friend, id: remap(friend.id) })));
  try {
    await cloud.setDoc('users', uid, merged);
  } catch {
    /* документ создастся при следующем heartbeat */
  }
  try {
    await cloud.setDoc('codes', myCode(), { uid, friendId: legacy || uid, at: Date.now() });
  } catch {
    /* codes начнёт работать после публикации правил */
  }
  store.saveSettings({ identityMigrated: uid });
  return uid;
}

async function ensureIdentity() {
  if (!configured()) return '';
  let uid = '';
  try {
    const session = await auth.ensureSession();
    uid = session.uid || '';
  } catch {
    return '';
  }
  if (!uid) return '';
  const previousCode = settings().friendCode || '';
  if (Number(settings().codeVersion || 0) !== CODE_VERSION) {
    const fresh = makeCode();
    store.saveSettings({ friendCode: fresh, codeVersion: CODE_VERSION });
    if (previousCode && previousCode !== fresh) {
      cloud.removeDoc('codes', previousCode).catch(() => {});
    }
  }
  try {
    await cloud.patchDoc('users', myId(), { uid, code: myCode(), updated: Date.now() });
  } catch {
    /* правила могут запрещать — не блокируем работу */
  }
  try {
    await cloud.setDoc('codes', myCode(), { uid, friendId: myId(), at: Date.now() });
  } catch {
    /* справочник кодов появится после публикации правил */
  }
  return uid;
}

async function publish(doc = {}) {  if (!configured()) return null;
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
  // Без orderBy: равенство по pair + сортировка по at требует составного индекса Firestore,
  // без него запрос падает. Объёма в 300 сообщений на пару хватает, лишнее режем по времени.
  const rows = await cloud.query('messages', {
    where: [{ field: 'pair', op: 'EQUAL', value: pairId(myId(), peerId) }],
    limit: 300,
  });
  return rows.sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-200);
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
  invalidateState();
  return doc;
}

async function addFriend(rawCode) {
  if (!configured()) throw new Error('Firebase не настроен');
  const code = String(rawCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) throw new Error('Код слишком короткий');
  if (code === myCode()) throw new Error('Это ваш собственный код');

  const entry = await cloud.getDoc('codes', code).catch(() => null);
  let targetId = entry && entry.uid;
  if (!targetId && code.length > 8) {
    // Друг на старой версии мог назвать свой прежний id вместо кода — он длиннее 8 символов.
    const byId = await cloud.getDoc('users', code.toLowerCase()).catch(() => null);
    if (byId) targetId = byId.uid || byId.id;
  }
  if (!targetId) {
    throw new Error('Код не найден. Попросите друга установить версию 1.2.0 или новее и запустить лаунчер — код регистрируется при первом запуске.');
  }
  if (targetId === myId()) throw new Error('Это ваш собственный код');

  const found = await cloud.getDoc('users', targetId).catch(() => null);
  if (!found) {
    throw new Error('Друг ещё не открыл «Друзья» в новой версии лаунчера — попросите его обновиться');
  }

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
    // Записывать в документ друга новые правила не дают: дружба становится заявкой,
    // вторая сторона добавляет нас сама, когда откроет «Друзей».
  }

  const list = friendList().filter((friend) => friend.id !== found.id);
  list.push({ id: found.id, name: found.name || code });
  saveFriendList(list);
  invalidateState();
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
    } catch {
      /* локальный список уже обновлён */
    }
  }
  invalidateState();
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

async function myPackIds() {
  const ids = new Set();
  let known = null;
  try {
    const mine = await cloud.getDoc('users', myId());
    if (mine && Array.isArray(mine.sharedPacks)) {
      known = mine.sharedPacks;
      for (const id of known) {
        if (id) ids.add(id);
      }
    }
  } catch {
    /* список пересоберётся из локальных сборок */
  }
  if (!known) {
    try {
      for (const instance of instances.listInstances()) {
        if (instance && instance.sharedPack) ids.add(instance.sharedPack);
      }
    } catch {
      /* ignore */
    }
  }
  return [...ids];
}

async function rememberPack(packId, joined) {
  if (!packId) return;
  try {
    const ids = new Set(await myPackIds());
    if (joined) ids.add(packId);
    else ids.delete(packId);
    await cloud.patchDoc('users', myId(), {
      name: myName() || myCode(),
      code: myCode(),
      sharedPacks: [...ids],
      updated: Date.now(),
    });
  } catch {
    /* список общих сборок не мешает запуску игры */
  }
}

function forgetLocalPack(packId) {
  try {
    for (const instance of instances.listInstances()) {
      if (instance && instance.sharedPack === packId) {
        instances.updateInstance(instance.id, { sharedPack: null });
      }
    }
  } catch {
    /* ignore */
  }
}

async function listPacks() {
  if (!configured()) return [];
  const ids = await myPackIds();
  if (!ids.length) return [];
  let map = {};
  try {
    map = await cloud.batchGet('packs', ids);
  } catch (error) {
    if (error.status === 429) throw error;
    return [];
  }
  return Object.values(map).sort((a, b) => (b.updated || 0) - (a.updated || 0));
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
    creatorUid: auth.uid(),
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
  await rememberPack(pack.id, true);
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
  await rememberPack(pack.id, true);
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
  invalidateState();
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
  invalidateState();
  return { id: myId(), code: myCode(), name: trimmed };
}

async function clearChat({ friendId }) {
  if (!configured()) throw new Error('Firebase не настроен');
  if (!friendId) throw new Error('Не выбран друг');
  const chatId = pairId(myId(), friendId);
  const rows = await cloud.query('messages', {
    where: [{ field: 'pair', op: 'EQUAL', value: chatId }],
    limit: 300,
  });
  // Пачками по 20, чтобы не упираться в лимит запросов и не терять уже удалённое.
  let removed = 0;
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    const results = await Promise.allSettled(chunk.map((row) => cloud.removeDoc('messages', row.id)));
    removed += results.filter((result) => result.status === 'fulfilled').length;
  }
  try {
    await cloud.patchDoc('chats', chatId, { lastAt: 0, lastText: '', lastKind: '', lastFrom: '' });
  } catch {
    /* сводка чата обновится следующим сообщением */
  }
  const readMap = { ...(settings().friendsRead || {}) };
  readMap[friendId] = Date.now();
  store.saveSettings({ friendsRead: readMap });
  invalidateState();
  return { removed };
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
    forgetLocalPack(packId);
    await rememberPack(packId, false);
    return { deleted: true, packName: pack.name || '' };
  }
  const members = (pack.members || []).filter((id) => id !== me);
  await cloud.patchDoc('packs', packId, { members, updated: Date.now() });
  forgetLocalPack(packId);
  await rememberPack(packId, false);
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

// После любого действия (сообщение, друг, сборка) кэш состояния должен сброситься,
// иначе UI ещё 10 секунд показывает старые данные.
function invalidateState() {
  stateCache = { at: 0, data: null };
}

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
  migrateIdentity()
    .then(() => ensureIdentity())
    .catch(() => {});
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
  ensureIdentity,
  migrateIdentity,
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
