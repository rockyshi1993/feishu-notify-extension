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
  // Real Feishu web markup (probed 2026-10-28): the open chat is `.chat-tabPanel-active`, each message is
  // `.js-message-item` (with `message-self` / `message-not-self`), its bubble text lives in `.message-right`.
  // No chat-header name element was found, so "open chat" is inferred by matching the notification body
  // against the newest message bubbles. Old guessed selectors are kept as fallbacks.
  const MSG_SELS = ['.chat-tabPanel-active .js-message-item', '.js-message-item',
    '[class*="message-item"], [class*="messageItem"], [class*="MessageItem"]'];
  const ctx = () => globalThis.__feishuNotifyCtxMatch;
  function messageNodes() {
    for (const s of MSG_SELS) { const n = document.querySelectorAll(s); if (n.length) return [...n]; }
    return [];
  }
  function bubbleText(n) {
    return text(n.querySelector('.message-right')) || text(n.querySelector('.message-content'))
      || text(n.querySelector('[class*="content"], [class*="text"]')) || text(n);
  }
  function recentTexts(limit) {
    try { return messageNodes().slice(-limit).map(bubbleText).filter(Boolean); } catch (_) { return []; }
  }
  function recentMessages(limit, p2pName) {
    try {
      const out = [];
      for (const n of messageNodes().slice(-limit)) {
        const cl = n.classList;
        // Group sender names were not present in the probe; fall back to old guesses, then to known cases.
        let sender = text(n.querySelector('[class*="sender"], [class*="name"]')) || null;
        if (!sender && cl && cl.contains('message-self')) sender = 'me';
        else if (!sender && cl && cl.contains('message-is-p2p') && cl.contains('message-not-self')) sender = p2pName || null;
        const body = bubbleText(n);
        if (body) out.push({ sender, text: body.slice(0, 1000) });
      }
      return out.length ? out : null;
    } catch (_) { return null; }
  }
  function isOpenChat(title, body) {
    try {
      const m = ctx();
      if (m && m.matchesOpenChat(body, recentTexts(5))) return true;
      const legacy = activeChatName();
      return !!legacy && legacy === title;
    } catch (_) { return false; }
  }

  function emitNotification(title, options) {
    const t = String(title || '');
    const b = String((options && options.body) || '');
    const at = Date.now();
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    const post = (open) => window.postMessage({
      source: TAG, kind: 'event',
      event: {
        via: 'notification', title: t, body: b, at,
        focused, activeChat: open ? t : null, muted: isMuted(t),
        // Context is only readable when the notified chat is the one open in the page.
        context: open ? recentMessages(10, t) : null,
      },
    }, '*');
    // The message list may render slightly after the Notification call: check now, then retry
    // at 300 ms and 1200 ms before posting exactly one event.
    let done = false;
    const attempt = (final) => {
      if (done) return;
      const open = isOpenChat(t, b);
      if (open || final) { done = true; post(open); }
    };
    try { attempt(false); } catch (_) { /* ignore */ }
    setTimeout(() => { try { attempt(false); } catch (_) { /* ignore */ } }, 300);
    setTimeout(() => { try { attempt(true); } catch (_) { if (!done) { done = true; post(false); } } }, 1200);
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
