// Isolated-world relay: forwards page events to the service worker and mirrors the
// capture-when-off flag into localStorage so main-world.js can read it synchronously.
const TAG = 'feishu-notify-ext-7f3a';
const CFG_KEY = '__feishuNotifyExtCfg';

function pushConfig(cfg) {
  const captureWhenOff = !!(cfg && cfg.captureWhenOff);
  try { localStorage.setItem(CFG_KEY, JSON.stringify({ captureWhenOff })); } catch (_) { /* ignore */ }
  window.postMessage({ source: TAG, kind: 'config', captureWhenOff }, '*');
}
chrome.storage.local.get('config', (r) => pushConfig(r.config));
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.config) pushConfig(ch.config.newValue); });

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.source !== TAG || e.data.kind !== 'event') return;
  try { chrome.runtime.sendMessage({ type: 'feishu-event', event: e.data.event }); } catch (_) { /* extension was reloaded */ }
});
