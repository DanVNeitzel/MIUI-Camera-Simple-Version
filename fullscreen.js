/* Installed launch uses the manifest; browser fullscreen needs a user gesture. */
window.CameraFullscreen = (() => {
  'use strict';
  let attempted = false, pending = false, notify = () => {};
  const root = document.documentElement;
  const nativeWindow = () => matchMedia('(display-mode: fullscreen)').matches;
  const installedWindow = () => nativeWindow() || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const element = () => document.fullscreenElement || document.webkitFullscreenElement;
  const standardSupported = () => typeof root.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  const supported = () => standardSupported() || (typeof root.webkitRequestFullscreen === 'function' && document.webkitFullscreenEnabled !== false);
  function sync() {
    const active = !!element() || nativeWindow();
    for (const id of ['app-fullscreen', 'gallery-fullscreen']) {
      const button = document.getElementById(id); if (!button) continue;
      button.disabled = (!supported() && !element()) || (nativeWindow() && !element());
      button.setAttribute('aria-pressed', String(active));
      button.setAttribute('aria-label', active ? 'Sair da tela cheia' : 'Entrar em tela cheia');
      button.title = button.disabled ? active ? 'O aplicativo já iniciou em tela cheia.' : installedWindow() ? 'O sistema controla as barras deste aplicativo.' : 'Instale o aplicativo para abrir sem as barras do navegador.' : active ? 'Sair da tela cheia' : 'Entrar em tela cheia';
      const icon = button.querySelector('i'); if (icon) icon.className = `fa-solid fa-${active ? 'compress' : 'expand'}`;
      const label = button.querySelector('.button-label'); if (label) label.textContent = active ? 'Tela cheia ativa' : 'Entrar em tela cheia';
    }
    const status = document.getElementById('fullscreen-status');
    if (status) status.textContent = active ? 'Tela cheia ativa em todo o aplicativo, incluindo a galeria.' : supported() ? 'Ao abrir pelo navegador, a tela cheia é ativada no primeiro toque. Você também pode ativá-la pelo botão acima.' : installedWindow() ? 'O aplicativo foi aberto pela tela inicial. O sistema controla quais barras podem ser ocultadas.' : 'Este navegador não permite ativar a tela cheia por aqui. Instale o aplicativo na tela inicial para abrir sem as barras de navegação.';
  }
  async function enter(manual = false) {
    if (element() || nativeWindow() || pending) return;
    attempted = true;
    if (!supported()) { sync(); if (manual) notify('Instale o aplicativo na tela inicial para abrir sem as barras do navegador.'); return; }
    pending = true;
    try {
      if (standardSupported()) await root.requestFullscreen({ navigationUI: 'hide' });
      else await root.webkitRequestFullscreen();
    } catch {
      const status = document.getElementById('fullscreen-status');
      if (status) status.textContent = 'O navegador bloqueou a tela cheia. Tente pelo botão acima ou instale o aplicativo na tela inicial.';
      if (manual) notify('O navegador não permitiu entrar em tela cheia. Você pode continuar usando o aplicativo.');
      pending = false; return;
    }
    pending = false; sync();
  }
  async function toggle() {
    attempted = true;
    if (pending) return;
    if (!element()) { await enter(true); return; }
    try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) await document.webkitExitFullscreen(); }
    catch { notify('O navegador não permitiu sair da tela cheia.'); }
    sync();
  }
  function init({ notice }) {
    notify = notice;
    const section = document.getElementById('install-app').closest('section');
    const button = document.createElement('button'); button.id = 'app-fullscreen'; button.type = 'button';
    button.innerHTML = '<i class="fa-solid fa-expand" aria-hidden="true"></i><span class="button-label">Entrar em tela cheia</span>';
    const status = document.createElement('p'); status.id = 'fullscreen-status'; status.className = 'muted'; status.setAttribute('role', 'status');
    section.insertBefore(button, document.getElementById('install-app')); button.after(status);
    button.addEventListener('click', () => toggle());
    const firstGesture = event => {
      if (attempted || pending || !event.isTrusted || document.hidden || document.querySelector('dialog[open]')) return;
      if (event.type === 'keydown' && (!['Enter', ' '].includes(event.key) || event.repeat || event.ctrlKey || event.altKey || event.metaKey)) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input,select,textarea,summary,a,[contenteditable]:not([contenteditable="false"]),#app-fullscreen,#gallery-fullscreen,#install-app')) return;
      enter();
    };
    document.addEventListener('pointerup', firstGesture, { capture: true, passive: true });
    document.addEventListener('keydown', firstGesture, { capture: true });
    document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
    matchMedia('(display-mode: fullscreen)').addEventListener?.('change', sync);
    window.addEventListener('pageshow', sync);
    sync();
  }
  return { init, toggle };
})();
