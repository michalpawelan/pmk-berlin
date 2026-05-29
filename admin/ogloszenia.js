// admin/ogloszenia.js — Ogloszenia-Tab Logic.
// Tygodniowy biuletyn parafialny: lista + formularz (dodaj/edytuj) + upload zdjecia.
// Backend: Apps Script actions listOgloszenia / addOgloszenie / updateOgloszenie /
//          deleteOgloszenie / toggleOgloszeniePublish (siehe admin/google-apps-script.js).

const Ogloszenia = (function() {
  'use strict';

  let list = [];
  let loading = false;
  let editingId = null;     // null => formularz dla nowego ogloszenia
  let formOpen = false;
  let pendingImageUrl = ''; // ustawiane przez handleFileSelect
  let pendingImagePreview = ''; // dataURL do podgladu (lokalny, szybszy niz z Drive)

  // ============================================
  // Util
  // ============================================
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pl-PL', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function convertDriveUrl(url) {
    if (!url) return '';
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (match) return 'https://lh3.googleusercontent.com/d/' + match[1] + '=w400';
    return url;
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info');
    } else {
      // Fallback (events.js definiert showToast nur intern als Closure).
      const container = document.getElementById('toastContainer');
      if (!container) { console.log('[ogloszenia] ' + msg); return; }
      const el = document.createElement('div');
      el.className = 'toast ' + (type || 'info');
      el.textContent = msg;
      container.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  }

  // ============================================
  // API
  // ============================================
  // GET via URL-params (spiegelt apiCall aus events.js). Apps Script doGet/doPost
  // lesen beide aus e.parameter, daher reicht GET fuer Reads UND Writes hier.
  async function callApi(action, params) {
    params = params || {};
    const url = new URL(Auth.url);
    url.searchParams.set('action', action);
    url.searchParams.set('pin', Auth.getPin());
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      url.searchParams.set(k, String(v));
    });
    const res = await fetch(url.toString(), { redirect: 'follow' });
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { success: false, error: 'Blad serwera' }; }
  }

  async function load() {
    const pin = Auth.getPin();
    if (!pin) { render(); return; }
    loading = true;
    render();
    try {
      const data = await callApi('listOgloszenia');
      list = (data && Array.isArray(data.ogloszenia)) ? data.ogloszenia : [];
    } catch (e) {
      list = [];
    } finally {
      loading = false;
      render();
    }
  }

  async function add(payload) {
    return callApi('addOgloszenie', payload);
  }

  async function update(id, payload) {
    return callApi('updateOgloszenie', Object.assign({ id: id }, payload));
  }

  async function remove(id) {
    return callApi('deleteOgloszenie', { id: id });
  }

  async function togglePublish(id) {
    return callApi('toggleOgloszeniePublish', { id: id });
  }

  // ============================================
  // Image upload (reuses /.netlify/functions/upload — same flow as events.js)
  // ============================================
  function compressImage(file, maxWidth, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        URL.revokeObjectURL(img.src);
        resolve({ base64: dataUrl.split(',')[1], dataUrl: dataUrl });
      };
      img.onerror = () => reject(new Error('Nie udalo sie zaladowac obrazu'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function handleFileSelect(files) {
    const file = files && files[0];
    if (!file || !file.type.startsWith('image/')) {
      toast('Tylko pliki graficzne (JPG, PNG, WebP)', 'error');
      return;
    }
    const zone = document.getElementById('oglUploadZone');
    if (zone) zone.dataset.state = 'uploading';
    render();

    try {
      const compressed = await compressImage(file, 1200, 0.8);
      const fileName = 'ogloszenie-' + Date.now() + '.jpg';

      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/.netlify/functions/upload');
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Nieprawidlowa odpowiedz')); } };
        xhr.onerror = () => reject(new Error('Blad sieci'));
        xhr.send(JSON.stringify({
          fileName: fileName,
          mimeType: 'image/jpeg',
          data: compressed.base64,
          pin: Auth.getPin()
        }));
      });

      if (result && result.success) {
        pendingImageUrl = result.imageUrl || '';
        pendingImagePreview = compressed.dataUrl;
        toast('Zdjęcie przesłane', 'success');
      } else {
        throw new Error((result && result.error) || 'Upload nie powiódł się');
      }
    } catch (err) {
      toast('Błąd przesyłania: ' + err.message, 'error');
    } finally {
      render();
    }
  }

  function removePendingImage() {
    pendingImageUrl = '';
    pendingImagePreview = '';
    render();
  }

  // ============================================
  // Form open / save
  // ============================================
  function openForm(item) {
    editingId = item ? item.id : null;
    formOpen = true;
    pendingImageUrl = item ? (item.image_url || '') : '';
    pendingImagePreview = '';
    render();
    // Pre-fill po renderze
    setTimeout(() => {
      const t = document.getElementById('oglFormTitle');
      const b = document.getElementById('oglFormBody');
      if (t && item) t.value = item.title || '';
      if (b && item) b.value = item.body || '';
      if (t) t.focus();
    }, 0);
  }

  function closeForm() {
    formOpen = false;
    editingId = null;
    pendingImageUrl = '';
    pendingImagePreview = '';
    render();
  }

  async function saveForm() {
    const titleEl = document.getElementById('oglFormTitle');
    const bodyEl  = document.getElementById('oglFormBody');
    const title = titleEl ? titleEl.value.trim() : '';
    const body  = bodyEl  ? bodyEl.value.trim()  : '';

    if (!title) { toast('Tytuł jest wymagany', 'error'); return; }

    const payload = {
      title: title,
      body: body,
      image_url: pendingImageUrl || ''
    };

    const saveBtn = document.getElementById('oglFormSave');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Zapisywanie…'; }

    try {
      let result;
      if (editingId) {
        // Behalte aktuellen Status (TAK/NIE) wenn moeglich.
        const existing = list.find(o => o.id === editingId);
        if (existing && existing.published) payload.published = existing.published;
        result = await update(editingId, payload);
      } else {
        result = await add(payload);
      }
      if (result && result.success) {
        toast(editingId ? 'Ogłoszenie zaktualizowane' : 'Ogłoszenie dodane', 'success');
        closeForm();
        await load();
      } else {
        toast((result && result.error) || 'Wystąpił błąd', 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Zapisz'; }
      }
    } catch (err) {
      toast('Błąd połączenia', 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Zapisz'; }
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Czy na pewno chcesz usunąć to ogłoszenie?')) return;
    try {
      const result = await remove(id);
      if (result && result.success) {
        toast('Ogłoszenie usunięte', 'success');
        await load();
      } else {
        toast((result && result.error) || 'Nie udało się usunąć', 'error');
      }
    } catch (e) {
      toast('Błąd połączenia', 'error');
    }
  }

  async function handleToggle(id) {
    try {
      const result = await togglePublish(id);
      if (result && result.success) {
        toast(result.published === 'TAK' ? 'Opublikowane' : 'Ukryte', 'success');
        await load();
      } else {
        toast((result && result.error) || 'Nie udało się zmienić statusu', 'error');
      }
    } catch (e) {
      toast('Błąd połączenia', 'error');
    }
  }

  // ============================================
  // Render
  // ============================================
  function renderList() {
    if (loading) {
      return `
        <div class="table-loading">
          <div class="loader"></div>
          <p style="color: var(--color-warm-500); font-size: var(--text-sm);">Ładowanie ogłoszeń…</p>
        </div>`;
    }
    if (!list.length) {
      return `
        <div class="events-empty-state" style="padding:2rem;text-align:center;color:var(--color-warm-500);">
          <p>Brak aktywnych ogłoszeń. Dodaj pierwsze.</p>
        </div>`;
    }
    return `
      <div class="ogl-list" style="display:flex;flex-direction:column;gap:1rem;">
        ${list.map(item => {
          const thumb = item.image_url
            ? `<img src="${escapeHtml(convertDriveUrl(item.image_url))}" alt="" style="width:88px;height:88px;object-fit:cover;border-radius:8px;flex-shrink:0;">`
            : '';
          const hidden = item.published !== 'TAK';
          return `
          <article class="ogl-card" style="display:flex;gap:1rem;padding:1rem;background:var(--color-cream-50,#fdfaf4);border:1px solid var(--color-warm-200,#e8dfd0);border-radius:12px;${hidden ? 'opacity:0.6;' : ''}">
            ${thumb}
            <div style="flex:1;min-width:0;">
              <h3 style="margin:0 0 0.25rem;font-family:var(--font-serif,Cormorant),serif;font-size:1.25rem;color:var(--color-warm-900);">${escapeHtml(item.title)}${hidden ? ' <span style="font-size:0.75rem;color:var(--color-warm-500);font-family:var(--font-sans,Outfit),sans-serif;font-weight:500;">(ukryte)</span>' : ''}</h3>
              <div style="font-size:0.8125rem;color:var(--color-warm-500);margin-bottom:0.5rem;">
                Opublikowano: ${fmtDate(item.published_at)} · Wygasa: ${fmtDate(item.expires_at)}
              </div>
              <div style="font-size:0.875rem;color:var(--color-warm-700);max-height:4.5em;overflow:hidden;line-height:1.5;">
                ${item.body /* body jest dozwolony jako HTML — proboszcz wkleja sformatowany tekst */}
              </div>
              <div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
                <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHtml(item.id)}">Edytuj</button>
                <button class="btn btn-ghost btn-sm" data-action="toggle" data-id="${escapeHtml(item.id)}">${hidden ? 'Pokaż' : 'Ukryj'}</button>
                <button class="btn btn-ghost btn-sm" data-action="delete" data-id="${escapeHtml(item.id)}" style="color:var(--color-danger,#b94a3c);">Usuń</button>
              </div>
            </div>
          </article>`;
        }).join('')}
      </div>`;
  }

  function renderForm() {
    if (!formOpen) return '';
    const previewSrc = pendingImagePreview
      ? pendingImagePreview
      : (pendingImageUrl ? convertDriveUrl(pendingImageUrl) : '');
    const hasImage = !!previewSrc;

    return `
      <div class="ogl-form" style="margin-top:1.5rem;padding:1.5rem;background:var(--color-cream-50,#fdfaf4);border:1px solid var(--color-warm-200,#e8dfd0);border-radius:12px;">
        <h2 style="margin:0 0 1rem;font-family:var(--font-serif,Cormorant),serif;">${editingId ? 'Edytuj ogłoszenie' : 'Nowe ogłoszenie'}</h2>

        <div class="form-group">
          <label class="form-label" for="oglFormTitle">Tytuł *</label>
          <input type="text" id="oglFormTitle" class="form-input" placeholder="np. Niedziela Palmowa — porządek nabożeństw" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="form-label" for="oglFormBody">Treść</label>
          <textarea id="oglFormBody" class="form-input" rows="8" placeholder="Treść ogłoszenia. Dozwolone proste tagi HTML (np. &lt;p&gt;, &lt;strong&gt;, &lt;br&gt;)…"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Zdjęcie</label>
          <div id="oglUploadZone" class="upload-zone" data-state="${hasImage ? 'has' : 'empty'}">
            <input type="file" id="oglFileInput" accept="image/*" style="display:none">
            ${hasImage ? `
              <div class="upload-zone-preview" style="display:block;">
                <img src="${escapeHtml(previewSrc)}" alt="Podgląd" style="max-width:100%;border-radius:8px;">
                <button type="button" class="upload-remove" id="oglRemoveImg" title="Usuń zdjęcie">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>` : `
              <div class="upload-zone-content" style="display:flex;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <p class="upload-text-desktop">Przeciągnij zdjęcie tutaj lub <strong>kliknij</strong></p>
                <p class="upload-text-mobile">Kliknij aby wybrać zdjęcie</p>
                <span>JPG, PNG, WebP — automatycznie kompresowane</span>
              </div>`}
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1rem;">
          <button type="button" class="btn btn-ghost" id="oglFormCancel">Anuluj</button>
          <button type="button" class="btn btn-accent" id="oglFormSave">Zapisz</button>
        </div>
      </div>`;
  }

  function bindFormHandlers() {
    if (!formOpen) return;

    const cancel = document.getElementById('oglFormCancel');
    if (cancel) cancel.addEventListener('click', closeForm);

    const save = document.getElementById('oglFormSave');
    if (save) save.addEventListener('click', saveForm);

    const zone = document.getElementById('oglUploadZone');
    const input = document.getElementById('oglFileInput');
    if (zone && input) {
      zone.addEventListener('click', (e) => {
        // Klick auf "Entfernen"-Knopf darf nicht den File-Picker oeffnen.
        if (e.target.closest('#oglRemoveImg')) return;
        input.click();
      });
      input.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length) handleFileSelect(e.target.files);
      });
      ['dragover', 'dragenter'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
      ['dragleave', 'dragend'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files);
      });
    }

    const removeBtn = document.getElementById('oglRemoveImg');
    if (removeBtn) removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removePendingImage(); });
  }

  function bindListHandlers(root) {
    root.querySelectorAll('[data-action]').forEach(btn => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      btn.addEventListener('click', () => {
        if (action === 'edit') openForm(list.find(o => o.id === id));
        else if (action === 'delete') handleDelete(id);
        else if (action === 'toggle') handleToggle(id);
      });
    });
  }

  function render() {
    const root = document.getElementById('tab-ogloszenia');
    if (!root) return;

    root.innerHTML = `
      <div class="admin-toolbar">
        <div class="admin-toolbar-left">
          <h1>Ogłoszenia <em>duszpasterskie</em></h1>
          <span class="event-count">${list.length}</span>
        </div>
        <button class="btn btn-accent" id="oglNewBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nowe ogłoszenie
        </button>
      </div>

      <div class="events-panel">
        <div class="events-panel-header">
          <span class="events-panel-title">Aktywne ogłoszenia</span>
        </div>
        ${renderList()}
      </div>

      ${renderForm()}
    `;

    const newBtn = root.querySelector('#oglNewBtn');
    if (newBtn) newBtn.addEventListener('click', () => openForm(null));

    bindListHandlers(root);
    bindFormHandlers();
  }

  return { load, render, add, update, remove, togglePublish, openForm };
})();

window.Ogloszenia = Ogloszenia;
window.addEventListener('hashchange', () => { if (location.hash === '#ogloszenia') { Ogloszenia.load(); } });
window.addEventListener('DOMContentLoaded', () => { if (location.hash === '#ogloszenia') { Ogloszenia.load(); } });
