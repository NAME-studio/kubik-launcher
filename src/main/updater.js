const { app, dialog } = require('electron');
const store = require('./store');

let autoUpdater = null;
let sender = null;
let initialized = false;

const state = {
  status: 'idle',
  version: (app && app.getVersion && app.getVersion()) || '1.0.0',
  available: null,
  progress: 0,
  error: '',
  supported: Boolean(app) && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR,
  reason: '',
};

if (!app.isPackaged) {
  state.reason = 'Обновления работают только в установленной версии';
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  state.reason = 'Portable-версия не обновляется автоматически — скачайте новый Setup';
}

function load() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (error) {
    state.supported = false;
    state.reason = `Модуль обновлений недоступен: ${error.message}`;
    return null;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => setStatus({ status: 'checking', error: '' }));
  autoUpdater.on('update-available', (info) => {
    setStatus({ status: 'available', available: info?.version || null, progress: 0, error: '' });
  });
  autoUpdater.on('update-not-available', () => {
    setStatus({ status: 'latest', available: null, progress: 0, error: '' });
  });
  autoUpdater.on('download-progress', (progress) => {
    setStatus({ status: 'downloading', progress: Math.round(progress?.percent || 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    setStatus({ status: 'ready', available: info?.version || state.available, progress: 100 });
  });
  autoUpdater.on('error', (error) => {
    setStatus({ status: 'error', error: cleanError(error) });
  });

  return autoUpdater;
}

function cleanError(error) {
  const message = String(error?.message || error || 'Неизвестная ошибка');
  if (/404|Cannot find latest/i.test(message)) return 'В релизах GitHub пока нет файла обновления';
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/i.test(message)) return 'Нет связи с GitHub — проверьте интернет';
  if (/net::/i.test(message)) return 'Не удалось скачать обновление — проверьте интернет';
  return message.split('\n')[0].slice(0, 200);
}

function setStatus(patch) {
  Object.assign(state, patch);
  if (sender && !sender.isDestroyed()) sender.send('update:status', state);
}

function init(window) {
  if (window) sender = window.webContents;
  if (initialized || !state.supported) return state;
  initialized = true;
  load();
  return state;
}

function getState() {
  return { ...state };
}

async function check() {
  if (!state.supported) return getState();
  const updater = load();
  if (!updater) return getState();
  setStatus({ status: 'checking', error: '' });
  try {
    await updater.checkForUpdates();
  } catch (error) {
    setStatus({ status: 'error', error: cleanError(error) });
  }
  return getState();
}

async function download() {
  if (!state.supported) return getState();
  const updater = load();
  if (!updater) return getState();
  setStatus({ status: 'downloading', progress: 0, error: '' });
  try {
    await updater.downloadUpdate();
  } catch (error) {
    setStatus({ status: 'error', error: cleanError(error) });
  }
  return getState();
}

function install() {
  if (!autoUpdater || state.status !== 'ready') return false;
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (error) {
      setStatus({ status: 'error', error: cleanError(error) });
    }
  });
  return true;
}

const notesCache = new Map();

async function notes(version) {
  const tag = String(version || '').trim();
  if (!tag) return null;
  if (notesCache.has(tag)) return notesCache.get(tag);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.github.com/repos/NAME-studio/kubik-launcher/releases/tags/v${tag}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'KubikLauncher' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const result = {
      version: tag,
      name: String(data.name || `Kubik Launcher ${tag}`),
      body: String(data.body || '').slice(0, 6000),
      url: String(data.html_url || ''),
    };
    notesCache.set(tag, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function waitDownloaded(timeout = 300000) {
  if (state.status === 'ready') return Promise.resolve(true);
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (state.status === 'ready') {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (state.status === 'error' || Date.now() - started > timeout) {
        clearInterval(timer);
        resolve(false);
      }
    }, 500);
  });
}

function ask(window, options) {
  return window && !window.isDestroyed()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options);
}

async function promptOnStart(window) {
  if (!state.supported) return false;
  try {
    await check();
  } catch {
    return false;
  }
  if (state.status !== 'available' || !state.available) return false;
  const settings = store.getSettings();
  const seen = (settings.updatePromptSeen && settings.updatePromptSeen[state.available]) || 0;
  if (Date.now() - seen < 24 * 60 * 60 * 1000) return false;
  if (window && !window.isDestroyed()) window.webContents.send('update:prompt', { ...state });
  return true;
}

module.exports = { init, getState, check, download, install, notes, promptOnStart };
