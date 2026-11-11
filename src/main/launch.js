'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const paths = require('./paths');
const store = require('./store');
const mojang = require('./mojang');
const java = require('./java');
const instances = require('./instances');
const ely = require('./ely');
const { ensureDir, isAllowed, exists } = require('./util');

const LAUNCHER_NAME = 'KubikLauncher';
const LAUNCHER_VERSION = '1.0.0';

const running = new Map();

function substitute(input, values) {
  if (typeof input !== 'string') return input;
  return input.replace(/\$\{([^}]+)\}/g, (match, key) => {
    if (values[key] === undefined) return match;
    return String(values[key]);
  });
}

function flattenArguments(list, features) {
  const out = [];
  for (const item of list || []) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    if (!item || !item.value) continue;
    if (!isAllowed(item.rules, features)) continue;
    if (Array.isArray(item.value)) out.push(...item.value);
    else out.push(item.value);
  }
  return out;
}

function classpathFor(version, features) {
  const entries = [];
  const nativesDir = path.join(paths.versions(), version.id, 'natives');
  for (const lib of version.libraries) {
    if (!isAllowed(lib.rules, features)) continue;
    if (lib.natives) {
      if (!lib.downloads || !lib.downloads.artifact) continue;
    }
    let relative = null;
    if (lib.downloads && lib.downloads.artifact) relative = lib.downloads.artifact.path;
    if (!relative && lib.name) {
      const { mavenPath } = require('./util');
      relative = mavenPath(lib.name);
    }
    if (!relative) continue;
    entries.push(path.join(paths.libraries(), relative));
  }
  const jarVersion = version.clientJarVersion || version.id;
  let jar = path.join(paths.versions(), jarVersion, `${jarVersion}.jar`);
  if (version.inheritsFrom || version.clientJarVersion) {
    const named = path.join(paths.versions(), version.id, `${version.id}.jar`);
    if (!exists(named) && exists(jar)) {
      try {
        ensureDir(path.dirname(named));
        fs.copyFileSync(jar, named);
      } catch {
        /* останется обычный путь */
      }
    }
    if (exists(named)) jar = named;
  }
  entries.unshift(jar);
  return { classpath: entries.join(';'), nativesDir, jar };
}

function buildTokenValues({ version, instance, account, settings, classpath, nativesDir }) {
  const gameDir = paths.instanceGameDir(instance.id);
  const assetsDir = paths.assets();
  const accessToken = account && account.accessToken ? account.accessToken : '0';
  const uuid = account && account.uuid ? account.uuid : '00000000000000000000000000000000';
  return {
    auth_player_name: (account && account.username) || 'Player',
    version_name: version.id,
    game_directory: gameDir,
    assets_root: assetsDir,
    game_assets: path.join(paths.assetsVirtual(), version.assetsIndex ? version.assetsIndex.id || version.assets : version.assets || 'legacy'),
    assets_index_name: version.assetsIndex ? version.assetsIndex.id : version.assets,
    auth_uuid: uuid,
    auth_access_token: accessToken,
    auth_session: `token:${accessToken}:${uuid}`,
    user_type: 'mojang',
    version_type: version.type || 'release',
    user_properties: '{}',
    clientid: '',
    auth_xuid: '',
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath,
    classpath_separator: ';',
    library_directory: paths.libraries(),
    resolution_width: String((instance.resolution && instance.resolution.width) || settings.resolution.width || 1280),
    resolution_height: String((instance.resolution && instance.resolution.height) || settings.resolution.height || 720),
  };
}

async function prepare(instance, account, onProgress = () => {}) {
  onProgress({ stage: 'profile', percent: 0, detail: 'Проверяю файлы версии' });
  const profileVersion = await instances.ensureProfile(instance, onProgress);
  const version = await mojang.resolveVersion(profileVersion);
  const javaMajor = (version.javaVersion && version.javaVersion.majorVersion) || 8;
  const javaInfo = await java.ensureJava(javaMajor, onProgress);
  return { version, javaInfo, javaMajor, profileVersion };
}

