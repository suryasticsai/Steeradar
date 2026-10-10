// js/chat.js — Persistent peer chat.
// Combines real-time WebRTC delivery with cloud persistence.
// Every message goes BOTH to the peer (instant) and to the messages sheet (durable).

import { api } from './api.js';
import { state, showToast, storage, timeAgo } from './store.js';

const CFG = window.STEERADAR || {};

// ─── STATE ───
let activeRoomId = null;      // lane id, or 'local-<geohash>', or 'peer-<vehicle>'
let activePeerId = null;      // target peer's PeerJS id (for direct delivery)
let activeMeta = null;        // { name, avatar, mine }
let ownLaneHintShown = false;

// ─── PUBLIC: BOOT ───
export function initChat() {
  const input = document.getElementById('chatInput');
  const send  = document.getElementById('chatSend');

  if (send) send.onclick = sendCurrentMessage;
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCurrentMessage(); }
    });
  }

  // Listen for incoming peer chat messages
  window.addEventListener('steeradar:peer-chat', (e) => {
    const { text, sender, roomId } = e.detail || {};
    if (!text) return;
    // If the modal is open on the same room, append live
    if (activeRoomId === roomId) addBubble(text, sender || 'Peer', 'them');
    // Persist anyway so history survives
    saveToCloud(roomId, text, sender);
    // Notify if background
    notifyIfHidden(sender, text);
  });

  // Listen for peer connection state changes
  window.addEventListener('steeradar:peer-open', (e) => {
    setStatus(true, 'Connected');
    addSystemBubble('Connected');
  });
  window.addEventListener('steeradar:peer-close', () => {
    setStatus(false, 'Disconnected');
    addSystemBubble('Peer disconnected');
  });
  window.addEventListener('steeradar:peer-error', (e) => {
    setStatus(false, e.detail?.message || 'Connection failed');
    addSystemBubble(e.detail?.message || 'Could not reach peer');
  });
}

// ─── OPEN A LANE CHAT ───
export function openChatForLane(lane) {
  if (!lane) return;

  activeRoomId = lane.id;
  activePeerId = lane.peerId || (lane.mine ? state.peerId : 'steeradar-veh-' + (lane.vehicle || lane.id));
  activeMeta = {
    name: lane.driver || 'Driver',
    avatar: lane.avatar || (lane.driver || 'DR').substring(0, 2).toUpperCase(),
    mine: !!lane.mine,
  };
  ownLaneHintShown = false;

  prepareModal();
  loadHistory(activeRoomId);

  if (lane.mine) {
    setStatus(true, 'Your lane · waiting for passengers');
    addSystemBubble('This is your lane. Others can reach you here.');
    return;
  }

  // Try to establish a live WebRTC connection
  if (!state.peer || !state.peer.open) {
    setStatus(false, 'Connecting…');
    addSystemBubble('Waiting for the WebRTC network…');
    setTimeout(() => openChatForLane(lane), 1500);
    return;
  }

  if (state.connections.has(activePeerId)) {
    setStatus(true, 'Connected');
    return;
  }

  setStatus(false, 'Connecting…');
  addSystemBubble('Dialing ' + lane.driver + '…');

  let conn;
  try { conn = state.peer.connect(activePeerId, { reliable: true }); }
  catch { setStatus(false, 'Peer unavailable'); addSystemBubble('Could not reach this lane.'); return; }

  let opened = false;
  const timeout = setTimeout(() => {
    if (!opened) {
      setStatus(false, 'Peer offline');
      addSystemBubble('This driver is not online right now.');
      try { conn.close(); } catch {}
    }
  }, 6000);

  conn.on('open', () => {
    opened = true;
    clearTimeout(timeout);
    state.connections.set(activePeerId, conn);
    setStatus(true, 'Connected');
    addSystemBubble('Connected');
  });
  conn.on('error', () => {
    clearTimeout(timeout);
    setStatus(false, 'Connection failed');
    addSystemBubble('Could not connect to peer.');
  });
}

// ─── OPEN A LOCAL MESH CHAT ───
export function openLocalChat(peerId) {
  activeRoomId = 'local-' + (state.userGeohash || 'mesh');
  activePeerId = null;
  activeMeta = {
    name: peerId === 'room'
      ? 'Neighbourhood room'
      : ((state.localPeers.get(peerId)?.name) || 'Neighbour'),
    avatar: '📡',
    mine: false,
  };
  ownLaneHintShown = false;

  prepareModal();
  loadHistory(activeRoomId);
  setStatus(true, state.localConns.size + ' connected', 'purple');
  addSystemBubble('You are on the local mesh · ' + (state.userGeohash ? state.userGeohash.toUpperCase() : ''));
  if (state.localConns.size === 0) addSystemBubble('Waiting for neighbours to join…');
}

// ─── PREPARE MODAL ───
function prepareModal() {
  const avatarEl = document.getElementById('chatAvatar');
  const nameEl   = document.getElementById('chatName');
  const box      = document.getElementById('chatMessages');
  const input    = document.getElementById('chatInput');

  if (avatarEl) {
    avatarEl.textContent = activeMeta?.avatar || '?';
    avatarEl.classList.toggle('bt', activeRoomId?.startsWith('local-'));
  }
  if (nameEl) nameEl.textContent = activeMeta?.name || 'Chat';
  if (box) box.innerHTML = '';
  if (input) input.value = '';

  document.getElementById('chatModal')?.classList.add('active');
  setTimeout(() => input?.focus(), 200);
}

