'use strict';

const TAG = '[ForceProxy UI]';
const log = (...a) => console.log(TAG, ...a);

const listEl    = document.getElementById('proxy-list');
const dotEl     = document.getElementById('dot');
const statusEl  = document.getElementById('status');
const newLabel  = document.getElementById('new-label');
const newHost   = document.getElementById('new-host');
const newPort   = document.getElementById('new-port');
const newType   = document.getElementById('new-type');
const btnAdd    = document.getElementById('btn-add');
const titleEl   = document.querySelector('.add-title');
const hostLabel = document.getElementById('hostport-label');

// In-memory state (loaded from storage on init)
let proxies    = [];   // [{id, label, type, host, port} | {id, label, type:'pac', url}]
let activeId   = 'direct'; // 'direct' | proxy id
let editingId  = null; // proxy id currently loaded into the form for editing, or null

// ── Storage ────────────────────────────────────────────────────────────────

async function loadFromStorage() {
  const data = await chrome.storage.local.get(['proxies', 'activeProxy']);
  proxies  = data.proxies || [];
  const ap = data.activeProxy;
  if (ap) {
    // Match by id first; fall back to host+port for records saved by older
    // versions (which stored no id). PAC entries have no host+port, so the
    // id match is what keeps them selected.
    const found = (ap.id && proxies.find(p => p.id === ap.id)) ||
                  proxies.find(p => p.host === ap.host && p.port === ap.port);
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
  // proxy = activeDescriptor(p) or null
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

// ── Proxy descriptors ──────────────────────────────────────────────────────
// A proxy is either a fixed server (scheme+host+port) or a PAC entry (url).
// These helpers build the right shape for the worker message, the stored
// activeProxy, and the human-readable address line.

function setProxyMsg(p) {
  return p.type === 'pac'
    ? { action: 'setProxy', type: 'pac', url: p.url, label: p.label }
    : { action: 'setProxy', type: p.type || 'socks5', host: p.host, port: p.port, label: p.label };
}

function activeDescriptor(p) {
  return p.type === 'pac'
    ? { id: p.id, type: 'pac', url: p.url, label: p.label }
    : { id: p.id, type: p.type || 'socks5', host: p.host, port: p.port, label: p.label };
}

function describe(p) {
  return p.type === 'pac'
    ? 'PAC: ' + (p.url || '')
    : (p.type || 'socks5') + '://' + p.host + ':' + p.port;
}

// ── Render ─────────────────────────────────────────────────────────────────

function render() {
  listEl.innerHTML = '';
  listEl.appendChild(makeRow('direct', 'Direct', 'System default', activeId === 'direct', false));
  for (const p of proxies) {
    listEl.appendChild(makeRow(p.id, p.label, describe(p), activeId === p.id, true));
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
    const edit = document.createElement('button');
    edit.className = 'btn-edit';
    edit.title = 'Edit';
    edit.textContent = '✎';
    edit.addEventListener('click', (e) => { e.stopPropagation(); onEdit(id); });
    row.appendChild(edit);

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

// ── Form type switching ──────────────────────────────────────────────────
// PAC proxies take a single http(s) URL instead of host+port, so when type
// 'pac' is selected the form hides the port input and relabels the host field.

function updateFormForType() {
  const isPac = newType.value === 'pac';
  newPort.style.display = isPac ? 'none' : '';
  hostLabel.textContent = isPac ? 'PAC URL' : 'Host : Port';
  newHost.placeholder   = isPac ? 'http://localhost/proxy.pac' : '127.0.0.1';
}

newType.addEventListener('change', updateFormForType);

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
    res = await send(setProxyMsg(p));
  }

  if (!res.ok) { setStatus('Error: ' + res.error, 'err'); return; }

  activeId = id;
  const p = proxies.find(x => x.id === id);
  await saveActiveProxy(p ? activeDescriptor(p) : null);

  render();
  setStatus(p ? 'Proxy active: ' + describe(p) : 'System default', p ? 'ok' : '');
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
  if (id === editingId) cancelEdit(); // the row being edited is gone
  await saveProxies();
  render();
  setStatus('Proxy removed');
}

// Load a proxy into the form for editing. Clicking the same row's pencil again
// toggles edit mode back off.
function onEdit(id) {
  if (id === editingId) { cancelEdit(); setStatus(''); return; }
  const p = proxies.find(x => x.id === id);
  if (!p) return;
  log('edit', id);
  editingId = id;
  newLabel.value = p.label;
  newType.value  = p.type || 'socks5';
  if (p.type === 'pac') {
    newHost.value = p.url || '';
    newPort.value = '';
  } else {
    newHost.value = p.host;
    newPort.value = p.port;
  }
  updateFormForType();
  if (titleEl) titleEl.textContent = 'Edit proxy';
  btnAdd.textContent = 'Save';
  newLabel.focus();
  setStatus('Editing: ' + p.label);
}

// Leave edit mode and reset the form back to "add" defaults.
function cancelEdit() {
  editingId = null;
  if (titleEl) titleEl.textContent = 'Add proxy';
  btnAdd.textContent = '+ Add';
  clearForm();
}

function clearForm() {
  newLabel.value = '';
  newHost.value  = '';
  newPort.value  = '';
  newType.value  = 'socks5';
  updateFormForType();
}

btnAdd.addEventListener('click', async () => {
  const label = newLabel.value.trim();
  const type  = newType.value;

  if (!label) { setStatus('Enter a label', 'err'); newLabel.focus(); return; }

  // Gather + validate the type-specific fields.
  let fields;
  if (type === 'pac') {
    const url = newHost.value.trim();
    // Chrome's PAC fetcher only accepts http(s) (and data:) URLs — not file://.
    if (!/^https?:\/\//i.test(url)) {
      setStatus('Enter an http(s) PAC URL', 'err'); newHost.focus(); return;
    }
    fields = { label, type, url };
  } else {
    const host = newHost.value.trim();
    const port = parseInt(newPort.value, 10);
    if (!host) { setStatus('Enter host', 'err'); newHost.focus(); return; }
    if (!port || port < 1 || port > 65535) { setStatus('Enter valid port', 'err'); newPort.focus(); return; }
    fields = { label, type, host, port };
  }

  if (editingId) {
    // Update the existing proxy in place, preserving its id and list position.
    const p = proxies.find(x => x.id === editingId);
    if (p) {
      // Drop fields from the previous type so switching type leaves no stale keys.
      delete p.host; delete p.port; delete p.url;
      Object.assign(p, fields);
      await saveProxies();
      // If we just edited the active proxy, re-apply it so the new settings
      // take effect live and activeProxy stays matched.
      if (activeId === editingId) {
        const res = await send(setProxyMsg(p));
        if (!res.ok) { setStatus('Error: ' + res.error, 'err'); return; }
        await saveActiveProxy(activeDescriptor(p));
      }
    }
    log('editProxy', type, label);
    cancelEdit();
    render();
    setStatus('Saved: ' + label, 'ok');
    return;
  }

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  proxies.push({ id, ...fields });
  await saveProxies();
  clearForm();
  render();
  setStatus('Added: ' + label, 'ok');
  log('addProxy', type, label);
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
  updateFormForType();
  render();
  const p = proxies.find(x => x.id === activeId);
  setStatus(p ? 'Proxy active: ' + describe(p) : 'System default', p ? 'ok' : '');
})();
