// Pure logic shared by the service worker and Node unit tests. No chrome.* access here.

export const SCHEMA_VERSION = 1;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WORKDAY = { start: '09:00', end: '18:30' };

export const DEFAULT_CONFIG = Object.freeze({
  endpointUrl: '',
  apiKey: '',
  enabled: true,
  snoozeUntil: null,
  instanceName: '',
  myName: '', // empty disables @me detection
  excludeChats: [],
  includeOnlyChats: [],
  excludeSenders: [],
  botSenders: ['多维表格助手'],
  botPolicy: 'mark',
  mutedChats: 'followFeishu',
  mentionMe: 'priority',
  mentionAll: 'normal',
  chatTypes: { dm: true, group: true },
  ignoreTypes: ['recall', 'reaction', 'system'],
  priorityKeywords: ['任务', '需求', 'bug'],
  ignoreKeywords: [],
  useRegex: false,
  bodyMaxChars: 300,
  contextCount: 5,
  includeText: true,
  titleFallback: true,
  captureWhenOff: false,
  focusedChatPolicy: 'push',
  workHours: { mon: WORKDAY, tue: WORKDAY, wed: WORKDAY, thu: WORKDAY, fri: WORKDAY, sat: null, sun: null },
  timezone: 'Asia/Shanghai',
  batchWindowMin: 1,
  batchMax: 20,
  dedupeWindowMin: 10,
  queueMax: 200,
  debugLogSize: 20,
});

const ENUMS = {
  botPolicy: ['pass', 'mark', 'drop'],
  mutedChats: ['followFeishu', 'all', 'none'],
  mentionMe: ['normal', 'priority'],
  mentionAll: ['normal', 'ignore', 'priority'],
  focusedChatPolicy: ['skip', 'push'],
};
const RANGES = {
  bodyMaxChars: [50, 1000], contextCount: [0, 10], batchWindowMin: [1, 30], batchMax: [1, 20],
  dedupeWindowMin: [1, 60], queueMax: [20, 1000], debugLogSize: [0, 100],
};
const LISTS = ['excludeChats', 'includeOnlyChats', 'excludeSenders', 'botSenders', 'priorityKeywords', 'ignoreKeywords'];
const BOOLS = ['enabled', 'useRegex', 'includeText', 'titleFallback', 'captureWhenOff'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Merge user input over defaults; returns { config, errors } where errors lists rejected keys. */
export function normalizeConfig(input = {}) {
  const c = structuredClone(DEFAULT_CONFIG);
  const errors = [];
  for (const [k, v] of Object.entries(input || {})) {
    if (!(k in DEFAULT_CONFIG)) { errors.push(k); continue; }
    let ok = true;
    if (k in ENUMS) ok = ENUMS[k].includes(v);
    else if (k in RANGES) ok = Number.isInteger(v) && v >= RANGES[k][0] && v <= RANGES[k][1];
    else if (LISTS.includes(k)) ok = Array.isArray(v) && v.every((s) => typeof s === 'string');
    else if (BOOLS.includes(k)) ok = typeof v === 'boolean';
    else if (k === 'endpointUrl') ok = v === '' || /^https:\/\/[^\s]+$/.test(v);
    else if (k === 'apiKey' || k === 'myName' || k === 'instanceName') ok = typeof v === 'string';
    else if (k === 'snoozeUntil') ok = v === null || !Number.isNaN(Date.parse(v));
    else if (k === 'timezone') ok = isValidTimeZone(v);
    else if (k === 'chatTypes') ok = v && typeof v.dm === 'boolean' && typeof v.group === 'boolean';
    else if (k === 'ignoreTypes') ok = Array.isArray(v) && v.every((t) => ['recall', 'reaction', 'system'].includes(t));
    else if (k === 'workHours') ok = validWorkHours(v);
    if (ok) c[k] = LISTS.includes(k) ? v.map((s) => s.trim()).filter(Boolean) : v;
    else errors.push(k);
  }
  return { config: c, errors };
}

function validWorkHours(v) {
  if (!v || typeof v !== 'object') return false;
  return DAYS.every((d) => v[d] === null || v[d] === undefined ||
    (HHMM.test(v[d].start) && HHMM.test(v[d].end) && v[d].start < v[d].end));
}

export function isValidTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string'; } catch { return false; }
}

