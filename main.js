'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Tray, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.setName('Kubik Launcher');
app.setAppUserModelId('com.kubik.launcher');

const START_AT = Date.now();
function markTiming(name) {
  if (process.env.KUBIK_TIMING) console.log('[timing]', name, Date.now() - START_AT);
}
markTiming('module-loaded');

const APP_DATA = app.getPath('appData');
const USER_DATA = path.join(APP_DATA, '.KubikLauncher');
const LEGACY_DIRS = [path.join(APP_DATA, 'KubikLauncher'), path.join(APP_DATA, '.kubic-launcher')];
app.setPath('userData', USER_DATA);
app.setPath('sessionData', path.join(USER_DATA, 'cache', 'chromium'));

const paths = require('./src/main/paths');
const store = require('./src/main/store');
const secrets = require('./src/main/secrets');
const { isNetworkError } = require('./src/main/neterr');
const firebaseAuth = require('./src/main/firebase-auth');
const mojang = require('./src/main/mojang');
const instances = require('./src/main/instances');
const launcher = require('./src/main/launch');
const ely = require('./src/main/ely');
const microsoft = require('./src/main/microsoft');
const modrinth = require('./src/main/modrinth');
const translate = require('./src/main/translate');
const javaManager = require('./src/main/java');
const gameOptions = require('./src/main/options');
const crash = require('./src/main/crash');
const serverPing = require('./src/main/servers');
const curseforge = require('./src/main/curseforge');
const packfile = require('./src/main/packfile');
const friends = require('./src/main/friends');
const rpc = require('./src/main/rpc');
const cloud = require('./src/main/cloud');
const updater = require('./src/main/updater');
const skinhub = require('./src/main/skinhub');
const { ensureDir, exists, formatBytes } = require('./src/main/util');

let mainWindow = null;
let tray = null;
let quitting = false;

paths.setConfigDir(USER_DATA);

function moveIfFree(from, to) {
  try {
    if (exists(from) && !exists(to)) fs.renameSync(from, to);
  } catch {
    /* РјРёРіСЂР°С†РёСЏ РЅРµ РєСЂРёС‚РёС‡РЅР° */
  }
}

const CHROMIUM_DIRS = [
  'blob_storage', 'Code Cache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUCache',
  'Local Storage', 'Network', 'Session Storage', 'Shared Dictionary', 'DIPS',
  'Local State', 'Preferences', 'Crashpad',
];

const MIGRATE_ENTRIES = ['versions', 'libraries', 'assets', 'runtime', 'cache', 'logs', 'skins'];

