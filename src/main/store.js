'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const secrets = require('./secrets');
const { ensureDir } = require('./util');

const DEFAULT_SETTINGS = {
  memoryMB: 4096,
  javaPath: '',
  jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
  gameArgs: '',
  closeOnLaunch: false,
  minimizeOnLaunch: true,
  closeToTray: true,
  startInTray: false,
  autoStart: false,
  showConsole: false,
  resolution: { width: 1280, height: 720, custom: false },
  fullscreen: false,
  downloadThreads: 12,
  accent: 'lime',
  theme: 'dark',
  skinServer: 'ely',
  useAuthlibInjector: true,
  autoUpdateCheck: true,
  root: '',
  lastInstance: '',
  firstRun: true,
  newsSeen: false,
  microsoftClientId: '',
  launchHideMigrated: false,
  sounds: true,
  translateDescriptions: true,
  servers: [],
  discordClientId: '1569701499238490122',
  discordRichPresence: true,
  friendsDir: '',
  friendName: '',
  friendId: '',
  friendCode: '',
  friends: [],
  friendsRead: {},
  pinnedFriends: [],
  friendAbout: '',
  friendAvatar: '',
  friendBanner: '',
  firebaseApiKey: '',
  firebaseProjectId: '',
  curseforgeKey: '',
  javaCache: { byMajor: {} },
};

let settings = { ...DEFAULT_SETTINGS };
let accounts = { current: '', list: [] };
const listeners = new Set();

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function load() {
  const rawSettings = readJson(paths.configFile(), {});
  settings = { ...DEFAULT_SETTINGS, ...secrets.revealSettings(rawSettings) };
  if (settings.resolution && typeof settings.resolution === 'object') {
    settings.resolution = { ...DEFAULT_SETTINGS.resolution, ...settings.resolution };
  }
  if (secrets.needsProtection(rawSettings, secrets.SETTINGS_FIELDS)) {
    writeJson(paths.configFile(), secrets.protectSettings(settings));
  }
  const stored = readJson(paths.accountsFile(), { current: '', list: [] });
  if (!Array.isArray(stored.list)) stored.list = [];
  const encryptedStored = secrets.migrateAccounts(stored);
  accounts = { ...stored, list: encryptedStored.data.list.map((account) => secrets.revealAccount(account)) };
  if (encryptedStored.changed) writeJson(paths.accountsFile(), encryptedStored.data);
  if (!accounts.list.some((a) => a.id === accounts.current)) accounts.current = accounts.list[0]?.id || '';
  return getSettings();
}

function getSettings() {
  return settings;
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  writeJson(paths.configFile(), secrets.protectSettings(settings));
  listeners.forEach((fn) => fn(settings));
  return settings;
}

function getAccounts() {
  return accounts;
}

function currentAccount() {
  return accounts.list.find((a) => a.id === accounts.current) || null;
}

function persistAccounts() {
  writeJson(paths.accountsFile(), { ...accounts, list: accounts.list.map((account) => secrets.protectAccount(account)) });
}

function saveAccount(account) {
  const idx = accounts.list.findIndex((a) => a.id === account.id);
  if (idx >= 0) accounts.list[idx] = { ...accounts.list[idx], ...account };
  else accounts.list.push(account);
  accounts.current = account.id;
  persistAccounts();
  return accounts;
}

function removeAccount(id) {
  accounts.list = accounts.list.filter((a) => a.id !== id);
  if (accounts.current === id) accounts.current = accounts.list[0]?.id || '';
  persistAccounts();
  return accounts;
}

function setCurrent(id) {
  if (accounts.list.some((a) => a.id === id)) {
    accounts.current = id;
    persistAccounts();
  }
  return accounts;
}

function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = {
  DEFAULT_SETTINGS,
  load,
  getSettings,
  saveSettings,
  getAccounts,
  currentAccount,
  saveAccount,
  removeAccount,
  setCurrent,
  onSettingsChange,
  writeJson,
  readJson,
};
