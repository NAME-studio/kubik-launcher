const { app } = require('electron');

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
  const updater = load();
  if (updater) {
    setTimeout(() => {
      check().catch(() => {});
    }, 4000);
  }
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
      autoUpdater.quitAndInstall(false, true);
    } catch (error) {
      setStatus({ status: 'error', error: cleanError(error) });
    }
  });
  return true;
}

module.exports = { init, getState, check, download, install };
