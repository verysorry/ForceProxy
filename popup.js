'use strict';

const TAG = '[ForceProxy UI]';
const log = (...a) => console.log(TAG, ...a);

const listEl   = document.getElementById('proxy-list');
const dotEl    = document.getElementById('dot');
const statusEl = document.getElementById('status');
const newLabel = document.getElementById('new-label');
const newHost  = document.getElementById('new-host');
const newPort  = document.getElementById('new-port');
const newType  = document.getElementById('new-type');
const btnAdd   = document.getElementById('btn-add');

// In-memory state (loaded from storage on init)
let proxies    = [];   // [{id, label, host, port, type}]
let activeId   = 'direct'; // 'direct' | proxy id

// ── Storage ────────────────────────────────────────────────────────────────

async function loadFromStorage() {
  const data = await chrome.storage.local.get(['proxies', 'activeProxy']);
  proxies  = data.proxies || [];
  const ap = data.activeProxy;
  if (ap) {
    const found = proxies.find(p => p.host === ap.host && p.port === ap.port);
    activeId = found ? found.id : 'direct';
  } else {
    activeId = 'direct';
  }
  log('loaded state, proxies:', proxies.length, 'activeId:', activeId);
}

async function saveProxies() {
  await chrome.storage.local.set({ proxies });
}

async function saveActiveProxy(proxy) {
  // proxy = {host, port} or null
  await chrome.storage.local.set({ activeProxy: proxy || null });
}

// ── Background communication ───────────────────────────────────────────────

function send(msg) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: 'Background timeout' }), 5000);
    chrome.runtime.sendMessage(msg, (res) => {
      clearTimeout(t);
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { ok: false, error: 'Empty response' });
      }
    });
  });
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  listEl.innerHTML = '';
  listEl.appendChild(makeRow('direct', 'Direct', 'System default', activeId === 'direct', false));
  for (const p of proxies) {
    const t = p.type || 'socks5';
    listEl.appendChild(makeRow(p.id, p.label, t + '://' + p.host + ':' + p.port, activeId === p.id, true));
  }
  dotEl.className = 'dot' + (activeId !== 'direct' ? ' active' : '');
}

function makeRow(id, label, subtitle, active, deletable) {
  const row = document.createElement('div');
  row.className = 'proxy-row' + (active ? ' active' : '');

  const dot = document.createElement('div');
  dot.className = 'radio-dot';

  const info = document.createElement('div');
  info.className = 'proxy-info';
  info.innerHTML = `<div class="label">${esc(label)}</div><div class="addr">${esc(subtitle)}</div>`;

  row.appendChild(dot);
  row.appendChild(info);

  if (deletable) {
    const del = document.createElement('button');
    del.className = 'btn-delete';
    del.title = 'Remove';
    del.textContent = '×';
    del.addEventListener('click', (e) => { e.stopPropagation(); onDelete(id); });
    row.appendChild(del);
  }

  row.addEventListener('click', () => onActivate(id));
  return row;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Actions ────────────────────────────────────────────────────────────────

async function onActivate(id) {
  if (id === activeId) return;
  log('activate', id);

  let res;
  if (id === 'direct') {
    res = await send({ action: 'clearProxy' });
  } else {
    const p = proxies.find(x => x.id === id);
    if (!p) { setStatus('Proxy not found', 'err'); return; }
    res = await send({ action: 'setProxy', host: p.host, port: p.port, type: p.type || 'socks5' });
  }

  if (!res.ok) { setStatus('Error: ' + res.error, 'err'); return; }

  activeId = id;
  const p = proxies.find(x => x.id === id);
  await saveActiveProxy(p ? { host: p.host, port: p.port, type: p.type || 'socks5' } : null);

  render();
  setStatus(id === 'direct'
    ? 'System default'
    : 'Proxy active: ' + (p.type || 'socks5') + '://' + p.host + ':' + p.port, id === 'direct' ? '' : 'ok');
}

async function onDelete(id) {
  log('delete', id);
  if (id === activeId) {
    // deactivate first
    const res = await send({ action: 'clearProxy' });
    if (!res.ok) { setStatus('Error: ' + res.error, 'err'); return; }
    activeId = 'direct';
    await saveActiveProxy(null);
  }
  proxies = proxies.filter(p => p.id !== id);
  await saveProxies();
  render();
  setStatus('Proxy removed');
}

btnAdd.addEventListener('click', async () => {
  const label = newLabel.value.trim();
  const host  = newHost.value.trim();
  const port  = parseInt(newPort.value, 10);

  if (!label) { setStatus('Enter a label', 'err'); newLabel.focus(); return; }
  if (!host)  { setStatus('Enter host', 'err'); newHost.focus(); return; }
  if (!port || port < 1 || port > 65535) { setStatus('Enter valid port', 'err'); newPort.focus(); return; }

  const type = newType.value;
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  proxies.push({ id, label, host, port, type });
  await saveProxies();

  newLabel.value = '';
  newHost.value  = '';
  newPort.value  = '';
  newType.value  = 'socks5';

  render();
  setStatus('Added: ' + label, 'ok');
  log('addProxy', type, label, host, port);
});

function setStatus(msg, type) {
  log('status:', msg);
  statusEl.textContent = msg;
  statusEl.className = 'status-bar' + (type ? ' ' + type : '');
}

// ── Init ───────────────────────────────────────────────────────────────────

(async () => {
  log('popup loaded');
  await loadFromStorage();
  render();
  const p = proxies.find(x => x.id === activeId);
  setStatus(p
    ? 'Proxy active: ' + (p.type || 'socks5') + '://' + p.host + ':' + p.port
    : 'System default', p ? 'ok' : '');
})();
