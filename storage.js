/* Catalog and thumbnails are separate from originals: opening the gallery never
   reads all full-size files. Version 1 collections migrate one record at a time. */
window.CameraStore = (() => {
  'use strict';
  let connection;
  const recordingLocks = new Map();
  const retention = 30 * 24 * 60 * 60 * 1000;
  function open() {
    if (!connection) connection = new Promise((resolve, reject) => {
      const request = indexedDB.open('miui-camera-simple', 3);
      request.onupgradeneeded = () => {
        for (const name of ['media', 'catalog', 'thumbnails']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
        for (const name of ['albums', 'recordings']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' });
        if (!request.result.objectStoreNames.contains('recordingChunks')) request.result.createObjectStore('recordingChunks', { keyPath: ['recording', 'index'] }).createIndex('recording', 'recording');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Feche outras abas da câmera e recarregue para atualizar a galeria.'));
    }).catch((error) => { connection = null; throw error; });
    return connection;
  }
  async function read(store, method, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly'), request = tx.objectStore(store)[method](value);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = tx.onerror = () => reject(tx.error || request.error);
    });
  }
  function metadata(item) {
    return { id: item.id, kind: item.kind, created: item.created, favorite: !!item.favorite, deletedAt: item.deletedAt || null, type: item.type || item.blob?.type || '', size: item.size ?? item.blob?.size ?? 0, width: item.width || 0, height: item.height || 0, duration: Number.isFinite(item.duration) ? item.duration : null,
      project: typeof item.project === 'string' ? item.project.slice(0, 80) : '', scene: typeof item.scene === 'string' ? item.scene.slice(0, 80) : '', take: /^\d{1,6}$/.test(item.take) && Number(item.take) > 0 ? String(Number(item.take)) : '', goodTake: item.goodTake === true,
      albumIds: Array.isArray(item.albumIds) ? [...new Set(item.albumIds.filter(id => typeof id === 'string' && id.length <= 80))].slice(0, 50) : [] };
  }
  async function atomic(callback, stores = ['media', 'catalog', 'thumbnails']) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('A operação não foi salva.'));
      try { callback(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }
  async function image(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
    return new Promise((resolve, reject) => {
      const element = new Image(), url = URL.createObjectURL(blob);
      element.onload = () => { URL.revokeObjectURL(url); resolve(element); };
      element.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida.')); };
      element.src = url;
    });
  }
  async function preview(blob, kind) {
    let source, release = () => {}, dimensions = {};
    try {
      if (kind === 'photo') { source = await image(blob); release = () => source.close?.(); dimensions = { width: source.width, height: source.height }; }
      else {
        const element = document.createElement('video'), url = URL.createObjectURL(blob);
        release = () => { element.pause(); element.removeAttribute('src'); element.load(); URL.revokeObjectURL(url); };
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => finish(new Error('Sem miniatura de vídeo.')), 4000);
          const finish = (error) => { clearTimeout(timer); element.onloadeddata = null; element.onerror = null; error ? reject(error) : resolve(); };
          element.onloadeddata = () => finish(); element.onerror = () => finish(new Error('Vídeo inválido.'));
          element.muted = true; element.preload = 'auto'; element.playsInline = true; element.src = url;
        });
        source = element; dimensions = { width: element.videoWidth, height: element.videoHeight, duration: Number.isFinite(element.duration) ? element.duration : null };
      }
      const scale = Math.min(1, 256 / Math.max(dimensions.width, dimensions.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(dimensions.width * scale)); canvas.height = Math.max(1, Math.round(dimensions.height * scale));
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .65));
      return { ...dimensions, thumbnail };
    } catch { return { ...dimensions, thumbnail: null }; }
    finally { release(); }
  }
  function eraseRecording(tx, id) {
    tx.objectStore('recordings').delete(id);
    const cursor = tx.objectStore('recordingChunks').index('recording').openCursor(IDBKeyRange.only(id));
    cursor.onsuccess = () => { if (cursor.result) { cursor.result.delete(); cursor.result.continue(); } };
  }
  async function save(item, recordingId = null) {
    const prepared = await preview(item.blob, item.kind);
    let meta = metadata({ ...item, ...prepared });
    await atomic((tx) => {
      const write = () => {
        tx.objectStore('media').put({ ...meta, blob: item.blob });
        tx.objectStore('catalog').put(meta);
        if (prepared.thumbnail) tx.objectStore('thumbnails').put({ id: item.id, blob: prepared.thumbnail });
      };
      if (recordingId) {
        const request = tx.objectStore('catalog').get(item.id);
        request.onsuccess = () => { if (request.result) meta = request.result; else write(); eraseRecording(tx, recordingId); };
      } else write();
    }, recordingId ? ['media', 'catalog', 'thumbnails', 'recordings', 'recordingChunks'] : undefined);
    return { ...meta, thumbnail: prepared.thumbnail };
  }
  async function updateMany(items, remove = false) {
    await atomic((tx) => {
      for (const item of items) {
        const request = tx.objectStore('catalog').get(item.id);
        request.onsuccess = () => {
          const current = request.result;
          // Read the current favorite in the same write transaction: another tab
          // may have protected it since the gallery selection was made.
          if ((remove || (item.deletedAt && !current?.deletedAt)) && (current?.favorite || item.favorite)) {
            tx.abort(); return;
          }
          try {
            if (remove) { for (const name of ['media', 'catalog', 'thumbnails']) tx.objectStore(name).delete(item.id); }
            else tx.objectStore('catalog').put(metadata(item));
          } catch { tx.abort(); }
        };
      }
    });
  }
  async function list(progress = () => {}) {
    let catalog = await read('catalog', 'getAll');
    const known = new Set(catalog.map((item) => item.id));
    const keys = await read('media', 'getAllKeys');
    let migrated = 0;
    for (const id of keys) {
      if (known.has(id)) continue;
      const original = await read('media', 'get', id);
      if (!original?.blob) continue;
      const meta = await save(original);
      delete meta.thumbnail; catalog.push(meta);
      progress(++migrated, keys.length - known.size);
    }
    const expired = catalog.filter((item) => !item.favorite && item.deletedAt && item.deletedAt <= Date.now() - retention);
    if (expired.length) {
      const removed = new Set();
      await atomic((tx) => {
        for (const item of expired) {
          const request = tx.objectStore('catalog').get(item.id);
          request.onsuccess = () => {
            // Another tab may have restored the photo since we read the catalog.
            if (!request.result?.deletedAt || request.result.favorite || request.result.deletedAt > Date.now() - retention) return;
            for (const name of ['media', 'catalog', 'thumbnails']) tx.objectStore(name).delete(item.id);
            removed.add(item.id);
          };
        }
      });
      catalog = catalog.filter((item) => !removed.has(item.id));
    }
    return catalog.sort((a, b) => b.created - a.created).map((item) => ({ ...item, saved: true }));
  }
  async function importMany(items, albums = []) {
    await atomic((tx) => {
      for (const album of albums) tx.objectStore('albums').put(album);
      for (const item of items) {
        const meta = metadata(item);
        tx.objectStore('media').put({ ...meta, blob: item.blob }); tx.objectStore('catalog').put(meta);
        if (item.thumbnail) tx.objectStore('thumbnails').put({ id: item.id, blob: item.thumbnail });
      }
    }, ['media', 'catalog', 'thumbnails', 'albums']);
  }
  async function saveAlbum(album) {
    const name = String(album.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Informe um nome para o álbum.');
    const result = { id: album.id || crypto.randomUUID(), name, created: album.created || Date.now() };
    await atomic(tx => tx.objectStore('albums').put(result), ['albums']); return result;
  }
  async function deleteAlbum(id) {
    await atomic(tx => {
      tx.objectStore('albums').delete(id);
      const cursor = tx.objectStore('catalog').openCursor();
      cursor.onsuccess = () => { const row = cursor.result; if (!row) return;
        if (row.value.albumIds?.includes(id)) row.update({ ...row.value, albumIds: row.value.albumIds.filter(value => value !== id) }); row.continue();
      };
    }, ['albums', 'catalog']);
  }
  async function assignAlbum(ids, albumId, remove = false) {
    await atomic(tx => {
      const apply = () => { for (const id of ids) {
        const request = tx.objectStore('catalog').get(id);
        request.onsuccess = () => { const item = request.result; if (!item) return;
          const albumIds = new Set(item.albumIds || []);
          if (remove) albumIds.delete(albumId); else albumIds.add(albumId);
          if (albumIds.size > 50) { tx.abort(); return; }
          tx.objectStore('catalog').put({ ...item, albumIds: [...albumIds] });
        };
      } };
      const album = tx.objectStore('albums').get(albumId);
      album.onsuccess = () => { if (!album.result) tx.abort(); else apply(); };
    }, ['albums', 'catalog']);
  }
  const lockName = id => `miui-camera-recording-${id}`;
  const isRecordingActive = item => item && (typeof item.active === 'boolean' ? item.active : Date.now() - item.updated < 120000 && ['recording', 'recovering', 'finalizing'].includes(item.status));
  async function holdRecording(id) {
    if (!navigator.locks?.request) return;
    await new Promise((resolve, reject) => {
      navigator.locks.request(lockName(id), { ifAvailable: true }, async lock => {
        if (!lock) { reject(new Error('Esta gravação está em uso em outra operação.')); return; }
        let release; const held = new Promise(done => { release = done; }); recordingLocks.set(id, release); resolve(); await held;
      }).catch(reject);
    });
  }
  function releaseRecording(id) { recordingLocks.get(id)?.(); recordingLocks.delete(id); }
  async function createRecording(captureInfo, type) {
    const draft = { id: crypto.randomUUID(), created: Date.now(), updated: Date.now(), status: 'recording', type, captureInfo, size: 0, chunks: 0 };
    await holdRecording(draft.id);
    try { await atomic(tx => tx.objectStore('recordings').add(draft), ['recordings']); return draft; }
    catch (error) { releaseRecording(draft.id); throw error; }
  }
  async function touchRecording(id, status) {
    await atomic(tx => { const request = tx.objectStore('recordings').get(id); request.onsuccess = () => {
      if (request.result) tx.objectStore('recordings').put({ ...request.result, updated: Date.now(), status: status || request.result.status });
    }; }, ['recordings']);
  }
  async function appendRecording(id, index, blob) {
    await atomic(tx => { const request = tx.objectStore('recordings').get(id); request.onsuccess = () => {
      const draft = request.result; if (!draft || draft.status !== 'recording') { tx.abort(); return; }
      tx.objectStore('recordingChunks').add({ recording: id, index, blob });
      tx.objectStore('recordings').put({ ...draft, updated: Date.now(), size: draft.size + blob.size, chunks: draft.chunks + 1, type: draft.type || blob.type });
    }; }, ['recordings', 'recordingChunks']);
  }
  async function claimRecording(id) {
    let draft;
    await holdRecording(id);
    try { await atomic(tx => { const request = tx.objectStore('recordings').get(id); request.onsuccess = () => {
      if (!request.result || (!navigator.locks?.request && isRecordingActive(request.result))) { tx.abort(); return; }
      draft = { ...request.result, status: 'recovering', updated: Date.now() }; tx.objectStore('recordings').put(draft);
    }; }, ['recordings']); return draft; }
    catch (error) { releaseRecording(id); throw error; }
  }
  async function recordingBlob(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('recordingChunks'), request = tx.objectStore('recordingChunks').index('recording').getAll(IDBKeyRange.only(id));
      tx.oncomplete = () => { const rows = request.result.sort((a, b) => a.index - b.index); resolve(new Blob(rows.map(row => row.blob), { type: rows[0]?.blob.type || 'video/webm' })); };
      tx.onabort = tx.onerror = () => reject(tx.error || request.error);
    });
  }
  async function discardRecording(id) {
    await holdRecording(id);
    try { await atomic(tx => { const request = tx.objectStore('recordings').get(id); request.onsuccess = () => {
      if (!navigator.locks?.request && isRecordingActive(request.result)) { tx.abort(); return; } eraseRecording(tx, id);
    }; }, ['recordings', 'recordingChunks']); }
    finally { releaseRecording(id); }
  }
  async function listRecordings() {
    const rows = await read('recordings', 'getAll');
    if (!navigator.locks?.query) return rows;
    const locks = await navigator.locks.query(); const held = new Set(locks.held.map(lock => lock.name));
    return rows.map(row => ({ ...row, active: held.has(lockName(row.id)) }));
  }
  return { retention, open, list, save, updateMany, importMany, prepare: preview, metadata, get: (id) => read('media', 'get', id), thumbnail: (id) => read('thumbnails', 'get', id),
    listAlbums: () => read('albums', 'getAll'), saveAlbum, deleteAlbum, assignAlbum,
    createRecording, appendRecording, touchRecording, claimRecording, recordingBlob, discardRecording, isRecordingActive, listRecordings, releaseRecording };
})();
