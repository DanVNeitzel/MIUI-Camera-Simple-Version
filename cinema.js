/* Monitoring uses the processed browser image, never raw sensor measurements. */
window.CameraCinema = (() => {
  'use strict';
  const defaults = { zebra: false, threshold: '95', histogram: false, peaking: false, sensitivity: '24', falseColor: false, guide: 'none', safe: false, meters: true, status: false, previewOnly: false, fps: '30', project: '', scene: '', take: '1' };
  const choices = { threshold: ['70', '80', '90', '95', '100'], sensitivity: ['12', '24', '40'], guide: ['none', '2.39', '1.85', '0.5625'], fps: ['24', '25', '30', '60'] };
  function clean(value) {
    const result = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (typeof defaults[key] === 'boolean' && typeof value?.[key] === 'boolean') result[key] = value[key];
      else if (choices[key]?.includes(value?.[key])) result[key] = value[key];
      else if (['project', 'scene'].includes(key) && typeof value?.[key] === 'string') result[key] = value[key].slice(0, 80);
      else if (key === 'take' && /^\d{1,6}$/.test(value?.take) && Number(value.take) > 0) result.take = String(Number(value.take));
    }
    return result;
  }
  function init(api) {
    const $ = id => document.getElementById(id);
    let options, presets;
    try { options = clean(JSON.parse(localStorage.getItem('miui-camera-cinema'))); } catch { options = clean(); }
    try { presets = JSON.parse(localStorage.getItem('miui-camera-presets')); } catch { /* default below */ }
    presets = Array.isArray(presets) ? presets.filter(p => typeof p?.name === 'string' && p.base && p.options).slice(0, 20) : [];
    const persist = () => { try { localStorage.setItem('miui-camera-cinema', JSON.stringify(options)); } catch { api.notice('Não foi possível guardar as opções de monitoramento.'); } };
    const section = document.createElement('section'); section.className = 'settings-section cinema-settings';
    section.innerHTML = `<h3>MONITORAMENTO CINEMATOGRÁFICO</h3>
      <p class="muted">Análise da imagem processada. As ferramentas e guias aparecem somente na prévia.</p>
      <label>Zebra<input data-cinema="zebra" type="checkbox"></label>
      <label>Limite da zebra<select data-cinema="threshold"><option>70</option><option>80</option><option>90</option><option>95</option><option>100</option></select><small>% da luminância da prévia</small></label>
      <label>Histograma<input data-cinema="histogram" type="checkbox"></label>
      <label>Realce de foco (peaking)<input data-cinema="peaking" type="checkbox"></label>
      <label>Sensibilidade do peaking<select data-cinema="sensitivity"><option value="12">Alta</option><option value="24">Média</option><option value="40">Baixa</option></select></label>
      <label>False color<input data-cinema="falseColor" type="checkbox"></label>
      <p class="muted">False color: roxo = sombras profundas; azul = sombras; verde = tons médios; amarelo = altas luzes; vermelho = próximo do branco. Peaking realça contraste e não confirma foco óptico.</p>
      <label>Guia de enquadramento<select data-cinema="guide"><option value="none">Nenhuma</option><option value="2.39">Cinema 2.39:1</option><option value="1.85">Cinema 1.85:1</option><option value="0.5625">Vertical 9:16</option></select></label>
      <label>Área segura de 90%<input data-cinema="safe" type="checkbox"></label>
      <label>Medidor do microfone ao gravar<input data-cinema="meters" type="checkbox"></label>
      <label>Painel de gravação<input data-cinema="status" type="checkbox"></label>
      <label>Look somente na prévia<input data-cinema="previewOnly" type="checkbox"></label>
      <p class="muted">Com essa opção, o preset criativo não é incorporado nas fotos e vídeos. Recorte, zoom e ajustes digitais do modo continuam aplicados. Não é gravação Log ou RAW.</p>
      <label>FPS desejado<select data-cinema="fps"><option>24</option><option>25</option><option>30</option><option>60</option></select></label>
      <p class="muted">FPS depende da câmera e do desempenho. O painel mostra a taxa observada de desenho e a taxa informada pela câmera.</p>
      <h3>CENA E TOMADA</h3>
      <label>Projeto<input data-cinema="project" maxlength="80" autocomplete="off"></label>
      <label>Cena<input data-cinema="scene" maxlength="80" autocomplete="off"></label>
      <label>Próxima tomada<input data-cinema="take" type="number" min="1" max="999999" step="1"></label>
      <h3>PRESETS DE CONFIGURAÇÃO</h3>
      <label>Nome<input id="cinema-preset-name" maxlength="60" placeholder="Ex.: Entrevista"></label>
      <button id="cinema-preset-save" type="button">Salvar configuração atual</button>
      <label>Configurações salvas<select id="cinema-presets" aria-label="Preset de configuração"></select></label>
      <div class="viewer-actions"><button id="cinema-preset-apply" type="button">Aplicar</button><button id="cinema-preset-delete" type="button">Remover</button></div>`;
    section.querySelectorAll('input[type="checkbox"]').forEach(input => {
      input.setAttribute('role', 'switch'); input.parentElement.classList.add('toggle-row');
      const track = document.createElement('span'); track.className = 'toggle-track'; track.setAttribute('aria-hidden', 'true'); input.after(track);
    });
    $('settings-form').insertBefore(section, $('reset-settings').closest('section'));
    const overlay = document.createElement('canvas'); overlay.id = 'cinema-overlay'; overlay.setAttribute('aria-hidden', 'true'); $('preview').after(overlay);
    const guide = document.createElement('div'); guide.id = 'cinema-guide'; guide.setAttribute('aria-hidden', 'true'); guide.innerHTML = '<div></div>'; overlay.after(guide);
    const hud = document.createElement('aside'); hud.id = 'cinema-hud'; hud.setAttribute('aria-label', 'Monitoramento');
    hud.innerHTML = '<canvas id="cinema-histogram" width="256" height="64" aria-label="Histograma de luminância"></canvas><output id="cinema-stats"></output><div id="cinema-audio"><meter min="-60" max="0" low="-18" high="-6" optimum="-24" value="-60" aria-label="Pico do microfone em dBFS"></meter><output></output></div><span id="cinema-look-label"></span><span id="cinema-legend">Roxo: sombras profundas · verde: tons médios<br>Amarelo: altas luzes · vermelho: próximo do branco</span>';
    document.querySelector('.camera-app').append(hud);
    const sample = document.createElement('canvas'); sample.width = 256; overlay.width = 256; overlay.height = sample.height;
    const sc = sample.getContext('2d', { willReadFrequently: true }); const oc = overlay.getContext('2d');
    let last = -Infinity, frames = 0, fpsStart = performance.now(), observed = 0, audioContext, analyser, audioData, audioSource, clipUntil = 0, analysisFailed = false;
    function refresh() {
      section.querySelectorAll('[data-cinema]').forEach(input => { const value = options[input.dataset.cinema]; if (input.type === 'checkbox') input.checked = value; else input.value = value; });
    }
    function sync(locked) {
      section.querySelectorAll('input,select,button').forEach(input => { input.disabled = locked; });
      $('cinema-preset-apply').disabled = locked || !presets.length; $('cinema-preset-delete').disabled = locked || !presets.length;
      $('cinema-histogram').hidden = !options.histogram;
      $('cinema-stats').hidden = !options.status;
      $('cinema-audio').hidden = !options.meters || !api.recording();
      $('cinema-look-label').hidden = !options.previewOnly;
      $('cinema-legend').hidden = !options.falseColor;
      $('cinema-look-label').textContent = 'Look na prévia · arquivo sem preset';
      overlay.hidden = analysisFailed || !(options.zebra || options.peaking || options.falseColor);
      guide.hidden = options.guide === 'none' && !options.safe;
      if (overlay.hidden) oc.clearRect(0, 0, overlay.width, overlay.height);
      hud.hidden = !api.ready() || !(options.histogram || options.status || options.zebra || options.peaking || options.falseColor || options.guide !== 'none' || options.safe || options.previewOnly || (options.meters && api.recording()));
      window.CameraLayout?.updateMonitor(options, api.recording());
    }
    section.querySelectorAll('[data-cinema]').forEach(input => input.addEventListener('change', () => {
      if (api.locked()) { refresh(); return; }
      const key = input.dataset.cinema;
      options = clean({ ...options, [key]: input.type === 'checkbox' ? input.checked : input.value });
      persist(); refresh(); sync(false);
      if (key === 'fps') api.reopen();
    }));
    function renderPresets() {
      $('cinema-presets').replaceChildren(...presets.map((p, i) => new Option(p.name, String(i))));
      if (!presets.length) $('cinema-presets').add(new Option('Nenhum preset salvo', ''));
      sync(api.locked());
    }
    function savePresets(next) {
      try { localStorage.setItem('miui-camera-presets', JSON.stringify(next)); presets = next; renderPresets(); }
      catch { api.notice('Não foi possível salvar os presets.'); }
    }
    $('cinema-preset-save').addEventListener('click', () => {
      if (api.locked()) return;
      const name = $('cinema-preset-name').value.trim();
      if (!name) { api.notice('Digite um nome para a configuração.'); return; }
      if (presets.length >= 20) { api.notice('Limite de 20 presets. Remova um para salvar outro.'); return; }
      const { project, scene, take, ...monitoring } = options;
      savePresets([...presets, { name, base: api.snapshot(), options: monitoring }]);
    });
    $('cinema-preset-apply').addEventListener('click', () => {
      const preset = presets[Number($('cinema-presets').value)]; if (!preset || api.locked()) return;
      options = clean({ ...options, ...preset.options, project: options.project, scene: options.scene, take: options.take });
      persist(); refresh(); api.apply(preset.base); sync(api.locked());
    });
    $('cinema-preset-delete').addEventListener('click', () => { if (!api.locked()) savePresets(presets.filter((_, i) => i !== Number($('cinema-presets').value))); });
    const search = document.createElement('input'); search.id = 'cinema-search'; search.type = 'search'; search.placeholder = 'Buscar projeto, cena ou tomada'; search.setAttribute('aria-label', search.placeholder);
    $('gallery-tools').append(search); search.addEventListener('input', api.renderGallery);
    const good = document.createElement('button'); good.id = 'action-good-take'; good.textContent = 'Marcar melhor tomada';
    $('action-properties').before(good);
    good.addEventListener('click', async () => {
      const items = api.menuItems(); if (!items.length || api.galleryBusy()) return;
      const value = !items.every(item => item.goodTake); const changes = items.map(item => ({ ...item, goodTake: value }));
      api.setGalleryBusy(true);
      try { await api.updateMedia(changes.filter(item => item.saved)); items.forEach(item => { item.goodTake = value; }); $('media-menu').close(); api.renderGallery(); }
      catch { api.notice('Não foi possível salvar a marcação.'); }
      finally { api.setGalleryBusy(false); }
    });
    // Scene metadata can also be corrected on existing captures without reading originals.
    const edit = document.createElement('button'); edit.id = 'action-slate'; edit.textContent = 'Editar cena e tomada'; good.after(edit);
    const dialog = document.createElement('dialog'); dialog.id = 'cinema-slate-dialog';
    dialog.innerHTML = '<form id="cinema-slate-form"><h2>Cena e tomada</h2><label>Projeto<input name="project" maxlength="80"></label><label>Cena<input name="scene" maxlength="80"></label><label>Tomada<input name="take" type="number" min="1" max="999999" required></label><button type="submit">Salvar</button><button id="cinema-slate-cancel" type="button">Cancelar</button><p role="status"></p></form>';
    document.body.append(dialog); let editing = [];
    edit.addEventListener('click', () => {
      editing = api.menuItems().slice(); if (editing.length !== 1) { api.notice('Selecione uma captura para editar sua cena e tomada.'); return; }
      for (const key of ['project', 'scene', 'take']) dialog.querySelector(`[name="${key}"]`).value = editing[0][key] || (key === 'take' ? '1' : '');
      $('media-menu').close(); dialog.querySelector('p').textContent = ''; dialog.showModal();
    });
    $('cinema-slate-cancel').addEventListener('click', () => dialog.close());
    $('cinema-slate-form').addEventListener('submit', async event => {
      event.preventDefault(); if (api.galleryBusy()) return;
      const values = clean(Object.fromEntries(new FormData(event.target))); const changes = editing.map(item => ({ ...item, project: values.project, scene: values.scene, take: values.take }));
      api.setGalleryBusy(true);
      try { await api.updateMedia(changes.filter(item => item.saved)); changes.forEach((item, i) => Object.assign(editing[i], item)); dialog.close(); api.renderGallery(); }
      catch { dialog.querySelector('p').textContent = 'Não foi possível salvar. Tente novamente.'; }
      finally { api.setGalleryBusy(false); }
    });
    async function stopAudio() {
      analyser = null; audioData = null; audioSource?.disconnect(); audioSource = null;
      const context = audioContext; audioContext = null; if (context) await context.close().catch(() => {});
    }
    async function startAudio(stream) {
      await stopAudio(); clipUntil = 0;
      if (!stream || !options.meters) return;
      try {
        const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) throw new Error();
        audioContext = new Audio(); analyser = audioContext.createAnalyser(); analyser.fftSize = 2048;
        audioSource = audioContext.createMediaStreamSource(stream); audioSource.connect(analyser); audioData = new Float32Array(analyser.fftSize);
        await audioContext.resume();
      } catch { await stopAudio(); api.notice('Medidor indisponível; a gravação do microfone continua.'); }
    }
    function frame(source, time) {
      frames++;
      if (time - fpsStart >= 1000) { observed = frames * 1000 / (time - fpsStart); frames = 0; fpsStart = time; }
      if (time - last < 100) return; last = time;
      hud.hidden = !api.ready() || !(options.histogram || options.status || options.zebra || options.peaking || options.falseColor || options.guide !== 'none' || options.safe || options.previewOnly || (options.meters && api.recording()));
      const stats = api.stats();
      $('cinema-stats').textContent = `${source.width} × ${source.height} · câmera ${Number(stats.fps || 0).toFixed(1)} FPS · desenho ${observed.toFixed(1)} FPS\n${stats.format || 'Sem gravação'} · ${Math.floor(stats.seconds || 0)} s · ${((stats.bytes || 0) / 1048576).toFixed(2)} MB recebidos`;
      const audioLabel = $('cinema-audio').querySelector('output');
      if (analyser && audioData && audioContext?.state === 'running') {
        analyser.getFloatTimeDomainData(audioData); let peak = 0;
        for (const value of audioData) peak = Math.max(peak, Math.abs(value));
        const db = 20 * Math.log10(Math.max(peak, 0.000001));
        if (db >= -1) clipUntil = time + 1500;
        $('cinema-audio').querySelector('meter').value = Math.max(-60, db);
        audioLabel.textContent = `${Math.max(-60, db).toFixed(0)} dBFS${time < clipUntil ? ' · PICO ALTO' : ''}`;
        $('cinema-audio').classList.toggle('clipping', time < clipUntil);
      } else { $('cinema-audio').querySelector('meter').value = -60; audioLabel.textContent = stats.hasAudio ? 'Medidor indisponível' : 'Sem microfone'; }
      const stage = $('stage').getBoundingClientRect(), scale = Math.min(stage.width / source.width, stage.height / source.height);
      const w = source.width * scale, h = source.height * scale;
      for (const element of [overlay, guide]) Object.assign(element.style, { left: `${(stage.width - w) / 2}px`, top: `${(stage.height - h) / 2}px`, width: `${w}px`, height: `${h}px` });
      const ratio = options.guide === 'none' ? w / h : Number(options.guide);
      const gw = Math.min(w, h * ratio), gh = gw / ratio;
      Object.assign(guide.firstElementChild.style, { width: `${gw}px`, height: `${gh}px` });
      guide.classList.toggle('safe', options.safe); guide.classList.toggle('masked', options.guide !== 'none');
      if (analysisFailed || !(options.histogram || options.zebra || options.peaking || options.falseColor)) return;
      try {
        const height = Math.max(1, Math.round(256 * source.height / source.width));
        if (sample.height !== height) { sample.height = height; overlay.width = 256; overlay.height = height; }
        sc.drawImage(source, 0, 0, 256, height); const image = sc.getImageData(0, 0, 256, height), pixels = image.data;
        const levels = new Uint8Array(256 * height), bins = new Uint32Array(256), result = oc.createImageData(256, height);
        for (let i = 0; i < levels.length; i++) { const p = i * 4; levels[i] = Math.round(.2126 * pixels[p] + .7152 * pixels[p + 1] + .0722 * pixels[p + 2]); bins[levels[i]]++; }
        const threshold = Number(options.threshold) * 2.55;
        for (let i = 0; i < levels.length; i++) {
          const y = levels[i], x = i % 256, row = Math.floor(i / 256); let color;
          if (options.falseColor) color = y < 8 ? [110, 0, 160, 255] : y < 40 ? [25, 65, 220, 255] : y >= 245 ? [255, 30, 30, 255] : y >= 210 ? [255, 220, 0, 255] : y >= 100 && y <= 135 ? [50, 190, 80, 255] : [y, y, y, 255];
          if (options.zebra && y >= threshold) color = (x + row) % 12 < 6 ? [255, 225, 0, 220] : [0, 0, 0, 180];
          if (options.peaking && x > 0 && x < 255 && row > 0 && row < height - 1 && Math.abs(levels[i + 1] - levels[i - 1]) + Math.abs(levels[i + 256] - levels[i - 256]) > Number(options.sensitivity)) color = [255, 60, 70, 255];
          if (color) result.data.set(color, i * 4);
        }
        if (!overlay.hidden) oc.putImageData(result, 0, 0);
        if (options.histogram) {
          const hc = $('cinema-histogram').getContext('2d'); hc.clearRect(0, 0, 256, 64); hc.fillStyle = '#eee';
          const max = Math.max(1, ...bins); for (let x = 0; x < 256; x++) { const bh = 60 * Math.sqrt(bins[x] / max); hc.fillRect(x, 64 - bh, 1, bh); }
        }
      } catch { analysisFailed = true; overlay.hidden = true; api.notice('A análise de imagem não está disponível neste navegador.'); }
    }
    refresh(); renderPresets();
    return { frame, sync, startAudio, stopAudio, get options() { return options; },
      slate: () => ({ project: options.project, scene: options.scene, take: options.take, goodTake: false }),
      advance() { options.take = String(Math.min(999999, Number(options.take) + 1)); persist(); refresh(); },
      matches: item => !search.value.trim() || `${item.project || ''} ${item.scene || ''} ${item.take || ''}`.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()),
      reset() { options = clean(); persist(); refresh(); sync(api.locked()); }
    };
  }
  return { init };
})();
