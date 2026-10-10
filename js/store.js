// js/store.js — Shared state, localStorage wrappers, session, dedupe, utils.

const CFG = window.STEERADAR || {};

// ─── VEHICLE TYPES ───
export const VEHICLE_TYPES = CFG.VEHICLE_TYPES || [
  { id: 'bus',   label: 'Bus',   emoji: '🚌', seats: 40, color: '#0D9488' },
  { id: 'car',   label: 'Car',   emoji: '🚗', seats: 4,  color: '#4F46E5' },
  { id: 'auto',  label: 'Auto',  emoji: '🛺', seats: 3,  color: '#D97706' },
  { id: 'bike',  label: 'Bike',  emoji: '🏍️', seats: 1,  color: '#DC2626' },
  { id: 'walk',  label: 'Walk',  emoji: '🚶', seats: 1,  color: '#7C3AED' },
  { id: 'event', label: 'Event', emoji: '🎉', seats: 20, color: '#DB2777' },
];

export function getVehicleType(id) {
  return VEHICLE_TYPES.find(v => v.id === id) || VEHICLE_TYPES[0];
}

// ─── SHARED STATE ───
// One object every module reads from and writes to.
export const state = {
  // identity
  vehicle: localStorage.getItem('steeradar-vehicle') || null,
  userName: localStorage.getItem('steeradar-name') || '',
  phone: localStorage.getItem('steeradar-phone') || '',
  token: localStorage.getItem('steeradar-token') || '',

  // data
  lanes: [],
  hivePosts: [],
  messages: new Map(),       // roomId -> array of messages
  cloudPeers: new Map(),     // vehicle -> presence row
  localPeers: new Map(),     // peerId  -> peer info (geohash mesh)

  // ui
  currentTab: 'pulse',
  selectedFilter: 'live',
  selectedVehicleType: 'bus',
  cloudOnline: true,
  cloudLastError: '',

  // tracking
  trackedLaneId: null,

  // peers / connections
  peer: null,
  peerId: null,
  localPeer: null,
  localRoomPrefix: null,
  localSlot: null,
  connections: new Map(),
  localConns: new Map(),

  // maps
  map: null,
  busMarkers: [],
  userMarker: null,
  liveMarkers: new Map(),

  // geolocation
  userLat: null,
  userLng: null,
  userGeohash: null,

  // misc
  btDevices: [],
  timers: {},
};

// ─── STORAGE ───
const PREFIX = 'steeradar-';

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  },
  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },
  raw(key, fallback = '') {
    return localStorage.getItem(PREFIX + key) ?? fallback;
  },
  setRaw(key, value) {
    localStorage.setItem(PREFIX + key, String(value));
  },
  removeRaw(key) {
    localStorage.removeItem(PREFIX + key);
  },
  clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  },
};

// ─── SESSION ───
export const session = {
  get() {
    return { phone: state.phone, token: state.token };
  },
  isLoggedIn() {
    return !!(state.phone && state.token);
  },
  set({ phone, token, user }) {
    state.phone = phone || '';
    state.token = token || '';
    storage.setRaw('phone', state.phone);
    storage.setRaw('token', state.token);
    if (user) {
      state.userName = user.name || state.userName;
      storage.setRaw('name', state.userName);
      storage.set('user', user);
    }
  },
  clear() {
    state.phone = '';
    state.token = '';
    storage.removeRaw('phone');
    storage.removeRaw('token');
    storage.remove('user');
  },
  user() {
    return storage.get('user', null);
  },
};

// ─── VEHICLE-SCOPED KEYS ───
export const keys = {
  lanes: () => `lanes-${state.vehicle || 'anon'}`,
  hive:  () => `hive-${state.vehicle || 'anon'}`,
};

export function loadLanes() {
  const raw = storage.get(keys.lanes(), []);
  state.lanes = Array.isArray(raw) ? raw : [];
  return state.lanes;
}

export function saveLanes() {
  storage.set(keys.lanes(), state.lanes.filter(l => l.mine));
}

export function loadHive() {
  const raw = storage.get(keys.hive(), []);
  state.hivePosts = Array.isArray(raw) ? raw : [];
  return state.hivePosts;
}

export function saveHive() {
  storage.set(keys.hive(), state.hivePosts);
}

// ─── DEDUPE ───
export function dedupeLanes() {
  const seen = new Set();
  state.lanes = state.lanes.filter(l => {
    const key = l.id || `${l.driver}|${l.route?.to}|${l.fare}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupeHive() {
  const seen = new Set();
  state.hivePosts = state.hivePosts.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// ─── UTILS ───
export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function timeAgo(ts, fallback = 'just now') {
  const t = Number(ts);
  if (!t) return fallback;
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}

export function fmtDist(m) {
  if (m == null) return '—';
  return m >= 1000
    ? (m / 1000).toFixed(m >= 10000 ? 0 : 1) + ' km'
    : Math.round(m) + ' m';
}

export function distanceM(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371000, toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

// ─── GEOHASH ───
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function geohash(lat, lng, precision = CFG.GEOHASH_PRECISION || 6) {
  let latR = [-90, 90], lngR = [-180, 180];
  let hash = '', bit = 0, ch = 0, even = true;
  while (hash.length < precision) {
    if (even) {
      const m = (lngR[0] + lngR[1]) / 2;
      if (lng >= m) { ch = (ch << 1) + 1; lngR[0] = m; }
      else { ch = ch << 1; lngR[1] = m; }
    } else {
      const m = (latR[0] + latR[1]) / 2;
      if (lat >= m) { ch = (ch << 1) + 1; latR[0] = m; }
      else { ch = ch << 1; latR[1] = m; }
    }
    even = !even;
    if (++bit === 5) { hash += BASE32[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

// ─── VALIDATION ───
export const validateVehicle = (v) => /^[A-Z0-9]{4,15}$/i.test(String(v).replace(/[\s-]/g, ''));
export const normalizeVehicle = (v) => String(v).replace(/[\s-]/g, '').toUpperCase();

// ─── TIMER HELPERS ───
export function setTimer(name, fn, ms) {
  clearTimer(name);
  state.timers[name] = setInterval(fn, ms);
}
export function clearTimer(name) {
  if (state.timers[name]) {
    clearInterval(state.timers[name]);
    delete state.timers[name];
  }
}
export function clearAllTimers() {
  Object.keys(state.timers).forEach(clearTimer);
}

// ─── TOAST (kept here so every module can call it) ───
let _toastTimer = null;
export function showToast(msg, variant = '', duration = CFG.TOAST_DURATION_MS || 2400) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  if (variant) t.dataset.variant = variant; else delete t.dataset.variant;
  t.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.remove('show');
    _toastTimer = null;
  }, duration);
}