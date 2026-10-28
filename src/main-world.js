// Runs in the Feishu page (MAIN world) at document_start.
// Wraps the Notification APIs and watches the tab title; it only reads, never changes page content.
(() => {
  const TAG = 'feishu-notify-ext-7f3a';
  const CFG_KEY = '__feishuNotifyExtCfg';
  // Known issue 2: the setting is read synchronously from localStorage (written by relay.js),
  // so it is already in effect for the page's first permission check.
  let captureOff = false;
  try { captureOff = JSON.parse(localStorage.getItem(CFG_KEY) || '{}').captureWhenOff === true; } catch (_) { /* ignore */ }
  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === TAG && e.data.kind === 'config') captureOff = !!e.data.captureWhenOff;
  });

  const text = (el) => (el ? (el.innerText || el.textContent || '').trim() : '');
  const first = (sels) => { for (const s of sels) { const el = document.querySelector(s); if (el) return el; } return null; };

  // Best-effort DOM reads. Feishu markup is undocumented; any failure just yields null.
  function activeChatName() {
    try {
      return text(first(['[class*="chat-header"] [class*="title"]', '[class*="chatHeader"] [class*="name"]', '[class*="ChatHeader"] [class*="title"]'])) || null;
    } catch (_) { return null; }
  }
  function isMuted(chatName) {
    try {
      if (!chatName) return false;
      const items = document.querySelectorAll('[class*="feed-card"], [class*="FeedCard"], [class*="chat-item"], [class*="session-item"]');
      for (const it of items) {
        if (text(it).includes(chatName)) return !!it.querySelector('[class*="mute"], [class*="Mute"], [class*="dnd"]');
      }
    } catch (_) { /* ignore */ }
    return false;
  }
  function recentMessages(limit) {
    try {
      const nodes = document.querySelectorAll('[class*="message-item"], [class*="messageItem"], [class*="MessageItem"]');
      const out = [];
      for (const n of [...nodes].slice(-limit)) {
        const sender = text(n.querySelector('[class*="name"], [class*="sender"]')) || null;
        const body = text(n.querySelector('[class*="content"], [class*="text"]')) || text(n);
        if (body) out.push({ sender, text: body.slice(0, 1000) });
      }
      return out.length ? out : null;
    } catch (_) { return null; }
  }

  function emitNotification(title, options) {
    const t = String(title || '');
    const active = activeChatName();
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    window.postMessage({
      source: TAG, kind: 'event',
      event: {
        via: 'notification', title: t, body: String((options && options.body) || ''), at: Date.now(),
        focused, activeChat: active, muted: isMuted(t),
        // Context is only readable when the notified chat is the one open in the page.
        context: active && active === t ? recentMessages(10) : null,
      },
    }, '*');
  }

  const Real = window.Notification;
  if (Real) {
    const realPerm = Object.getOwnPropertyDescriptor(Real, 'permission');
    const realPermission = () => (realPerm && realPerm.get ? realPerm.get.call(Real) : 'default');
    function Wrapped(title, options) {
      emitNotification(title, options);
      if (captureOff && realPermission() !== 'granted') {
        // Inert stand-in so page code keeps working without showing a system notification.
        const d = new EventTarget();
        Object.assign(d, { title, body: options && options.body, close() {}, onclick: null, onshow: null, onclose: null, onerror: null });
        return d;
      }
      return new Real(title, options);
    }
    Wrapped.prototype = Real.prototype;
    Object.defineProperty(Wrapped, 'permission', { get: () => (captureOff ? 'granted' : realPermission()) });
    Wrapped.requestPermission = (...a) => (captureOff ? Promise.resolve('granted') : Real.requestPermission(...a));
    if ('maxActions' in Real) Object.defineProperty(Wrapped, 'maxActions', { get: () => Real.maxActions });
    window.Notification = Wrapped;
  }

  if (window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype.showNotification) {
    const orig = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
      emitNotification(title, options);
      return orig.call(this, title, options);
    };
  }

  // Title fallback. Known issue 1: match the count anywhere in the title ("(3) Feishu", "飞书 (3)",
  // full-width brackets, "3 条新消息") and observe <head> because Feishu may replace the <title> node.
  const COUNT = /[(（](\d+)[)）]|(\d+)\s*条新消息/;
  let last = null;
  const check = () => {
    const m = COUNT.exec(document.title || '');
    const n = m ? parseInt(m[1] || m[2], 10) : 0;
    if (last !== null && n > last) {
      window.postMessage({ source: TAG, kind: 'event', event: { via: 'titleCount', unreadDelta: n - last, unread: n, at: Date.now() } }, '*');
    }
    last = n;
  };
  setInterval(check, 3000);
  const start = () => {
    check();
    new MutationObserver(check).observe(document.head || document.documentElement, { childList: true, characterData: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
