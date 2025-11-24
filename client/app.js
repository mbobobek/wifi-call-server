const connectBtn = document.getElementById('connect');
const hangupBtn = document.getElementById('hangup');
const muteBtn = document.getElementById('mute');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const remoteAudio = document.getElementById('remote');
const onlineEl = document.getElementById('online');

let ws = null;
let pc = null;
let localStream = null;
let muted = false;
let selfId = null;
let currentPeerId = null;
let displayName = window.DISPLAY_NAME || `User-${Math.random().toString(16).slice(2, 6)}`;

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(window.TURN_URL ? [{
    urls: window.TURN_URL,
    username: window.TURN_USER,
    credential: window.TURN_PASS,
  }] : [])
];

const log = (text) => {
  statusEl.textContent = `Holat: ${text}`;
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = `${new Date().toLocaleTimeString()} | ${text}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
};

connectBtn.onclick = () => connect();

hangupBtn.onclick = () => {
  log('Uzildi');
  cleanup();
};

muteBtn.onclick = () => {
  muted = !muted;
  if (localStream) localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  muteBtn.textContent = muted ? 'Unmute' : 'Mute';
};

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return log('Allaqachon ulangan');
  if (ws && ws.readyState === WebSocket.CONNECTING) return log('Ulanmoqda...');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/ws`;
  log(`Signalingga ulanmoqda: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name: displayName }));
    hangupBtn.disabled = false;
    muteBtn.disabled = false;
    log('Signaling ulandi');
  };

  ws.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'welcome') {
      selfId = msg.id;
      if (msg.name) displayName = msg.name;
      log(`Siz: ${displayName}`);
    } else if (msg.type === 'online') {
      renderOnline(msg.peers || []);
    } else if (msg.type === 'offer') {
      currentPeerId = msg.from;
      ensurePeer();
      await ensureLocalAudio();
      await pc.setRemoteDescription(msg.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', target: msg.from, answer }));
      log(`Offer oldim, ${msg.from} ga answer yuborildi`);
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(msg.answer);
      log('Answer oldim');
    } else if (msg.type === 'candidate' && msg.candidate) {
      try {
        ensurePeer();
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.error('ICE add error', err);
      }
    } else if (msg.type === 'error' && msg.reason) {
      log(`Xato: ${msg.reason}`);
    }
  };

  ws.onclose = () => {
    log('Signaling uzildi');
    cleanup(true);
  };

  ws.onerror = (err) => {
    console.error(err);
    log('Signaling xatolik');
  };
}

function renderOnline(peers) {
  onlineEl.innerHTML = '';
  const others = peers.filter((p) => p.id !== selfId);
  if (!others.length) {
    onlineEl.textContent = 'Hozircha hech kim onlayn emas';
    return;
  }
  others.forEach((peer) => {
    const btn = document.createElement('button');
    btn.textContent = peer.name || peer.id;
    btn.onclick = () => startCall(peer.id);
    onlineEl.appendChild(btn);
  });
}

function ensurePeer() {
  if (pc) return;
  pc = new RTCPeerConnection({ iceServers }); // STUN/TURN bilan internetda ham ishlashi uchun
  pc.onicecandidate = (e) => {
    if (e.candidate && currentPeerId) {
      ws?.send(JSON.stringify({ type: 'candidate', target: currentPeerId, candidate: e.candidate }));
    }
  };
  pc.onconnectionstatechange = () => log(`Peer: ${pc.connectionState}`);
  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
  };
}

async function startCall(targetId) {
  currentPeerId = targetId;
  ensurePeer();
  await ensureLocalAudio();
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  ws?.send(JSON.stringify({ type: 'offer', target: targetId, offer }));
  log(`Offer yuborildi: ${targetId}`);
}

async function ensureLocalAudio() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  } catch (err) {
    console.error(err);
    log('Mikrofon ruxsati berilmadi');
    throw err;
  }
}

function cleanup(keepWs = false) {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (pc) {
    pc.getSenders().forEach((s) => pc.removeTrack(s));
    pc.close();
    pc = null;
  }
  currentPeerId = null;
  if (ws && !keepWs) {
    ws.close();
    ws = null;
  }
  hangupBtn.disabled = true;
  muteBtn.disabled = true;
}
