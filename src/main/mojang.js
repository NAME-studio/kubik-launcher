'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const net = require('./net');
const store = require('./store');
const zip = require('./zip');
const {
  ensureDir,
  exists,
  sizeOf,
  sha1File,
  sha1Buffer,
  isAllowed,
  parseMaven,
  mavenPath,
  libraryKey,
  unlinkQuiet,
  formatBytes,
} = require('./util');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const ASSET_BASE = 'https://resources.download.minecraft.net';
const LIBRARY_BASE = 'https://libraries.minecraft.net';

let manifestCache = null;
let manifestTime = 0;
const versionCache = new Map();

async function getManifest(force = false) {
  if (manifestCache && !force && Date.now() - manifestTime < 10 * 60 * 1000) return manifestCache;
  const cacheFile = path.join(paths.cache(), 'version_manifest_v2.json');
  const readCache = () => {
    try {
      manifestCache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      manifestTime = Date.now();
      return manifestCache;
    } catch {
      manifestCache = null;
      manifestTime = 0;
      try {
        fs.unlinkSync(cacheFile);
      } catch {
        /* ignore */
      }
      return null;
    }
  };
  if (!force && exists(cacheFile)) {
    try {
      if (Date.now() - fs.statSync(cacheFile).mtimeMs < 10 * 60 * 1000) {
        const cached = readCache();
        if (cached) return cached;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const manifest = await net.fetchJson(MANIFEST_URL, { timeout: exists(cacheFile) ? 12000 : 30000 });
    ensureDir(paths.cache());
    fs.writeFileSync(cacheFile, JSON.stringify(manifest));
    manifestCache = manifest;
    manifestTime = Date.now();
    return manifest;
  } catch (error) {
    const cached = readCache();
    if (cached) return cached;
    throw error;
  }
}

async function getVersionJson(id) {
  const local = path.join(paths.versions(), id, `${id}.json`);
  if (exists(local)) {
    try {
      return JSON.parse(fs.readFileSync(local, 'utf8'));
    } catch {
      unlinkQuiet(local);
    }
  }
  const manifest = await getManifest();
  const entry = manifest.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Версия ${id} отсутствует в списке Mojang`);
  const json = await net.fetchJson(entry.url, { timeout: 30000 });
  ensureDir(path.dirname(local));
  fs.writeFileSync(local, JSON.stringify(json, null, 2));
  return json;
}

function readLocalVersionJson(id) {
  const local = path.join(paths.versions(), id, `${id}.json`);
  if (!exists(local)) return null;
  try {
    return JSON.parse(fs.readFileSync(local, 'utf8'));
  } catch {
    return null;
  }
}

async function resolveVersion(id) {
  const cacheKey = path.join(paths.versions(), id, `${id}.json`);
  let stamp = 0;
  try {
    stamp = fs.statSync(cacheKey).mtimeMs;
  } catch {
    stamp = 0;
  }
  const cached = versionCache.get(id);
  if (cached && cached.stamp === stamp) return cached.version;

  const chain = [];
  let current = await getVersionJson(id);
  chain.push(current);
  const guard = new Set([id]);
  while (current.inheritsFrom && !guard.has(current.inheritsFrom)) {
    current = await getVersionJson(current.inheritsFrom);
    guard.add(current.id);
    chain.push(current);
  }

  const child = chain[0];
  const base = chain[chain.length - 1];
  const merged = JSON.parse(JSON.stringify(base));

  merged.id = id;
  merged.type = child.type || base.type;
  merged.releaseTime = child.releaseTime || base.releaseTime;
  merged.time = child.time || base.time;
  merged.mainClass = child.mainClass || base.mainClass;
  merged.assetIndex = child.assetIndex || base.assetIndex;
  merged.assets = child.assets || base.assets;
  merged.assetsMapToResources = Boolean(child.assetIndex?.map_to_resources || base.assetIndex?.map_to_resources);
  merged.assetsVirtual = Boolean(child.assetIndex?.virtual || base.assetIndex?.virtual);
  merged.downloads = { ...(base.downloads || {}), ...(child.downloads || {}) };
  merged.javaVersion = child.javaVersion || base.javaVersion;
  merged.logging = child.logging || base.logging;
  merged.minimumLauncherVersion = child.minimumLauncherVersion || base.minimumLauncherVersion || 0;
  merged.inheritsFrom = child.inheritsFrom;

  const libraries = [];
  const seen = new Set();
  for (const lib of [...(child.libraries || []), ...(base.libraries || [])]) {
    const key = lib.name ? libraryKey(lib.name) : JSON.stringify(lib);
    if (seen.has(key)) continue;
    seen.add(key);
    libraries.push(lib);
  }
  merged.libraries = libraries;

  const baseArgs = base.arguments || {};
  const childArgs = child.arguments || {};
  if (chain.length > 1) {
    merged.arguments = {
      game: [...(baseArgs.game || []), ...(childArgs.game || [])],
      jvm: [...(baseArgs.jvm || []), ...(childArgs.jvm || [])],
    };
  } else {
    merged.arguments = {
      game: [...(childArgs.game || [])],
      jvm: [...(childArgs.jvm || [])],
    };
  }
  merged.minecraftArguments = child.minecraftArguments || base.minecraftArguments || null;

  let clientJarVersion = null;
  for (const version of chain) {
    if (version.downloads && version.downloads.client) {
      clientJarVersion = version.id;
      break;
    }
  }
  merged.clientJarVersion = clientJarVersion;
  merged.chain = chain.map((v) => v.id);
  versionCache.set(id, { stamp, version: merged });
  return merged;
}

function libraryArtifact(lib) {
  if (lib.downloads && lib.downloads.artifact) {
    const art = lib.downloads.artifact;
    return {
      path: art.path || mavenPath(lib.name),
      url: art.url,
      sha1: art.sha1,
      size: art.size,
    };
  }
  const baseUrl = (lib.url || LIBRARY_BASE).replace(/\/?$/, '/');
  const relative = mavenPath(lib.name);
  return { path: relative, url: baseUrl + relative, sha1: null, size: null };
}

function nativeClassifier(lib) {
  if (!lib.natives) return null;
  const key = lib.natives.windows || lib.natives.windows_64 || lib.natives['windows-64'];
  if (!key) return null;
  return key.replace('${arch}', '64');
}

function nativeDownload(lib, classifier) {
  const downloads = lib.downloads || {};
  if (downloads.classifiers && downloads.classifiers[classifier]) {
    const cls = downloads.classifiers[classifier];
    return { path: cls.path, url: cls.url, sha1: cls.sha1, size: cls.size };
  }
  const parsed = parseMaven(lib.name);
  const name = `${parsed.group}:${parsed.artifact}:${parsed.version}:${classifier}`;
  const relative = mavenPath(name);
  const baseUrl = (lib.url || LIBRARY_BASE).replace(/\/?$/, '/');
  return { path: relative, url: baseUrl + relative, sha1: null, size: null };
}

function extractNatives(archivePath, targetDir, extractRules) {
  const excludes = (extractRules && extractRules.exclude) || ['META-INF/'];
  ensureDir(targetDir);
  const isExcluded = (name) => {
    if (name.endsWith('/')) return true;
    return excludes.some((pattern) => {
      if (pattern.endsWith('/')) return name.startsWith(pattern);
      return name === pattern;
    });
  };
  zip.extract(archivePath, targetDir, { filter: (name) => !isExcluded(name) });
}

function markerPath(versionId) {
  return path.join(paths.versions(), versionId, '.kubik-install.json');
}

function assetsSignature() {
  const base = paths.assetsObjects();
  if (!exists(base)) return 'none';
  let buckets = [];
  try {
    buckets = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return 'none';
  }
  const parts = [];
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    try {
      const stat = fs.statSync(path.join(base, bucket.name));
      parts.push(`${bucket.name}:${Math.round(stat.mtimeMs)}`);
    } catch {
      /* пропускаем */
    }
  }
  parts.sort();
  return `${parts.length}|${sha1Buffer(Buffer.from(parts.join(';'), 'utf8'))}`;
}

function readMarker(versionId) {
  try {
    return JSON.parse(fs.readFileSync(markerPath(versionId), 'utf8'));
  } catch {
    return null;
  }
}

function writeMarker(versionId, data) {
  try {
    ensureDir(path.dirname(markerPath(versionId)));
    fs.writeFileSync(markerPath(versionId), JSON.stringify({ ...data, at: Date.now() }), 'utf8');
  } catch {
    /* маркер не критичен */
  }
}

function nativesPresent(versionId) {
  const dir = path.join(paths.versions(), versionId, 'natives');
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

function quickInstallState(version) {
  const marker = readMarker(version.id);
  if (!marker) return { ok: false, reason: 'нет метки установки' };
  const indexId = version.assetIndex ? version.assetIndex.id : null;
  if ((marker.assetIndexId || null) !== indexId) return { ok: false, reason: 'сменился индекс ресурсов' };
  if (version.clientJarVersion) {
    const jar = path.join(paths.versions(), version.clientJarVersion, `${version.clientJarVersion}.jar`);
    if (!exists(jar) || sizeOf(jar) <= 0) return { ok: false, reason: 'нет client.jar' };
  }
  const needsNatives = (version.libraries || []).some((lib) => {
    const classifier = nativeClassifier(lib);
    return Boolean(classifier) || Boolean(lib.natives);
  });
  if (needsNatives && !nativesPresent(version.id)) return { ok: false, reason: 'нет нативных библиотек' };
  if (version.logging && version.logging.client && version.logging.client.file) {
    const logFile = path.join(paths.assets(), 'log_configs', version.logging.client.file.id);
    if (!exists(logFile)) return { ok: false, reason: 'нет log4j-конфига' };
  }
  if (version.assetIndex) {
    const indexFile = path.join(paths.assetsIndexes(), `${version.assetIndex.id}.json`);
    if (!exists(indexFile)) return { ok: false, reason: 'нет индекса ресурсов' };
    if (marker.assetsSignature !== assetsSignature()) {
      return { ok: false, reason: 'ресурсы изменились' };
    }
  }
  return { ok: true, marker };
}

async function installVersion(versionId, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const settings = store.getSettings();
  const concurrency = Math.max(4, Math.min(32, settings.downloadThreads || 12));

  onProgress({ stage: 'resolve', percent: 0, detail: 'Читаю описание версии' });
  const version = await resolveVersion(versionId);

  if (!options.verify) {
    const quick = quickInstallState(version);
    if (quick.ok) {
      onProgress({ stage: 'done', percent: 100, detail: 'Файлы на месте' });
      return {
        id: version.id,
        javaMajor: (version.javaVersion && version.javaVersion.majorVersion) || 8,
        assetsIndex: version.assetIndex ? version.assetIndex.id : null,
        classpathEntries: [],
        mainClass: version.mainClass,
        instant: true,
      };
    }
  }

  const tasks = [];
  const nativeJobs = [];

  if (version.clientJarVersion) {
    const clientJson = await getVersionJson(version.clientJarVersion);
    const client = clientJson.downloads && clientJson.downloads.client;
    if (client) {
      tasks.push({
        url: client.url,
        dest: path.join(paths.versions(), version.clientJarVersion, `${version.clientJarVersion}.jar`),
        sha1: client.sha1,
        size: client.size,
        label: 'client.jar',
      });
    }
  } else {
    throw new Error('У версии нет клиентского jar-файла');
  }

  const features = { is_demo_user: false, has_custom_resolution: false };
  const classpathEntries = [];

  for (const lib of version.libraries) {
    if (!isAllowed(lib.rules, features)) continue;
    const classifier = nativeClassifier(lib);
    const nativesOnly = classifier && !(lib.downloads && lib.downloads.artifact);
    const artifact = libraryArtifact(lib);
    if (!nativesOnly && artifact.url) {
      tasks.push({
        url: artifact.url,
        dest: path.join(paths.libraries(), artifact.path),
        sha1: artifact.sha1,
        size: artifact.size,
        label: lib.name,
      });
      classpathEntries.push(path.join(paths.libraries(), artifact.path));
    }
    if (classifier) {
      const nativeArt = nativeDownload(lib, classifier);
      tasks.push({
        url: nativeArt.url,
        dest: path.join(paths.libraries(), nativeArt.path),
        sha1: nativeArt.sha1,
        size: nativeArt.size,
        label: `${lib.name}:${classifier}`,
      });
      nativeJobs.push({ archive: path.join(paths.libraries(), nativeArt.path), extract: lib.extract });
    }
  }

  if (version.logging && version.logging.client && version.logging.client.file) {
    const logFile = version.logging.client.file;
    tasks.push({
      url: logFile.url,
      dest: path.join(paths.assets(), 'log_configs', logFile.id),
      sha1: logFile.sha1,
      size: logFile.size,
      label: 'log4j config',
    });
  }

  onProgress({
    stage: 'libraries',
    percent: 2,
    detail: `Библиотеки: ${tasks.length} файлов`,
  });

  let completed = 0;
  const totalTasks = tasks.length;
  await net.pool(
    tasks,
    concurrency,
    async (task) => {
      await net.downloadFile(task.url, task.dest, { sha1: task.sha1, size: task.size });
    },
    (done) => {
      completed = done;
      onProgress({
        stage: 'libraries',
        percent: 2 + Math.round((done / Math.max(1, totalTasks)) * 40),
        detail: `Библиотеки ${done}/${totalTasks}`,
      });
    },
  );
  completed = totalTasks;

  const nativesDir = path.join(paths.versions(), version.id, 'natives');
  unlinkQuiet(nativesDir);
  ensureDir(nativesDir);
  for (const job of nativeJobs) {
    if (exists(job.archive)) {
      try {
        extractNatives(job.archive, nativesDir, job.extract);
      } catch (error) {
        console.warn('natives', job.archive, error.message);
      }
    }
  }

  if (version.assetIndex) {
    const index = version.assetIndex;
    const indexDest = path.join(paths.assetsIndexes(), `${index.id}.json`);
    await net.downloadFile(index.url, indexDest, { sha1: index.sha1, size: index.size });
    const indexJson = JSON.parse(fs.readFileSync(indexDest, 'utf8'));
    const entries = Object.entries(indexJson.objects || {});
    const objectTasks = entries.map(([name, obj]) => ({
      name,
      hash: obj.hash,
      size: obj.size,
      url: `${ASSET_BASE}/${obj.hash.slice(0, 2)}/${obj.hash}`,
      dest: path.join(paths.assetsObjects(), obj.hash.slice(0, 2), obj.hash),
    }));

    onProgress({ stage: 'assets', percent: 42, detail: `Ресурсы: ${objectTasks.length} файлов` });
    let downloadedBytes = 0;
    await net.pool(
      objectTasks,
      Math.max(8, concurrency),
      async (task) => {
        const result = await net.downloadFile(task.url, task.dest, { sha1: task.hash, size: task.size });
        if (!result.skipped) downloadedBytes += task.size || 0;
      },
      (done) => {
        onProgress({
          stage: 'assets',
          percent: 42 + Math.round((done / Math.max(1, objectTasks.length)) * 53),
          detail: `Ресурсы ${done}/${objectTasks.length} • ${formatBytes(downloadedBytes)}`,
        });
      },
    );

    if (indexJson.virtual || indexJson.map_to_resources) {
      const virtualDir = path.join(paths.assetsVirtual(), indexJson.id || index.id);
      onProgress({ stage: 'assets', percent: 96, detail: 'Готовлю legacy-ресурсы' });
      ensureDir(virtualDir);
      const resourcesDir = indexJson.map_to_resources && options.gameDir
        ? ensureDir(path.join(options.gameDir, 'resources'))
        : null;
      for (const task of objectTasks) {
        const target = path.join(virtualDir, task.name);
        if (!exists(target)) {
          ensureDir(path.dirname(target));
          try {
            fs.copyFileSync(task.dest, target);
          } catch {
            /* ignore */
          }
        }
        if (resourcesDir) {
          const resourceTarget = path.join(resourcesDir, task.name);
          if (!exists(resourceTarget)) {
            ensureDir(path.dirname(resourceTarget));
            try {
              fs.copyFileSync(task.dest, resourceTarget);
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  const stats = version.assetIndex ? { signature: assetsSignature() } : { signature: 'none' };
  writeMarker(version.id, {
    versionId: version.id,
    assetIndexId: version.assetIndex ? version.assetIndex.id : null,
    assetsSignature: stats.signature,
  });

  onProgress({ stage: 'done', percent: 100, detail: 'Версия установлена' });
  return {
    id: version.id,
    javaMajor: (version.javaVersion && version.javaVersion.majorVersion) || 8,
    assetsIndex: version.assetIndex ? version.assetIndex.id : null,
    classpathEntries,
    mainClass: version.mainClass,
  };
}

function isVersionInstalled(id) {
  const jarId = id;
  const json = readLocalVersionJson(id);
  if (!json) return false;
  const jarVersion = json.downloads && json.downloads.client ? id : json.inheritsFrom;
  const jarPath = path.join(paths.versions(), jarVersion || id, `${jarVersion || id}.jar`);
  return exists(jarPath);
}

async function installedVersions() {
  const result = [];
  if (!exists(paths.versions())) return result;
  for (const entry of fs.readdirSync(paths.versions(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(paths.versions(), entry.name, `${entry.name}.json`);
    if (!exists(jsonPath)) continue;
    const jarPath = path.join(paths.versions(), entry.name, `${entry.name}.jar`);
    let json = null;
    try {
      json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      continue;
    }
    result.push({
      id: entry.name,
      type: json.type || 'unknown',
      inheritsFrom: json.inheritsFrom || null,
      hasJar: exists(jarPath),
      size: isDirSize(path.join(paths.versions(), entry.name)),
    });
  }
  return result;
}

function isDirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += isDirSize(full);
      else total += sizeOf(full) || 0;
    }
  } catch {
    /* ignore */
  }
  return total;
}

module.exports = {
  getManifest,
  getVersionJson,
  resolveVersion,
  installVersion,
  isVersionInstalled,
  installedVersions,
  readLocalVersionJson,
  installState: async (id) => quickInstallState(await resolveVersion(id)),
  assetsSignature,
};
