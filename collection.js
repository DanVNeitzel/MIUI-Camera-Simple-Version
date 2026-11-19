/* Albums reference catalog entries; recovery drafts are separate from gallery media. */
window.CameraCollection = (() => {
  'use strict';
  function init(api) {
    const $ = id => document.getElementById(id), store = window.CameraStore;
    let albums = [], pending = [], busy = false, removing = '', refreshToken = 0;
    const bytes = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
    function button(id, text, target) { const b = document.createElement('button'); b.id = id; b.type = 'button'; b.textContent = text; target.append(b); return b; }
    const filter = document.createElement('select'); filter.id = 'album-filter'; filter.setAttribute('aria-label', 'Filtrar por álbum'); $('gallery-tools').append(filter);
    filter.addEventListener('change', () => { api.resetLimit(); api.renderGallery(); });
    button('albums-open', 'Álbuns', $('gallery-tools'));
    button('storage-open', 'Armazenamento', $('gallery-tools'));
    const section = document.createElement('section'); section.className = 'settings-section';
    section.innerHTML = '<h3>ARMAZENAMENTO E RECUPERAÇÃO</h3><button id="settings-storage-open" type="button">Ver espaço e gravações interrompidas</button><p class="muted">Trechos de vídeo são guardados durante a gravação quando o armazenamento local está disponível.</p>';
    $('settings-form').insertBefore(section, $('install-app').closest('section'));
    button('action-album', 'Adicionar ou remover de um álbum', $('action-properties').parentElement);
    function dialog(id, title, content) {
      const d = document.createElement('dialog'); d.id = id; d.className = 'collection-dialog';
      d.innerHTML = `<div class="dialog-header"><h2>${title}</h2><button type="button" data-collection-close aria-label="Fechar">×</button></div>${content}`;
      document.body.append(d); d.querySelector('[data-collection-close]').addEventListener('click', () => d.close()); return d;
    }
    const albumDialog = dialog('albums-dialog', 'Álbuns', `<p class="muted">Organize fotos e vídeos sem duplicar arquivos. Remover um álbum mantém todas as capturas.</p>
      <form id="album-form"><label>Nome do álbum<input id="album-name" maxlength="80" required autocomplete="off"></label><button id="album-create" type="submit">Criar álbum</button></form>
      <label>Álbum existente<select id="album-manage" aria-label="Álbum para gerenciar"></select></label>
      <div class="viewer-actions"><button id="album-rename" type="button">Renomear com o nome acima</button><button id="album-remove" type="button">Remover álbum</button></div>
      <button id="album-remove-confirm" type="button" hidden>Confirmar remoção do álbum, mantendo os arquivos</button><p id="album-status" role="status" class="muted"></p>`);
    const assignDialog = dialog('album-assign-dialog', 'Organizar capturas', `<p id="album-assignment-count" class="muted"></p><label>Álbum<select id="album-assignment" aria-label="Álbum de destino"></select></label><div class="viewer-actions"><button id="album-add" type="button">Adicionar</button><button id="album-unassign" type="button">Remover deste álbum</button></div><p id="album-assignment-status" role="status" class="muted"></p>`);
    const storageDialog = dialog('storage-dialog', 'Armazenamento', `<div id="storage-summary" role="status"></div><p id="storage-quota" class="muted"></p><p id="storage-persistence" class="muted"></p>
      <div class="viewer-actions"><button id="storage-refresh" type="button">Atualizar</button><button id="storage-persist" type="button">Solicitar proteção do armazenamento</button></div>
      <button id="storage-clean-trash" type="button">Esvaziar lixeira sem favoritos</button>
      <h3>Gravações interrompidas</h3><p class="muted">Recupere os trechos disponíveis ou baixe o arquivo parcial. O trecho ainda não entregue pelo gravador pode ter sido perdido. A recuperação não é garantida em todos os formatos.</p><div id="recording-drafts"></div><p id="storage-status" role="status" class="muted"></p>`);
    function options(select, first = []) {
      const previous = select.value;
      select.replaceChildren(...first.map(([name, value]) => new Option(name, value)), ...albums.map(a => new Option(a.name, a.id)));
      if ([...select.options].some(o => o.value === previous)) select.value = previous;
    }
    async function refreshAlbums() {
      albums = (await store.listAlbums()).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
      options(filter, [['Todos os álbuns', 'all'], ['Sem álbum', 'none']]);
      options($('album-manage')); options($('album-assignment'));
      $('album-rename').disabled = $('album-remove').disabled = !albums.length;
      $('album-add').disabled = $('album-unassign').disabled = !albums.length;
    }
    function setBusy(value) {
      busy = value;
      for (const d of [albumDialog, assignDialog, storageDialog]) d.querySelectorAll('button:not([data-collection-close]),input,select').forEach(e => { e.disabled = value; });
      api.setGalleryBusy(value);
    }
    async function changeAlbum(work) {
      if (busy) return; setBusy(true); $('album-status').textContent = '';
      try { await work(); await refreshAlbums(); await api.refreshCatalog(); api.renderGallery(); }
      catch (e) { $('album-status').textContent = `Não foi possível atualizar: ${e.message}`; }
      finally { setBusy(false); $('album-rename').disabled = $('album-remove').disabled = !albums.length; }
    }
    $('albums-open').addEventListener('click', async () => { if (busy || api.galleryBusy()) return; try { await refreshAlbums(); $('album-status').textContent = ''; albumDialog.showModal(); } catch (e) { api.notice(e.message); } });
    $('album-form').addEventListener('submit', event => {
      event.preventDefault(); changeAlbum(async () => {
        if (albums.length >= 500) throw new Error('Limite de 500 álbuns atingido.');
        await store.saveAlbum({ name: $('album-name').value }); $('album-name').value = ''; $('album-status').textContent = 'Álbum criado.';
      });
    });
    $('album-rename').addEventListener('click', () => changeAlbum(async () => {
      const album = albums.find(a => a.id === $('album-manage').value); if (!album) return;
      await store.saveAlbum({ ...album, name: $('album-name').value }); $('album-name').value = ''; $('album-status').textContent = 'Álbum renomeado.';
    }));
    $('album-remove').addEventListener('click', () => {
      removing = $('album-manage').value; const album = albums.find(a => a.id === removing); if (!album) return;
      $('album-remove-confirm').textContent = `Remover “${album.name}” e manter todos os arquivos`; $('album-remove-confirm').hidden = false;
    });
    $('album-remove-confirm').addEventListener('click', () => changeAlbum(async () => {
      await store.deleteAlbum(removing); api.items().forEach(item => { item.albumIds = (item.albumIds || []).filter(id => id !== removing); });
      $('album-remove-confirm').hidden = true; $('album-status').textContent = 'Álbum removido. As capturas foram mantidas.';
    }));
    $('album-manage').addEventListener('change', () => { $('album-remove-confirm').hidden = true; });
    $('action-album').addEventListener('click', async () => {
      if (busy || api.galleryBusy()) return; pending = api.menuItems().slice(); if (!pending.length) return;
      try { await refreshAlbums(); $('media-menu').close(); $('album-assignment-count').textContent = `${pending.length} captura(s) selecionada(s).`;
        $('album-assignment-status').textContent = albums.length ? '' : 'Crie um álbum em Galeria → Álbuns primeiro.'; assignDialog.showModal();
      } catch (e) { api.notice(e.message); }
    });
    async function assign(remove) {
      const albumId = $('album-assignment').value; if (busy || !albumId) return; setBusy(true);
      try {
        await store.assignAlbum(pending.filter(i => i.saved).map(i => i.id), albumId, remove);
        pending.forEach(item => { const ids = new Set(item.albumIds || []); if (remove) ids.delete(albumId); else ids.add(albumId); item.albumIds = [...ids]; });
        await api.refreshCatalog(); api.renderGallery(); assignDialog.close();
      } catch (e) { $('album-assignment-status').textContent = `Não foi possível organizar: ${e.message}`; }
      finally { setBusy(false); }
    }
    $('album-add').addEventListener('click', () => assign(false)); $('album-unassign').addEventListener('click', () => assign(true));
    function summaryRow(target, name, items) {
      const row = document.createElement('p'), count = items.length, size = items.reduce((n, item) => n + item.size, 0);
      row.className = 'storage-card';
      const label = document.createElement('span'); label.textContent = name;
      const amount = document.createElement('strong'); amount.textContent = bytes(size);
      const total = document.createElement('small'); total.textContent = `${count} ${count === 1 ? 'arquivo' : 'arquivos'}`;
      row.append(label, amount, total); target.append(row);
    }
    async function refreshStorage() {
      const token = ++refreshToken;
      try {
        const [items, drafts, estimate, persisted] = await Promise.all([store.list(), store.listRecordings(), navigator.storage?.estimate?.().catch(() => null), navigator.storage?.persisted?.().catch(() => false)]);
        if (token !== refreshToken) return;
        const target = $('storage-summary'); target.replaceChildren();
        summaryRow(target, 'Fotos ativas', items.filter(i => !i.deletedAt && i.kind === 'photo'));
        summaryRow(target, 'Vídeos ativos', items.filter(i => !i.deletedAt && i.kind === 'video'));
        summaryRow(target, 'Lixeira', items.filter(i => i.deletedAt));
        summaryRow(target, 'Favoritos protegidos (incluídos acima)', items.filter(i => i.favorite));
        summaryRow(target, 'Rascunhos de vídeo', drafts);
        $('storage-quota').textContent = estimate?.quota ? `Origem deste site: ${bytes(estimate.usage || 0)} utilizados de uma cota estimada de ${bytes(estimate.quota)}. Inclui miniaturas, cache e outros dados da mesma origem; não é o espaço livre total do aparelho.` : 'Este navegador não informa a cota de armazenamento.';
        const meter = $('storage-quota-meter');
        if (meter) { meter.hidden = !estimate?.quota; meter.value = estimate?.quota ? Math.min(100, (estimate.usage || 0) / estimate.quota * 100) : 0; meter.setAttribute('aria-valuetext', $('storage-quota').textContent); }
        $('storage-persistence').textContent = persisted ? 'Armazenamento persistente autorizado pelo navegador. Mantenha seus backups.' : 'Proteção contra limpeza automática não concedida. Você pode solicitá-la abaixo e manter backups externos.';
        $('storage-persist').disabled = busy || persisted || !navigator.storage?.persist;
        const removable = items.filter(i => i.deletedAt && !i.favorite);
        $('storage-clean-trash').disabled = busy || !removable.length;
        $('storage-clean-trash').textContent = `Esvaziar lixeira: ${removable.length} sem favorito · ${bytes(removable.reduce((n, i) => n + i.size, 0))}`;
        const list = $('recording-drafts'); list.replaceChildren();
        if (!drafts.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'Nenhuma gravação pendente.'; list.append(p); }
        for (const draft of drafts.sort((a, b) => b.created - a.created)) {
          const row = document.createElement('section'); row.className = 'draft-row'; row.dataset.draft = draft.id;
          const p = document.createElement('p'); p.textContent = `${new Date(draft.created).toLocaleString('pt-BR')} · ${bytes(draft.size)} · ${draft.chunks} trecho(s)`; row.append(p);
          const active = store.isRecordingActive(draft), status = document.createElement('p'); status.className = 'muted'; status.textContent = active ? 'Em uso por uma gravação ou recuperação. Aguarde para acessar.' : 'Interrompida · pronta para tentar recuperar'; row.append(status);
          for (const [action, label] of [['recover', 'Recuperar na galeria'], ['download', 'Baixar parcial'], ['discard', 'Descartar rascunho']]) {
            const b = button('', label, row); b.removeAttribute('id'); b.dataset.draftAction = action; b.disabled = busy || active || (action !== 'discard' && !draft.size);
            b.addEventListener('click', () => { if (action === 'discard' && b.dataset.draftAction !== 'confirm-discard') { b.textContent = 'Confirmar descarte deste rascunho'; b.dataset.draftAction = 'confirm-discard'; } else operateDraft(draft, action); });
          }
          list.append(row);
        }
      } catch (e) { $('storage-status').textContent = `Armazenamento indisponível: ${e.message}`; }
    }
    async function operateDraft(draft, action) {
      if (busy) return; setBusy(true); let claimed = false, heartbeat; $('storage-status').textContent = 'Preparando…';
      try {
        if (action === 'discard') { await store.discardRecording(draft.id); $('storage-status').textContent = 'Rascunho descartado.'; }
        else {
          const current = await store.claimRecording(draft.id); claimed = true;
          heartbeat = setInterval(() => store.touchRecording(draft.id, 'recovering').catch(() => {}), 5000);
          const blob = await store.recordingBlob(draft.id); if (!blob.size) throw new Error('Não há trechos gravados.');
          const typed = new Blob([blob], { type: current.type || blob.type });
          if (action === 'download') { api.download(typed, `video-parcial-${draft.id}.${typed.type.includes('mp4') ? 'mp4' : 'webm'}`); $('storage-status').textContent = 'Arquivo parcial preparado. O rascunho foi mantido.'; }
          else {
            const preview = await store.prepare(typed, 'video');
            if (!preview.width) throw new Error('O navegador não conseguiu reproduzir os trechos. Use Baixar parcial para tentar abrir em outro aplicativo.');
            const item = await api.recover(current, typed);
            if (!item?.saved) throw new Error('O vídeo permanece pendente. Libere espaço ou baixe o parcial.');
            $('storage-status').textContent = 'Vídeo recuperado na galeria. Confira a reprodução e a duração.';
          }
        }
      } catch (e) { $('storage-status').textContent = `Operação não concluída: ${e.message}`; }
      finally { clearInterval(heartbeat); if (claimed) { await store.touchRecording(draft.id, 'interrupted').catch(() => {}); store.releaseRecording(draft.id); } setBusy(false); await refreshStorage(); }
    }
    async function openStorage() { if (busy || api.galleryBusy()) return; $('storage-status').textContent = ''; storageDialog.showModal(); await refreshStorage(); }
    $('storage-open').addEventListener('click', openStorage); $('settings-storage-open').addEventListener('click', openStorage);
    $('storage-refresh').addEventListener('click', refreshStorage);
    $('storage-persist').addEventListener('click', async () => {
      if (busy) return;
      try { const granted = await navigator.storage.persist(); $('storage-status').textContent = granted ? 'Proteção autorizada pelo navegador.' : 'O navegador não concedeu a proteção. Guarde backups externos.'; await refreshStorage(); }
      catch { $('storage-status').textContent = 'Não foi possível solicitar a proteção neste navegador.'; }
    });
    $('storage-clean-trash').addEventListener('click', async () => { if (busy) return; try { await api.refreshCatalog(); storageDialog.close(); api.cleanTrash(); } catch (e) { api.notice(e.message); } });
    const timer = setInterval(() => { if (storageDialog.open && !busy) refreshStorage(); }, 5000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    refreshAlbums().then(() => api.renderGallery()).catch(() => {});
    store.listRecordings().then(drafts => { const interrupted = drafts.filter(d => !store.isRecordingActive(d)); if (interrupted.length) api.notice(`${interrupted.length} gravação(ões) pendente(s). Abra Armazenamento para recuperar.`); }).catch(() => {});
    return { refreshAlbums, matches: item => !filter.value || filter.value === 'all' || (filter.value === 'none' ? !item.albumIds?.length : item.albumIds?.includes(filter.value)),
      albumNames: ids => (ids || []).map(id => albums.find(a => a.id === id)?.name).filter(Boolean),
      sync: locked => { $('settings-storage-open').disabled = locked; }, refreshStorage };
  }
  return { init };
})();
