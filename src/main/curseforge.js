'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const store = require('./store');
const net = require('./net');
const instances = require('./instances');
const zip = require('./zip');
const { ensureDir, exists } = require('./util');

const API = 'https://api.curseforge.com/v1';
const GAME_ID = 432;
const CLASS_IDS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 17 };
const LOADER_IDS = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };

function safeName(name) {
  const cleaned = String(name || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return (cleaned || `${Date.now()}.jar`).slice(-180);
}

function apiKey() {
  return String(store.getSettings().curseforgeKey || '').trim();
}

function hasKey() {
  return Boolean(apiKey());
}

async function request(endpoint, params) {
  const key = apiKey();
  if (!key) {
    const error = new Error('Нужен API-ключ CurseForge — вставьте его в настройках (console.curseforge.com)');
    error.code = 'CF_NO_KEY';
    throw error;
  }
  const url = new URL(`${API}${endpoint}`);
  for (const [name, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(name, String(value));
  }
  let response;
  try {
    response = await net.request(url.toString(), { headers: { 'x-api-key': key, Accept: 'application/json' }, timeout: 12000 });
  } catch (error) {
    const failure = new Error('CurseForge не отвечает — проверьте интернет или VPN и попробуйте ещё раз');
    failure.code = 'CF_NETWORK';
    throw failure;
  }
  if (response.status === 403 || response.status === 401) {
    const error = new Error('CurseForge недоступен из вашей сети (Cloudflare 403) или ключ отклонён — попробуйте VPN или другой ключ');
    error.code = 'CF_FORBIDDEN';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`CurseForge ответил ${response.status} — попробуйте позже`);
    error.code = 'CF_HTTP';
    throw error;
  }
  return response.json();
}

function mapItem(mod) {
  return {
    id: `cf-${mod.id}`,
    source: 'curse',
    curseId: mod.id,
    title: mod.name,
    description: mod.summary || '',
    icon: (mod.logo && (mod.logo.thumbnailUrl || mod.logo.url)) || null,
    downloads: mod.downloadCount || 0,
    author: (mod.authors && mod.authors[0] && mod.authors[0].name) || mod.ownerName || '',
    categories: (mod.categories || []).slice(0, 3).map((c) => c.name),
    gallery: (mod.screenshots || []).slice(0, 3).map((shot) => ({ url: shot.thumbnailUrl || shot.url })),
  };
}

async function search({ projectType = 'mod', query = '', gameVersion, loader, index = 0, limit = 12 }) {
  const params = {
    gameId: GAME_ID,
    classId: CLASS_IDS[projectType] || CLASS_IDS.mod,
    searchFilter: query || undefined,
    gameVersion: gameVersion || undefined,
    modLoaderType: loader && LOADER_IDS[loader] ? LOADER_IDS[loader] : undefined,
    sortField: query ? 1 : 2,
    sortOrder: 'desc',
    index,
    pageSize: limit,
  };
  const data = await request('/mods/search', params);
  return { hits: (data.data || []).map(mapItem), total: (data.pagination && data.pagination.totalCount) || 0 };
}

function fileUrl(file) {
  if (file.downloadUrl) return file.downloadUrl;
  const id = String(file.id);
  const head = id.slice(0, -3) || '0';
  const tail = id.slice(-3).replace(/^0+/, '') || '0';
  return `https://edge.forgecdn.net/files/${head}/${tail}/${file.fileName}`;
}

async function pickFile(modId, { projectType = 'mod', gameVersion, loader }) {
  const data = await request(`/mods/${modId}/files`, {
    gameVersion: gameVersion || undefined,
    modLoaderType: loader && LOADER_IDS[loader] ? LOADER_IDS[loader] : undefined,
    pageSize: 50,
  });
  const files = data.data || [];
  const file = files.find((item) => item.releaseType === 1) || files[0];
  if (!file) throw new Error('Нет подходящего файла для этой версии игры');
  return { ...file, downloadUrl: fileUrl(file) };
}

async function install(instanceId, modId, options = {}) {
  const folder = FOLDERS[options.projectType] || 'mods';
  const file = await pickFile(modId, options);
  const dir = path.join(paths.instanceGameDir(instanceId), folder);
  ensureDir(dir);
  const name = safeName(file.fileName || `${modId}.jar`);
  const target = path.join(dir, name);
  const size = exists(target) ? fs.statSync(target).size : 0;
  if (exists(target)) {
    rememberInstalled(instanceId, modId, file, { name, folder, projectType: options.projectType, size });
    return { file: name, skipped: true };
  }
  try {
    await net.downloadFile(file.downloadUrl, target);
  } catch (error) {
    throw new Error(`Не удалось скачать файл с CDN CurseForge: ${error.message}. Попробуйте другую версию мода или файл.`);
  }
  const bytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
  rememberInstalled(instanceId, modId, file, { name, folder, projectType: options.projectType, size: bytes });
  return { file: name, bytes };
}

// Без записи в content.json мод не виден в «Установленных» и его нельзя отключить или удалить.
async function rememberInstalled(instanceId, modId, file, info) {
  let project = {};
  try {
    project = (await request(`/mods/${modId}`)).data || {};
  } catch {
    /* без названия и иконки мод всё равно попадёт в список */
  }
  const content = readContent(instanceId);
  const items = Array.isArray(content.items) ? content.items : [];
  const projectId = `cf-${modId}`;
  const entry = {
    projectId,
    slug: project.slug || '',
    title: project.name || `CurseForge ${modId}`,
    icon: (project.logo && (project.logo.thumbnailUrl || project.logo.url)) || null,
    versionId: String(file.id || ''),
    versionNumber: file.displayName || '',
    projectType: info.projectType || 'mod',
    filename: info.name,
    folder: info.folder,
    size: info.size || 0,
    installedAt: Date.now(),
    disabled: false,
  };
  const index = items.findIndex((item) => item.projectId === projectId && item.filename === info.name);
  if (index >= 0) items[index] = { ...items[index], ...entry };
  else items.push(entry);
  writeContent(instanceId, { ...content, items });
}

async function packFile(modId) {
  const data = await request(`/mods/${modId}/files`, { pageSize: 50 });
  const files = data.data || [];
  const file = files.find((item) => item.releaseType === 1) || files[0];
  if (!file) throw new Error('У модпака нет файлов');
  return { ...file, downloadUrl: fileUrl(file) };
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

async function installModpack(modId, options = {}) {
  const onProgress = options.onProgress || (() => {});
  const project = (await request(`/mods/${modId}`)).data || {};
  const file = await packFile(modId);

  onProgress({ stage: 'pack', percent: 2, detail: `Скачиваю ${file.fileName}` });
  ensureDir(paths.cache());
  const archive = path.join(paths.cache(), `cf-${modId}-${file.id}-${safeName(file.fileName)}`);
  await net.downloadFile(file.downloadUrl, archive, { timeout: 600000, size: file.fileLength || undefined });

  try {
    const manifest = zip.readJson(archive, 'manifest.json');
    if (!manifest) throw new Error('В архиве нет manifest.json — это не модпак CurseForge');

    const mcVersion = (manifest.minecraft && manifest.minecraft.version) || '1.21.1';
    const loader = loaderFromManifest(manifest);
    const icon = (project.logo && (project.logo.thumbnailUrl || project.logo.url)) || null;

    const instance = instances.createInstance({
      name: options.name || manifest.name || project.name || 'Модпак CurseForge',
      mcVersion,
      loader,
      icon,
      cover: 'autumn',
      modpack: {
        projectId: `cf-${modId}`,
        versionId: String(file.id),
        versionNumber: manifest.version || file.displayName || file.fileName,
        title: project.name || manifest.name || '',
        icon,
        summary: project.summary || '',
        filename: file.fileName,
      },
    });

    const gameDir = paths.instanceGameDir(instance.id);
    instances.ensureGameDirs(gameDir);

    const entries = (manifest.files || []).filter((item) => item.required !== false);
    const failures = [];
    let done = 0;
    onProgress({ stage: 'pack', percent: 8, detail: `Файлы модпака: ${entries.length}` });

    await net.pool(
      entries,
      Math.max(4, Math.min(16, store.getSettings().downloadThreads || 8)),
      async (entry) => {
        try {
          const info = (await request(`/mods/${entry.projectID}/files/${entry.fileID}`)).data;
          if (!info) throw new Error('файл не найден');
          const name = safeName(info.fileName || `${entry.projectID}.jar`);
          const target = path.join(gameDir, 'mods', name);
          ensureDir(path.dirname(target));
          await net.downloadFile(fileUrl(info), target, { timeout: 300000 });
        } catch (error) {
          failures.push({ projectID: entry.projectID, error: error.message });
        }
      },
      (count) => {
        done = count;
        onProgress({
          stage: 'pack',
          percent: 8 + Math.round((done / Math.max(1, entries.length)) * 76),
          detail: `Файлы ${done}/${entries.length}`,
        });
      },
    );

    onProgress({ stage: 'pack', percent: 86, detail: 'Распаковываю overrides' });
    const overrides = manifest.overrides || 'overrides';
    try {
      zip.extract(archive, gameDir, { prefix: `${overrides}/` });
    } catch {
      /* в паке может не быть overrides */
    }

    const content = readContent(instance.id);
    content.items = (content.items || []).concat(
      entries.map((entry) => ({
        projectId: `cfpack:${entry.projectID}:${entry.fileID}`,
        slug: '',
        title: `CurseForge ${entry.projectID}`,
        icon: null,
        versionId: String(entry.fileID),
        versionNumber: '',
        projectType: 'mod',
        filename: '',
        folder: 'mods',
        installedAt: Date.now(),
        disabled: false,
        fromModpack: true,
      })),
    );
    writeContent(instance.id, content);

    onProgress({ stage: 'done', percent: 100, detail: 'Модпак установлен' });
    return { instance, fileCount: entries.length, failures };
  } finally {
    fs.rmSync(archive, { force: true });
  }
}

async function details(modId) {
  const [data, descriptionData] = await Promise.all([
    request(`/mods/${modId}`),
    request(`/mods/${modId}/description`).catch(() => null),
  ]);
  const mod = data.data || {};
  const longDescription = (descriptionData && descriptionData.data) || mod.description || '';
  const screenshots = (mod.screenshots || []).map((shot, index) => ({
    url: shot.thumbnailUrl || shot.url,
    full: shot.url,
    title: shot.title || `Скриншот ${index + 1}`,
  }));
  const files = (mod.latestFiles && mod.latestFiles.length ? mod.latestFiles : await request(`/mods/${modId}/files`, { pageSize: 10 }).then((r) => (r.data || []).map((file) => ({
    id: file.id,
    fileName: file.fileName,
    fileLength: file.fileLength,
    fileDate: file.fileDate,
    releaseType: file.releaseType,
  }))).catch(() => [])).slice(0, 12).map((file) => ({
    id: file.id,
    name: file.fileName,
    size: file.fileLength,
    date: file.fileDate ? Date.parse(file.fileDate) : null,
    releaseType: file.releaseType,
  }));
  return {
    id: `cf-${mod.id}`,
    curseId: mod.id,
    source: 'curse',
    title: mod.name || '',
    summary: mod.summary || '',
    description: longDescription,
    url: mod.links && mod.links.websiteUrl ? mod.links.websiteUrl : `https://www.curseforge.com/minecraft/mc-mods/${mod.slug || mod.id}`,
    downloads: mod.downloadCount || 0,
    author: (mod.authors && mod.authors[0] && mod.authors[0].name) || mod.ownerName || '',
    categories: (mod.categories || []).map((category) => category.name),
    gallery: screenshots,
    updated: mod.dateModified ? Date.parse(mod.dateModified) : null,
    files,
  };
}

async function fileByIds(projectId, fileId) {
  const data = await request(`/mods/${projectId}/files/${fileId}`);
  const file = data.data;
  if (!file) throw new Error(`Файл ${fileId} мода ${projectId} не найден на CurseForge`);
  return { ...file, downloadUrl: fileUrl(file) };
}

module.exports = { hasKey, search, details, install, pickFile, installModpack, fileByIds, CLASS_IDS };
