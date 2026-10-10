// js/presence.js — Live tracking + geohash local mesh.
// Two responsibilities:
//   1. Broadcast your position to the cloud every 20s; render every
//      other vehicle's position as a live marker on the map.
//   2. Join a geohash-based PeerJS room so people within ~1 km
//      discover each other without any server.

import { api } from './api.js';
import {
  state, storage, showToast,
  getVehicleType, geohash, distanceM, fmtDist,
  setTimer, clearTimer,
} from './store.js';

const CFG = window.STEERADAR || {};

// ─── LOCAL STATE ───
let presenceRunning = false;
let liveMarkers = new Map();     // vehicle -> { marker, prevLat, prevLng }
let routeLayer = null;
let routeGlowLayer = null;
let pickupMarker = null;
let vehiclePin = null;
let routeData = null;
let trackingTargetId = null;
let onPeerMessage = null;        // callback registered by chat.js

// ============================================================
//  PRESENCE HEARTBEAT
// ============================================================
export async function startPresence() {
  if (presenceRunning) return;
  presenceRunning = true;

  // Immediate first beat, then every 20s
  await presenceBeat();
  setTimer('presence', presenceBeat, CFG.PRESENCE_INTERVAL_MS || 20000);
}

export function stopPresence() {
  presenceRunning = false;
  clearTimer('presence');
  clearTimer('liveRefresh');
}

async function presenceBeat() {
  if (document.hidden) return;

  const hidden = storage.raw('ghost', '') === 'true';
  if (hidden) {
    try { await api.removePresence(state.vehicle); } catch {}
    return;
  }

  const shareGps = storage.raw('share-gps', 'true') !== 'false';
  const row = {
    vehicle: state.vehicle,
    phone: state.phone || '',
    name: state.userName,
    avatar: (state.userName || 'DR').substring(0, 2).toUpperCase(),
    peerId: state.peerId || ('steeradar-veh-' + state.vehicle),
    vehicleType: state.selectedVehicleType || 'car',
  };
  if (shareGps && state.userLat != null) {
    row.lat = state.userLat;
    row.lng = state.userLng;
  }

  try { await api.updatePresence(row); } catch {}
  await refreshActiveVehicles();
}

async function refreshActiveVehicles() {
  const list = await api.activeVehicles();
  if (!Array.isArray(list)) return;

  const others = new Map();
  list.forEach(v => {
    if (v.vehicle === state.vehicle) return;
    others.set(v.vehicle, v);
  });
  state.cloudPeers = others;

  renderLiveVehicles();
}

// ============================================================
//  LIVE VEHICLE MARKERS
// ============================================================
function renderLiveVehicles() {
  if (!state.map) return;

  // Remove markers that are no longer present
  liveMarkers.forEach((entry, vehicle) => {
    if (!state.cloudPeers.has(vehicle)) {
      try { state.map.removeLayer(entry.marker); } catch {}
      liveMarkers.delete(vehicle);
    }
  });

  // Add or update
  state.cloudPeers.forEach((v, vehicle) => {
    if (v.lat == null || v.lng == null) return;
    const vt = getVehicleType(v.vehicleType || 'car');
    const existing = liveMarkers.get(vehicle);

    if (existing) {
      animateMarkerTo(existing.marker, v.lat, v.lng, 1200);
      existing.prevLat = v.lat;
      existing.prevLng = v.lng;
    } else {
      const icon = L.divIcon({
        className: '',
        html: `
          <div class="live-vehicle-marker">
            <div class="lv-trail"></div>
            <div class="lv-core">${vt.emoji}</div>
          </div>`,
        iconSize: [60, 60],
        iconAnchor: [30, 30],
      });
      const marker = L.marker([v.lat, v.lng], { icon }).addTo(state.map);
      marker.bindPopup(`<b>${escapeHtml(v.name)}</b><br>${vt.emoji} ${vt.label}`);
      marker.on('click', () => showVehicleCard(v));
      liveMarkers.set(vehicle, { marker, prevLat: v.lat, prevLng: v.lng });
    }
  });
}

