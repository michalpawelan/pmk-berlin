// admin/ogloszenia.js — Ogloszenia-Tab Logic.
// Tygodniowy biuletyn parafialny: blockowy edytor (text + obraz) zamiast HTML-textarea.
// Backend: Apps Script actions listOgloszenia / addOgloszenie / updateOgloszenie /
//          deleteOgloszenie / toggleOgloszeniePublish (siehe admin/google-apps-script.js).

const Ogloszenia = (function() {
  'use strict';

  let list = [];
  let loading = false;
  let editingId = null;     // null => formularz dla nowego ogloszenia
  let formOpen = false;
  let blocks = [];          // [{id, t:'txt'|'img', c?:string, u?:string, p?:string, uploading?:bool}]
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
  // Block helpers — JSON serialisation
  // ============================================
  // Parses item.body. If it's a JSON array of blocks → returns blocks.
  // Otherwise → returns single text block with the raw content (legacy HTML rows).
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
            u: b.u || '',
            p: ''
          }));
        }
      } catch (_) { /* fall through */ }
    }
    // Legacy row: wrap whole body as single text block (strip basic HTML so it edits cleanly).
    const plain = trimmed.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');
    return [{ id: nextBlockId(), t: 'txt', c: plain, u: '', p: '' }];
  }

  // Strip transient fields (id, p, uploading) before saving — only the persistent
  // shape goes into the Sheet body cell.
  function serializeBlocks(arr) {
    return JSON.stringify(arr.map(b => b.t === 'img'
      ? { t: 'img', u: b.u || '' }
      : { t: 'txt', c: b.c || '' }
    ));
  }

  function firstImageUrl(arr) {
    const hit = arr.find(b => b.t === 'img' && b.u);
    return hit ? hit.u : '';
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
  // Image upload (per-block; reuses /.netlify/functions/upload)
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

  async function uploadBlockImage(blockId, files) {
    const block = blocks.find(b => b.id === blockId);
    if (!block) return;
    const file = files && files[0];
    if (!file || !file.type.startsWith('image/')) {
      toast('Tylko pliki graficzne (JPG, PNG, WebP)', 'error');
      return;
    }
    block.uploading = true;
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
        block.u = result.imageUrl || '';
        block.p = compressed.dataUrl;
        toast('Zdjęcie przesłane', 'success');
      } else {
        throw new Error((result && result.error) || 'Upload nie powiódł się');
      }
    } catch (err) {
      toast('Błąd przesyłania: ' + err.message, 'error');
    } finally {
      block.uploading = false;
      render();
    }
  }

  // ============================================
  // Block manipulation
  // ============================================
  function addTextBlock() {
    blocks.push({ id: nextBlockId(), t: 'txt', c: '', u: '', p: '' });
    render();
    // Focus the new textarea after render.
    setTimeout(() => {
      const ta = document.querySelectorAll('.oglBlock textarea');
      const last = ta[ta.length - 1];
      if (last) last.focus();
    }, 0);
  }

  function addImageBlock() {
    blocks.push({ id: nextBlockId(), t: 'img', c: '', u: '', p: '' });
    render();
  }

  function moveBlock(id, direction) {
    const idx = blocks.findIndex(b => b.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= blocks.length) return;
    const [b] = blocks.splice(idx, 1);
    blocks.splice(newIdx, 0, b);
    render();
  }

  function deleteBlock(id) {
    const block = blocks.find(b => b.id === id);
    if (block && block.t === 'txt' && block.c.trim()) {
      if (!window.confirm('Usunąć ten blok tekstu?')) return;
    }
    if (block && block.t === 'img' && block.u) {
      if (!window.confirm('Usunąć to zdjęcie z ogłoszenia?')) return;
    }
    blocks = blocks.filter(b => b.id !== id);
    render();
  }

  function readTextBlockValues() {
    // Capture current textarea values back into state before re-render or save.
    blocks.forEach(b => {
      if (b.t !== 'txt') return;
      const ta = document.querySelector('textarea[data-block-id="' + b.id + '"]');
      if (ta) b.c = ta.value;
    });
  }

  // ============================================
  // Form open / save
  // ============================================
  function openForm(item) {
    editingId = item ? item.id : null;
    formOpen = true;
    if (item) {
      blocks = parseBlocks(item.body);
      // If the legacy image_url exists and isn't already represented in blocks, prepend it.
      if (item.image_url && !blocks.some(b => b.t === 'img' && b.u === item.image_url)) {
        blocks.unshift({ id: nextBlockId(), t: 'img', c: '', u: item.image_url, p: '' });
      }
    } else {
      blocks = [{ id: nextBlockId(), t: 'txt', c: '', u: '', p: '' }];
    }
    render();
    setTimeout(() => {
      const t = document.getElementById('oglFormTitle');
      if (t && item) t.value = item.title || '';
      if (t) t.focus();
    }, 0);
  }

  function closeForm() {
    formOpen = false;
    editingId = null;
    blocks = [];
    render();
  }

  async function saveForm() {
    readTextBlockValues();
    const titleEl = document.getElementById('oglFormTitle');
    const title = titleEl ? titleEl.value.trim() : '';

    if (!title) { toast('Tytuł jest wymagany', 'error'); return; }

    // Drop empty blocks before saving.
    const cleaned = blocks.filter(b => (b.t === 'txt' && b.c.trim()) || (b.t === 'img' && b.u));

    if (!cleaned.length) {
      toast('Dodaj przynajmniej jeden blok (tekst lub zdjęcie)', 'error');
      return;
    }

    const payload = {
      title: title,
      body: serializeBlocks(cleaned),
      image_url: firstImageUrl(cleaned) // legacy field — first image as thumbnail
    };

    const saveBtn = document.getElementById('oglFormSave');
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
  // Render — list view
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
          // For the list preview, show a short text summary regardless of whether body is blocks or HTML.
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
              preview = trimmed.slice(0, 220); // legacy HTML
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

  // ============================================
  // Render — form (block editor)
  // ============================================
  function renderBlock(b, idx, total) {
    const isFirst = idx === 0;
    const isLast = idx === total - 1;
    const moveUp = `<button type="button" class="btn-icon" data-block-action="up" data-block-id="${b.id}" ${isFirst ? 'disabled' : ''} title="Przesuń w górę" aria-label="Przesuń w górę">↑</button>`;
    const moveDown = `<button type="button" class="btn-icon" data-block-action="down" data-block-id="${b.id}" ${isLast ? 'disabled' : ''} title="Przesuń w dół" aria-label="Przesuń w dół">↓</button>`;
    const del = `<button type="button" class="btn-icon" data-block-action="delete" data-block-id="${b.id}" title="Usuń blok" aria-label="Usuń blok" style="color:var(--color-danger,#b94a3c);">🗑</button>`;
    const controls = `<div class="oglBlockControls" style="display:flex;gap:0.25rem;align-items:center;">${moveUp}${moveDown}${del}</div>`;

    const header = (label) => `
      <div class="oglBlockHeader" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;">
        <span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-warm-500);font-weight:600;">${label}</span>
        ${controls}
      </div>`;

    if (b.t === 'txt') {
      return `
        <div class="oglBlock" data-block-id="${b.id}" style="padding:1rem;background:#fff;border:1px solid var(--color-warm-200,#e8dfd0);border-radius:10px;">
          ${header('Tekst')}
          <textarea class="form-input" data-block-id="${b.id}" rows="4" placeholder="Napisz fragment ogłoszenia. Enter rozpoczyna nowy akapit." style="font-family:var(--font-sans,Outfit),sans-serif;line-height:1.6;resize:vertical;">${escapeHtml(b.c)}</textarea>
        </div>`;
    }

    // Image block
    const previewSrc = b.p ? b.p : (b.u ? convertDriveUrl(b.u) : '');
    const state = b.uploading ? 'uploading' : (previewSrc ? 'has' : 'empty');
    let zoneInner;
    if (state === 'uploading') {
      zoneInner = `
        <div style="padding:1.5rem;text-align:center;">
          <div class="loader" style="margin:0 auto 0.5rem;"></div>
          <p style="color:var(--color-warm-500);font-size:0.875rem;margin:0;">Przesyłanie zdjęcia…</p>
        </div>`;
    } else if (state === 'has') {
      zoneInner = `
        <div style="position:relative;text-align:center;background:#fff;padding:0.5rem;border-radius:8px;">
          <img src="${escapeHtml(previewSrc)}" alt="Podgląd" style="display:block;margin:0 auto;max-width:100%;max-height:220px;width:auto;height:auto;object-fit:contain;border-radius:6px;">
          <p style="margin:0.5rem 0 0;font-size:0.75rem;color:var(--color-warm-500);">Kliknij obrazek aby zmienić</p>
        </div>`;
    } else {
      zoneInner = `
        <div class="upload-zone-content" style="display:flex;flex-direction:column;align-items:center;gap:0.5rem;padding:1.5rem;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36" style="color:var(--color-warm-500);"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p style="margin:0;color:var(--color-warm-700);">Przeciągnij zdjęcie tutaj lub <strong>kliknij</strong></p>
          <p style="margin:0;font-size:0.75rem;color:var(--color-warm-500);">JPG, PNG, WebP — automatycznie kompresowane</p>
        </div>`;
    }
    return `
      <div class="oglBlock" data-block-id="${b.id}" style="padding:1rem;background:#fff;border:1px solid var(--color-warm-200,#e8dfd0);border-radius:10px;">
        ${header('Zdjęcie')}
        <div class="oglImgZone" data-block-id="${b.id}" data-state="${state}" style="border:1px dashed var(--color-warm-300,#d6c9b3);border-radius:8px;background:var(--color-cream-50,#fdfaf4);">
          <input type="file" data-block-id="${b.id}" accept="image/*" style="display:none">
          ${zoneInner}
        </div>
      </div>`;
  }

  function renderForm() {
    if (!formOpen) return '';
    const blocksHtml = blocks.map((b, i) => renderBlock(b, i, blocks.length)).join('');

    return `
      <div class="ogl-form" style="margin-top:1.5rem;padding:1.5rem;background:var(--color-cream-50,#fdfaf4);border:1px solid var(--color-warm-200,#e8dfd0);border-radius:12px;">
        <h2 style="margin:0 0 1rem;font-family:var(--font-serif,Cormorant),serif;">${editingId ? 'Edytuj ogłoszenie' : 'Nowe ogłoszenie'}</h2>

        <div class="form-group">
          <label class="form-label" for="oglFormTitle">Tytuł *</label>
          <input type="text" id="oglFormTitle" class="form-input" placeholder="np. Niedziela Palmowa — porządek nabożeństw" autocomplete="off">
        </div>

        <div class="form-group">
          <label class="form-label">Treść ogłoszenia</label>
          <p style="margin:0 0 0.75rem;color:var(--color-warm-500);font-size:0.8125rem;">Dodawaj bloki w kolejności, w jakiej mają się pokazać na stronie. Możesz mieszać tekst i zdjęcia.</p>
          <div class="oglBlocks" style="display:flex;flex-direction:column;gap:0.75rem;">
            ${blocksHtml}
          </div>
          <div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem;">
            <button type="button" class="btn btn-ghost" id="oglAddText">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right:0.25rem;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Dodaj tekst
            </button>
            <button type="button" class="btn btn-ghost" id="oglAddImage">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="margin-right:0.25rem;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Dodaj zdjęcie
            </button>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.5rem;margin-top:1.5rem;">
          <button type="button" class="btn btn-ghost" id="oglFormCancel">Anuluj</button>
          <button type="button" class="btn btn-accent" id="oglFormSave">Zapisz</button>
        </div>
      </div>`;
  }

  // ============================================
  // Bind handlers
  // ============================================
  function bindFormHandlers() {
    if (!formOpen) return;

    const cancel = document.getElementById('oglFormCancel');
    if (cancel) cancel.addEventListener('click', () => { readTextBlockValues(); closeForm(); });

    const save = document.getElementById('oglFormSave');
    if (save) save.addEventListener('click', saveForm);

    const addTextBtn = document.getElementById('oglAddText');
    if (addTextBtn) addTextBtn.addEventListener('click', () => { readTextBlockValues(); addTextBlock(); });

    const addImageBtn = document.getElementById('oglAddImage');
    if (addImageBtn) addImageBtn.addEventListener('click', () => { readTextBlockValues(); addImageBlock(); });

    // Block-level action buttons (up / down / delete)
    document.querySelectorAll('[data-block-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        readTextBlockValues();
        const id = btn.dataset.blockId;
        const action = btn.dataset.blockAction;
        if (action === 'up') moveBlock(id, -1);
        else if (action === 'down') moveBlock(id, 1);
        else if (action === 'delete') deleteBlock(id);
      });
    });

    // Image upload zones — click to open file picker, drag-drop, file input change
    document.querySelectorAll('.oglImgZone').forEach(zone => {
      const id = zone.dataset.blockId;
      const fileInput = zone.querySelector('input[type="file"]');
      if (!fileInput) return;

      zone.addEventListener('click', (e) => {
        if (zone.dataset.state === 'uploading') return;
        // Don't open picker when re-clicking the preview image (let user use delete button instead).
        fileInput.click();
      });
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length) uploadBlockImage(id, e.target.files);
      });
      ['dragover', 'dragenter'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
      ['dragleave', 'dragend'].forEach(ev =>
        zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
      zone.addEventListener('drop', e => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer && e.dataTransfer.files.length) uploadBlockImage(id, e.dataTransfer.files);
      });
    });
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
