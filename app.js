/* ============================================================
   STEERADAR — App Logic
   - OpenFreeMap (MapLibre GL) vector tiles
   - Real WebRTC via PeerJS (lane chats + geohash local mesh)
   - Real Web Bluetooth scan
   - RAGina Pro AI (music, voice, memory)
   ============================================================ */

(() => {
'use strict';

// ---------------- Helpers ----------------
const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const showToast = (msg) => {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2400);
};

const validateVehicle = (v) => /^[A-Z0-9]{4,15}$/i.test(v.replace(/[\s-]/g, ''));
const normalizeVehicle = (v) => v.replace(/[\s-]/g, '').toUpperCase();

// Haversine distance in metres
function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

// Geohash
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat, lng, precision = 6) {
  let latR = [-90, 90], lngR = [-180, 180];
  let hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (lngR[0] + lngR[1]) / 2;
      if (lng >= mid) { ch = (ch << 1) + 1; lngR[0] = mid; } else { ch = ch << 1; lngR[1] = mid; }
    } else {
      const mid = (latR[0] + latR[1]) / 2;
      if (lat >= mid) { ch = (ch << 1) + 1; latR[0] = mid; } else { ch = ch << 1; latR[1] = mid; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// ---------------- Global State ----------------
const state = {
  vehicle: null,
  userName: localStorage.getItem('steeradar-name') || '',
  lanes: [],
  peer: null,
  peerId: null,
  localPeer: null,
  localPeerId: null,
  localRoomPrefix: null,
  localSlot: null,
  localPeers: new Map(),   // peerId -> { name, vehicle, avatar, lat, lng }
  localConns: new Map(),   // peerId -> DataConnection
  connections: new Map(),  // lane chats
  activeChatLaneId: null,
  activeChatPeerId: null,
  selectedFilter: 'live',
  map: null,
  mapLibreLayer: null,
  busMarkers: [],
  userMarker: null,
  userLat: null,
  userLng: null,
  userGeohash: null,
  currentTab: 'pulse',
  btDevices: [],
  hivePosts: []
};

// ---------------- Onboarding ----------------
function initOnboarding() {
  const gate = $('#onboardGate');
  const input = $('#onboardVehicle');
  const btn = $('#onboardBtn');
  if (!gate || !input || !btn) return;

  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
    const valid = validateVehicle(input.value);
    btn.disabled = !valid;
    input.classList.toggle('invalid', input.value.length > 3 && !valid);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !btn.disabled) btn.click(); });

  btn.addEventListener('click', () => {
    const v = normalizeVehicle(input.value);
    if (!validateVehicle(v)) { showToast('Invalid vehicle number'); return; }
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

function loadLanes() {
  try {
    const raw = localStorage.getItem(lanesKey());
    state.lanes = raw ? JSON.parse(raw) : [];
  } catch { state.lanes = []; }
}
function saveLanes() { localStorage.setItem(lanesKey(), JSON.stringify(state.lanes)); }

function loadHive() {
  try {
    const raw = localStorage.getItem(hiveKey());
    state.hivePosts = raw ? JSON.parse(raw) : [];
  } catch { state.hivePosts = []; }
}
function saveHive() { localStorage.setItem(hiveKey(), JSON.stringify(state.hivePosts)); }

function loadName() {
  if (!state.userName) {
    state.userName = 'Driver ' + state.vehicle.slice(-4);
    localStorage.setItem('steeradar-name', state.userName);
  }
}

// ============================================================
//  PEER A — Vehicle-based peer (lane chats)
// ============================================================
const lanePeerId = (lane) => lane.peerId || ('steeradar-veh-' + (lane.mine ? state.vehicle : lane.id));

function initPeer() {
  if (typeof Peer === 'undefined') {
    updateConnBadge(false, 'PeerJS offline');
    return;
  }
  const id = 'steeradar-veh-' + state.vehicle;
  state.peerId = id;

  try {
    state.peer = new Peer(id, { debug: 0 });
  } catch (e) {
    updateConnBadge(false, 'Signaling error');
    return;
  }

  state.peer.on('open', () => updateConnBadge(true, 'Online'));

  state.peer.on('connection', (conn) => {
    conn.on('open', () => {
      state.connections.set(conn.peer, conn);
      attachConnHandlers(conn);
    });
  });

  state.peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      try { state.peer.destroy(); } catch {}
      const newId = 'steeradar-veh-' + state.vehicle + '-' + Math.random().toString(36).slice(2, 6);
      state.peerId = newId;
      state.peer = new Peer(newId, { debug: 0 });
      state.peer.on('open', () => updateConnBadge(true, 'Online'));
      state.peer.on('connection', (c) => {
        c.on('open', () => { state.connections.set(c.peer, c); attachConnHandlers(c); });
      });
      state.peer.on('error', () => updateConnBadge(false, 'Signaling error'));
    } else if (err.type === 'peer-unavailable') {
      showToast('That driver is offline right now');
      setChatStatus(false, 'Peer offline');
    } else {
      updateConnBadge(false, 'Connection issue');
    }
  });

  state.peer.on('disconnected', () => {
    updateConnBadge(false, 'Reconnecting…');
    try { state.peer.reconnect(); } catch {}
  });
}

