// js/app.js — Boot + wiring. Replaces the legacy root app.js entirely.
// Responsibilities:
//   1. Decide onboarding vs unlock
//   2. Init all feature modules (lanes, chat, hive, presence, auth)
//   3. Set up the map (Leaflet + MapLibre GL via OpenFreeMap)
//   4. Handle geolocation → join mesh → start presence
//   5. Wire tab navigation, FAB, settings, HUD, cloud polling

import { api } from './api.js';
import {
  state, storage, session, showToast,
  loadLanes, loadHive, saveLanes, saveHive,
  setTimer, clearTimer, clearAllTimers,
  getVehicleType, geohash, normalizeVehicle, validateVehicle,
} from './store.js';

import { initOnboarding, getPhotos, resetOnboarding } from './onboarding.js';
import { initAuth, openAuthSheet, logout, validateSessionOnBoot } from './auth.js';
import { lanes } from './lanes.js';
import { chat } from './chat.js';
import { hive } from './hive.js';
import { presence } from './presence.js';

const CFG = window.STEERADAR || {};

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
function boot() {
  const savedVehicle = storage.raw('vehicle', '');

  // ─── Path A: no vehicle yet → onboarding gate ───
  if (!savedVehicle || !validateVehicle(savedVehicle)) {
    const unlockedImmediately = initOnboarding(() => boot());
    if (!unlockedImmediately) return; // gate shown; boot re-runs after unlock
  }

  // ─── Path B: vehicle ready → unlock the app ───
  state.vehicle = savedVehicle || state.vehicle;
  unlockApp();
}

function unlockApp() {
  // 1. Basic setup
  document.getElementById('onboardGate')?.style.setProperty('display', 'none');

  // 2. Load locally cached data
  lanes.loadFromStorage();
  hive.loadFromStorage();

  // 3. Init feature modules
  lanes.init();
  hive.init();
  chat.init();
  initAuth();

  // 4. Update UI from state
  updateVehicleBadge();
  updateAvatar();
  loadTheme();
  loadMapStylePref();

  // 5. Map + geolocation
  initMap();
  startGeolocation();

  // 6. Bottom nav + FAB
  wireNav();
  wireFab();
  wireHeaderActions();
  wireTrackingHud();
  wireSettings();

  // 7. Cloud sync + presence loops
  startCloudPolling();
  if (presence.start) presence.start();

  // 8. Session validation (silent, non-blocking)
  validateSessionOnBoot().then(ok => {
    if (ok) {
      updateAvatar();
      showToast('Welcome back, ' + (state.userName || ''), 'success');
    }
  });

  // 9. Pause on hide / resume on show
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimer('cloudPoll');
    } else {
      startCloudPolling();
      syncAll(true);
    }
  });

  console.log(
    '%c Steeradar booted ',
    'background:#0D9488;color:#fff;font-weight:800;padding:4px 10px;border-radius:4px',
    '· vehicle:', state.vehicle,
    '· user:', state.userName || 'anonymous'
  );
}

// ═══════════════════════════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════════════════════════
function updateVehicleBadge() {
  const el = document.getElementById('vehicleBadgeText');
  if (el) el.textContent = state.vehicle || '—';
}

function updateAvatar() {
  const el = document.getElementById('avatarBtn');
  if (el) el.textContent = (state.userName || '?').charAt(0).toUpperCase();
}

function wireHeaderActions() {
  // Notification permission
  document.getElementById('notifBtn')?.addEventListener('click', async () => {
    if (!('Notification' in window)) { showToast('Notifications not supported', 'error'); return; }
    if (Notification.permission === 'granted') { showToast('Notifications are on'); return; }
    const p = await Notification.requestPermission();
    showToast(p === 'granted' ? 'Notifications enabled' : 'Notifications blocked',
              p === 'granted' ? 'success' : 'error');
  });

  // Avatar → settings
  document.getElementById('avatarBtn')?.addEventListener('click', openSettings);
  document.getElementById('vehicleBadge')?.addEventListener('click', openSettings);

  // Location pill → refresh position
  document.getElementById('locationPill')?.addEventListener('click', () => {
    if (!navigator.geolocation) { showToast('Location unavailable', 'error'); return; }
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
          showToast('Entering new neighbourhood · rejoining mesh');
          setTimeout(() => location.reload(), 800);
        } else {
          showToast('Location updated', 'success');
        }
      },
      () => showToast('Enable location to update', 'error'),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  });

  // Map refresh
  document.getElementById('mapRefresh')?.addEventListener('click', function () {
    this.classList.add('spinning');
    refreshMapStyle();
    state.map?.invalidateSize();
    lanes.renderMarkers();
    lanes.hideCard();
    setTimeout(() => this.classList.remove('spinning'), 900);
    showToast('Map refreshed', 'success');
  });

  // Bluetooth scan
  document.getElementById('btScanBtn')?.addEventListener('click', scanBluetooth);
}

