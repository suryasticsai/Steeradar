// js/hive.js — Community board with edit + delete.

import { api } from './api.js';
import {
  state, storage, showToast,
  dedupeHive, loadHive, saveHive,
  timeAgo,
} from './store.js';

const CFG = window.STEERADAR || {};

let likedPosts = new Set(storage.get('liked', []));
let pendingLikes = new Set();
let _editingPost = null;

// ─── PUBLIC: BOOT ───
export function initHive() {
  wireComposeModal();
}

// ─── LOAD & SAVE ───
export function loadHiveFromStorage() {
  loadHive();
  dedupeHive();
}

function saveLiked() {
  storage.set('liked', [...likedPosts]);
}

// ─── CLOUD SYNC ───
export async function syncHiveFromCloud() {
  const list = await api.listHive();
  if (!Array.isArray(list)) return;

  const byId = new Map(state.hivePosts.map(p => [p.id, p]));
  list.forEach(p => {
    const existing = byId.get(String(p.id));
    if (existing) {
      if (!pendingLikes.has(existing.id)) existing.likes = Number(p.likes) || 0;
    } else {
      state.hivePosts.push({
        id: String(p.id),
        phone: p.phone || '',
        name: p.name || 'Driver',
        avatar: p.avatar || 'D',
        title: p.title || '',
        text: p.text || '',
        tags: p.tags ? String(p.tags).split('|').filter(Boolean) : [],
        time: p.time || 'just now',
        likes: Number(p.likes) || 0,
        ts: Number(p.ts) || Date.now(),
        vehicle: p.vehicle || '',
      });
    }
  });

  state.hivePosts.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
  dedupeHive();
  saveHive();
  renderHive();
}

// ─── RENDER ───
export function renderHive() {
  dedupeHive();
  renderStories();
  renderGreeting();

  const countEl = document.getElementById('hiveCount');
  if (countEl) {
    const n = state.hivePosts.length;
    countEl.textContent = n + ' post' + (n === 1 ? '' : 's');
  }

  const feed = document.getElementById('hiveFeed');
  if (!feed) return;

  if (!state.hivePosts.length) {
    feed.innerHTML = `
      <div class="empty">
        <div class="icon">🐝</div>
        <p>No posts yet. Tap <b>New post</b> to share something with your community.</p>
      </div>`;
    return;
  }

  feed.innerHTML = state.hivePosts.slice().reverse().map(post => {
    const liked = likedPosts.has(post.id);
    return `
      <div class="post-card" data-post-id="${esc(post.id)}">
        <div class="post-head">
          <div class="post-avatar">${esc(post.avatar)}</div>
          <div class="post-meta">
            <div class="post-name">${esc(post.name)}</div>
            <div class="post-time">${esc(timeAgo(post.ts, post.time))}</div>
          </div>
        </div>
        ${post.title ? `<div class="post-title">${esc(post.title)}</div>` : ''}
        <div class="post-body">${esc(post.text)}</div>
        ${post.tags && post.tags.length
          ? `<div class="post-tags">${post.tags.map(t => `<span class="post-tag">${esc(t)}</span>`).join('')}</div>`
          : ''}
        <div class="post-actions">
          <button class="pa-btn ${liked ? 'liked' : ''}" data-act="like" data-id="${esc(post.id)}">
            <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <span class="cnt">${post.likes || 0}</span>
          </button>
        </div>
      </div>
    `;
  }).join('');

  feed.querySelectorAll('.post-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="like"]')) return;
      const post = state.hivePosts.find(p => p.id === card.dataset.postId);
      if (post) showPostDetail(post);
    });
  });

  feed.querySelectorAll('[data-act="like"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const post = state.hivePosts.find(p => p.id === btn.dataset.id);
      if (!post) return;
      toggleLike(post);
      renderHive();
    });
  });
}

