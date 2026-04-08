'use strict';

const TAG = '[ForceProxy BG]';
const log = (...a) => console.log(TAG, ...a);
const err = (...a) => console.error(TAG, ...a);

// ── Proxy control ──────────────────────────────────────────────────────────

async function applyProxy(host, port, type) {
  type = type || 'socks5';
  log('applyProxy', type, host, port);
  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: type, host, port: parseInt(port, 10) },
        bypassList: []
      }
    },
    scope: 'regular'
  });
  log('applyProxy done');
}

async function clearProxy() {
  log('clearProxy');
  await chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' });
  log('clearProxy done');
}

// ── Restore on startup ─────────────────────────────────────────────────────

async function restoreState(reason) {
  log('restoreState, reason:', reason);
  try {
    const { activeProxy } = await chrome.storage.local.get('activeProxy');
    log('activeProxy:', JSON.stringify(activeProxy));
    if (activeProxy) {
      await applyProxy(activeProxy.host, activeProxy.port, activeProxy.type);
    } else {
      await clearProxy();
    }
  } catch (e) {
    err('restoreState failed:', e);
  }
}

chrome.runtime.onInstalled.addListener((d) => {
  log('onInstalled, reason:', d.reason);
  restoreState('onInstalled');
});

chrome.runtime.onStartup.addListener(() => {
  log('onStartup');
  restoreState('onStartup');
});

// ── Messages from popup ────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  log('onMessage:', JSON.stringify(msg));

  (async () => {
    try {
      if (msg.action === 'setProxy') {
        await applyProxy(msg.host, msg.port, msg.type);
        sendResponse({ ok: true });

      } else if (msg.action === 'clearProxy') {
        await clearProxy();
        sendResponse({ ok: true });

      } else {
        sendResponse({ ok: false, error: 'Unknown action: ' + msg.action });
      }
    } catch (e) {
      err('handler error:', e);
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});

log('service worker script loaded');
