// js/photos.js — image compression, upload, preview

export async function compressImage(file, maxWidth = 1200, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadImage(base64, folder, filename, apiUrl, apiKey) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    body: JSON.stringify({ action: 'uploadImage', key: apiKey, base64, folder, filename }),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.data;
}

export async function deleteImage(fileId, apiUrl, apiKey) {
  const res = await fetch(apiUrl, {
    method: 'POST',
    body: JSON.stringify({ action: 'deleteImage', key: apiKey, fileId }),
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.data;
}

const SLOT_EMOJI = {
  avatar: '📷',
  vehiclePhoto: '🚗',
  platePhoto: '🔢',
  upiQr: '💳',
};

export function setupPhotoUploads({ apiUrl, apiKey, folder = 'users', onUpload }) {
  const uploaded = {};
  const cards = document.querySelectorAll('.photo-card');

  cards.forEach(card => {
    const input = card.querySelector('input[type="file"]');
    const preview = card.querySelector('.photo-preview');
    const slot = card.dataset.slot;

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      card.classList.remove('uploaded');
      card.classList.add('uploading');
      preview.innerHTML = `<div class="photo-progress">Uploading…</div>`;

      try {
        const b64 = await compressImage(file, 1200, 0.75);
        const res = await uploadImage(b64, folder + '/' + slot, slot + '_' + Date.now() + '.jpg', apiUrl, apiKey);
        uploaded[slot] = { fileId: res.fileId, url: res.url };
        card.classList.remove('uploading');
        card.classList.add('uploaded');
        preview.innerHTML = `
          <img src="${res.url}" alt="${slot}">
          <button class="remove-photo" type="button">✕</button>
        `;
        preview.querySelector('.remove-photo').onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          removePhoto(slot, card, preview);
        };
        if (onUpload) onUpload(slot, uploaded[slot]);
      } catch (err) {
        card.classList.remove('uploading');
        preview.innerHTML = `<span class="photo-placeholder">⚠️</span>`;
        console.error('Upload failed:', err);
        if (window.Steeradar?.showToast) {
          window.Steeradar.showToast('Upload failed: ' + err.message, 'error');
        }
      }
    });
  });

  async function removePhoto(slot, card, preview) {
    const current = uploaded[slot];
    if (current && current.fileId) {
      try { await deleteImage(current.fileId, apiUrl, apiKey); } catch (e) {}
    }
    delete uploaded[slot];
    card.classList.remove('uploaded');
    preview.innerHTML = `<span class="photo-placeholder">${SLOT_EMOJI[slot] || '📷'}</span>`;
    if (onUpload) onUpload(slot, null);
  }

  return {
    getAll: () => ({ ...uploaded }),
    has: (slot) => !!uploaded[slot],
    get: (slot) => uploaded[slot],
  };
}