// ═══════════════════════════════════════════════════════════════
//  MAP
// ═══════════════════════════════════════════════════════════════
function getMapStyle() {
  const pref = storage.raw('map-style', 'bright');
  if (pref === 'dark') return CFG.MAP_STYLE_DARK || 'https://tiles.openfreemap.org/styles/dark';
  return CFG.MAP_STYLE_BRIGHT || 'https://tiles.openfreemap.org/styles/bright';
}

function initMap() {
  if (state.map) return;

  const center = CFG.DEFAULT_CENTER || { lat: 12.9716, lng: 77.5946 };
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    center: [center.lat, center.lng],
    zoom: CFG.DEFAULT_ZOOM || 12,
  });

  if (typeof L.maplibreGL === 'function') {
    try {
      state.mapLibreLayer = L.maplibreGL({ style: getMapStyle(), interactive: false }).addTo(state.map);
    } catch {
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
    }
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(state.map);
  }

  lanes.renderMarkers();
}

function refreshMapStyle() {
  if (!state.map) return;
  if (state.mapLibreLayer) { try { state.map.removeLayer(state.mapLibreLayer); } catch {} }
  state.mapLibreLayer = L.maplibreGL({ style: getMapStyle(), interactive: false }).addTo(state.map);
  state.mapLibreLayer.bringToBack();
}

