import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import express from 'express';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

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

const clients = new Map(); // id -> { ws, name }

const safeParse = (raw) => {
  try { return JSON.parse(raw); } catch { return null; }
};

const broadcastOnline = () => {
  const peers = [...clients.entries()].map(([id, info]) => ({
    id,
    name: info.name
  }));
  const payload = JSON.stringify({ type: 'online', peers });
  clients.forEach(({ ws }) => {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  });
};

wss.on('connection', (ws) => {
  const id = crypto.randomUUID();
  let name = `User-${id.slice(0, 6)}`;
  clients.set(id, { ws, name });
  ws.send(JSON.stringify({ type: 'welcome', id, name }));
  broadcastOnline();

  const sendTo = (targetId, payload) => {
    const target = clients.get(targetId);
    if (!target || target.ws.readyState !== target.ws.OPEN) return false;
    target.ws.send(JSON.stringify(payload));
    return true;
  };

  ws.on('message', (raw) => {
    const msg = safeParse(raw);
    if (!msg) return;

    // Registration / naming
    if (msg.type === 'join' && typeof msg.name === 'string') {
      name = msg.name.trim() || name;
      clients.set(id, { ws, name });
      broadcastOnline();
      return;
    }

    if (msg.type === 'set-name' && typeof msg.name === 'string') {
      name = msg.name.trim() || name;
      clients.set(id, { ws, name });
      broadcastOnline();
      return;
    }

    // Call signaling (no rooms, direct)
    if (msg.type === 'call' || msg.type === 'call-accept' || msg.type === 'call-reject' || msg.type === 'busy') {
      const targetId = msg.target;
      if (typeof targetId !== 'string') return;
      const ok = sendTo(targetId, { type: msg.type, from: id, name, note: msg.note });
      if (!ok) ws.send(JSON.stringify({ type: 'error', reason: 'target-offline' }));
      return;
    }

    if (msg.type === 'offer' || msg.type === 'answer' || msg.type === 'candidate') {
      const targetId = msg.target;
      if (typeof targetId !== 'string') return;
      const ok = sendTo(targetId, {
        type: msg.type,
        from: id,
        ...(msg.type === 'offer' ? { offer: msg.offer } : {}),
        ...(msg.type === 'answer' ? { answer: msg.answer } : {}),
        ...(msg.type === 'candidate' ? { candidate: msg.candidate } : {})
      });
      if (!ok) ws.send(JSON.stringify({ type: 'error', reason: 'target-offline' }));
      return;
    }

    if (msg.type === 'bye') {
      const targetId = msg.target;
      const payload = { type: 'bye', from: id };
      if (typeof targetId === 'string') sendTo(targetId, payload);
      ws.send(JSON.stringify(payload)); // echo back for local cleanup
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(id);
    broadcastOnline();
  });
});

server.listen(PORT, HOST, () => {
  const scheme = USE_HTTPS ? 'https' : 'http';
  const wsScheme = USE_HTTPS ? 'wss' : 'ws';
  console.log(`Static: ${scheme}://${HOST}:${PORT}`);
  console.log(`Signaling: ${wsScheme}://${HOST}:${PORT}/ws`);
});
