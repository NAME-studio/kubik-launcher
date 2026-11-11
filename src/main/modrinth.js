'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const net = require('./net');
const store = require('./store');
const instances = require('./instances');
const zip = require('./zip');
const { ensureDir, exists, unlinkQuiet, formatBytes } = require('./util');

const API = 'https://api.modrinth.com/v2';
const FOLDERS = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
  map: 'datapacks',
  plugin: 'plugins',
};

function headers() {
  return {
    'User-Agent': net.USER_AGENT,
    Accept: 'application/json',
  };
}

function buildFacets({ projectType, gameVersion, loader, categories }) {
  const facets = [];
  if (projectType) facets.push([`project_type:${projectType}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (loader) facets.push([`categories:${loader}`]);
  if (categories && categories.length) facets.push(categories.map((c) => `categories:${c}`));
  return JSON.stringify(facets);
}

function normalizeHit(hit) {
  return {
    id: hit.project_id,
    slug: hit.slug,
    title: hit.title,
    description: hit.description,
    icon: hit.icon_url,
    downloads: hit.downloads,
    follows: hit.follows,
    categories: hit.categories || [],
    versions: hit.versions || [],
    author: hit.author,
    gallery: hit.gallery || [],
    type: hit.project_type,
    dateModified: hit.date_modified,
  };
}

const searchCache = new Map();

async function search(options = {}) {
  const cacheKey = JSON.stringify(options);
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.time < 120000) return cached.data;
  const params = new URLSearchParams();
  params.set('query', options.query || '');
  params.set('limit', String(Math.min(40, options.limit || 20)));
  params.set('offset', String(options.offset || 0));
  params.set('index', options.index || 'relevance');
  const facets = buildFacets(options);
  if (facets !== '[]') params.set('facets', facets);
  const data = await net.fetchJson(`${API}/search?${params.toString()}`, { headers: headers(), timeout: 25000 });
  const result = {
    hits: (data.hits || []).map(normalizeHit),
    total: data.total_hits || 0,
    offset: data.offset || 0,
    limit: data.limit || 20,
  };
  if (searchCache.size > 120) searchCache.clear();
  searchCache.set(cacheKey, { time: Date.now(), data: result });
  return result;
}

async function getProjects(ids) {
  if (!ids.length) return [];
  const data = await net.fetchJson(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`, {
    headers: headers(),
    timeout: 25000,
  });
  return data || [];
}

async function getProject(id) {
  const data = await net.fetchJson(`${API}/project/${encodeURIComponent(id)}`, { headers: headers(), timeout: 25000 });
  return {
    ...data,
    icon: data.icon_url,
    gallery: data.gallery || [],
    issueUrl: data.issues_url,
    sourceUrl: data.source_url,
    wikiUrl: data.wiki_url,
    body: data.body || '',
  };
}

async function getVersions(projectId, options = {}) {
  const params = new URLSearchParams();
  if (options.gameVersion) params.set('game_versions', JSON.stringify([options.gameVersion]));
  if (options.loader && options.loader !== 'vanilla') params.set('loaders', JSON.stringify([options.loader]));
  const url = `${API}/project/${encodeURIComponent(projectId)}/version${params.toString() ? `?${params}` : ''}`;
  const data = await net.fetchJson(url, { headers: headers(), timeout: 25000 });
  return (data || []).map((v) => ({
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    type: v.version_type,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    datePublished: v.date_published,
    downloads: v.downloads,
    files: (v.files || []).map((f) => ({
      url: f.url,
      filename: f.filename,
      primary: f.primary,
      size: f.size,
      sha1: f.hashes && f.hashes.sha1,
      sha512: f.hashes && f.hashes.sha512,
    })),
    dependencies: v.dependencies || [],
  }));
}

function pickVersion(versions) {
  if (!versions.length) return null;
  const rank = { release: 0, beta: 1, alpha: 2 };
  return [...versions].sort((a, b) => {
    const r = (rank[a.type] ?? 3) - (rank[b.type] ?? 3);
    if (r !== 0) return r;
    return new Date(b.datePublished) - new Date(a.datePublished);
  })[0];
}

function contentFile(instanceId) {
  return paths.instanceContent(instanceId);
}

function readContent(instanceId) {
  const file = contentFile(instanceId);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { items: [] };
  }
}

function writeContent(instanceId, data) {
  ensureDir(path.dirname(contentFile(instanceId)));
  fs.writeFileSync(contentFile(instanceId), JSON.stringify(data, null, 2), 'utf8');
  return data;
}

function folderFor(type) {
  return FOLDERS[type] || 'mods';
}

