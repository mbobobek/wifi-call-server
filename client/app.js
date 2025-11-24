// DOM
const nameInput = document.getElementById('name');
const connectBtn = document.getElementById('connect');
const muteBtn = document.getElementById('mute');
const hangupBtn = document.getElementById('hangup');
const onlineEl = document.getElementById('online');
const logEl = document.getElementById('log');
const statusEl = document.getElementById('status');
const ringEl = document.getElementById('ring');
const remoteAudio = document.getElementById('remote');
const outgoingNameEl = document.getElementById('outgoing-name');
const incomingNameEl = document.getElementById('incoming-name');
const incallNameEl = document.getElementById('incall-name');
const timerEl = document.getElementById('call-timer');
const debugState = document.getElementById('debug-state');
const debugPC = document.getElementById('debug-pc');
const debugICE = document.getElementById('debug-ice');
const debugSignal = document.getElementById('debug-signal');

// Screens
const screens = {
  home: document.getElementById('screen-home'),
  outgoing: document.getElementById('screen-outgoing'),
  incoming: document.getElementById('screen-incoming'),
  incall: document.getElementById('screen-incall')
};

// Buttons on screens
const outgoingCancelBtn = document.getElementById('outgoing-cancel');
const incomingAcceptBtn = document.getElementById('incoming-accept');
const incomingDeclineBtn = document.getElementById('incoming-decline');

// State
const CallState = {
  IDLE: 'idle',
  CALLING_OUT: 'calling_out',
  RINGING_IN: 'ringing_in',
  CONNECTING: 'connecting',
  IN_CALL: 'in_call',
  ENDED: 'ended'
};

let ws = null;
let pc = null;
let localStream = null;
let muted = false;
let callState = CallState.IDLE;
let selfId = null;
let currentPeer = null; // { id, name }
let callTimer = null;
let callStart = null;

let displayName = window.DISPLAY_NAME || localStorage.getItem('displayName') || `User-${Math.random().toString(16).slice(2, 6)}`;
nameInput.value = displayName;

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(window.TURN_URL ? [{
    urls: window.TURN_URL,
    username: window.TURN_USER,
    credential: window.TURN_PASS,
  }] : [])
];

// Helpers
const log = (text) => {
  statusEl.textContent = `Holat: ${text}`;
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = `${new Date().toLocaleTimeString()} | ${text}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
};

const setScreen = (name) => {
  Object.entries(screens).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle('hidden', key !== name);
  });
};

const setState = (state, note) => {
  callState = state;
  statusEl.textContent = `Holat: ${state}`;
  if (note) log(note);
  updateDebug();

  if (state === CallState.IDLE || state === CallState.ENDED) {
    setScreen('home');
    ringEl.textContent = '';
    stopTimer();
    hangupBtn.disabled = true;
    muteBtn.disabled = true;
  } else if (state === CallState.CALLING_OUT) {
    setScreen('outgoing');
    hangupBtn.disabled = true;
    muteBtn.disabled = true;
  } else if (state === CallState.RINGING_IN) {
    setScreen('incoming');
    hangupBtn.disabled = true;
    muteBtn.disabled = true;
  } else if (state === CallState.CONNECTING || state === CallState.IN_CALL) {
    setScreen('incall');
    hangupBtn.disabled = false;
    muteBtn.disabled = state === CallState.CONNECTING; // mute faqat ulanishdan keyin
  }
};

const updateDebug = () => {
  debugState.textContent = callState;
  debugPC.textContent = pc ? pc.connectionState : 'none';
  debugICE.textContent = pc ? pc.iceConnectionState : 'none';
  debugSignal.textContent = pc ? pc.signalingState : 'none';
};

const startTimer = () => {
  stopTimer();
  callStart = Date.now();
  callTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - callStart) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }, 1000);
};
const stopTimer = () => {
  if (callTimer) clearInterval(callTimer);
  callTimer = null;
  timerEl.textContent = '00:00';
};

// Event bindings
connectBtn.onclick = () => connectWS();
outgoingCancelBtn.onclick = () => hangup('cancelled');
incomingAcceptBtn.onclick = () => acceptIncoming();
incomingDeclineBtn.onclick = () => rejectIncoming();
hangupBtn.onclick = () => hangup('hangup');
muteBtn.onclick = () => toggleMute();

nameInput.onchange = () => {
  displayName = nameInput.value.trim() || displayName;
  localStorage.setItem('displayName', displayName);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'set-name', name: displayName }));
  }
};

// WS
function connectWS() {
  if (ws && ws.readyState === WebSocket.OPEN) return log('Allaqachon ulangan');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/ws`;
  log(`Signalingga ulanmoqda: ${wsUrl}`);
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', name: displayName }));
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
    } else if (msg.type === 'call') {
      handleIncomingCall(msg);
    } else if (msg.type === 'busy' || msg.type === 'call-reject') {
      log(msg.type === 'busy' ? 'Hamkor band' : 'Rad etildi');
      endCall();
    } else if (msg.type === 'call-accept') {
      log('Qabul qilindi, offer yaratilmoqda');
      await startOfferFlow();
    } else if (msg.type === 'offer') {
      await handleOffer(msg);
    } else if (msg.type === 'answer') {
      await handleAnswer(msg);
    } else if (msg.type === 'candidate' && msg.candidate) {
      await handleCandidate(msg);
    } else if (msg.type === 'bye') {
      log('Hamkor uzildi');
      endCall();
    } else if (msg.type === 'error' && msg.reason) {
      log(`Xato: ${msg.reason}`);
      endCall();
    }
  };

  ws.onclose = () => {
    log('Signaling uzildi');
    cleanupPeer(true);
  };

  ws.onerror = (err) => {
    console.error(err);
    log('Signaling xatolik');
  };
}

