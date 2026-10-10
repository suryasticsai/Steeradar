// ================================================================
// config.js — Steeradar shared configuration
// Edit values HERE. Every other file reads from window.STEERADAR.
// ================================================================

window.STEERADAR = {

  // ─── Cloud DB (Google Apps Script + Sheets) ─────────────────
  SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbw1RLvtA1InEndeJdLvqxPtaxEcZ1GYYyzmbkUbm4nRyO6iRnh8eg8ytcE5br9YZ2_Y/exec',

  // Must match SECRET_KEY in your Apps Script Code.gs
  SHEET_WEBHOOK_SECRET: 'steeradar-secret-2026',

  // Toggle cloud sync on/off by default
  // (Users can override in Settings → Universal DB)
  CLOUD_SYNC_DEFAULT: true,

  // ─── App metadata ───────────────────────────────────────────
  APP_NAME: 'Steeradar',
  APP_VERSION: 'v3.0',
  LOGO_URL: 'https://raw.githubusercontent.com/suryasticsai/Steeradar/main/steerardar-logo.png',

  // ─── Map ────────────────────────────────────────────────────
  MAP_STYLE_BRIGHT: 'https://tiles.openfreemap.org/styles/bright',
  MAP_STYLE_DARK:   'https://tiles.openfreemap.org/styles/dark',
  DEFAULT_CENTER:   { lat: 12.9716, lng: 77.5946 },
  DEFAULT_ZOOM:     12,

  // ─── Behaviour ──────────────────────────────────────────────
  CLOUD_POLL_INTERVAL_MS: 15000,
  TOAST_DURATION_MS:      2200,
  LOCAL_ROOM_SLOTS:       20,
  GEOHASH_PRECISION:      6,
};