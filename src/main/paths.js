'use strict';

const path = require('path');
const fs = require('fs');
const { ensureDir } = require('./util');

let rootDir = '';
let configDir = '';

function setRoot(dir) {
  rootDir = dir;
  ensureDir(rootDir);
}

function setConfigDir(dir) {
  configDir = dir;
  ensureDir(configDir);
}

function root() {
  return rootDir;
}

const p = (...parts) => path.join(rootDir, ...parts);

module.exports = {
  setRoot,
  setConfigDir,
  root,
  versions: () => p('versions'),
  libraries: () => p('libraries'),
  assets: () => p('assets'),
  assetsObjects: () => p('assets', 'objects'),
  assetsIndexes: () => p('assets', 'indexes'),
  assetsVirtual: () => p('assets', 'virtual'),
  runtime: () => p('runtime'),
  cache: () => p('cache'),
  skins: () => p('skins'),
  authlib: () => p('authlib-injector'),
  instances: () => p('versions'),
  instanceDir: (id) => p('versions', id),
  instanceGameDir: (id) => p('versions', id),
  instanceFile: (id) => p('versions', id, 'instance.json'),
  instanceContent: (id) => p('versions', id, 'content.json'),
  logs: () => p('logs'),
  configFile: () => path.join(configDir || rootDir, 'config.json'),
  accountsFile: () => path.join(configDir || rootDir, 'accounts.json'),
  configRoot: () => configDir || rootDir,
  join: (...parts) => p(...parts),
  packageRoot: () => path.join(__dirname, '..', '..'),
  exists: (target) => fs.existsSync(target),
};
