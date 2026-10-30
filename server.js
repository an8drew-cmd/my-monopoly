/**
 * ============================================================================
 * СЕРВЕР ИГРЫ И ОНЛАЙН-КОМНАТ (server.js)
 * ============================================================================
 * Что делает этот файл простыми словами:
 * 1) Раздаёт файлы игры из папки public/ в браузер и на iPhone;
 * 2) Создаёт онлайн-комнаты с 4-значным кодом (например, M7K4), чтобы друзья
 *    заходили каждый со своего iPhone и видели ходы друг друга мгновенно!
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DEFAULT_CONFIG = require('./public/js/boardConfig.js');
const Engine = require('./public/js/gameEngine.js');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// HTTP-сервер раздачи статики (совместим с любым превью, iframe и облаком)
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', rooms: rooms.size }));
    return;
  }

  if (pathname === '/') pathname = '/index.html';

  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA fallback на index.html
      const indexFile = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(indexFile, (e2, content) => {
        if (e2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(safePath).pipe(res);
  });
});

// ==================== ПОДКЛЮЧЕНИЕ WEBSOCKET (с встроенным резервом) ====================

function attachWebSocketServer(httpServer, onClientConnected) {
  try {
    const { WebSocketServer } = require('ws');
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    wss.on('connection', (ws) => {
      onClientConnected({
        send: (str) => {
          if (ws.readyState === 1) ws.send(str);
        },
        onMessage: (cb) => ws.on('message', (data) => cb(data.toString('utf8'))),
        onClose: (cb) => ws.on('close', cb)
      });
    });
    return 'ws-package';
  } catch (_) {
    // Встроенная реализация стандарта RFC-6455, если папка node_modules отсутствует
    httpServer.on('upgrade', (req, socket) => {
      if (!req.url.startsWith('/ws')) {
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '\r\n'
        ].join('\r\n')
      );

      let msgHandler = () => {};
      let closeHandler = () => {};
      let buffer = Buffer.alloc(0);

      const sendFrame = (str) => {
        if (socket.destroyed) return;
        const payload = Buffer.from(str, 'utf8');
        const len = payload.length;
        let header;
        if (len < 126) {
          header = Buffer.from([0x81, len]);
        } else if (len < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81;
          header[1] = 126;
          header.writeUInt16BE(len, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81;
          header[1] = 127;
          header.writeBigUInt64BE(BigInt(len), 2);
        }
        socket.write(Buffer.concat([header, payload]));
      };

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 2) {
          const firstByte = buffer[0];
          const secondByte = buffer[1];
          const opcode = firstByte & 0x0f;
          const isMasked = (secondByte & 0x80) !== 0;
          let payloadLen = secondByte & 0x7f;
          let offset = 2;

          if (payloadLen === 126) {
            if (buffer.length < 4) return;
            payloadLen = buffer.readUInt16BE(2);
            offset = 4;
          } else if (payloadLen === 127) {
            if (buffer.length < 10) return;
            payloadLen = Number(buffer.readBigUInt64BE(2));
            offset = 10;
          }

          const maskLen = isMasked ? 4 : 0;
          if (buffer.length < offset + maskLen + payloadLen) return;

          if (opcode === 0x8) {
            socket.end();
            return;
          }

          let dataBuf = buffer.slice(offset + maskLen, offset + maskLen + payloadLen);
          if (isMasked) {
            const mask = buffer.slice(offset, offset + 4);
            dataBuf = Buffer.from(dataBuf);
            for (let i = 0; i < dataBuf.length; i++) {
              dataBuf[i] ^= mask[i % 4];
            }
          }
          buffer = buffer.slice(offset + maskLen + payloadLen);

          if (opcode === 0x1) {
            msgHandler(dataBuf.toString('utf8'));
          } else if (opcode === 0x9) {
            // Ping -> Pong
            socket.write(Buffer.from([0x8a, 0x00]));
          }
        }
      });

      socket.on('close', () => closeHandler());
      socket.on('error', () => closeHandler());

      onClientConnected({
        send: sendFrame,
        onMessage: (cb) => (msgHandler = cb),
        onClose: (cb) => (closeHandler = cb)
      });
    });
    return 'native-rfc6455';
  }
}

// ==================== МЕНЕДЖЕР ОНЛАЙН-КОМНАТ ====================

const rooms = new Map(); // code -> room

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));
  return code;
}

function serializeLobby(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      tokenId: p.tokenId,
      emoji: p.emoji,
      isBot: !!p.isBot
    }))
  };
}

function broadcastRoom(room, payloadObj) {
  const raw = JSON.stringify(payloadObj);
  room.clients.forEach((client) => {
    client.send(raw);
  });
}

function scheduleRoomBots(room) {
  clearTimeout(room.botTimer);
  if (!room.state || room.state.turnPhase === 'GAME_OVER') return;

  room.botTimer = setTimeout(() => {
    if (!room.state) return;
    const botAct = Engine.computeBotAction(room.state);
    if (botAct) {
      const res = Engine.applyAction(room.state, botAct);
      if (res.ok) {
        broadcastRoom(room, { type: 'gameState', state: room.state });
        scheduleRoomBots(room);
      }
    }
  }, 900);
}

attachWebSocketServer(server, (client) => {
  client.roomCode = null;
  client.playerId = null;

  const sendError = (message) => client.send(JSON.stringify({ type: 'error', message }));

  client.onMessage((raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (_) {
      return;
    }

    // 1. Создание комнаты
    if (msg.type === 'createRoom') {
      const code = generateRoomCode();
      const cfg =
        msg.customConfig && msg.customConfig.meta && Array.isArray(msg.customConfig.tiles)
          ? msg.customConfig
          : DEFAULT_CONFIG;

      const tok =
        cfg.tokens.find((t) => t.id === msg.tokenId) || cfg.tokens[0];
      const playerId = 'u_' + crypto.randomBytes(3).toString('hex');
      const reconnectKey = crypto.randomBytes(8).toString('hex');

      const room = {
        code,
        hostId: playerId,
        customConfig: cfg,
        players: [
          {
            id: playerId,
            name: (msg.name || 'Хост').trim().slice(0, 16),
            tokenId: tok.id,
            emoji: tok.emoji,
            isBot: false,
            reconnectKey
          }
        ],
        clients: new Map([[playerId, client]]),
        state: null,
        botTimer: null,
        createdAt: Date.now()
      };

      rooms.set(code, room);
      client.roomCode = code;
      client.playerId = playerId;

      client.send(
        JSON.stringify({
          type: 'roomJoined',
          code,
          playerId,
          isHost: true,
          reconnectKey,
          lobby: serializeLobby(room)
        })
      );
      return;
    }

    // 2. Вход в комнату по коду
    if (msg.type === 'joinRoom') {
      const code = String(msg.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return sendError('Комната с кодом ' + code + ' не найдена');
      if (room.state) return sendError('Партия в этой комнате уже идёт');
      if (room.players.length >= 6) return sendError('В комнате уже максимум игроков (6)');

      const usedTokens = new Set(room.players.map((p) => p.tokenId));
      let tok = room.customConfig.tokens.find((t) => t.id === msg.tokenId && !usedTokens.has(t.id));
      if (!tok) {
        tok = room.customConfig.tokens.find((t) => !usedTokens.has(t.id)) || room.customConfig.tokens[0];
      }

      const playerId = 'u_' + crypto.randomBytes(3).toString('hex');
      const reconnectKey = crypto.randomBytes(8).toString('hex');

      room.players.push({
        id: playerId,
        name: (msg.name || 'Игрок').trim().slice(0, 16),
        tokenId: tok.id,
        emoji: tok.emoji,
        isBot: false,
        reconnectKey
      });
      room.clients.set(playerId, client);
      client.roomCode = code;
      client.playerId = playerId;

      client.send(
        JSON.stringify({
          type: 'roomJoined',
          code,
          playerId,
          isHost: false,
          reconnectKey,
          lobby: serializeLobby(room)
        })
      );
      broadcastRoom(room, { type: 'lobbyUpdate', lobby: serializeLobby(room) });
      return;
    }

    // 3. Переподключение (если на iPhone погас экран)
    if (msg.type === 'reconnectRoom') {
      const room = rooms.get(String(msg.code || '').toUpperCase());
      if (!room) return;
      const p = room.players.find((x) => x.id === msg.playerId && x.reconnectKey === msg.reconnectKey);
      if (!p) return;

      room.clients.set(p.id, client);
      client.roomCode = room.code;
      client.playerId = p.id;

      if (room.state) {
        client.send(JSON.stringify({ type: 'gameStarted', state: room.state }));
      } else {
        client.send(
          JSON.stringify({
            type: 'roomJoined',
            code: room.code,
            playerId: p.id,
            isHost: room.hostId === p.id,
            reconnectKey: p.reconnectKey,
            lobby: serializeLobby(room)
          })
        );
      }
      return;
    }

    const room = client.roomCode ? rooms.get(client.roomCode) : null;
    if (!room) return;

    // 4. Добавление бота хостом
    if (msg.type === 'addBot') {
      if (room.hostId !== client.playerId || room.state) return;
      if (room.players.length >= 6) return sendError('Максимум 6 участников');
      const usedTokens = new Set(room.players.map((p) => p.tokenId));
      const tok =
        room.customConfig.tokens.find((t) => !usedTokens.has(t.id)) ||
        room.customConfig.tokens[room.players.length % room.customConfig.tokens.length];
      const botNum = room.players.filter((p) => p.isBot).length + 1;
      room.players.push({
        id: 'bot_' + Date.now() + '_' + botNum,
        name: `Бот ${botNum}`,
        tokenId: tok.id,
        emoji: tok.emoji,
        isBot: true
      });
      broadcastRoom(room, { type: 'lobbyUpdate', lobby: serializeLobby(room) });
      return;
    }

    // 5. Старт игры хостом
    if (msg.type === 'startGame') {
      if (room.hostId !== client.playerId) return sendError('Запустить игру может только создатель комнаты');
      if (room.players.length < 2) {
        return sendError('Нужно минимум 2 участника (пригласите друга или нажмите «+ Добавить бота»)');
      }
      room.state = Engine.createGame(room.players, room.customConfig);
      broadcastRoom(room, { type: 'gameStarted', state: room.state });
      scheduleRoomBots(room);
      return;
    }

    // 6. Игровой ход участника
    if (msg.type === 'gameAction' && room.state && msg.action) {
      const action = Object.assign({}, msg.action, { playerId: client.playerId });
      const res = Engine.applyAction(room.state, action);
      if (!res.ok) {
        return sendError(res.error);
      }
      broadcastRoom(room, { type: 'gameState', state: room.state });
      scheduleRoomBots(room);
      return;
    }

    // 7. Быстрый чат / эмоции
    if (msg.type === 'chat' && msg.text) {
      const sender = room.players.find((p) => p.id === client.playerId);
      broadcastRoom(room, {
        type: 'chat',
        playerId: client.playerId,
        name: sender ? sender.name : 'Игрок',
        text: String(msg.text).slice(0, 40)
      });
      return;
    }

    // 8. Выход из комнаты
    if (msg.type === 'leaveRoom') {
      room.clients.delete(client.playerId);
      if (!room.state) {
        room.players = room.players.filter((p) => p.id !== client.playerId);
        if (room.players.filter((p) => !p.isBot).length === 0) {
          clearTimeout(room.botTimer);
          rooms.delete(room.code);
        } else {
          if (room.hostId === client.playerId) {
            const nextHuman = room.players.find((p) => !p.isBot);
            if (nextHuman) room.hostId = nextHuman.id;
          }
          broadcastRoom(room, { type: 'lobbyUpdate', lobby: serializeLobby(room) });
        }
      }
      client.roomCode = null;
    }
  });

  client.onClose(() => {
    if (!client.roomCode) return;
    const room = rooms.get(client.roomCode);
    if (!room) return;
    room.clients.delete(client.playerId);
  });
});

// Получаем все локальные IPv4-адреса компьютера (Wi-Fi / локальная сеть)
function getLocalIPs() {
  const nets = os.networkInterfaces();
  const list = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        list.push({ name, address: net.address });
      }
    }
  }
  return list;
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.log(`✅ Сервер уже запущен на порту ${PORT}! Открываю браузер...`);
    if (process.platform === 'win32') {
      const { exec } = require('child_process');
      exec(`start "" "http://localhost:${PORT}"`);
    }
    process.exit(0);
  }
  console.error('Ошибка запуска сервера:', err);
});

server.listen(PORT, HOST, () => {
  const ips = getLocalIPs();
  console.log('============================================================');
  console.log('🎲 СЕРВЕР 2D МОНОПОЛИИ УСПЕШНО ЗАПУЩЕН!');
  console.log(`👉 На этом компьютере: http://localhost:${PORT}`);
  ips.forEach((ip) => {
    console.log(`📱 С телефона по сети (${ip.name}): http://${ip.address}:${PORT}`);
  });
  console.log('   (Не закрывай это чёрное окно, пока играешь)');
  console.log('============================================================');

  if (process.platform === 'win32' && process.env.OPEN_BROWSER === '1') {
    const { exec } = require('child_process');
    exec(`start "" "http://localhost:${PORT}"`);
  }
});