function animateMarkerTo(marker, targetLat, targetLng, duration) {
  const start = marker.getLatLng();
  const startLat = start.lat, startLng = start.lng;
  const t0 = performance.now();

  function step(now) {
    const t = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const lat = startLat + (targetLat - startLat) * eased;
    const lng = startLng + (targetLng - startLng) * eased;
    marker.setLatLng([lat, lng]);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function showVehicleCard(v) {
  const card = document.getElementById('mapLaneCard');
  if (!card) return;

  const vt = getVehicleType(v.vehicleType || 'car');
  const dist = (state.userLat != null)
    ? distanceM({ lat: state.userLat, lng: state.userLng }, { lat: v.lat, lng: v.lng })
    : null;

  card.innerHTML = `
    <button class="close-x" id="mapCardClose">✕</button>
    <div class="vtype-badge">${vt.emoji} ${vt.label}</div>
    <h3>${escapeHtml(v.name)}</h3>
    <div class="route">${dist != null ? fmtDist(dist) + ' away · live now' : 'Live now'}</div>
    <div class="actions">
      <button class="btn-request" style="flex:1;background:var(--surface-2);color:var(--text);box-shadow:none;border:1px solid var(--border)" id="liveChatBtn">💬</button>
      <button class="btn-request" style="flex:1" id="liveTrackBtn">📍 Track live</button>
    </div>
  `;
  card.classList.add('show');

  document.getElementById('mapCardClose').onclick = () => card.classList.remove('show');
  document.getElementById('liveChatBtn').onclick = () => {
    card.classList.remove('show');
    const fakeLane = {
      id: 'peer-' + v.vehicle,
      driver: v.name,
      avatar: v.avatar,
      phone: v.phone,
      vehicle: v.vehicle,
      vehicleType: v.vehicleType,
      peerId: v.peerId,
      mine: false,
      route: { from: '', via: [], to: 'Direct chat' },
      seats: { total: 0, taken: 0 },
    };
    if (window.Steeradar?.chat) window.Steeradar.chat.openLane(fakeLane);
  };
  document.getElementById('liveTrackBtn').onclick = () => {
    card.classList.remove('show');
    startRouteTracking(v);
  };
}

// ============================================================
//  ZOMATO-STYLE ROUTE TRACKING
// ============================================================
export async function startRouteTracking(target) {
  stopRouteTracking();

  if (state.userLat == null || state.userLng == null) {
    showToast('Enable location to see the route', 'error');
    return;
  }
  const pickup = { lat: state.userLat, lng: state.userLng };
  trackingTargetId = target.id || ('peer-' + target.vehicle);

  // HUD
  const vt = getVehicleType(target.vehicleType || 'car');
  const avatarEl = document.getElementById('trackAvatar');
  if (avatarEl) {
    avatarEl.textContent = (target.avatar || target.driver || 'DR').substring(0, 2).toUpperCase();
    avatarEl.style.background = vt.color || 'var(--teal)';
  }
  setText('trackName', target.name || target.driver || 'Vehicle');
  document.getElementById('trackMeta').innerHTML =
    `<span class="live-dot"></span> ${vt.emoji} ${vt.label} · coming to you`;

  document.getElementById('trackHud')?.classList.add('show');

  // Switch to map
  document.querySelector('[data-tab="pulse"]')?.click();
  setTimeout(() => state.map?.invalidateSize(), 200);

  // Fit bounds
  const bounds = L.latLngBounds([
    [pickup.lat, pickup.lng],
    [target.lat, target.lng],
  ]);
  state.map.fitBounds(bounds, { padding: [80, 80] });

  drawPickup(pickup);
  drawVehiclePin(target);

  await refreshRoute(pickup, target);

  // Refresh route every 8s (vehicle moves → path recalculates)
  setTimer('routeRefresh', async () => {
    const cur = findTrackedTarget();
    if (!cur || cur.lat == null) return;
    drawVehiclePin(cur);
    await refreshRoute(pickup, cur);
    updateTrackStats(cur, pickup);
  }, 8000);

  // Update stats every second
  setTimer('trackTick', () => {
    const cur = findTrackedTarget();
    if (cur) updateTrackStats(cur, pickup);
  }, 1000);
}

function findTrackedTarget() {
  if (!trackingTargetId) return null;
  let t = state.lanes.find(l => l.id === trackingTargetId);
  if (!t && trackingTargetId.startsWith('peer-')) {
    const p = state.cloudPeers.get(trackingTargetId.replace('peer-', ''));
    if (p) t = { ...p, id: trackingTargetId };
  }
  return t;
}

async function refreshRoute(from, to) {
  if (from.lat == null || to.lat == null) return;
  const route = await fetchOSRM(from, to);
  if (!route) return;
  routeData = route;
  drawRouteLine(route.coordinates);
}

async function fetchOSRM(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes[0]) return null;
    return {
      coordinates: data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]),
      distance: data.routes[0].distance,
      duration: data.routes[0].duration,
    };
  } catch { return null; }
}

