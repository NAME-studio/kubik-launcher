'use strict';

const net = require('net');
const https = require('https');

function writeVarint(value) {
  const bytes = [];
  let current = value >>> 0;
  do {
    let byte = current & 0x7f;
    current >>>= 7;
    if (current) byte |= 0x80;
    bytes.push(byte);
  } while (current);
  return Buffer.from(bytes);
}

function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < buffer.length) {
    const byte = buffer[index];
    value |= (byte & 0x7f) << shift;
    index += 1;
    if (!(byte & 0x80)) return { value, offset: index };
    shift += 7;
    if (shift > 35) break;
  }
  return null;
}

function stringPacket(text) {
  const payload = Buffer.from(text, 'utf8');
  return Buffer.concat([writeVarint(payload.length), payload]);
}

function parseHost(address) {
  const text = String(address || '').trim();
  const ipv6 = text.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6) return { host: ipv6[1], port: Number(ipv6[2]) || 25565 };
  const parts = text.split(':');
  if (parts.length === 2) return { host: parts[0], port: Number(parts[1]) || 25565 };
  return { host: text, port: 25565 };
}

function pingOnce(address, timeout = 3500, protocol = 769) {
  return new Promise((resolve) => {
    const { host, port } = parseHost(address);
    if (!host) {
      resolve({ online: false, error: 'Пустой адрес' });
      return;
    }
    const started = Date.now();
    let settled = false;
    const done = (payload) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(payload);
    };

    const socket = net.connect({ host, port, family: 4 });
    let buffer = Buffer.alloc(0);

    socket.setTimeout(timeout);
    socket.on('timeout', () => done({ online: false, error: 'Нет ответа (таймаут)' }));
    socket.on('error', (error) => done({ online: false, error: error.code || error.message }));

    socket.on('connect', () => {
      const portBuffer = Buffer.alloc(2);
      portBuffer.writeUInt16BE(port, 0);
      const handshake = Buffer.concat([
        writeVarint(0x00),
        writeVarint(protocol),
        stringPacket(host),
        portBuffer,
        writeVarint(0x01),
      ]);
      socket.write(Buffer.concat([writeVarint(handshake.length), handshake]));
      socket.write(Buffer.concat([writeVarint(1), Buffer.from([0x00])]));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 2) return;
      const length = readVarint(buffer, 0);
      if (!length) return;
      if (buffer.length < length.offset + length.value) return;
      const body = buffer.slice(length.offset, length.offset + length.value);
      const packetId = readVarint(body, 0);
      if (!packetId || packetId.value !== 0x00) {
        done({ online: false, error: 'Неверный ответ сервера' });
        return;
      }
      const strLen = readVarint(body, packetId.offset);
      if (!strLen) {
        done({ online: false, error: 'Короткий ответ сервера' });
        return;
      }
      const json = body.slice(strLen.offset, strLen.offset + strLen.value).toString('utf8');
      let status = {};
      try {
        status = JSON.parse(json);
      } catch {
        /* оставим пустым */
      }
      const desc = status.description;
      let motd = '';
      if (typeof desc === 'string') motd = desc;
      else if (desc && typeof desc === 'object') {
        if (desc.text) motd = desc.text;
        if (Array.isArray(desc.extra)) motd += desc.extra.map((part) => (typeof part === 'string' ? part : part && part.text) || '').join('');
      }
      done({
        online: true,
        latency: Date.now() - started,
        version: status.version && status.version.name ? status.version.name : '',
        protocol: status.version && status.version.protocol ? status.version.protocol : null,
        players: status.players || { online: 0, max: 0 },
        motd: String(motd).replace(/§./g, '').trim().slice(0, 120),
        icon: status.favicon || null,
      });
    });
  });
}

// Резервная проверка через публичный API: работает, когда прямой Minecraft-пинг блокируется сетью.
function httpStatus(address, timeout = 6000) {
  const { host, port } = parseHost(address);
  if (!host) return Promise.resolve({ online: false, error: 'Пустой адрес' });
  const target = port && port !== 25565 ? `${host}:${port}` : host;
  return new Promise((resolve) => {
    const req = https.get(
      `https://api.mcsrvstat.us/3/${encodeURIComponent(target)}`,
      {
        family: 4,
        timeout,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'KubikLauncher (https://name-studio.github.io/kubik-launcher)',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json || !json.online) {
              resolve({ online: false, error: 'Сервер офлайн' });
              return;
            }
            const players = json.players || {};
            const clean = json.motd && Array.isArray(json.motd.clean) ? json.motd.clean.join(' ').trim() : '';
            resolve({
              online: true,
              latency: null,
              version: (json.version && json.version.name) || '',
              protocol: (json.protocol && json.protocol.version) || null,
              players: { online: players.online || 0, max: players.max || 0 },
              motd: clean.replace(/§./g, '').slice(0, 120),
              icon: json.icon || null,
              viaApi: true,
            });
          } catch {
            resolve({ online: false, error: 'Нет ответа (таймаут)' });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ online: false, error: 'Нет ответа (таймаут)' }));
  });
}

// Публичный API не любит пачки запросов — выстраиваем их в очередь с паузой.
let apiChain = Promise.resolve();

function httpStatusQueued(address) {
  const run = () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(httpStatus(address)), 350);
    });
  const next = apiChain.then(run);
  apiChain = next.catch(() => {});
  return next;
}

// Прямой пинг и публичный API идут одновременно: что ответит быстрее и точнее, то и берём.
async function ping(address, timeout = 2500, protocol = 769) {
  const slp = pingOnce(address, timeout, protocol);
  const direct = await slp;
  if (direct.online) return direct;
  const byApi = await httpStatusQueued(address);
  if (byApi.online) return byApi;
  return direct;
}

module.exports = { ping, parseHost };
