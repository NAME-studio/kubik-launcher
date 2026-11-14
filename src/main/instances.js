'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const store = require('./store');
const mojang = require('./mojang');
const java = require('./java');
const net = require('./net');
const zip = require('./zip');
const zipwrite = require('./zipwrite');
const { ensureDir, exists, slugify, randomId, unlinkQuiet, isDir } = require('./util');

const FABRIC_META = 'https://meta.fabricmc.net/v2';
const QUILT_META = 'https://meta.quiltmc.org/v3';
const FORGE_PROMOS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge';
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

const COVERS = ['autumn', 'village', 'winter', 'snow', 'caves', 'desert'];
const GAME_SUBDIRS = ['mods', 'resourcepacks', 'shaderpacks', 'datapacks', 'saves', 'screenshots', 'config', 'logs', 'crash-reports'];

function readInstance(id) {
  const file = paths.instanceFile(id);
  if (!exists(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.id = id;
    return data;
  } catch {
    return null;
  }
}

function writeInstance(instance) {
  ensureDir(paths.instanceDir(instance.id));
  fs.writeFileSync(paths.instanceFile(instance.id), JSON.stringify(instance, null, 2), 'utf8');
  return instance;
}

function listInstances() {
  if (!exists(paths.instances())) return [];
  const result = [];
  for (const entry of fs.readdirSync(paths.instances(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const instance = readInstance(entry.name);
    if (instance) result.push(instance);
  }
  result.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  return result;
}

function uniqueId(base) {
  let id = slugify(base);
  let counter = 2;
  while (exists(paths.instanceDir(id))) {
    id = `${slugify(base)}-${counter}`;
    counter += 1;
  }
  return id;
}

function ensureGameDirs(gameDir) {
  ensureDir(gameDir);
  for (const dir of GAME_SUBDIRS) ensureDir(path.join(gameDir, dir));
}

function createInstance(options = {}) {
  const name = String(options.name || 'Новая сборка').trim() || 'Новая сборка';
  const id = options.id || uniqueId(name);
  const settings = store.getSettings();
  const instance = {
    id,
    name,
    mcVersion: options.mcVersion || '1.21.1',
    loader: options.loader || { type: 'vanilla', version: null },
    memoryMB: options.memoryMB || settings.memoryMB || 4096,
    javaPath: '',
    jvmArgs: '',
    gameArgs: '',
    resolution: { ...(settings.resolution || { width: 1280, height: 720, custom: false }) },
    fullscreen: false,
    createdAt: Date.now(),
    lastPlayed: 0,
    cover: options.cover || COVERS[Math.floor(Math.random() * COVERS.length)],
    icon: options.icon || null,
    modpack: options.modpack || null,
    notes: '',
  };
  ensureGameDirs(paths.instanceGameDir(id));
  writeInstance(instance);
  return instance;
}

function updateInstance(id, patch) {
  const instance = readInstance(id);
  if (!instance) throw new Error('Сборка не найдена');
  const allowed = [
    'name', 'mcVersion', 'loader', 'memoryMB', 'javaPath', 'jvmArgs', 'gameArgs',
    'resolution', 'fullscreen', 'cover', 'icon', 'modpack', 'notes', 'sharedPack',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) instance[key] = patch[key];
  }
  return writeInstance(instance);
}

function deleteInstance(id, keepFiles = true) {
  const dir = paths.instanceDir(id);
  if (!exists(dir)) return false;
  if (keepFiles) {
    const target = paths.join('trash', `${id}-${Date.now()}`);
    ensureDir(paths.join('trash'));
    try {
      fs.renameSync(dir, target);
    } catch (error) {
      // Папку держит игра или антивирус: пробуем удалить на месте, иначе сообщаем причину.
      unlinkQuiet(dir);
      if (exists(dir)) throw error;
    }
  } else {
    unlinkQuiet(dir);
    if (exists(dir)) throw new Error('Не удалось удалить файлы сборки');
  }
  return true;
}

function deleteInstances(ids, keepFiles = true) {
  const removed = [];
  const failed = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      if (deleteInstance(id, keepFiles)) removed.push(id);
      else failed.push({ id, reason: 'Папка сборки не найдена' });
    } catch (error) {
      failed.push({ id, reason: (error && error.message) || String(error) });
    }
  }
  return { removed, failed };
}