function drawRouteLine(coords) {
  clearRouteLayers();
  if (!state.map) return;

  routeGlowLayer = L.polyline(coords, {
    color: '#0D9488', weight: 8, opacity: 0.15,
    lineCap: 'round', lineJoin: 'round',
  }).addTo(state.map);

  routeLayer = L.polyline(coords, {
    color: '#0D9488', weight: 4, opacity: 0.9,
    lineCap: 'round', lineJoin: 'round',
    dashArray: '2, 8',
  }).addTo(state.map);
}

function drawPickup(pickup) {
  if (pickupMarker) { try { state.map.removeLayer(pickupMarker); } catch {} }
  pickupMarker = L.marker([pickup.lat, pickup.lng], {
    icon: L.divIcon({
      className: '',
      html: `
        <div style="position:relative;width:26px;height:26px;">
          <div style="position:absolute;inset:0;border-radius:50%;background:#DC2626;border:3px solid #fff;box-shadow:0 2px 10px rgba(220,38,38,.5)"></div>
          <div style="position:absolute;inset:-8px;border-radius:50%;border:2px solid #DC2626;opacity:.4;animation:busPulse 2s ease-out infinite"></div>
        </div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    }),
  }).addTo(state.map);
  pickupMarker.bindPopup('<b>📍 Your pickup point</b>');
}

function drawVehiclePin(target) {
  if (vehiclePin) { try { state.map.removeLayer(vehiclePin); } catch {} }
  const vt = getVehicleType(target.vehicleType || 'car');
  vehiclePin = L.marker([target.lat, target.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:38px;height:38px;border-radius:50%;background:#fff;border:3px solid #0D9488;display:flex;align-items:center;justify-content:center;font-size:1.2rem;box-shadow:0 4px 14px rgba(13,148,136,.45)">${vt.emoji}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    }),
  }).addTo(state.map);
}

function clearRouteLayers() {
  if (routeLayer)     { try { state.map.removeLayer(routeLayer); } catch {} routeLayer = null; }
  if (routeGlowLayer) { try { state.map.removeLayer(routeGlowLayer); } catch {} routeGlowLayer = null; }
}

function updateTrackStats(target, pickup) {
  const distEl = document.getElementById('trackDist');
  const etaEl  = document.getElementById('trackEta');
  const seatEl = document.getElementById('trackSeats');

  if (routeData && distEl && etaEl) {
    distEl.textContent = fmtDist(routeData.distance);
    etaEl.textContent = Math.max(1, Math.round(routeData.duration / 60)) + ' min';
  } else if (target.lat != null && distEl && etaEl) {
    const d = distanceM(pickup, { lat: target.lat, lng: target.lng });
    distEl.textContent = fmtDist(d);
    etaEl.textContent = Math.max(1, Math.round((d / 1000) / 25 * 60)) + ' min';
  }

  if (seatEl) {
    if (target.seats) {
      const left = target.seats.total - target.seats.taken;
      seatEl.textContent = left + '/' + target.seats.total;
    } else {
      seatEl.textContent = '—';
    }
  }
}

export function stopRouteTracking() {
  clearTimer('routeRefresh');
  clearTimer('trackTick');
  routeData = null;
  trackingTargetId = null;

  clearRouteLayers();
  if (pickupMarker)  { try { state.map.removeLayer(pickupMarker); } catch {}  pickupMarker = null; }
  if (vehiclePin)    { try { state.map.removeLayer(vehiclePin); } catch {}    vehiclePin = null; }

  document.getElementById('trackHud')?.classList.remove('show');
}

// ============================================================
//  GEOHASH LOCAL MESH
// ============================================================
const ROOM_SLOTS = CFG.LOCAL_ROOM_SLOTS || 20;
let localRescanTimer = null;

export async function joinLocalMesh(lat, lng) {
  if (typeof Peer === 'undefined') {
    setText('localRoomSub', 'WebRTC not available');
    return;
  }

  const gh = geohash(lat, lng, 6);
  state.userGeohash = gh;
  const prefix = 'steeradar-loc-' + gh;
  state.localRoomPrefix = prefix;

  setText('localRoomId', gh.toUpperCase());
  setText('localRoomSub', 'Your neighbourhood mesh · ~1 km radius');
  setText('localPeerCount', 'Searching…');

  // Claim a slot
  let claimed = null;
  for (let i = 1; i <= ROOM_SLOTS; i++) {
    const id = prefix + '-' + i;
    claimed = await tryClaimSlot(id);
    if (claimed) { state.localSlot = i; state.localPeer = claimed; break; }
  }

  if (!claimed) {
    setText('localRoomSub', 'Room is full · try again');
    return;
  }

  // Handle incoming connections
  claimed.on('connection', (conn) => {
    conn.on('open', () => {
      conn.send({
        type: 'hello',
        name: state.userName,
        vehicle: state.vehicle,
        avatar: (state.userName || 'DR').substring(0, 2).toUpperCase(),
        lat: state.userLat,
        lng: state.userLng,
      });
      attachLocalConn(conn);
    });
  });

  claimed.on('error', (err) => {
    if (err.type !== 'peer-unavailable') console.warn('[presence] local peer:', err.type);
  });

  // Scan other slots
  scanLocalRoom();
  clearInterval(localRescanTimer);
  localRescanTimer = setInterval(scanLocalRoom, 30000);
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
  if (storage.raw('visible', 'true') === 'false') return;

  for (let i = 1; i <= ROOM_SLOTS; i++) {
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
        avatar: (state.userName || 'DR').substring(0, 2).toUpperCase(),
        lat: state.userLat,
        lng: state.userLng,
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
        avatar: (data.avatar || 'DR').toUpperCase(),
        lat: data.lat,
        lng: data.lng,
      };
      state.localPeers.set(conn.peer, info);
      updateLocalPeerUI();
      showToast('👋 ' + info.name + ' joined the local room');
    } else if (data.type === 'chat') {
      if (onPeerMessage) onPeerMessage(data.text, data.sender, 'local-' + state.userGeohash);
    } else if (data.type === 'hive-post') {
      // Handled by hive.js via the event bus
      window.dispatchEvent(new CustomEvent('steeradar:hive-broadcast', { detail: data.post }));
    }
  });

  conn.on('close', () => {
    state.localPeers.delete(conn.peer);
    state.localConns.delete(conn.peer);
    updateLocalPeerUI();
  });
}

function updateLocalPeerUI() {
  const peers = [...state.localPeers.entries()].filter(([k]) => !k.endsWith(':pending'));
  const word = peers.length === 1 ? 'peer' : 'peers';
  setText('localPeerCount', peers.length + ' ' + word);
}

// ─── Broadcast ───
export function broadcastToAllPeers(payload) {
  let sent = 0;
  for (const conn of state.connections.values()) {
    if (conn.open) { try { conn.send(payload); sent++; } catch {} }
  }
  for (const conn of state.localConns.values()) {
    if (conn.open) { try { conn.send(payload); sent++; } catch {} }
  }
  return sent;
}

// ─── Register chat callback so we can route incoming messages ───
export function onIncomingPeerMessage(fn) {
  onPeerMessage = fn;
}

// ─── Utils ───
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── Public API ───
export const presence = {
  start: startPresence,
  stop: stopPresence,
  joinMesh: joinLocalMesh,
  broadcast: broadcastToAllPeers,
  startTracking: startRouteTracking,
  stopTracking: stopRouteTracking,
  onPeerMessage: onIncomingPeerMessage,
  getLiveMarkers: () => liveMarkers,
};