// ─── STORIES ───
function renderStories() {
  const row = document.getElementById('storyRow');
  if (!row) return;

  const seen = new Set();
  const driverStories = [];
  for (const lane of state.lanes) {
    if (seen.has(lane.driver)) continue;
    seen.add(lane.driver);
    driverStories.push({ label: lane.driver.split(' ')[0], avatar: lane.avatar, driver: lane.driver });
    if (driverStories.length >= 5) break;
  }

  const stories = [{ label: 'Add', avatar: '＋', add: true }, ...driverStories];

  row.innerHTML = stories.map(s => `
    <div class="story" ${s.driver ? `data-driver="${esc(s.driver)}"` : ''}>
      <div class="story-ring">
        <div class="story-inner ${s.add ? 'add' : ''}">${esc(s.avatar)}</div>
      </div>
      <div class="story-name">${esc(s.label)}</div>
    </div>
  `).join('');

  row.querySelectorAll('[data-driver]').forEach(el => {
    el.addEventListener('click', () => {
      const driver = el.dataset.driver;
      const posts = state.hivePosts.filter(p => p.name === driver);
      if (posts.length) showPostDetail(posts[0]);
      else showToast('No posts from ' + driver + ' yet');
    });
  });

  const addStory = row.querySelector('.story:not([data-driver])');
  if (addStory) addStory.addEventListener('click', () => openComposeModal());
}

// ─── GREETING ───
function renderGreeting() {
  const el = document.getElementById('greetingText');
  if (!el) return;
  const hour = new Date().getHours();
  const g = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (state.userName || 'friend').split(' ')[0];
  el.textContent = `${g}, ${firstName} 👋`;
}

// ─── LIKE ───
function toggleLike(post) {
  const id = post.id;
  const delta = likedPosts.has(id) ? -1 : 1;

  if (delta < 0) {
    likedPosts.delete(id);
    post.likes = Math.max(0, (post.likes || 0) - 1);
  } else {
    likedPosts.add(id);
    post.likes = (post.likes || 0) + 1;
  }

  saveLiked();
  saveHive();

  pendingLikes.add(id);
  api.like(id, delta)
    .then(r => {
      if (r && typeof r.likes === 'number') {
        post.likes = r.likes;
        saveHive();
        renderHive();
      }
    })
    .finally(() => pendingLikes.delete(id));
}

// ─── POST DETAIL ───
export function showPostDetail(post) {
  const liked = likedPosts.has(post.id);
  const content = document.getElementById('postDetailContent');
  if (!content) return;

  const isMine = isMyPost(post);

  content.innerHTML = `
    <div class="pd-head">
      <div class="pd-avatar">${esc(post.avatar)}</div>
      <div>
        <div class="pd-name">${esc(post.name)}</div>
        <div class="pd-time">${esc(timeAgo(post.ts, post.time))}</div>
      </div>
    </div>
    ${post.title ? `<h2>${esc(post.title)}</h2>` : ''}
    <div class="pd-body">${esc(post.text).replace(/\n/g, '<br>')}</div>
    ${post.tags && post.tags.length
      ? `<div class="post-tags" style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${post.tags.map(t => `<span class="post-tag">${esc(t)}</span>`).join('')}</div>`
      : ''}
    <div class="pd-actions">
      <button class="pa-btn ${liked ? 'liked' : ''}" id="pdLike"
        style="display:flex;align-items:center;gap:6px;font-weight:600;color:${liked ? 'var(--coral)' : 'var(--text-2)'}">
        <svg viewBox="0 0 24 24" fill="${liked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <span>${post.likes || 0}</span>
      </button>
      ${isMine ? '<button class="pd-edit-btn" id="pdEdit">✎ Edit</button>' : ''}
      ${isMine ? '<button class="pd-edit-btn" id="pdDelete" style="color:var(--coral);border-color:var(--coral)">🗑 Delete</button>' : ''}
    </div>
  `;

  document.getElementById('pdLike').onclick = () => {
    toggleLike(post);
    renderHive();
    showPostDetail(post);
  };

  wireHiveEdit(post);
  document.getElementById('postDetailModal')?.classList.add('active');
}

function isMyPost(post) {
  return post.vehicle === state.vehicle
      && (post.phone ? post.phone === state.phone : post.name === state.userName);
}

