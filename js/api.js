// js/api.js — Single gateway for every Apps Script call.
// Handles timeout, JSON parse, error formatting, and future auth headers.

const CFG = window.STEERADAR || {};

export const api = {
  url: localStorage.getItem('steeradar-cloud-url') || CFG.SHEET_API_URL || '',
  key: localStorage.getItem('steeradar-cloud-key') || CFG.SHEET_WEBHOOK_SECRET || '',
  lastError: '',

  /**
   * Low-level call. Every backend action flows through here.
   * @param {string} action
   * @param {object} params
   * @returns {Promise<any|null>} data on success, null on failure (see api.lastError)
   */
  async call(action, params = {}) {
    if (!this.url) {
      this.lastError = 'No API URL configured';
      return null;
    }
    this.lastError = '';

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);

    try {
      const res = await fetch(this.url, {
        method: 'POST',
        redirect: 'follow',
        signal: ctrl.signal,
        body: JSON.stringify({ action, key: this.key, ...params }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('Server returned HTML — check deployment is set to "Anyone"');
      }

      if (data.error) throw new Error(data.error + (data.message ? ' — ' + data.message : ''));
      return data.data;
    } catch (e) {
      this.lastError = e.name === 'AbortError' ? 'Timed out after 20s' : (e.message || String(e));
      console.warn('[api]', action, 'failed:', this.lastError);
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  /** Convenience wrapper — same as call() but guaranteed to return an array. */
  async list(action, params = {}) {
    const r = await this.call(action, params);
    return Array.isArray(r) ? r : [];
  },

  /** Health check. Returns true/false. */
  async ping() {
    return (await this.call('ping')) === 'pong';
  },

  /** Server-side diagnostics: sheet URL, row counts per tab. */
  debug() {
    return this.call('debug');
  },

  // ─── AUTH ───
  sendOtp(phone, email, purpose = 'register') {
    return this.call('sendOtp', { phone, email, purpose });
  },
  verifyOtp(phone, code) {
    return this.call('verifyOtp', { phone, code });
  },
  register(data) {
    return this.call('register', data);
  },
  login(phone, token) {
    return this.call('login', { phone, token });
  },
  logout(phone, token) {
    return this.call('logout', { phone, token });
  },
  checkSession(phone, token) {
    return this.call('checkSession', { phone, token });
  },
  getMe(phone, token) {
    return this.call('getMe', { phone, token });
  },
  updateMe(phone, token, updates) {
    return this.call('updateMe', { phone, token, ...updates });
  },

  // ─── LANES ───
  listLanes()             { return this.list('listLanes'); },
  insertLane(row)         { return this.call('insertLane', { row }); },
  updateLane(id, row)     { return this.call('updateLane', { id, row }); },
  removeLane(id)          { return this.call('removeLane', { id }); },

  // ─── HIVE ───
  listHive()              { return this.list('listHive'); },
  insertHive(row)         { return this.call('insertHive', { row }); },
  like(id, delta)         { return this.call('like', { id, delta }); },

  // ─── MESSAGES ───
  getMessages(roomId, limit = 50) {
    return this.list('getMessages', { roomId, limit });
  },
  sendMessage(row)        { return this.call('sendMessage', { row }); },

  // ─── PRESENCE ───
  updatePresence(row)     { return this.call('updatePresence', { row }); },
  activeVehicles()        { return this.list('activeVehicles'); },
  removePresence(vehicle) { return this.call('removePresence', { vehicle }); },

  // ─── TRIPS ───
  startTrip(data)         { return this.call('startTrip', data); },
  endTrip(data)           { return this.call('endTrip', data); },
  myTrips(phone, token)   { return this.list('myTrips', { phone, token }); },
};