function attachConnHandlers(conn) {
  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'chat') {
      addChatBubble(data.text, data.sender || 'Peer', false);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Steeradar', { body: data.sender + ': ' + data.text });
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
  const b = $('#connBadge');
  if (!b) return;
  b.classList.toggle('online', !!online);
  b.classList.toggle('offline', !online);
  b.innerHTML = `<span class="dot"></span> ${esc(text)}`;
}

// ============================================================
//  PEER B — Local intranet mesh (geohash slot-based)
// ============================================================
const LOCAL_ROOM_SLOTS = 20;
let localRescanTimer = null;

async function initLocalRoom(lat, lng) {
  if (typeof Peer === 'undefined') {
    $('#localRoomSub').textContent = 'WebRTC not available';
    return;
  }

  const gh = geohash(lat, lng, 6);
  state.userGeohash = gh;
  const prefix = 'steeradar-loc-' + gh;
  state.localRoomPrefix = prefix;

  $('#localRoomId').textContent = gh.toUpperCase();
  $('#localRoomSub').textContent = 'Your neighbourhood mesh · ~1 km radius';
  $('#localPeerCount').textContent = 'Searching…';

  // Try to claim a slot
  for (let i = 1; i <= LOCAL_ROOM_SLOTS; i++) {
    const id = prefix + '-' + i;
    const claimed = await tryClaimSlot(id);
    if (claimed) {
      state.localSlot = i;
      state.localPeerId = id;
      state.localPeer = claimed;
      break;
    }
  }

  if (!state.localPeer) {
    $('#localRoomSub').textContent = 'Room is full · try again';
    return;
  }

  state.localPeer.on('connection', (conn) => {
    conn.on('open', () => {
      conn.send({
        type: 'hello',
        name: state.userName,
        vehicle: state.vehicle,
        avatar: state.userName.substring(0, 2).toUpperCase(),
        lat: state.userLat,
        lng: state.userLng
      });
      attachLocalConn(conn);
    });
  });

  state.localPeer.on('error', (err) => {
    if (err.type !== 'peer-unavailable') console.warn('Local peer error:', err.type);
  });

  scanLocalRoom();
  clearInterval(localRescanTimer);
  localRescanTimer = setInterval(scanLocalRoom, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scanLocalRoom(); });
}

function tryClaimSlot(id) {
  return new Promise((resolve) => {
    let resolved = false;
    const p = new Peer(id, { debug: 0 });
    const t = setTimeout(() => {
      if (!resolved) { resolved = true; try { p.destroy(); } catch {} resolve(null); }
    }, 6000);
    p.on('open', () => { if (!resolved) { resolved = true; clearTimeout(t); resolve(p); } });
    p.on('error', () => {
      if (!resolved) { resolved = true; clearTimeout(t); try { p.destroy(); } catch {} resolve(null); }
    });
  });
}

function scanLocalRoom() {
  if (!state.localPeer || !state.localPeer.open || !state.localRoomPrefix) return;
  for (let i = 1; i <= LOCAL_ROOM_SLOTS; i++) {
    if (i === state.localSlot) continue;
    const targetId = state.localRoomPrefix + '-' + i;
    if (state.localPeers.has(targetId) || state.localPeers.get(targetId + ':pending')) continue;

    const conn = state.localPeer.connect(targetId, { reliable: true });
    state.localPeers.set(targetId + ':pending', true);
    const cleanup = () => state.localPeers.delete(targetId + ':pending');

    const t = setTimeout(() => { try { conn.close(); } catch {} cleanup(); }, 5000);
    conn.on('open', () => {
      clearTimeout(t);
      cleanup();
      conn.send({
        type: 'hello',
        name: state.userName,
        vehicle: state.vehicle,
        avatar: state.userName.substring(0, 2).toUpperCase(),
        lat: state.userLat,
        lng: state.userLng
      });
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
      const info = {
        name: data.name || 'Driver',
        vehicle: data.vehicle || '?',
        avatar: (data.avatar || data.name?.substring(0, 2) || 'DR').toUpperCase(),
        lat: data.lat,
        lng: data.lng
      };
      state.localPeers.set(conn.peer, info);
      updateLocalPeers();
      showToast('👋 ' + info.name + ' joined the local room');
    } else if (data.type === 'chat') {
      addChatBubble(data.text, data.sender || 'Local', false);
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Steeradar Local', { body: (data.sender || 'Neighbour') + ': ' + data.text });
      }
    } else if (data.type === 'leave') {
      state.localPeers.delete(conn.peer);
      state.localConns.delete(conn.peer);
      updateLocalPeers();
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
  $('#localPeerCount').textContent = peers.length + ' peer' + (peers.length === 1 ? '' : 's');
  renderNear();
}

// ============================================================
//  WEB BLUETOOTH
// ============================================================
async function scanBluetooth() {
  if (!navigator.bluetooth) { showToast('Web Bluetooth not supported on this browser'); return; }
  const btn = $('#btScanBtn');
  btn.disabled = true;
  btn.textContent = 'Scanning…';

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['generic_access', 'device_information', 'battery_service']
    });

    const known = state.btDevices.find(d => d.id === device.id);
    if (!known) {
      state.btDevices.push({
        id: device.id,
        name: device.name || 'Unknown device',
        connected: false,
        rssi: -Math.floor(40 + Math.random() * 50),
        device
      });
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
        showToast((device.name || 'Device') + ' disconnected');
      });
    } catch {}
  } catch (err) {
    if (err.name !== 'NotFoundError') showToast('Bluetooth scan failed');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan';
  }
}

