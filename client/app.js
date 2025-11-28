// DOM
const nameInput = document.getElementById('name');
const connectBtn = document.getElementById('connect');
const muteBtn = document.getElementById('mute');
const hangupBtn = document.getElementById('hangup');
const backBtn = document.getElementById('back');
const onlineCallEl = document.getElementById('online-call');
const onlineChatEl = document.getElementById('online-chat');
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
const routeEls = {
  home: document.getElementById('route-home'),
  call: document.getElementById('route-call'),
  chat: document.getElementById('route-chat')
};
const routeButtons = document.querySelectorAll('[data-route-btn]');
const chatPeerLabel = document.getElementById('chat-peer-label');
const chatMessagesEl = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const chatClose = document.getElementById('chat-close');

// Screens
const screens = {
  home: document.getElementById('screen-home'),
  calling: document.getElementById('screen-calling'),
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
let chatPeer = null; // { id, name }
const chatHistory = new Map(); // id -> messages
let onlinePeers = new Map();
let currentRoute = 'home';
let audioCtx = null;
let ringInterval = null;

let displayName = window.DISPLAY_NAME || localStorage.getItem('displayName') || `User-${Math.random().toString(16).slice(2, 6)}`;
nameInput.value = displayName;

// Helpers
const log = (text) => {
  statusEl.textContent = `Holat: ${text}`;
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = `${new Date().toLocaleTimeString()} | ${text}`;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
};

const showScreen = (name) => {
  Object.entries(screens).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle('active', key === name);
  });
};

