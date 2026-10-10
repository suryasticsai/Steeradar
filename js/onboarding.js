// js/onboarding.js — Vehicle gate + photo collection step.
// Runs on first visit. Blocks the app until a vehicle is entered.
// Photos are optional but encouraged.

import { state, storage, showToast, validateVehicle, normalizeVehicle } from './store.js';
import { setupPhotoUploads } from './photos.js';

const CFG = window.STEERADAR || {};

let _uploader = null;
let _pendingVehicle = null;

// ─── ENTRY POINT ───
// Call this once from app.js boot. Returns true if the app should unlock,
// false if the gate is showing.
export function initOnboarding(onUnlock) {
  const gate  = document.getElementById('onboardGate');
  const input = document.getElementById('onboardVehicle');
  const btn   = document.getElementById('onboardBtn');
  const step2 = document.getElementById('onboardPhotos');

  if (!gate || !input || !btn) {
    console.warn('[onboarding] gate elements missing');
    return true; // nothing to gate
  }

  // Already onboarded?
  const saved = storage.raw('vehicle', '');
  if (saved && validateVehicle(saved)) {
    state.vehicle = saved;
    gate.style.display = 'none';
    return true;
  }

  // ─── STEP 1: vehicle input ───
  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
    const valid = validateVehicle(input.value);
    btn.disabled = !valid;
    input.classList.toggle('invalid', input.value.length > 3 && !valid);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !btn.disabled) btn.click();
  });

  btn.addEventListener('click', () => {
    const v = normalizeVehicle(input.value);
    if (!validateVehicle(v)) {
      showToast('Invalid vehicle number', 'error');
      return;
    }
    _pendingVehicle = v;
    showStep2(step2, gate, onUnlock);
  });

  setTimeout(() => input.focus(), 400);
  return false;
}

// ─── STEP 2: photos ───
function showStep2(step2, gate, onUnlock) {
  if (!step2) {
    // HTML wasn't updated — skip straight to unlock
    finishOnboarding(onUnlock, {});
    return;
  }

  // Hide step-1 elements
  ['.onboard-card', '.oc-features', '.onboard-foot', '.onboard-tagline', '.onboard-title', '.onboard-logo']
    .forEach(sel => {
      const el = gate.querySelector(sel);
      if (el) el.style.display = 'none';
    });

  step2.style.display = 'flex';

  // Wire photo uploads (photos.js)
  _uploader = setupPhotoUploads({
    apiUrl: CFG.SHEET_API_URL,
    apiKey: CFG.SHEET_WEBHOOK_SECRET,
    folder: 'users',
    onUpload: () => {
      const done = document.getElementById('onboardPhotosDone');
      if (!done) return;
      const any = Object.values(_uploader.getAll()).some(Boolean);
      done.disabled = !any;
    },
  });

  const doneBtn = document.getElementById('onboardPhotosDone');
  const skipBtn = document.getElementById('onboardPhotosSkip');

  if (doneBtn) {
    doneBtn.onclick = () => {
      const photos = _uploader ? _uploader.getAll() : {};
      finishOnboarding(onUnlock, photos);
    };
  }

  if (skipBtn) {
    skipBtn.onclick = () => finishOnboarding(onUnlock, {});
  }
}

// ─── FINISH ───
async function finishOnboarding(onUnlock, photos) {
  const vehicle = _pendingVehicle;

  // Persist locally first — app must work even if cloud fails
  storage.setRaw('vehicle', vehicle);
  state.vehicle = vehicle;

  // Save photo metadata locally so it survives reload
  if (photos && Object.keys(photos).length) {
    storage.set('photos', photos);
    // Best-effort push to cloud if user is signed in
    pushPhotosToCloud(photos).catch(() => {});
  }

  // Fade out gate
  const gate = document.getElementById('onboardGate');
  if (gate) {
    gate.classList.add('hidden');
    setTimeout(() => {
      gate.style.display = 'none';
      if (typeof onUnlock === 'function') onUnlock();
    }, 500);
  } else {
    if (typeof onUnlock === 'function') onUnlock();
  }
}

// ─── PUSH PHOTOS TO CLOUD (only if signed in) ───
async function pushPhotosToCloud(photos) {
  const phone = storage.raw('phone', '');
  const token = storage.raw('token', '');
  if (!phone || !token) return; // not signed in yet — fine

  const payload = {
    action: 'updateMe',
    key: CFG.SHEET_WEBHOOK_SECRET,
    phone, token,
    avatarUrl:       photos.avatar?.url       || '',
    vehiclePhotoUrl: photos.vehiclePhoto?.url || '',
    platePhotoUrl:   photos.platePhoto?.url   || '',
    upiQrUrl:        photos.upiQr?.url        || '',
  };

  await fetch(CFG.SHEET_API_URL, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
}

// ─── PUBLIC HELPERS ───
export function getPhotos() {
  return storage.get('photos', {});
}

export function resetOnboarding() {
  storage.removeRaw('vehicle');
  storage.remove('photos');
  location.reload();
}