/** Wall-clock parts of `date` in `timeZone` (fixes the spike's locale-dependent display, known issue 4). */
export function zonedParts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: p.weekday.slice(0, 3).toLowerCase() };
}

/** ISO 8601 string with the zone's numeric offset, e.g. 2026-10-28T19:12:40+08:00. */
export function toZonedIso(date, timeZone) {
  const z = zonedParts(date, timeZone);
  const asUtc = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s);
  const offMin = Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offMin >= 0 ? '+' : '-';
  const a = Math.abs(offMin);
  const pad = (n) => String(n).padStart(2, '0');
  return `${z.y}-${pad(z.mo)}-${pad(z.d)}T${pad(z.h)}:${pad(z.mi)}:${pad(z.s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function formatClock(date, timeZone) {
  const z = zonedParts(date, timeZone);
  return `${String(z.mo).padStart(2, '0')}-${String(z.d).padStart(2, '0')} ${String(z.h).padStart(2, '0')}:${String(z.mi).padStart(2, '0')}`;
}

export function isWorkTime(date, cfg) {
  const z = zonedParts(date, cfg.timezone);
  const w = cfg.workHours[z.wd];
  if (!w) return false;
  const hm = `${String(z.h).padStart(2, '0')}:${String(z.mi).padStart(2, '0')}`;
  return hm >= w.start && hm < w.end;
}

/** Next instant (ms) when work hours begin, scanning up to 8 days ahead minute-precise via hour steps. */
export function nextWorkStart(date, cfg) {
  if (isWorkTime(date, cfg)) return date.getTime();
  const step = 60 * 1000;
  let t = Math.ceil(date.getTime() / step) * step;
  const limit = t + 8 * 24 * 3600 * 1000;
  // Coarse 15-minute scan then refine to the minute.
  for (; t < limit; t += 15 * step) {
    if (isWorkTime(new Date(t), cfg)) {
      let u = t - 15 * step;
      while (!isWorkTime(new Date(u), cfg)) u += step;
      return u;
    }
  }
  return null;
}

/** Parse a notification into chat/sender/body. Feishu group bodies look like "Sender: text". */
export function parseNotification(title, body) {
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  const m = /^([^:：\n]{1,40})[:：]\s*([\s\S]*)$/.exec(b);
  if (m) return { chatName: t || null, sender: m[1].trim(), text: m[2], chatType: 'group' };
  // DM notifications carry the peer's name as the title and plain text as the body,
  // so the chat name is also the sender (A06 step 5).
  return { chatName: t || null, sender: t || null, text: b, chatType: t ? 'dm' : 'unknown' };
}

const TYPE_PATTERNS = {
  recall: /撤回了一条消息|recalled a message/i,
  reaction: /回应了|reacted|表情回复/i,
  system: /^(\[系统消息\]|系统消息|加入了群聊|退出了群聊|修改了群名称)|joined the group|left the group/i,
};

export function detectType(text) {
  for (const [k, re] of Object.entries(TYPE_PATTERNS)) if (re.test(text)) return k;
  return 'message';
}

function matcher(list, useRegex) {
  const items = list.map((s) => {
    if (!useRegex) return (x) => x.toLowerCase().includes(s.toLowerCase());
    try { const re = new RegExp(s, 'i'); return (x) => re.test(x); } catch { return () => false; }
  });
  return (x) => {
    for (let i = 0; i < items.length; i++) if (x && items[i](x)) return list[i];
    return null;
  };
}
const sub = (list) => (x) => !!x && list.some((s) => x.toLowerCase().includes(s.toLowerCase()));

/**
 * Apply contract §4 filter order to a raw captured event.
 * Returns { drop: reason } or { event } with marks set (priority not yet ordered).
 * raw: { via, title, body, at(ms), focused, activeChat, muted, unreadDelta, context }
 */
export function classify(raw, cfg, now = new Date()) {
  if (raw.via === 'titleCount') {
    if (!cfg.titleFallback) return { drop: 'titleFallback-off' };
    if (cfg.mutedChats === 'none') return { drop: 'muted-none' };
    return {
      event: {
        via: 'titleCount', capturedAt: raw.at, chatName: null, sender: null, chatType: 'unknown',
        body: `unread +${raw.unreadDelta}`, truncated: false, unreadDelta: raw.unreadDelta,
        marks: isWorkTime(now, cfg) ? [] : ['outsideHours'], context: null, contextAvailable: false,
      },
    };
  }
  const p = parseNotification(raw.title, raw.body);
  const type = detectType(p.text);
  if (type !== 'message' && cfg.ignoreTypes.includes(type)) return { drop: `type-${type}` };
  if (!cfg.chatTypes[p.chatType === 'unknown' ? 'dm' : p.chatType]) return { drop: `chatType-${p.chatType}` };
  if (sub(cfg.excludeChats)(p.chatName)) return { drop: 'excludeChats' };
  if (cfg.includeOnlyChats.length && !sub(cfg.includeOnlyChats)(p.chatName)) return { drop: 'includeOnlyChats' };
  if (sub(cfg.excludeSenders)(p.sender) || (p.chatType === 'dm' && sub(cfg.excludeSenders)(p.chatName))) return { drop: 'excludeSenders' };
  const full = `${p.chatName || ''}\n${p.sender || ''}\n${p.text}`;
  if (matcher(cfg.ignoreKeywords, cfg.useRegex)(full)) return { drop: 'ignoreKeywords' };
  if (raw.muted && cfg.mutedChats === 'followFeishu') return { drop: 'muted' };
  if (cfg.focusedChatPolicy === 'skip' && raw.focused && raw.activeChat && p.chatName && raw.activeChat === p.chatName) {
    return { drop: 'focusedChat' };
  }
  const isBot = sub(cfg.botSenders)(p.sender) || (p.chatType === 'dm' && sub(cfg.botSenders)(p.chatName));
  if (isBot && cfg.botPolicy === 'drop') return { drop: 'bot' };

  const marks = [];
  if (isBot && cfg.botPolicy === 'mark') marks.push('bot');
  const mentionMe = !!cfg.myName && p.text.includes(`@${cfg.myName}`);
  if (mentionMe) marks.push('mentionMe');
  const mentionAll = /@所有人|@all\b|@everyone/i.test(p.text);
  if (mentionAll && cfg.mentionAll === 'ignore') return { drop: 'mentionAll-ignore' };
  if (mentionAll) marks.push('mentionAll');
  const kw = matcher(cfg.priorityKeywords, cfg.useRegex)(full);
  if (kw) marks.push(`keyword:${kw}`);
  if (kw || (mentionMe && cfg.mentionMe === 'priority') || (mentionAll && cfg.mentionAll === 'priority')) marks.unshift('priority');
  if (!isWorkTime(now, cfg)) marks.push('outsideHours');

  const max = cfg.bodyMaxChars;
  const cut = (s) => (s.length > max ? s.slice(0, max) + '…' : s);
  const text = cfg.includeText ? p.text : '';
  const context = cfg.includeText && Array.isArray(raw.context) && raw.context.length
    ? raw.context.slice(-cfg.contextCount).map((m) => ({ sender: m.sender || null, text: cut(String(m.text || '')) }))
    : null;
  return {
    event: {
      via: 'notification', capturedAt: raw.at, chatName: p.chatName, sender: p.sender, chatType: p.chatType,
      body: cut(text), truncated: text.length > max, marks,
      context: cfg.contextCount === 0 ? null : context, contextAvailable: !!(context && cfg.contextCount),
    },
  };
}

/** Stable dedupe key: first 16 hex chars of SHA-1 over normalized chat|sender|body. */
export async function eventKey(ev) {
  const norm = [ev.chatName || '', ev.sender || '', ev.via === 'titleCount' ? `${ev.via}:${ev.capturedAt}` : ev.body]
    .map((s) => String(s).replace(/\s+/g, ' ').trim()).join('|');
  const buf = await globalThis.crypto.subtle.digest('SHA-1', new TextEncoder().encode(norm));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** True if key was seen within window; prunes old entries in place. seen: { key: ms } */
export function isDuplicate(seen, key, nowMs, windowMin) {
  const w = windowMin * 60000;
  for (const k of Object.keys(seen)) if (nowMs - seen[k] > w) delete seen[k];
  if (seen[key] !== undefined) return true;
  seen[key] = nowMs;
  return false;
}

/**
 * F-01: a title-count event is only kept when no notification event arrived within `graceMs`
 * before it (the notification already explains the unread bump).
 */
export function shouldKeepTitleEvent(lastNotificationMs, titleMs, graceMs = 15000) {
  return !(lastNotificationMs && titleMs - lastNotificationMs <= graceMs && titleMs >= lastNotificationMs);
}

/** Add to queue respecting queueMax; drops oldest non-priority first, then oldest. Returns dropped count. */
export function enqueue(queue, ev, queueMax) {
  queue.push(ev);
  let dropped = 0;
  while (queue.length > queueMax) {
    const i = queue.findIndex((e) => !e.marks.includes('priority'));
    queue.splice(i >= 0 ? i : 0, 1);
    dropped++;
  }
  return dropped;
}

/** Order: priority first, then by capture time; take up to batchMax. Returns { batch, rest }. */
export function takeBatch(queue, batchMax) {
  const sorted = queue.map((e, i) => ({ e, i })).sort((a, b) => {
    const pa = a.e.marks.includes('priority') ? 0 : 1;
    const pb = b.e.marks.includes('priority') ? 0 : 1;
    return pa - pb || (a.e.capturedAt < b.e.capturedAt ? -1 : a.e.capturedAt > b.e.capturedAt ? 1 : a.i - b.i);
  });
  const chosen = new Set(sorted.slice(0, batchMax).map((x) => x.i));
  return { batch: sorted.slice(0, batchMax).map((x) => x.e), rest: queue.filter((_, i) => !chosen.has(i)) };
}

export function buildPayload({ events, cfg, instanceId, extVersion, kind = 'batch', reason, droppedCount = 0, now = new Date() }) {
  return {
    source: 'feishu-notify-extension', schemaVersion: SCHEMA_VERSION, extVersion,
    instanceId, instanceName: cfg.instanceName || `chrome-${instanceId.slice(0, 4)}`,
    kind, sentAt: toZonedIso(now, cfg.timezone), reason, droppedCount,
    events: events.map((e) => ({ ...e, capturedAt: toZonedIso(new Date(e.capturedAt), cfg.timezone) })),
  };
}

/** Decide what to do with an HTTP result. */
export function classifyResponse(res) {
  if (res && res.status >= 200 && res.status < 300) return 'ok';
  if (res && (res.status === 401 || res.status === 403)) return 'auth';
  return 'retry';
}

/**
 * Contract C1: any 401/403 (batch or test push) pauses auto-push; a 2xx lifts the pause;
 * other failures leave it unchanged. Saving settings also lifts it (handled by the caller).
 */
export function nextAuthPaused(prev, verdict) {
  if (verdict === 'auth') return true;
  if (verdict === 'ok') return false;
  return prev;
}

/** Export config without the key (contract §4). */
export function exportConfig(cfg, now = new Date()) {
  const { apiKey, ...rest } = cfg; // eslint-disable-line no-unused-vars
  return { schemaVersion: SCHEMA_VERSION, exportedAt: now.toISOString(), config: rest };
}

/** Import keeps local apiKey; returns { config, errors }. */
export function importConfig(json, current) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || data.schemaVersion !== SCHEMA_VERSION || typeof data.config !== 'object') throw new Error('Unsupported config file');
  const { apiKey, ...incoming } = data.config; // eslint-disable-line no-unused-vars
  const { config, errors } = normalizeConfig({ ...current, ...incoming });
  config.apiKey = current.apiKey || '';
  return { config, errors };
}

/** Mask secrets for logs/UI: keep last 4 chars. */
export function mask(s) {
  if (!s) return '';
  return s.length <= 4 ? '••••' : `••••${s.slice(-4)}`;
}
