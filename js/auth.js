// js/auth.js — OTP login + registration flow.
// Two modes:
//   • register: new user, needs phone + email + name + username
//   • login:    existing user, needs phone + email only
// Uses api.sendOtp → api.verifyOtp → api.register/login.

import { api } from './api.js';
import { state, storage, session, showToast } from './store.js';

const CFG = window.STEERADAR || {};

// ─── STATE ───
let _mode = 'register';       // 'register' | 'login'
let _pendingPhone = '';
let _pendingEmail = '';

// ─── PUBLIC ENTRY ───
export function initAuth() {
  // Called on boot — refreshes UI from saved session
  refreshSessionUI();
  wireButtons();
}

// ─── SESSION VALIDATION ON BOOT ───
export async function validateSessionOnBoot() {
  if (!session.isLoggedIn()) return false;
  const r = await api.checkSession(state.phone, state.token);
  if (!r || !r.valid) {
    session.clear();
    refreshSessionUI();
    return false;
  }
  // Pull fresh user data
  const me = await api.getMe(state.phone, state.token);
  if (me && me.ok && me.user) {
    state.userName = me.user.name || state.userName;
    storage.setRaw('name', state.userName);
    storage.set('user', me.user);
    refreshSessionUI();
  }
  return true;
}

// ─── UI HELPERS ───
function refreshSessionUI() {
  const avatar = document.getElementById('avatarBtn');
  if (avatar) {
    avatar.textContent = (state.userName || '?').charAt(0).toUpperCase();
  }
  // Update settings row if it exists
  const nameField = document.getElementById('setName');
  if (nameField && state.userName) nameField.value = state.userName;
}

function wireButtons() {
  const loginBtn = document.getElementById('authOpenBtn');       // optional trigger
  if (loginBtn) loginBtn.onclick = () => openAuthSheet('login');

  const logoutBtn = document.getElementById('authLogoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;

  // Sheet internal buttons
  const sendOtp = document.getElementById('authSendOtp');
  if (sendOtp) sendOtp.onclick = handleSendOtp;

  const verifyOtp = document.getElementById('authVerifyOtp');
  if (verifyOtp) verifyOtp.onclick = handleVerifyOtp;

  const confirm = document.getElementById('authConfirm');
  if (confirm) confirm.onclick = handleRegisterOrLogin;

  const close = document.getElementById('authClose');
  if (close) close.onclick = closeAuthSheet;
}

// ─── SHEET OPEN/CLOSE ───
export function openAuthSheet(mode = 'register') {
  _mode = mode;
  _pendingPhone = '';
  _pendingEmail = '';

  const sheet = document.getElementById('authModal');
  if (!sheet) { showToast('Auth UI not present', 'error'); return; }

  // Update title + step visibility
  document.getElementById('authTitle').textContent = mode === 'register' ? 'Create your account' : 'Sign in';
  document.getElementById('authStep1').style.display = 'block';
  document.getElementById('authStep2').style.display = 'none';
  document.getElementById('authStep3').style.display = 'none';

  // If mode is login, hide register-only fields on step 3
  ['authName', 'authUsername'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.parentElement.style.display = mode === 'register' ? 'block' : 'none';
  });

  sheet.classList.add('active');
}

function closeAuthSheet() {
  document.getElementById('authModal')?.classList.remove('active');
}

// ─── STEP 1: SEND OTP ───
async function handleSendOtp() {
  const phone = String(document.getElementById('authPhone')?.value || '').trim();
  const email = String(document.getElementById('authEmail')?.value || '').trim().toLowerCase();

  if (!/^\d{10}$/.test(phone)) { showToast('Enter a valid 10-digit phone', 'error'); return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { showToast('Enter a valid email', 'error'); return; }

  const btn = document.getElementById('authSendOtp');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const r = await api.sendOtp(phone, email, _mode);
    if (!r || !r.ok) {
      showToast(r?.error ? 'Error: ' + r.error : 'Could not send OTP', 'error');
      return;
    }
    _pendingPhone = phone;
    _pendingEmail = email;
    showToast('Code sent to ' + r.sentTo, 'success');

    // Show step 2
    document.getElementById('authStep1').style.display = 'none';
    document.getElementById('authStep2').style.display = 'block';
    document.getElementById('authCode')?.focus();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send code';
  }
}

// ─── STEP 2: VERIFY OTP ───
async function handleVerifyOtp() {
  const code = String(document.getElementById('authCode')?.value || '').trim();
  if (!/^\d{6}$/.test(code)) { showToast('Enter the 6-digit code', 'error'); return; }

  const btn = document.getElementById('authVerifyOtp');
  btn.disabled = true;
  btn.textContent = 'Verifying…';

  try {
    const r = await api.verifyOtp(_pendingPhone, code);
    if (!r || !r.ok) {
      const msg = r?.attemptsLeft != null
        ? 'Wrong code · ' + r.attemptsLeft + ' tries left'
        : (r?.error ? 'Error: ' + r.error : 'Verification failed');
      showToast(msg, 'error');
      return;
    }
    showToast('Verified ✓', 'success');

    // Show step 3
    document.getElementById('authStep2').style.display = 'none';
    document.getElementById('authStep3').style.display = 'block';

    if (_mode === 'login') {
      // Auto-complete for login
      await completeLogin();
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify';
  }
}

// ─── STEP 3: REGISTER OR LOGIN ───
async function handleRegisterOrLogin() {
  if (_mode === 'login') return completeLogin();

  const name     = String(document.getElementById('authName')?.value || '').trim();
  const username = String(document.getElementById('authUsername')?.value || '').trim();
  const vehicle  = state.vehicle || '';
  const vehicleType = state.selectedVehicleType || 'car';

  if (!name) { showToast('Enter your name', 'error'); return; }
  if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) {
    showToast('Username: 3-20 letters, numbers, _ or .', 'error');
    return;
  }

  const btn = document.getElementById('authConfirm');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const r = await api.register({
      phone: _pendingPhone,
      email: _pendingEmail,
      name, username, vehicle, vehicleType,
      device: navigator.userAgent.slice(0, 100),
    });

    if (!r || !r.ok) {
      const msg = r?.error === 'username_taken'
        ? 'That username is taken'
        : (r?.error ? 'Error: ' + r.error : 'Registration failed');
      showToast(msg, 'error');
      return;
    }

    session.set({ phone: _pendingPhone, token: r.token, user: r.user });
    refreshSessionUI();
    showToast('Welcome, ' + (r.user?.name || 'friend') + '!', 'success');
    closeAuthSheet();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create account';
  }
}

async function completeLogin() {
  const btn = document.getElementById('authConfirm') || document.getElementById('authVerifyOtp');
  if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }

  try {
    const r = await api.login(_pendingPhone, state.token);
    if (!r || !r.ok) {
      showToast(r?.error === 'not_registered' ? 'No account for this number' : 'Login failed', 'error');
      return;
    }
    session.set({ phone: _pendingPhone, token: r.token, user: r.user });
    refreshSessionUI();
    showToast('Signed in', 'success');
    closeAuthSheet();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continue'; }
  }
}

// ─── LOGOUT ───
export async function logout() {
  if (session.isLoggedIn()) {
    try { await api.logout(state.phone, state.token); } catch {}
  }
  session.clear();
  refreshSessionUI();
  showToast('Signed out');
}

// ─── PUBLIC ───
export const auth = {
  isLoggedIn: () => session.isLoggedIn(),
  user: () => session.user(),
  open: openAuthSheet,
  logout,
  validateSessionOnBoot,
};