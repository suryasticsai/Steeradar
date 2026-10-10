/* ============================================================
   STEERADAR v3 — Universal DB · Deepstash UI · clean interactions
   ============================================================ */

(() => {
'use strict';

// ============================================================
//  CONFIG (from config.js — loaded before this script)
// ============================================================
const CFG = window.STEERADAR || {};
const APP_NAME = CFG.APP_NAME || 'Steeradar';

// ---------------- Utilities ----------------
const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Toast — single timer, no leaks
let _toastTimer = null;
const showToast = (msg, variant = '', duration = CFG.TOAST_DURATION_MS || 2200) => {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  if (variant) t.dataset.variant = variant; else delete t.dataset.variant;
  t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.remove('show');
    _toastTimer = null;
  }, duration);
};

// Custom dialogs
let _dialogResolve = null;
function openDialog({ title, message = '', input = null, okText = 'OK', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    _dialogResolve = resolve;
    $('#dialogTitle').textContent = title;
    $('#dialogMsg').textContent = message;
    const inputEl = $('#dialogInput');
    if (input !== null) {
      inputEl.style.display = 'block';
      inputEl.placeholder = typeof input === 'string' ? input : '';
      inputEl.value = '';
      setTimeout(() => inputEl.focus(), 100);
    } else {
      inputEl.style.display = 'none';
    }
    const okBtn = $('#dialogOk');
    okBtn.textContent = okText;
    okBtn.className = danger ? 'btn-danger' : 'btn-ok';
    const cancelBtn = $('#dialogCancel');
    cancelBtn.style.display = cancelText ? 'block' : 'none';
    cancelBtn.textContent = cancelText || 'Cancel';
    $('#dialogOverlay').classList.add('active');
  });
}
function closeDialog(result) {
  $('#dialogOverlay').classList.remove('active');
  if (_dialogResolve) {
    const r = _dialogResolve;
    _dialogResolve = null;
    r(result);
  }
}
const confirmDialog = (title, message, danger = false) => openDialog({ title, message, okText: 'Confirm', danger });
const promptDialog  = (title, defaultValue = '', placeholder = '') => openDialog({ title, input: placeholder || defaultValue });

const validateVehicle = (v) => /^[A-Z0-9]{4,15}$/i.test(v.replace(/[\s-]/g, ''));
const normalizeVehicle = (v) => v.replace(/[\s-]/g, '').toUpperCase();

function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat, lng, precision = CFG.GEOHASH_PRECISION || 6) {
  let latR = [-90, 90], lngR = [-180, 180], hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) { const m = (lngR[0] + lngR[1]) / 2; if (lng >= m) { ch = (ch << 1) + 1; lngR[0] = m; } else { ch = ch << 1; lngR[1] = m; } }
    else { const m = (latR[0] + latR[1]) / 2; if (lat >= m) { ch = (ch << 1) + 1; latR[0] = m; } else { ch = ch << 1; latR[1] = m; } }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// ---------------- Theme ----------------
function getMapStyle() {
  const pref = localStorage.getItem('steeradar-map-style') || 'bright';
  if (pref === 'dark') return CFG.MAP_STYLE_DARK   || 'https://tiles.openfreemap.org/styles/dark';
  return                     CFG.MAP_STYLE_BRIGHT || 'https://tiles.openfreemap.org/styles/bright';
}

function applyTheme(mode) {
  const resolved = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem('steeradar-theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0A0B0E' : '#FFFFFF');
}

function refreshMapStyle() {
  if (!state.map) return;
  if (state.mapLibreLayer) { try { state.map.removeLayer(state.mapLibreLayer); } catch {} }
  state.mapLibreLayer = L.maplibreGL({ style: getMapStyle(), interactive: false }).addTo(state.map);
  state.mapLibreLayer.bringToBack();
}

// ---------------- State ----------------
const state = {
  vehicle: null,
  userName: localStorage.getItem('steeradar-name') || '',
  lanes: [],
  hivePosts: [],
  likedPosts: new Set(JSON.parse(localStorage.getItem('steeradar-liked') || '[]')),
  peer: null, peerId: null,
  localPeer: null, localPeerId: null,
  localRoomPrefix: null, localSlot: null,
  localPeers: new Map(),
  localConns: new Map(),
  connections: new Map(),
  activeChatLaneId: null,
  activeChatPeerId: null,
  _ownLaneHintShown: false,
  selectedFilter: 'live',
  map: null, mapLibreLayer: null,
  busMarkers: [], userMarker: null,
  userLat: null, userLng: null, userGeohash: null,
  currentTab: 'pulse',
  btDevices: [],
  cloudSyncTimer: null
};

// ---------------- Cloud (Apps Script, reads config.js) ----------------
const cloud = {
  url: localStorage.getItem('steeradar-cloud-url') || CFG.SHEET_API_URL || '',
  key: localStorage.getItem('steeradar-cloud-key') || CFG.SHEET_WEBHOOK_SECRET || '',
  enabled: (() => {
    const ls = localStorage.getItem('steeradar-cloud-enabled');
    if (ls === 'true')  return true;
    if (ls === 'false') return false;
    return CFG.CLOUD_SYNC_DEFAULT === true && !!CFG.SHEET_API_URL;
  })(),

  async call(action, params = {}) {
    if (!this.url || !this.enabled) return null;
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        body: JSON.stringify({ action, key: this.key, ...params }),
        headers: { 'Content-Type': 'text/plain' }
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.data;
    } catch (e) { console.warn('Cloud:', e); return null; }
  },

  async fetchLanes() { return (await this.call('list', { sheet: 'lanes' })) || []; },
  async fetchHive()  { return (await this.call('list', { sheet: 'hive' }))  || []; },
  async pushLane(lane) { if (lane.mine) this.call('insert', { sheet: 'lanes', row: lane }); },
  async pushHive(post) { this.call('insert', { sheet: 'hive', row: post }); },
  async removeLane(id) { this.call('delete', { sheet: 'lanes', id }); },

  async test() {
    const r = await this.call('ping');
    return r === 'pong';
  }
};

async function syncFromCloud(silent = true) {
  if (!cloud.enabled) return;
  if (!silent) showToast('Syncing…');
  const [cLanes, cHive] = await Promise.all([cloud.fetchLanes(), cloud.fetchHive()]);

  // Merge lanes
  const mineLocal = state.lanes.filter(l => l.mine);
  const merged = [...mineLocal];
  (cLanes || []).forEach(l => {
    const lane = {
      id: String(l.id),
      driver: l.driver,
      vehicle: l.vehicle || '',
      avatar: (l.driver || 'D').substring(0, 2).toUpperCase(),
      rating: 5.0,
      route: {
        from: l.from || '',
        via: l.via ? String(l.via).split('|').filter(Boolean) : [],
        to: l.to || ''
      },
      seats: { total: Number(l.total) || 10, taken: Number(l.taken) || 0 },
      fare: Number(l.fare) || 0,
      status: l.status || 'live',
      lat: Number(l.lat),
      lng: Number(l.lng),
      peerId: l.peerId || null,
      mine: l.vehicle === state.vehicle,
      ts: Number(l.ts) || Date.now()
    };
    if (!merged.find(m => m.id === lane.id)) merged.push(lane);
  });
  state.lanes = merged;

  // Merge hive
  const hiveIds = new Set(state.hivePosts.map(p => p.id));
  (cHive || []).forEach(p => {
    if (!hiveIds.has(p.id)) {
      state.hivePosts.push({
        id: String(p.id),
        name: p.name || 'Driver',
        avatar: p.avatar || 'D',
        title: p.title || '',
        text: p.text || '',
        tags: p.tags ? String(p.tags).split('|').filter(Boolean) : [],
        time: p.time || 'just now',
        likes: Number(p.likes) || 0,
        ts: Number(p.ts) || Date.now()
      });
    }
  });

  renderLanes(); renderBusMarkers(); renderNear(); renderHive();
}

