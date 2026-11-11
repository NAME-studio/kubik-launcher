'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const store = require('./store');
const net = require('./net');
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
  if (!key) throw new Error('Нужен API-ключ CurseForge — вставьте его в настройках (console.curseforge.com)');  const url = new URL(`${API}${endpoint}`);
  for (const [name, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(name, String(value));
  }
  const response = await net.request(url.toString(), { headers: { 'x-api-key': key, Accept: 'application/json' } });
  if (response.status === 403 || response.status === 401) {
    throw new Error('CurseForge недоступен из вашей сети (Cloudflare 403) или ключ отклонён — попробуйте VPN или другой ключ');
  }
  if (!response.ok) throw new Error(`CurseForge ответил ${response.status}`);
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
  if (exists(target)) return { file: name, skipped: true };
  try {
    await net.downloadFile(file.downloadUrl, target);
  } catch (error) {
    throw new Error(`Не удалось скачать файл с CDN CurseForge: ${error.message}. Попробуйте другую версию мода или файл.`);
  }
  return { file: name, bytes: fs.existsSync(target) ? fs.statSync(target).size : 0 };
}

module.exports = { hasKey, search, install, pickFile, CLASS_IDS };