function renderBluetooth() {
  const wrap = $('#btDevices');
  if (!state.btDevices.length) {
    wrap.innerHTML = '<div class="bt-empty">Tap Scan to discover nearby Bluetooth devices</div>';
    return;
  }
  wrap.innerHTML = state.btDevices.map(d => `
    <div class="bt-device" data-id="${esc(d.id)}">
      <div class="bt-icon">${d.connected ? '🔗' : '📶'}</div>
      <div class="bt-info">
        <div class="bt-name">${esc(d.name)}</div>
        <div class="bt-meta">${d.connected ? 'Connected' : 'RSSI ' + d.rssi + ' dBm'} · ${esc(d.id.slice(0, 10))}…</div>
      </div>
      <button class="bt-action" data-action="toggle">${d.connected ? 'Drop' : 'Connect'}</button>
    </div>`).join('');

  wrap.querySelectorAll('[data-action="toggle"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('.bt-device');
      const dev = state.btDevices.find(d => d.id === row.dataset.id);
      if (!dev || !dev.device) return;
      try {
        if (dev.connected) { dev.device.gatt.disconnect(); dev.connected = false; }
        else { await dev.device.gatt.connect(); dev.connected = true; }
        renderBluetooth();
      } catch { showToast('Bluetooth action failed'); }
    });
  });
}

// ============================================================
//  RAGINA Pro AI
// ============================================================
function findRaginaOrb() {
  return document.querySelector('.ragina-orb, .ragina-toggle, [class*="ragina"][class*="orb"], [class*="ragina-toggle"]');
}

function openRagina() {
  const orb = findRaginaOrb();
  if (orb) { orb.click(); return; }
  const alt = document.querySelector('[class*="ragina"]');
  if (alt) { alt.click(); return; }
  showToast('RAGina is loading…');
}

function askRagina(q) {
  openRagina();
  setTimeout(() => {
    const input = document.querySelector(
      '.ragina-input, [class*="ragina"] input[type="text"], [class*="ragina"] textarea'
    );
    if (input) {
      input.value = q;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const send = document.querySelector(
        '.ragina-send, [class*="ragina"] button[type="submit"], [class*="ragina"] button[aria-label*="send" i]'
      );
      if (send) send.click();
    }
  }, 900);
}

// ============================================================
//  TAB NAVIGATION
// ============================================================
function initTabs() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.currentTab = tab;
      $$('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
      $$('.view').forEach(v => v.classList.toggle('active', v.id === tab + 'View'));
      updateFab();
      if (tab === 'pulse' && state.map) setTimeout(() => state.map.invalidateSize(), 150);
    });
  });

  $$('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.chip').forEach(c => c.classList.toggle('active', c === chip));
      state.selectedFilter = chip.dataset.filter;
      renderBusMarkers();
      renderLanes();
    });
  });
}

function updateFab() {
  const label = $('#fabLabel');
  const sub = $('#fabSub');
  if (state.currentTab === 'pulse' || state.currentTab === 'lanes') {
    label.textContent = 'Post my lane';
    sub.textContent = 'Share seats & route';
  } else if (state.currentTab === 'near') {
    label.textContent = 'Broadcast local';
    sub.textContent = 'Message nearby drivers';
  } else {
    label.textContent = 'New post';
    sub.textContent = 'Share with the community';
  }
}