function startCloudPolling() {
  clearInterval(state.cloudSyncTimer);
  if (!cloud.enabled) return;
  state.cloudSyncTimer = setInterval(
    () => syncFromCloud(true),
    CFG.CLOUD_POLL_INTERVAL_MS || 15000
  );
}

// ---------------- Onboarding ----------------
function initOnboarding() {
  const gate = $('#onboardGate');
  const input = $('#onboardVehicle');
  const btn = $('#onboardBtn');

  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
    const valid = validateVehicle(input.value);
    btn.disabled = !valid;
    input.classList.toggle('invalid', input.value.length > 3 && !valid);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });
  btn.addEventListener('click', () => {
    const v = normalizeVehicle(input.value);
    if (!validateVehicle(v)) { showToast('Invalid vehicle number', 'error'); return; }
    localStorage.setItem('steeradar-vehicle', v);
    state.vehicle = v;
    gate.classList.add('hidden');
    setTimeout(() => { gate.style.display = 'none'; }, 550);
    initApp();
  });

  const saved = localStorage.getItem('steeradar-vehicle');
  if (saved && validateVehicle(saved)) {
    state.vehicle = saved;
    gate.style.display = 'none';
  } else {
    setTimeout(() => input.focus(), 400);
  }
}

// ---------------- Storage ----------------
const lanesKey = () => 'steeradar-lanes-' + state.vehicle;
const hiveKey  = () => 'steeradar-hive-' + state.vehicle;
function loadLanes() { try { state.lanes = JSON.parse(localStorage.getItem(lanesKey()) || '[]'); } catch { state.lanes = []; } }
function saveLanes() { localStorage.setItem(lanesKey(), JSON.stringify(state.lanes.filter(l => l.mine))); }
function loadHive() { try { state.hivePosts = JSON.parse(localStorage.getItem(hiveKey()) || '[]'); } catch { state.hivePosts = []; } }
function saveHive() { localStorage.setItem(hiveKey(), JSON.stringify(state.hivePosts)); }
function saveLiked() { localStorage.setItem('steeradar-liked', JSON.stringify([...state.likedPosts])); }
function loadName() { if (!state.userName) { state.userName = 'Driver ' + state.vehicle.slice(-4); localStorage.setItem('steeradar-name', state.userName); } }