function wireHiveEdit(post) {
  const edit = document.getElementById('pdEdit');
  const del  = document.getElementById('pdDelete');

  if (edit) edit.onclick = () => {
    document.getElementById('postDetailModal')?.classList.remove('active');
    openComposeModal(post);
  };

  if (del) del.onclick = async () => {
    if (!confirm('Delete this post?')) return;
    try { await api.call('delete', { sheet: 'hive', id: post.id }); } catch {}
    state.hivePosts = state.hivePosts.filter(p => p.id !== post.id);
    saveHive();
    renderHive();
    document.getElementById('postDetailModal')?.classList.remove('active');
    showToast('Post deleted', 'success');
  };
}

// ═══════════════════════════════════════════════════════════════
//  COMPOSE MODAL
// ═══════════════════════════════════════════════════════════════
function wireComposeModal() {
  const cancel = document.getElementById('hiveComposeCancel');
  const submit = document.getElementById('hiveComposeSubmit');
  const overlay = document.getElementById('hiveComposeModal');

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeComposeModal();
    });
  }
  if (cancel) cancel.onclick = closeComposeModal;
  if (submit) submit.onclick = handleComposeSubmit;

  const heading = document.getElementById('hiveHeading');
  if (heading) {
    heading.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('hiveBody')?.focus();
      }
    });
  }
}

export function openComposeModal(post = null) {
  const modal = document.getElementById('hiveComposeModal');
  if (!modal) { showToast('Compose modal missing'); return; }

  _editingPost = post;

  const headEl = document.querySelector('#hiveComposeModal .modal-head h3');
  if (headEl) headEl.textContent = post ? 'Edit post' : 'New post';

  document.getElementById('hiveHeading').value = post?.title || '';
  document.getElementById('hiveBody').value    = post?.text  || '';
  document.getElementById('hiveTags').value    = post?.tags?.join(', ') || '';

  modal.classList.add('active');
  setTimeout(() => document.getElementById('hiveHeading').focus(), 250);
}

function closeComposeModal() {
  document.getElementById('hiveComposeModal')?.classList.remove('active');
}

async function handleComposeSubmit() {
  const title   = document.getElementById('hiveHeading').value.trim();
  const text    = document.getElementById('hiveBody').value.trim();
  const tagsRaw = document.getElementById('hiveTags').value.trim();

  if (!title && !text) { showToast('Write something first', 'error'); return; }

  const tags = tagsRaw
    ? tagsRaw.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 5)
    : [];

  if (_editingPost) {
    const p = _editingPost;
    p.title = title;
    p.text = text || title;
    p.tags = tags;
    saveHive();
    try {
      await api.call('update', { sheet: 'hive', id: p.id, row: { title, text, tags: tags.join('|') } });
    } catch {}
    renderHive();
    showToast('Post updated', 'success');
  } else {
    await publishPost(title, text || title, tags);
  }

  closeComposeModal();
  _editingPost = null;
}

// ─── PUBLISH ───
export async function publishPost(title, text, tags = []) {
  if (!text || !text.trim()) return;

  const post = {
    id: 'hive-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    phone: state.phone || '',
    name: state.userName || 'Driver',
    avatar: (state.userName || 'DR').substring(0, 2).toUpperCase(),
    title: (title || '').trim(),
    text: text.trim(),
    tags: tags || [],
    time: 'just now',
    likes: 0,
    ts: Date.now(),
    vehicle: state.vehicle,
  };

  state.hivePosts.push(post);
  saveHive();
  renderHive();
  showToast('Posted to Hive 🐝', 'success');

  if (window.Steeradar?.broadcastToAllPeers) {
    window.Steeradar.broadcastToAllPeers({ type: 'hive-post', post });
  }

  const row = {
    id: post.id,
    phone: post.phone,
    name: post.name,
    avatar: post.avatar,
    title: post.title,
    text: post.text,
    tags: post.tags.join('|'),
    time: post.time,
    likes: 0,
    ts: post.ts,
    vehicle: state.vehicle,
  };
  const r = await api.insertHive(row);
  if (!r) showToast('Saved locally — cloud: ' + (api.lastError || 'failed'), 'error');
}

// ─── UTILS ───
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── PUBLIC API ───
export const hive = {
  init: initHive,
  loadFromStorage: loadHiveFromStorage,
  syncFromCloud: syncHiveFromCloud,
  render: renderHive,
  openCompose: openComposeModal,
  publish: publishPost,
  showDetail: showPostDetail,
};