async function installContent(instanceId, projectId, options = {}) {
  const instance = instances.readInstance(instanceId);
  if (!instance) throw new Error('Сборка не найдена');
  const onProgress = options.onProgress || (() => {});
  const project = await getProject(projectId);
  const loader = instance.loader.type === 'vanilla' ? null : instance.loader.type;
  const versions = await getVersions(project.id, { gameVersion: instance.mcVersion, loader });
  let version = options.versionId ? versions.find((v) => v.id === options.versionId) : pickVersion(versions);
  if (!version && options.versionId) {
    const all = await getVersions(project.id, {});
    version = all.find((v) => v.id === options.versionId);
  }
  if (!version) throw new Error(`Нет подходящей версии для Minecraft ${instance.mcVersion}`);

  const file = version.files.find((f) => f.primary) || version.files[0];
  if (!file) throw new Error('У версии нет файлов');

  const folder = folderFor(project.project_type);
  const dest = path.join(paths.instanceGameDir(instanceId), folder, file.filename);
  onProgress({ stage: 'download', detail: `Скачиваю ${project.title}`, percent: 5 });
  await net.downloadFile(file.url, dest, { sha1: file.sha1, size: file.size, timeout: 300000 });
  onProgress({ stage: 'done', detail: `${project.title} установлен`, percent: 100 });

  const content = readContent(instanceId);
  content.items = content.items.filter((item) => item.projectId !== project.id);
  content.items.push({
    projectId: project.id,
    slug: project.slug,
    title: project.title,
    icon: project.icon_url,
    versionId: version.id,
    versionNumber: version.versionNumber,
    versionType: version.type,
    projectType: project.project_type,
    filename: file.filename,
    folder,
    size: file.size,
    installedAt: Date.now(),
    disabled: false,
    dependencies: version.dependencies || [],
  });
  writeContent(instanceId, content);

  const installedDeps = [];
  if (options.autoDeps !== false) {
    const deps = (version.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id);
    const have = new Set(content.items.map((i) => i.projectId));
    for (const dep of deps) {
      if (have.has(dep.project_id)) continue;
      try {
        const result = await installContent(instanceId, dep.project_id, {
          versionId: dep.version_id || undefined,
          autoDeps: false,
          onProgress,
        });
        installedDeps.push(result.item.title);
      } catch {
        /* зависимость может быть необязательной для этой версии */
      }
    }
  }

  return {
    item: content.items.find((i) => i.projectId === project.id),
    project,
    version,
    dependencies: installedDeps,
  };
}

