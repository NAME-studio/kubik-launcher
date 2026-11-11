'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = [
  'install:progress',
  'prepare:progress',
  'content:progress',
  'modpack:progress',
  'java:progress',
  'launch:log',
  'launch:state',
  'update:status',
  'friends:update',
];

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('api', {
  info: () => invoke('app:info'),
  openExternal: (url) => invoke('app:open-external', { url }),
  openPath: (target) => invoke('app:open-path', { target }),
  pickFolder: (title) => invoke('app:pick-folder', { title }),
  setAutostart: (enabled) => invoke('app:set-autostart', { enabled }),

  window: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    hide: () => invoke('window:hide'),
    show: () => invoke('window:show'),
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
  },

  accounts: {
    list: () => invoke('accounts:list'),
    login: (payload) => invoke('accounts:login', payload),
    local: (username) => invoke('accounts:local', { username }),
    select: (id) => invoke('accounts:select', { id }),
    logout: (id) => invoke('accounts:logout', { id }),
    refresh: () => invoke('accounts:refresh'),
    microsoftStart: () => invoke('accounts:microsoft-start'),
    microsoftPoll: (deviceCode) => invoke('accounts:microsoft-poll', { deviceCode }),
    skin: (id) => invoke('accounts:skin', { id }),
    setSkin: (dataUrl, model) => invoke('accounts:skin-set', { dataUrl, model }),
  },

  versions: {
    manifest: () => invoke('versions:manifest'),
    installed: () => invoke('versions:installed'),
    loaders: (type, mcVersion) => invoke('versions:loaders', { type, mcVersion }),
  },

  instances: {
    list: () => invoke('instances:list'),
    create: (options) => invoke('instances:create', options),
    update: (id, patch) => invoke('instances:update', { id, patch }),
    remove: (id) => invoke('instances:delete', { id }),
    removeMany: (ids) => invoke('instances:delete-many', { ids }),
    duplicate: (id) => invoke('instances:duplicate', { id }),
    size: (id) => invoke('instances:size', { id }),
    openFolder: (id) => invoke('instances:open-folder', { id }),
    options: (id) => invoke('instances:options-get', { id }),
    saveOptions: (id, patch) => invoke('instances:options-save', { id, patch }),
  },

  game: {
    install: (instanceId) => invoke('game:install', { instanceId }),
    prepareAll: () => invoke('game:prepare-all'),
    launch: (instanceId) => invoke('game:launch', { instanceId }),
    stop: (instanceId) => invoke('game:stop', { instanceId }),
    running: (instanceId) => invoke('game:running', { instanceId }),
    diagnose: (logFile, extra) => invoke('game:diagnose', { logFile, extra }),
  },

  rpc: {
    update: (activity) => invoke('rpc:update', { activity }),
    restart: () => invoke('rpc:restart'),
    status: () => invoke('rpc:status'),
  },

  update: {
    state: () => invoke('update:state'),
    check: () => invoke('update:check'),
    download: () => invoke('update:download'),
    install: () => invoke('update:install'),
    onStatus: (handler) => {
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
  },

  friends: {
    state: () => invoke('friends:state'),
    setup: (name, about) => invoke('friends:setup', { name, about }),
    add: (code) => invoke('friends:add', { code }),
    remove: (friendId) => invoke('friends:remove', { friendId }),
    clear: (friendId) => invoke('friends:clear', { friendId }),
    profile: (friendId) => invoke('friends:profile', { friendId }),
    saveProfile: (payload) => invoke('friends:profile-save', payload || {}),
    syncLinked: () => invoke('friends:sync-linked'),
    ensureShared: () => invoke('friends:ensure-shared'),
    leavePack: (packId) => invoke('friends:leave-pack', { packId }),
    deleteShared: (instanceId) => invoke('friends:delete-shared', { instanceId }),
    heartbeat: (status) => invoke('friends:heartbeat', { status }),
    send: (friendId, text, kind, payload) => invoke('friends:send', { friendId, text, kind, payload }),
    messages: (friendId) => invoke('friends:messages', { friendId }),
    read: (friendId) => invoke('friends:read', { friendId }),
    sharePack: (instanceId, friendIds) => invoke('friends:share-pack', { instanceId, friendIds }),
    addPack: (packId) => invoke('friends:add-pack', { packId }),
    syncPack: (packId) => invoke('friends:sync-pack', { packId }),
  },

  servers: {
    list: () => invoke('servers:list'),
    save: (servers) => invoke('servers:save', { servers }),
    ping: (address) => invoke('servers:ping', { address }),
  },

  logs: {
    list: () => invoke('logs:list'),
    read: (file, lines) => invoke('logs:read', { file, lines }),
  },

  skins: {
    profile: (nickname) => invoke('skins:profile', { nickname }),
    data: (nickname) => invoke('skins:data', { nickname }),
    openSite: () => invoke('skins:open-site'),
    save: (dataUrl, suggestedName) => invoke('skins:save', { dataUrl, suggestedName }),
    fetchByNick: (nick) => invoke('skins:fetch', { nick }),
    catalog: (options) => invoke('skins:catalog', options || {}),
    gallery: () => invoke('skins:gallery'),
    gallerySave: (dataUrl, name) => invoke('skins:gallery-save', { dataUrl, name }),
    galleryRemove: (name) => invoke('skins:gallery-remove', { name }),
  },

  content: {
    curseStatus: () => invoke('content:curse-status'),
    curseSearch: (options) => invoke('content:curse-search', options),
    curseInstall: (instanceId, modId, projectType) => invoke('content:curse-install', { instanceId, modId, projectType }),
    search: (options) => invoke('content:search', options),
    project: (id) => invoke('content:project', { id }),
    versions: (id, gameVersion, loader) => invoke('content:versions', { id, gameVersion, loader }),
    installed: (instanceId) => invoke('content:installed', { instanceId }),
    install: (instanceId, projectId, versionId) => invoke('content:install', { instanceId, projectId, versionId }),
    remove: (instanceId, target, folder) => invoke('content:remove', { instanceId, target, folder }),
    toggle: (instanceId, target) => invoke('content:toggle', { instanceId, target }),
    updates: (instanceId) => invoke('content:updates', { instanceId }),
    popular: (projectType, limit) => invoke('content:popular', { projectType, limit }),
    installModpack: (projectId, versionId, name) => invoke('content:modpack-install', { projectId, versionId, name }),
  },

  java: {
    list: (options) => invoke('java:list', options),
    download: (major) => invoke('java:download', { major }),
  },

  on(event, callback) {
    if (!EVENTS.includes(event)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