// Online list
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
    btn.onclick = () => initiateCall(peer);
    onlineEl.appendChild(btn);
  });
}

// Call flows
function initiateCall(peer) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return log('Avval online bo‘ling');
  if (callState !== CallState.IDLE) return log('Hozircha band');
  currentPeer = { id: peer.id, name: peer.name || peer.id };
  updatePeerLabels();
  setState(CallState.CALLING_OUT, `Qo‘ng‘iroq: ${currentPeer.name}`);
  ws.send(JSON.stringify({ type: 'call', target: currentPeer.id }));
  setRinging('Chaqirilmoqda...');
}

function handleIncomingCall(msg) {
  if (callState !== CallState.IDLE) {
    ws?.send(JSON.stringify({ type: 'busy', target: msg.from }));
    return;
  }
  currentPeer = { id: msg.from, name: msg.name || msg.from };
  updatePeerLabels();
  setState(CallState.RINGING_IN, `${currentPeer.name} qo‘ng‘iroq qilmoqda`);
  setRinging('Kirish qo‘ng‘irog‘i');
}

async function acceptIncoming() {
  if (!currentPeer) return;
  setState(CallState.CONNECTING, 'Qabul qilindi');
  ws?.send(JSON.stringify({ type: 'call-accept', target: currentPeer.id }));
  await ensureLocalAudio();
  ensurePeer();
  attachLocalTracks();
  setRinging('Ulanmoqda...');
}

function rejectIncoming() {
  if (!currentPeer) return;
  ws?.send(JSON.stringify({ type: 'call-reject', target: currentPeer.id }));
  endCall();
}

async function startOfferFlow() {
  if (!currentPeer) return;
  setState(CallState.CONNECTING, 'Offer yaratilmoqda');
  await ensureLocalAudio();
  ensurePeer();
  attachLocalTracks();
  const offer = await pc.createOffer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(offer);
  ws?.send(JSON.stringify({ type: 'offer', target: currentPeer.id, offer }));
  setRinging('Javob kutilmoqda...');
}

async function handleOffer(msg) {
  const peerName = msg.name || currentPeer?.name || msg.from;
  currentPeer = { id: msg.from, name: peerName };
  updatePeerLabels();
  setState(CallState.CONNECTING, 'Offer qabul qilindi');
  await ensureLocalAudio();
  ensurePeer();
  await pc.setRemoteDescription(msg.offer);
  attachLocalTracks();
  const answer = await pc.createAnswer({ offerToReceiveAudio: true });
  await pc.setLocalDescription(answer);
  ws?.send(JSON.stringify({ type: 'answer', target: msg.from, answer }));
  setRinging('Ulanmoqda...');
}

async function handleAnswer(msg) {
  await pc?.setRemoteDescription(msg.answer);
  setRinging('Ulanmoqda...');
}

async function handleCandidate(msg) {
  if (!pc) return;
  try {
    await pc.addIceCandidate(msg.candidate);
  } catch (err) {
    console.error('ICE add error', err);
  }
}

function hangup(reason = 'uzildi') {
  if (currentPeer && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'bye', target: currentPeer.id }));
  }
  log(reason);
  endCall();
}

function endCall() {
  setRinging('');
  cleanupPeer();
  currentPeer = null;
  setState(CallState.IDLE, 'Bo‘sh');
}

// WebRTC helpers
function ensurePeer() {
  if (pc) return;
  pc = new RTCPeerConnection({ iceServers });
  pc.onicecandidate = (e) => {
    if (e.candidate && currentPeer) {
      ws?.send(JSON.stringify({ type: 'candidate', target: currentPeer.id, candidate: e.candidate }));
    }
  };
  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.play?.().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    log(`Peer: ${pc.connectionState}`);
    updateDebug();
    if (pc.connectionState === 'connected') {
      setState(CallState.IN_CALL, 'Ulandi');
      setRinging('');
      startTimer();
    }
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      endCall();
    }
  };
  pc.oniceconnectionstatechange = () => updateDebug();
  pc.onsignalingstatechange = () => updateDebug();
}

async function ensureLocalAudio() {
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (err) {
    console.error(err);
    log('Mikrofon ruxsati berilmadi');
    throw err;
  }
}

function attachLocalTracks() {
  if (!pc || !localStream) return;
  const haveAudio = pc.getSenders().some((s) => s.track && s.track.kind === 'audio');
  if (!haveAudio) {
    localStream.getTracks().forEach((t) => {
      pc.addTrack(t, localStream);
      t.enabled = !muted;
    });
  } else {
    localStream.getTracks().forEach((t) => { t.enabled = !muted; });
  }
}

function toggleMute() {
  muted = !muted;
  if (localStream) localStream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
  muteBtn.textContent = muted ? 'Unmute' : 'Mute';
}

function cleanupPeer(keepWs = true) {
  stopTimer();
  if (pc) {
    pc.getSenders().forEach((s) => {
      try { pc.removeTrack(s); } catch {}
    });
    pc.close();
    pc = null;
  }
  if (ws && !keepWs) {
    ws.close();
    ws = null;
  }
  remoteAudio.srcObject = null;
  currentPeer = null;
  updateDebug();
}

function setRinging(text) {
  ringEl.textContent = text || '';
}

function updatePeerLabels() {
  const name = currentPeer?.name || '';
  outgoingNameEl.textContent = name;
  incomingNameEl.textContent = name;
  incallNameEl.textContent = name;
}

// Init UI
setState(CallState.IDLE);
updateDebug();
