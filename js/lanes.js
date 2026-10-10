// js/lanes.js — Post lanes, view feed, map markers, request seats, edit, track.

import { api } from './api.js';
import {
  state, storage, showToast,
  VEHICLE_TYPES, getVehicleType,
  dedupeLanes, loadLanes, saveLanes,
  timeAgo, fmtDist,
} from './store.js';

const CFG = window.STEERADAR || {};

let pendingSeats = null;
let requestTarget = null;
let _editTarget = null;
let _editSeats = null;

// ─── PUBLIC: BOOT ───
export function initLanes() {
  wirePostModal();
  wireRequestModal();
  wireFilterChips();
  wireHeaderActions();
  renderVehicleTypeGrid();
}

// ─── LOAD & SYNC ───
export function loadLanesFromStorage() {
  loadLanes();
  dedupeLanes();
}

export async function syncLanesFromCloud() {
  const list = await api.listLanes();
  if (!Array.isArray(list)) { state.cloudOnline = false; return; }
  state.cloudOnline = true;

  const mineLocal = state.lanes.filter(l => l.mine);
  const merged = [...mineLocal];

  list.forEach(l => {
    const ts = Number(l.ts) || 0;
    if (Date.now() - ts > 24 * 3600 * 1000) return;

    const lane = {
      id: String(l.id),
      driver: l.driver,
      phone: l.phone || '',
      vehicle: l.vehicle || '',
      vehicleType: l.vehicleType || 'car',
      avatar: (l.driver || 'D').substring(0, 2).toUpperCase(),
      rating: 5.0,
      route: {
        from: l.from || '',
        via: l.via ? String(l.via).split('|').filter(Boolean) : [],
        to: l.to || '',
      },
      seats: { total: Number(l.total) || 10, taken: Number(l.taken) || 0 },
      fare: Number(l.fare) || 0,
      status: l.status || 'live',
      lat: Number(l.lat),
      lng: Number(l.lng),
      peerId: l.peerId || (l.vehicle ? 'steeradar-veh-' + l.vehicle : null),
      mine: l.vehicle === state.vehicle,
      ts,
    };
    if (!merged.find(m => m.id === lane.id)) merged.push(lane);
  });

  state.lanes = merged;
  dedupeLanes();
  renderLanes();
  renderBusMarkers();
}

// ─── VEHICLE TYPE GRID ───
export function renderVehicleTypeGrid() {
  const grid = document.getElementById('vehicleTypeGrid');
  if (!grid) return;

  grid.innerHTML = VEHICLE_TYPES.map(v => `
    <button type="button" class="vehicle-type-btn ${v.id === state.selectedVehicleType ? 'active' : ''}" data-vtype="${v.id}">
      <span class="vt-emoji">${v.emoji}</span>
      <span class="vt-label">${v.label}</span>
    </button>
  `).join('');

  grid.querySelectorAll('.vehicle-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedVehicleType = btn.dataset.vtype;
      grid.querySelectorAll('.vehicle-type-btn').forEach(b => b.classList.toggle('active', b === btn));

      const vt = getVehicleType(state.selectedVehicleType);
      const suggest = Math.min(vt.seats, 10);
      document.querySelectorAll('#seatSelector .seat-btn').forEach(b => {
        const seats = parseInt(b.dataset.seats, 10);
        b.classList.toggle('active', seats === suggest);
      });
      pendingSeats = suggest;
    });
  });
}

// ─── FILTER CHIPS ───
function wireFilterChips() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      state.selectedFilter = chip.dataset.filter;
      renderLanes();
      renderBusMarkers();
    });
  });
}

function filteredLanes() {
  return state.lanes.filter(lane => {
    if (storage.raw('ghost', '') === 'true') return false;
    const left = lane.seats.total - lane.seats.taken;
    if (state.selectedFilter === 'live')  return lane.status === 'live' && left > 0;
    if (state.selectedFilter === 'seats') return left > 0;
    if (state.selectedFilter === 'mine')  return lane.mine;
    return true;
  });
}