// ============================================================
//  MAP — OpenFreeMap (MapLibre GL via Leaflet plugin)
// ============================================================
function initMap() {
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    center: [12.95, 77.65],
    zoom: 12
  });

  // OpenFreeMap "dark" vector style via MapLibre GL — no API key required
  if (typeof L.maplibreGL === 'function') {
    state.mapLibreLayer = L.maplibreGL({
      style: 'https://tiles.openfreemap.org/styles/dark',
      interactive: false
    }).addTo(state.map);
  } else {
    // Fallback: OSM tiles with a dark CSS filter applied via styles.css
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLat = latitude;
        state.userLng = longitude;
        state.map.setView([latitude, longitude], 13);
        placeUserMarker(latitude, longitude);
        reverseGeocode(latitude, longitude);
        initLocalRoom(latitude, longitude);
      },
      () => {
        $('#locText').textContent = 'Bengaluru, Karnataka';
        reverseGeocode(12.9716, 77.5946);
        initLocalRoom(12.9716, 77.5946);
      },
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
  state.userMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="user-marker-wrap"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    })
  }).addTo(state.map);
}

function reverseGeocode(lat, lng) {
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`, {
    headers: { 'Accept': 'application/json' }
  })
    .then(r => r.json())
    .then(data => {
      if (data && data.address) {
        const a = data.address;
        const parts = [a.suburb || a.neighbourhood || a.village, a.city || a.town || a.state_district].filter(Boolean);
        $('#locText').textContent = parts.length ? parts.join(', ') : 'Your location';
      }
    })
    .catch(() => { $('#locText').textContent = 'Bengaluru, Karnataka'; });
}

function filteredLanes() {
  return state.lanes.filter(lane => {
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
    const occ = lane.seats.taken / lane.seats.total;
    const isFull = occ >= 0.85 || (lane.seats.total - lane.seats.taken) === 0;
    const icon = L.divIcon({
      className: '',
      html: `
        <div class="bus-marker-wrap ${isFull ? 'full' : ''}">
          <div class="ring"></div>
          <div class="ring d2"></div>
          <div class="bus-core">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="6" width="18" height="14" rx="3"/>
              <path d="M3 12h18M8 6V4M16 6V4"/>
              <circle cx="8" cy="16" r="1.2" fill="currentColor"/>
              <circle cx="16" cy="16" r="1.2" fill="currentColor"/>
            </svg>
          </div>
        </div>`,
      iconSize: [60, 60],
      iconAnchor: [30, 30]
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
    <div class="route">🚌 ${esc(lane.route.from)} → ${esc(lane.route.via.join(' → '))} → ${esc(lane.route.to)}</div>
    <div class="stats">
      <div class="stat ${isFull ? 'coral' : 'teal'}">${isFull ? 'Full' : left + ' seats left'}</div>
      <div class="stat coral">₹${lane.fare}</div>
    </div>
    <div class="actions">
      <button class="btn-request" style="flex:1;background:var(--surface-2);color:var(--text);box-shadow:none;border:1px solid var(--border)" id="mapChatBtn">💬 Chat</button>
      <button class="btn-request" style="flex:1" id="mapReqBtn" ${isFull ? 'disabled' : ''}>＋ Request</button>
    </div>`;
  card.classList.add('show');
  $('#mapCardClose').onclick = () => card.classList.remove('show');
  $('#mapChatBtn').onclick = () => { card.classList.remove('show'); openChat(lane); };
  $('#mapReqBtn').onclick = () => { card.classList.remove('show'); openRequest(lane); };
  state.map.setView([lane.lat, lane.lng], Math.max(state.map.getZoom(), 13), { animate: true });
}

// ============================================================
//  LANES FEED
// ============================================================
function renderLanes() {
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
            <svg viewBox="0 0 68 68">
              <circle class="bg-ring" cx="34" cy="34" r="28"/>
              <circle class="fg-ring" cx="34" cy="34" r="28" stroke-dasharray="${dash} ${circ}"/>
            </svg>
            <div class="label"><span class="num">${isFull ? 0 : left}</span><span class="sub">Seats</span></div>
          </div>
          <div class="info">
            <div class="destination">${esc(lane.route.to)}</div>
            <div class="route">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 12h18"/></svg>
              ${esc(lane.route.from)} → ${esc(lane.route.via.join(' → '))} → ${esc(lane.route.to)}
            </div>
            <span class="fare-tag">₹ ${lane.fare}</span>
          </div>
        </div>
        <div class="row-2">
          <div class="driver">
            <div class="driver-avatar">${esc(lane.avatar)}</div>
            <div>
              <div class="driver-name">${esc(lane.driver)}</div>
              <div class="driver-rating">★ ${lane.rating}</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="btn-icon-sm" data-action="chat" data-id="${lane.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button class="btn-request" data-action="request" data-id="${lane.id}" ${isFull ? 'disabled' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              ${isFull ? 'Full' : 'Request'}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lane = state.lanes.find(l => l.id === btn.dataset.id);
      if (!lane) return;
      if (btn.dataset.action === 'chat') openChat(lane);
      else openRequest(lane);
    });
  });
}

