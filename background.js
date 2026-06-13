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

// p is a proxy descriptor, one of:
//   fixed server → { type: socks5|http|https, host, port, label }
//   PAC          → { type: 'pac', url, label }
async function applyProxy(p) {
  const type = p.type || 'socks5';
  let value;
  if (type === 'pac') {
    // PAC by URL — Chrome fetches the script and runs FindProxyForURL itself.
    // Chrome's PAC fetcher only accepts http(s)/data: URLs (no file://).
    // mandatory:false → fall back to Direct if the script is bad/unreachable.
    log('applyProxy pac', p.url, 'label:', p.label);
    value = { mode: 'pac_script', pacScript: { url: p.url, mandatory: false } };
  } else {
    log('applyProxy', type, p.host, p.port, 'label:', p.label);
    value = {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: type, host: p.host, port: parseInt(p.port, 10) },
        bypassList: []
      }
    };
  }
  await chrome.proxy.settings.set({ value, scope: 'regular' });
  setActiveBadge(p.label);
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
    const { activeProxy, proxies, resetOnStartup } =
      await chrome.storage.local.get(['activeProxy', 'proxies', 'resetOnStartup']);
    log('activeProxy:', JSON.stringify(activeProxy), 'resetOnStartup:', !!resetOnStartup);

    // "Reset to Direct on browser start": on a real browser launch (onStartup),
    // drop any active proxy so a proxy left on doesn't carry into the next
    // session. Only onStartup — not onInstalled (extension update / dev reload).
    if (reason === 'onStartup' && resetOnStartup && activeProxy) {
      log('resetOnStartup enabled — clearing active proxy on startup');
      await chrome.storage.local.set({ activeProxy: null });
      await clearProxy();
      return;
    }

    if (activeProxy) {
      // Backfill label from the saved proxy list (records stored by older
      // versions have no label, which would otherwise fall back to "ON").
      // Match by id first, then host+port (legacy records have no id).
      let label = activeProxy.label;
      if (!label && Array.isArray(proxies)) {
        const found = proxies.find(
          p => (activeProxy.id && p.id === activeProxy.id) ||
               (p.host === activeProxy.host && String(p.port) === String(activeProxy.port))
        );
        if (found) label = found.label;
      }
      await applyProxy({ ...activeProxy, label });
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
        await applyProxy(msg);
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