// ─── RENDER FEED ───
export function renderLanes() {
  dedupeLanes();
  const list = document.getElementById('laneList');
  if (!list) return;

  const lanes = filteredLanes();
  if (!lanes.length) {
    list.innerHTML = `<div class="empty"><div class="icon">🚌</div><p>No lanes yet. Tap <b>Post my lane</b> to be the first.</p></div>`;
    return;
  }

  const sorted = [...lanes].sort((a, b) => (b.mine - a.mine) || (b.ts - a.ts));

  list.innerHTML = sorted.map(lane => {
    const left = lane.seats.total - lane.seats.taken;
    const occ  = lane.seats.taken / Math.max(lane.seats.total, 1);
    const full = left <= 0;
    const circ = 2 * Math.PI * 28;
    const dash = occ * circ;
    const vt = getVehicleType(lane.vehicleType);

    return `
      <div class="lane-card ${lane.mine ? 'mine' : ''}" data-id="${lane.id}">
        ${lane.mine ? '<button class="edit-lane-btn" data-edit="' + lane.id + '" title="Edit">✎</button>' : ''}
        <div class="status-tag ${full ? 'delayed' : ''}">
          <span class="live-dot"></span>${full ? 'FULL' : 'LIVE · ON TIME'}
          ${lane.mine ? '<span class="you-tag">YOU</span>' : ''}
        </div>

        <div class="vtype-badge">${vt.emoji} ${vt.label}</div>

        <div class="row-1">
          <div class="occupancy-ring ${full ? 'full' : ''}">
            <svg viewBox="0 0 68 68">
              <circle class="bg-ring" cx="34" cy="34" r="28"/>
              <circle class="fg-ring" cx="34" cy="34" r="28" stroke-dasharray="${dash} ${circ}"/>
            </svg>
            <div class="label">
              <span class="num">${full ? 0 : left}</span>
              <span class="sub">Seats</span>
            </div>
          </div>

          <div class="info">
            <div class="destination">${escapeHtml(lane.route.to)}</div>
            <div class="route">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 12h18"/></svg>
              ${escapeHtml(lane.route.from)} → ${escapeHtml(lane.route.via.join(' → '))} → ${escapeHtml(lane.route.to)}
            </div>
            <span class="fare-tag">₹ ${lane.fare}</span>
          </div>
        </div>

        <div class="row-2">
          <div class="driver">
            <div class="driver-avatar">${escapeHtml(lane.avatar)}</div>
            <div>
              <div class="driver-name">${escapeHtml(lane.driver)}</div>
              <div class="driver-rating">★ ${lane.rating}</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="btn-icon-sm" data-action="chat" data-id="${lane.id}" title="Chat">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button class="btn-icon-sm" data-action="track" data-id="${lane.id}" title="Track">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            </button>
            <button class="btn-request" data-action="request" data-id="${lane.id}" ${full ? 'disabled' : ''}>
              ${full ? 'Full' : 'Request'}
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lane = state.lanes.find(l => l.id === btn.dataset.id);
      if (!lane) return;
      const action = btn.dataset.action;
      if (action === 'chat')    openChatForLane(lane);
      if (action === 'request') openRequest(lane);
      if (action === 'track')   startTrackingLane(lane);
    });
  });

  list.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const lane = state.lanes.find(l => l.id === btn.dataset.edit);
      if (lane) openEditLane(lane);
    });
  });
}

// ─── MAP MARKERS ───
export function renderBusMarkers() {
  if (!state.map) return;

  state.busMarkers.forEach(m => state.map.removeLayer(m));
  state.busMarkers = [];

  filteredLanes().forEach(lane => {
    if (!lane.lat || !lane.lng) return;
    const occ  = lane.seats.taken / Math.max(lane.seats.total, 1);
    const full = occ >= 0.85 || (lane.seats.total - lane.seats.taken) <= 0;
    const vt = getVehicleType(lane.vehicleType);

    const icon = L.divIcon({
      className: '',
      html: `
        <div class="bus-marker-wrap ${full ? 'full' : ''}">
          <div class="ring"></div>
          <div class="ring d2"></div>
          <div class="bus-core">
            <span style="font-size:20px;line-height:1">${vt.emoji}</span>
          </div>
        </div>`,
      iconSize: [60, 60],
      iconAnchor: [30, 30],
    });

    const marker = L.marker([lane.lat, lane.lng], { icon }).addTo(state.map);
    marker.on('click', () => showLaneCard(lane));
    state.busMarkers.push(marker);
  });
}

// ─── MAP CARD ───
export function showLaneCard(lane) {
  const card = document.getElementById('mapLaneCard');
  if (!card) return;

  const left = lane.seats.total - lane.seats.taken;
  const full = left <= 0;
  const vt = getVehicleType(lane.vehicleType);

  card.innerHTML = `
    <button class="close-x" id="mapCardClose">✕</button>
    <div class="vtype-badge">${vt.emoji} ${vt.label}</div>
    <h3>${escapeHtml(lane.route.to)}</h3>
    <div class="route">${escapeHtml(lane.route.from)} → ${escapeHtml(lane.route.via.join(' → '))} → ${escapeHtml(lane.route.to)}</div>
    <div class="stats">
      <div class="stat ${full ? 'coral' : 'teal'}">${full ? 'Full' : left + ' seats left'}</div>
      <div class="stat coral">₹${lane.fare}</div>
    </div>
    <div class="actions">
      <button class="btn-request" style="flex:1;background:var(--surface-2);color:var(--text);box-shadow:none;border:1px solid var(--border)" id="mapChatBtn">💬</button>
      <button class="btn-request" style="flex:1;background:var(--surface-2);color:var(--text);box-shadow:none;border:1px solid var(--border)" id="mapTrackBtn">📍</button>
      <button class="btn-request" style="flex:1" id="mapReqBtn" ${full ? 'disabled' : ''}>Request</button>
    </div>
  `;

  card.classList.add('show');

  document.getElementById('mapCardClose').onclick = hideLaneCard;
  document.getElementById('mapChatBtn').onclick  = () => { hideLaneCard(); openChatForLane(lane); };
  document.getElementById('mapTrackBtn').onclick = () => { hideLaneCard(); startTrackingLane(lane); };
  document.getElementById('mapReqBtn').onclick   = () => { hideLaneCard(); openRequest(lane); };

  state.map.setView([lane.lat, lane.lng], Math.max(state.map.getZoom(), 13), { animate: true });
}

export function hideLaneCard() {
  document.getElementById('mapLaneCard')?.classList.remove('show');
}

// ─── POST MODAL ───
function wirePostModal() {
  document.querySelectorAll('#seatSelector .seat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#seatSelector .seat-btn').forEach(b => b.classList.toggle('active', b === btn));
      pendingSeats = parseInt(btn.dataset.seats, 10);
    });
  });
  document.getElementById('postConfirm').onclick = handlePostConfirm;
}

export function openPostModal() {
  document.getElementById('pDest').value = '';
  document.getElementById('pRoute').value = '';
  document.getElementById('pFare').value = '20';
  pendingSeats = null;
  document.querySelectorAll('#seatSelector .seat-btn').forEach(b => b.classList.remove('active'));
  state.selectedVehicleType = 'bus';
  renderVehicleTypeGrid();
  document.getElementById('postModal').classList.add('active');
}

async function handlePostConfirm() {
  const dest = document.getElementById('pDest').value.trim();
  const routeStr = document.getElementById('pRoute').value.trim();
  const fare = parseInt(document.getElementById('pFare').value, 10) || 0;

  if (!dest || !routeStr) { showToast('Fill destination and route', 'error'); return; }
  if (pendingSeats === null) { showToast('Select seat availability', 'error'); return; }

  const via = routeStr.split(',').map(s => s.trim()).filter(Boolean);
  const from = via.shift() || 'Your location';
  const vt = getVehicleType(state.selectedVehicleType);
  const total = vt.seats || 10;
  const taken = Math.max(0, total - pendingSeats);

  const coords = await getCurrentCoords();

  const lane = {
    id: 'mine-' + Date.now(),
    driver: state.userName + (state.userName.endsWith('(You)') ? '' : ' (You)'),
    phone: state.phone || '',
    vehicle: state.vehicle,
    vehicleType: vt.id,
    avatar: (state.userName || 'DR').substring(0, 2).toUpperCase(),
    rating: 5.0,
    route: { from, via: via.length ? via : ['Via Main'], to: dest },
    seats: { total, taken },
    fare,
    status: 'live',
    lat: coords.lat,
    lng: coords.lng,
    peerId: state.peerId,
    mine: true,
    ts: Date.now(),
  };

  const oldMine = state.lanes.filter(l => l.mine && l.route.to === dest);
  for (const old of oldMine) { try { await api.removeLane(old.id); } catch {} }
  state.lanes = state.lanes.filter(l => !(l.mine && l.route.to === dest));
  state.lanes.unshift(lane);
  saveLanes();

  renderLanes();
  renderBusMarkers();
  document.getElementById('postModal').classList.remove('active');
  document.querySelector('[data-tab="lanes"]').click();
  showToast('Lane is live! 🚌', 'success');

  const row = {
    id: lane.id, driver: lane.driver, phone: lane.phone,
    vehicle: lane.vehicle, vehicleType: lane.vehicleType,
    from: lane.route.from, via: lane.route.via.join('|'), to: lane.route.to,
    total, taken, fare: lane.fare, lat: lane.lat, lng: lane.lng,
    status: 'live', ts: lane.ts, peerId: state.peerId, lastSeen: Date.now(),
  };
  const r = await api.insertLane(row);
  if (!r) showToast('Saved locally — cloud: ' + (api.lastError || 'failed'), 'error');
}

async function getCurrentCoords() {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve({ lat: 12.95 + (Math.random() - 0.5) * 0.05, lng: 77.65 + (Math.random() - 0.5) * 0.05 });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: 12.95 + (Math.random() - 0.5) * 0.05, lng: 77.65 + (Math.random() - 0.5) * 0.05 }),
      { timeout: 5000 }
    );
  });
}

// ─── EDIT LANE ───
export function initEditLane() {
  const overlay = document.getElementById('editLaneModal');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });

  document.querySelectorAll('#elSeatSelector .seat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#elSeatSelector .seat-btn').forEach(b => b.classList.toggle('active', b === btn));
      _editSeats = parseInt(btn.dataset.seats, 10);
    });
  });

  document.getElementById('editLaneConfirm').onclick = saveEditedLane;
  document.getElementById('editLaneDelete').onclick  = deleteEditedLane;
}

export function openEditLane(lane) {
  if (!lane || !lane.mine) { showToast('You can only edit your own lanes'); return; }
  _editTarget = lane;

  const left = lane.seats.total - lane.seats.taken;
  const via = (lane.route.via || []).join(', ');

  document.getElementById('elDest').value = lane.route.to || '';
  document.getElementById('elRoute').value = (lane.route.from ? lane.route.from + ', ' : '') + via;
  document.getElementById('elFare').value = lane.fare || 0;

  _editSeats = null;
  document.querySelectorAll('#elSeatSelector .seat-btn').forEach(b => {
    const s = parseInt(b.dataset.seats, 10);
    const active = s === left || (s === 40 && left > 10);
    b.classList.toggle('active', active);
    if (active) _editSeats = s;
  });

  document.getElementById('editLaneModal').classList.add('active');
}

async function saveEditedLane() {
  if (!_editTarget) return;

  const dest = document.getElementById('elDest').value.trim();
  const routeStr = document.getElementById('elRoute').value.trim();
  const fare = parseInt(document.getElementById('elFare').value, 10) || 0;

  if (!dest) { showToast('Destination required', 'error'); return; }

  const via = routeStr.split(',').map(s => s.trim()).filter(Boolean);
  const from = via.shift() || _editTarget.route.from || 'Your location';
  const total = _editTarget.seats.total;
  const taken = _editSeats != null ? Math.max(0, total - _editSeats) : _editTarget.seats.taken;

  _editTarget.route = { from, via: via.length ? via : ['Via Main'], to: dest };
  _editTarget.seats.taken = taken;
  _editTarget.fare = fare;
  saveLanes();

  renderLanes();
  renderBusMarkers();
  document.getElementById('editLaneModal').classList.remove('active');
  showToast('Lane updated', 'success');

  if (_editTarget.id.startsWith('mine-')) {
    const row = {
      id: _editTarget.id, driver: _editTarget.driver,
      vehicle: _editTarget.vehicle, vehicleType: _editTarget.vehicleType,
      from, via: via.join('|'), to: dest,
      total, taken, fare, lat: _editTarget.lat, lng: _editTarget.lng,
      status: 'live', ts: _editTarget.ts, peerId: state.peerId, lastSeen: Date.now(),
    };
    const r = await api.updateLane(_editTarget.id, row);
    if (!r) showToast('Saved locally · cloud: ' + (api.lastError || 'failed'), 'error');
  }

  _editTarget = null;
  _editSeats = null;
}

async function deleteEditedLane() {
  if (!_editTarget) return;
  if (!confirm('Delete this lane?')) return;
  const id = _editTarget.id;

  try { await api.removeLane(id); } catch {}
  state.lanes = state.lanes.filter(l => l.id !== id);
  saveLanes();
  renderLanes();
  renderBusMarkers();
  document.getElementById('editLaneModal').classList.remove('active');
  showToast('Lane deleted', 'success');

  _editTarget = null;
  _editSeats = null;
}

// ─── REQUEST MODAL ───
function wireRequestModal() {
  document.getElementById('reqConfirm').onclick = handleRequestConfirm;
}

export function openRequest(lane) {
  if (lane.mine) { showToast('This is your own lane'); return; }
  requestTarget = lane;

  const info = document.getElementById('reqInfo');
  if (info) info.textContent = `To ${lane.driver} · ${lane.route.from} → ${lane.route.to} · ₹${lane.fare}`;

  document.getElementById('reqMsg').value = '';
  document.getElementById('requestModal').classList.add('active');
}

async function handleRequestConfirm() {
  if (!requestTarget) return;
  const msg = document.getElementById('reqMsg').value.trim();
  const pid = requestTarget.peerId || ('steeradar-veh-' + (requestTarget.vehicle || requestTarget.id));

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

  showToast(`Request sent to ${requestTarget.driver}`, 'success');
  document.getElementById('requestModal').classList.remove('active');
  requestTarget = null;
}

// ─── HOOKS ───
function openChatForLane(lane) {
  if (window.Steeradar?.chat) window.Steeradar.chat.openLane(lane);
  else showToast('Chat module not loaded');
}

function startTrackingLane(lane) {
  if (window.Steeradar?.presence) window.Steeradar.presence.startTracking(lane);
  else showToast('Tracking module not loaded');
}

// ─── HEADER ───
function wireHeaderActions() {
  const refresh = document.getElementById('mapRefresh');
  if (refresh) {
    refresh.onclick = function () {
      this.classList.add('spinning');
      if (window.SteeradarApp?.openSettings) {} // no-op
      state.map?.invalidateSize();
      renderBusMarkers();
      hideLaneCard();
      setTimeout(() => this.classList.remove('spinning'), 900);
      showToast('Map refreshed', 'success');
    };
  }
}

// ─── UTILS ───
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── PUBLIC ───
export const lanes = {
  init: initLanes,
  loadFromStorage: loadLanesFromStorage,
  syncFromCloud: syncLanesFromCloud,
  render: renderLanes,
  renderMarkers: renderBusMarkers,
  openPost: openPostModal,
  openRequest,
  showCard: showLaneCard,
  hideCard: hideLaneCard,
  openEdit: openEditLane,
  getVehicleType,
  VEHICLE_TYPES,
};