async function buildCommand(instance, account, profileVersion, javaInfo, settings, options = {}) {
  const version = await mojang.resolveVersion(profileVersion);
  const features = {
    is_demo_user: false,
    has_custom_resolution: Boolean(instance.resolution && instance.resolution.custom),
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  };

  const { classpath, nativesDir, jar } = classpathFor(version, features);
  const values = buildTokenValues({ version, instance, account, settings, classpath, nativesDir });

  if (version.logging && version.logging.client && version.logging.client.file) {
    values.path = path.join(paths.assets(), 'log_configs', version.logging.client.file.id);
  }

  const memory = Math.max(512, Number(instance.memoryMB || settings.memoryMB || 4096));
  const minMemory = Math.max(512, Math.min(memory, 1024));

  let jvmArgs = [];
  if (version.arguments && Array.isArray(version.arguments.jvm) && version.arguments.jvm.length) {
    jvmArgs = flattenArguments(version.arguments.jvm, features).map((arg) => substitute(arg, values));
  } else {
    jvmArgs = [
      '-Djava.library.path=${natives_directory}',
      '-cp',
      '${classpath}',
    ].map((arg) => substitute(arg, values));
  }

  jvmArgs = jvmArgs.map((arg) => substitute(arg, values));

  const extraJvm = [];
  extraJvm.push(`-Xmx${memory}M`, `-Xms${minMemory}M`);
  extraJvm.push(`-Dminecraft.launcher.brand=${LAUNCHER_NAME}`, `-Dminecraft.launcher.version=${LAUNCHER_VERSION}`);
  extraJvm.push(`-Dorg.lwjgl.librarypath=${nativesDir}`);

  if (settings.useAuthlibInjector && account && account.type === 'ely') {
    const injector = await ely.ensureAuthlibInjector();
    if (injector) {
      extraJvm.push(`-javaagent:${injector}=https://account.ely.by/api/authlib-injector`);
      extraJvm.push('-Dauthlibinjector.side=client');
    }
  }

  const userJvm = String(instance.jvmArgs || settings.jvmArgs || '').trim();
  if (userJvm) extraJvm.push(...userJvm.split(/\s+/).filter(Boolean));

  const finalJvm = [...extraJvm, ...jvmArgs];

  let gameArgs = [];
  if (version.arguments && Array.isArray(version.arguments.game) && version.arguments.game.length) {
    gameArgs = flattenArguments(version.arguments.game, features).map((arg) => substitute(arg, values));
  } else if (version.minecraftArguments) {
    gameArgs = version.minecraftArguments.split(/\s+/).filter(Boolean).map((arg) => substitute(arg, values));
  }

  if (instance.fullscreen) gameArgs.push('--fullscreen');
  if (instance.resolution && instance.resolution.custom) {
    gameArgs.push('--width', values.resolution_width, '--height', values.resolution_height);
  }

  const userGame = String(instance.gameArgs || settings.gameArgs || '').trim();
  if (userGame) gameArgs.push(...userGame.split(/\s+/).filter(Boolean));

  if (!gameArgs.includes('--versionType') && version.arguments && version.arguments.game) {
    gameArgs.push('--versionType', version.type || 'release');
  }

  return {
    javaPath: javaInfo.path === 'java.exe (PATH)' ? 'java.exe' : javaInfo.path,
    args: [...finalJvm, version.mainClass, ...gameArgs],
    cwd: ensureDir(paths.instanceGameDir(instance.id)),
    env: { ...process.env },
    version,
    jar,
  };
}

