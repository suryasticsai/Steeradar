// js/logger.js — In-app logger. Captures console + errors + fetch failures.
// Opens via long-press on the logo. Exports log to clipboard.

const MAX_BUFFER = 300;
const STORAGE_KEY = 'steeradar-log';
const buffer = [];

// Restore from storage on load
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if (Array.isArray(saved)) buffer.push(...saved);
} catch {}

function push(level, args) {
  const msg = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message + '\n' + (a.stack || '');
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');

  buffer.push({ t: Date.now(), level, msg });
  if (buffer.length > MAX_BUFFER) buffer.shift();

  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-100))); } catch {}
}

export function initLogger() {
  // Patch console methods
  const orig = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    info:  console.info.bind(console),
  };

  ['log', 'warn', 'error', 'info'].forEach(k => {
    console[k] = (...args) => {
      push(k === 'log' ? 'info' : k, args);
      orig[k](...args);
    };
  });

  // Uncaught errors
  window.addEventListener('error', (e) => {
    push('error', ['[uncaught]', e.message, `${e.filename}:${e.lineno}`]);
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    push('error', ['[unhandled]', e.reason?.message || String(e.reason)]);
  });

  // Intercept fetch to log failures + non-OK responses
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || 'unknown');
    try {
      const res = await origFetch(...args);
      if (!res.ok) push('warn', ['[fetch]', res.status, url.slice(0, 80)]);
      return res;
    } catch (err) {
      push('error', ['[fetch]', 'FAILED', url.slice(0, 80), err.message]);
      throw err;
    }
  };

  push('info', ['Logger initialized']);
}

export function renderLogViewer() {
  const el = document.getElementById('logContent');
  if (!el) return;

  const entries = buffer.slice().reverse();

  if (!entries.length) {
    el.innerHTML = '<div class="log-empty">No logs yet.</div>';
    return;
  }

  el.innerHTML = entries.map(e => {
    const time = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const cls = e.level === 'error' ? 'log-error'
              : e.level === 'warn' ? 'log-warn'
              : 'log-info';
    return `<div class="log-line ${cls}">
      <span class="log-time">${time}</span>
      <span class="log-msg">${escapeHtml(e.msg)}</span>
    </div>`;
  }).join('');
}

export function clearLog() {
  buffer.length = 0;
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  renderLogViewer();
}

export function getLogText() {
  return buffer
    .map(e => `[${new Date(e.t).toISOString()}] [${e.level}] ${e.msg}`)
    .join('\n');
}

export function exportLog() {
  const text = getLogText() || '(empty)';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => window.Steeradar?.showToast?.('Log copied to clipboard', 'success'))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    window.Steeradar?.showToast?.('Log copied', 'success');
  } catch {
    window.Steeradar?.showToast?.('Copy failed');
  }
  document.body.removeChild(ta);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export const logger = {
  init: initLogger,
  render: renderLogViewer,
  clear: clearLog,
  export: exportLog,
  getText: getLogText,
};