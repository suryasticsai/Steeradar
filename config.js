// ================================================================
// config.js — Steeradar shared configuration
// ================================================================
// This file is the single source of truth for the app's cloud DB,
// map styles, and app-wide defaults. Every other script reads
// from window.STEERADAR — so you only edit values HERE.
// ================================================================

window.STEERADAR = {

  // ─────────────────────────────────────────────────────────────
  //  Cloud DB (Google Apps Script + Sheets)
  // ─────────────────────────────────────────────────────────────
  // Deployed as: Web app · Execute as Me · Who has access: Anyone
  // Ping test:   YOUR_URL?action=ping&key=steeradar-secret-2026
  // Expected:    {"data":"pong"}
  SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbxm0oFs9KJEG27Ohjwb2Q7cqMCE5B5-km5RnsoxYFN_lvkn2eLAt0-OsHSeHIwEMaub/exec',

  // Must EXACTLY match SECRET_KEY inside your Apps Script Code.gs
  SHEET_WEBHOOK_SECRET: 'steeradar-secret-2026',

  // Ship with cloud sync ON by default.
  // Users can still toggle it off in Settings → Universal DB.
  CLOUD_SYNC_DEFAULT: true,

  // ─────────────────────────────────────────────────────────────
  //  App metadata
  // ─────────────────────────────────────────────────────────────
  APP_NAME:    'Steeradar',
  APP_VERSION: 'v3.0',
  LOGO_URL:    'https://raw.githubusercontent.com/suryasticsai/Steeradar/main/steerardar-logo.png',

  // ─────────────────────────────────────────────────────────────
  //  Map
  // ─────────────────────────────────────────────────────────────
  MAP_STYLE_BRIGHT: 'https://tiles.openfreemap.org/styles/bright',
  MAP_STYLE_DARK:   'https://tiles.openfreemap.org/styles/dark',
  DEFAULT_CENTER:   { lat: 12.9716, lng: 77.5946 },  // Bengaluru
  DEFAULT_ZOOM:     12,

  // ─────────────────────────────────────────────────────────────
  //  Behaviour
  // ─────────────────────────────────────────────────────────────
  CLOUD_POLL_INTERVAL_MS: 15000,   // how often to re-fetch from Sheets
  TOAST_DURATION_MS:      2200,    // how long toasts stay visible
  LOCAL_ROOM_SLOTS:       20,      // geohash mesh slot count
  GEOHASH_PRECISION:      6,       // ~1 km × 0.6 km per cell

};