const setRoute = (route) => {
  if (!routeEls[route]) return;
  currentRoute = route;
  Object.entries(routeEls).forEach(([key, el]) => {
    if (!el) return;
    el.classList.toggle('active', key === route);
  });
  routeButtons.forEach((btn) => {
    if (btn.dataset.routeBtn === route) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
};

const setState = (state, note) => {
  callState = state;
  statusEl.textContent = `Holat: ${state}`;
  if (note) log(note);
  updateDebug();

  if (state === CallState.IDLE || state === CallState.ENDED) {
    showScreen('home');
    ringEl.textContent = '';
    stopTimer();
    hangupBtn.disabled = true;
    muteBtn.disabled = true;
  } else if (state === CallState.CALLING_OUT) {
    showScreen('calling');
    hangupBtn.disabled = true;
    muteBtn.disabled = true;
  } else if (state === CallState.RINGING_IN) {
    showScreen('incoming');
    hangupBtn.disabled = true;
    muteBtn.disabled = true;
  } else if (state === CallState.CONNECTING || state === CallState.IN_CALL) {
    showScreen('incall');
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

const formatClock = (ts) => {
  const d = new Date(ts || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const ensureAudioCtx = () => {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch (err) {
    console.warn('AudioContext error', err);
    return null;
  }
};

const stopRingTone = () => {
  if (ringInterval) clearInterval(ringInterval);
  ringInterval = null;
};

const startRingTone = () => {
  stopRingTone();
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  ringInterval = setInterval(() => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 880;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }, 900);
};

const getPeerName = (id, fallback = '') => {
  if (!id) return fallback;
  if (id === selfId) return displayName;
  if (onlinePeers.has(id)) return onlinePeers.get(id).name || id;
  if (chatPeer?.id === id) return chatPeer.name || id;
  if (currentPeer?.id === id) return currentPeer.name || id;
  return fallback || id;
};

function setChatPeer(peer) {
  chatPeer = peer;
  if (peer) {
    const isOnline = onlinePeers.has(peer.id);
    const label = peer.name || peer.id;
    chatPeerLabel.textContent = `Chat: ${label}${isOnline ? '' : ' (offline)'}`;
    chatMessagesEl.classList.remove('muted');
    chatInput.disabled = !(ws && ws.readyState === WebSocket.OPEN);
    chatSend.disabled = chatInput.disabled;
  } else {
    chatPeerLabel.textContent = 'Foydalanuvchi tanlang';
    chatMessagesEl.textContent = 'Hali tanlanmagan';
    chatMessagesEl.classList.add('muted');
    chatInput.disabled = true;
    chatSend.disabled = true;
  }
  renderChatMessages(peer?.id);
}

function renderChatMessages(peerId) {
  chatMessagesEl.innerHTML = '';
  if (!peerId) {
    chatMessagesEl.textContent = 'Hali tanlanmagan';
    chatMessagesEl.classList.add('muted');
    return;
  }
  const msgs = chatHistory.get(peerId) || [];
  if (!msgs.length) {
    chatMessagesEl.textContent = 'Hozircha xabar yo\'q';
    chatMessagesEl.classList.add('muted');
    return;
  }
  chatMessagesEl.classList.remove('muted');
  msgs.forEach((m) => {
    const wrap = document.createElement('div');
    wrap.className = `chat-bubble ${m.fromSelf ? 'self' : 'remote'}`;
    const meta = document.createElement('div');
    meta.className = 'chat-meta';
    meta.textContent = `${m.fromSelf ? 'Siz' : getPeerName(peerId, 'Hamkor')} \u2022 ${formatClock(m.ts)}`;
    const body = document.createElement('div');
    body.textContent = m.text;
    wrap.appendChild(meta);
    wrap.appendChild(body);
    chatMessagesEl.appendChild(wrap);
  });
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function addChatMessage(peerId, payload) {
  const msgs = chatHistory.get(peerId) || [];
  msgs.push(payload);
  chatHistory.set(peerId, msgs);
  if (chatPeer && chatPeer.id === peerId) renderChatMessages(peerId);
}

function openChat(peer) {
  setRoute('chat');
  setChatPeer(peer);
  chatInput.focus();
}

function closeChatPanel() {
  setChatPeer(null);
}

function sendChat() {
  if (!chatPeer) return log('Avval chat uchun foydalanuvchini tanlang');
  if (!ws || ws.readyState !== WebSocket.OPEN) return log('Avval onlayn bo\'ling');
  const text = chatInput.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ type: 'message', target: chatPeer.id, text }));
  chatInput.value = '';
}

// Event bindings
connectBtn.onclick = () => connectWS();
outgoingCancelBtn.onclick = () => hangup('cancelled');
incomingAcceptBtn.onclick = () => acceptIncoming();
incomingDeclineBtn.onclick = () => rejectIncoming();
hangupBtn.onclick = () => hangup('hangup');
if (backBtn) backBtn.onclick = () => hangup('back');
muteBtn.onclick = () => toggleMute();
chatSend.onclick = () => sendChat();
chatClose.onclick = () => closeChatPanel();
chatInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});
routeButtons.forEach((btn) => {
  btn.onclick = () => setRoute(btn.dataset.routeBtn);
});

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
    if (chatPeer) setChatPeer(chatPeer);
  };

  ws.onmessage = async ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'welcome') {
      selfId = msg.id;
      if (msg.name) displayName = msg.name;
      log(`Siz: ${displayName}`);
    } else if (msg.type === 'online') {
      renderOnline(msg.peers || []);
    } else if (msg.type === 'message') {
      handleIncomingMessage(msg);
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
      if (callState !== CallState.IDLE) endCall();
    }
  };

  ws.onclose = () => {
    log('Signaling uzildi');
    cleanupPeer(true);
    if (chatPeer) setChatPeer(chatPeer);
  };

  ws.onerror = (err) => {
    console.error(err);
    log('Signaling xatolik');
  };
}