// ============================================================
//  NEAR (Proximity)
// ============================================================
function renderNear() {
  const wrap = $('#proximityWrap');
  const localPeers = [...state.localPeers.entries()].filter(([k]) => !k.endsWith(':pending'));
  const nearbyLanes = state.lanes.filter(l => l.status === 'live' && !l.mine).slice(0, 3);

  const cx = 50, cy = 50, maxR = 40;
  const items = [];
  const me = { lat: state.userLat, lng: state.userLng };
  const total = Math.max(localPeers.length + nearbyLanes.length, 1);

  localPeers.forEach(([id, peer], i) => {
    const d = (peer.lat && me.lat) ? distanceM(me, { lat: peer.lat, lng: peer.lng }) : (15 + Math.floor(Math.random() * 35));
    const angle = (i / total) * 360 - 90;
    const radius = Math.min((d / 70) * maxR, maxR);
    const rad = (angle * Math.PI) / 180;
    items.push({
      x: cx + Math.cos(rad) * radius,
      y: cy + Math.sin(rad) * radius,
      avatar: peer.avatar, name: peer.name, dist: d, type: 'peer', id
    });
  });

  nearbyLanes.forEach((lane, i) => {
    const d = (lane.lat && me.lat) ? distanceM(me, { lat: lane.lat, lng: lane.lng }) : (25 + Math.floor(Math.random() * 40));
    const angle = ((localPeers.length + i) / total) * 360 - 90;
    const radius = Math.min((d / 70) * maxR, maxR);
    const rad = (angle * Math.PI) / 180;
    items.push({
      x: cx + Math.cos(rad) * radius,
      y: cy + Math.sin(rad) * radius,
      avatar: lane.avatar, name: lane.driver, dist: d, type: 'lane', id: lane.id, coral: true
    });
  });

  state.btDevices.slice(0, 2).forEach(d => {
    const dist = 5 + Math.floor(Math.random() * 20);
    const angle = Math.random() * 360 - 90;
    const radius = Math.min((dist / 70) * maxR, maxR);
    const rad = (angle * Math.PI) / 180;
    items.push({
      x: cx + Math.cos(rad) * radius,
      y: cy + Math.sin(rad) * radius,
      avatar: '📶', name: d.name, dist, type: 'bt', id: d.id, bt: true
    });
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
      if (b.dataset.type === 'lane') {
        const lane = state.lanes.find(l => l.id === b.dataset.id);
        if (lane) openChat(lane);
      } else if (b.dataset.type === 'peer') {
        openLocalChat(b.dataset.id);
      } else if (b.dataset.type === 'bt') {
        showToast('Bluetooth device — tap Scan to connect');
      }
    });
  });

  // Rooms list
  const rooms = [];
  if (localPeers.length || state.localRoomPrefix) {
    rooms.push({
      id: 'local',
      name: 'Neighbourhood room',
      meta: localPeers.length + ' peers · ' + (state.userGeohash ? state.userGeohash.toUpperCase() : '—'),
      emoji: '📡',
      local: true
    });
  }
  state.lanes.filter(l => l.status === 'live').slice(0, 3).forEach(l => {
    rooms.push({
      id: l.id,
      name: l.route.to + ' Lane',
      meta: (l.seats.total - l.seats.taken) + ' seats left · ' + l.driver,
      emoji: '🚌'
    });
  });
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

// ============================================================
//  LOCAL CHAT
// ============================================================
function openLocalChat(peerId) {
  state.activeChatPeerId = peerId;
  state.activeChatLaneId = null;
  $('#chatAvatar').textContent = '📡';
  $('#chatAvatar').classList.add('bt');
  $('#chatName').textContent = peerId === 'room'
    ? 'Neighbourhood room'
    : ((state.localPeers.get(peerId)?.name) || 'Neighbour');
  $('#chatMessages').innerHTML = '';
  setChatStatus(true, state.localConns.size + ' connected', 'purple');
  addChatBubble('You are on the local mesh · ' + (state.userGeohash ? state.userGeohash.toUpperCase() : ''), '', 'system');
  if (state.localConns.size === 0) addChatBubble('Waiting for neighbours to join…', '', 'system');
  openModal('#chatModal');
}

