'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const net = require('./net');
const store = require('./store');
const instances = require('./instances');
const zip = require('./zip');
const curseforge = require('./curseforge');
const { ensureDir } = require('./util');

function detect(archive) {
  try {
    if (zip.readJson(archive, 'modrinth.index.json')) return 'mrpack';
  } catch {
    /* не mrpack */
  }
  try {
    const manifest = zip.readJson(archive, 'manifest.json');
    if (manifest && (manifest.manifestType === 'minecraftModpack' || (manifest.minecraft && manifest.files))) {
      return 'curse';
    }
  } catch {
    /* не модпак CurseForge */
  }
  return null;
}

function loaderFromDeps(deps) {
  if (deps['fabric-loader']) return { type: 'fabric', version: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { type: 'quilt', version: deps['quilt-loader'] };
  if (deps.neoforge) return { type: 'neoforge', version: deps.neoforge };
  if (deps.forge) return { type: 'forge', version: deps.forge };
  return { type: 'vanilla', version: null };
}

function loaderFromManifest(manifest) {
  const loaders = (manifest.minecraft && manifest.minecraft.modLoaders) || [];
  const entry = loaders.find((item) => item.primary) || loaders[0];
  if (!entry) return { type: 'vanilla', version: null };
  const match = String(entry.id || '').match(/^(forge|fabric|quilt|neoforge)-(.+)$/i);
  if (!match) return { type: 'vanilla', version: null };
  return { type: match[1].toLowerCase(), version: match[2] };
}

function readContent(instanceId) {
  try {
    return JSON.parse(fs.readFileSync(paths.instanceContent(instanceId), 'utf8'));
  } catch {
    return { items: [] };
  }
}

function writeContent(instanceId, data) {
  const file = paths.instanceContent(instanceId);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function addPackItems(instanceId, entries) {
  const content = readContent(instanceId);
  content.items = (content.items || []).concat(entries);
  writeContent(instanceId, content);
}

async function downloadFiles(gameDir, entries, onProgress, concurrency) {
  const failures = [];
  let done = 0;
  await net.pool(
    entries,
    concurrency,
    async (entry) => {
      const target = zip.safeJoin(gameDir, entry.path);
      if (!target) {
        failures.push({ path: entry.path, error: 'Недопустимый путь в манифесте' });
        return;
      }
      ensureDir(path.dirname(target));
      try {
        await net.downloadFile(entry.url, target, {
          sha1: entry.sha1,
          size: entry.size,
          timeout: 300000,
        });
      } catch (error) {
        failures.push({ path: entry.path, error: error.message });
      }
    },
    (count) => {
      done = count;
      onProgress({
        stage: 'pack',
        percent: 10 + Math.round((done / Math.max(1, entries.length)) * 74),
        detail: `Файлы ${done}/${entries.length}`,
      });
    },
  );
  return failures;
}

async function importMrpack(archive, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const index = zip.readJson(archive, 'modrinth.index.json');
  if (!index) throw new Error('В архиве нет modrinth.index.json');
  const deps = index.dependencies || {};
  const mcVersion = deps.minecraft || '1.21.1';
  const loader = loaderFromDeps(deps);
  const fallbackName = path.basename(archive, path.extname(archive));

  const instance = instances.createInstance({
    name: options.name || index.name || fallbackName,
    mcVersion,
    loader,
    cover: 'autumn',
    modpack: {
      projectId: `mrpack:${path.basename(archive)}`,
      versionId: '',
      versionNumber: index.versionId || '',
      title: index.name || fallbackName,
      icon: null,
      summary: index.summary || '',
      filename: path.basename(archive),
    },
  });

  const gameDir = paths.instanceGameDir(instance.id);
  instances.ensureGameDirs(gameDir);

  const files = (index.files || []).filter((entry) => !entry.env || entry.env.client !== 'unsupported');
  onProgress({ stage: 'pack', percent: 8, detail: `Файлы модпака: ${files.length}` });

  const entries = files
    .filter((entry) => Array.isArray(entry.downloads) && entry.downloads.length)
    .map((entry) => ({
      path: entry.path,
      url: entry.downloads[0],
      sha1: entry.hashes && entry.hashes.sha1,
      size: entry.fileSize,
    }));

  const concurrency = Math.max(4, Math.min(16, store.getSettings().downloadThreads || 8));
  const failures = await downloadFiles(gameDir, entries, onProgress, concurrency);

  onProgress({ stage: 'pack', percent: 88, detail: 'Распаковываю overrides' });
  for (const folder of ['overrides', 'client-overrides']) {
    try {
      zip.extract(archive, gameDir, { prefix: `${folder}/` });
    } catch {
      /* в паке может не быть overrides */
    }
  }

  addPackItems(
    instance.id,
    files.map((entry) => ({
      projectId: `mrpack:${entry.path}`,
      slug: '',
      title: path.basename(entry.path),
      icon: null,
      versionId: '',
      versionNumber: '',
      projectType: entry.path.startsWith('resourcepacks')
        ? 'resourcepack'
        : entry.path.startsWith('shaderpacks')
          ? 'shader'
          : 'mod',
      filename: path.basename(entry.path),
      folder: path.dirname(entry.path),
      size: entry.fileSize,
      installedAt: Date.now(),
      disabled: false,
      fromModpack: true,
    })),
  );

  onProgress({ stage: 'done', percent: 100, detail: 'Модпак установлен' });
  return { instance, kind: 'mrpack', fileCount: entries.length, failures };
}

async function importCurse(archive, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const manifest = zip.readJson(archive, 'manifest.json');
  if (!manifest) throw new Error('В архиве нет manifest.json');
  const fallbackName = path.basename(archive, path.extname(archive));
  const mcVersion = (manifest.minecraft && manifest.minecraft.version) || '1.21.1';
  const loader = loaderFromManifest(manifest);

  const instance = instances.createInstance({
    name: options.name || manifest.name || fallbackName,
    mcVersion,
    loader,
    cover: 'autumn',
    modpack: {
      projectId: `cfpack:${path.basename(archive)}`,
      versionId: '',
      versionNumber: manifest.version || '',
      title: manifest.name || fallbackName,
      icon: null,
      summary: '',
      filename: path.basename(archive),
    },
  });

  const gameDir = paths.instanceGameDir(instance.id);
  instances.ensureGameDirs(gameDir);

  const sources = (manifest.files || []).filter((entry) => entry.required !== false);
  onProgress({ stage: 'pack', percent: 8, detail: `Файлы модпака: ${sources.length}` });

  const failures = [];
  const entries = [];
  for (const entry of sources) {
    try {
      const file = await curseforge.fileByIds(entry.projectID, entry.fileID);
      entries.push({
        projectID: entry.projectID,
        fileID: entry.fileID,
        path: path.join('mods', path.basename(String(file.fileName || `${entry.projectID}.jar`).replace(/[<>:"/\\|?*]/g, '_'))),
        url: file.downloadUrl,
        size: file.fileLength,
      });
    } catch (error) {
      failures.push({ path: `mods/${entry.projectID}`, error: error.message });
    }
  }

  const concurrency = Math.max(4, Math.min(16, store.getSettings().downloadThreads || 8));
  const downloadFailures = await downloadFiles(gameDir, entries, onProgress, concurrency);
  failures.push(...downloadFailures);

  onProgress({ stage: 'pack', percent: 88, detail: 'Распаковываю overrides' });
  // manifest.overrides приходит из архива: пускаем только обычную относительную папку.
  const overridesDir = String(manifest.overrides || 'overrides').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const safeOverrides = /^[\w.\- ]+(\/[\w.\- ]+)*$/.test(overridesDir) && !overridesDir.includes('..')
    ? overridesDir
    : 'overrides';
  try {
    zip.extract(archive, gameDir, { prefix: `${safeOverrides}/` });
  } catch {
    /* в паке может не быть overrides */
  }

  addPackItems(
    instance.id,
    entries.map((entry) => ({
      projectId: `cfpack:${entry.projectID}:${entry.fileID}`,
      slug: '',
      title: path.basename(entry.path),
      icon: null,
      versionId: String(entry.fileID),
      versionNumber: '',
      projectType: 'mod',
      filename: path.basename(entry.path),
      folder: 'mods',
      size: entry.size,
      installedAt: Date.now(),
      disabled: false,
      fromModpack: true,
    })),
  );

  onProgress({ stage: 'done', percent: 100, detail: 'Модпак установлен' });
  return { instance, kind: 'curse', fileCount: entries.length, failures };
}

async function importFile(archive, options = {}) {
  const kind = detect(archive);
  if (kind === 'mrpack') return importMrpack(archive, options);
  if (kind === 'curse') return importCurse(archive, options);
  return null;
}

module.exports = { detect, importFile, importMrpack, importCurse };