// Online list
function renderOnlineList(container, peers, mode) {
  if (!container) return;
  container.innerHTML = '';
  const others = peers.filter((p) => p.id !== selfId);
  if (!others.length) {
    container.textContent = 'Hozircha hech kim onlayn emas';
    return;
  }
  others.forEach((peer) => {
    const item = document.createElement('div');
    item.className = 'online-item';
    const nameEl = document.createElement('div');
    nameEl.className = 'online-name';
    nameEl.textContent = peer.name || peer.id;
    const actions = document.createElement('div');
    actions.className = 'online-actions';
    if (mode === 'call') {
      const callBtn = document.createElement('button');
      callBtn.className = 'primary pill small';
      callBtn.textContent = 'Qo\'ng\'iroq';
      callBtn.onclick = () => initiateCall(peer);
      actions.appendChild(callBtn);
    }
    const chatBtn = document.createElement('button');
    chatBtn.className = mode === 'call' ? 'ghost pill small' : 'primary pill small';
    chatBtn.textContent = 'Chat';
    chatBtn.onclick = () => openChat({ id: peer.id, name: peer.name || peer.id });
    actions.appendChild(chatBtn);
    item.appendChild(nameEl);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function renderOnline(peers) {
  onlinePeers = new Map(peers.map((p) => [p.id, p]));
  renderOnlineList(onlineCallEl, peers, 'call');
  renderOnlineList(onlineChatEl, peers, 'chat');
  if (chatPeer) setChatPeer(chatPeer);
}

function handleIncomingMessage(msg) {
  const peerId = msg.from === selfId ? msg.target : msg.from;
  if (!peerId || typeof msg.text !== 'string') return;
  const payload = {
    fromSelf: msg.from === selfId,
    text: msg.text,
    ts: msg.ts || Date.now()
  };
  addChatMessage(peerId, payload);
  if (!chatPeer || chatPeer.id !== peerId) {
    const name = getPeerName(peerId, msg.name || 'Hamkor');
    log(`Yangi xabar: ${name}`);
  }
}

// Call flows
function initiateCall(peer) {
  setRoute('call');
  if (!ws || ws.readyState !== WebSocket.OPEN) return log("Avval onlayn bo'lish");
  if (callState !== CallState.IDLE) return log('Hozircha band');
  currentPeer = { id: peer.id, name: peer.name || peer.id };
  updatePeerLabels();
  setState(CallState.CALLING_OUT, `Qo'ng'iroq: ${currentPeer.name}`);
  ws.send(JSON.stringify({ type: 'call', target: currentPeer.id }));
  setRinging('Chaqirilmoqda...');
}

function handleIncomingCall(msg) {
  setRoute('call');
  if (callState !== CallState.IDLE) {
    ws?.send(JSON.stringify({ type: 'busy', target: msg.from }));
    return;
  }
  currentPeer = { id: msg.from, name: msg.name || msg.from };
  updatePeerLabels();
  setState(CallState.RINGING_IN, `${currentPeer.name} qo'ng'iroq qilmoqda`);
  setRinging("Kirish qo'ng'irog'i");
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
  setState(CallState.IDLE, "Bo'sh");
}

// WebRTC helpers
function ensurePeer() {
  if (pc) return;
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: [
          'turn:openrelay.metered.ca:80?transport=udp',
          'turn:openrelay.metered.ca:80?transport=tcp',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  });
  pc.onicecandidate = (e) => {
    if (e.candidate && currentPeer) {
      ws?.send(JSON.stringify({ type: 'candidate', target: currentPeer.id, candidate: e.candidate }));
    }
  };
  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.play?.().catch(() => {});
    if (callState === CallState.CONNECTING) {
      setState(CallState.IN_CALL, 'Audio qabul qilindi');
      setRinging('');
      startTimer();
    }
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
  pc.oniceconnectionstatechange = () => {
    log(`ICE: ${pc.iceConnectionState}`);
    updateDebug();
  };
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
  const audioTrack = localStream.getAudioTracks()[0];
  if (!audioTrack) return;
  const haveAudio = pc.getSenders().some((s) => s.track && s.track.kind === 'audio');
  if (!haveAudio) {
    pc.addTrack(audioTrack, localStream);
  }
  audioTrack.enabled = !muted;
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
  if (text) {
    startRingTone();
  } else {
    stopRingTone();
  }
}

function updatePeerLabels() {
  const name = currentPeer?.name || '';
  outgoingNameEl.textContent = name;
  incomingNameEl.textContent = name;
  incallNameEl.textContent = name;
}

// Init UI
setRoute('home');
setChatPeer(null);
setState(CallState.IDLE);
updateDebug();