function restoreFromTrash() {
  const trashDir = paths.join('trash');
  if (!exists(trashDir)) return [];
  const restored = [];
  for (const entry of fs.readdirSync(trashDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source = path.join(trashDir, entry.name);
    if (!exists(path.join(source, 'instance.json'))) continue;
    const base = entry.name.replace(/-\d{10,}$/, '');
    const target = paths.instanceDir(base);
    if (exists(target)) continue;
    try {
      fs.renameSync(source, target);
      const instance = readInstance(base);
      if (instance) restored.push({ id: base, name: instance.name });
    } catch {
      /* папку держит игра или антивирус — оставляем в корзине */
    }
  }
  return restored;
}

function duplicateInstance(id) {
  const source = readInstance(id);
  if (!source) throw new Error('Сборка не найдена');
  const copy = createInstance({
    name: `${source.name} (копия)`,
    mcVersion: source.mcVersion,
    loader: { ...source.loader },
    cover: source.cover,
    modpack: source.modpack,
  });
  const from = paths.instanceGameDir(id);
  const to = paths.instanceGameDir(copy.id);
  for (const folder of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves']) {
    const src = path.join(from, folder);
    if (isDir(src)) {
      fs.cpSync(src, path.join(to, folder), { recursive: true });
    }
  }
  return copy;
}

async function fabricVersions(mcVersion) {
  try {
    const list = await net.fetchJson(`${FABRIC_META}/versions/loader/${encodeURIComponent(mcVersion)}`);
    return (list || []).map((item) => ({
      version: item.loader.version,
      stable: item.loader.stable,
      label: `Fabric ${item.loader.version}`,
    }));
  } catch {
    return [];
  }
}

async function quiltVersions(mcVersion) {
  try {
    const list = await net.fetchJson(`${QUILT_META}/versions/loader/${encodeURIComponent(mcVersion)}`);
    return (list || []).map((item) => ({ version: item.loader.version, stable: true, label: `Quilt ${item.loader.version}` }));
  } catch {
    return [];
  }
}

async function forgeVersions(mcVersion) {
  try {
    const promos = await net.fetchJson(FORGE_PROMOS);
    const result = [];
    for (const [key, value] of Object.entries(promos.promos || {})) {
      if (!key.startsWith(`${mcVersion}-`)) continue;
      result.push({ version: value, channel: key.replace(`${mcVersion}-`, ''), label: `Forge ${value}` });
    }
    const seen = new Set();
    return result.filter((item) => (seen.has(item.version) ? false : (seen.add(item.version), true)));
  } catch {
    return [];
  }
}

async function neoforgeVersions(mcVersion) {
  try {
    const xml = await net.fetchText(`${NEOFORGE_MAVEN}/maven-metadata.xml`);
    const prefix = mcVersion.split('.').slice(1).join('.');
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
    return versions
      .filter((v) => v.startsWith(`${prefix}.`))
      .reverse()
      .slice(0, 30)
      .map((v) => ({ version: v, stable: !v.includes('-'), label: `NeoForge ${v}` }));
  } catch {
    return [];
  }
}

async function loaderVersions(type, mcVersion) {
  switch (type) {
    case 'fabric':
      return fabricVersions(mcVersion);
    case 'quilt':
      return quiltVersions(mcVersion);
    case 'forge':
      return forgeVersions(mcVersion);
    case 'neoforge':
      return neoforgeVersions(mcVersion);
    default:
      return [];
  }
}

function writeLauncherProfiles() {
  const file = paths.join('launcher_profiles.json');
  if (exists(file)) return file;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        profiles: {},
        settings: { enableSnapshots: false, keepLauncherOpen: false },
        version: 3,
      },
      null,
      2,
    ),
    'utf8',
  );
  return file;
}

function runJava(javaPath, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(javaPath, args, { windowsHide: true });
    let output = '';
    const append = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (output.length > 200000) output = output.slice(-100000);
      if (options.onLog) options.onLog(text);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timer = setTimeout(() => {
      if (options.onLog) options.onLog('\n[таймаут установщика]\n');
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, options.timeout || 15 * 60 * 1000);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, output, error });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