// ============================================================
//  HIVE
// ============================================================
function renderHive() {
  const stories = [
    { label: 'Add', avatar: '＋', add: true },
    ...state.lanes.slice(0, 4).map(l => ({ label: l.driver.split(' ')[0], avatar: l.avatar }))
  ];
  $('#storyRow').innerHTML = stories.map(s => `
    <div class="story">
      <div class="story-ring"><div class="story-inner ${s.add ? 'add' : ''}">${esc(s.avatar)}</div></div>
      <div class="story-name">${esc(s.label)}</div>
    </div>`).join('');

  const hour = new Date().getHours();
  const g = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('#greetingText').textContent = `${g}, ${state.userName.split(' ')[0]} 👋`;

  const feed = [];

  if (state.hivePosts.length === 0) {
    feed.push(`<div class="empty"><div class="icon">🐝</div><p>No posts yet. Tap <b>New post</b> to share something with your community.</p></div>`);
  } else {
    state.hivePosts.slice().reverse().forEach(post => {
      feed.push(`
        <div class="post-card">
          <div class="post-head">
            <div class="post-avatar">${esc(post.avatar)}</div>
            <div class="post-meta">
              <div class="post-name">${esc(post.name)}</div>
              <div class="post-time">${esc(post.time)}</div>
            </div>
          </div>
          <div class="post-body">${esc(post.text)}</div>
          <div class="post-actions">
            <button class="pa-btn" data-act="like" data-id="${post.id}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span class="cnt">${post.likes || 0}</span>
            </button>
          </div>
        </div>`);
    });
  }

  feed.push(`
    <div class="poll-card">
      <h4>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
        Favourite bus stop upgrade?
      </h4>
      <div class="poll-option"><div class="po-head"><span>Real-time arrival screens</span><span class="pct">48%</span></div><div class="po-bar"><div class="po-fill" style="width:48%"></div></div></div>
      <div class="poll-option"><div class="po-head"><span>More seating & shade</span><span class="pct">32%</span></div><div class="po-bar"><div class="po-fill" style="width:32%"></div></div></div>
      <div class="poll-option"><div class="po-head"><span>Better lighting & safety</span><span class="pct">20%</span></div><div class="po-bar"><div class="po-fill" style="width:20%"></div></div></div>
      <div class="poll-foot">124 votes · Poll closes in 2d</div>
    </div>`);

  $('#hiveFeed').innerHTML = feed.join('');

  $('#hiveFeed').querySelectorAll('[data-act="like"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const post = state.hivePosts.find(p => p.id === btn.dataset.id);
      if (!post) return;
      post.likes = (post.likes || 0) + 1;
      btn.querySelector('.cnt').textContent = post.likes;
      btn.classList.add('liked');
      btn.querySelector('svg').setAttribute('fill', 'currentColor');
      saveHive();
    });
  });
}

// ============================================================
//  MODALS
// ============================================================
const openModal = (sel) => $(sel).classList.add('active');
const closeModal = (sel) => $(sel).classList.remove('active');

// ---------------- Post Lane ----------------
let pendingSeats = null;

function initPostModal() {
  $$('#seatSelector .seat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('#seatSelector .seat-btn').forEach(b => b.classList.toggle('active', b === btn));
      pendingSeats = parseInt(btn.dataset.seats, 10);
    });
  });

  $('#postModal').addEventListener('click', (e) => {
    if (e.target === $('#postModal')) closeModal('#postModal');
  });
  $('#postCancel').onclick = () => closeModal('#postModal');

  $('#postConfirm').onclick = () => {
    const dest = $('#pDest').value.trim();
    const routeStr = $('#pRoute').value.trim();
    const fare = parseInt($('#pFare').value, 10) || 0;

    if (!dest || !routeStr) { showToast('Fill destination and route'); return; }
    if (pendingSeats === null) { showToast('Select seat availability'); return; }

    const via = routeStr.split(',').map(s => s.trim()).filter(Boolean);
    const from = via.shift() || 'Your location';
    const total = 10;
    const taken = total - pendingSeats;

    const finish = (lat, lng) => {
      const lane = {
        id: 'mine-' + Date.now(),
        driver: state.userName + ' (You)',
        avatar: state.userName.substring(0, 2).toUpperCase(),
        rating: 5.0,
        route: { from, via: via.length ? via : ['Via Main'], to: dest },
        seats: { total, taken },
        fare,
        status: 'live',
        lat, lng,
        peerId: state.peerId,
        mine: true,
        ts: Date.now()
      };
      state.lanes.unshift(lane);
      saveLanes();
      renderLanes();
      renderBusMarkers();
      renderNear();
      showToast('Lane is live! 🚌');
      closeModal('#postModal');
      document.querySelector('[data-tab="lanes"]').click();
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => finish(pos.coords.latitude, pos.coords.longitude),
        () => finish(12.95 + (Math.random() - 0.5) * 0.05, 77.65 + (Math.random() - 0.5) * 0.05),
        { timeout: 5000 }
      );
    } else {
      finish(12.95, 77.65);
    }
  };
}

// ---------------- Request Seat ----------------
let requestLane = null;

function openRequest(lane) {
  if (lane.mine) { showToast('This is your own lane'); return; }
  requestLane = lane;
  $('#reqInfo').textContent = `To ${lane.driver} · ${lane.route.from} → ${lane.route.to} · ₹${lane.fare}`;
  $('#reqMsg').value = '';
  openModal('#requestModal');
}

