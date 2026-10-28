// Pure helpers that decide whether a notification belongs to the chat currently open in Feishu web.
// Loaded as a classic MAIN-world content script (before main-world.js) and importable under node --test.
// No exports on purpose: it assigns to globalThis so it works in both environments.
(() => {
  // Collapse all whitespace (including NBSP and zero-width chars) and trim.
  const norm = (s) => String(s == null ? '' : s).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[\s\u00a0\u3000]+/g, ' ').trim();

  // Candidate needles from a notification body: the full body and, for group notices shaped
  // "Sender: text" / "Sender：text", the part after the first colon.
  function bodyNeedles(body) {
    const b = norm(body);
    if (!b) return [];
    const out = [b];
    const m = /^[^:：]{1,64}[:：]\s*(.+)$/.exec(b);
    if (m && norm(m[1])) out.push(norm(m[1]));
    return out;
  }

  // True when one of the recent message texts (newest last) contains one of the body needles.
  // Very short needles (< 2 chars) are ignored to avoid accidental matches.
  function matchesOpenChat(body, recentTexts) {
    const needles = bodyNeedles(body).filter((n) => n.length >= 2);
    if (!needles.length || !Array.isArray(recentTexts)) return false;
    for (const t of recentTexts) {
      const h = norm(t);
      if (h && needles.some((n) => h.includes(n) || (h.length >= 2 && n.includes(h)))) return true;
    }
    return false;
  }

  globalThis.__feishuNotifyCtxMatch = { norm, bodyNeedles, matchesOpenChat };
})();