// ---------------- Dedupe ----------------
function dedupeLanes() {
  const seen = new Set();
  state.lanes = state.lanes.filter(l => {
    const key = l.id || `${l.driver}|${l.route?.to}|${l.fare}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function dedupeHive() {
  const seen = new Set();
  state.hivePosts = state.hivePosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ============================================================
//  PEER (lane chats + local mesh + hive broadcast)
// ============================================================
const lanePeerId = (lane) => lane.peerId || ('steeradar-veh-' + (lane.mine ? state.vehicle : lane.id));

function initPeer() {
  if (typeof Peer === 'undefined') { updateConnBadge(false, 'PeerJS offline'); return; }
  const id = 'steeradar-veh-' + state.vehicle;
  state.peerId = id;
  try { state.peer = new Peer(id, { debug: 0 }); } catch { updateConnBadge(false, 'Signaling error'); return; }

  state.peer.on('open', () => updateConnBadge(true, 'Online'));
  state.peer.on('connection', (conn) => {
    conn.on('open', () => { state.connections.set(conn.peer, conn); attachConnHandlers(conn); });
  });
  state.peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      try { state.peer.destroy(); } catch {}
      const newId = 'steeradar-veh-' + state.vehicle + '-' + Math.random().toString(36).slice(2, 6);
      state.peerId = newId;
      state.peer = new Peer(newId, { debug: 0 });
      state.peer.on('open', () => updateConnBadge(true, 'Online'));
      state.peer.on('connection', (c) => { c.on('open', () => { state.connections.set(c.peer, c); attachConnHandlers(c); }); });
      state.peer.on('error', () => updateConnBadge(false, 'Signaling error'));
    } else if (err.type === 'peer-unavailable') {
      showToast('That driver is offline right now', 'error'); setChatStatus(false, 'Peer offline');
    } else { updateConnBadge(false, 'Connection issue'); }
  });
  state.peer.on('disconnected', () => { updateConnBadge(false, 'Reconnecting…'); try { state.peer.reconnect(); } catch {} });
}

function attachConnHandlers(conn) {
  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'chat') {
      addChatBubble(data.text, data.sender || 'Peer', false);
      notify(APP_NAME, data.sender + ': ' + data.text);
    } else if (data.type === 'hive-post') {
      if (!state.hivePosts.find(p => p.id === data.post.id)) {
        state.hivePosts.push(data.post);
        saveHive(); renderHive();
        showToast(`${data.post.name}: ${(data.post.title || data.post.text || '').slice(0, 40)}…`);
      }
    }
  });
  conn.on('close', () => {
    state.connections.delete(conn.peer);
    setChatStatus(false, 'Disconnected');
    addChatBubble('Peer disconnected', '', 'system');
  });
}

function updateConnBadge(online, text) {
  const b = $('#connBadge'); if (!b) return;
  b.classList.toggle('online', !!online); b.classList.toggle('offline', !online);
  b.innerHTML = `<span class="dot"></span> ${esc(text)}`;
}

function notify(title, body) {
  if (!document.hidden) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (localStorage.getItem('steeradar-notif-chat') === 'false') return;
  try { new Notification(title, { body, icon: CFG.LOGO_URL }); } catch {}
}

// ---------------- Local mesh ----------------
const LOCAL_ROOM_SLOTS = CFG.LOCAL_ROOM_SLOTS || 20;
let localRescanTimer = null;

async function initLocalRoom(lat, lng) {
  if (typeof Peer === 'undefined') { $('#localRoomSub').textContent = 'WebRTC not available'; return; }
  const gh = geohash(lat, lng, 6);
  state.userGeohash = gh;
  const prefix = 'steeradar-loc-' + gh;
  state.localRoomPrefix = prefix;
  $('#localRoomId').textContent = gh.toUpperCase();
  $('#localRoomSub').textContent = 'Your neighbourhood mesh · ~1 km radius';
  $('#localPeerCount').textContent = 'Searching…';

  for (let i = 1; i <= LOCAL_ROOM_SLOTS; i++) {
    const id = prefix + '-' + i;
    const claimed = await tryClaimSlot(id);
    if (claimed) { state.localSlot = i; state.localPeerId = id; state.localPeer = claimed; break; }
  }
  if (!state.localPeer) { $('#localRoomSub').textContent = 'Room is full · try again'; return; }

  state.localPeer.on('connection', (conn) => {
    conn.on('open', () => {
      conn.send({ type: 'hello', name: state.userName, vehicle: state.vehicle, avatar: state.userName.substring(0, 2).toUpperCase(), lat: state.userLat, lng: state.userLng });
      attachLocalConn(conn);
    });
  });
  state.localPeer.on('error', (err) => { if (err.type !== 'peer-unavailable') console.warn('Local peer error:', err.type); });
  scanLocalRoom();
  clearInterval(localRescanTimer);
  localRescanTimer = setInterval(scanLocalRoom, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scanLocalRoom(); });
}

function tryClaimSlot(id) {
  return new Promise((resolve) => {
    let resolved = false;
    const p = new Peer(id, { debug: 0 });
    const t = setTimeout(() => { if (!resolved) { resolved = true; try { p.destroy(); } catch {} resolve(null); } }, 6000);
    p.on('open', () => { if (!resolved) { resolved = true; clearTimeout(t); resolve(p); } });
    p.on('error', () => { if (!resolved) { resolved = true; clearTimeout(t); try { p.destroy(); } catch {} resolve(null); } });
  });
}

function scanLocalRoom() {
  if (!state.localPeer || !state.localPeer.open || !state.localRoomPrefix) return;
  if (localStorage.getItem('steeradar-visible') === 'false') return;
  for (let i = 1; i <= LOCAL_ROOM_SLOTS; i++) {
    if (i === state.localSlot) continue;
    const targetId = state.localRoomPrefix + '-' + i;
    if (state.localPeers.has(targetId) || state.localPeers.get(targetId + ':pending')) continue;
    const conn = state.localPeer.connect(targetId, { reliable: true });
    state.localPeers.set(targetId + ':pending', true);
    const cleanup = () => state.localPeers.delete(targetId + ':pending');
    const t = setTimeout(() => { try { conn.close(); } catch {} cleanup(); }, 5000);
    conn.on('open', () => {
      clearTimeout(t); cleanup();
      conn.send({ type: 'hello', name: state.userName, vehicle: state.vehicle, avatar: state.userName.substring(0, 2).toUpperCase(), lat: state.userLat, lng: state.userLng });
      attachLocalConn(conn);
    });
    conn.on('error', () => { clearTimeout(t); cleanup(); });
  }
}

function attachLocalConn(conn) {
  state.localConns.set(conn.peer, conn);
  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'hello') {
      const info = { name: data.name || 'Driver', vehicle: data.vehicle || '?', avatar: (data.avatar || 'DR').toUpperCase(), lat: data.lat, lng: data.lng };
      state.localPeers.set(conn.peer, info);
      updateLocalPeers();
      showToast('👋 ' + info.name + ' joined the local room');
    } else if (data.type === 'chat') {
      addChatBubble(data.text, data.sender || 'Local', false);
      notify(APP_NAME + ' Local', (data.sender || 'Neighbour') + ': ' + data.text);
    } else if (data.type === 'hive-post') {
      if (!state.hivePosts.find(p => p.id === data.post.id)) {
        state.hivePosts.push(data.post);
        saveHive(); renderHive();
      }
    }
  });
  conn.on('close', () => {
    state.localPeers.delete(conn.peer);
    state.localConns.delete(conn.peer);
    updateLocalPeers();
  });
}

function updateLocalPeers() {
  const peers = [...state.localPeers.entries()].filter(([k]) => !k.endsWith(':pending'));
  const word = peers.length === 1 ? 'peer' : 'peers';
  $('#localPeerCount').textContent = peers.length + ' ' + word;
  renderNear();
}

function broadcastToAllPeers(payload) {
  let sent = 0;
  for (const conn of state.connections.values()) if (conn.open) { try { conn.send(payload); sent++; } catch {} }
  for (const conn of state.localConns.values()) if (conn.open) { try { conn.send(payload); sent++; } catch {} }
  return sent;
}

// ---------------- Bluetooth ----------------
async function scanBluetooth() {
  if (!navigator.bluetooth) { showToast('Web Bluetooth not supported on this device', 'error'); return; }
  const btn = $('#btScanBtn');
  btn.disabled = true; btn.textContent = 'Scanning…';
  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['generic_access', 'device_information', 'battery_service'] });
    if (!state.btDevices.find(d => d.id === device.id)) {
      state.btDevices.push({ id: device.id, name: device.name || 'Unknown device', connected: false, rssi: -Math.floor(40 + Math.random() * 50), device });
    }
    renderBluetooth();
    showToast('Found: ' + (device.name || 'Unknown'));
    try {
      await device.gatt.connect();
      const entry = state.btDevices.find(d => d.id === device.id);
      if (entry) { entry.connected = true; renderBluetooth(); }
      device.addEventListener('gattserverdisconnected', () => {
        const e = state.btDevices.find(d => d.id === device.id);
        if (e) { e.connected = false; renderBluetooth(); }
      });
    } catch {}
  } catch (err) {
    if (err.name !== 'NotFoundError') showToast('Bluetooth scan failed', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Scan';
  }
}

function renderBluetooth() {
  const wrap = $('#btDevices');
  if (!state.btDevices.length) { wrap.innerHTML = '<div class="bt-empty">Tap Scan to discover nearby Bluetooth devices</div>'; return; }
  wrap.innerHTML = state.btDevices.map(d => `
    <div class="bt-device" data-id="${esc(d.id)}">
      <div class="bt-icon">${d.connected ? '🔗' : '📶'}</div>
      <div class="bt-info">
        <div class="bt-name">${esc(d.name)}</div>
        <div class="bt-meta">${d.connected ? 'Connected' : 'RSSI ' + d.rssi + ' dBm'}</div>
      </div>
      <button class="bt-action" data-action="toggle">${d.connected ? 'Drop' : 'Connect'}</button>
    </div>`).join('');
  wrap.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dev = state.btDevices.find(d => d.id === btn.closest('.bt-device').dataset.id);
      if (!dev || !dev.device) return;
      try {
        if (dev.connected) { dev.device.gatt.disconnect(); dev.connected = false; }
        else { await dev.device.gatt.connect(); dev.connected = true; }
        renderBluetooth();
      } catch { showToast('Bluetooth action failed', 'error'); }
    });
  });
}

// ---------------- Tabs ----------------
function initTabs() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.currentTab = tab;
      $$('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
      $$('.view').forEach(v => v.classList.toggle('active', v.id === tab + 'View'));
      updateFab();
      hideLaneCard();
      if (tab === 'pulse' && state.map) setTimeout(() => state.map.invalidateSize(), 150);
    });
  });
  $$('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.chip').forEach(c => c.classList.toggle('active', c === chip));
      state.selectedFilter = chip.dataset.filter;
      renderBusMarkers(); renderLanes();
    });
  });
}

function updateFab() {
  const label = $('#fabLabel'), sub = $('#fabSub');
  if (state.currentTab === 'pulse' || state.currentTab === 'lanes') { label.textContent = 'Post my lane'; sub.textContent = 'Share seats & route'; }
  else if (state.currentTab === 'near') { label.textContent = 'Broadcast local'; sub.textContent = 'Message nearby drivers'; }
  else { label.textContent = 'New post'; sub.textContent = 'Share with the community'; }
}

function hideLaneCard() {
  const card = $('#mapLaneCard');
  if (card) card.classList.remove('show');
}

// ---------------- Map ----------------
function initMap() {
  state.map = L.map('map', { zoomControl: false, attributionControl: false, center: [12.95, 77.65], zoom: 12 });
  if (typeof L.maplibreGL === 'function') {
    state.mapLibreLayer = L.maplibreGL({ style: getMapStyle(), interactive: false }).addTo(state.map);
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLat = latitude; state.userLng = longitude;
        state.map.setView([latitude, longitude], 13);
        placeUserMarker(latitude, longitude);
        reverseGeocode(latitude, longitude);
        initLocalRoom(latitude, longitude);
      },
      () => { $('#locText').textContent = 'Bengaluru, Karnataka'; reverseGeocode(12.9716, 77.5946); initLocalRoom(12.9716, 77.5946); },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  } else {
    $('#locText').textContent = 'Bengaluru, Karnataka';
    reverseGeocode(12.9716, 77.5946);
    initLocalRoom(12.9716, 77.5946);
  }
  renderBusMarkers();
}

function placeUserMarker(lat, lng) {
  if (state.userMarker) state.map.removeLayer(state.userMarker);
  state.userMarker = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="user-marker-wrap"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }) }).addTo(state.map);
}

function reverseGeocode(lat, lng) {
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`, { headers: { 'Accept': 'application/json' } })
    .then(r => r.json()).then(data => {
      if (data && data.address) {
        const a = data.address;
        const parts = [a.suburb || a.neighbourhood || a.village, a.city || a.town || a.state_district].filter(Boolean);
        $('#locText').textContent = parts.length ? parts.join(', ') : 'Your location';
      }
    }).catch(() => { $('#locText').textContent = 'Bengaluru, Karnataka'; });
}

function filteredLanes() {
  return state.lanes.filter(lane => {
    if (localStorage.getItem('steeradar-ghost') === 'true') return false;
    const left = lane.seats.total - lane.seats.taken;
    if (state.selectedFilter === 'live') return lane.status === 'live' && left > 0;
    if (state.selectedFilter === 'seats') return left > 0;
    if (state.selectedFilter === 'mine') return lane.mine;
    return true;
  });
}

function renderBusMarkers() {
  if (!state.map) return;
  state.busMarkers.forEach(m => state.map.removeLayer(m));
  state.busMarkers = [];
  filteredLanes().forEach(lane => {
    if (!lane.lat || !lane.lng) return;
    const occ = lane.seats.taken / lane.seats.total;
    const isFull = occ >= 0.85 || (lane.seats.total - lane.seats.taken) === 0;
    const icon = L.divIcon({
      className: '',
      html: `<div class="bus-marker-wrap ${isFull ? 'full' : ''}"><div class="ring"></div><div class="ring d2"></div><div class="bus-core"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 12h18M8 6V4M16 6V4"/><circle cx="8" cy="16" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/></svg></div></div>`,
      iconSize: [60, 60], iconAnchor: [30, 30]
    });
    const marker = L.marker([lane.lat, lane.lng], { icon }).addTo(state.map);
    marker.on('click', () => showLaneCard(lane));
    state.busMarkers.push(marker);
  });
}

function showLaneCard(lane) {
  const card = $('#mapLaneCard');
  const left = lane.seats.total - lane.seats.taken;
  const isFull = left === 0;
  card.innerHTML = `
    <button class="close-x" id="mapCardClose">✕</button>
    <h3>${esc(lane.route.to)}</h3>
    <div class="route">🚌 ${esc(lane.route.from)} → ${esc((lane.route.via || []).join(' → '))} → ${esc(lane.route.to)}</div>
    <div class="stats">
      <div class="stat ${isFull ? 'coral' : 'teal'}">${isFull ? 'Full' : left + ' seats left'}</div>
      <div class="stat coral">₹${lane.fare}</div>
    </div>
    <div class="actions">
      <button class="btn-request" style="flex:1;background:var(--surface-2);color:var(--text);box-shadow:none;border:1px solid var(--border)" id="mapChatBtn">💬 Chat</button>
      <button class="btn-request" style="flex:1" id="mapReqBtn" ${isFull ? 'disabled' : ''}>＋ Request</button>
    </div>`;
  card.classList.add('show');
  $('#mapCardClose').onclick = hideLaneCard;
  $('#mapChatBtn').onclick = () => { hideLaneCard(); openChat(lane); };
  $('#mapReqBtn').onclick = () => { hideLaneCard(); openRequest(lane); };
  state.map.setView([lane.lat, lane.lng], Math.max(state.map.getZoom(), 13), { animate: true });
}

// ---------------- Lanes feed ----------------
function renderLanes() {
  dedupeLanes();
  const list = $('#laneList');
  const lanes = filteredLanes();
  if (!lanes.length) {
    list.innerHTML = `<div class="empty"><div class="icon">🚌</div><p>No lanes yet. Tap <b>Post my lane</b> to be the first.</p></div>`;
    return;
  }
  const sorted = [...lanes].sort((a, b) => (b.mine - a.mine) || (b.ts - a.ts));
  list.innerHTML = sorted.map(lane => {
    const left = lane.seats.total - lane.seats.taken;
    const occ = lane.seats.taken / lane.seats.total;
    const isFull = left === 0;
    const circ = 2 * Math.PI * 28;
    const dash = occ * circ;
    return `
      <div class="lane-card ${lane.mine ? 'mine' : ''}" data-id="${lane.id}">
        <div class="status-tag ${isFull ? 'delayed' : ''}">
          <span class="live-dot"></span>${isFull ? 'FULL' : 'LIVE · ON TIME'}
          ${lane.mine ? '<span class="you-tag">YOU</span>' : ''}
        </div>
        <div class="row-1">
          <div class="occupancy-ring ${isFull ? 'full' : ''}">
            <svg viewBox="0 0 68 68"><circle class="bg-ring" cx="34" cy="34" r="28"/><circle class="fg-ring" cx="34" cy="34" r="28" stroke-dasharray="${dash} ${circ}"/></svg>
            <div class="label"><span class="num">${isFull ? 0 : left}</span><span class="sub">Seats</span></div>
          </div>
          <div class="info">
            <div class="destination">${esc(lane.route.to)}</div>
            <div class="route"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 12h18"/></svg>${esc(lane.route.from)} → ${esc((lane.route.via || []).join(' → '))} → ${esc(lane.route.to)}</div>
            <span class="fare-tag">₹ ${lane.fare}</span>
          </div>
        </div>
        <div class="row-2">
          <div class="driver">
            <div class="driver-avatar">${esc(lane.avatar)}</div>
            <div><div class="driver-name">${esc(lane.driver)}</div><div class="driver-rating">★ ${lane.rating}</div></div>
          </div>
          <div class="card-actions">
            <button class="btn-icon-sm" data-action="chat" data-id="${lane.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>
            <button class="btn-request" data-action="request" data-id="${lane.id}" ${isFull ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>${isFull ? 'Full' : 'Request'}</button>
          </div>
        </div>
      </div>`;
  }).join('');
  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lane = state.lanes.find(l => l.id === btn.dataset.id);
      if (!lane) return;
      if (btn.dataset.action === 'chat') openChat(lane); else openRequest(lane);
    });
  });
}

