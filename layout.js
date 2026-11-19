/* Presentation-only organization: keep existing controls and event handlers. */
window.CameraLayout = (() => {
  'use strict';
  const $ = id => document.getElementById(id);
  function icon(name) { const i = document.createElement('i'); i.className = `fa-solid fa-${name}`; i.setAttribute('aria-hidden', 'true'); return i; }
  function init() {
    const app = document.querySelector('.camera-app');
    const groups = { 'CÂMERA': ['camera', 'Câmera'], 'FOTO': ['photo', 'Foto'], 'VÍDEO': ['video', 'Vídeo'], 'COMPOSIÇÃO': ['composition', 'Composição'], 'MONITORAMENTO CINEMATOGRÁFICO': ['monitor', 'Monitoramento'], 'SISTEMA': ['system', 'Sistema'], 'APLICATIVO': ['app', 'Aplicativo'], 'ARMAZENAMENTO E RECUPERAÇÃO': ['storage', 'Armazenamento e recuperação'] };
    let expanded = {};
    try { const saved = JSON.parse(localStorage.getItem('miui-camera-layout-groups')); if (saved && typeof saved === 'object' && !Array.isArray(saved)) expanded = saved; } catch { /* defaults */ }
    const form = $('settings-form');
    for (const section of [...form.querySelectorAll(':scope > .settings-section')]) {
      const heading = section.querySelector(':scope > h3'); if (!heading) continue;
      const [id, title] = groups[heading.textContent.trim()] || [heading.textContent, heading.textContent];
      const group = document.createElement('details'); group.className = 'settings-group'; group.dataset.group = id;
      const summary = document.createElement('summary'); summary.textContent = title; summary.append(icon('chevron-down')); group.append(summary);
      section.before(group); group.append(section); heading.remove();
      group.open = typeof expanded[id] === 'boolean' ? expanded[id] : id === 'camera';
      group.addEventListener('toggle', () => { expanded[id] = group.open; try { localStorage.setItem('miui-camera-layout-groups', JSON.stringify(expanded)); } catch { /* optional preference */ } });
      // Keep all cinema controls inside their owning section so locking still applies.
      for (const subheading of [...section.querySelectorAll(':scope > h3')]) {
        const sub = document.createElement('details'); sub.className = 'settings-subgroup';
        const label = document.createElement('summary'); label.textContent = subheading.textContent; sub.append(label);
        const body = document.createElement('div'); body.className = 'settings-subgroup-body'; sub.append(body);
        let next = subheading.nextSibling;
        while (next && !(next.nodeType === 1 && next.tagName === 'H3')) { const following = next.nextSibling; body.append(next); next = following; }
        subheading.replaceWith(sub);
      }
    }
    const info = document.createElement('details'); info.className = 'settings-group'; info.dataset.group = 'info';
    const infoSummary = document.createElement('summary'); infoSummary.textContent = 'Informações e compatibilidade'; infoSummary.append(icon('chevron-down')); info.append(infoSummary);
    const infoBody = document.createElement('div'); infoBody.className = 'settings-section'; info.append(infoBody);
    for (const p of [...form.querySelectorAll(':scope > p')]) infoBody.append(p);
    form.append(info);

    const tools = $('gallery-tools');
    const searchRow = document.createElement('div'); searchRow.className = 'gallery-search-row';
    const filterRow = document.createElement('div'); filterRow.className = 'gallery-filter-row';
    const organize = document.createElement('button'); organize.id = 'organize-open'; organize.type = 'button'; organize.append(icon('folder-open'), document.createTextNode('Organizar'));
    organize.setAttribute('aria-haspopup', 'dialog'); organize.setAttribute('aria-controls', 'organize-dialog');
    searchRow.append($('cinema-search'), organize);
    filterRow.append($('favorites-filter'), $('gallery-filter'), $('album-filter'));
    tools.append(searchRow, filterRow);
    $('favorites-filter').title = 'Mostrar favoritos protegidos';
    $('gallery-select').setAttribute('aria-label', 'Selecionar capturas');
    const menu = document.createElement('dialog'); menu.id = 'organize-dialog'; menu.className = 'organize-dialog'; menu.setAttribute('aria-labelledby', 'organize-title');
    const header = document.createElement('div'); header.className = 'dialog-header';
    const heading = document.createElement('h2'); heading.id = 'organize-title'; heading.textContent = 'Organizar galeria';
    const close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', 'Fechar organização'); close.append(icon('xmark')); close.addEventListener('click', () => menu.close()); header.append(heading, close); menu.append(header);
    const actions = document.createElement('div'); actions.className = 'organize-actions';
    for (const [id, name, title, description] of [
      ['albums-open', 'folder-open', 'Álbuns', 'Agrupe suas capturas sem duplicar arquivos'],
      ['backup-open', 'box-archive', 'Backup e importação', 'Guarde uma cópia da sua coleção'],
      ['storage-open', 'hard-drive', 'Armazenamento', 'Consulte espaço e recupere gravações']
    ]) {
      const button = $(id); const text = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = title;
      const small = document.createElement('small'); small.textContent = description; text.append(strong, small); button.replaceChildren(icon(name), text, icon('chevron-right'));
      button.addEventListener('click', () => { if (menu.open) menu.close(); }, { capture: true }); actions.append(button);
    }
    menu.append(actions); document.body.append(menu);
    organize.addEventListener('click', () => menu.showModal());

    const hud = $('cinema-hud'); const monitor = document.createElement('details'); monitor.id = 'monitor-panel';
    const summary = document.createElement('summary'); summary.append(icon('chart-simple'));
    const title = document.createElement('span'); title.textContent = 'Monitores'; title.id = 'monitor-title'; summary.append(title, icon('chevron-down')); monitor.append(summary);
    const content = document.createElement('div'); content.id = 'monitor-content';
    const indicators = document.createElement('p'); indicators.id = 'monitor-indicators'; content.append(indicators);
    while (hud.firstChild) content.append(hud.firstChild);
    monitor.append(content); hud.append(monitor);
    try { monitor.open = localStorage.getItem('miui-camera-monitor-expanded') === 'true'; } catch { /* compact by default */ }
    monitor.addEventListener('toggle', () => { try { localStorage.setItem('miui-camera-monitor-expanded', String(monitor.open)); } catch { /* optional preference */ } });

    // Give the scene editor the same persistent header as the other panels.
    const slate = $('cinema-slate-dialog'); const slateHeading = slate.querySelector('h2');
    const slateHeader = document.createElement('div'); slateHeader.className = 'dialog-header';
    const slateClose = document.createElement('button'); slateClose.type = 'button'; slateClose.setAttribute('aria-label', 'Fechar cena e tomada'); slateClose.append(icon('xmark')); slateClose.addEventListener('click', () => slate.close());
    slateHeader.append(slateHeading, slateClose); slate.prepend(slateHeader);
    for (const d of document.querySelectorAll('dialog:not(#gallery-dialog)')) {
      const h = d.querySelector(':scope > .dialog-header h2'); if (h) { h.id ||= `${d.id}-title`; d.setAttribute('aria-labelledby', h.id); }
      d.querySelectorAll('.dialog-header button').forEach(button => { button.title ||= button.getAttribute('aria-label') || 'Fechar'; });
    }

    const storage = $('storage-dialog'); const overview = document.createElement('section'); overview.className = 'storage-region';
    const overviewTitle = document.createElement('h3'); overviewTitle.textContent = 'Espaço utilizado'; overview.append(overviewTitle, $('storage-summary'));
    const usage = document.createElement('meter'); usage.id = 'storage-quota-meter'; usage.min = 0; usage.max = 100; usage.value = 0; usage.hidden = true; usage.setAttribute('aria-label', 'Uso estimado da cota deste site'); overview.append(usage, $('storage-quota'), $('storage-persistence'), $('storage-refresh').closest('.viewer-actions'));
    const recovery = document.createElement('section'); recovery.className = 'storage-region';
    const recoveryTitle = [...storage.querySelectorAll(':scope > h3')][0]; const recoveryText = recoveryTitle.nextElementSibling;
    recovery.append(recoveryTitle, recoveryText, $('recording-drafts'));
    const cleanup = document.createElement('section'); cleanup.className = 'storage-region storage-cleanup';
    const cleanupTitle = document.createElement('h3'); cleanupTitle.textContent = 'Limpeza da lixeira';
    const cleanupText = document.createElement('p'); cleanupText.className = 'muted'; cleanupText.textContent = 'A exclusão é permanente e exige confirmação. Os favoritos permanecem protegidos.';
    $('storage-clean-trash').classList.add('danger'); cleanup.append(cleanupTitle, cleanupText, $('storage-clean-trash'));
    $('storage-status').before(overview, recovery, cleanup);

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(() => {
        app.style.setProperty('--camera-controls-height', `${Math.round(document.querySelector('.bottom-controls').getBoundingClientRect().height)}px`);
        $('gallery-dialog').style.setProperty('--gallery-header-height', `${Math.round(document.querySelector('.gallery-header').getBoundingClientRect().height)}px`);
      });
      observer.observe(document.querySelector('.bottom-controls')); observer.observe(document.querySelector('.gallery-header'));
    }
  }
  function updateMonitor(options, recording) {
    if (!$('monitor-title')) return;
    const enabled = [options.histogram, options.status, options.zebra, options.peaking, options.falseColor, options.guide !== 'none', options.safe, options.meters && recording, options.previewOnly].filter(Boolean).length;
    $('monitor-title').textContent = `Monitores · ${enabled}`;
    $('monitor-indicators').textContent = [options.zebra && `Zebra ${options.threshold}%`, options.peaking && 'Peaking', options.guide !== 'none' && `Guia ${options.guide === '0.5625' ? '9:16' : options.guide + ':1'}`, options.safe && 'Área segura'].filter(Boolean).join(' · ');
    $('monitor-indicators').hidden = !$('monitor-indicators').textContent;
  }
  return { init, updateMonitor };
})();