// ─── SEND ───
function sendCurrentMessage() {
  const input = document.getElementById('chatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;

  // Local echo
  addBubble(text, state.userName, 'me');

  // Own lane → hint once, don't deliver anywhere
  if (activeMeta?.mine) {
    if (!ownLaneHintShown) {
      addSystemBubble('(Your own lane — only you see this)');
      ownLaneHintShown = true;
    }
    saveToCloud(activeRoomId, text, state.userName);
    input.value = '';
    return;
  }

  // Local mesh → fan out to all local connections
  if (activeRoomId?.startsWith('local-')) {
    let sent = 0;
    for (const conn of state.localConns.values()) {
      if (conn.open) {
        try {
          conn.send({ type: 'chat', text, sender: state.userName });
          sent++;
        } catch {}
      }
    }
    if (!sent) addSystemBubble('(No neighbours connected)');
    saveToCloud(activeRoomId, text, state.userName);
    input.value = '';
    return;
  }

  // 1:1 lane chat
  const conn = activePeerId ? state.connections.get(activePeerId) : null;
  if (conn && conn.open) {
    try { conn.send({ type: 'chat', text, sender: state.userName }); }
    catch { showToast('Send failed', 'error'); }
  } else {
    addSystemBubble('(Not delivered — peer offline)');
  }

  saveToCloud(activeRoomId, text, state.userName);
  input.value = '';
}

// ─── PERSIST TO CLOUD ───
async function saveToCloud(roomId, text, sender) {
  if (!roomId || !text) return;
  try {
    await api.sendMessage({
      id: 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      roomId: String(roomId),
      from: state.vehicle || state.phone || 'anon',
      to: 'ALL',
      sender: sender || state.userName,
      text: String(text).slice(0, 1000),
      ts: Date.now(),
    });
  } catch (e) {
    // Silent — offline persistence is best-effort
  }
}

// ─── LOAD HISTORY ───
async function loadHistory(roomId) {
  if (!roomId) return;
  const box = document.getElementById('chatMessages');
  if (!box) return;

  // Snapshot what's already rendered (from a live open in this session)
  const before = box.querySelectorAll('.chat-msg').length;

  const history = await api.getMessages(roomId, 50);
  if (!Array.isArray(history) || !history.length) return;

  // If we already have live bubbles, prepend missing ones instead of duplicating
  const already = new Set();
  box.querySelectorAll('.chat-msg').forEach(el => {
    const t = el.dataset.ts;
    if (t) already.add(String(t));
  });

  history.forEach(m => {
    const ts = String(m.ts || '');
    if (already.has(ts)) return;

    // Skip our own if it's already shown live
    if (String(m.from) === String(state.vehicle) && box.querySelector(`[data-own="true"][data-ts="${ts}"]`)) return;

    addBubble(m.text, m.sender || 'Peer', 'them', ts, false);
  });

  // Scroll to bottom after load
  box.scrollTop = box.scrollHeight;
}

// ─── BUBBLES ───
function addBubble(text, sender, side, tsOverride, scroll = true) {
  const box = document.getElementById('chatMessages');
  if (!box) return;

  const div = document.createElement('div');
  div.className = 'chat-msg ' + side;
  const ts = tsOverride || String(Date.now());
  div.dataset.ts = ts;
  if (side === 'me') div.dataset.own = 'true';

  const timeLabel = new Date(Number(ts)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (side === 'me') {
    div.innerHTML = `${escapeHtml(text)}<div class="time">${timeLabel}</div>`;
  } else {
    div.innerHTML = `
      <div class="sender">${escapeHtml(sender || 'Peer')}</div>
      ${escapeHtml(text)}
      <div class="time">${timeLabel}</div>
    `;
  }

  box.appendChild(div);
  if (scroll) box.scrollTop = box.scrollHeight;
}

function addSystemBubble(text) {
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ─── STATUS ───
function setStatus(online, text, variant) {
  const wrap = document.getElementById('chatStatusWrap');
  const status = document.getElementById('chatStatus');
  if (!wrap || !status) return;
  wrap.classList.toggle('offline', !online);
  wrap.classList.toggle('purple', variant === 'purple');
  status.textContent = text;
}

// ─── NOTIFICATIONS ───
function notifyIfHidden(sender, text) {
  if (!document.hidden) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (storage.raw('notif-chat', 'true') === 'false') return;
  try {
    new Notification('Steeradar', { body: (sender || 'Peer') + ': ' + text, icon: CFG.LOGO_URL });
  } catch {}
}

// ─── UTILS ───
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── PUBLIC API ───
export const chat = {
  init: initChat,
  openLane: openChatForLane,
  openLocal: openLocalChat,
  // Called by presence.js / lanes.js when a peer message arrives on a data channel
  receive: (text, sender, roomId) => {
    if (activeRoomId === roomId) addBubble(text, sender, 'them');
    saveToCloud(roomId, text, sender);
    notifyIfHidden(sender, text);
  },
  get activeRoomId() { return activeRoomId; },
  get activePeerId() { return activePeerId; },
};