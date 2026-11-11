'use strict';

const net = require('net');
const store = require('./store');

let socket = null;
let clientId = '';
let lastActivity = null;
let connected = false;
let lastError = '';
let lastApplied = 0;
let attempt = 0;
let reconnectTimer = null;
let buffer = Buffer.alloc(0);

function settings() {
  return store.getSettings();
}

function activityFor(activity) {
  if (!activity) {
    return { details: 'В лаунчере', state: 'Выбирает сборку', timestamps: { start: Date.now() } };
  }
  if (activity.state === 'game') {
    return {
      details: `Играет: ${activity.instanceName || 'Minecraft'}`,
      state: activity.server ? `Сервер: ${activity.server}` : 'Одиночная игра',
      timestamps: { start: activity.startedAt || Date.now() },
    };
  }
  return {
    details: 'В лаунчере',
    state: activity.page ? `Раздел: ${activity.page}` : 'Выбирает сборку',
    timestamps: { start: Date.now() },
  };
}

function pipes() {
  const out = [];
  for (let index = 0; index < 10; index += 1) out.push(`\\\\.\\pipe\\discord-ipc-${index}`);
  return out;
}

function pack(op, payload) {
  const body = Buffer.from(payload, 'utf8');
  const head = Buffer.alloc(8);
  head.writeUInt32LE(op, 0);
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function send(command, args, evt) {
  if (!socket) return false;
  const payload = { cmd: command, args, nonce: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  if (evt) payload.evt = evt;
  try {
    socket.write(pack(1, JSON.stringify(payload)));
    return true;
  } catch (error) {
    lastError = String(error.message || error);
    return false;
  }
}

function apply(activity) {
  lastActivity = activity;
  if (!connected) return;
  try {
    if (send('SET_ACTIVITY', { pid: process.pid, activity: activityFor(activity) })) lastApplied = Date.now();
  } catch (error) {
    lastError = String(error.message || error);
  }
}

function handleMessage(text) {
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    return;
  }
  if (data.cmd === 'DISPATCH' && data.evt === 'READY') {
    connected = true;
    lastError = '';
    attempt = 0;
    apply(lastActivity);
    return;
  }
  if (data.evt === 'ERROR') {
    lastError = String((data.data && data.data.message) || 'Discord отклонил запрос');
  }
}

function onData(chunk) {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 8) {
    const op = buffer.readUInt32LE(0);
    const length = buffer.readUInt32LE(4);
    if (buffer.length < 8 + length) return;
    const body = buffer.subarray(8, 8 + length).toString('utf8');
    buffer = buffer.subarray(8 + length);
    if (op === 1) handleMessage(body);
    else if (op === 3) {
      try {
        socket.write(pack(4, body));
      } catch {
        /* ignore */
      }
    } else if (op === 2) {
      lastError = 'Discord закрыл соединение';
      cleanup();
      scheduleReconnect();
    }
  }
}

function cleanup() {
  connected = false;
  if (socket) {
    socket.removeAllListeners();
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }
  socket = null;
  buffer = Buffer.alloc(0);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!clientId) return;
  const delay = Math.min(30000, 3000 * (attempt + 1));
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    connect().catch(() => {});
  }, delay);
}

function connect() {
  return new Promise((resolve) => {
    if (!clientId) {
      resolve({ ok: false, reason: 'no-id' });
      return;
    }
    const targets = pipes();
    let index = 0;

    const tryNext = () => {
      if (index >= targets.length) {
        lastError = 'Discord не запущен';
        scheduleReconnect();
        resolve({ ok: false, reason: lastError });
        return;
      }
      const pipe = targets[index];
      index += 1;
      const sock = net.createConnection(pipe);
      let settled = false;

      sock.once('connect', () => {
        socket = sock;
        buffer = Buffer.alloc(0);
        sock.on('data', onData);
        sock.on('error', (error) => {
          lastError = String(error.message || error);
          cleanup();
          scheduleReconnect();
        });
        sock.on('close', () => {
          if (connected) {
            connected = false;
            lastError = 'Discord закрылся';
            scheduleReconnect();
          }
        });
        try {
          sock.write(pack(0, JSON.stringify({ v: 1, client_id: clientId })));
        } catch (error) {
          lastError = String(error.message || error);
        }
        settled = true;
      });

      sock.once('error', () => {
        if (settled) return;
        sock.removeAllListeners();
        try {
          sock.destroy();
        } catch {
          /* ignore */
        }
        tryNext();
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          sock.destroy();
        } catch {
          /* ignore */
        }
        tryNext();
      }, 1200);
    };

    tryNext();

    const started = Date.now();
    const wait = setInterval(() => {
      if (connected) {
        clearInterval(wait);
        resolve({ ok: true });
      } else if (Date.now() - started > 4000) {
        clearInterval(wait);
        resolve({ ok: false, reason: lastError || 'Discord не ответил' });
      }
    }, 100);
  });
}

async function start() {
  const config = settings();
  const id = String(config.discordClientId || '').trim();
  if (config.discordRichPresence === false || !id) {
    stop();
    return { ok: false, reason: !id ? 'no-id' : 'disabled' };
  }
  if (socket && connected && clientId === id) return { ok: true, already: true };
  cleanup();
  clientId = id;
  lastError = '';
  const result = await connect();
  return result;
}

function stop() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clientId = '';
  attempt = 0;
  connected = false;
  cleanup();
}

async function update(activity) {
  lastActivity = activity;
  if (!socket || !connected) {
    const result = await start();
    if (!result.ok) return result;
  }
  apply(activity);
  return { ok: true };
}

function status() {
  const config = settings();
  return {
    enabled: config.discordRichPresence !== false,
    clientId: String(config.discordClientId || ''),
    connected,
    error: lastError,
    appliedAt: lastApplied,
  };
}

module.exports = { start, stop, update, apply, status };
