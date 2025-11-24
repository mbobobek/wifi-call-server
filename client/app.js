const roomInput = document.getElementById('room');
const connectBtn = document.getElementById('connect');
const callBtn = document.getElementById('call');
const hangupBtn = document.getElementById('hangup');
const muteBtn = document.getElementById('mute');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const remoteAudio = document.getElementById('remote');

let ws = null;
let pc = null;
let localStream = null;
let roomId = null;
let muted = false;

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

connectBtn.onclick = () => {
  const value = roomInput.value.trim();
  if (!value) return log('Xona nomi kiriting');
  connect(value);
};

callBtn.onclick = async () => {
  if (!pc) return;
  await ensureLocalAudio();
  await makeOffer();
};

hangupBtn.onclick = () => {
  log('Uzildi');
  cleanup();
};

muteBtn.onclick = () => {
  muted = !muted;
  if (localStream) localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  muteBtn.textContent = muted ? 'Unmute' : 'Mute';
};

function connect(room) {
  if (ws) ws.close();
  roomId = room;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/ws`;
  log(`Signalingga ulanmoqda: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room: roomId }));
    setupPeer();
    callBtn.disabled = false;
    hangupBtn.disabled = false;
    muteBtn.disabled = false;
    log(`Xonaga ulandi: ${roomId}`);
  };

  ws.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'offer') {
      await ensureLocalAudio();
      await pc.setRemoteDescription(msg.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', answer }));
      log('Offer oldim, answer yuborildi');
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(msg.answer);
      log('Answer oldim');
    } else if (msg.type === 'candidate' && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        console.error('ICE add error', err);
      }
    } else if (msg.type === 'peer-joined') {
      log(`Hamkor qo'shildi, jami: ${msg.count}`);
    } else if (msg.type === 'peer-left') {
      log('Hamkor chiqdi');
    } else if (msg.type === 'error' && msg.reason === 'room-full') {
      log('Xona tola');
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

function setupPeer() {
  pc = new RTCPeerConnection({ iceServers }); // STUN/TURN bilan internetda ham ishlashi uchun
  pc.onicecandidate = (e) => {
    if (e.candidate) ws?.send(JSON.stringify({ type: 'candidate', candidate: e.candidate }));
  };
  pc.onconnectionstatechange = () => log(`Peer: ${pc.connectionState}`);
  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
  };
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

async function makeOffer() {
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  ws?.send(JSON.stringify({ type: 'offer', offer }));
  log('Offer yuborildi');
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
  if (ws && !keepWs) {
    ws.close();
    ws = null;
  }
  callBtn.disabled = true;
  hangupBtn.disabled = true;
  muteBtn.disabled = true;
}
