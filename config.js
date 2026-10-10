// config.js — Steeradar shared configuration
window.STEERADAR = {
  SHEET_API_URL: 'https://script.google.com/macros/s/AKfycbwMv45uY5nlbXRL12H-zZxfu9KeVIm2o9i3n_kqfw9Xd-4KfS_YK4iD67GfGbmCYtix/exec',
  SHEET_WEBHOOK_SECRET: 'steeradar-secret-2026',
  CLOUD_SYNC_DEFAULT: true,

  APP_NAME: 'Steeradar',
  APP_VERSION: 'v6.0',
  LOGO_URL: 'https://raw.githubusercontent.com/suryasticsai/Steeradar/main/steerardar-logo.png',

  MAP_STYLE_BRIGHT: 'https://tiles.openfreemap.org/styles/bright',
  MAP_STYLE_DARK:   'https://tiles.openfreemap.org/styles/dark',
  DEFAULT_CENTER:   { lat: 12.9716, lng: 77.5946 },
  DEFAULT_ZOOM:     12,

  CLOUD_POLL_INTERVAL_MS: 15000,
  LIVE_POLL_INTERVAL_MS:  5000,
  PRESENCE_INTERVAL_MS:   20000,
  TOAST_DURATION_MS:      2400,
  LOCAL_ROOM_SLOTS:       20,
  GEOHASH_PRECISION:      6,

  VEHICLE_TYPES: [
    { id: 'bus',   label: 'Bus',   emoji: '🚌', seats: 40, color: '#0D9488' },
    { id: 'car',   label: 'Car',   emoji: '🚗', seats: 4,  color: '#4F46E5' },
    { id: 'auto',  label: 'Auto',  emoji: '🛺', seats: 3,  color: '#D97706' },
    { id: 'bike',  label: 'Bike',  emoji: '🏍️', seats: 1,  color: '#DC2626' },
    { id: 'walk',  label: 'Walk',  emoji: '🚶', seats: 1,  color: '#7C3AED' },
    { id: 'event', label: 'Event', emoji: '🎉', seats: 20, color: '#DB2777' },
  ],
};