function stripAnsi(text) {
  return String(text).replace(/\u001b\[[0-9;]*m/g, '');
}

function logFileFor(instanceId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  ensureDir(paths.logs());
  return path.join(paths.logs(), `${instanceId}-${stamp}.log`);
}

async function launch(instance, account, handlers = {}) {
  if (running.has(instance.id)) throw new Error('Этот профиль уже запущен');
  const onProgress = handlers.onProgress || (() => {});
  const onLog = handlers.onLog || (() => {});
  const onExit = handlers.onExit || (() => {});

  const settings = store.getSettings();
  const { javaInfo, profileVersion } = await prepare(instance, account, onProgress);
  const command = await buildCommand(instance, account, profileVersion, javaInfo, settings);

  const logFile = logFileFor(instance.id);
  const writeLog = (text, stream = 'out') => {
    const clean = stripAnsi(text);
    try {
      fs.appendFileSync(logFile, `[${new Date().toLocaleTimeString('ru-RU')}] ${stream === 'err' ? 'ERR ' : ''}${clean}`);
    } catch {
      /* ignore */
    }
    onLog(clean, stream);
  };

  writeLog(`Запуск: ${command.javaPath} ${command.args.length} аргументов\n`);
  writeLog(`Java: ${javaInfo.version || '?'} (${javaInfo.path})\n`);
  writeLog(`Профиль: ${profileVersion}, память ${instance.memoryMB} МБ\n`);

  let args = [...command.args];
  let child = null;
  let outputTail = '';

  const onData = (stream) => (data) => {
    const text = data.toString();
    outputTail = (outputTail + text).slice(-6000);
    writeLog(text, stream);
  };

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      child = spawn(command.javaPath, args, {
        cwd: command.cwd,
        env: command.env,
        windowsHide: true,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      writeLog(`Не удалось запустить игру: ${error.message}\n`, 'err');
      throw error;
    }

    child.stdout.on('data', onData('out'));
    child.stderr.on('data', onData('err'));
    child.on('error', (error) => {
      outputTail += `\n${error.message}`;
    });

    const early = await new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once('exit', (code, signal) => done({ exited: true, code, signal }));
      setTimeout(() => done({ exited: false }), 6000);
    });

    if (!early.exited) break;

    const badOption = outputTail.match(/Unrecognized VM option '([^']+)'/);
    if (badOption) {
      const option = badOption[1];
      const index = args.findIndex((arg) => arg.includes(option));
      writeLog(`Java ${javaInfo.major || ''} не знает опцию ${option} — запускаю без неё\n`, 'err');
      if (index >= 0) {
        args.splice(index, 1);
        outputTail = '';
        continue;
      }
    }

    if (/UnsupportedClassVersionError|class file version/i.test(outputTail)) {
      throw new Error(
        `Игре нужна более новая Java (установлена ${javaInfo.major || '?'}). Выберите другую Java в настройках.`,
      );
    }

    const reason = outputTail
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(-3)
      .join(' ')
      .slice(0, 320);
    throw new Error(`Игра не запустилась (код ${early.code}). ${reason || 'Смотрите лог запуска.'}`);
  }

  if (!child || child.exitCode !== null) {
    throw new Error('Не удалось подобрать параметры Java для запуска. Смотрите лог.');
  }

  running.set(instance.id, child);
  handlers.onStarted && handlers.onStarted({ pid: child.pid, logFile });

  child.on('exit', (code, signal) => {
    running.delete(instance.id);
    writeLog(`Игра завершилась. Код: ${code}${signal ? `, сигнал: ${signal}` : ''}\n`);
    const instanceData = instances.readInstance(instance.id);
    if (instanceData) {
      instanceData.lastPlayed = Date.now();
      instances.writeInstance(instanceData);
    }
    onExit({ code, signal, logFile });
  });

  return { pid: child.pid, logFile, command };
}

function stop(instanceId) {
  const child = running.get(instanceId);
  if (!child) return false;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    /* ignore */
  }
  running.delete(instanceId);
  return true;
}

function isRunning(instanceId) {
  return running.has(instanceId);
}

module.exports = { launch, stop, isRunning, prepare, buildCommand, running };
