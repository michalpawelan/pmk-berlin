// admin/ogloszenia.js — Ogloszenia-Tab Logic.
// Tygodniowy biuletyn parafialny: PROSTY formularz (tytuł + zdjęcie + treść).
// Body jest zapisywany w tym samym formacie blokowym co wcześniej
// ([{t:'img',u},{t:'txt',c}]), więc strona główna i /ogloszenia.html renderują bez zmian.
// Ogłoszenie znika automatycznie po 7 dniach (TTL w Apps Script).
// Backend: Apps Script actions listOgloszenia / addOgloszenie / updateOgloszenie /
//          deleteOgloszenie / toggleOgloszeniePublish (siehe admin/google-apps-script.js).

const Ogloszenia = (function() {
  'use strict';

  let list = [];
  let loading = false;
  let editingId = null;     // null => nowe ogłoszenie
  let formOpen = false;
  // Cały stan formularza w jednym miejscu (przeżywa re-render).
  let form = { title: '', photoUrl: '', photoPreview: '', text: '', uploading: false };
  let blockCounter = 0;

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
      const container = document.getElementById('toastContainer');
      if (!container) { console.log('[ogloszenia] ' + msg); return; }
      const el = document.createElement('div');
      el.className = 'toast ' + (type || 'info');
      el.textContent = msg;
      container.appendChild(el);
      setTimeout(() => el.remove(), 3000);
    }
  }

  function nextBlockId() {
    blockCounter += 1;
    return 'b' + blockCounter;
  }

  // ============================================
  // Block helpers — read existing body, build new body
  // ============================================
  // Parses item.body. If it's a JSON array of blocks → returns blocks.
  // Otherwise → single text block with the raw content (legacy HTML rows).
  function parseBlocks(bodyStr) {
    if (!bodyStr) return [];
    const trimmed = String(bodyStr).trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr)) {
          return arr.map(b => ({
            id: nextBlockId(),
            t: b.t === 'img' ? 'img' : 'txt',
            c: b.c || '',
            u: b.u || ''
          }));
        }
      } catch (_) { /* fall through */ }
    }
    const plain = trimmed.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');
    return [{ id: nextBlockId(), t: 'txt', c: plain, u: '' }];
  }

  function emptyForm() {
    return { title: '', photoUrl: '', photoPreview: '', text: '', uploading: false };
  }

  // Existing ogłoszenie → simple-form state (photo = first image, text = all text blocks joined).
  function formFromItem(item) {
    const f = emptyForm();
    f.title = item.title || '';
    f.photoUrl = item.image_url || '';
    const blocks = parseBlocks(item.body);
    if (!f.photoUrl) {
      const img = blocks.find(b => b.t === 'img' && b.u);
      if (img) f.photoUrl = img.u;
    }
    f.text = blocks.filter(b => b.t === 'txt' && b.c).map(b => b.c).join('\n\n');
    if (f.photoUrl) f.photoPreview = convertDriveUrl(f.photoUrl);
    return f;
  }

  // Simple-form state → block-JSON body (image first, then text) — same shape the
  // public renderer (js/ogloszenia.js renderBlocks) expects.
  function formToBody() {
    const blocks = [];
    if (form.photoUrl) blocks.push({ t: 'img', u: form.photoUrl });
    const text = String(form.text || '').trim();
    if (text) blocks.push({ t: 'txt', c: text });
    return JSON.stringify(blocks);
  }

  // ============================================
  // API
  // ============================================
  async function callApi(action, params) {
    params = params || {};
    let url;
    try { url = new URL(Auth.url); }
    catch (e) { return { success: false, error: 'Brak URL Apps Script (Auth.url)' }; }
    url.searchParams.set('action', action);
    url.searchParams.set('pin', Auth.getPin());
    Object.entries(params).forEach(([k, v]) => {
      if (v == null) return;
      url.searchParams.set(k, String(v));
    });
    try {
      const res = await fetch(url.toString(), { redirect: 'follow' });
      const text = await res.text();
      try { return JSON.parse(text); }
      catch (e) {
        console.error('[ogloszenia] non-JSON response from Apps Script:', text.slice(0, 500));
        return { success: false, error: 'Apps Script zwrócił nieoczekiwaną odpowiedź — zobacz konsolę' };
      }
    } catch (err) {
      console.error('[ogloszenia] fetch failed:', err);
      return { success: false, error: 'Sieć: ' + (err && err.message ? err.message : String(err)) };
    }
  }

  async function load() {
    const pin = Auth.getPin();
    if (!pin) { render(); return; }
    loading = true;
    render();
    const result = await callApi('listOgloszenia');
    loading = false;
    list = (result && result.ogloszenia) || [];
    render();
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
  // Image upload (single photo; reuses /.netlify/functions/upload)
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

  async function uploadPhoto(files) {
    const file = files && files[0];
    if (!file || !file.type.startsWith('image/')) {
      toast('Tylko pliki graficzne (JPG, PNG, WebP)', 'error');
      return;
    }
    readFormInputs();        // keep title/text the user already typed
    form.uploading = true;
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
        form.photoUrl = result.imageUrl || '';
        form.photoPreview = compressed.dataUrl;
        toast('Zdjęcie przesłane', 'success');
      } else {
        throw new Error((result && result.error) || 'Upload nie powiódł się');
      }
    } catch (err) {
      toast('Błąd przesyłania: ' + err.message, 'error');
    } finally {
      form.uploading = false;
      render();
    }
  }

  function removePhoto() {
    if (form.photoUrl && !window.confirm('Usunąć zdjęcie z ogłoszenia?')) return;
    readFormInputs();
    form.photoUrl = '';
    form.photoPreview = '';
    render();
  }

  // ============================================
  // Form open / save
  // ============================================
  function readFormInputs() {
    const ti = document.getElementById('oglFormTitle');
    if (ti) form.title = ti.value;
    const ta = document.getElementById('oglFormText');
    if (ta) form.text = ta.value;
  }

  function openForm(item) {
    editingId = item ? item.id : null;
    formOpen = true;
    form = item ? formFromItem(item) : emptyForm();
    render();
    setTimeout(() => {
      const t = document.getElementById('oglFormTitle');
      if (t) t.focus();
    }, 0);
  }

  function closeForm() {
    formOpen = false;
    editingId = null;
    form = emptyForm();
    render();
  }

  async function saveForm() {
    readFormInputs();
    const title = String(form.title || '').trim();
    if (!title) { toast('Tytuł jest wymagany', 'error'); return; }
    if (!String(form.text || '').trim() && !form.photoUrl) {
      toast('Dodaj treść lub zdjęcie', 'error');
      return;
    }

    const payload = {
      title: title,
      body: formToBody(),
      image_url: form.photoUrl || ''
    };

    const saveBtn = document.getElementById('oglFormSave');
    const original = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Zapisywanie…'; }

    try {
      let result;
      if (editingId) {
        const existing = list.find(o => o.id === editingId);
        if (existing && existing.published) payload.published = existing.published;
        result = await update(editingId, payload);
      } else {
        result = await add(payload);
      }
      if (result && result.success) {
        toast(editingId ? 'Ogłoszenie zaktualizowane' : 'Ogłoszenie opublikowane', 'success');
        closeForm();
        await load();
      } else {
        toast((result && result.error) || 'Wystąpił błąd', 'error');
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = original; }
      }
    } catch (err) {
      toast('Błąd połączenia', 'error');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = original; }
    }
  }

  // ============================================
  // List handlers
  // ============================================
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
          let preview = '';
          if (item.body) {
            const trimmed = String(item.body).trim();
            if (trimmed.startsWith('[')) {
              try {
                const arr = JSON.parse(trimmed);
                const txt = (arr.find(b => b.t === 'txt' && b.c) || {}).c || '';
                preview = escapeHtml(txt.slice(0, 220));
              } catch (e) { preview = escapeHtml(trimmed.slice(0, 220)); }
            } else {
              preview = trimmed.slice(0, 220);
            }
          }
          return `
          <article class="ogl-card" style="display:flex;gap:1rem;padding:1rem;background:var(--color-cream-50,#fdfaf4);border:1px solid var(--color-warm-200,#e8dfd0);border-radius:12px;${hidden ? 'opacity:0.6;' : ''}">
            ${thumb}
            <div style="flex:1;min-width:0;">
              <h3 style="margin:0 0 0.25rem;font-family:var(--font-serif,Cormorant),serif;font-size:1.25rem;color:var(--color-warm-900);">${escapeHtml(item.title)}${hidden ? ' <span style="font-size:0.75rem;color:var(--color-warm-500);font-family:var(--font-sans,Outfit),sans-serif;font-weight:500;">(ukryte)</span>' : ''}</h3>
              <div style="font-size:0.8125rem;color:var(--color-warm-500);margin-bottom:0.5rem;">
                Opublikowano: ${fmtDate(item.published_at)} · Wygasa: ${fmtDate(item.expires_at)}
              </div>
              <div style="font-size:0.875rem;color:var(--color-warm-700);max-height:4.5em;overflow:hidden;line-height:1.5;">
                ${preview}
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

  function renderPhotoZone() {
    if (form.uploading) {
      return `
        <div class="oglPhotoZone" data-state="uploading" style="border:2px dashed var(--color-warm-300,#d6c9b3);border-radius:10px;background:var(--color-cream-50,#fdfaf4);padding:1.5rem;text-align:center;">
          <div class="loader" style="margin:0 auto 0.5rem;"></div>
          <p style="color:var(--color-warm-500);font-size:0.875rem;margin:0;">Przesyłanie zdjęcia…</p>
        </div>`;
    }
    const src = form.photoPreview || (form.photoUrl ? convertDriveUrl(form.photoUrl) : '');
    if (src) {
      return `
        <div class="oglPhotoZone" data-state="has" style="display:flex;align-items:center;gap:1rem;border:1px solid var(--color-warm-200,#e8dfd0);border-radius:10px;background:#fff;padding:0.75rem;">
          <img src="${escapeHtml(src)}" alt="" style="width:84px;height:108px;object-fit:contain;background:var(--color-cream-50,#fdfaf4);border-radius:8px;border:1px solid var(--color-warm-200,#e8dfd0);flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <strong style="display:block;color:var(--color-warm-800);font-size:0.9375rem;">Zdjęcie dodane</strong>
            <span style="font-size:0.8125rem;color:var(--color-warm-500);">Możesz je zmienić lub usunąć</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.4rem;flex-shrink:0;">
            <button type="button" class="btn btn-ghost btn-sm" id="oglPhotoChange">Zmień</button>
            <button type="button" class="btn btn-ghost btn-sm" id="oglPhotoRemove" style="color:var(--color-danger,#b94a3c);">Usuń</button>
          </div>
        </div>`;
    }
    return `
      <div class="oglPhotoZone" data-state="empty" style="border:2px dashed var(--color-warm-300,#d6c9b3);border-radius:10px;background:var(--color-cream-50,#fdfaf4);padding:1.75rem 1.5rem;text-align:center;cursor:pointer;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28" style="color:var(--color-accent,#a68b5b);margin-bottom:0.5rem;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        <p style="margin:0 0 0.2rem;color:var(--color-warm-700);font-size:0.9375rem;">Przeciągnij zdjęcie tutaj lub kliknij, aby wybrać</p>
        <p style="margin:0;color:var(--color-warm-500);font-size:0.8125rem;">JPG, PNG lub WebP — opcjonalnie</p>
      </div>`;
  }

  function renderForm() {
    if (!formOpen) return '';
    return `
      <div class="ogl-form" style="margin-top:1.5rem;padding:1.75rem;background:var(--color-cream-50,#fdfaf4);border:1px solid var(--color-warm-200,#e8dfd0);border-radius:14px;max-width:640px;">
        <h2 style="margin:0 0 1.5rem;font-family:var(--font-serif,Cormorant),serif;font-style:italic;font-weight:500;">${editingId ? 'Edytuj ogłoszenie' : 'Nowe ogłoszenie na ten tydzień'}</h2>

        <div class="form-group">
          <label class="form-label" for="oglFormTitle">Tytuł *</label>
          <input type="text" id="oglFormTitle" class="form-input" value="${escapeHtml(form.title)}" placeholder="np. Uroczystość Najświętszego Serca Jezusa" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="form-label">Zdjęcie / plakat <span style="font-weight:400;color:var(--color-warm-500);">— opcjonalnie</span></label>
          <input type="file" id="oglPhotoInput" accept="image/*" style="display:none">
          ${renderPhotoZone()}
        </div>

        <div class="form-group">
          <label class="form-label" for="oglFormText">Treść ogłoszenia</label>
          <textarea id="oglFormText" class="form-input" rows="8" placeholder="Wpisz ogłoszenia na ten tydzień…&#10;&#10;Pusta linia rozpoczyna nowy akapit." style="font-family:var(--font-sans,Outfit),sans-serif;line-height:1.65;resize:vertical;">${escapeHtml(form.text)}</textarea>
        </div>

        <p style="margin:0 0 1.25rem;color:var(--color-warm-500);font-size:0.8125rem;">Ogłoszenie pojawi się na stronie głównej i automatycznie zniknie po 7 dniach.</p>

        <div style="display:flex;justify-content:flex-end;gap:0.5rem;">
          <button type="button" class="btn btn-ghost" id="oglFormCancel">Anuluj</button>
          <button type="button" class="btn btn-accent" id="oglFormSave">${editingId ? 'Zapisz' : 'Opublikuj'}</button>
        </div>
      </div>`;
  }

  // ============================================
  // Bind handlers
  // ============================================
  function bindFormHandlers() {
    if (!formOpen) return;

    const cancel = document.getElementById('oglFormCancel');
    if (cancel) cancel.addEventListener('click', () => { readFormInputs(); closeForm(); });

    const save = document.getElementById('oglFormSave');
    if (save) save.addEventListener('click', saveForm);

    const fileInput = document.getElementById('oglPhotoInput');
    if (fileInput) {
      fileInput.addEventListener('change', e => {
        if (e.target.files && e.target.files.length) uploadPhoto(e.target.files);
      });
    }

    const zone = document.querySelector('.oglPhotoZone');
    if (zone && zone.dataset.state === 'empty') {
      zone.addEventListener('click', () => { if (fileInput) fileInput.click(); });
      ['dragover', 'dragenter'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
      ['dragleave', 'dragend'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files.length) uploadPhoto(e.dataTransfer.files);
      });
    }

    const changeBtn = document.getElementById('oglPhotoChange');
    if (changeBtn) changeBtn.addEventListener('click', () => { if (fileInput) fileInput.click(); });

    const removeBtn = document.getElementById('oglPhotoRemove');
    if (removeBtn) removeBtn.addEventListener('click', removePhoto);
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