// ---------------- Near ----------------
function renderNear() {
  const wrap = $('#proximityWrap');
  const localPeers = [...state.localPeers.entries()].filter(([k]) => !k.endsWith(':pending'));
  const nearbyLanes = filteredLanes().filter(l => !l.mine).slice(0, 3);
  const cx = 50, cy = 50, maxR = 40;
  const items = [];
  const me = { lat: state.userLat, lng: state.userLng };
  const total = Math.max(localPeers.length + nearbyLanes.length, 1);

  localPeers.forEach(([id, peer], i) => {
    const d = (peer.lat && me.lat) ? distanceM(me, { lat: peer.lat, lng: peer.lng }) : (15 + Math.floor(Math.random() * 35));
    const angle = (i / total) * 360 - 90;
    const radius = Math.min((d / 70) * maxR, maxR);
    const rad = (angle * Math.PI) / 180;
    items.push({ x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius, avatar: peer.avatar, name: peer.name, dist: d, type: 'peer', id });
  });
  nearbyLanes.forEach((lane, i) => {
    const d = (lane.lat && me.lat) ? distanceM(me, { lat: lane.lat, lng: lane.lng }) : (25 + Math.floor(Math.random() * 40));
    const angle = ((localPeers.length + i) / total) * 360 - 90;
    const radius = Math.min((d / 70) * maxR, maxR);
    const rad = (angle * Math.PI) / 180;
    items.push({ x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius, avatar: lane.avatar, name: lane.driver, dist: d, type: 'lane', id: lane.id, coral: true });
  });
  state.btDevices.slice(0, 2).forEach(d => {
    const dist = 5 + Math.floor(Math.random() * 20);
    const angle = Math.random() * 360 - 90;
    const radius = Math.min((dist / 70) * maxR, maxR);
    const rad = (angle * Math.PI) / 180;
    items.push({ x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius, avatar: '📶', name: d.name, dist, type: 'bt', id: d.id, bt: true });
  });

  const html = [];
  html.push(`<div class="center-user">${esc((state.userName || 'You').charAt(0).toUpperCase())}</div>`);
  html.push(`<div class="center-label">${esc(state.vehicle)} · You</div>`);
  items.forEach((it, i) => {
    html.push(`
      <div class="peer-bubble" style="left:${it.x}%;top:${it.y}%;transform:translate(-50%,-50%);animation-delay:${i * 0.06}s" data-type="${it.type}" data-id="${esc(it.id)}">
        <div class="p-avatar ${it.coral ? 'coral' : ''} ${it.bt ? 'bt' : ''}">${esc(it.avatar)}</div>
        <div class="p-label"><span class="dist">${it.dist} m</span><br>${esc(it.name.slice(0, 14))}</div>
      </div>`);
  });
  html.push(`<div class="connected-pill"><span class="live-dot"></span> ${localPeers.length} local · ${nearbyLanes.length} lanes${state.btDevices.length ? ' · ' + state.btDevices.length + ' BT' : ''}</div>`);
  wrap.innerHTML = html.join('');

  wrap.querySelectorAll('.peer-bubble').forEach(b => {
    b.addEventListener('click', () => {
      if (b.dataset.type === 'lane') { const lane = state.lanes.find(l => l.id === b.dataset.id); if (lane) openChat(lane); }
      else if (b.dataset.type === 'peer') { openLocalChat(b.dataset.id); }
      else if (b.dataset.type === 'bt') { showToast('Bluetooth device — tap Scan to connect'); }
    });
  });

  const rooms = [];
  if (localPeers.length || state.localRoomPrefix) {
    const w = localPeers.length === 1 ? 'peer' : 'peers';
    rooms.push({ id: 'local', name: 'Neighbourhood room', meta: localPeers.length + ' ' + w + ' · ' + (state.userGeohash ? state.userGeohash.toUpperCase() : '—'), emoji: '📡', local: true });
  }
  const seenLanes = new Set();
  for (const l of state.lanes) {
    if (l.status !== 'live') continue;
    const key = l.route.to + '|' + l.driver;
    if (seenLanes.has(key)) continue;
    seenLanes.add(key);
    rooms.push({ id: l.id, name: l.route.to + ' Lane', meta: (l.seats.total - l.seats.taken) + ' seats left · ' + l.driver, emoji: '🚌' });
    if (rooms.length >= 4) break;
  }
  if (!rooms.length) rooms.push({ id: null, name: 'Community Chat', meta: 'No active rooms · Be the first', emoji: '💬' });

  $('#chatRoomsCount').textContent = rooms.length + ' active';
  $('#roomList').innerHTML = rooms.map(r => `
    <div class="room-card" data-id="${r.id || ''}" data-local="${r.local ? '1' : ''}">
      <div class="room-icon ${r.local ? 'bt' : ''}">${r.emoji}</div>
      <div class="room-info">
        <div class="room-name">${esc(r.name)} <span class="live-dot"></span></div>
        <div class="room-meta">${esc(r.meta)}</div>
      </div>
      <button class="open-btn">${r.local ? 'Join' : 'Open'}</button>
    </div>`).join('');
  $('#roomList').querySelectorAll('.room-card').forEach(card => {
    card.addEventListener('click', () => {
      if (card.dataset.local === '1') { openLocalChat('room'); return; }
      const id = card.dataset.id;
      if (!id) { showToast('No lanes yet'); return; }
      const lane = state.lanes.find(l => l.id === id);
      if (lane) openChat(lane);
    });
  });
}

