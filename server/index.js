import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import express from 'express';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 4430;
const HOST = process.env.HOST || '0.0.0.0';
const USE_HTTPS = process.env.USE_HTTPS !== 'false'; // Render'da falsga qo'ying (TLS terminatsiya qiladi)
const CERT_DIR = process.env.CERT_DIR || path.join(__dirname, '..', 'cert');
const STATIC_DIR = path.join(__dirname, '..', 'client');

let httpsOptions = null;
if (USE_HTTPS) {
  const keyPath = path.join(CERT_DIR, 'server.key');
  const certPath = path.join(CERT_DIR, 'server.crt');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error('TLS cert yoki key topilmadi. cert/server.crt va cert/server.key qoying.');
    process.exit(1);
  }
  httpsOptions = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };
}

const app = express();
app.use(express.static(STATIC_DIR));
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = USE_HTTPS
  ? https.createServer(httpsOptions, app)
  : http.createServer(app); // Render TLS terminatsiya qiladi, shuning uchun prod HTTP yetarli
const wss = new WebSocketServer({ server, path: '/ws' });

const rooms = new Map(); // roomId -> Set<WebSocket>

const safeParse = (raw) => {
  try { return JSON.parse(raw); } catch { return null; }
};

const broadcast = (roomId, sender, payload) => {
  const peers = rooms.get(roomId);
  if (!peers) return;
  peers.forEach((client) => {
    if (client !== sender && client.readyState === client.OPEN) {
      client.send(payload);
    }
  });
};

wss.on('connection', (ws) => {
  let roomId = null;

  ws.on('message', (raw) => {
    const msg = safeParse(raw);
    if (!msg) return;

    if (msg.type === 'join' && typeof msg.room === 'string') {
      roomId = msg.room.trim();
      if (!roomId) return;
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const peers = rooms.get(roomId);
      peers.add(ws);
      if (peers.size > 2) {
        ws.send(JSON.stringify({ type: 'error', reason: 'room-full' }));
      }
      broadcast(roomId, ws, JSON.stringify({ type: 'peer-joined', count: peers.size }));
      return;
    }

    if (!roomId) return;

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'candidate') {
      broadcast(roomId, ws, raw.toString());
    }
  });

  ws.on('close', () => {
    if (!roomId) return;
    const peers = rooms.get(roomId);
    if (!peers) return;
    peers.delete(ws);
    broadcast(roomId, ws, JSON.stringify({ type: 'peer-left' }));
    if (peers.size === 0) rooms.delete(roomId);
  });
});

server.listen(PORT, HOST, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  const wsScheme = USE_HTTPS ? 'wss' : 'ws';
  console.log(`Static: ${scheme}://${HOST}:${PORT}`);
  console.log(`Signaling: ${wsScheme}://${HOST}:${PORT}/ws`);
});