function initRequestModal() {
  $('#reqCancel').onclick = () => closeModal('#requestModal');
  $('#reqConfirm').onclick = () => {
    if (!requestLane) return;
    const msg = $('#reqMsg').value.trim();
    const pid = lanePeerId(requestLane);
    if (state.peer && pid) {
      try {
        const conn = state.peer.connect(pid, { reliable: true });
        conn.on('open', () => {
          conn.send({ type: 'chat', text: '👋 Seat request: ' + (msg || 'Can I join?'), sender: state.userName });
          setTimeout(() => { try { conn.close(); } catch {} }, 500);
        });
        conn.on('error', () => {});
      } catch {}
    }
    showToast(`Request sent to ${requestLane.driver}`);
    closeModal('#requestModal');
  };
}

// ---------------- Chat ----------------
function setChatStatus(online, text, variant) {
  const wrap = $('#chatStatusWrap');
  if (!wrap) return;
  wrap.classList.toggle('offline', !online);
  wrap.classList.toggle('purple', variant === 'purple');
  $('#chatStatus').textContent = text;
}

function addChatBubble(text, sender, type) {
  const box = $('#chatMessages');
  if (!box) return;
  const div = document.createElement('div');
  if (type === 'system') {
    div.className = 'chat-msg system';
    div.textContent = text;
  } else {
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
  $('#chatAvatar').classList.remove('bt');
  $('#chatAvatar').textContent = lane.avatar;
  $('#chatName').textContent = lane.driver;
  $('#chatMessages').innerHTML = '';
  openModal('#chatModal');

  const pid = lanePeerId(lane);

  if (lane.mine) {
    setChatStatus(true, 'Your lane · waiting for passengers');
    addChatBubble('This is your lane. Others can reach you here.', '', 'system');
    return;
  }

  if (!state.peer || !state.peer.open) {
    setChatStatus(false, 'Connecting to network…');
    addChatBubble('Waiting for connection…', '', 'system');
    setTimeout(() => openChat(lane), 1500);
    return;
  }

  if (state.connections.has(pid)) {
    setChatStatus(true, 'Connected');
    attachConnHandlers(state.connections.get(pid));
    return;
  }

  setChatStatus(false, 'Connecting…');
  addChatBubble('Dialing ' + lane.driver + '…', '', 'system');

  let conn;
  try {
    conn = state.peer.connect(pid, { reliable: true });
  } catch {
    setChatStatus(false, 'Peer unavailable');
    addChatBubble('Could not reach this lane.', '', 'system');
    return;
  }

  let opened = false;
  const t = setTimeout(() => {
    if (!opened) {
      setChatStatus(false, 'Peer offline');
      addChatBubble('This driver is not online right now.', '', 'system');
      try { conn.close(); } catch {}
    }
  }, 6000);

  conn.on('open', () => {
    opened = true;
    clearTimeout(t);
    state.connections.set(pid, conn);
    setChatStatus(true, 'Connected');
    addChatBubble('Connected', '', 'system');
    attachConnHandlers(conn);
  });
  conn.on('error', () => {
    clearTimeout(t);
    setChatStatus(false, 'Connection failed');
    addChatBubble('Could not connect.', '', 'system');
  });
}

function initChatModal() {
  $('#chatSend').onclick = () => {
    const input = $('#chatInput');
    const text = input.value.trim();
    if (!text) return;

    if (state.activeChatPeerId) {
      addChatBubble(text, state.userName, false);
      let sent = 0;
      for (const conn of state.localConns.values()) {
        if (conn.open) {
          try { conn.send({ type: 'chat', text, sender: state.userName }); sent++; } catch {}
        }
      }
      if (!sent) addChatBubble('(No neighbours connected — message not delivered)', '', 'system');
      input.value = '';
      return;
    }

    const lane = state.lanes.find(l => l.id === state.activeChatLaneId);
    if (lane && lane.mine) {
      addChatBubble(text, state.userName, false);
      addChatBubble('(Your own lane — only you see this)', '', 'system');
      input.value = '';
      return;
    }

    const pid = lane ? lanePeerId(lane) : null;
    const conn = pid ? state.connections.get(pid) : null;

    if (conn && conn.open) {
      try {
        conn.send({ type: 'chat', text, sender: state.userName });
        addChatBubble(text, state.userName, false);
      } catch { showToast('Send failed'); }
    } else {
      showToast('Not connected');
      addChatBubble(text, state.userName, false);
      addChatBubble('(Message not delivered — peer offline)', '', 'system');
    }
    input.value = '';
  };

  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#chatSend').click();
  });

  $('#chatClose').onclick = () => {
    closeModal('#chatModal');
    state.activeChatLaneId = null;
    state.activeChatPeerId = null;
    $('#chatAvatar').classList.remove('bt');
  };
}

