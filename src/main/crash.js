'use strict';

const fs = require('fs');
const path = require('path');

const RULES = [
  {
    kind: 'memory',
    test: /OutOfMemoryError|Java heap space|GC overhead limit exceeded|Cannot allocate memory/i,
    title: 'Игре не хватило оперативной памяти',
    hint: 'Увеличьте память сборки в настройках (например, 4096–6144 МБ) и закройте лишние программы. Не ставьте больше ~60% от объёма ОЗУ ПК.',
  },
  {
    kind: 'java',
    test: /UnsupportedClassVersionError|class file version .* is not supported|Unsupported major\.minor version/i,
    title: 'Неподходящая версия Java',
    hint: 'Сборке нужна другая Java (обычно 17, 21 или 25). В настройках сборки выберите «Автоматически» — лаунчер подберёт и скачает нужную версию.',
  },
  {
    kind: 'mods',
    test: /ModResolutionException|ResolutionException|Missing or unsupported mandatory dependencies|DuplicateModsFoundException|Incompatible mod set|requires .+ of (mod|minecraft)|Mod file .* is not a valid mod|mods\.toml/i,
    title: 'Конфликт или несовместимость модов',
    hint: 'Один из модов требует другую версию игры или другого мода. Откройте папку mods, уберите недавно добавленные моды или проверьте зависимости в описании мода.',
  },
  {
    kind: 'mods',
    test: /NoSuchMethodError|NoClassDefFoundError|ClassNotFoundException|AbstractMethodError|IllegalAccessError/i,
    title: 'Моды несовместимы с этой версией игры или загрузчика',
    hint: 'Скорее всего, мод собран под другую версию Minecraft/Forge/Fabric. Проверьте версию мода на странице загрузки и удалите лишние.',
  },
  {
    kind: 'graphics',
    test: /GLFW error|Failed to create window|Pixel format not accelerated|Could not create GL context|WGL: Failed|OpenGL error|Caused by: org\.lwjgl|EXCEPTION_ACCESS_VIOLATION|0xc0000005/i,
    title: 'Ошибка видеодрайвера',
    hint: 'Обновите драйвер видеокарты. Если стоят шейдеры/Iris/OptiFine — попробуйте запустить без них. На ноутбуках включите дискретную видеокарту для Java.',
  },
  {
    kind: 'network',
    test: /Couldn'?t download|Failed to download|Connection timed out|UnknownHostException|SSLHandshakeException|SocketTimeoutException|Read timed out/i,
    title: 'Проблема с интернетом при запуске',
    hint: 'Игра не смогла скачать или проверить файлы. Проверьте соединение, отключите VPN/прокси и попробуйте запустить снова.',
  },
  {
    kind: 'install',
    test: /Could not find or load main class|Error: Could not find or load main class|Invalid or corrupt jarfile|zip END header not found/i,
    title: 'Файлы игры повреждены',
    hint: 'Переустановите файлы: откройте настройки сборки и запустите установку заново — лаунчер докачает недостающее.',
  },
  {
    kind: 'world',
    test: /corrupt(ed)? (world|chunk|level)|Level is corrupted|Chunk file at .* is missing/i,
    title: 'Повреждён мир или чанк',
    hint: 'Сделайте резервную копию папки saves и попробуйте загрузить другой мир. Повреждённый регион можно удалить — потеряется только этот участок.',
  },
  {
    kind: 'java',
    test: /Error occurred during initialization of VM|Unrecognized VM option|Could not reserve enough space for object heap/i,
    title: 'Java не смогла запуститься с этими аргументами',
    hint: 'Уберите лишние аргументы JVM в настройках сборки или уменьшите выделенную память.',
  },
];

function tailLines(file, count = 80) {
  try {
    const stat = fs.statSync(file);
    const size = Math.min(stat.size, 512 * 1024);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, stat.size - size);
    fs.closeSync(fd);
    return buffer.toString('utf8').split(/\r?\n/).slice(-count);
  } catch {
    return [];
  }
}

function analyzeText(text) {
  const source = String(text || '');
  if (!source) return null;
  let matched = null;
  let line = '';
  for (const rule of RULES) {
    if (!rule.test.test(source)) continue;
    matched = rule;
    line = source.split(/\r?\n/).find((item) => rule.test.test(item)) || '';
    break;
  }
  if (!matched) {
    const errorLine = source.split(/\r?\n/).find((item) => /Exception|Error|Caused by|FATAL|crash/i.test(item));
    if (!errorLine) return null;
    matched = {
      kind: 'unknown',
      title: 'Игра завершилась с ошибкой',
      hint: 'Откройте лог ниже и проверьте последние строки — там указана причина. Можно также удалить недавно добавленные моды или переустановить сборку.',
    };
    line = errorLine;
  }
  return {
    kind: matched.kind,
    title: matched.title,
    hint: matched.hint,
    line: String(line).trim().slice(0, 400),
  };
}

function diagnose(logFile, extra) {
  if (!logFile) return null;
  const text = `${tailLines(logFile, 120).join('\n')}\n${extra || ''}`;
  const result = analyzeText(text);
  if (!result) return null;
  return { ...result, logFile, file: path.basename(logFile) };
}

module.exports = { diagnose, analyzeText };
