/* Standalone application: no framework, dependencies, build step or remote APIs. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const video = $('source');
  const canvas = $('preview');
  const ctx = canvas.getContext('2d', { alpha: false });
  const TIMER_DELAYS = [0, 3, 5, 7, 10];
  const looks = window.CameraLooks;
  const filters = Object.fromEntries(looks.presets.map((preset) => [preset.id, preset.css]));
  const defaults = { quality: '0.92', format: 'image/jpeg', resolution: '1080', filter: 'none', filterIntensity: '1', audio: false, microphone: 'default', grid: true, gridType: 'thirds', camera: 'environment', keyboard: false };
  const allowed = { quality: ['0.6', '0.78', '0.92', '1'], format: ['image/jpeg', 'image/png', 'image/webp'], resolution: ['720', '1080', '2160'], filter: Object.keys(filters), filterIntensity: Array.from({ length: 21 }, (_, index) => String(index / 20)), gridType: ['none', 'thirds', 'square', 'both'], camera: ['environment', 'user'] };
  const state = { stream: null, ready: false, busy: false, opening: false, disposed: false, request: 0, facing: 'environment', device: '', cameras: [], zoom: 1, mode: 'photo', timer: 0, countdown: null, torch: false, recorder: null, media: [], selected: null, frame: 0, lastFrame: 0, recordTimer: null, noticeTimer: null };
  let settings = { ...defaults };
  let cinema;
  let collection;
  let cameraPermissionStatus, cameraPermissionChange;
  const recordingCanvas = document.createElement('canvas');
  const gallery = { selecting: false, checked: new Set(), favoritesOnly: false, filter: 'all', menuIds: [], busy: false, editor: null, limit: 36, thumbnailURLs: new Map(), viewerToken: 0, undoIds: [] };
  let galleryObserver;
  const store = window.CameraStore;
  const focusSupportByTrack = new WeakMap();
  let lookCategory = 'all';
  function allowedSetting(key, value) {
    return allowed[key]?.includes(value) || (typeof defaults[key] === 'boolean' && typeof value === 'boolean') || (key === 'microphone' && typeof value === 'string' && value.length > 0 && value.length <= 512);
  }
  for (const [select, editor] of [[$('settings-form').elements.namedItem('filter'), false], [$('editor-filter'), true]]) {
    select.replaceChildren();
    for (const category of looks.categories.filter((item) => item.id !== 'all')) {
      const group = document.createElement('optgroup'); group.label = category.label;
      for (const preset of looks.presets.filter((item) => item.category === category.id)) group.append(new Option(editor && preset.id === 'none' ? 'Original' : preset.label, preset.id));
      select.append(group);
    }
    select.value = 'none';
  }

  function makeIcon(name, style = 'solid') {
    const icon = document.createElement('i');
    icon.className = `fa-${style} fa-${name}`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function iconLabel(element, name, label, style = 'solid') {
    const text = document.createElement('span'); text.className = 'button-label'; text.textContent = label;
    element.replaceChildren(makeIcon(name, style), text);
  }

  try {
    const stored = JSON.parse(localStorage.getItem('miui-camera-simple-settings') || '{}');
    for (const key of Object.keys(defaults)) {
      if (allowedSetting(key, stored?.[key])) settings[key] = stored[key];
    }
  } catch { /* Invalid or inaccessible storage uses defaults. */ }
  state.facing = settings.camera;
  if (settings.microphone !== 'default') $('settings-form').elements.microphone.add(new Option('Microfone salvo', settings.microphone));

  function notice(message) {
    $('notice').textContent = message;
    $('notice').hidden = false;
    clearTimeout(state.noticeTimer);
    state.noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6500);
  }

  function saveSettings() {
    try { localStorage.setItem('miui-camera-simple-settings', JSON.stringify(settings)); }
    catch { notice('Não foi possível guardar as preferências neste navegador.'); }
  }

  async function addMedia(blob, kind, captureInfo = cinema?.slate(), advanceTake = true) {
    if (!blob?.size) throw new Error('O navegador gerou um arquivo vazio. Tente novamente.');
    const item = { ...captureInfo, id: captureInfo?.recordingId || crypto.randomUUID(), blob, kind, type: blob.type, size: blob.size, created: captureInfo?.recordingId && captureInfo.created || Date.now(), saved: false };
    try { const meta = await store.save(item, captureInfo?.recordingId); delete meta.thumbnail; Object.assign(item, meta); item.saved = true; }
    catch { notice('Captura somente na memória. Baixe o arquivo agora: o armazenamento local falhou.'); }
    if (state.disposed) return;
    state.media = state.media.filter(existing => existing.id !== item.id);
    state.media.unshift(item);
    renderGallery();
    updateThumbnail();
    if (item.saved) item.blob = null;
    if (captureInfo && advanceTake) cinema?.advance();
    return item;
  }

  async function loadMedia() {
    try {
      $('gallery-loading').textContent = 'Carregando catálogo…';
      const records = await store.list((done, total) => { $('gallery-loading').textContent = `Preparando miniaturas antigas: ${done}/${total}…`; });
      if (state.disposed) return;
      const known = new Set(state.media.map((item) => item.id));
      state.media.push(...records.filter((item) => !known.has(item.id)));
      state.media.sort((a, b) => b.created - a.created);
      renderGallery();
      updateThumbnail();
    } catch (error) { notice(`Galeria local indisponível: ${error.message}`); }
    finally { $('gallery-loading').textContent = ''; }
  }

  async function original(item) {
    if (item.blob) return { ...item, blob: item.blob };
    const record = await store.get(item.id);
    if (!record?.blob) throw new Error('Arquivo original indisponível.');
    return { ...item, blob: record.blob };
  }

  async function thumbnailURL(item) {
    if (gallery.thumbnailURLs.has(item.id)) return gallery.thumbnailURLs.get(item.id);
    const record = item.saved ? await store.thumbnail(item.id) : null;
    const blob = record?.blob || (!item.saved && item.kind === 'photo' ? item.blob : null);
    if (!blob || state.disposed) return '';
    if (!gallery.thumbnailURLs.has(item.id)) gallery.thumbnailURLs.set(item.id, URL.createObjectURL(blob));
    return gallery.thumbnailURLs.get(item.id);
  }

  function updateThumbnail() {
    const active = state.media.filter((item) => !item.deletedAt);
    const image = active.find((item) => item.kind === 'photo');
    $('thumbnail').hidden = !image;
    $('gallery-open').querySelector('span').hidden = !!image;
    $('media-count').hidden = active.length === 0;
    $('media-count').textContent = active.length > 99 ? '99+' : String(active.length);
    if (image) thumbnailURL(image).then((url) => { if (url && state.media.find((item) => !item.deletedAt && item.kind === 'photo')?.id === image.id) $('thumbnail').src = url; }).catch(() => {});
    else $('thumbnail').removeAttribute('src');
    $('gallery-open').setAttribute('aria-label', `Abrir galeria (${active.length} capturas)`);
  }

  function renderGallery() {
    const grid = $('gallery-grid');
    galleryObserver?.disconnect();
    grid.replaceChildren();
    const visible = visibleMedia();
    $('gallery-empty').hidden = visible.length > 0;
    $('gallery-empty').textContent = gallery.filter === 'trash' ? 'A lixeira está vazia.' : gallery.favoritesOnly ? 'Nenhuma captura nos favoritos.' : 'Nenhuma captura neste filtro.';
    $('gallery-title').textContent = `${gallery.filter === 'trash' ? 'Lixeira' : 'Galeria'} (${visible.length})`;
    $('trash-info').hidden = gallery.filter !== 'trash';
    $('gallery-more').hidden = visible.length <= gallery.limit || !!state.selected;
    let day = '';
    for (const item of visible.slice(0, gallery.limit)) {
      const date = new Date(item.created).toLocaleDateString('pt-BR');
      if (date !== day) { const heading = document.createElement('h3'); heading.className = 'gallery-date'; heading.textContent = date; grid.append(heading); day = date; }
      const button = document.createElement('button');
      button.className = 'gallery-item';
      button.dataset.id = item.id;
      button.classList.toggle('selected', gallery.checked.has(item.id));
      button.setAttribute('aria-label', `${item.kind === 'photo' ? 'Foto' : 'Vídeo'} de ${new Date(item.created).toLocaleString('pt-BR')}`);
      if (gallery.selecting) button.setAttribute('aria-pressed', String(gallery.checked.has(item.id)));
      button.setAttribute('aria-haspopup', 'dialog');
      const media = document.createElement('img');
      media.alt = ''; media.loading = 'lazy'; media.dataset.thumbnail = item.id;
      button.append(media);
      if (item.scene || item.take || item.goodTake) {
        const slate = document.createElement('small'); slate.className = 'slate-marker';
        slate.textContent = `${item.goodTake ? '★ ' : ''}${item.scene ? `C${item.scene} ` : ''}${item.take ? `T${item.take}` : ''}`;
        button.append(slate);
      }
      if (item.kind === 'video' || !item.saved) {
        const badge = document.createElement('span');
        iconLabel(badge, !item.saved ? 'triangle-exclamation' : 'play', !item.saved ? 'Não salvo' : 'Vídeo');
        button.append(badge);
      }
      if (item.favorite) {
        const star = document.createElement('span'); star.className = 'favorite-marker'; star.append(makeIcon('heart')); star.setAttribute('aria-label', 'Favorito protegido contra exclusão'); button.append(star);
      }
      if (gallery.selecting) {
        const marker = document.createElement('span'); marker.className = 'select-marker'; if (gallery.checked.has(item.id)) marker.append(makeIcon('check')); marker.setAttribute('aria-hidden', 'true'); button.append(marker);
      }
      let holdTimer, pointer, suppressClick = false;
      const cancelHold = () => { clearTimeout(holdTimer); pointer = null; };
      button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || gallery.busy) return;
        suppressClick = false;
        pointer = { x: event.clientX, y: event.clientY };
        holdTimer = setTimeout(() => {
          suppressClick = true; pointer = null;
          openMediaMenu(gallery.selecting && gallery.checked.has(item.id) ? [...gallery.checked] : [item.id], true);
        }, 550);
      });
      button.addEventListener('pointermove', (event) => {
        if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) cancelHold();
      });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, cancelHold);
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); cancelHold(); if (!suppressClick) openMediaMenu(gallery.selecting && gallery.checked.has(item.id) ? [...gallery.checked] : [item.id]); suppressClick = true; });
      button.addEventListener('keydown', (event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openMediaMenu([item.id]); }
      });
      button.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        if (gallery.busy) return;
        if (gallery.selecting) {
          if (gallery.checked.has(item.id)) gallery.checked.delete(item.id); else gallery.checked.add(item.id);
          renderGallery();
          [...grid.children].find((entry) => entry.dataset.id === item.id)?.focus({ preventScroll: true });
        } else openViewer(item.id);
      });
      grid.append(button);
    }
    const loadThumbnail = async (image) => {
      const item = state.media.find((entry) => entry.id === image.dataset.thumbnail);
      if (!item) return;
      try { const url = await thumbnailURL(item); if (url && image.isConnected) image.src = url; } catch { /* Placeholder stays visible. */ }
    };
    if ('IntersectionObserver' in window) {
      galleryObserver = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) { loadThumbnail(entry.target); galleryObserver.unobserve(entry.target); } }, { root: $('gallery-dialog'), rootMargin: '250px' });
      grid.querySelectorAll('img').forEach((image) => galleryObserver.observe(image));
    } else grid.querySelectorAll('img').forEach(loadThumbnail);
    syncSelection();
  }

  async function openViewer(id) {
    const item = state.media.find((entry) => entry.id === id);
    if (!item) return;
    state.selected = id;
    const token = ++gallery.viewerToken;
    releaseViewer(); resetViewerGesture();
    $('gallery-dialog').classList.add('viewing');
    $('viewer-stage').classList.toggle('photo-view', item.kind === 'photo');
    $('gallery-grid').hidden = true;
    $('gallery-empty').hidden = true;
    $('viewer').hidden = false;
    $('viewer-image').hidden = item.kind !== 'photo';
    $('viewer-video').hidden = item.kind !== 'video';
    $('save-state').textContent = 'Abrindo original…';
    try {
      const record = await original(item);
      if (token !== gallery.viewerToken || state.selected !== id) return;
      gallery.viewerURL = URL.createObjectURL(record.blob);
      if (item.kind === 'photo') $('viewer-image').src = gallery.viewerURL;
      else {
        const player = $('viewer-video'); player.defaultMuted = false; player.muted = false; player.volume = 1;
        player.src = gallery.viewerURL;
      }
      $('save-state').textContent = item.deletedAt ? item.favorite ? 'Favorito protegido na lixeira. Restaure ou remova dos favoritos para excluir.' : `Na lixeira até ${new Date(item.deletedAt + store.retention).toLocaleDateString('pt-BR')}` : item.saved ? 'Salvo neste navegador. Exporte para manter uma cópia.' : 'Somente na memória: baixe antes de fechar a página.';
    } catch (error) { if (token === gallery.viewerToken) $('save-state').textContent = error.message; }
    $('viewer-back').focus();
    const index = visibleMedia().findIndex((entry) => entry.id === id);
    $('viewer-prev').disabled = index <= 0;
    $('viewer-next').disabled = index < 0 || index >= visibleMedia().length - 1;
    iconLabel($('delete'), 'trash-can', item.deletedAt ? 'Excluir de vez' : 'Excluir');
    $('delete').disabled = !!item.favorite;
    $('delete').title = item.favorite ? 'Remova dos favoritos antes de excluir.' : '';
  }

  function closeViewer() {
    const selected = state.selected;
    state.selected = null;
    gallery.viewerToken++; releaseViewer(); resetViewerGesture();
    $('gallery-dialog').classList.remove('viewing');
    $('viewer-video').pause();
    $('viewer-video').removeAttribute('src');
    $('viewer-video').load();
    $('viewer-image').removeAttribute('src');
    $('viewer').hidden = true;
    $('gallery-grid').hidden = false;
    renderGallery();
    if (selected) $('gallery-grid').querySelector('button')?.focus();
  }

  function visibleMedia() { return state.media.filter((item) => (gallery.filter === 'trash' ? !!item.deletedAt : !item.deletedAt) && (!gallery.favoritesOnly || item.favorite) && (gallery.filter !== 'good' || item.goodTake) && (!['photo', 'video'].includes(gallery.filter) || item.kind === gallery.filter) && (!cinema || cinema.matches(item)) && (!collection || collection.matches(item))); }

  function releaseViewer() {
    $('viewer-video').pause(); $('viewer-video').removeAttribute('src'); $('viewer-video').load(); $('viewer-image').removeAttribute('src');
    if (gallery.viewerURL) URL.revokeObjectURL(gallery.viewerURL);
    gallery.viewerURL = null;
  }

  const gesture = { pointers: new Map(), scale: 1, x: 0, y: 0, start: null, pinch: null, multi: false, lastTap: 0 };
  function resetViewerGesture() {
    gesture.pointers.clear(); Object.assign(gesture, { scale: 1, x: 0, y: 0, start: null, pinch: null, multi: false });
    $('gallery-dialog').classList.remove('controls-hidden'); applyViewerTransform();
  }
  function applyViewerTransform() {
    const stage = $('viewer-stage').getBoundingClientRect();
    const image = $('viewer-image');
    const fitted = Math.min(stage.width / (image.naturalWidth || stage.width || 1), stage.height / (image.naturalHeight || stage.height || 1));
    const width = (image.naturalWidth || stage.width) * fitted, height = (image.naturalHeight || stage.height) * fitted;
    const maxX = Math.max(0, (width * gesture.scale - stage.width) / 2), maxY = Math.max(0, (height * gesture.scale - stage.height) / 2);
    gesture.x = Math.max(-maxX, Math.min(maxX, gesture.x)); gesture.y = Math.max(-maxY, Math.min(maxY, gesture.y));
    image.style.transform = `translate(${gesture.x}px, ${gesture.y}px) scale(${gesture.scale})`;
    $('viewer-zoom').textContent = `${gesture.scale.toFixed(1)}×`; $('viewer-zoom').hidden = gesture.scale <= 1.01;
  }
  function navigateViewer(direction) {
    const visible = visibleMedia(), index = visible.findIndex((item) => item.id === state.selected);
    if (visible[index + direction]) openViewer(visible[index + direction].id);
  }
  $('viewer-stage').addEventListener('pointerdown', (event) => {
    if (!$('viewer-stage').classList.contains('photo-view') || event.button !== 0) return;
    event.preventDefault(); $('viewer-stage').setPointerCapture(event.pointerId);
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.pointers.size === 1) gesture.start = { x: event.clientX, y: event.clientY, time: performance.now(), tx: gesture.x, ty: gesture.y };
    if (gesture.pointers.size === 2) {
      const [a, b] = [...gesture.pointers.values()]; gesture.multi = true;
      gesture.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: gesture.scale };
    }
  });
  $('viewer-stage').addEventListener('pointermove', (event) => {
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.pointers.size === 2 && gesture.pinch?.distance) {
      const [a, b] = [...gesture.pointers.values()];
      gesture.scale = Math.max(1, Math.min(6, gesture.pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.pinch.distance)); applyViewerTransform();
    } else if (gesture.scale > 1 && gesture.start && !gesture.multi) {
      gesture.x = gesture.start.tx + event.clientX - gesture.start.x; gesture.y = gesture.start.ty + event.clientY - gesture.start.y; applyViewerTransform();
    }
  });
  function endViewerPointer(event) {
    if (!gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    if (gesture.pointers.size) return;
    const start = gesture.start; gesture.start = null; gesture.pinch = null;
    if (event.type === 'pointercancel' || gesture.multi) { gesture.multi = false; return; }
    if (!start) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (gesture.scale <= 1.01 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.3) navigateViewer(dx < 0 ? 1 : -1);
    else if (Math.hypot(dx, dy) < 10 && performance.now() - start.time < 450) {
      const now = performance.now();
      if (now - gesture.lastTap < 300) { gesture.scale = gesture.scale > 1 ? 1 : 2.5; gesture.x = gesture.y = 0; applyViewerTransform(); gesture.lastTap = 0; }
      else { $('gallery-dialog').classList.toggle('controls-hidden'); gesture.lastTap = now; }
    }
  }
  $('viewer-stage').addEventListener('pointerup', endViewerPointer);
  $('viewer-stage').addEventListener('pointercancel', endViewerPointer);
  $('viewer-image').addEventListener('load', applyViewerTransform);
  $('gallery-dialog').addEventListener('keydown', (event) => {
    if (!state.selected || document.querySelector('#media-menu[open], #editor-dialog[open], #properties-dialog[open]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigateViewer(event.key === 'ArrowRight' ? 1 : -1); }
  });

  function syncSelection() {
    const known = new Set(state.media.map((item) => item.id));
    for (const id of gallery.checked) if (!known.has(id)) gallery.checked.delete(id);
    iconLabel($('gallery-select'), gallery.selecting ? 'xmark' : 'circle-check', gallery.selecting ? 'Cancelar' : 'Selecionar');
    $('gallery-select').setAttribute('aria-pressed', String(gallery.selecting));
    $('selection-bar').hidden = !gallery.selecting;
    $('selection-count').textContent = `${gallery.checked.size} selecionada${gallery.checked.size === 1 ? '' : 's'}`;
    $('selection-actions').disabled = !gallery.checked.size || gallery.busy;
    $('select-all').disabled = !visibleMedia().length || gallery.busy;
    $('gallery-select').disabled = gallery.busy;
    $('favorites-filter').setAttribute('aria-pressed', String(gallery.favoritesOnly));
    iconLabel($('favorites-filter'), 'heart', 'Favoritos', gallery.favoritesOnly ? 'solid' : 'regular');
  }

  function menuItems() { return gallery.menuIds.map((id) => state.media.find((item) => item.id === id)).filter(Boolean); }

  function setGalleryBusy(busy) {
    gallery.busy = busy;
    document.querySelectorAll('.media-menu-actions button:not([data-close])').forEach((button) => { button.disabled = busy; });
    const items = menuItems();
    $('action-edit').disabled = busy || items.length !== 1 || items[0]?.kind !== 'photo';
    $('action-edit').disabled ||= items.some((item) => item.deletedAt);
    if ($('action-slate')) $('action-slate').disabled = busy || items.length !== 1;
    $('action-delete').disabled = busy || !items.some(item => !item.favorite);
    $('delete').disabled = busy || !!state.media.find(item => item.id === state.selected)?.favorite;
    syncSelection();
  }

  function openMediaMenu(ids, held = false) {
    if (gallery.busy) return;
    gallery.menuHold = held;
    gallery.ignoreBackdropUntil = performance.now() + 300;
    $('viewer-video').pause();
    gallery.menuIds = [...new Set(ids)];
    gallery.shareFiles = null;
    const items = menuItems();
    if (!items.length) return;
    $('media-menu-title').textContent = items.length === 1 ? 'Opções da captura' : `${items.length} capturas selecionadas`;
    const favorite = items.every((item) => item.favorite);
    if ($('action-good-take')) $('action-good-take').textContent = items.every(item => item.goodTake) ? 'Desmarcar melhor tomada' : 'Marcar melhor tomada';
    iconLabel($('action-favorite'), 'heart', favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos', favorite ? 'solid' : 'regular');
    iconLabel($('action-download'), items.length === 1 ? 'download' : 'file-zipper', items.length === 1 ? 'Baixar arquivo' : 'Baixar selecionadas (.zip)');
    const trashed = items.every((item) => item.deletedAt);
    iconLabel($('action-delete'), 'trash-can', trashed ? 'Excluir permanentemente' : items.length === 1 ? 'Mover para a lixeira' : `Mover ${items.length} para a lixeira`);
    $('action-restore').hidden = !trashed;
    $('menu-status').textContent = '';
    if (items.every(item => item.favorite)) $('menu-status').textContent = 'Favoritos protegidos. Remova dos favoritos antes de excluir.';
    setGalleryBusy(false);
    if (!$('media-menu').open) $('media-menu').showModal();
  }

  // A single transaction keeps favorite updates and batch deletion atomic.
  async function writeBatch(items, remove = false) {
    await CameraStore.updateMany(items.filter((item) => item.saved), remove);
  }

  async function favoriteItems() {
    const items = menuItems();
    if (!items.length || gallery.busy) return;
    const favorite = !items.every((item) => item.favorite);
    setGalleryBusy(true);
    try {
      await writeBatch(items.map((item) => ({ ...item, favorite })));
      items.forEach((item) => { item.favorite = favorite; });
      $('media-menu').close(); renderGallery();
      notice(favorite ? 'Adicionado aos favoritos.' : 'Removido dos favoritos.');
    } catch { $('menu-status').textContent = 'Não foi possível atualizar os favoritos. Tente novamente.'; }
    finally { setGalleryBusy(false); }
  }

  function dismissUndo() {
    const hadFocus = $('undo-bar').contains(document.activeElement);
    clearTimeout(gallery.undoTimer); gallery.undoTimer = null;
    gallery.undoIds = []; $('undo-bar').hidden = true;
    if (hadFocus) (state.selected ? $('viewer-options') : $('gallery-select')).focus({ preventScroll: true });
  }

  function confirmPermanentDelete(items) {
    const eligible = items.filter(item => !item.favorite);
    if (!eligible.length) { notice('Favoritos protegidos. Remova dos favoritos antes de excluir.'); return; }
    gallery.pendingDelete = eligible.map(item => item.id);
    $('confirm-delete-description').textContent = `${eligible.length} captura(s) serão apagadas permanentemente${eligible.every(item => item.deletedAt) ? ' da lixeira' : ', sem passar pela lixeira'}. Esta ação não pode ser desfeita.${eligible.length < items.length ? ' Os favoritos serão preservados.' : ''}`;
    if (!$('confirm-delete').open) $('confirm-delete').showModal();
  }

  function requestDelete(items) {
    if (!items.length || gallery.busy) return;
    const eligible = items.filter(item => !item.favorite);
    if (!eligible.length) { notice('Favoritos protegidos. Remova dos favoritos antes de excluir.'); return; }
    if (eligible.every(item => item.deletedAt)) { confirmPermanentDelete(items); return; }
    gallery.pendingDeleteChoice = items.map(item => item.id);
    $('delete-options-description').textContent = `${eligible.length} captura(s) podem ser excluídas.${eligible.length < items.length ? ` ${items.length - eligible.length} favorito(s) serão preservados.` : ''}`;
    if (!$('delete-options').open) $('delete-options').showModal();
  }

  async function deleteItems(items, permanent = false) {
    if (!items.length || gallery.busy) return;
    const protectedCount = items.filter(item => item.favorite).length;
    items = items.filter(item => !item.favorite);
    if (!items.length) { notice('Favoritos protegidos. Remova dos favoritos antes de excluir.'); return; }
    if (items.every((item) => item.deletedAt) && !permanent) {
      confirmPermanentDelete(items); return;
    }
    setGalleryBusy(true);
    try {
      const deletedAt = Date.now();
      await writeBatch(permanent ? items : items.map((item) => ({ ...item, deletedAt })), permanent);
      const ids = new Set(items.map((item) => item.id));
      if (permanent) { state.media = state.media.filter((item) => !ids.has(item.id)); dismissUndo(); }
      else items.forEach((item) => { item.deletedAt = deletedAt; });
      items.forEach((item) => { gallery.checked.delete(item.id); });
      if (ids.has(state.selected)) closeViewer(); else renderGallery();
      if ($('media-menu').open) $('media-menu').close();
      if (permanent) items.forEach((item) => { const url = gallery.thumbnailURLs.get(item.id); if (url) URL.revokeObjectURL(url); gallery.thumbnailURLs.delete(item.id); });
      else {
        gallery.undoIds = [...ids]; $('undo-message').textContent = `${items.length} captura(s) na lixeira.`; $('undo-bar').hidden = false;
        clearTimeout(gallery.undoTimer); gallery.undoTimer = setTimeout(dismissUndo, 15000);
      }
      updateThumbnail();
      if (protectedCount) notice(`${protectedCount} favorito(s) preservado(s). Somente os demais arquivos foram excluídos.`);
    } catch {
      $('menu-status').textContent = 'A exclusão falhou. As capturas foram mantidas na galeria.';
      notice('A exclusão falhou. As capturas foram mantidas na galeria.');
    } finally { setGalleryBusy(false); }
  }

  async function restoreItems(items) {
    if (!items.length || gallery.busy) return;
    setGalleryBusy(true);
    try {
      await writeBatch(items.map((item) => ({ ...item, deletedAt: null })));
      items.forEach((item) => { item.deletedAt = null; });
      gallery.checked.clear(); dismissUndo();
      if ($('media-menu').open) $('media-menu').close();
      if (state.selected) closeViewer(); else renderGallery();
      updateThumbnail();
    } catch { $('menu-status').textContent = 'Não foi possível restaurar. Os itens continuam na lixeira.'; }
    finally { setGalleryBusy(false); }
  }

  function fileName(item) {
    const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' })[(item.type || item.blob?.type || '').split(';')[0]] || 'webm';
    return `${item.kind === 'photo' ? 'foto' : 'video'}_${new Date(item.created).toISOString().replace(/[:.]/g, '-')}_${item.id.slice(0, 8)}.${extension}`;
  }

  function downloadURL(url, name) {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
  }

  // Uncompressed ZIP avoids multiple-download prompts and needs no external library.
  async function zipFiles(items) {
    const parts = [], directory = [];
    let offset = 0, directorySize = 0;
    const encoder = new TextEncoder();
    const crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[i] = c >>> 0; }
    if (items.length > 65535) throw new Error('Selecione menos arquivos por download.');
    for (const item of items) {
      const record = await original(item);
      const bytes = new Uint8Array(await record.blob.arrayBuffer());
      if (offset + bytes.length > 0xffffffff) throw new Error('O conjunto ultrapassa 4 GB. Baixe em grupos menores.');
      const name = encoder.encode(fileName(item));
      let crc = 0xffffffff;
      for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
      crc = (crc ^ 0xffffffff) >>> 0;
      const date = new Date(item.created);
      const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
      const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
      const local = new Uint8Array(30 + name.length), l = new DataView(local.buffer);
      l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true);
      l.setUint16(10, time, true); l.setUint16(12, day, true); l.setUint32(14, crc, true);
      l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true); local.set(name, 30);
      const central = new Uint8Array(46 + name.length), c = new DataView(central.buffer);
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
      c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true);
      c.setUint32(20, bytes.length, true); c.setUint32(24, bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true); central.set(name, 46);
      parts.push(local, bytes); directory.push(central); offset += local.length + bytes.length; directorySize += central.length;
    }
    const end = new Uint8Array(22), e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, items.length, true); e.setUint16(10, items.length, true);
    e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...directory, end], { type: 'application/zip' });
  }

  async function downloadItems(items) {
    if (!items.length || gallery.busy) return;
    setGalleryBusy(true);
    try {
      if (items.length === 1) {
        const record = await original(items[0]), url = URL.createObjectURL(record.blob);
        downloadURL(url, fileName(items[0])); setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      else {
        $('menu-status').textContent = 'Preparando arquivo ZIP…';
        const url = URL.createObjectURL(await zipFiles(items));
        downloadURL(url, 'capturas.zip');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      if ($('media-menu').open) $('media-menu').close();
    } catch (error) { $('menu-status').textContent = `Download indisponível: ${error.message}`; }
    finally { setGalleryBusy(false); }
  }

  async function shareItems() {
    const items = menuItems();
    if (!items.length || gallery.busy) return;
    if (!navigator.share) { $('menu-status').textContent = 'Este navegador não oferece compartilhamento. Use Baixar.'; return; }
    if (!gallery.shareFiles) {
      setGalleryBusy(true); $('menu-status').textContent = 'Preparando arquivos…';
      try {
        gallery.shareFiles = [];
        for (const item of items) { const record = await original(item); gallery.shareFiles.push(new File([record.blob], fileName(item), { type: record.blob.type, lastModified: item.created })); }
      } catch { gallery.shareFiles = null; $('menu-status').textContent = 'Não foi possível ler os arquivos.'; return; }
      finally { setGalleryBusy(false); }
      if (navigator.userActivation && !navigator.userActivation.isActive) { $('menu-status').textContent = 'Arquivos prontos. Toque novamente em Compartilhar.'; return; }
    }
    const files = gallery.shareFiles;
    if (!navigator.share || (navigator.canShare && !navigator.canShare({ files }))) {
      $('menu-status').textContent = 'Este navegador não oferece compartilhamento destes arquivos. Use Baixar e compartilhe pelo seu dispositivo.';
      return;
    }
    setGalleryBusy(true);
    try { await navigator.share({ files }); $('media-menu').close(); }
    catch (error) { if (error.name !== 'AbortError') $('menu-status').textContent = 'Não foi possível compartilhar. Use Baixar para exportar os arquivos.'; }
    finally { setGalleryBusy(false); }
  }

  async function mediaDimensions(item) {
    if (item.width && item.height) return { width: item.width, height: item.height, duration: item.duration };
    const record = await original(item);
    if (item.kind === 'photo') {
      const bitmap = await decodePhoto(record.blob);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.(); return dimensions;
    }
    return new Promise((resolve) => {
      const media = document.createElement('video');
      const timer = setTimeout(() => finish(null), 4000);
      const finish = (result) => { clearTimeout(timer); media.onloadedmetadata = null; media.onerror = null; media.removeAttribute('src'); media.load(); resolve(result); };
      media.onloadedmetadata = () => finish({ width: media.videoWidth, height: media.videoHeight, duration: media.duration });
      media.onerror = () => finish(null);
      const url = URL.createObjectURL(record.blob);
      media.addEventListener('emptied', () => URL.revokeObjectURL(url), { once: true });
      media.preload = 'metadata'; media.src = url;
    });
  }

  async function showProperties() {
    const items = menuItems();
    if (!items.length) return;
    $('media-menu').close();
    const content = $('properties-content'); content.replaceChildren();
    $('properties-dialog').showModal();
    const total = document.createElement('p'); total.className = 'muted'; total.textContent = `${items.length} arquivo(s) · ${(items.reduce((size, item) => size + item.size, 0) / 1024 / 1024).toFixed(2)} MB`; content.append(total);
    for (const item of items) {
      if (!$('properties-dialog').open) break;
      const section = document.createElement('section'); section.className = 'property-item';
      const title = document.createElement('h3'); title.textContent = fileName(item);
      const list = document.createElement('dl'); section.append(title, list); content.append(section);
      const add = (key, value) => { const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; list.append(dt, dd); };
      add('Tipo', item.type || 'Desconhecido'); add('Tamanho', `${(item.size / 1024).toFixed(1)} KB`);
      add('Criada em', new Date(item.created).toLocaleString('pt-BR')); add('Favorito', item.favorite ? 'Sim' : 'Não'); add('Salvamento', item.saved ? 'Neste navegador' : 'Somente na memória');
      add('Projeto', item.project || '—'); add('Cena', item.scene || '—'); add('Tomada', item.take || '—'); add('Melhor tomada', item.goodTake ? 'Sim' : 'Não');
      add('Álbuns', collection?.albumNames(item.albumIds).join(', ') || 'Sem álbum');
      if (item.kind === 'video') add('Microfone na gravação', item.hasAudio == null ? 'Não informado neste arquivo antigo' : item.hasAudio ? 'Faixa de áudio incluída' : 'Desativado');
      if (item.deletedAt) add('Lixeira até', new Date(item.deletedAt + store.retention).toLocaleDateString('pt-BR'));
      try {
        const dimensions = await mediaDimensions(item);
        if (dimensions) { add('Dimensões', `${dimensions.width} × ${dimensions.height} px`); if (Number.isFinite(dimensions.duration)) add('Duração', `${dimensions.duration.toFixed(1)} s`); }
      } catch { add('Dimensões', 'Indisponíveis'); }
    }
  }

  async function decodePhoto(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const image = new Image(), url = URL.createObjectURL(blob);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir a foto.')); };
      image.src = url;
    });
  }

  function drawEditor(fullSize = false) {
    const editor = gallery.editor;
    if (!editor?.image) return;
    const image = editor.image;
    const before = editor.before && !fullSize;
    const rotation = before ? 0 : editor.rotation;
    let sw = image.width, sh = image.height;
    const ratioChoice = before ? 'original' : $('editor-ratio').value;
    if (ratioChoice === 'free') { sw *= Number($('crop-width').value) / 100; sh *= Number($('crop-height').value) / 100; }
    else if (ratioChoice !== 'original') {
      const ratio = rotation % 180 !== 0 ? 1 / Number(ratioChoice) : Number(ratioChoice);
      if (sw / sh > ratio) sw = sh * ratio; else sh = sw / ratio;
      const reduction = Number($('crop-width').value) / 100; sw *= reduction; sh *= reduction;
    }
    if (!before && editor.crop && ratioChoice === 'original') sw = sh = Math.min(sw, sh);
    const sx = before ? 0 : (image.width - sw) * Number($('crop-x').value) / 100;
    const sy = before ? 0 : (image.height - sh) * Number($('crop-y').value) / 100;
    const rotated = rotation % 180 !== 0;
    const width = rotated ? sh : sw, height = rotated ? sw : sh;
    const scale = fullSize ? 1 : Math.min(1, 1200 / Math.max(width, height));
    const output = fullSize ? document.createElement('canvas') : $('editor-canvas');
    output.width = Math.max(1, Math.round(width * scale)); output.height = Math.max(1, Math.round(height * scale));
    const context = output.getContext('2d');
    context.translate(output.width / 2, output.height / 2); context.scale(scale, scale);
    context.rotate(rotation * Math.PI / 180); if (!before && editor.mirror) context.scale(-1, 1);
    context.filter = before ? 'none' : `${looks.compose($('editor-filter').value, $('editor-filter-intensity').value)} brightness(${$('editor-brightness').value}) contrast(${$('editor-contrast').value}) saturate(${$('editor-saturation').value})`.trim();
    context.drawImage(image, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    window.MobileRanges?.refresh();
    return output;
  }

  async function openEditor() {
    const items = menuItems();
    if (items.length !== 1 || items[0].kind !== 'photo') return;
    $('media-menu').close();
    $('editor-status').textContent = 'Abrindo foto…'; $('editor-save').disabled = true;
    $('editor-dialog').showModal();
    const editor = { item: items[0], rotation: 0, mirror: false, crop: false, image: null };
    gallery.editor = editor;
    $('editor-brightness').value = '1'; $('editor-contrast').value = '1'; $('editor-filter').value = 'none';
    $('editor-filter-intensity').value = '1'; $('editor-filter-intensity').disabled = true;
    $('editor-saturation').value = '1'; $('editor-ratio').value = 'original'; $('crop-width').value = $('crop-height').value = '100'; $('crop-x').value = $('crop-y').value = '50'; $('crop-controls').hidden = true;
    $('editor-compare').setAttribute('aria-pressed', 'false'); iconLabel($('editor-compare'), 'eye', 'Ver antes');
    $('editor-mirror').setAttribute('aria-pressed', 'false'); $('editor-crop').setAttribute('aria-pressed', 'false');
    try {
      const record = await original(editor.item);
      const image = await decodePhoto(record.blob);
      if (gallery.editor !== editor || !$('editor-dialog').open) { image.close?.(); return; }
      editor.image = image; drawEditor(); $('editor-status').textContent = ''; $('editor-save').disabled = false;
    } catch { $('editor-status').textContent = 'Não foi possível abrir esta foto para edição.'; }
  }

  async function exportBackup() {
    if (gallery.busy) return;
    setGalleryBusy(true); $('backup-export').disabled = true; $('backup-file').disabled = true;
    const items = [...state.media];
    try {
      if (items.length > 10000) throw new Error('O backup suporta até 10.000 arquivos por coleção.');
      const files = [], entries = [];
      for (let index = 0; index < items.length; index++) {
        $('backup-status').textContent = `Preparando backup ${index + 1}/${items.length}…`;
        const record = await original(items[index]);
        entries.push({ ...store.metadata(record), size: record.blob.size, type: record.blob.type }); files.push(record.blob);
      }
      const manifest = new TextEncoder().encode(JSON.stringify({ app: 'miui-camera-simple', version: 1, entries, albums: await store.listAlbums() }));
      if (manifest.length > 4 * 1024 * 1024) throw new Error('O catálogo excede o tamanho suportado pelo backup.');
      const header = new Uint8Array(12); header.set(new TextEncoder().encode('MIUICAM1'));
      new DataView(header.buffer).setUint32(8, manifest.length, true);
      const url = URL.createObjectURL(new Blob([header, manifest, ...files], { type: 'application/octet-stream' }));
      downloadURL(url, `camera-backup-${new Date().toISOString().slice(0, 10)}.miuicam`); setTimeout(() => URL.revokeObjectURL(url), 60000);
      $('backup-status').textContent = `Backup de ${items.length} captura(s) preparado. Guarde o arquivo baixado em um lugar seguro.`;
    } catch (error) { $('backup-status').textContent = `O backup não foi concluído: ${error.message}`; }
    finally { setGalleryBusy(false); $('backup-export').disabled = false; $('backup-file').disabled = false; }
  }

  async function importBackup(file) {
    if (!file || gallery.busy) return;
    setGalleryBusy(true); $('backup-export').disabled = true; $('backup-file').disabled = true;
    try {
      const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
      if (header.length !== 12 || new TextDecoder().decode(header.slice(0, 8)) !== 'MIUICAM1') throw new Error('Este arquivo não é um backup .miuicam válido.');
      const length = new DataView(header.buffer).getUint32(8, true);
      if (!length || length > 4 * 1024 * 1024 || length + 12 > file.size) throw new Error('Cabeçalho inválido ou incompleto.');
      const manifest = JSON.parse(await file.slice(12, 12 + length).text());
      if (manifest.app !== 'miui-camera-simple' || manifest.version !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length > 10000) throw new Error('Formato ou versão de backup não suportados.');
      const backupAlbums = manifest.albums ?? [];
      if (!Array.isArray(backupAlbums) || backupAlbums.length > 500) throw new Error('Lista de álbuns inválida.');
      const existingAlbums = await store.listAlbums();
      if (existingAlbums.length + backupAlbums.length > 500) throw new Error('A restauração ultrapassaria o limite de 500 álbuns.');
      const albumNames = new Set(existingAlbums.map(album => album.name));
      const albumMap = new Map(), importedAlbums = [];
      for (const album of backupAlbums) {
        if (!album || typeof album.id !== 'string' || album.id.length > 80 || albumMap.has(album.id) || typeof album.name !== 'string' || !album.name.trim() || album.name.length > 80) throw new Error('Álbum inválido no backup.');
        let name = album.name.trim(), suffix = 1;
        while (albumNames.has(name)) { const ending = suffix === 1 ? ' (importado)' : ` (importado ${suffix})`; name = album.name.trim().slice(0, 80 - ending.length) + ending; suffix++; }
        albumNames.add(name);
        const id = crypto.randomUUID(); albumMap.set(album.id, id); importedAlbums.push({ id, name, created: Date.now() });
      }
      let offset = 12 + length;
      const rows = [];
      for (const entry of manifest.entries) {
        if (!entry || !['photo', 'video'].includes(entry.kind) || typeof entry.type !== 'string' || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !Number.isFinite(entry.created) || !Number.isFinite(new Date(entry.created).getTime()) || typeof entry.favorite !== 'boolean') throw new Error('O backup contém metadados inválidos.');
        const type = entry.type.split(';')[0];
        if ((entry.kind === 'photo' ? !['image/jpeg', 'image/png', 'image/webp'].includes(type) : !['video/mp4', 'video/webm'].includes(type)) || !Number.isSafeInteger(offset + entry.size) || offset + entry.size > file.size) throw new Error('O backup contém um arquivo inválido ou truncado.');
        if (entry.deletedAt != null && (!Number.isFinite(entry.deletedAt) || entry.deletedAt > Date.now())) throw new Error('Data de exclusão inválida.');
        rows.push({ ...store.metadata(entry), id: crypto.randomUUID(), created: entry.created, favorite: entry.favorite, kind: entry.kind, deletedAt: entry.deletedAt || null, blob: file.slice(offset, offset + entry.size, entry.type) });
        rows[rows.length - 1].albumIds = (rows[rows.length - 1].albumIds || []).map(id => albumMap.get(id)).filter(Boolean);
        offset += entry.size;
      }
      if (offset !== file.size) throw new Error('O tamanho do backup não corresponde aos arquivos declarados.');
      const active = rows.filter((item) => item.favorite || !item.deletedAt || item.deletedAt > Date.now() - store.retention);
      for (let index = 0; index < active.length; index++) {
        $('backup-status').textContent = `Validando e preparando ${index + 1}/${active.length}…`;
        Object.assign(active[index], await store.prepare(active[index].blob, active[index].kind));
        if (active[index].kind === 'photo' && !active[index].width) throw new Error('Uma foto do backup não pôde ser decodificada. Nenhum item foi importado.');
      }
      await store.importMany(active, importedAlbums);
      await collection?.refreshAlbums();
      for (const item of active) state.media.push({ ...store.metadata(item), saved: true });
      state.media.sort((a, b) => b.created - a.created); gallery.limit = 36;
      renderGallery(); updateThumbnail();
      $('backup-status').textContent = `${active.length} captura(s) restaurada(s), com favoritos. Sua coleção anterior foi preservada.${rows.length > active.length ? ' Itens com lixeira vencida foram ignorados.' : ''}`;
    } catch (error) { $('backup-status').textContent = `Importação cancelada: ${error.message}`; }
    finally { setGalleryBusy(false); $('backup-export').disabled = false; $('backup-file').disabled = false; $('backup-file').value = ''; }
  }

  function updateCameraInfo() {
    const track = state.stream?.getVideoTracks()[0], actual = focusSettings(track), caps = focusCapabilities(track);
    const format = Number(settings.resolution);
    $('actual-resolution').textContent = track ? `Solicitado: ${format === 2160 ? '4K' : format + 'p'}. Sensor: ${actual.width || video.videoWidth} × ${actual.height || video.videoHeight}. Captura: ${canvas.width} × ${canvas.height} px (recorte e zoom digitais).` : 'Ative a câmera para consultar a resolução efetiva.';
    const recording = !!window.MediaRecorder && typeof canvas.captureStream === 'function';
    const mic = !!navigator.mediaDevices?.getUserMedia;
    const audio = !mic ? 'API indisponível' : state.recorder ? state.recordingAudioProblem || (state.recordingHasAudio ? 'ativo nesta gravação' : 'vídeo sem áudio') : !settings.audio ? 'desativado' : state.audioStatus || (state.microphoneAvailable === false ? 'não detectado; confirme as permissões do sistema' : 'opcional; permissão solicitada ao gravar');
    const modes = focusModes(track), support = track ? focusSupport(track) : null;
    const auto = modes.some((mode) => ['continuous', 'single-shot'].includes(mode) && !support?.rejectedModes.has(mode));
    const focus = state.focusLocked ? 'travado' : auto ? support?.lockUnavailable ? 'automático; bloqueio não disponível' : 'automático; toque ou segure para travar' : modes.includes('manual') && caps.focusDistance && !support?.manualRejected ? 'manual disponível no modo PRO' : 'ajuste padrão da câmera; toque disponível para iluminação';
    $('camera-capabilities').textContent = `Vídeo: ${recording ? 'disponível' : 'indisponível'}. Microfone: ${audio}. Foco: ${focus}. Lanterna: ${caps.torch ? 'suportada' : 'não suportada'}. Filtros digitais: ${'filter' in ctx ? 'suportados' : 'não suportados'}. Zoom, brilho e cor são digitais.`;
  }

  function syncUI() {
    const recording = !!state.recorder;
    const locked = state.busy || state.opening || state.countdown !== null || recording;
    const filter = $('settings-form').elements.namedItem('filter');
    $('filters-open').disabled = locked || filter.disabled;
    $('filters-open').classList.toggle('has-filter', settings.filter !== 'none');
    $('filters-open').setAttribute('aria-label', `Filtros: ${filter.selectedOptions[0]?.textContent || 'Nenhum'}`);
    $('filter-current').textContent = filter.selectedOptions[0]?.textContent || 'Nenhum';
    $('filter-description').textContent = looks.get(settings.filter).description;
    const intensity = $('filter-intensity'); intensity.disabled = locked || filter.disabled || settings.filter === 'none';
    $('editor-filter-intensity').disabled = !('filter' in ctx) || $('editor-filter').value === 'none';
    filter.parentElement.querySelectorAll('[data-option]').forEach((button) => { button.disabled = locked || filter.disabled; });
    if (locked) setFiltersOpen(false);
    $('shutter').disabled = state.busy || state.opening || !state.ready;
    $('shutter').classList.toggle('video', state.mode === 'video');
    $('shutter').classList.toggle('recording', recording);
    $('shutter').classList.toggle('counting', state.countdown !== null);
    $('shutter').setAttribute('aria-label', recording ? 'Parar gravação' : state.countdown !== null ? 'Cancelar temporizador' : state.mode === 'video' ? 'Iniciar gravação' : 'Tirar foto');
    $('switch').disabled = locked || state.cameras.length < 2;
    $('lens').disabled = locked;
    $('lens-buttons').querySelectorAll('button').forEach((button) => {
      button.disabled = locked;
      button.setAttribute('aria-pressed', String(button.dataset.device === state.device));
    });
    $('settings-open').disabled = locked;
    $('settings-form').elements.microphone.disabled = locked;
    $('timer').disabled = state.busy || state.opening || recording || state.mode === 'video';
    $('torch').disabled = !state.ready || locked || !focusCapabilities(state.stream?.getVideoTracks()[0]).torch;
    $('torch').setAttribute('aria-label', $('torch').disabled ? 'Lanterna indisponível durante esta operação' : `Lanterna ${state.torch ? 'ligada' : 'desligada'}`);
    $('torch').setAttribute('aria-pressed', String(state.torch));
    $('torch').querySelector('span').textContent = state.torch ? 'ON' : 'OFF';
    $('timer').querySelector('span').textContent = state.timer ? `${state.timer}s` : 'OFF';
    $('timer').classList.toggle('active', state.timer > 0);
    $('timer').setAttribute('aria-label', `Temporizador: ${state.timer ? `${state.timer} segundos` : 'desligado'}`);
    $('grid').hidden = !settings.grid;
    $('grid').className = `grid ${settings.gridType === 'none' ? 'thirds' : settings.gridType}`;
    $('grid-toggle').setAttribute('aria-pressed', String(settings.grid));
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.disabled = locked;
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
    });
    $('pro-controls').hidden = state.mode !== 'pro';
    $('record-time').hidden = !recording;
    $('record-audio-state').hidden = state.mode !== 'video' && !recording;
    $('record-audio-state').textContent = recording ? state.recordingAudioProblem || (state.recordingHasAudio ? `Microfone gravando${state.audioInputName ? ` · ${state.audioInputName}` : ''}` : 'Vídeo sem microfone') : settings.audio ? 'Microfone ativado para a próxima gravação' : 'Microfone desligado · ative nas configurações para gravar som';
    $('record-audio-state').classList.toggle('audio-warning', (recording && !!state.recordingAudioProblem) || !settings.audio);
    $('mode-hint').textContent = { photo: 'Fotos salvas neste navegador', video: `Vídeo ${settings.audio ? 'com microfone' : 'sem áudio'} · filtros e zoom incluídos`, night: 'Noturno digital · brilho reforçado', portrait: 'Retrato digital · vinheta nas bordas', pro: 'PRO digital · brilho e cor, sem controle do sensor' }[state.mode];
    $('camera-message').hidden = state.ready;
    $('retry').disabled = false;
    iconLabel($('retry'), state.opening ? 'xmark' : 'camera', state.opening ? 'Cancelar abertura' : 'Ativar câmera');
    updateCameraInfo();
    cinema?.sync(locked);
    collection?.sync(locked);
    $('record-recovery-state').hidden = !recording;
    $('record-recovery-state').textContent = state.draftEnabled ? 'Trechos protegidos no armazenamento local' : 'Sem recuperação local · mantenha esta página aberta';
    window.MobileRanges?.refresh();
  }

  function stopTracks(stream) { stream?.getTracks().forEach((track) => track.stop()); }

  function focusCapabilities(track) {
    try { return track?.getCapabilities?.() || {}; } catch { return {}; }
  }

  function resetAutomaticIllumination() {
    clearTimeout(state.exposureTimer);
    state.exposureActive = false; state.exposureDragging = false;
    const control = document.querySelector('.exposure-control');
    control.hidden = true; control.classList.remove('at-focus');
    $('brightness').value = '1';
    $('brightness').dispatchEvent(new Event('input', { bubbles: true }));
  }

  function scheduleIlluminationHide() {
    clearTimeout(state.exposureTimer);
    if (!state.exposureActive || state.focusLocked || state.exposureDragging) return;
    state.exposureTimer = setTimeout(() => {
      if (state.focusLocked) return;
      if (state.isFocusing || state.exposureDragging) { scheduleIlluminationHide(); return; }
      resetAutomaticIllumination();
      $('focus-ring').hidden = true; $('focus-feedback').hidden = true;
    }, 5000);
  }

  function focusSettings(track) {
    try { return track?.getSettings?.() || {}; } catch { return {}; }
  }

  function focusModes(track) {
    const modes = focusCapabilities(track).focusMode;
    return Array.isArray(modes) ? modes.filter((mode) => typeof mode === 'string') : [];
  }

  function focusSupport(track) {
    if (!focusSupportByTrack.has(track)) focusSupportByTrack.set(track, { rejectedModes: new Set(), pointRejected: false, manualRejected: false, lockUnavailable: false, noticeShown: false, lockNoticeShown: false });
    return focusSupportByTrack.get(track);
  }

  function isFocusUnsupported(error) {
    return ['NotSupportedError', 'OverconstrainedError', 'TypeError'].includes(error?.name);
  }

  function focusFallback(track, lockOnly = false) {
    const support = focusSupport(track), key = lockOnly ? 'lockNoticeShown' : 'noticeShown';
    $('focus-ring').hidden = true;
    if (!state.focusLocked) $('focus-unlock').hidden = true;
    if (!support[key]) {
      support[key] = true;
      focusFeedback(lockOnly ? 'A iluminação pode ser ajustada; o foco automático continua ativo.' : 'Ajuste a iluminação pelo controle lateral. O foco usa o ajuste padrão da câmera.', 'info', false);
    } else {
      clearTimeout(state.focusFeedbackTimer); $('focus-feedback').hidden = true;
    }
    updateCameraInfo();
  }

  async function requestAutoFocus(track, point, signal, preferContinuous = false) {
    const support = focusSupport(track), modes = focusModes(track);
    let pointsSupported = false;
    try { pointsSupported = !!navigator.mediaDevices.getSupportedConstraints?.().pointsOfInterest; } catch { /* Point selection is optional. */ }
    for (const mode of preferContinuous ? ['continuous', 'single-shot'] : ['single-shot', 'continuous']) {
      if (!modes.includes(mode) || support.rejectedModes.has(mode)) continue;
      if (point && pointsSupported && !support.pointRejected) {
        try {
          await cameraStep(track.applyConstraints({ advanced: [{ focusMode: mode, pointsOfInterest: [point] }] }), signal, 3000, 'A câmera não respondeu ao foco.');
          return mode;
        } catch (error) {
          if (signal.aborted || !isFocusUnsupported(error)) throw error;
          support.pointRejected = true;
        }
      }
      try {
        await cameraStep(track.applyConstraints({ advanced: [{ focusMode: mode }] }), signal, 3000, 'A câmera não respondeu ao foco.');
        return mode;
      } catch (error) {
        if (signal.aborted || !isFocusUnsupported(error)) throw error;
        support.rejectedModes.add(mode);
      }
    }
    return null;
  }

  async function initializeFocus(track, signal) {
    state.focusToken = (state.focusToken || 0) + 1; state.focusAbort?.abort(); state.focusLocked = false; state.isFocusing = false;
    clearTimeout(state.focusFeedbackTimer);
    $('focus-ring').hidden = true; $('focus-feedback').hidden = true; $('focus-unlock').hidden = true;
    resetAutomaticIllumination();
    const caps = focusCapabilities(track), modes = focusModes(track), distance = caps.focusDistance;
    const manual = modes.includes('manual') && Number.isFinite(distance?.min) && Number.isFinite(distance?.max) && distance.max > distance.min;
    $('manual-focus-row').hidden = !manual;
    if (manual) {
      const input = $('focus-distance'); input.min = distance.min; input.max = distance.max;
      input.step = distance.step > 0 ? distance.step : (distance.max - distance.min) / 100;
      input.value = focusSettings(track).focusDistance ?? (distance.min + distance.max) / 2;
    }
    if (modes.includes('continuous')) {
      try { await cameraStep(track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }), signal, 2000, 'Foco automático indisponível.'); }
      catch (error) { if (isFocusUnsupported(error)) focusSupport(track).rejectedModes.add('continuous'); }
    }
    window.MobileRanges?.refresh();
  }

  function focusFeedback(message, kind = 'pending', locked = state.focusLocked) {
    clearTimeout(state.noticeTimer); $('notice').hidden = true;
    $('focus-feedback').hidden = false; $('focus-status').textContent = message;
    $('focus-feedback').dataset.state = kind;
    $('focus-ring').dataset.state = kind; $('focus-unlock').hidden = !locked;
    if (locked) {
      clearTimeout(state.exposureTimer); state.exposureActive = true;
      document.querySelector('.exposure-control').hidden = false;
    } else scheduleIlluminationHide();
    if (kind === 'unavailable' || kind === 'info') $('focus-ring').hidden = true;
    clearTimeout(state.focusFeedbackTimer);
    if (!locked) state.focusFeedbackTimer = setTimeout(() => { $('focus-ring').hidden = true; $('focus-feedback').hidden = true; }, kind === 'info' ? 2500 : 4500);
    updateCameraInfo();
  }

  function positionFocus(clientX, clientY) {
    const stage = $('stage').getBoundingClientRect(), app = document.querySelector('.camera-app').getBoundingClientRect();
    const x = Math.max(28, Math.min(stage.width - 28, clientX - stage.left)), y = Math.max(28, Math.min(stage.height - 28, clientY - stage.top));
    $('focus-ring').hidden = false; $('focus-ring').style.left = `${x}px`; $('focus-ring').style.top = `${y}px`;
    const exposure = document.querySelector('.exposure-control'); exposure.hidden = false; exposure.classList.add('at-focus'); state.exposureActive = true;
    const controls = document.querySelector('.bottom-controls').getBoundingClientRect();
    const size = exposure.getBoundingClientRect();
    const maxX = controls.width < app.width * .65 ? controls.left - app.left - size.width - 10 : app.width - size.width - 8;
    const maxY = controls.width >= app.width * .65 ? controls.top - app.top - size.height - 10 : app.height - size.height - 10;
    exposure.style.setProperty('--focus-control-x', `${Math.max(0, Math.min(maxX, stage.left - app.left + x + 40))}px`);
    exposure.style.setProperty('--focus-control-y', `${Math.max(90, Math.min(maxY, stage.top - app.top + y - 90))}px`);
    // Map through object-fit:contain, the preview crop, digital zoom and front mirror.
    const vw = video.videoWidth, vh = video.videoHeight;
    const fit = Math.min(stage.width / canvas.width, stage.height / canvas.height);
    const width = canvas.width * fit, height = canvas.height * fit;
    let px = (clientX - stage.left - (stage.width - width) / 2) / width;
    const py = (clientY - stage.top - (stage.height - height) / 2) / height;
    if (px < 0 || px > 1 || py < 0 || py > 1 || !vw || !vh) { $('focus-ring').hidden = true; resetAutomaticIllumination(); return null; }
    if (state.facing === 'user') px = 1 - px;
    const ratio = canvas.width / canvas.height;
    let sw = vw, sh = vh; if (vw / vh > ratio) sw = vh * ratio; else sh = vw / ratio;
    sw /= state.zoom; sh /= state.zoom;
    return { x: ((vw - sw) / 2 + px * sw) / vw, y: ((vh - sh) / 2 + py * sh) / vh };
  }

  async function focusAt(clientX, clientY, lock = false) {
    const track = state.stream?.getVideoTracks()[0];
    if (!state.ready || state.opening || !track || state.isFocusing) return;
    if (state.focusLocked && !lock) { focusFeedback('Foco travado. Ajuste a iluminação ou toque em Desbloquear.', 'locked'); return; }
    const point = positionFocus(clientX, clientY);
    if (!point) return;
    // Every new focus point starts with neutral illumination, including fallback mode.
    $('brightness').value = '1';
    $('brightness').dispatchEvent(new Event('input', { bubbles: true }));
    const caps = focusCapabilities(track), modes = focusModes(track), support = focusSupport(track);
    const auto = ['single-shot', 'continuous'].some((mode) => modes.includes(mode) && !support.rejectedModes.has(mode));
    if (!auto || typeof track.applyConstraints !== 'function') { focusFallback(track); return; }
    if (lock && support.lockUnavailable) { focusFallback(track, true); return; }
    state.isFocusing = true; state.focusLocked = false;
    const token = state.focusToken, controller = new AbortController(); state.focusAbort = controller;
    const current = () => state.stream?.getVideoTracks()[0] === track && token === state.focusToken && !state.disposed;
    focusFeedback(lock ? 'Ajustando para travar o foco…' : 'Ajustando foco…');
    try {
      const mode = await requestAutoFocus(track, point, controller.signal);
      if (!current()) return;
      if (!mode) { focusFallback(track); return; }
      if (lock) {
        // The web API has no "lens is sharp" event; do not infer optical success.
        await cameraStep(new Promise((resolve) => setTimeout(resolve, 400)), controller.signal, 1000, 'Foco interrompido.');
        const distance = focusSettings(track).focusDistance;
        if (modes.includes('manual') && Number.isFinite(distance) && caps.focusDistance && !support.manualRejected) {
          try { await cameraStep(track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: distance }] }), controller.signal, 3000, 'Não foi possível travar o foco.'); }
          catch (error) {
            if (controller.signal.aborted || !isFocusUnsupported(error)) throw error;
            support.manualRejected = true; $('manual-focus-row').hidden = true;
          }
        }
        if (!current()) return;
        const actual = focusSettings(track);
        state.focusLocked = actual.focusMode === 'manual' || actual.focusMode === 'single-shot';
        if (state.focusLocked) focusFeedback('Foco travado · ajuste a iluminação no controle lateral', 'locked', true);
        else { support.lockUnavailable = true; focusFallback(track, true); }
      } else focusFeedback('Foco automático solicitado · segure para travar', 'applied', false);
    } catch { if (current()) focusFeedback('O ajuste de foco não respondeu. A câmera e a iluminação continuam disponíveis.', 'info', state.focusLocked); }
    finally { if (current()) { state.isFocusing = false; state.focusAbort = null; } }
  }

  async function unlockFocus() {
    const track = state.stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      const mode = await requestAutoFocus(track, null, new AbortController().signal, true);
      if (state.stream?.getVideoTracks()[0] !== track) return;
      if (!mode) { focusFeedback('O dispositivo mantém o foco atual. Troque de câmera para restaurar o padrão.', 'locked', state.focusLocked); return; }
      state.focusLocked = false; resetAutomaticIllumination(); focusFeedback('Foco automático reativado.', 'applied', false);
    } catch { if (state.stream?.getVideoTracks()[0] === track) focusFeedback('Não foi possível desbloquear. Tente novamente.', 'locked'); }
  }

  // Permission and playback promises can remain pending indefinitely in browsers.
  // Keep cancellation responsive, and stop a stream even if permission arrives late.
  function cameraStep(promise, signal, milliseconds, message, onLateResult) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (callback, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        callback(result);
      };
      const cancel = () => finish(reject, new DOMException('Abertura cancelada.', 'AbortError'));
      Promise.resolve(promise).then((result) => {
        if (settled) { onLateResult?.(result); return; }
        finish(resolve, result);
      }, (error) => finish(reject, error));
      if (signal.aborted) { cancel(); return; }
      signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => finish(reject, new Error(message)), milliseconds);
    });
  }

  function cancelCameraOpening() {
    state.request++;
    state.cameraAbort?.abort();
    state.opening = false;
    state.ready = false;
    resetAutomaticIllumination();
    stopTracks(state.stream);
    state.stream = null;
    video.pause();
    video.srcObject = null;
    $('camera-status').textContent = 'Abertura cancelada. Você pode ativar a câmera novamente.';
    syncUI();
  }

  // Querying permission does not request it. Only resume automatically when
  // the browser confirms a current grant; never infer consent from localStorage.
  async function startAuthorizedCamera() {
    const request = state.request;
    const idle = () => request === state.request && !state.ready && !state.opening && !state.busy && !state.recorder && state.countdown === null && !state.disposed && !document.hidden;
    if (!idle()) return;
    const hint = permission => {
      if (!idle()) return;
      $('camera-status').textContent = permission === 'denied'
        ? 'A câmera está bloqueada. Nas permissões deste site no navegador, altere Câmera para Permitir e tente novamente.'
        : 'Ative a câmera para começar. A autorização é gerenciada pelo navegador.';
    };
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !navigator.permissions?.query) { hint('unknown'); return; }
    let timeout;
    try {
      const status = await Promise.race([
        navigator.permissions.query({ name: 'camera' }),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Permission query timed out')), 1500); })
      ]);
      if (state.disposed || request !== state.request) return;
      cameraPermissionStatus?.removeEventListener?.('change', cameraPermissionChange);
      cameraPermissionStatus = status;
      state.cameraPermission = status.state;
      cameraPermissionChange = () => {
        state.cameraPermission = status.state;
        if (!idle()) return;
        if (status.state === 'granted') openCamera(); else hint(status.state);
      };
      status.addEventListener?.('change', cameraPermissionChange);
      if (idle() && status.state === 'granted') openCamera(); else hint(status.state);
    } catch { hint('unknown'); }
    finally { clearTimeout(timeout); }
  }

  async function openCamera(device = '') {
    if (state.opening || state.busy || state.recorder || state.countdown !== null || state.disposed) return;
    const token = ++state.request;
    state.cameraAbort?.abort();
    const controller = new AbortController();
    state.cameraAbort = controller;
    state.opening = true;
    state.ready = false;
    state.torch = false;
    resetAutomaticIllumination();
    stopTracks(state.stream);
    state.stream = null;
    video.srcObject = null;
    $('camera-status').textContent = state.cameraPermission === 'granted' ? 'Iniciando a câmera…' : 'Abrindo a câmera. Se o navegador solicitar acesso, escolha Permitir. Quando disponível, permita o acesso contínuo para este site.';
    syncUI();
    let stream;
    try {
      if (!window.isSecureContext) throw new Error('Abra por HTTPS ou localhost para permitir acesso à câmera.');
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não oferece acesso à câmera.');
      const policy = document.permissionsPolicy || document.featurePolicy;
      if (policy?.allowsFeature && !policy.allowsFeature('camera')) throw new Error('Esta página está bloqueada para usar a câmera. Abra o site diretamente em outra aba, fora da prévia incorporada.');
      const height = Number(settings.resolution);
      stream = await cameraStep(
        navigator.mediaDevices.getUserMedia({ video: { ...(device ? { deviceId: { exact: device } } : { facingMode: { ideal: state.facing } }), width: { ideal: Math.round(height * 16 / 9) }, height: { ideal: height }, frameRate: { ideal: Number(cinema?.options.fps) || 30 } }, audio: false }),
        controller.signal, 20000,
        'O navegador não respondeu ao pedido de câmera. Verifique a permissão no ícone ao lado do endereço e tente novamente. Se estiver em uma prévia incorporada, abra o site diretamente em outra aba.',
        stopTracks
      );
      if (token !== state.request || state.disposed) { stopTracks(stream); return; }
      state.stream = stream;
      $('camera-status').textContent = 'Câmera autorizada. Iniciando a imagem…';
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await cameraStep(video.play(), controller.signal, 10000, 'A câmera foi autorizada, mas a imagem não iniciou. Feche outros aplicativos que usam a câmera e tente novamente.');
      if (token !== state.request || state.disposed) { stopTracks(stream); return; }
      const track = stream.getVideoTracks()[0];
      await initializeFocus(track, controller.signal);
      if (token !== state.request || state.disposed) { stopTracks(stream); return; }
      const actual = track.getSettings();
      state.facing = actual.facingMode || state.facing;
      state.device = actual.deviceId || device;
      state.zoom = 1;
      $('zoom').value = '1';
      updateZoom();
      state.ready = true;
      state.cameraPermission = 'granted';
      $('actual-resolution').textContent = `Sensor: ${actual.width || video.videoWidth} × ${actual.height || video.videoHeight}. A captura usa o recorte visível e zoom digital.`;
      track.addEventListener('ended', () => {
        if (state.stream !== stream || state.disposed) return;
        state.ready = false;
        resetAutomaticIllumination();
        cancelCountdown();
        stopRecording();
        $('camera-status').textContent = 'A câmera foi desconectada. Tente ativá-la novamente.';
        syncUI();
      });
      // Enumeration is optional; it must never block the shutter or hide a working preview.
      detectCameras();
    } catch (error) {
      stopTracks(stream);
      if (token !== state.request || state.disposed) return;
      video.pause();
      video.srcObject = null;
      state.stream = null;
      state.ready = false;
      const messages = { NotAllowedError: 'Acesso negado. Permita a câmera no ícone ao lado do endereço e nas permissões do sistema. Se estiver em uma prévia incorporada, abra o site diretamente em outra aba.', NotFoundError: 'Nenhuma câmera encontrada.', NotReadableError: 'Não foi possível abrir a câmera. Verifique se outro aplicativo está usando o dispositivo.', OverconstrainedError: 'Esta câmera ou resolução não está disponível. Selecione outra opção.', AbortError: 'A abertura da câmera foi interrompida. Tente novamente.' };
      $('camera-status').textContent = messages[error.name] || error.message;
    } finally {
      if (token === state.request && !state.disposed) { state.cameraAbort = null; state.opening = false; syncUI(); }
    }
  }

  async function detectCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (state.disposed) return;
      state.cameras = devices.filter((device) => device.kind === 'videoinput');
      state.microphoneAvailable = devices.some((device) => device.kind === 'audioinput');
      const microphones = devices.filter(device => device.kind === 'audioinput' && device.deviceId && device.deviceId !== 'default');
      const input = $('settings-form').elements.microphone;
      input.replaceChildren(new Option('Padrão do sistema', 'default'), ...microphones.map((device, index) => new Option(device.label || `Microfone ${index + 1}`, device.deviceId)));
      if (settings.microphone !== 'default' && !microphones.some(device => device.deviceId === settings.microphone)) input.add(new Option('Microfone salvo (indisponível)', settings.microphone));
      input.value = settings.microphone;
      $('lens').replaceChildren(...state.cameras.map((device, index) => new Option(device.label || `Câmera ${index + 1}`, device.deviceId)));
      $('lens').value = state.device;
      $('lens-buttons').replaceChildren(...state.cameras.map((device, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `1× (${index + 1})`;
        button.title = device.label || `Câmera ${index + 1}`;
        button.setAttribute('aria-label', button.title);
        button.dataset.device = device.deviceId;
        button.addEventListener('click', () => openCamera(device.deviceId));
        return button;
      }));
      $('lens-label').hidden = state.cameras.length < 2;
      syncUI();
    } catch { /* Camera preview can work even when enumeration is unavailable. */ }
  }

  function updateZoom() {
    $('zoom-value').textContent = `${Number(state.zoom.toFixed(1))}×`;
    document.querySelectorAll('[data-zoom]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.zoom) === state.zoom)));
    window.MobileRanges?.refresh();
  }

  function filterCSS(includeLook = true) {
    let effect = includeLook ? looks.compose(settings.filter, settings.filterIntensity) : '';
    if (state.mode === 'night') effect += ' brightness(1.42) contrast(.85) saturate(.72)';
    if (state.mode === 'portrait') effect += ' contrast(1.07) saturate(1.22) brightness(1.03)';
    if (state.mode === 'pro') {
      const ev = Number($('exposure').value);
      const wb = Number($('temperature').value);
      effect += ` brightness(${1 + ev * .25})`;
      if (wb < 5500) effect += ` sepia(${(5500 - wb) / 3500 * .45})`;
      if (wb > 5500) effect += ` hue-rotate(${-(wb - 5500) / 2500 * 20}deg)`;
    }
    effect += ` brightness(${$('brightness').value})`;
    return effect.trim() || 'none';
  }

  // A second canvas omits the creative look when monitoring-only is selected.
  function drawFrame(target = canvas, includeLook = true) {
    const ctx = target.getContext('2d', { alpha: false });
    if (!state.ready || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const rect = $('stage').getBoundingClientRect();
    const ratio = state.recorder ? canvas.width / canvas.height : rect.width / rect.height;
    const vw = video.videoWidth, vh = video.videoHeight;
    let sw = vw, sh = vh;
    if (vw / vh > ratio) sw = vh * ratio;
    else sh = vw / ratio;
    if (!state.recorder) {
      const w = Math.max(2, Math.floor(sw / 2) * 2), h = Math.max(2, Math.floor(sh / 2) * 2);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }
    sw /= state.zoom;
    sh /= state.zoom;
    if (target !== canvas) { if (target.width !== canvas.width) target.width = canvas.width; if (target.height !== canvas.height) target.height = canvas.height; }
    ctx.save();
    if (state.facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
    ctx.filter = filterCSS(includeLook);
    ctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (state.mode === 'portrait') {
      const radius = Math.max(canvas.width, canvas.height) * .7;
      const gradient = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, radius * .25, canvas.width / 2, canvas.height / 2, radius);
      gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, 'rgba(0,0,0,.48)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  function renderLoop(time) {
    if (state.disposed) return;
    if (!document.hidden && (!$('gallery-dialog').open || state.recorder) && time - state.lastFrame >= 1000 / (Number(cinema?.options.fps) || 30) - 1) {
      drawFrame();
      if (state.recorder && cinema?.options.previewOnly) drawFrame(recordingCanvas, false);
      if (state.ready) cinema?.frame(canvas, time);
      state.lastFrame = time;
    }
    state.frame = requestAnimationFrame(renderLoop);
  }

  function cancelCountdown() {
    if (state.countdown) clearInterval(state.countdown);
    state.countdown = null;
    $('countdown').textContent = '';
    syncUI();
  }

  async function takePhoto() {
    if (!state.ready || state.busy || state.recorder) return;
    state.busy = true;
    syncUI();
    try {
      if (video.readyState < 2) throw new Error('A câmera ainda está carregando. Tente novamente.');
      drawFrame();
      const target = cinema?.options.previewOnly ? recordingCanvas : canvas;
      if (target !== canvas) drawFrame(target, false);
      const captureInfo = cinema?.slate();
      const blob = await new Promise((resolve) => target.toBlob(resolve, settings.format, Number(settings.quality)));
      await addMedia(blob, 'photo', captureInfo);
      $('flash').hidden = false;
      setTimeout(() => { $('flash').hidden = true; }, 260);
    } catch (error) { notice(`Não foi possível capturar: ${error.message}`); }
    finally { state.busy = false; syncUI(); }
  }

  function capture() {
    if (state.recorder) { stopRecording(); return; }
    if (state.countdown !== null) { cancelCountdown(); return; }
    if (!state.ready || state.busy || state.opening) return;
    if (state.mode === 'video') { startRecording(); return; }
    if (!state.timer) { takePhoto(); return; }
    let seconds = state.timer;
    $('countdown').textContent = String(seconds);
    state.countdown = setInterval(() => {
      seconds--;
      $('countdown').textContent = String(seconds);
      if (seconds <= 0) { cancelCountdown(); takePhoto(); }
    }, 1000);
    syncUI();
  }

  async function startRecording() {
    if (state.busy || state.recorder || !state.ready) return;
    state.busy = true;
    syncUI();
    let microphone, output, draft, heartbeat;
    let pendingChunks = Promise.resolve(), chunkIndex = 0;
    state.draftEnabled = false;
    state.recordingHasAudio = false; state.recordingAudioProblem = ''; state.audioSignalNotice = false; state.audioSignalLast = performance.now();
    try {
      if (!window.MediaRecorder || !canvas.captureStream) throw new Error('Gravação não suportada neste navegador.');
      if (settings.audio) {
        state.audioStatus = 'aguardando permissão'; syncUI();
        state.recordAbort = new AbortController();
        microphone = await cameraStep(navigator.mediaDevices.getUserMedia({ audio: { ...(settings.microphone !== 'default' ? { deviceId: { exact: settings.microphone } } : {}), channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }), state.recordAbort.signal, 20000, 'O microfone não respondeu. Verifique as permissões ou desative o áudio.', stopTracks);
        state.audioStatus = 'autorizado'; state.recordAbort = null;
      }
      const audioTrack = microphone?.getAudioTracks().find(track => track.readyState === 'live');
      if (settings.audio && !audioTrack) throw new Error('O navegador não forneceu uma faixa de áudio. Confira a permissão e o acesso ao microfone nas configurações do Android.');
      if (audioTrack) audioTrack.enabled = true;
      state.audioInputName = audioTrack?.label || '';
      if (audioTrack) detectCameras();
      if (state.disposed || !state.ready) { stopTracks(microphone); return; }
      drawFrame();
      const target = cinema?.options.previewOnly ? recordingCanvas : canvas;
      if (target !== canvas) drawFrame(target, false);
      output = target.captureStream(Number(cinema?.options.fps) || 30);
      if (audioTrack) output.addTrack(audioTrack);
      const types = audioTrack
        ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
        : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp8', 'video/webm'];
      let recorder, lastError;
      for (const mimeType of [...types.filter(type => MediaRecorder.isTypeSupported(type)), null]) {
        try { recorder = new MediaRecorder(output, { ...(mimeType ? { mimeType } : {}), ...(audioTrack ? { audioBitsPerSecond: 128000 } : {}) }); break; }
        catch (error) { lastError = error; }
      }
      if (!recorder) throw lastError || new Error('Não há um formato de gravação compatível.');
      if (settings.audio && !recorder.stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled)) throw new Error('Não foi possível incluir o microfone na gravação.');
      const chunks = [];
      const captureInfo = cinema?.slate();
      captureInfo.hasAudio = !!audioTrack;
      try {
        draft = await store.createRecording(captureInfo, recorder.mimeType || 'video/webm');
        captureInfo.recordingId = draft.id; captureInfo.created = draft.created; state.draftEnabled = true;
        heartbeat = setInterval(() => { pendingChunks = pendingChunks.then(() => store.touchRecording(draft.id)).catch(() => {}); }, 5000);
      } catch { notice('Não foi possível ativar a recuperação local. A gravação continuará na memória.'); }
      state.recordBytes = 0; state.recordStarted = performance.now();
      await cinema?.startAudio(microphone);
      if (state.disposed || !state.ready) { stopTracks(output); stopTracks(microphone); await cinema?.stopAudio(); clearInterval(heartbeat); if (draft) { await store.touchRecording(draft.id, 'interrupted'); store.releaseRecording(draft.id); await store.discardRecording(draft.id); } return; }
      let failed = false;
      recorder.ondataavailable = (event) => { if (event.data.size) {
        chunks.push(event.data); state.recordBytes += event.data.size;
        if (draft && state.draftEnabled) {
          const index = chunkIndex++;
          pendingChunks = pendingChunks.then(() => store.appendRecording(draft.id, index, event.data)).catch(() => {
            state.draftEnabled = false; syncUI(); notice('Falha ao guardar um trecho de recuperação. Pare e baixe o vídeo antes de fechar a página.');
          });
        }
      } };
      recorder.onerror = () => { failed = true; notice('A gravação foi interrompida. Tentaremos salvar os dados recebidos.'); stopRecording(); };
      recorder.onstop = async () => {
        clearInterval(state.recordTimer);
        clearInterval(heartbeat);
        stopTracks(output);
        stopTracks(microphone);
        cinema?.stopAudio();
        state.recorder = null;
        state.recordingAudioTrack = null;
        state.busy = true;
        syncUI();
        try {
          await pendingChunks;
          if (draft) await store.touchRecording(draft.id, 'finalizing').catch(() => {});
          if (chunks.length) await addMedia(new Blob(chunks, { type: recorder.mimeType || chunks[0].type || 'video/webm' }), 'video', captureInfo);
          else if (!state.disposed && !failed) notice('O vídeo ficou vazio. Tente gravar por mais tempo.');
          if (draft && !chunks.length) { store.releaseRecording(draft.id); await store.discardRecording(draft.id).catch(() => {}); }
        } catch (error) { notice(`Não foi possível salvar o vídeo: ${error.message}`); }
        finally { if (draft) { await store.touchRecording(draft.id, 'interrupted').catch(() => {}); store.releaseRecording(draft.id); } state.busy = false; syncUI(); }
      };
      if (settings.audio && (audioTrack.readyState !== 'live' || !audioTrack.enabled)) throw new Error('O microfone foi interrompido antes de iniciar a gravação.');
      recorder.start(1000);
      state.recorder = recorder;
      state.audioSignalLast = performance.now();
      state.recordingHasAudio = !!audioTrack;
      state.recordingAudioTrack = audioTrack;
      const inputChanged = () => {
        if (state.recorder !== recorder) return;
        state.recordingAudioProblem = audioTrack.readyState !== 'live' ? 'Microfone interrompido · o vídeo continua sem novo áudio' : audioTrack.muted || !audioTrack.enabled ? 'Microfone sem sinal · confira o acesso ao microfone no Android' : '';
        if (state.recordingAudioProblem) notice(state.recordingAudioProblem);
        syncUI();
      };
      if (audioTrack) { for (const event of ['mute', 'unmute', 'ended']) audioTrack.addEventListener(event, inputChanged); inputChanged(); }
      const started = performance.now();
      iconLabel($('record-time'), 'circle', '00:00');
      state.recordTimer = setInterval(() => {
        const seconds = Math.floor((performance.now() - started) / 1000);
        iconLabel($('record-time'), 'circle', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
      }, 1000);
    } catch (error) {
      clearInterval(heartbeat);
      if (draft) { await pendingChunks; await store.touchRecording(draft.id, 'interrupted').catch(() => {}); store.releaseRecording(draft.id); await store.discardRecording(draft.id).catch(() => {}); }
      stopTracks(output); stopTracks(microphone);
      state.recordingAudioTrack = null;
      cinema?.stopAudio();
      if (settings.audio) state.audioStatus = error.name === 'NotAllowedError' ? 'permissão negada' : 'falha ao iniciar; verifique dispositivo e permissões';
      notice(error.name === 'NotAllowedError' ? 'Permita o microfone no Chrome e confira o acesso ao microfone nas configurações do Android.' : ['NotFoundError', 'OverconstrainedError'].includes(error.name) && settings.audio ? 'O microfone selecionado não está disponível. Escolha Padrão do sistema ou outra entrada em Configurações → Vídeo.' : `Não foi possível gravar: ${error.message}`);
    } finally { state.busy = false; syncUI(); }
  }

  function stopRecording() {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.busy = true;
      state.recorder.stop();
      syncUI();
    }
  }

  $('retry').addEventListener('click', () => state.opening ? cancelCameraOpening() : openCamera(state.device));
  $('shutter').addEventListener('click', capture);
  $('timer').addEventListener('click', () => {
    if (state.countdown !== null) cancelCountdown();
    state.timer = TIMER_DELAYS[(TIMER_DELAYS.indexOf(state.timer) + 1) % TIMER_DELAYS.length];
    syncUI();
  });
  $('switch').addEventListener('click', () => { state.facing = state.facing === 'user' ? 'environment' : 'user'; openCamera(); });
  $('lens').addEventListener('change', () => openCamera($('lens').value));
  $('grid-toggle').addEventListener('click', () => {
    settings.grid = !settings.grid;
    if (settings.grid && settings.gridType === 'none') settings.gridType = 'thirds';
    const input = $('settings-form').elements.namedItem('gridType');
    input.value = settings.grid ? settings.gridType : 'none';
    updateOptionButtons(input);
    saveSettings(); syncUI();
  });
  $('torch').addEventListener('click', async () => {
    const track = state.stream?.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ torch: !state.torch }] }); state.torch = !state.torch; syncUI(); }
    catch { notice('Este dispositivo não permitiu controlar a lanterna.'); }
  });
  $('zoom').addEventListener('input', () => { state.zoom = Number($('zoom').value); updateZoom(); });
  $('zoom-toggle').addEventListener('click', () => {
    setFiltersOpen(false);
    $('zoom-slider').hidden = !$('zoom-slider').hidden;
    $('zoom-toggle').setAttribute('aria-expanded', String(!$('zoom-slider').hidden));
  });
  document.querySelectorAll('[data-zoom]').forEach((button) => button.addEventListener('click', () => { state.zoom = Number(button.dataset.zoom); $('zoom').value = String(state.zoom); updateZoom(); }));
  const pointers = new Map();
  let pinch = null;
  let cameraTap = null, focusHoldTimer;
  $('stage').addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    $('stage').setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      cameraTap = { x: event.clientX, y: event.clientY, held: false };
      clearTimeout(focusHoldTimer);
      focusHoldTimer = setTimeout(() => { if (cameraTap) { cameraTap.held = true; focusAt(cameraTap.x, cameraTap.y, true); } }, 550);
    }
    if (pointers.size === 2) {
      clearTimeout(focusHoldTimer); cameraTap = null;
      const [a, b] = [...pointers.values()];
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: state.zoom };
    }
  });
  $('stage').addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (cameraTap && Math.hypot(event.clientX - cameraTap.x, event.clientY - cameraTap.y) > 12) { clearTimeout(focusHoldTimer); cameraTap = null; }
    if (pointers.size !== 2 || !pinch?.distance) return;
    const [a, b] = [...pointers.values()];
    state.zoom = Math.max(1, Math.min(8, pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance));
    $('zoom').value = String(state.zoom);
    updateZoom();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('stage').addEventListener(type, (event) => {
    if (type === 'pointerup' && pointers.size === 1 && cameraTap && !cameraTap.held) focusAt(cameraTap.x, cameraTap.y);
    clearTimeout(focusHoldTimer); cameraTap = null; pointers.delete(event.pointerId); pinch = null;
  });
  $('stage').addEventListener('contextmenu', (event) => event.preventDefault());
  $('focus-unlock').addEventListener('click', unlockFocus);
  $('brightness').addEventListener('input', scheduleIlluminationHide);
  $('brightness').addEventListener('pointerdown', () => { state.exposureDragging = true; clearTimeout(state.exposureTimer); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) $('brightness').addEventListener(type, () => { state.exposureDragging = false; scheduleIlluminationHide(); });
  let manualFocusTimer;
  $('focus-distance').addEventListener('input', () => {
    clearTimeout(manualFocusTimer);
    manualFocusTimer = setTimeout(async () => {
      const track = state.stream?.getVideoTracks()[0];
      if (!state.ready || !track || state.isFocusing || !focusModes(track).includes('manual') || focusSupport(track).manualRejected) return;
      const distance = Number($('focus-distance').value);
      try {
        await cameraStep(track.applyConstraints({ advanced: [{ focusMode: 'manual', focusDistance: distance }] }), new AbortController().signal, 3000, 'Foco manual indisponível.');
        if (state.stream?.getVideoTracks()[0] !== track) return;
        state.focusLocked = focusSettings(track).focusMode === 'manual';
        focusFeedback(state.focusLocked ? 'Foco manual travado · ajuste a iluminação livremente' : 'Ajuste manual solicitado.', state.focusLocked ? 'locked' : 'applied');
      } catch (error) {
        if (state.stream?.getVideoTracks()[0] !== track) return;
        if (isFocusUnsupported(error)) { focusSupport(track).manualRejected = true; $('manual-focus-row').hidden = true; }
        focusFeedback('O foco manual não está disponível. Você pode continuar ajustando a iluminação.', 'info', state.focusLocked);
      }
    }, 100);
  });
  function centerMode(smooth = true) {
    const nav = $('modes');
    const button = nav.querySelector('[aria-pressed="true"]');
    const box = button.getBoundingClientRect();
    nav.scrollTo({ left: nav.scrollLeft + box.left - nav.getBoundingClientRect().left - (nav.clientWidth - box.width) / 2, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  }
  document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.mode; syncUI(); centerMode(); }));

  // Native selects remain the source of truth; compact buttons provide the visual UI.
  function updateOptionButtons(input) {
    input.parentElement.querySelectorAll('[data-option]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.option === input.value));
      button.disabled = input.disabled;
    });
  }

  for (const key of ['quality', 'format', 'resolution', 'filter', 'filterIntensity', 'audio', 'microphone', 'camera', 'keyboard', 'gridType']) {
    const input = $('settings-form').elements.namedItem(key);
    if (input.type === 'checkbox') input.checked = settings[key];
    else input.value = key === 'gridType' && !settings.grid ? 'none' : settings[key];
    if (input.tagName === 'SELECT' && key !== 'microphone') {
      const group = document.createElement('div');
      group.className = key === 'filter' ? 'filter-options' : 'setting-options';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', ({ quality: 'Qualidade', format: 'Formato', resolution: 'Resolução', filter: 'Filtro', camera: 'Câmera padrão', gridType: 'Grade' })[key]);
      for (const option of input.options) {
        const button = document.createElement('button');
        button.type = 'button'; button.dataset.option = option.value;
        if (key === 'filter') {
          button.dataset.lookCategory = looks.get(option.value).category;
          button.title = looks.get(option.value).description;
          const swatch = document.createElement('span');
          swatch.className = 'filter-swatch';
          swatch.style.filter = filters[option.value] || 'none';
          swatch.setAttribute('aria-hidden', 'true');
          button.append(swatch);
        }
        button.append(document.createTextNode(option.textContent));
        button.addEventListener('click', () => { input.value = option.value; input.dispatchEvent(new Event('change')); });
        group.append(button);
      }
      input.after(group);
      updateOptionButtons(input);
    }
    input.addEventListener(input.type === 'range' ? 'input' : 'change', () => {
      settings[key] = input.type === 'checkbox' ? input.checked : input.value;
      if (key === 'gridType') settings.grid = input.value !== 'none';
      updateOptionButtons(input);
      saveSettings(); syncUI();
      if (key === 'resolution' && state.stream) openCamera(state.device);
      if (key === 'camera') { state.facing = settings.camera; if (state.stream) openCamera(); }
    });
  }
  function setLookCategory(category) {
    lookCategory = category;
    $('filter-categories').querySelectorAll('button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
    $('filters-panel').querySelectorAll('[data-look-category]').forEach((button) => { button.hidden = category !== 'all' && button.dataset.lookCategory !== category; });
    $('filters-panel').querySelector('.filter-options')?.scrollTo({ left: 0 });
  }
  for (const category of looks.categories) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = category.label; button.dataset.category = category.id;
    button.addEventListener('click', () => setLookCategory(category.id)); $('filter-categories').append(button);
  }
  setLookCategory('all');
  $('settings-form').addEventListener('submit', (event) => event.preventDefault());
  $('reset-settings').addEventListener('click', () => {
    settings = { ...defaults };
    setLookCategory('all');
    state.facing = settings.camera;
    for (const input of $('settings-form').elements) {
      if (!(input.name in settings)) continue;
      if (input.type === 'checkbox') input.checked = settings[input.name];
      else input.value = settings[input.name];
      updateOptionButtons(input);
    }
    resetAutomaticIllumination(); $('exposure').value = '0'; $('temperature').value = '5500';
    cinema?.reset();
    saveSettings(); syncUI();
    if (state.stream) openCamera();
  });
  $('reload').addEventListener('click', () => location.reload());
  let captureShortcutHeld = false;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('filters-panel').hidden && !document.querySelector('dialog[open]')) { setFiltersOpen(false); $('filters-open').focus(); return; }
    const space = event.code === 'Space' || event.key === ' ';
    const enter = event.code === 'Enter' || event.code === 'NumpadEnter' || event.key === 'Enter';
    if (space && event.repeat && captureShortcutHeld) { event.preventDefault(); return; }
    if (!settings.keyboard || (!space && !enter) || event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || document.hidden || document.querySelector('dialog[open]')) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, select, textarea, a, summary, [contenteditable]:not([contenteditable="false"])')) return;
    // Enter keeps normal button activation; Space is the opt-in camera shortcut.
    if (enter && target?.closest('button')) return;
    if (!state.ready || state.opening || state.busy) return;
    captureShortcutHeld = space;
    event.preventDefault(); capture();
  });
  document.addEventListener('keyup', (event) => {
    if (captureShortcutHeld && (event.code === 'Space' || event.key === ' ')) { event.preventDefault(); captureShortcutHeld = false; }
  });
  window.addEventListener('blur', () => { captureShortcutHeld = false; });
  function setFiltersOpen(open) {
    if (open) { $('zoom-slider').hidden = true; $('zoom-toggle').setAttribute('aria-expanded', 'false'); }
    $('filters-panel').hidden = !open;
    $('filters-open').setAttribute('aria-expanded', String(open));
    if (open) {
      if (lookCategory !== 'all' && looks.get(settings.filter).category !== lookCategory) setLookCategory('all');
      $('filters-panel').querySelector('.filter-options [aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }
  $('filters-open').addEventListener('click', () => setFiltersOpen($('filters-panel').hidden));
  $('filters-close').addEventListener('click', () => { setFiltersOpen(false); $('filters-open').focus(); });
  document.addEventListener('pointerdown', (event) => {
    if (!$('filters-panel').hidden && !event.target.closest('#filters-panel, #filters-open')) setFiltersOpen(false);
  });
  $('settings-open').addEventListener('click', () => { setFiltersOpen(false); $('settings-dialog').showModal(); });
  $('settings-dialog').addEventListener('close', () => { if (!$('settings-dialog').open) document.querySelector('.camera-app').focus({ preventScroll: true }); });
  $('gallery-open').addEventListener('click', () => { setFiltersOpen(false); closeViewer(); $('gallery-dialog').showModal(); });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', (event) => {
      // A touch released after a long press is retargeted to the new dialog backdrop.
      if (dialog.id === 'media-menu' && (gallery.menuHold || performance.now() < gallery.ignoreBackdropUntil)) return;
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
  });
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => {
    if (gallery.menuHold) { gallery.menuHold = false; gallery.ignoreBackdropUntil = performance.now() + 500; }
  }, true);
  $('gallery-dialog').addEventListener('close', () => {
    closeViewer(); gallery.checked.clear(); gallery.selecting = false; syncSelection();
  });
  $('viewer-back').addEventListener('click', closeViewer);
  $('download').addEventListener('click', () => downloadItems(state.media.filter((item) => item.id === state.selected)));
  $('delete').addEventListener('click', () => requestDelete(state.media.filter((item) => item.id === state.selected)));
  $('viewer-options').addEventListener('click', () => openMediaMenu([state.selected]));
  for (const [id, direction] of [['viewer-prev', -1], ['viewer-next', 1]]) $(id).addEventListener('click', () => {
    navigateViewer(direction);
  });
  $('gallery-select').addEventListener('click', () => {
    if (state.selected) closeViewer();
    gallery.selecting = !gallery.selecting; gallery.checked.clear(); renderGallery();
  });
  $('favorites-filter').addEventListener('click', () => { gallery.favoritesOnly = !gallery.favoritesOnly; gallery.checked.clear(); gallery.limit = 36; renderGallery(); });
  $('gallery-filter').addEventListener('change', () => { gallery.filter = $('gallery-filter').value; gallery.checked.clear(); gallery.limit = 36; renderGallery(); });
  $('gallery-more').addEventListener('click', () => { gallery.limit += 36; renderGallery(); });
  $('select-all').addEventListener('click', () => {
    const visible = visibleMedia();
    const all = visible.every((item) => gallery.checked.has(item.id));
    for (const item of visible) { if (all) gallery.checked.delete(item.id); else gallery.checked.add(item.id); }
    renderGallery();
  });
  $('selection-actions').addEventListener('click', () => openMediaMenu([...gallery.checked]));
  $('action-favorite').addEventListener('click', favoriteItems);
  $('action-share').addEventListener('click', shareItems);
  $('action-download').addEventListener('click', () => downloadItems(menuItems()));
  $('action-edit').addEventListener('click', openEditor);
  $('action-properties').addEventListener('click', showProperties);
  $('action-delete').addEventListener('click', () => requestDelete(menuItems()));
  $('delete-to-trash').addEventListener('click', async () => {
    if (!$('delete-options').open || gallery.busy) return;
    const ids = gallery.pendingDeleteChoice || []; gallery.pendingDeleteChoice = null; $('delete-options').close();
    await deleteItems(state.media.filter(item => ids.includes(item.id)));
  });
  $('delete-permanently').addEventListener('click', () => {
    if (!$('delete-options').open || gallery.busy) return;
    const ids = gallery.pendingDeleteChoice || []; gallery.pendingDeleteChoice = null; $('delete-options').close();
    confirmPermanentDelete(state.media.filter(item => ids.includes(item.id)));
  });
  $('action-restore').addEventListener('click', () => restoreItems(menuItems()));
  $('undo-trash').addEventListener('click', () => restoreItems(state.media.filter((item) => gallery.undoIds.includes(item.id) && item.deletedAt)));
  $('undo-dismiss').addEventListener('click', dismissUndo);
  $('undo-bar').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismissUndo(); }
  });
  $('confirm-delete-action').addEventListener('click', async () => {
    if (!$('confirm-delete').open || gallery.busy) return;
    const ids = gallery.pendingDelete || []; gallery.pendingDelete = null; $('confirm-delete').close();
    await deleteItems(state.media.filter(item => ids.includes(item.id)), true);
  });
  $('delete-options').addEventListener('close', () => { if (!$('delete-options').open) gallery.pendingDeleteChoice = null; });
  $('confirm-delete').addEventListener('close', () => { if (!$('confirm-delete').open) gallery.pendingDelete = null; });
  $('backup-open').addEventListener('click', () => { $('backup-status').textContent = ''; $('backup-dialog').showModal(); });
  $('backup-export').addEventListener('click', exportBackup);
  $('backup-file').addEventListener('change', () => importBackup($('backup-file').files[0]));
  $('gallery-fullscreen').addEventListener('click', async () => {
    await window.CameraFullscreen.toggle();
  });
  for (const id of ['editor-brightness', 'editor-contrast', 'editor-saturation', 'editor-filter', 'editor-filter-intensity', 'crop-width', 'crop-height', 'crop-x', 'crop-y']) $(id).addEventListener('input', () => {
    $('editor-filter-intensity').disabled = !('filter' in ctx) || $('editor-filter').value === 'none'; drawEditor();
  });
  $('editor-ratio').addEventListener('change', () => {
    if (!gallery.editor) return;
    gallery.editor.crop = false; $('editor-crop').setAttribute('aria-pressed', 'false');
    $('crop-controls').hidden = $('editor-ratio').value === 'original';
    $('crop-height').disabled = $('editor-ratio').value !== 'free';
    $('crop-width').value = $('crop-height').value = '100'; drawEditor();
    window.MobileRanges?.refresh();
  });
  $('editor-compare').addEventListener('click', () => {
    if (!gallery.editor) return;
    gallery.editor.before = !gallery.editor.before;
    $('editor-compare').setAttribute('aria-pressed', String(gallery.editor.before));
    iconLabel($('editor-compare'), gallery.editor.before ? 'eye-slash' : 'eye', gallery.editor.before ? 'Ver depois' : 'Ver antes'); drawEditor();
  });
  $('editor-rotate').addEventListener('click', () => { if (gallery.editor) { gallery.editor.rotation = (gallery.editor.rotation + 90) % 360; drawEditor(); } });
  for (const [id, key] of [['editor-mirror', 'mirror'], ['editor-crop', 'crop']]) $(id).addEventListener('click', () => {
    if (!gallery.editor) return;
    gallery.editor[key] = !gallery.editor[key]; $(id).setAttribute('aria-pressed', String(gallery.editor[key])); drawEditor();
  });
  $('editor-dialog').addEventListener('close', () => { gallery.editor?.image?.close?.(); gallery.editor = null; $('editor-canvas').width = 1; });
  $('editor-save').addEventListener('click', async () => {
    if (!gallery.editor?.image || gallery.busy) return;
    const editor = gallery.editor;
    $('editor-save').disabled = true; setGalleryBusy(true); $('editor-status').textContent = 'Salvando cópia…';
    try {
      const output = drawEditor(true);
      const type = ['image/jpeg', 'image/png', 'image/webp'].includes(editor.item.type) ? editor.item.type : 'image/jpeg';
      const blob = await new Promise((resolve) => output.toBlob(resolve, type, .92));
      const copy = await addMedia(blob, 'photo', { project: editor.item.project || '', scene: editor.item.scene || '', take: editor.item.take || '', albumIds: editor.item.albumIds || [] }, false);
      if (gallery.editor === editor) {
        $('editor-dialog').close();
        if (copy) { gallery.favoritesOnly = false; gallery.filter = 'all'; $('gallery-filter').value = 'all'; gallery.selecting = false; gallery.checked.clear(); renderGallery(); openViewer(copy.id); }
      }
    } catch (error) { $('editor-status').textContent = `Não foi possível salvar: ${error.message}`; }
    finally { $('editor-save').disabled = false; setGalleryBusy(false); }
  });

  // Stop physical devices when leaving. Invalidate outstanding permission requests.
  window.addEventListener('pagehide', () => {
    state.disposed = true;
    cinema?.stopAudio();
    state.request++;
    state.cameraAbort?.abort();
    state.recordAbort?.abort();
    cameraPermissionStatus?.removeEventListener?.('change', cameraPermissionChange);
    resetAutomaticIllumination();
    state.focusAbort?.abort(); clearTimeout(focusHoldTimer); clearTimeout(manualFocusTimer); clearTimeout(state.focusFeedbackTimer);
    cancelCountdown();
    stopRecording();
    clearInterval(state.recordTimer);
    cancelAnimationFrame(state.frame);
    stopTracks(state.stream);
    state.stream = null;
    state.ready = false;
    video.srcObject = null;
    releaseViewer(); galleryObserver?.disconnect();
    for (const url of gallery.thumbnailURLs.values()) URL.revokeObjectURL(url);
    gallery.thumbnailURLs.clear();
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    state.disposed = false; state.opening = false; state.busy = false;
    closeViewer(); updateThumbnail(); syncUI();
    state.frame = requestAnimationFrame(renderLoop);
    startAuthorizedCamera();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', detectCameras);
  if (!('filter' in ctx)) {
    $('settings-form').elements.namedItem('filter').disabled = true;
    updateOptionButtons($('settings-form').elements.namedItem('filter'));
    notice('Este navegador não suporta os filtros digitais de cor. Captura, zoom e galeria continuam disponíveis.');
  }
  cinema = window.CameraCinema.init({
    notice, renderGallery, menuItems, setGalleryBusy, reopen: () => { if (state.stream) openCamera(state.device); }, galleryBusy: () => gallery.busy,
    updateMedia: items => store.updateMany(items),
    ready: () => state.ready, recording: () => !!state.recorder,
    locked: () => state.busy || state.opening || state.countdown !== null || !!state.recorder,
    audioLevel: peak => {
      if (!state.recorder || !state.recordingHasAudio) return;
      const now = performance.now(), track = state.recordingAudioTrack;
      if (peak > .0001) {
        state.audioSignalLast = now;
        if (state.recordingAudioProblem === 'Nenhum sinal de áudio detectado') { state.recordingAudioProblem = ''; syncUI(); }
      } else if (now - state.audioSignalLast > 5000 && track?.readyState === 'live' && !track.muted && track.enabled) {
        if (!state.recordingAudioProblem) { state.recordingAudioProblem = 'Nenhum sinal de áudio detectado'; syncUI(); }
        if (!state.audioSignalNotice) { state.audioSignalNotice = true; notice('Nenhum sinal de áudio detectado. Fale perto do microfone e confira o acesso ao microfone no Android.'); }
      }
    },
    stats: () => ({ fps: focusSettings(state.stream?.getVideoTracks()[0]).frameRate, format: state.recorder?.mimeType, bytes: state.recordBytes, seconds: state.recorder ? (performance.now() - state.recordStarted) / 1000 : 0, hasAudio: state.recordingHasAudio }),
    snapshot: () => ({ settings: { ...settings }, device: state.device, mode: state.mode, zoom: state.zoom, timer: state.timer, exposure: $('exposure').value, temperature: $('temperature').value }),
    apply: preset => {
      for (const key of Object.keys(defaults)) {
        const value = preset.settings?.[key];
        if (allowedSetting(key, value)) settings[key] = value;
      }
      for (const input of $('settings-form').elements) {
        if (!(input.name in settings)) continue;
        if (input.type === 'checkbox') input.checked = settings[input.name]; else input.value = settings[input.name];
        updateOptionButtons(input);
      }
      state.facing = settings.camera;
      if (['night', 'photo', 'video', 'portrait', 'pro'].includes(preset.mode)) state.mode = preset.mode;
      state.zoom = Math.max(1, Math.min(8, Number(preset.zoom) || 1)); $('zoom').value = state.zoom; updateZoom();
      state.timer = TIMER_DELAYS.includes(preset.timer) ? preset.timer : 0;
      $('exposure').value = Number(preset.exposure) || 0; $('temperature').value = Number(preset.temperature) || 5500;
      saveSettings(); syncUI(); centerMode(false);
      if (state.stream) openCamera(state.cameras.some(c => c.deviceId === preset.device) ? preset.device : undefined);
    }
  });
  collection = window.CameraCollection.init({
    notice, renderGallery, menuItems, setGalleryBusy, galleryBusy: () => gallery.busy, items: () => state.media,
    resetLimit: () => { gallery.limit = 36; },
    refreshCatalog: async () => {
      const records = await store.list(); state.media = [...records, ...state.media.filter(item => !item.saved)];
      state.media.sort((a, b) => b.created - a.created); renderGallery(); updateThumbnail();
    },
    download: (blob, name) => { const url = URL.createObjectURL(blob); downloadURL(url, name); setTimeout(() => URL.revokeObjectURL(url), 60000); },
    recover: (draft, blob) => addMedia(blob, 'video', { ...draft.captureInfo, recordingId: draft.id, created: draft.created }, false),
    cleanTrash: () => deleteItems(state.media.filter(item => item.deletedAt && !item.favorite))
  });
  window.CameraFullscreen.init({ notice });
  window.CameraLayout.init();
  syncUI();
  loadMedia();
  startAuthorizedCamera();
  state.frame = requestAnimationFrame(renderLoop);
  requestAnimationFrame(() => centerMode(false));
  window.addEventListener('resize', () => centerMode(false));
  let installPrompt;
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; $('install-status').textContent = 'Pronto para instalar neste dispositivo.'; });
  window.addEventListener('appinstalled', () => { installPrompt = null; $('install-status').textContent = 'Aplicativo instalado.'; });
  $('install-app').addEventListener('click', async () => {
    if (installPrompt) { const prompt = installPrompt; installPrompt = null; await prompt.prompt(); const choice = await prompt.userChoice; $('install-status').textContent = choice.outcome === 'accepted' ? 'Instalação solicitada.' : 'Você pode instalar pelo menu do navegador.'; }
    else $('install-status').textContent = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone ? 'Você já está usando a janela do aplicativo.' : 'No menu do navegador, escolha Instalar aplicativo ou Adicionar à tela de início. No Safari, use Compartilhar → Adicionar à Tela de Início.';
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      $('install-status').textContent = 'Interface disponível offline após o primeiro carregamento. Instale pelo menu do navegador.';
      if (registration.waiting) $('install-status').textContent = 'Atualização disponível. Feche todas as abas do aplicativo e abra novamente.';
    }).catch(() => { $('install-status').textContent = 'Modo offline indisponível. Verifique HTTPS e a configuração do servidor.'; });
  }
})();