function installed(instanceId) {
  const content = readContent(instanceId);
  const gameDir = paths.instanceGameDir(instanceId);
  const tracked = new Set(content.items.map((item) => `${item.folder}/${item.filename}`));
  const manual = [];
  for (const [type, folder] of Object.entries(FOLDERS)) {
    const dir = path.join(gameDir, folder);
    if (!exists(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (tracked.has(`${folder}/${file}`)) continue;
      if (file === 'desktop.ini' || file === '.DS_Store') continue;
      let size = 0;
      try {
        size = fs.statSync(path.join(dir, file)).size;
      } catch {
        /* ignore */
      }
      manual.push({ projectType: type, folder, filename: file, size, manual: true, disabled: file.endsWith('.disabled') });
    }
  }
  return {
    items: content.items.map((item) => {
      const file = path.join(gameDir, item.folder, item.filename);
      const disabledFile = `${file}.disabled`;
      return {
        ...item,
        present: exists(file) || exists(disabledFile),
        enabled: exists(file),
        sizeLabel: formatBytes(item.size || 0),
      };
    }),
    manual,
  };
}

function removeContent(instanceId, projectIdOrFilename, folderHint) {
  const content = readContent(instanceId);
  const gameDir = paths.instanceGameDir(instanceId);
  const item = content.items.find((i) => i.projectId === projectIdOrFilename || i.filename === projectIdOrFilename);
  if (item) {
    unlinkQuiet(path.join(gameDir, item.folder, item.filename));
    unlinkQuiet(path.join(gameDir, item.folder, `${item.filename}.disabled`));
    content.items = content.items.filter((i) => i !== item);
    writeContent(instanceId, content);
    return true;
  }
  if (folderHint) {
    unlinkQuiet(path.join(gameDir, folderHint, projectIdOrFilename));
    return true;
  }
  return false;
}

function toggleContent(instanceId, projectIdOrFilename) {
  const content = readContent(instanceId);
  const gameDir = paths.instanceGameDir(instanceId);
  const item = content.items.find((i) => i.projectId === projectIdOrFilename || i.filename === projectIdOrFilename);
  if (!item) {
    const folder = content.items.length ? content.items[0].folder : 'mods';
    const file = path.join(gameDir, folder, projectIdOrFilename);
    if (exists(file)) {
      fs.renameSync(file, `${file}.disabled`);
      return { enabled: false };
    }
    if (exists(`${file}.disabled`)) {
      fs.renameSync(`${file}.disabled`, file);
      return { enabled: true };
    }
    return { enabled: false };
  }
  const file = path.join(gameDir, item.folder, item.filename);
  if (exists(file)) {
    fs.renameSync(file, `${file}.disabled`);
    item.disabled = true;
  } else if (exists(`${file}.disabled`)) {
    fs.renameSync(`${file}.disabled`, file);
    item.disabled = false;
  }
  writeContent(instanceId, content);
  return { enabled: !item.disabled };
}

function loaderFromDependencies(deps = {}) {
  if (deps['fabric-loader']) return { type: 'fabric', version: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { type: 'quilt', version: deps['quilt-loader'] };
  if (deps.neoforge) return { type: 'neoforge', version: deps.neoforge };
  if (deps.forge) return { type: 'forge', version: deps.forge };
  return { type: 'vanilla', version: null };
}

async function installModpack(projectId, versionId, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const project = await getProject(projectId);
  const versions = await getVersions(project.id, {});
  const version = versionId ? versions.find((v) => v.id === versionId) : pickVersion(versions);
  if (!version) throw new Error('У модпака нет версий');
  const file = version.files.find((f) => f.filename.endsWith('.mrpack')) || version.files[0];
  if (!file) throw new Error('У версии модпака нет .mrpack файла');

  onProgress({ stage: 'pack', percent: 2, detail: `Скачиваю ${file.filename}` });
  ensureDir(paths.cache());
  const archive = path.join(paths.cache(), file.filename);
  await net.downloadFile(file.url, archive, { sha1: file.sha1, size: file.size, timeout: 600000 });

  onProgress({ stage: 'pack', percent: 8, detail: 'Читаю манифест модпака' });
  const index = zip.readJson(archive, 'modrinth.index.json');
  if (!index) throw new Error('В архиве нет modrinth.index.json');

  const deps = index.dependencies || {};
  const mcVersion = deps.minecraft || '1.21.1';
  const loader = loaderFromDependencies(deps);

  const instance = instances.createInstance({
    name: options.name || index.name || project.title,
    mcVersion,
    loader,
    icon: project.icon_url,
    cover: 'autumn',
    modpack: {
      projectId: project.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      title: project.title,
      icon: project.icon_url,
      summary: index.summary || project.description,
      filename: file.filename,
    },
  });

  const gameDir = paths.instanceGameDir(instance.id);
  instances.ensureGameDirs(gameDir);
  const files = (index.files || []).filter((entry) => !entry.env || entry.env.client !== 'unsupported');
  let done = 0;
  const total = files.length;
  const failures = [];

  onProgress({ stage: 'pack', percent: 12, detail: `Файлы модпака: ${total}` });
  await net.pool(
    files,
    Math.max(4, Math.min(16, store.getSettings().downloadThreads || 8)),
    async (entry) => {
      const target = path.join(gameDir, entry.path);
      ensureDir(path.dirname(target));
      try {
        await net.downloadFile(entry.downloads[0], target, {
          sha1: entry.hashes && entry.hashes.sha1,
          size: entry.fileSize,
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
        percent: 12 + Math.round((done / Math.max(1, total)) * 70),
        detail: `Файлы ${done}/${total}`,
      });
    },
  );

  onProgress({ stage: 'pack', percent: 84, detail: 'Распаковываю overrides' });
  const overrides = ['overrides', 'client-overrides'];
  for (const folder of overrides) {
    try {
      zip.extract(archive, gameDir, { prefix: `${folder}/` });
    } catch {
      /* в паке может не быть overrides */
    }
  }

  const content = readContent(instance.id);
  content.items = (content.items || []).concat(
    files.map((entry) => ({
      projectId: `mrpack:${entry.path}`,
      slug: '',
      title: path.basename(entry.path),
      icon: null,
      versionId: version.id,
      versionNumber: version.versionNumber,
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
  writeContent(instance.id, content);

  try {
    fs.rmSync(archive, { force: true });
  } catch {
    /* ignore */
  }

  onProgress({ stage: 'done', percent: 100, detail: 'Модпак установлен' });
  return { instance, index, failures, fileCount: files.length };
}

async function popular(projectType = 'modpack', limit = 8) {
  return search({ projectType, index: 'downloads', limit });
}

async function featuredModpacks(limit = 6) {
  const result = await search({ projectType: 'modpack', index: 'relevance', limit });
  return result.hits;
}

async function updateProjectCheck(instanceId) {
  const content = readContent(instanceId);
  const instance = instances.readInstance(instanceId);
  if (!instance) return [];
  const updates = [];
  for (const item of content.items) {
    if (item.fromModpack || !item.slug) continue;
    try {
      const versions = await getVersions(item.projectId, {
        gameVersion: instance.mcVersion,
        loader: instance.loader.type === 'vanilla' ? null : instance.loader.type,
      });
      const best = pickVersion(versions);
      if (best && best.id !== item.versionId) {
        updates.push({
          projectId: item.projectId,
          title: item.title,
          current: item.versionNumber,
          latest: best.versionNumber,
          versionId: best.id,
        });
      }
    } catch {
      /* ignore */
    }
  }
  return updates;
}

module.exports = {
  API,
  FOLDERS,
  search,
  getProject,
  getProjects,
  getVersions,
  installContent,
  installed,
  removeContent,
  toggleContent,
  installModpack,
  popular,
  featuredModpacks,
  updateProjectCheck,
  pickVersion,
};