// ---------------- Local chat ----------------
function openLocalChat(peerId) {
  state.activeChatPeerId = peerId;
  state.activeChatLaneId = null;
  $('#chatAvatar').textContent = '📡';
  $('#chatAvatar').classList.add('bt');
  $('#chatName').textContent = peerId === 'room' ? 'Neighbourhood room' : ((state.localPeers.get(peerId)?.name) || 'Neighbour');
  $('#chatMessages').innerHTML = '';
  setChatStatus(true, state.localConns.size + ' connected', 'purple');
  addChatBubble('You are on the local mesh · ' + (state.userGeohash ? state.userGeohash.toUpperCase() : ''), '', 'system');
  if (state.localConns.size === 0) addChatBubble('Waiting for neighbours to join…', '', 'system');
  openModal('#chatModal');
}

// ---------------- Hive ----------------
function renderHive() {
  dedupeHive();

  const seenDrivers = new Set();
  const driverStories = [];
  for (const lane of state.lanes) {
    if (seenDrivers.has(lane.driver)) continue;
    seenDrivers.add(lane.driver);
    driverStories.push({ label: lane.driver.split(' ')[0], avatar: lane.avatar, driver: lane.driver });
    if (driverStories.length >= 5) break;
  }
  const stories = [{ label: 'Add', avatar: '＋', add: true }, ...driverStories];
  $('#storyRow').innerHTML = stories.map(s => `
    <div class="story" ${s.driver ? `data-driver="${esc(s.driver)}"` : ''}>
      <div class="story-ring"><div class="story-inner ${s.add ? 'add' : ''}">${esc(s.avatar)}</div></div>
      <div class="story-name">${esc(s.label)}</div>
    </div>`).join('');
  $('#storyRow').querySelectorAll('[data-driver]').forEach(el => {
    el.addEventListener('click', () => {
      const driver = el.dataset.driver;
      const posts = state.hivePosts.filter(p => p.name === driver);
      if (posts.length) showPostDetail(posts[0]);
      else showToast('No posts from ' + driver + ' yet');
    });
  });

  const hour = new Date().getHours();
  const g = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('#greetingText').textContent = `${g}, ${state.userName.split(' ')[0]} 👋`;

  $('#hiveCount').textContent = state.hivePosts.length + ' post' + (state.hivePosts.length === 1 ? '' : 's');

  const feed = [];
  if (state.hivePosts.length === 0) {
    feed.push(`<div class="empty"><div class="icon">🐝</div><p>No posts yet. Tap <b>New post</b> to share something with your community.</p></div>`);
  } else {
    state.hivePosts.slice().reverse().forEach(post => {
      const liked = state.likedPosts.has(post.id);
      feed.push(`
        <div class="post-card" data-post-id="${esc(post.id)}">
          <div class="post-head">
            <div class="post-avatar">${esc(post.avatar)}</div>
            <div class="post-meta">
              <div class="post-name">${esc(post.name)}</div>
              <div class="post-time">${esc(post.time)}</div>
            </div>
          </div>
          ${post.title ? `<div class="post-title">${esc(post.title)}</div>` : ''}
          <div class="post-body">${esc(post.text)}</div>
          ${post.tags && post.tags.length ? `<div class="post-tags">${post.tags.map(t => `<span class="post-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="post-actions">
            <button class="pa-btn ${liked ? 'liked' : ''}" data-act="like" data-id="${esc(post.id)}">
              <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="cnt">${post.likes || 0}</span>
            </button>
          </div>
        </div>`);
    });
  }
  $('#hiveFeed').innerHTML = feed.join('');

  $('#hiveFeed').querySelectorAll('.post-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="like"]')) return;
      const post = state.hivePosts.find(p => p.id === card.dataset.postId);
      if (post) showPostDetail(post);
    });
  });

  $('#hiveFeed').querySelectorAll('[data-act="like"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const post = state.hivePosts.find(p => p.id === id);
      if (!post) return;
      if (state.likedPosts.has(id)) {
        state.likedPosts.delete(id);
        post.likes = Math.max(0, (post.likes || 0) - 1);
      } else {
        state.likedPosts.add(id);
        post.likes = (post.likes || 0) + 1;
      }
      saveLiked(); saveHive();
      renderHive();
    });
  });
}