async function defaultLoaderVersion(type, mcVersion) {
  const list = await loaderVersions(type, mcVersion);
  if (!list.length) {
    throw new Error(`Нет версий ${type} для Minecraft ${mcVersion}. Выберите другую версию игры.`);
  }
  const recommended = list.find((item) => item.channel === 'recommended');
  const stable = list.find((item) => item.stable !== false);
  return (recommended || stable || list[0]).version;
}

async function installForgeLike(instance, onProgress) {
  const isNeo = instance.loader.type === 'neoforge';
  const mcVersion = instance.mcVersion;
  const loaderVersion = instance.loader.version || (await defaultLoaderVersion(instance.loader.type, mcVersion));
  instance.loader.version = loaderVersion;

  const baseVersion = await mojang.getVersionJson(mcVersion);
  const javaMajor = (baseVersion.javaVersion && baseVersion.javaVersion.majorVersion) || 17;
  const javaInfo = await java.ensureJava(javaMajor);
  const javaPath = javaInfo.path === 'java.exe (PATH)' ? 'java.exe' : javaInfo.path;

  const fileName = isNeo
    ? `neoforge-${loaderVersion}-installer.jar`
    : `forge-${mcVersion}-${loaderVersion}-installer.jar`;
  const url = isNeo
    ? `${NEOFORGE_MAVEN}/${loaderVersion}/${fileName}`
    : `${FORGE_MAVEN}/${mcVersion}-${loaderVersion}/${fileName}`;
  const installer = path.join(paths.cache(), fileName);

  onProgress({ stage: 'loader', percent: 5, detail: `Скачиваю установщик ${fileName}` });
  await net.downloadFile(url, installer, { retries: 2, timeout: 300000 });

  writeLauncherProfiles();
  const before = new Set(fs.existsSync(paths.versions()) ? fs.readdirSync(paths.versions()) : []);

  onProgress({ stage: 'loader', percent: 15, detail: 'Устанавливаю загрузчик (2–5 минут)' });
  const result = await runJava(javaPath, ['-jar', installer, '--installClient', paths.root()], {
    onLog: (text) => {
      const line = text.trim().split('\n').pop();
      if (line) onProgress({ stage: 'loader', percent: 30, detail: line.slice(0, 120) });
    },
  });
  if (result.code !== 0) {
    throw new Error(`Установщик завершился с кодом ${result.code}. Проверьте папку logs.`);
  }

  const after = fs.readdirSync(paths.versions());
  const created = after.filter((dir) => !before.has(dir));
  const candidates = [];
  for (const dir of [...after]) {
    const jsonPath = path.join(paths.versions(), dir, `${dir}.json`);
    if (!exists(jsonPath)) continue;
    try {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      const main = String(json.mainClass || '').toLowerCase();
      if ((isNeo && (main.includes('neoforge') || /neoforge/i.test(dir))) ||
          (!isNeo && (main.includes('forge') || /forge/i.test(dir)))) {
        if (json.inheritsFrom === mcVersion || dir.includes(mcVersion)) {
          candidates.push({ dir, created: created.includes(dir) });
        }
      }
    } catch {
      /* ignore */
    }
  }
  const chosen = candidates.find((c) => c.created) || candidates[candidates.length - 1];
  if (!chosen) throw new Error('Установщик отработал, но версия загрузчика не найдена');
  return chosen.dir;
}

