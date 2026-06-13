'use strict';

const TAG = '[ForceProxy BG]';
const log = (...a) => console.log(TAG, ...a);
const err = (...a) => console.error(TAG, ...a);

// ── Icon badge ───────────────────────────────────────────────────────────────

// Chrome fits ~3-4 narrow chars on the action badge, so we show the first few
// characters of the proxy label as a "banner" over the icon.
function badgeTextFor(label) {
  const s = (label || '').trim();
  return s ? s.slice(0, 3) : 'ON';
}

function setActiveBadge(label) {
  try {
    chrome.action.setBadgeBackgroundColor({ color: '#2e7d32' });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: '#ffffff' });
    }
    chrome.action.setBadgeText({ text: badgeTextFor(label) });
  } catch (e) {
    err('setActiveBadge failed:', e);
  }
}

function clearBadge() {
  try {
    chrome.action.setBadgeText({ text: '' });
  } catch (e) {
    err('clearBadge failed:', e);
  }
}

// ── Proxy control ──────────────────────────────────────────────────────────

async function applyProxy(host, port, type, label) {
  type = type || 'socks5';
  log('applyProxy', type, host, port, 'label:', label);
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
  setActiveBadge(label);
  log('applyProxy done');
}

async function clearProxy() {
  log('clearProxy');
  await chrome.proxy.settings.set({ value: { mode: 'system' }, scope: 'regular' });
  clearBadge();
  log('clearProxy done');
}

// ── Restore on startup ─────────────────────────────────────────────────────

async function restoreState(reason) {
  log('restoreState, reason:', reason);
  try {
    const { activeProxy, proxies } = await chrome.storage.local.get(['activeProxy', 'proxies']);
    log('activeProxy:', JSON.stringify(activeProxy));
    if (activeProxy) {
      // Backfill label from the saved proxy list (records stored by older
      // versions have no label, which would otherwise fall back to "ON").
      let label = activeProxy.label;
      if (!label && Array.isArray(proxies)) {
        const found = proxies.find(
          p => p.host === activeProxy.host && String(p.port) === String(activeProxy.port)
        );
        if (found) label = found.label;
      }
      await applyProxy(activeProxy.host, activeProxy.port, activeProxy.type, label);
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
        await applyProxy(msg.host, msg.port, msg.type, msg.label);
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