function showPostDetail(post) {
  const liked = state.likedPosts.has(post.id);
  $('#postDetailContent').innerHTML = `
    <div class="pd-head">
      <div class="pd-avatar">${esc(post.avatar)}</div>
      <div>
        <div class="pd-name">${esc(post.name)}</div>
        <div class="pd-time">${esc(post.time)}</div>
      </div>
    </div>
    ${post.title ? `<h2>${esc(post.title)}</h2>` : ''}
    <div class="pd-body">${esc(post.text).replace(/\n/g, '<br>')}</div>
    ${post.tags && post.tags.length ? `<div class="post-tags" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${post.tags.map(t => `<span class="post-tag">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="pd-actions">
      <button class="pa-btn ${liked ? 'liked' : ''}" id="pdLike" style="display:flex;align-items:center;gap:6px;font-weight:600;color:${liked ? 'var(--coral)' : 'var(--text-2)'}">
        <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
        <span>${post.likes || 0}</span>
      </button>
    </div>`;
  $('#pdLike').onclick = () => {
    if (state.likedPosts.has(post.id)) {
      state.likedPosts.delete(post.id);
      post.likes = Math.max(0, (post.likes || 0) - 1);
    } else {
      state.likedPosts.add(post.id);
      post.likes = (post.likes || 0) + 1;
    }
    saveLiked(); saveHive();
    renderHive();
    showPostDetail(post);
  };
  openModal('#postDetailModal');
}

function publishHivePost(title, text, tags) {
  if (!text || !text.trim()) return;
  const post = {
    id: 'hive-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    name: state.userName,
    avatar: state.userName.substring(0, 2).toUpperCase(),
    title: (title || '').trim(),
    text: text.trim(),
    tags: tags || [],
    time: 'just now',
    likes: 0,
    ts: Date.now(),
    vehicle: state.vehicle
  };
  state.hivePosts.push(post);
  saveHive();
  const sent = broadcastToAllPeers({ type: 'hive-post', post });
  if (cloud.enabled) cloud.pushHive({
    id: post.id, name: post.name, avatar: post.avatar,
    title: post.title, text: post.text,
    tags: post.tags.join('|'), time: post.time,
    likes: 0, ts: post.ts
  });
  renderHive();
  showToast(sent > 0 ? `Posted · reached ${sent} peer${sent === 1 ? '' : 's'} 🐝` : 'Posted to Hive 🐝', 'success');
}

// ---------------- Modals ----------------
const openModal = (sel) => $(sel).classList.add('active');
const closeModal = (sel) => $(sel).classList.remove('active');

function initModalCloseButtons() {
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });
}

// Post lane
let pendingSeats = null;
function initPostModal() {
  $$('#seatSelector .seat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#seatSelector .seat-btn').forEach(b => b.classList.toggle('active', b === btn));
      pendingSeats = parseInt(btn.dataset.seats, 10);
    });
  });
  $('#postConfirm').onclick = () => {
    const dest = $('#pDest').value.trim();
    const routeStr = $('#pRoute').value.trim();
    const fare = parseInt($('#pFare').value, 10) || 0;
    if (!dest || !routeStr) { showToast('Fill destination and route', 'error'); return; }
    if (pendingSeats === null) { showToast('Select seat availability', 'error'); return; }
    const via = routeStr.split(',').map(s => s.trim()).filter(Boolean);
    const from = via.shift() || 'Your location';
    const total = 10, taken = total - pendingSeats;
    const finish = (lat, lng) => {
      state.lanes = state.lanes.filter(l => !(l.mine && l.route.to === dest));
      const lane = {
        id: 'mine-' + Date.now(),
        driver: state.userName + ' (You)',
        avatar: state.userName.substring(0, 2).toUpperCase(),
        rating: 5.0,
        route: { from, via: via.length ? via : ['Via Main'], to: dest },
        seats: { total, taken },
        fare, status: 'live', lat, lng,
        peerId: state.peerId, mine: true, ts: Date.now(),
        vehicle: state.vehicle
      };
      state.lanes.unshift(lane);
      saveLanes();
      if (cloud.enabled) cloud.pushLane({
        id: lane.id, driver: lane.driver, vehicle: state.vehicle,
        from: lane.route.from, via: lane.route.via.join('|'), to: lane.route.to,
        total, taken, fare, lat, lng, status: 'live', ts: lane.ts
      });
      renderLanes(); renderBusMarkers(); renderNear(); renderHive();
      showToast('Lane is live! 🚌', 'success');
      closeModal('#postModal');
      document.querySelector('[data-tab="lanes"]').click();
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => finish(pos.coords.latitude, pos.coords.longitude),
        () => finish(12.95 + (Math.random() - 0.5) * 0.05, 77.65 + (Math.random() - 0.5) * 0.05),
        { timeout: 5000 }
      );
    } else finish(12.95, 77.65);
  };
}

