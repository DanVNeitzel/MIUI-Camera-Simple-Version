// Rasterize the editable SVG using Chrome's renderer. No npm packages required.
// Usage: node simples_version/icons/build-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const executable = candidates.find(file => fs.existsSync(file));
if (!executable) throw new Error('Defina CHROME_PATH para Chrome ou Chromium.');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'miui-icon-build-'));
const browser = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; break; } catch { await pause(100); } }
  if (!port) throw new Error('Não foi possível iniciar o navegador.');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); } };
  const call = (method, params) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  const source = `data:image/svg+xml;base64,${fs.readFileSync(path.join(directory, 'app-icon.svg')).toString('base64')}`;
  const result = await call('Runtime.evaluate', { expression: `(async () => {
    const image = new Image(); image.src = ${JSON.stringify(source)}; await image.decode();
    const output = {};
    for (const size of [32, 180, 192, 512]) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(image, 0, 0, size, size);
      output[size] = canvas.toDataURL('image/png').split(',')[1];
    }
    const preview = document.createElement('canvas'); preview.width = 880; preview.height = 380;
    const ctx = preview.getContext('2d'); ctx.fillStyle = '#eeeeef'; ctx.fillRect(0, 0, 880, 380);
    ctx.fillStyle = '#19191d'; ctx.fillRect(440, 0, 440, 380);
    for (const start of [0, 440]) {
      ctx.save(); ctx.beginPath(); ctx.roundRect(start + 44, 40, 200, 200, 44); ctx.clip(); ctx.drawImage(image, start + 44, 40, 200, 200); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.arc(start + 332, 140, 68, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(image, start + 264, 72, 136, 136); ctx.restore();
      let x = start + 50;
      for (const size of [16, 32, 48, 64]) { ctx.save(); ctx.beginPath(); ctx.roundRect(x, 286 - size / 2, size, size, size * .22); ctx.clip(); ctx.drawImage(image, x, 286 - size / 2, size, size); ctx.restore(); x += size + 25; }
    }
    output.preview = preview.toDataURL('image/png').split(',')[1]; return output;
  })()`, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  for (const [size, name] of [[32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
    fs.writeFileSync(path.join(directory, name), Buffer.from(result.result.value[size], 'base64')); console.log(name);
  }
  const preview = path.join(os.tmpdir(), 'miui-app-icon-preview.png');
  fs.writeFileSync(preview, Buffer.from(result.result.value.preview, 'base64')); console.log(`Preview: ${preview}`);
} finally {
  socket?.close(); browser.kill();
  if (path.dirname(profile) === os.tmpdir() && path.basename(profile).startsWith('miui-icon-build-')) {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch { /* Browser process may retain temporary locks. */ }
  }
}