function placeUserMarker(lat, lng) {
  if (state.userMarker) state.map.removeLayer(state.userMarker);
  state.userMarker = L.marker([lat, lng], {
    icon: L.divIcon({
      className: '',
      html: '<div class="user-marker-wrap"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    }),
  }).addTo(state.map);
}

// ═══════════════════════════════════════════════════════════════
//  GEOLOCATION
// ═══════════════════════════════════════════════════════════════
function startGeolocation() {
  if (!navigator.geolocation) {
    setText('locText', 'Bengaluru, Karnataka');
    reverseGeocode(12.9716, 77.5946);
    finishGeolocation(12.9716, 77.5946);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.userLat = latitude;
      state.userLng = longitude;
      state.map.setView([latitude, longitude], 13);
      placeUserMarker(latitude, longitude);
      reverseGeocode(latitude, longitude);
      finishGeolocation(latitude, longitude);
    },
    () => {
      setText('locText', 'Bengaluru, Karnataka');
      reverseGeocode(12.9716, 77.5946);
      finishGeolocation(12.9716, 77.5946);
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

function finishGeolocation(lat, lng) {
  // Join the geohash mesh
  presence.joinMesh(lat, lng).catch(e => console.warn('Mesh join failed:', e));
}

function reverseGeocode(lat, lng) {
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`, {
    headers: { 'Accept': 'application/json' },
  })
    .then(r => r.json())
    .then(data => {
      if (data && data.address) {
        const a = data.address;
        const parts = [a.suburb || a.neighbourhood || a.village, a.city || a.town || a.state_district]
          .filter(Boolean);
        setText('locText', parts.length ? parts.join(', ') : 'Your location');
      }
    })
    .catch(() => setText('locText', 'Bengaluru, Karnataka'));
}

// ═══════════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════════
function wireNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      state.currentTab = tab;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === tab + 'View'));
      updateFab();
      lanes.hideCard();
      if (tab === 'pulse' && state.map) setTimeout(() => state.map.invalidateSize(), 150);
    });
  });
}

function switchTab(tab) {
  const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (btn) btn.click();
}

function updateFab() {
  const label = document.getElementById('fabLabel');
  const sub = document.getElementById('fabSub');
  if (!label || !sub) return;

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

// ═══════════════════════════════════════════════════════════════
//  FAB
// ═══════════════════════════════════════════════════════════════
function wireFab() {
  document.getElementById('fabBtn')?.addEventListener('click', async () => {
    if (state.currentTab === 'pulse' || state.currentTab === 'lanes') {
      lanes.openPost();
    } else if (state.currentTab === 'near') {
      const sent = presence.broadcast({
        type: 'chat',
        text: state.userName + ' is now visible nearby 👋',
        sender: state.userName,
      });
      showToast(sent ? `Broadcast to ${sent} neighbour${sent === 1 ? '' : 's'}` : 'You are visible nearby ✓',
                'success');
    } else {
      hive.openCompose();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
//  TRACK HUD
// ═══════════════════════════════════════════════════════════════
function wireTrackingHud() {
  document.getElementById('trackClose')?.addEventListener('click', () => presence.stopTracking());

  document.getElementById('trackChat')?.addEventListener('click', () => {
    // Rebuild the target lane from state so chat.js can open it
    const id = state.trackedLaneId;
    if (!id) return;
    let target = state.lanes.find(l => l.id === id);
    if (!target && id.startsWith('peer-')) {
      const vehicle = id.replace('peer-', '');
      target = state.cloudPeers.get(vehicle);
    }
    if (!target) return;

    const fakeLane = {
      id: 'peer-' + (target.vehicle || target.id),
      driver: target.name || target.driver,
      avatar: target.avatar,
      phone: target.phone,
      vehicle: target.vehicle,
      vehicleType: target.vehicleType,
      peerId: target.peerId,
      mine: false,
      route: { from: '', via: [], to: 'Direct chat' },
      seats: { total: 0, taken: 0 },
    };
    chat.openLane(fakeLane);
  });
}

// ═══════════════════════════════════════════════════════════════
//  THEME
// ═══════════════════════════════════════════════════════════════
function loadTheme() {
  const mode = storage.raw('theme', 'light');
  applyTheme(mode);
}

function applyTheme(mode) {
  const resolved = mode === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  storage.setRaw('theme', mode);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0A0B0E' : '#FFFFFF');
}

function loadMapStylePref() {
  // Nothing to do here — getMapStyle() reads from storage each time
}

// ═══════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════
function wireSettings() {
  document.getElementById('settingsSave')?.addEventListener('click', saveSettings);

  // Live theme preview
  document.querySelectorAll('#setTheme button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#setTheme button').forEach(x => x.classList.toggle('active', x === b));
      applyTheme(b.dataset.value);
    });
  });

  // Live map style preview
  document.querySelectorAll('#setMapStyle button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#setMapStyle button').forEach(x => x.classList.toggle('active', x === b));
      storage.setRaw('map-style', b.dataset.value);
      refreshMapStyle();
    });
  });

  // Cloud test
  document.getElementById('cloudTest')?.addEventListener('click', async () => {
    const url = document.getElementById('setCloudUrl').value.trim();
    const key = document.getElementById('setCloudKey').value.trim();
    if (!url) { setCloudStatus('Enter a URL first', 'err'); return; }
    if (!key) { setCloudStatus('Enter the secret key', 'err'); return; }

    setCloudStatus('Testing…');
    const savedUrl = api.url, savedKey = api.key;
    api.url = url;
    api.key = key;

    const ok = await api.ping();
    if (ok) {
      const dbg = await api.debug();
      api.url = savedUrl;
      api.key = savedKey;
      setCloudStatus(
        '✓ Connected · ' + (dbg?.lanes ?? 0) + ' lanes, ' + (dbg?.hive ?? 0) + ' posts',
        'ok'
      );
    } else {
      const err = api.lastError;
      api.url = savedUrl;
      api.key = savedKey;
      setCloudStatus('✗ ' + err, 'err');
    }
  });

  // Clear lanes
  document.getElementById('setClearLanes')?.addEventListener('click', async () => {
    if (!confirm('Delete all your published lanes on this device?')) return;
    const mine = state.lanes.filter(l => l.mine);
    for (const l of mine) { try { await api.removeLane(l.id); } catch {} }
    state.lanes = state.lanes.filter(l => !l.mine);
    saveLanes();
    lanes.render();
    lanes.renderMarkers();
    showToast('Your lanes cleared', 'success');
  });

  // Reset all
  document.getElementById('setResetAll')?.addEventListener('click', () => {
    if (!confirm('Reset everything? You will see onboarding again.')) return;
    Object.keys(localStorage)
      .filter(k => k.startsWith('steeradar-'))
      .forEach(k => localStorage.removeItem(k));
    location.reload();
  });

  // Auth buttons
  document.getElementById('authOpenBtn')?.addEventListener('click', () => {
    document.getElementById('settingsModal')?.classList.remove('active');
    openAuthSheet(session.isLoggedIn() ? 'login' : 'register');
  });
  document.getElementById('authLogoutBtn')?.addEventListener('click', async () => {
    await logout();
    updateAvatar();
    showToast('Signed out');
  });
}

function openSettings() {
  // Populate fields
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('setName', state.userName);
  set('setVehicle', state.vehicle);

  // Theme
  const theme = storage.raw('theme', 'light');
  document.querySelectorAll('#setTheme button').forEach(b =>
    b.classList.toggle('active', b.dataset.value === theme));

  // Map style
  const mapStyle = storage.raw('map-style', 'bright');
  document.querySelectorAll('#setMapStyle button').forEach(b =>
    b.classList.toggle('active', b.dataset.value === mapStyle));

  // Toggles
  const toggle = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  toggle('setNotifChat',  storage.raw('notif-chat', 'true') !== 'false');
  toggle('setNotifSeats', storage.raw('notif-seats', 'true') !== 'false');
  toggle('setShareGps',   storage.raw('share-gps', 'true') !== 'false');
  toggle('setVisible',    storage.raw('visible', 'true') !== 'false');
  toggle('setGhost',      storage.raw('ghost', '') === 'true');
  toggle('setShowPlate',  storage.raw('show-plate', 'true') !== 'false');
  toggle('setShareUpi',   storage.raw('share-upi', 'true') !== 'false');
  toggle('setCloudSync',  CFG.CLOUD_SYNC_DEFAULT === true || storage.raw('cloud-enabled', '') === 'true');

  set('setCloudUrl', api.url);
  set('setCloudKey', api.key);

  // Status
  if (api.url) setCloudStatus(state.cloudOnline ? 'Cloud sync on' : ('✗ ' + (state.cloudLastError || 'offline')),
                              state.cloudOnline ? 'ok' : 'err');
  else setCloudStatus('Not configured', 'err');

  document.getElementById('settingsModal')?.classList.add('active');
}

function saveSettings() {
  const name = document.getElementById('setName')?.value.trim();
  if (name) {
    state.userName = name;
    storage.setRaw('name', name);
    updateAvatar();
  }

  const v = normalizeVehicle(document.getElementById('setVehicle')?.value || '');
  if (v && validateVehicle(v) && v !== state.vehicle) {
    storage.setRaw('vehicle', v);
    setTimeout(() => location.reload(), 400);
    return;
  }

  // Persist toggles
  storage.setRaw('notif-chat', document.getElementById('setNotifChat')?.checked);
  storage.setRaw('notif-seats', document.getElementById('setNotifSeats')?.checked);
  storage.setRaw('share-gps', document.getElementById('setShareGps')?.checked);
  storage.setRaw('visible', document.getElementById('setVisible')?.checked);
  storage.setRaw('ghost', document.getElementById('setGhost')?.checked ? 'true' : '');
  storage.setRaw('show-plate', document.getElementById('setShowPlate')?.checked);
  storage.setRaw('share-upi', document.getElementById('setShareUpi')?.checked);

  // Cloud config
  const cloudOn = document.getElementById('setCloudSync')?.checked;
  const url = document.getElementById('setCloudUrl')?.value.trim();
  const key = document.getElementById('setCloudKey')?.value.trim();

  storage.setRaw('cloud-enabled', cloudOn ? 'true' : 'false');
  if (url && url !== CFG.SHEET_API_URL) storage.setRaw('cloud-url', url);
  else storage.removeRaw('cloud-url');
  if (key && key !== CFG.SHEET_WEBHOOK_SECRET) storage.setRaw('cloud-key', key);
  else storage.removeRaw('cloud-key');

  api.url = url || CFG.SHEET_API_URL || '';
  api.key = key || CFG.SHEET_WEBHOOK_SECRET || '';

  document.getElementById('settingsModal')?.classList.remove('active');
  showToast('Settings saved', 'success');

  // Restart polling with new config
  startCloudPolling();
}

function setCloudStatus(text, variant) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'cloud-status' + (variant ? ' ' + variant : '');
}

// ═══════════════════════════════════════════════════════════════
//  CLOUD POLLING
// ═══════════════════════════════════════════════════════════════
async function syncAll(silent = true) {
  if (!silent) showToast('Syncing…');
  await Promise.all([
    lanes.syncFromCloud(),
    hive.syncFromCloud(),
  ]);
}

function startCloudPolling() {
  clearTimer('cloudPoll');
  const interval = CFG.CLOUD_POLL_INTERVAL_MS || 15000;
  syncAll(true);
  setTimer('cloudPoll', () => syncAll(true), interval);
}

// ═══════════════════════════════════════════════════════════════
//  BLUETOOTH
// ═══════════════════════════════════════════════════════════════
async function scanBluetooth() {
  if (!navigator.bluetooth) { showToast('Web Bluetooth not supported', 'error'); return; }
  const btn = document.getElementById('btScanBtn');
  if (!btn) return;

  btn.disabled = true;
  btn.textContent = 'Scanning…';

  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['generic_access', 'device_information', 'battery_service'],
    });

    if (!state.btDevices.find(d => d.id === device.id)) {
      state.btDevices.push({
        id: device.id,
        name: device.name || 'Unknown device',
        connected: false,
        rssi: -Math.floor(40 + Math.random() * 50),
        device,
      });
    }

    renderBluetooth();
    showToast('Found: ' + (device.name || 'Unknown'));

    try {
      await device.gatt.connect();
      const entry = state.btDevices.find(d => d.id === device.id);
      if (entry) entry.connected = true;
      renderBluetooth();
      device.addEventListener('gattserverdisconnected', () => {
        const e = state.btDevices.find(d => d.id === device.id);
        if (e) e.connected = false;
        renderBluetooth();
      });
    } catch {}
  } catch (err) {
    if (err.name !== 'NotFoundError') showToast('Bluetooth scan failed', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan';
  }
}

function renderBluetooth() {
  const wrap = document.getElementById('btDevices');
  if (!wrap) return;

  if (!state.btDevices.length) {
    wrap.innerHTML = '<div class="bt-empty">Tap Scan to discover nearby Bluetooth devices</div>';
    return;
  }

  wrap.innerHTML = state.btDevices.map(d => `
    <div class="bt-device" data-id="${d.id}">
      <div class="bt-icon">${d.connected ? '🔗' : '📶'}</div>
      <div class="bt-info">
        <div class="bt-name">${escapeHtml(d.name)}</div>
        <div class="bt-meta">${d.connected ? 'Connected' : 'RSSI ' + d.rssi + ' dBm'}</div>
      </div>
      <button class="bt-action" data-action="toggle">${d.connected ? 'Drop' : 'Connect'}</button>
    </div>
  `).join('');

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

// ═══════════════════════════════════════════════════════════════
//  PEERJS BOOT
// ═══════════════════════════════════════════════════════════════
function initPeer() {
  if (typeof Peer === 'undefined') {
    console.warn('PeerJS not loaded');
    return;
  }

  const id = 'steeradar-veh-' + state.vehicle;
  state.peerId = id;

  try {
    state.peer = new Peer(id, { debug: 0 });
  } catch (e) {
    console.warn('Peer init failed:', e);
    return;
  }

  state.peer.on('open', () => {
    setConnBadge(true, 'Online');
    // Update the presence row with our peer ID
    try { presence.start(); } catch {}
  });

  state.peer.on('connection', (conn) => {
    conn.on('open', () => {
      state.connections.set(conn.peer, conn);
      attachPeerHandlers(conn);
    });
  });

  state.peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      try { state.peer.destroy(); } catch {}
      const newId = id + '-' + Math.random().toString(36).slice(2, 6);
      state.peerId = newId;
      try { state.peer = new Peer(newId, { debug: 0 }); } catch { return; }
      state.peer.on('open', () => setConnBadge(true, 'Online'));
      state.peer.on('connection', (c) => {
        c.on('open', () => {
          state.connections.set(c.peer, c);
          attachPeerHandlers(c);
        });
      });
    } else if (err.type === 'peer-unavailable') {
      // Quiet — happens when dialing an offline peer
    } else {
      setConnBadge(false, 'Connection issue');
    }
  });

  state.peer.on('disconnected', () => {
    setConnBadge(false, 'Reconnecting…');
    setTimeout(() => { try { state.peer.reconnect(); } catch {} }, 2000);
  });
}

function attachPeerHandlers(conn) {
  conn.on('data', (data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'chat') {
      // Route into chat.js; it decides whether to render, persist, and notify
      chat.receive(data.text, data.sender, chat.activeRoomId);
    } else if (data.type === 'hive-post') {
      if (!state.hivePosts.find(p => p.id === data.post.id)) {
        state.hivePosts.push(data.post);
        saveHive();
        hive.render();
      }
    }
  });

  conn.on('close', () => {
    state.connections.delete(conn.peer);
  });
}

function setConnBadge(online, text) {
  const el = document.getElementById('connBadge');
  if (!el) return;
  el.classList.toggle('online', !!online);
  el.classList.toggle('offline', !online);
  el.innerHTML = `<span class="dot"></span> ${escapeHtml(text)}`;
}

// ═══════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════
function startPeerOnceVehicleReady() {
  if (!state.vehicle) return;
  initPeer();
}

// ═══════════════════════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════════════════════
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ═══════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
function main() {
  boot();
  startPeerOnceVehicleReady();
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(main, 0);
} else {
  document.addEventListener('DOMContentLoaded', main);
}

// ═══════════════════════════════════════════════════════════════
//  PUBLIC API (used by index.html module script for debugging)
// ═══════════════════════════════════════════════════════════════
window.SteeradarApp = {
  boot,
  unlockApp,
  syncAll,
  openSettings,
  switchTab,
  getState: () => state,
};