// Request seat
let requestLane = null;
function openRequest(lane) {
  if (lane.mine) { showToast('This is your own lane'); return; }
  requestLane = lane;
  $('#reqInfo').textContent = `To ${lane.driver} · ${lane.route.from} → ${lane.route.to} · ₹${lane.fare}`;
  $('#reqMsg').value = '';
  openModal('#requestModal');
}
function initRequestModal() {
  $('#reqConfirm').onclick = () => {
    if (!requestLane) return;
    const msg = $('#reqMsg').value.trim();
    const pid = lanePeerId(requestLane);
    if (state.peer && pid) {
      try {
        const conn = state.peer.connect(pid, { reliable: true });
        conn.on('open', () => { conn.send({ type: 'chat', text: '👋 Seat request: ' + (msg || 'Can I join?'), sender: state.userName }); setTimeout(() => { try { conn.close(); } catch {} }, 500); });
        conn.on('error', () => {});
      } catch {}
    }
    showToast(`Request sent to ${requestLane.driver}`, 'success');
    closeModal('#requestModal');
  };
}

// Chat
function setChatStatus(online, text, variant) {
  const wrap = $('#chatStatusWrap'); if (!wrap) return;
  wrap.classList.toggle('offline', !online);
  wrap.classList.toggle('purple', variant === 'purple');
  $('#chatStatus').textContent = text;
}
function addChatBubble(text, sender, type) {
  const box = $('#chatMessages'); if (!box) return;
  const div = document.createElement('div');
  if (type === 'system') { div.className = 'chat-msg system'; div.textContent = text; }
  else {
    const isMe = sender === state.userName;
    div.className = 'chat-msg ' + (isMe ? 'me' : 'them');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `${isMe ? '' : `<div class="sender">${esc(sender)}</div>`}${esc(text)}<div class="time">${time}</div>`;
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function openChat(lane) {
  state.activeChatLaneId = lane.id;
  state.activeChatPeerId = null;
  state._ownLaneHintShown = false;
  $('#chatAvatar').classList.remove('bt');
  $('#chatAvatar').textContent = lane.avatar;
  $('#chatName').textContent = lane.driver;
  $('#chatMessages').innerHTML = '';
  openModal('#chatModal');
  const pid = lanePeerId(lane);
  if (lane.mine) { setChatStatus(true, 'Your lane · waiting for passengers'); addChatBubble('This is your lane. Others can reach you here.', '', 'system'); return; }
  if (!state.peer || !state.peer.open) { setChatStatus(false, 'Connecting…'); addChatBubble('Waiting for connection…', '', 'system'); setTimeout(() => openChat(lane), 1500); return; }
  if (state.connections.has(pid)) { setChatStatus(true, 'Connected'); attachConnHandlers(state.connections.get(pid)); return; }
  setChatStatus(false, 'Connecting…'); addChatBubble('Dialing ' + lane.driver + '…', '', 'system');
  let conn;
  try { conn = state.peer.connect(pid, { reliable: true }); } catch { setChatStatus(false, 'Peer unavailable'); addChatBubble('Could not reach this lane.', '', 'system'); return; }
  let opened = false;
  const t = setTimeout(() => { if (!opened) { setChatStatus(false, 'Peer offline'); addChatBubble('This driver is not online right now.', '', 'system'); try { conn.close(); } catch {} } }, 6000);
  conn.on('open', () => { opened = true; clearTimeout(t); state.connections.set(pid, conn); setChatStatus(true, 'Connected'); addChatBubble('Connected', '', 'system'); attachConnHandlers(conn); });
  conn.on('error', () => { clearTimeout(t); setChatStatus(false, 'Connection failed'); addChatBubble('Could not connect.', '', 'system'); });
}
function initChatModal() {
  $('#chatSend').onclick = () => {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;
    if (state.activeChatPeerId) {
      addChatBubble(text, state.userName, false);
      let sent = 0;
      for (const conn of state.localConns.values()) if (conn.open) { try { conn.send({ type: 'chat', text, sender: state.userName }); sent++; } catch {} }
      if (!sent) addChatBubble('(No neighbours connected)', '', 'system');
      input.value = '';
      return;
    }
    const lane = state.lanes.find(l => l.id === state.activeChatLaneId);
    if (lane && lane.mine) {
      addChatBubble(text, state.userName, false);
      if (!state._ownLaneHintShown) { addChatBubble('(Your own lane — only you see this)', '', 'system'); state._ownLaneHintShown = true; }
      input.value = '';
      return;
    }
    const pid = lane ? lanePeerId(lane) : null;
    const conn = pid ? state.connections.get(pid) : null;
    if (conn && conn.open) { try { conn.send({ type: 'chat', text, sender: state.userName }); addChatBubble(text, state.userName, false); } catch { showToast('Send failed', 'error'); } }
    else { showToast('Not connected', 'error'); addChatBubble(text, state.userName, false); addChatBubble('(Not delivered — peer offline)', '', 'system'); }
    input.value = '';
  };
  $('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#chatSend').click(); });
}

// ---------------- Settings ----------------
function updateCloudStatus(text, cls) {
  const el = $('#cloudStatus');
  el.textContent = text;
  el.className = 'cloud-status' + (cls ? ' ' + cls : '');
}

function initSettings() {
  $('#avatarBtn').onclick = () => openSettings();
  $('#vehicleBadge').onclick = () => openSettings();
  $('#settingsSave').onclick = saveSettings;

  // Live theme preview — applies instantly on tap
  $$('#setTheme button').forEach(b => b.addEventListener('click', () => {
    $$('#setTheme button').forEach(x => x.classList.toggle('active', x === b));
    applyTheme(b.dataset.value);
  }));
  $$('#setMapStyle button').forEach(b => b.addEventListener('click', () => {
    $$('#setMapStyle button').forEach(x => x.classList.toggle('active', x === b));
    localStorage.setItem('steeradar-map-style', b.dataset.value);
    refreshMapStyle();
  }));

  $('#cloudTest').onclick = async () => {
    const url = $('#setCloudUrl').value.trim();
    const key = $('#setCloudKey').value.trim();
    if (!url) { updateCloudStatus('Enter a URL first', 'err'); return; }
    updateCloudStatus('Testing…');
    const savedUrl = cloud.url, savedKey = cloud.key, savedEnabled = cloud.enabled;
    cloud.url = url; cloud.key = key; cloud.enabled = true;
    const ok = await cloud.test();
    cloud.url = savedUrl; cloud.key = savedKey; cloud.enabled = savedEnabled;
    if (ok) updateCloudStatus('✓ Connected', 'ok');
    else updateCloudStatus('✗ Failed — check URL & key', 'err');
  };

  $('#setClearLanes').onclick = async () => {
    const ok = await confirmDialog('Clear my lanes?', 'Delete all your published lanes on this device?', true);
    if (!ok) return;
    if (cloud.enabled) state.lanes.filter(l => l.mine).forEach(l => cloud.removeLane(l.id));
    state.lanes = state.lanes.filter(l => !l.mine);
    saveLanes();
    renderLanes(); renderBusMarkers(); renderNear(); renderHive();
    showToast('Your lanes cleared', 'success');
  };

  $('#setResetAll').onclick = async () => {
    const ok = await confirmDialog('Reset all data?', 'This deletes vehicle, lanes, Hive posts, settings. You\'ll see onboarding again.', true);
    if (!ok) return;
    Object.keys(localStorage).filter(k => k.startsWith('steeradar-')).forEach(k => localStorage.removeItem(k));
    location.reload();
  };
}