async function installFabricLike(instance, onProgress) {
  const type = instance.loader.type;
  const mcVersion = instance.mcVersion;
  const loaderVersion = instance.loader.version || (await defaultLoaderVersion(type, mcVersion));
  instance.loader.version = loaderVersion;
  const base = type === 'quilt' ? QUILT_META : FABRIC_META;
  onProgress({ stage: 'loader', percent: 10, detail: 'Запрашиваю профиль загрузчика' });
  const url = `${base}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const profile = await net.fetchJson(url, { timeout: 30000 });
  const id = profile.id;
  const dest = path.join(paths.versions(), id, `${id}.json`);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, JSON.stringify(profile, null, 2));
  onProgress({ stage: 'loader', percent: 30, detail: 'Профиль загрузчика готов' });
  return id;
}

async function ensureProfile(instance, onProgress = () => {}, options = {}) {
  const type = instance.loader.type || 'vanilla';
  let profileVersion = instance.mcVersion;

  if (type === 'fabric' || type === 'quilt') {
    profileVersion = instance.loader.profileId || (await installFabricLike(instance, onProgress));
  } else if (type === 'forge' || type === 'neoforge') {
    profileVersion = instance.loader.profileId || (await installForgeLike(instance, onProgress));
  }

  await mojang.installVersion(profileVersion, {
    onProgress,
    gameDir: paths.instanceGameDir(instance.id),
    verify: Boolean(options.verify),
  });
  if (!instance.loader.profileId && profileVersion !== instance.mcVersion) {
    instance.loader.profileId = profileVersion;
    updateInstance(instance.id, { loader: instance.loader });
  }
  return profileVersion;
}

function instanceSize(id) {
  let total = 0;
  const walk = (dir) => {
    if (!exists(dir)) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          total += fs.statSync(full).size;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(paths.instanceGameDir(id));
  return total;
}

const PACK_FORMAT = 1;

function exportInstance(id, destPath, options = {}) {
  const instance = readInstance(id);
  if (!instance) throw new Error('Сборка не найдена');
  const dir = paths.instanceGameDir(id);
  const skip = ['logs', 'crash-reports', 'screenshots', 'natives'];
  if (!options.withSaves) skip.push('saves');

  const files = zipwrite.collectFiles(dir, { skip });
  const entries = [];
  for (const file of files) {
    if (file.name === 'instance.json') continue;
    if (file.name.startsWith('.')) continue;
    entries.push({ name: file.name, path: file.path });
  }

  const manifest = {
    format: PACK_FORMAT,
    app: 'KubikLauncher',
    createdAt: new Date().toISOString(),
    name: instance.name,
    mcVersion: instance.mcVersion,
    loader: instance.loader,
    memoryMB: instance.memoryMB,
    cover: instance.cover,
    jvmArgs: instance.jvmArgs || '',
    files: entries.length,
  };
  entries.unshift({
    name: '.kubik-pack.json',
    data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    compress: true,
  });

  const result = zipwrite.create(destPath, entries);
  return { path: destPath, files: entries.length, bytes: result.bytes, withSaves: Boolean(options.withSaves) };
}

function importInstance(zipPath) {
  const temp = path.join(paths.cache(), `import-${Date.now().toString(36)}`);
  ensureDir(temp);
  try {
    zip.extract(zipPath, temp);
    let manifest = null;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(temp, '.kubik-pack.json'), 'utf8'));
    } catch {
      manifest = null;
    }
    const rawName = String((manifest && manifest.name) || path.basename(zipPath, path.extname(zipPath)) || 'Сборка');
    const instance = createInstance({
      name: `${rawName.slice(0, 40)} (импорт)`,
      mcVersion: (manifest && manifest.mcVersion) || '1.21.1',
      loader: (manifest && manifest.loader) || { type: 'vanilla', version: null },
      memoryMB: (manifest && manifest.memoryMB) || undefined,
      cover: (manifest && manifest.cover) || undefined,
    });
    const target = paths.instanceGameDir(instance.id);
    const copyInto = (from, to) => {
      let entries = [];
      try {
        entries = fs.readdirSync(from, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === '.kubik-pack.json' || entry.name === 'instance.json') continue;
        const source = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        try {
          if (entry.isDirectory()) {
            ensureDir(dest);
            copyInto(source, dest);
          } else {
            fs.copyFileSync(source, dest);
          }
        } catch {
          /* пропускаем нечитаемое */
        }
      }
    };
    copyInto(temp, target);
    if (manifest && manifest.jvmArgs) {
      instance.jvmArgs = String(manifest.jvmArgs).slice(0, 500);
      writeInstance(instance);
    }
    return instance;
  } finally {
    unlinkQuiet(temp);
  }
}

module.exports = {
  COVERS,
  listInstances,
  readInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  deleteInstances,
  restoreFromTrash,
  duplicateInstance,
  ensureProfile,
  loaderVersions,
  ensureGameDirs,
  instanceSize,
  exportInstance,
  importInstance,
  writeInstance,
};
