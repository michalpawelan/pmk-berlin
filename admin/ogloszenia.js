// admin/ogloszenia.js — Ogloszenia-Tab Logic.
// Tygodniowy biuletyn parafialny: EDYTOR BLOKOWY (tekst + zdjęcia w dowolnej
// kolejności — Tekst → Zdjęcie → Tekst → Zdjęcie, jak w starych ogłoszeniach).
// Body zapisywany w formacie blokowym [{t:'img',u},{t:'txt',c}], więc strona
// główna i /ogloszenia.html renderują bez zmian (js/ogloszenia.js renderBlocks).
// Ogłoszenie znika automatycznie po 7 dniach (TTL w Apps Script).
// Backend: Apps Script actions listOgloszenia / addOgloszenie / updateOgloszenie /
//          deleteOgloszenie / toggleOgloszeniePublish (siehe admin/google-apps-script.js).

const Ogloszenia = (function() {
  'use strict';

  let list = [];
  let loading = false;
  let editingId = null;     // null => nowe ogłoszenie
  let formOpen = false;
  // Cały stan formularza: tytuł + uporządkowana lista bloków.
  // Block: { id, t:'txt'|'img', c:'', u:'', preview:'', uploading:false }
  let form = { title: '', blocks: [] };
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
            u: b.u || '',
            preview: b.t === 'img' && b.u ? convertDriveUrl(b.u) : '',
            uploading: false
          }));
        }
      } catch (_) { /* fall through */ }
    }
    const plain = trimmed.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');
    return [{ id: nextBlockId(), t: 'txt', c: plain, u: '', preview: '', uploading: false }];
  }

  function newTextBlock() { return { id: nextBlockId(), t: 'txt', c: '', u: '', preview: '', uploading: false }; }
  function newImageBlock() { return { id: nextBlockId(), t: 'img', c: '', u: '', preview: '', uploading: false }; }

  function emptyForm() {
    return { title: '', blocks: [newTextBlock()] };
  }

  // Existing ogłoszenie → block-form state (preserves order of blocks).
  function formFromItem(item) {
    const blocks = parseBlocks(item.body);
    // Legacy rows that only carried a top-level image_url (no img block) → prepend it.
    if (item.image_url && !blocks.some(b => b.t === 'img' && b.u)) {
      blocks.unshift({ id: nextBlockId(), t: 'img', c: '', u: item.image_url, preview: convertDriveUrl(item.image_url), uploading: false });
    }
    return {
      title: item.title || '',
      blocks: blocks.length ? blocks : [newTextBlock()]
    };
  }

  // Block-form state → block-JSON body — same shape the public renderer expects.
  function formToBody() {
    const out = [];
    form.blocks.forEach(b => {
      if (b.t === 'img' && b.u) out.push({ t: 'img', u: b.u });
      else if (b.t === 'txt' && String(b.c || '').trim()) out.push({ t: 'txt', c: String(b.c).trim() });
    });
    return JSON.stringify(out);
  }

  // First uploaded image → top-level image_url (list thumbnail + backwards-compat).
  function firstImageUrl() {
    const img = form.blocks.find(b => b.t === 'img' && b.u);
    return img ? img.u : '';
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
  // Image upload (per image block; reuses /.netlify/functions/upload)
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
    const file = files && files[0];
    if (!file || !file.type.startsWith('image/')) {
      toast('Tylko pliki graficzne (JPG, PNG, WebP)', 'error');
      return;
    }
    readFormInputs();        // keep title/other text the user already typed
    const block = form.blocks.find(b => b.id === blockId);
    if (!block) return;
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
        block.preview = compressed.dataUrl;
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
  // Block operations (add / move / remove)
  // ============================================
  function addBlock(type) {
    readFormInputs();
    const b = type === 'img' ? newImageBlock() : newTextBlock();
    form.blocks.push(b);
    render();
    if (type === 'img') {
      setTimeout(() => { const fi = document.getElementById('oglFile-' + b.id); if (fi) fi.click(); }, 0);
    } else {
      setTimeout(() => { const ta = document.querySelector('.ogl-block-text[data-block-id="' + b.id + '"]'); if (ta) ta.focus(); }, 0);
    }
  }

  function moveBlock(id, dir) {
    readFormInputs();
    const i = form.blocks.findIndex(b => b.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= form.blocks.length) return;
    const tmp = form.blocks[i]; form.blocks[i] = form.blocks[j]; form.blocks[j] = tmp;
    render();
  }

  function removeBlock(id) {
    const b = form.blocks.find(x => x.id === id);
    const hasContent = b && ((b.t === 'txt' && String(b.c || '').trim()) || (b.t === 'img' && b.u));
    if (hasContent && !window.confirm('Usunąć ten blok?')) return;
    readFormInputs();
    form.blocks = form.blocks.filter(x => x.id !== id);
    if (!form.blocks.length) form.blocks = [newTextBlock()];
    render();
  }

  // ============================================
  // Form open / save
  // ============================================
  function readFormInputs() {
    const ti = document.getElementById('oglFormTitle');
    if (ti) form.title = ti.value;
    document.querySelectorAll('.ogl-block-text').forEach(ta => {
      const b = form.blocks.find(x => x.id === ta.dataset.blockId);
      if (b) b.c = ta.value;
    });
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
    const body = formToBody();
    if (body === '[]') {
      toast('Dodaj treść lub zdjęcie', 'error');
      return;
    }

    const payload = {
      title: title,
      body: body,
      image_url: firstImageUrl()
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

  function renderBlockPhoto(b) {
    if (b.uploading) {
      return `
        <div class="oglPhotoZone" data-block-id="${b.id}" data-state="uploading" style="border:2px dashed var(--color-warm-300,#d6c9b3);border-radius:10px;background:var(--color-cream-50,#fdfaf4);padding:1.5rem;text-align:center;">
          <div class="loader" style="margin:0 auto 0.5rem;"></div>
          <p style="color:var(--color-warm-500);font-size:0.875rem;margin:0;">Przesyłanie zdjęcia…</p>
        </div>`;
    }
    const src = b.preview || (b.u ? convertDriveUrl(b.u) : '');
    if (src) {
      return `
        <div class="oglPhotoZone" data-block-id="${b.id}" data-state="has" style="display:flex;align-items:center;gap:1rem;border:1px solid var(--color-warm-200,#e8dfd0);border-radius:10px;background:#fff;padding:0.75rem;">
          <img src="${escapeHtml(src)}" alt="" style="width:72px;height:96px;object-fit:contain;background:var(--color-cream-50,#fdfaf4);border-radius:8px;border:1px solid var(--color-warm-200,#e8dfd0);flex-shrink:0;">
          <div style="flex:1;min-width:0;">
            <strong style="display:block;color:var(--color-warm-800);font-size:0.9375rem;">Zdjęcie dodane</strong>
            <span style="font-size:0.8125rem;color:var(--color-warm-500);">Kliknij „Zmień", aby wybrać inne</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm ogl-photo-change" data-block-id="${b.id}" style="flex-shrink:0;">Zmień</button>
        </div>`;
    }
    return `
      <div class="oglPhotoZone" data-block-id="${b.id}" data-state="empty" style="border:2px dashed var(--color-warm-300,#d6c9b3);border-radius:10px;background:var(--color-cream-50,#fdfaf4);padding:1.5rem;text-align:center;cursor:pointer;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="26" height="26" style="color:var(--color-accent,#a68b5b);margin-bottom:0.4rem;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
        <p style="margin:0 0 0.2rem;color:var(--color-warm-700);font-size:0.9375rem;">Przeciągnij plakat tutaj lub kliknij</p>
        <p style="margin:0;color:var(--color-warm-500);font-size:0.8125rem;">JPG, PNG lub WebP</p>
      </div>`;
  }

  function renderBlock(b, idx, total) {
    const badge = b.t === 'img'
      ? '<span style="display:inline-flex;align-items:center;gap:0.3em;font-size:0.75rem;font-weight:600;color:var(--color-accent,#a68b5b);">🖼 Zdjęcie</span>'
      : '<span style="display:inline-flex;align-items:center;gap:0.3em;font-size:0.75rem;font-weight:600;color:var(--color-warm-600,#8a7a60);">📝 Tekst</span>';
    const head = `
      <div class="ogl-block-head" style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.5rem;">
        ${badge}
        <span style="flex:1;"></span>
        <button type="button" class="btn btn-ghost btn-sm ogl-move" data-block-id="${b.id}" data-dir="-1" ${idx === 0 ? 'disabled style="opacity:0.35;"' : ''} title="W górę">↑</button>
        <button type="button" class="btn btn-ghost btn-sm ogl-move" data-block-id="${b.id}" data-dir="1" ${idx === total - 1 ? 'disabled style="opacity:0.35;"' : ''} title="W dół">↓</button>
        <button type="button" class="btn btn-ghost btn-sm ogl-del" data-block-id="${b.id}" title="Usuń blok" style="color:var(--color-danger,#b94a3c);">✕</button>
      </div>`;
    let body;
    if (b.t === 'txt') {
      body = `<textarea class="form-input ogl-block-text" data-block-id="${b.id}" rows="5" placeholder="Wpisz tekst… (pusta linia = nowy akapit)" style="font-family:var(--font-sans,Outfit),sans-serif;line-height:1.6;resize:vertical;">${escapeHtml(b.c)}</textarea>`;
    } else {
      body = `<input type="file" id="oglFile-${b.id}" accept="image/*" style="display:none">` + renderBlockPhoto(b);
    }
    return `
      <div class="ogl-block" data-block-id="${b.id}" style="padding:0.85rem;background:#fff;border:1px solid var(--color-warm-200,#e8dfd0);border-radius:12px;">
        ${head}
        ${body}
      </div>`;
  }

  function renderForm() {
    if (!formOpen) return '';
    const blocksHtml = form.blocks.map((b, i) => renderBlock(b, i, form.blocks.length)).join('');
    return `
      <div class="ogl-form" style="margin-top:1.5rem;padding:1.75rem;background:var(--color-cream-50,#fdfaf4);border:1px solid var(--color-warm-200,#e8dfd0);border-radius:14px;max-width:680px;">
        <h2 style="margin:0 0 1.5rem;font-family:var(--font-serif,Cormorant),serif;font-style:italic;font-weight:500;">${editingId ? 'Edytuj ogłoszenie' : 'Nowe ogłoszenie na ten tydzień'}</h2>

        <div class="form-group">
          <label class="form-label" for="oglFormTitle">Tytuł *</label>
          <input type="text" id="oglFormTitle" class="form-input" value="${escapeHtml(form.title)}" placeholder="np. Uroczystość Najświętszego Serca Jezusa" autocomplete="off">
        </div>

        <label class="form-label">Treść — bloki w dowolnej kolejności (tekst i zdjęcia)</label>
        <div class="ogl-blocks" style="display:flex;flex-direction:column;gap:0.85rem;margin:0.4rem 0 1rem;">
          ${blocksHtml}
        </div>

        <div style="display:flex;gap:0.5rem;margin-bottom:1.25rem;">
          <button type="button" class="btn btn-ghost btn-sm" id="oglAddText">+ Tekst</button>
          <button type="button" class="btn btn-ghost btn-sm" id="oglAddImage">+ Zdjęcie / plakat</button>
        </div>

        <p style="margin:0 0 1.25rem;color:var(--color-warm-500);font-size:0.8125rem;">Bloki pojawią się na stronie w tej kolejności (góra → dół). Ogłoszenie zniknie automatycznie po 7 dniach.</p>

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

    const addText = document.getElementById('oglAddText');
    if (addText) addText.addEventListener('click', () => addBlock('txt'));

    const addImage = document.getElementById('oglAddImage');
    if (addImage) addImage.addEventListener('click', () => addBlock('img'));

    document.querySelectorAll('.ogl-move').forEach(btn =>
      btn.addEventListener('click', () => moveBlock(btn.dataset.blockId, parseInt(btn.dataset.dir, 10))));

    document.querySelectorAll('.ogl-del').forEach(btn =>
      btn.addEventListener('click', () => removeBlock(btn.dataset.blockId)));

    // Per image block: file input + photo-zone interactions.
    form.blocks.filter(b => b.t === 'img').forEach(b => {
      const fileInput = document.getElementById('oglFile-' + b.id);
      if (fileInput) {
        fileInput.addEventListener('change', e => {
          if (e.target.files && e.target.files.length) uploadBlockImage(b.id, e.target.files);
        });
      }
      const zone = document.querySelector('.oglPhotoZone[data-block-id="' + b.id + '"]');
      if (!zone) return;
      if (zone.dataset.state === 'empty') {
        zone.addEventListener('click', () => { if (fileInput) fileInput.click(); });
        ['dragover', 'dragenter'].forEach(ev =>
          zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('dragover'); }));
        ['dragleave', 'dragend'].forEach(ev =>
          zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('dragover'); }));
        zone.addEventListener('drop', e => {
          e.preventDefault();
          zone.classList.remove('dragover');
          if (e.dataTransfer && e.dataTransfer.files.length) uploadBlockImage(b.id, e.dataTransfer.files);
        });
      } else if (zone.dataset.state === 'has') {
        const change = zone.querySelector('.ogl-photo-change');
        if (change) change.addEventListener('click', () => { if (fileInput) fileInput.click(); });
      }
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