function openSettings() {
  $('#setName').value = state.userName;
  $('#setVehicle').value = state.vehicle;

  const theme = localStorage.getItem('steeradar-theme') || 'light';
  $$('#setTheme button').forEach(b => b.classList.toggle('active', b.dataset.value === theme));

  const mapStyle = localStorage.getItem('steeradar-map-style') || 'bright';
  $$('#setMapStyle button').forEach(b => b.classList.toggle('active', b.dataset.value === mapStyle));

  $('#setNotifChat').checked = localStorage.getItem('steeradar-notif-chat') !== 'false';
  $('#setNotifSeats').checked = localStorage.getItem('steeradar-notif-seats') !== 'false';
  $('#setShareGps').checked = localStorage.getItem('steeradar-share-gps') !== 'false';
  $('#setVisible').checked = localStorage.getItem('steeradar-visible') !== 'false';
  $('#setGhost').checked = localStorage.getItem('steeradar-ghost') === 'true';

  $('#setCloudSync').checked = cloud.enabled;
  $('#setCloudUrl').value = cloud.url;
  $('#setCloudKey').value = cloud.key;

  if (cloud.enabled && cloud.url) updateCloudStatus('✓ Connected', 'ok');
  else if (cloud.url) updateCloudStatus('Paused', '');
  else updateCloudStatus('Not configured', 'err');

  openModal('#settingsModal');
}

function saveSettings() {
  const name = $('#setName').value.trim();
  if (name) { state.userName = name; localStorage.setItem('steeradar-name', name); $('#avatarBtn').textContent = name.charAt(0).toUpperCase(); }

  const v = normalizeVehicle($('#setVehicle').value);
  if (v && validateVehicle(v) && v !== state.vehicle) {
    localStorage.setItem('steeradar-vehicle', v);
    setTimeout(() => location.reload(), 400);
  }

  localStorage.setItem('steeradar-notif-chat', $('#setNotifChat').checked);
  localStorage.setItem('steeradar-notif-seats', $('#setNotifSeats').checked);
  localStorage.setItem('steeradar-share-gps', $('#setShareGps').checked);
  localStorage.setItem('steeradar-visible', $('#setVisible').checked);
  localStorage.setItem('steeradar-ghost', $('#setGhost').checked);

  const wasEnabled = cloud.enabled;
  cloud.enabled = $('#setCloudSync').checked;
  cloud.url = $('#setCloudUrl').value.trim();
  cloud.key = $('#setCloudKey').value.trim();
  localStorage.setItem('steeradar-cloud-enabled', cloud.enabled);
  localStorage.setItem('steeradar-cloud-url', cloud.url);
  localStorage.setItem('steeradar-cloud-key', cloud.key);

  renderBusMarkers(); renderLanes(); renderNear(); renderHive();
  closeModal('#settingsModal');
  showToast('Settings saved', 'success');

  startCloudPolling();
  if (!wasEnabled && cloud.enabled) syncFromCloud();
}

// ---------------- FAB & header ----------------
function initFabAndHeader() {
  $('#fabBtn').onclick = async () => {
    if (state.currentTab === 'pulse' || state.currentTab === 'lanes') {
      $('#pDest').value = ''; $('#pRoute').value = ''; $('#pFare').value = '20';
      pendingSeats = null;
      $$('#seatSelector .seat-btn').forEach(b => b.classList.remove('active'));
      openModal('#postModal');
    } else if (state.currentTab === 'near') {
      const sent = broadcastToAllPeers({ type: 'chat', text: state.userName + ' is now visible nearby 👋', sender: state.userName });
      showToast(sent ? `Broadcast to ${sent} neighbour${sent === 1 ? '' : 's'}` : 'You are visible nearby ✓', 'success');
    } else {
      const title = await promptDialog('New post — title', '', 'A short headline (optional)');
      if (title === false) return;
      const text = await promptDialog('Post body', '', 'What do you want to share?');
      if (text === false || !text.trim()) return;
      publishHivePost(title || '', text, []);
    }
  };

  $('#notifBtn').onclick = async () => {
    if (!('Notification' in window)) { showToast('Notifications not supported', 'error'); return; }
    if (Notification.permission === 'granted') { showToast('Notifications are already on'); return; }
    const p = await Notification.requestPermission();
    showToast(p === 'granted' ? 'Notifications enabled' : 'Notifications blocked', p === 'granted' ? 'success' : 'error');
  };

  $('#locationPill').onclick = () => {
    if (!navigator.geolocation) { showToast('Location unavailable', 'error'); return; }
    showToast('Updating location…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude } = pos.coords;
      state.userLat = latitude; state.userLng = longitude;
      if (state.map) state.map.setView([latitude, longitude], 14);
      placeUserMarker(latitude, longitude);
      reverseGeocode(latitude, longitude);
      const newGh = geohash(latitude, longitude, 6);
      if (newGh !== state.userGeohash) { showToast('Entering new neighbourhood · rejoining'); setTimeout(() => location.reload(), 800); }
      else showToast('Location updated', 'success');
    }, () => showToast('Enable location to update', 'error'), { enableHighAccuracy: true, timeout: 8000 });
  };

  $('#mapRefresh').onclick = function () {
    this.classList.add('spinning');
    refreshMapStyle();
    state.map.invalidateSize();
    renderBusMarkers();
    hideLaneCard();
    setTimeout(() => this.classList.remove('spinning'), 900);
    showToast('Map refreshed', 'success');
  };

  $('#btScanBtn').onclick = scanBluetooth;

  $('#dialogOk').onclick = () => {
    const inputEl = $('#dialogInput');
    const hasInput = inputEl.style.display !== 'none';
    closeDialog(hasInput ? inputEl.value : true);
  };
  $('#dialogCancel').onclick = () => closeDialog(false);
  $('#dialogOverlay').onclick = (e) => { if (e.target === $('#dialogOverlay')) closeDialog(false); };
  $('#dialogInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#dialogOk').click(); });
}

// ---------------- Boot ----------------
function initApp() {
  loadName();
  $('#avatarBtn').textContent = state.userName.charAt(0).toUpperCase();
  $('#vehicleBadgeText').textContent = state.vehicle;

  applyTheme(localStorage.getItem('steeradar-theme') || 'light');

  loadLanes();
  loadHive();
  dedupeLanes();
  dedupeHive();

  initMap();
  renderLanes();
  renderNear();
  renderHive();
  updateFab();
  initPeer();

  if (cloud.enabled) {
    syncFromCloud();
    startCloudPolling();
  }
}

function boot() {
  initOnboarding();
  initTabs();
  initModalCloseButtons();
  initPostModal();
  initRequestModal();
  initChatModal();
  initSettings();
  initFabAndHeader();

  if (state.vehicle) initApp();

  console.log(
    `%c ${APP_NAME} `,
    'background:#0D9488;color:#fff;font-weight:800;padding:4px 10px;border-radius:4px;font-family:sans-serif',
    CFG.APP_VERSION || 'v3.0',
    '· Universal DB',
    cloud.enabled ? '(enabled)' : '(disabled)'
  );
}

if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
else document.addEventListener('DOMContentLoaded', boot);

})();