function migrateLegacyLayout() {
  try {
    if (!exists(USER_DATA)) {
      const legacy = LEGACY_DIRS.find((dir) => exists(dir));
      if (legacy) fs.renameSync(legacy, USER_DATA);
    } else {
      const legacy = LEGACY_DIRS.find((dir) => exists(dir));
      if (legacy) {
        for (const entry of MIGRATE_ENTRIES) moveIfFree(path.join(legacy, entry), path.join(USER_DATA, entry));
        moveIfFree(path.join(legacy, 'config.json'), path.join(USER_DATA, 'config.json'));
        moveIfFree(path.join(legacy, 'accounts.json'), path.join(USER_DATA, 'accounts.json'));
        fs.rmSync(legacy, { recursive: true, force: true });
      }
    }
    if (!exists(USER_DATA)) return;
    const dataDir = path.join(USER_DATA, 'data');
    if (exists(dataDir)) {
      for (const entry of fs.readdirSync(dataDir)) {
        if (entry === 'instances') continue;
        moveIfFree(path.join(dataDir, entry), path.join(USER_DATA, entry));
      }
      const versionsDir = ensureDir(path.join(USER_DATA, 'versions'));
      const oldInstances = path.join(dataDir, 'instances');
      if (exists(oldInstances)) {
        for (const entry of fs.readdirSync(oldInstances)) {
          moveIfFree(path.join(oldInstances, entry), path.join(versionsDir, entry));
        }
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
    const versionsDir = path.join(USER_DATA, 'versions');
    if (!exists(versionsDir)) return;
    for (const entry of fs.readdirSync(versionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const gameDir = path.join(versionsDir, entry.name, '.minecraft');
      if (!exists(gameDir)) continue;
      for (const child of fs.readdirSync(gameDir)) {
        moveIfFree(path.join(gameDir, child), path.join(versionsDir, entry.name, child));
      }
      fs.rmSync(gameDir, { recursive: true, force: true });
    }
    const marker = path.join(USER_DATA, '.migrated');
    if (!exists(marker)) {
      for (const entry of CHROMIUM_DIRS) {
        const target = path.join(USER_DATA, entry);
        if (exists(target)) fs.rmSync(target, { recursive: true, force: true });
      }
      fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
    }
  } catch (error) {
    console.log('[migrate]', error.message);
  }
}

const GUIDE = [
  'Kubik Launcher вЂ” РїР°РїРєР° Р»Р°СѓРЅС‡РµСЂР°',
  '================================',
  '',
  'versions   вЂ” СЃР±РѕСЂРєРё Minecraft: РєР°Р¶РґР°СЏ РІ СЃРІРѕРµР№ РїР°РїРєРµ (РјРѕРґС‹, resourcepacks,',
  '             shaderpacks, saves, config, instance.json) Рё С„Р°Р№Р»С‹ РІРµСЂСЃРёР№ РёРіСЂС‹.',
  'libraries  вЂ” РѕР±С‰РёРµ Р±РёР±Р»РёРѕС‚РµРєРё РґР»СЏ РІСЃРµС… СЃР±РѕСЂРѕРє (СЃРєР°С‡РёРІР°СЋС‚СЃСЏ РѕРґРёРЅ СЂР°Р·).',
  'assets     вЂ” Р·РІСѓРєРё, СЏР·С‹РєРё Рё СЂРµСЃСѓСЂСЃС‹ Minecraft.',
  'runtime    вЂ” Java, РєРѕС‚РѕСЂСѓСЋ Р»Р°СѓРЅС‡РµСЂ СЃРєР°С‡Р°Р» СЃР°Рј.',
  'cache      вЂ” РІСЂРµРјРµРЅРЅС‹Рµ Р·Р°РіСЂСѓР·РєРё (РјРѕР¶РЅРѕ СѓРґР°Р»СЏС‚СЊ).',
  'skins      вЂ” skins/<id>.png вЂ” СЃРєРёРЅС‹ РѕС„Р»Р°Р№РЅ-Р°РєРєР°СѓРЅС‚РѕРІ.',
  'logs       вЂ” Р»РѕРіРё Р·Р°РїСѓСЃРєРѕРІ РёРіСЂС‹.',
  'config.json    вЂ” РЅР°СЃС‚СЂРѕР№РєРё Р»Р°СѓРЅС‡РµСЂР°.',
  'accounts.json  вЂ” Р°РєРєР°СѓРЅС‚С‹ (РЅРёРє, С‚РѕРєРµРЅС‹). РќРёС‡РµРіРѕ СѓРґР°Р»СЏС‚СЊ РЅРµ РЅСѓР¶РЅРѕ.',
  '',
  'Р§С‚РѕР±С‹ РЅР°С‡Р°С‚СЊ: РѕС‚РєСЂРѕР№С‚Рµ Р»Р°СѓРЅС‡РµСЂ, РІС‹Р±РµСЂРёС‚Рµ РЅРёРє РёР»Рё РІРѕР№РґРёС‚Рµ С‡РµСЂРµР· Ely.by,',
  'СЃРѕР·РґР°Р№С‚Рµ СЃР±РѕСЂРєСѓ Рё РЅР°Р¶РјРёС‚Рµ В«РРіСЂР°С‚СЊВ».',
].join('\r\n');

function writeGuide(root) {
  try {
    const file = path.join(root, 'README.txt');
    if (!exists(file)) fs.writeFileSync(file, GUIDE, 'utf8');
  } catch {
    /* РЅРµ РєСЂРёС‚РёС‡РЅРѕ */
  }
}

function initRoot() {
  const settings = store.getSettings();
  const root = settings.root && settings.root.trim() ? settings.root.trim() : USER_DATA;
  paths.setRoot(root);
  for (const dir of [
    paths.versions(),
    paths.libraries(),
    paths.assets(),
    paths.assetsIndexes(),
    paths.assetsObjects(),
    paths.runtime(),
    paths.cache(),
    paths.skins(),
    paths.logs(),
  ]) {
    ensureDir(dir);
  }
  writeGuide(root);
  return root;
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function forgetLastInstance(removedIds) {
  const settings = store.getSettings();
  const removed = Array.isArray(removedIds) ? removedIds : [removedIds];
  if (!settings.lastInstance || !removed.includes(settings.lastInstance)) return;
  const rest = instances.listInstances();
  store.saveSettings({ lastInstance: (rest[0] && rest[0].id) || '' });
}

function wrap(handler) {
  return async (event, ...args) => {
    try {
      const data = await handler(...args);
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error && error.message ? error.message : String(error),
        logFile: (error && error.logFile) || null,
        code: (error && error.code) || null,
        meta: (error && error.meta) || null,
      };
    }
  };
}

function setTaskbarProgress(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setProgressBar(value);
  } catch {
    /* РѕРєРЅРѕ РјРѕРіР»Рѕ Р·Р°РєСЂС‹С‚СЊСЃСЏ */
  }
}

function progressFor(instanceId, channel = 'install:progress') {
  let lastEmit = 0;
  return (payload) => {
    const now = Date.now();
    if (now - lastEmit < 100 && payload.percent !== 100) return;
    lastEmit = now;
    const percent = Number(payload.percent);
    if (Number.isFinite(percent)) {
      setTaskbarProgress(percent >= 100 ? -1 : Math.max(0, Math.min(1, percent / 100)));
    }
    emit(channel, { instanceId, ...payload });
  };
}

const iconPath = path.join(__dirname, 'build', 'icon.png');

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(iconPath);
    tray.setToolTip('Kubik Launcher');
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'РћС‚РєСЂС‹С‚СЊ Kubik Launcher', click: () => showWindow() },
        { type: 'separator' },
        {
          label: 'Р’С‹С…РѕРґ',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    tray.on('double-click', () => showWindow());
  } catch (error) {
    console.log('[tray]', error.message);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const shotSize = /^[0-9]+x[0-9]+$/.test(process.env.KUBIK_WINDOW || '') ? process.env.KUBIK_WINDOW.split('x').map(Number) : null;
  mainWindow = new BrowserWindow({
    width: shotSize ? shotSize[0] : 1360,
    height: shotSize ? shotSize[1] : 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#0b0d12',
    title: 'Kubik Launcher',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    markTiming('ready-to-show');
    const settings = store.getSettings();
    const hidden = process.argv.includes('--hidden') && settings.startInTray !== false;
    if (!hidden) mainWindow.show();
    updater.init(mainWindow);
    setTimeout(() => {
      updater.promptOnStart(mainWindow).catch(() => {});
    }, 2500);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (quitting) return;
    const settings = store.getSettings();
    const keep = settings.closeToTray !== false || (settings.hideOnClose !== false && launcher.running.size > 0);
    if (keep) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (process.env.KUBIK_EVAL) {
    setTimeout(async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(process.env.KUBIK_EVAL);
        console.log('[eval]', JSON.stringify(result).slice(0, 400));
      } catch (error) {
        console.log('[eval-error]', error.message);
      }
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.KUBIK_EVAL_DELAY) || 1800));
      if (process.env.KUBIK_SHOT) {
        try {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.join(process.env.KUBIK_SHOT, 'eval.png'), image.toPNG());
        } catch {
          /* ignore */
        }
      }
      setTimeout(() => {
        quitting = true;
        app.quit();
      }, 400);
    }, 3000);
  }

  if (process.env.KUBIK_SHOT && !process.env.KUBIK_EVAL) {
    const dir = process.env.KUBIK_SHOT;
    setTimeout(async () => {
      const routes = [
        'home',
        'instances',
        'versions',
        'skins',
        'mods',
        'modpacks',
        'resourcepacks',
        'shaders',
        'servers',
        'friends',
        'settings',
        'logs',
      ];
      const waitForPaint = async () => {
        const deadline = Date.now() + 45000;
        let previousLength = -1;
        let stableRounds = 0;
        while (Date.now() < deadline) {
          const state = await mainWindow.webContents.executeJavaScript(`(() => {
            const page = document.getElementById('page');
            if (!page) return { ok: false, length: 0, pending: 0, busy: 0 };
            const busy = page.querySelectorAll('.skeleton, .spinner, .loading, .skeleton-card, .shimmer').length;
            const images = Array.from(page.querySelectorAll('img'));
            const pending = images.filter((img) => !img.complete || img.naturalWidth === 0).length;
            const text = page.textContent || '';
            const loading = /Р—Р°РіСЂСѓР¶Р°СЋ|Р—Р°РіСЂСѓР·РєР°|РџРѕРґРѕР¶РґРёС‚Рµ|РС‰Сѓ|Loading/.test(text);
            return {
              ok: !busy && !pending && !loading,
              length: text.length,
              pending,
              busy,
            };
          })()`);
          if (state.ok && state.length > 0 && state.length === previousLength) {
            stableRounds += 1;
            if (stableRounds >= 2) return state;
          } else {
            stableRounds = 0;
          }
          previousLength = state.length;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return { ok: false, length: previousLength };
      };
      for (const route of routes) {
        try {
          await mainWindow.webContents.executeJavaScript(`location.hash = '#${route}'`);
          const state = await waitForPaint();
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(path.join(dir, `shot-${route}.png`), image.toPNG());
          console.log('[shot]', route, state.ok ? 'ready' : 'timeout', `${state.length} СЃРёРјРІ.`);
        } catch (error) {
          console.log('[shot-error]', route, error.message);
        }
      }
      quitting = true;
      app.quit();
    }, 2500);
  }

  if (process.env.KUBIK_SMOKE) {
    const limit = Number(process.env.KUBIK_SMOKE) || 12000;
    mainWindow.webContents.on('console-message', (event, level, message) => {
      console.log(`[renderer:${level}] ${message}`);
    });
    mainWindow.webContents.on('did-fail-load', (event, code, description) => {
      console.log(`[fail-load] ${code} ${description}`);
    });
    mainWindow.webContents.on('render-process-gone', (event, details) => {
      console.log('[render-process-gone]', JSON.stringify(details));
    });
    setTimeout(() => {
      console.log('[smoke] Р·Р°РІРµСЂС€РµРЅРёРµ');
      quitting = true;
      app.quit();
    }, limit);
  }

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function registerIpc() {
  ipcMain.handle('rpc:update', wrap(({ activity }) => rpc.update(activity)));
  ipcMain.handle('rpc:restart', wrap(() => rpc.start()));
  ipcMain.handle('rpc:status', wrap(() => rpc.status()));

  ipcMain.handle('update:state', wrap(() => updater.getState()));
  ipcMain.handle('update:check', wrap(() => updater.check()));
  ipcMain.handle('update:download', wrap(() => updater.download()));
  ipcMain.handle('update:install', wrap(() => updater.install()));
  ipcMain.handle('update:notes', wrap(({ version }) => updater.notes(version)));

  ipcMain.handle('friends:state', wrap(() => friends.state()));
  ipcMain.handle('friends:setup', wrap(({ name, about }) => friends.setup({ name, about })));
  ipcMain.handle('friends:add', wrap(({ code }) => friends.addFriend(code)));
  ipcMain.handle('friends:remove', wrap(({ friendId }) => friends.removeFriend(friendId)));
  ipcMain.handle('friends:clear', wrap(({ friendId }) => friends.clearChat({ friendId })));
  ipcMain.handle('friends:profile', wrap(({ friendId }) => friends.friendProfile({ friendId })));
  ipcMain.handle('friends:profile-save', wrap((payload) => friends.updateProfile(payload || {})));
  ipcMain.handle('friends:sync-linked', wrap(() => friends.syncLinkedPacks()));
  ipcMain.handle('friends:ensure-shared', wrap(() => friends.ensureSharedInstances()));
  ipcMain.handle('friends:leave-pack', wrap(({ packId }) => friends.leavePack({ packId })));
  ipcMain.handle('friends:delete-shared', wrap(({ instanceId }) => friends.deleteSharedBuild({ instanceId })));
  ipcMain.handle('friends:heartbeat', wrap(({ status }) => friends.heartbeat(status)));
  ipcMain.handle('friends:send', wrap(({ friendId, text, kind, payload }) => friends.send({ friendId, text, kind, payload })));
  ipcMain.handle('friends:messages', wrap(({ friendId }) => friends.messages({ friendId })));
  ipcMain.handle('friends:read', wrap(({ friendId }) => friends.markRead({ friendId })));
  ipcMain.handle(
    'friends:share-pack',
    wrap(({ instanceId, friendIds }) => friends.sharePack({ instanceId, friendIds })),
  );
  ipcMain.handle('friends:add-pack', wrap(({ packId }) => friends.addPack({ packId })));
  ipcMain.handle('friends:sync-pack', wrap(({ packId }) => friends.syncPack({ packId })));

  ipcMain.handle(
    'app:info',
    wrap(() => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      root: paths.root(),
      configDir: USER_DATA,
      platform: process.platform,
      totalMemory: os.totalmem(),
      cpuCount: os.cpus().length,
    })),
  );

  ipcMain.handle('app:open-external', wrap(({ url }) => shell.openExternal(url)));
  ipcMain.handle(
    'app:secrets',
    wrap(() => {
      const available = secrets.available();
      const sample = 'kubik-secret';
      const roundTrip = secrets.reveal(secrets.protect(sample)) === sample;
      return { available, roundTrip };
    }),
  );
  ipcMain.handle(
    'app:firebase-auth',
    wrap(async () => {
      // РћС€РёР±РєСѓ РїСЂРѕР±СЂР°СЃС‹РІР°РµРј вЂ” РѕР±С‘СЂС‚РєР° wrap СЃР°РјР° РІРµСЂРЅС‘С‚ {ok:false,error}, Р±РµР· РґРІРѕР№РЅРѕРіРѕ ok.
      const session = await firebaseAuth.ensureSession();
      return { uid: session.uid || '' };
    }),
  );
  ipcMain.handle(
    'app:set-autostart',
    wrap(({ enabled }) => {
      const on = Boolean(enabled);
      app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: ['--hidden'] });
      store.saveSettings({ autoStart: on });
      return app.getLoginItemSettings().openAtLogin;
    }),
  );
  ipcMain.handle('app:open-path', wrap(({ target }) => shell.openPath(target)));
  ipcMain.handle(
    'app:copy-text',
    wrap(({ text }) => {
      clipboard.writeText(String(text || ''));
      return true;
    }),
  );
  ipcMain.handle(
    'app:pick-folder',
    wrap(async ({ title }) => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: title || 'Р’С‹Р±РµСЂРёС‚Рµ РїР°РїРєСѓ',
        properties: ['openDirectory', 'createDirectory'],
      });
      return result.canceled ? null : result.filePaths[0];
    }),
  );

  ipcMain.handle('window:minimize', wrap(() => mainWindow && mainWindow.minimize()));
  ipcMain.handle(
    'window:maximize',
    wrap(() => {
      if (!mainWindow) return false;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
      return mainWindow.isMaximized();
    }),
  );
  ipcMain.handle('window:close', wrap(() => mainWindow && mainWindow.close()));
  ipcMain.handle('window:hide', wrap(() => mainWindow && mainWindow.hide()));
  ipcMain.handle('window:show', wrap(() => showWindow()));

  ipcMain.handle('settings:get', wrap(() => ({ settings: store.getSettings(), accounts: store.getAccounts() })));
  ipcMain.handle(
    'settings:save',
    wrap((patch) => {
      const previous = store.getSettings();
      if (patch.root !== undefined) {
        store.saveSettings(patch);
        initRoot();
      } else {
        store.saveSettings(patch);
      }
      // РЎРјРµРЅРёР»Рё РїСЂРѕРµРєС‚ РёР»Рё РєР»СЋС‡ Firebase вЂ” СЃС‚Р°СЂС‹Р№ С‚РѕРєРµРЅ С‡СѓР¶РѕР№ СЃРµСЃСЃРёРё Р±РѕР»СЊС€Рµ РЅРµ РіРѕРґРёС‚СЃСЏ.
      if (
        (patch.firebaseApiKey !== undefined && patch.firebaseApiKey !== previous.firebaseApiKey) ||
        (patch.firebaseProjectId !== undefined && patch.firebaseProjectId !== previous.firebaseProjectId)
      ) {
        firebaseAuth.reset();
      }
      return store.getSettings();
    }),
  );

  ipcMain.handle(
    'accounts:login',
    wrap(async ({ username, password, twoFactor }) => ely.authenticate(username, password, twoFactor)),
  );
  ipcMain.handle('accounts:local', wrap(({ username }) => ely.offlineAccount(username)));
  ipcMain.handle(
    'accounts:list',
    wrap(() => ({ ...store.getAccounts(), currentAccount: store.currentAccount() })),
  );
  ipcMain.handle('accounts:select', wrap(({ id }) => store.setCurrent(id)));
  ipcMain.handle('accounts:logout', wrap(({ id }) => store.removeAccount(id)));
  ipcMain.handle(
    'accounts:refresh',
    wrap(async () => {
      const account = store.currentAccount();
      if (!account) return null;
      if (account.type === 'microsoft') return microsoft.refresh(account);
      return ely.refresh(account);
    }),
  );
  ipcMain.handle('accounts:microsoft-start', wrap(() => microsoft.startDeviceCode()));
  ipcMain.handle('accounts:microsoft-poll', wrap(({ deviceCode }) => microsoft.pollUntilDone(deviceCode)));
  ipcMain.handle(
    'accounts:skin',
    wrap(({ id }) => {
      const account = id ? store.getAccounts().list.find((a) => a.id === id) : store.currentAccount();
      return ely.accountSkin(account);
    }),
  );
  ipcMain.handle(
    'accounts:skin-set',
    wrap(({ dataUrl, model }) => ely.setLocalSkin(store.currentAccount(), dataUrl, model)),
  );

  ipcMain.handle(
    'versions:manifest',
    wrap(async () => {
      const manifest = await mojang.getManifest();
      return { latest: manifest.latest, versions: manifest.versions };
    }),
  );
  ipcMain.handle('versions:installed', wrap(() => mojang.installedVersions()));
  ipcMain.handle('versions:loaders', wrap(({ type, mcVersion }) => instances.loaderVersions(type, mcVersion)));

  ipcMain.handle('instances:list', wrap(() => instances.listInstances()));
  ipcMain.handle(
    'instances:create',
    wrap((options) => {
      const created = instances.createInstance(options);
      const globals = store.getSettings().globalOptions;
      if (store.getSettings().syncGameOptions !== false && globals && Object.keys(globals).length) {
        try {
          gameOptions.write(created.id, globals);
        } catch {
          /* РЅР°СЃС‚СЂРѕР№РєРё РЅРµ РєСЂРёС‚РёС‡РЅС‹ РґР»СЏ СЃРѕР·РґР°РЅРёСЏ */
        }
      }
      return created;
    }),
  );
  ipcMain.handle('instances:update', wrap(({ id, patch }) => instances.updateInstance(id, patch)));
  ipcMain.handle('instances:delete', wrap(async ({ id }) => {
    if (launcher.isRunning(id)) throw new Error('РЎРЅР°С‡Р°Р»Р° Р·Р°РєСЂРѕР№С‚Рµ РёРіСЂСѓ вЂ” СЃР±РѕСЂРєР° Р·Р°РїСѓС‰РµРЅР°');
    const instance = instances.readInstance(id);
    if (instance && instance.sharedPack) {
      try {
        await friends.leavePack({ packId: instance.sharedPack });
      } catch {
        /* РѕР±Р»Р°РєРѕ РЅРµРґРѕСЃС‚СѓРїРЅРѕ вЂ” СѓРґР°Р»СЏРµРј Р»РѕРєР°Р»СЊРЅРѕ */
      }
    }
    const removed = instances.deleteInstance(id);
    if (removed) forgetLastInstance([id]);
    return removed;
  }));
  ipcMain.handle('instances:duplicate', wrap(({ id }) => instances.duplicateInstance(id)));
  ipcMain.handle('instances:size', wrap(({ id }) => instances.instanceSize(id)));
  ipcMain.handle('instances:options-get', wrap(({ id }) => gameOptions.read(id)));
  ipcMain.handle(
    'instances:options-save',
    wrap(({ id, patch }) => {
      const saved = gameOptions.write(id, patch);
      if (store.getSettings().syncGameOptions !== false) {
        const clean = {};
        for (const [key, value] of Object.entries(patch || {})) {
          if (value === undefined || value === null || value === '') continue;
          clean[key] = String(value);
        }
        if (Object.keys(clean).length) {
          store.saveSettings({ globalOptions: { ...(store.getSettings().globalOptions || {}), ...clean } });
          for (const instance of instances.listInstances()) {
            if (instance.id === id) continue;
            try {
              gameOptions.write(instance.id, clean);
            } catch {
              /* СЃР±РѕСЂРєСѓ РјРѕРіР»Рё СѓРґР°Р»РёС‚СЊ вЂ” РїСЂРѕРїСѓСЃРєР°РµРј */
            }
          }
        }
      }
      return saved;
    }),
  );
  ipcMain.handle('instances:open-folder', wrap(({ id }) => shell.openPath(paths.instanceDir(id))));
  ipcMain.handle(
    'instances:export',
    wrap(async ({ id, withSaves }) => {
      const instance = instances.readInstance(id);
      if (!instance) throw new Error('РЎР±РѕСЂРєР° РЅРµ РЅР°Р№РґРµРЅР°');
      const safeName = String(instance.name).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 40) || 'sborka';
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Р­РєСЃРїРѕСЂС‚ СЃР±РѕСЂРєРё',
        defaultPath: path.join(app.getPath('downloads'), `${safeName}.zip`),
        filters: [{ name: 'РђСЂС…РёРІ СЃР±РѕСЂРєРё', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return null;
      return instances.exportInstance(id, result.filePath, { withSaves: Boolean(withSaves) });
    }),
  );
  ipcMain.handle(
    'instances:import',
    wrap(async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'РРјРїРѕСЂС‚ СЃР±РѕСЂРєРё РёР»Рё РјРѕРґРїР°РєР°',
        filters: [{ name: 'РђСЂС…РёРІ СЃР±РѕСЂРєРё РёР»Рё РјРѕРґРїР°РєР°', extensions: ['zip', 'mrpack'] }],
        properties: ['openFile'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const file = result.filePaths[0];
      const packed = await packfile.importFile(file, { onProgress: progressFor(null, 'modpack:progress') });
      const instance = packed ? packed.instance : instances.importInstance(file);
      emit('instances:changed', {});
      return instance;
    }),
  );

  ipcMain.handle(
    'game:prepare-all',
    wrap(async () => {
      const list = instances.listInstances();
      const results = [];
      for (let index = 0; index < list.length; index += 1) {
        const instance = list[index];
        const base = { index, total: list.length, instanceId: instance.id, name: instance.name };
        emit('prepare:progress', { ...base, phase: 'start' });
        try {
          const versionId = await instances.ensureProfile(instance, progressFor(instance.id));
          results.push({ id: instance.id, name: instance.name, ok: true, versionId });
        } catch (error) {
          results.push({ id: instance.id, name: instance.name, ok: false, error: error.message });
        }
        emit('prepare:progress', { ...base, index: index + 1, phase: 'done', result: results[results.length - 1] });
      }
      return { results };
    }),
  );

  ipcMain.handle(
    'game:install',
    wrap(async ({ instanceId }) => {
      const instance = instances.readInstance(instanceId);
      if (!instance) throw new Error('РЎР±РѕСЂРєР° РЅРµ РЅР°Р№РґРµРЅР°');
      const progress = progressFor(instanceId);
      const versionId = await instances.ensureProfile(instance, progress, { verify: true });
      return { versionId };
    }),
  );

  ipcMain.handle(
    'game:launch',
    wrap(async ({ instanceId, server }) => {
      const instance = instances.readInstance(instanceId);
      if (!instance) throw new Error('РЎР±РѕСЂРєР° РЅРµ РЅР°Р№РґРµРЅР°');
      const extraGameArgs = [];
      if (server) {
        const raw = String(server).trim();
        const [host, port] = raw.split(':');
        if (host) {
          extraGameArgs.push('--server', host, '--port', String(port || 25565));
        }
      }
      const activeIds = [...launcher.running.keys()].filter((id) => id !== instanceId);
      if (activeIds.length) {
        const active = instances.readInstance(activeIds[0]);
        const activeName = active ? active.name : activeIds[0];
        const busy = new Error(`РЈР¶Рµ Р·Р°РїСѓС‰РµРЅР° СЃР±РѕСЂРєР° В«${activeName}В». Р—Р°РєСЂРѕР№С‚Рµ РµС‘, С‡С‚РѕР±С‹ РёРіСЂР°С‚СЊ РІ РґСЂСѓРіСѓСЋ.`);
        busy.code = 'another-running';
        busy.meta = { instanceId: activeIds[0], instanceName: activeName };
        throw busy;
      }
      let account = store.currentAccount();
      if (!account) throw new Error('РЎРЅР°С‡Р°Р»Р° РІС‹Р±РµСЂРёС‚Рµ Р°РєРєР°СѓРЅС‚ вЂ” РѕС„Р»Р°Р№РЅ, Ely.by РёР»Рё Microsoft');
      const authStart = Date.now();
      let offlineMode = false;
      try {
        if (account.type === 'ely') {
          const valid = await ely.validateCached(account);
          if (!valid) account = await ely.refresh(account);
        } else if (account.type === 'microsoft') {
          account = await microsoft.refresh(account);
        }
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        offlineMode = true;
        emit('launch:log', {
          instanceId,
          text: 'РќРµС‚ СЃРІСЏР·Рё СЃ СЃРµСЂРІРµСЂРѕРј РІС…РѕРґР° вЂ” Р·Р°РїСѓСЃРєР°СЋ РЅР° СЃРѕС…СЂР°РЅС‘РЅРЅРѕРј Р°РєРєР°СѓРЅС‚Рµ (РѕС„Р»Р°Р№РЅ).',
          stream: 'stderr',
        });
      }
      console.log('[timing] launch:auth', Date.now() - authStart);
      const settings = store.getSettings();
      emit('launch:state', { instanceId, state: 'preparing' });
      setTaskbarProgress(2);
      let result;
      try {
        result = await launcher.launch(instance, account, {
          extraGameArgs,
          onProgress: progressFor(instanceId),
          onLog: (text, stream) => emit('launch:log', { instanceId, text, stream }),
          onStarted: ({ pid, logFile }) => {
            console.log('[timing] launch:spawn', Date.now() - authStart);
            setTaskbarProgress(-1);
            emit('launch:state', { instanceId, state: 'running', pid, logFile });
            rpc.update({ state: 'game', instanceName: instance.name, startedAt: Date.now() });
          },
          onExit: ({ code, signal, logFile }) => {
            setTaskbarProgress(-1);
            emit('launch:state', { instanceId, state: 'exited', code, signal, logFile });
            rpc.update({ state: 'launcher' });
          },
        });
      } catch (error) {
        setTaskbarProgress(-1);
        if (isNetworkError(error)) {
          const friendly = new Error(
            offlineMode
              ? 'РќРµС‚ РёРЅС‚РµСЂРЅРµС‚Р°, Р° С‡Р°СЃС‚СЊ С„Р°Р№Р»РѕРІ СЃР±РѕСЂРєРё РµС‰С‘ РЅРµ СЃРєР°С‡Р°РЅР°. РџРѕРґРєР»СЋС‡РёС‚РµСЃСЊ Рє СЃРµС‚Рё РѕРґРёРЅ СЂР°Р·, С‡С‚РѕР±С‹ РґРѕРєР°С‡Р°С‚СЊ С„Р°Р№Р»С‹.'
              : 'РќРµС‚ СЃРІСЏР·Рё СЃ СЃРµСЂРІРµСЂР°РјРё Minecraft. РџСЂРѕРІРµСЂСЊС‚Рµ РёРЅС‚РµСЂРЅРµС‚ Рё РїРѕРїСЂРѕР±СѓР№С‚Рµ СЃРЅРѕРІР°.',
          );
          friendly.code = 'offline';
          throw friendly;
        }
        throw error;
      }
      if (settings.closeOnLaunch) {
        emit('launch:state', { instanceId, state: 'launcher-hidden' });
        if (mainWindow) mainWindow.hide();
      } else if (settings.minimizeOnLaunch && mainWindow) {
        mainWindow.minimize();
      }
      return { pid: result.pid, logFile: result.logFile };
    }),
  );
  ipcMain.handle('game:stop', wrap(({ instanceId }) => launcher.stop(instanceId)));
  ipcMain.handle(
    'game:stop-all',
    wrap(() => {
      const ids = [...launcher.running.keys()];
      for (const id of ids) launcher.stop(id);
      return { stopped: ids };
    }),
  );
  ipcMain.handle('game:running', wrap(({ instanceId }) => launcher.isRunning(instanceId)));
  ipcMain.handle(
    'game:diagnose',
    wrap(({ logFile, extra }) => crash.diagnose(logFile, extra)),
  );
  ipcMain.handle(
    'game:copy-log',
    wrap(({ logFile }) => {
      const target = path.resolve(String(logFile || ''));
      const logsDir = path.resolve(paths.logs());
      if (!target.startsWith(logsDir)) throw new Error('Р¤Р°Р№Р» Р»РѕРіР° РІРЅРµ РїР°РїРєРё Р»РѕРіРѕРІ');
      if (!fs.existsSync(target)) throw new Error('Р¤Р°Р№Р» Р»РѕРіР° РЅРµ РЅР°Р№РґРµРЅ');
      const text = fs.readFileSync(target, 'utf8');
      clipboard.writeText(text.slice(-120000));
      return { chars: Math.min(text.length, 120000) };
    }),
  );

  ipcMain.handle('instances:delete-many', wrap(async ({ ids }) => {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    for (const id of list) {
      if (launcher.isRunning(id)) throw new Error('РЎРЅР°С‡Р°Р»Р° Р·Р°РєСЂРѕР№С‚Рµ РёРіСЂСѓ вЂ” РѕРґРЅР° РёР· СЃР±РѕСЂРѕРє Р·Р°РїСѓС‰РµРЅР°');
    }
    for (const id of list) {
      const instance = instances.readInstance(id);
      if (instance && instance.sharedPack) {
        try {
          await friends.leavePack({ packId: instance.sharedPack });
        } catch {
          /* РѕР±Р»Р°РєРѕ РЅРµРґРѕСЃС‚СѓРїРЅРѕ вЂ” СѓРґР°Р»СЏРµРј Р»РѕРєР°Р»СЊРЅРѕ */
        }
      }
    }
    const result = instances.deleteInstances(list, true);
    if (result.removed.length) forgetLastInstance(result.removed);
    return result;
  }));

  ipcMain.handle('instances:restore-trash', wrap(() => ({ restored: instances.restoreFromTrash() })));

  ipcMain.handle('servers:list', wrap(() => store.getSettings().servers || []));
  ipcMain.handle(
    'servers:save',
    wrap(({ servers }) => {
      const clean = (Array.isArray(servers) ? servers : [])
        .map((item) => ({
          id: String(item.id || ''),
          name: String(item.name || '').trim().slice(0, 60),
          address: String(item.address || '').trim().slice(0, 120),
        }))
        .filter((item) => item.id && item.address);
      return store.saveSettings({ servers: clean }).servers;
    }),
  );
  ipcMain.handle('servers:ping', wrap(({ address }) => serverPing.ping(address)));

  ipcMain.handle(
    'logs:list',
    wrap(() => {
      if (!exists(paths.logs())) return [];
      return fs
        .readdirSync(paths.logs())
        .filter((file) => file.endsWith('.log'))
        .map((file) => {
          const full = path.join(paths.logs(), file);
          const stat = fs.statSync(full);
          return { file, size: stat.size, sizeLabel: formatBytes(stat.size), mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 40);
    }),
  );
  ipcMain.handle(
    'logs:read',
    wrap(({ file, lines = 400 }) => {
      const full = path.join(paths.logs(), path.basename(file));
      if (!exists(full)) return '';
      const content = fs.readFileSync(full, 'utf8');
      return content.split('\n').slice(-lines).join('\n');
    }),
  );

  ipcMain.handle('skins:profile', wrap(({ nickname }) => ely.skinProfile(nickname)));
  ipcMain.handle(
    'skins:data',
    wrap(async ({ nickname }) => ({
      skin: await ely.skinDataUrl(nickname),
      nickname,
    })),
  );
  ipcMain.handle('skins:open-site', wrap(() => shell.openExternal('https://ely.by/skins')));
  ipcMain.handle('skins:fetch', wrap(({ nick }) => skinhub.fetchByNick(nick)));
  ipcMain.handle('skins:catalog', wrap(({ page, size, refresh }) => skinhub.browse({ page, size, refresh })));
  ipcMain.handle('skins:gallery', wrap(() => skinhub.gallery()));
  ipcMain.handle('skins:gallery-save', wrap(({ dataUrl, name }) => skinhub.saveToGallery({ dataUrl, name })));
  ipcMain.handle('skins:gallery-remove', wrap(({ name }) => skinhub.removeFromGallery({ name })));
  ipcMain.handle(
    'skins:save',
    wrap(async ({ dataUrl, suggestedName }) => {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'РЎРѕС…СЂР°РЅРёС‚СЊ СЃРєРёРЅ',
        defaultPath: path.join(app.getPath('pictures'), suggestedName || 'skin.png'),
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const base64 = String(dataUrl).replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(result.filePath, Buffer.from(base64, 'base64'));
      return result.filePath;
    }),
  );

  ipcMain.handle('content:search', wrap((options) => modrinth.search(options)));
  ipcMain.handle('content:curse-search', wrap((options) => curseforge.search(options)));
  ipcMain.handle('content:curse-status', wrap(() => ({ hasKey: curseforge.hasKey() })));
  ipcMain.handle('content:curse-project', wrap(({ modId }) => curseforge.details(modId)));
  ipcMain.handle(
    'content:curse-install',
    wrap(({ instanceId, modId, projectType }) => {
      const instance = instances.readInstance(instanceId);
      if (!instance) throw new Error('РЎР±РѕСЂРєР° РЅРµ РЅР°Р№РґРµРЅР°');
      const loader = instance.loader && instance.loader.type !== 'vanilla' ? instance.loader.type : null;
      return curseforge.install(instanceId, modId, {
        projectType,
        gameVersion: instance.mcVersion,
        loader: projectType === 'mod' ? loader : null,
      });
    }),
  );
  ipcMain.handle('content:project', wrap(({ id }) => modrinth.getProject(id)));
  ipcMain.handle(
    'content:translate',
    wrap(({ text, from, to }) => translate.translate(text, { from, to: to || 'ru' })),
  );
  ipcMain.handle('content:versions', wrap(({ id, gameVersion, loader }) => modrinth.getVersions(id, { gameVersion, loader })));
  ipcMain.handle('content:installed', wrap(({ instanceId }) => modrinth.installed(instanceId)));
  ipcMain.handle(
    'content:install',
    wrap(({ instanceId, projectId, versionId }) =>
      modrinth.installContent(instanceId, projectId, {
        versionId,
        autoDeps: true,
        onProgress: progressFor(instanceId, 'content:progress'),
      }),
    ),
  );
  ipcMain.handle('content:remove', wrap(({ instanceId, target, folder }) => modrinth.removeContent(instanceId, target, folder)));
  ipcMain.handle('content:toggle', wrap(({ instanceId, target }) => modrinth.toggleContent(instanceId, target)));
  ipcMain.handle('content:updates', wrap(({ instanceId }) => modrinth.updateProjectCheck(instanceId)));
  ipcMain.handle('content:popular', wrap(({ projectType, limit }) => modrinth.popular(projectType, limit)));
  ipcMain.handle(
    'content:modpack-install',
    wrap(({ projectId, versionId, name }) =>
      modrinth.installModpack(projectId, versionId, {
        name,
        onProgress: progressFor(null, 'modpack:progress'),
      }),
    ),
  );
  ipcMain.handle(
    'content:curse-modpack-install',
    wrap(({ modId, name }) =>
      curseforge.installModpack(modId, {
        name,
        onProgress: progressFor(null, 'modpack:progress'),
      }),
    ),
  );

  ipcMain.handle('java:list', wrap((options) => javaManager.listJava(Boolean(options && options.force))));
  ipcMain.handle(
    'java:download',
    wrap(({ major }) => javaManager.downloadRuntime(major, progressFor(null, 'java:progress'))),
  );
}

function countInstall() {
  if (store.getSettings().installCounted) return;
  setTimeout(() => {
    cloud
      .bumpInstalls()
      .then((total) => {
        store.saveSettings({ installCounted: true });
        if (process.env.KUBIK_CLOUD_DEBUG) console.log('[stats] installs', total);
      })
      .catch(() => {});
  }, 5000);
}

app.whenReady().then(() => {
  markTiming('ready');
  migrateLegacyLayout();
  markTiming('migrated');
  store.load();
  if (!store.getSettings().launchHideMigrated) {
    store.saveSettings({ closeOnLaunch: false, minimizeOnLaunch: true, launchHideMigrated: true });
  }
  if (store.getSettings().root && /KubikLauncher(\\|\/|$)/i.test(store.getSettings().root)) {
    store.saveSettings({ root: '' });
  }
  initRoot();
  markTiming('root');
  countInstall();
  registerIpc();
  createWindow();
  markTiming('window-created');
  createTray();
  rpc.start();
  friends.startSync(mainWindow, () => {
    const ids = [...launcher.running.keys()];
    if (!ids.length) return { state: 'launcher' };
    const instance = instances.readInstance(ids[0]);
    return { state: 'game', instanceId: ids[0], instanceName: instance ? instance.name : '' };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });

  setTimeout(() => {
    skinhub.browse({ page: 1, size: 24 }).catch(() => {});
    const settings = store.getSettings();
    const instance = instances.listInstances().find((item) => item.id === settings.lastInstance);
    if (!instance) return;
    const account = store.currentAccount();
    if (!account) return;
    if (account.type === 'ely') ely.validateCached(account).catch(() => {});
    launcher.warm(instance, account).catch(() => {});
  }, 2500);
});

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (store.getSettings().closeToTray !== false) return;
  quitting = true;
  app.quit();
});