// ---------------- Vehicle change ----------------
function initVehicleModal() {
  $('#vehicleBadge').addEventListener('click', () => {
    $('#changeVehicleInput').value = state.vehicle;
    openModal('#vehicleModal');
  });
  $('#changeVehicleCancel').onclick = () => closeModal('#vehicleModal');
  $('#changeVehicleBtn').onclick = () => {
    const v = normalizeVehicle($('#changeVehicleInput').value);
    if (!validateVehicle(v)) { showToast('Invalid vehicle number'); return; }
    if (v === state.vehicle) { closeModal('#vehicleModal'); return; }
    if (!confirm('Change vehicle to ' + v + '? Your published lanes will be reset.')) return;
    localStorage.setItem('steeradar-vehicle', v);
    localStorage.removeItem(lanesKey());
    location.reload();
  };
}

// ============================================================
//  FAB + Header actions
// ============================================================
function initFabAndHeader() {
  $('#fabBtn').addEventListener('click', () => {
    if (state.currentTab === 'pulse' || state.currentTab === 'lanes') {
      $('#pDest').value = '';
      $('#pRoute').value = '';
      $('#pFare').value = '20';
      pendingSeats = null;
      $$('#seatSelector .seat-btn').forEach(b => b.classList.remove('active'));
      openModal('#postModal');
    } else if (state.currentTab === 'near') {
      let sent = 0;
      for (const conn of state.localConns.values()) {
        if (conn.open) {
          try {
            conn.send({ type: 'chat', text: state.userName + ' is now visible nearby 👋', sender: state.userName });
            sent++;
          } catch {}
        }
      }
      showToast(sent ? `Broadcast to ${sent} neighbour${sent === 1 ? '' : 's'}` : 'You are visible nearby ✓');
    } else {
      const text = prompt('What do you want to share with the community?');
      if (text && text.trim()) {
        state.hivePosts.push({
          id: 'hive-' + Date.now(),
          name: state.userName,
          avatar: state.userName.substring(0, 2).toUpperCase(),
          text: text.trim(),
          time: 'just now',
          likes: 0
        });
        saveHive();
        renderHive();
        showToast('Posted to Hive 🐝');
      }
    }
  });

  $('#notifBtn').addEventListener('click', () => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
      showToast('Notifications enabled');
    } else {
      showToast('No new notifications');
    }
  });

  $('#avatarBtn').addEventListener('click', () => {
    const name = prompt('Your display name:', state.userName);
    if (name && name.trim()) {
      state.userName = name.trim().slice(0, 24);
      localStorage.setItem('steeradar-name', state.userName);
      $('#avatarBtn').textContent = state.userName.charAt(0).toUpperCase();
      for (const conn of state.localConns.values()) {
        if (conn.open) {
          try {
            conn.send({
              type: 'hello',
              name: state.userName,
              vehicle: state.vehicle,
              avatar: state.userName.substring(0, 2).toUpperCase(),
              lat: state.userLat,
              lng: state.userLng
            });
          } catch {}
        }
      }
      renderNear();
      renderHive();
      showToast('Saved as ' + state.userName);
    }
  });

  $('#locationPill').addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('Location not available'); return; }
    showToast('Updating location…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        state.userLat = latitude;
        state.userLng = longitude;
        if (state.map) state.map.setView([latitude, longitude], 14);
        placeUserMarker(latitude, longitude);
        reverseGeocode(latitude, longitude);

        const newGh = geohash(latitude, longitude, 6);
        if (newGh !== state.userGeohash) {
          showToast('Entering new neighbourhood · rejoining room');
          location.reload();
        } else {
          showToast('Location updated');
        }
      },
      () => showToast('Enable location to update'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  $('#btScanBtn').addEventListener('click', scanBluetooth);
  $('#aiFab').addEventListener('click', () => askRagina('What can you help me with on Steeradar?'));
}

// ============================================================
//  BOOT
// ============================================================
function initApp() {
  loadName();
  $('#avatarBtn').textContent = state.userName.charAt(0).toUpperCase();
  $('#vehicleBadgeText').textContent = state.vehicle;

  loadLanes();
  loadHive();

  initMap();
  renderLanes();
  renderNear();
  renderHive();
  updateFab();
  initPeer();
}

function boot() {
  initOnboarding();
  initTabs();
  initPostModal();
  initRequestModal();
  initChatModal();
  initVehicleModal();
  initFabAndHeader();

  if (state.vehicle) initApp();

  console.log(
    '%c STEERADAR ',
    'background:#00E5C3;color:#0F1115;font-weight:800;padding:4px 10px;border-radius:4px;font-family:sans-serif',
    'OpenFreeMap · WebRTC · Bluetooth · RAGina'
  );
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(boot, 0);
} else {
  document.addEventListener('DOMContentLoaded', boot);
}

})();