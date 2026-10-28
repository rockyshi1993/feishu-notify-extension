// Service worker: filters, dedupes, queues and batches events, then POSTs them to the
// Grok Bot receiver. All state lives in chrome.storage.local so a restarted worker resumes.
import {
  normalizeConfig, classify, eventKey, isDuplicate, shouldKeepTitleEvent, enqueue, takeBatch,
  buildPayload, classifyResponse, isWorkTime, nextWorkStart, formatClock, exportConfig, importConfig,
} from './lib/core.js';

const EXT_VERSION = chrome.runtime.getManifest().version;
const RETRY_DELAY_MIN = 0.5;
const TIMEOUT_MS = 15000;

let chain = Promise.resolve();
// Serialize every state mutation so concurrent events cannot overwrite each other.
const locked = (fn) => (chain = chain.then(fn, fn).catch((e) => console.warn('[feishu-notify]', e)));

async function load() {
  const r = await chrome.storage.local.get(['config', 'state']);
  const { config } = normalizeConfig(r.config || {});
  const state = Object.assign({
    queue: [], log: [], seen: {}, lastSend: null, droppedSinceLast: 0, authPaused: false,
    lastNotificationMs: 0, instanceId: '', inFlight: false,
  }, r.state || {});
  if (!state.instanceId) state.instanceId = crypto.randomUUID();
  return { config, state };
}
const saveState = (state) => chrome.storage.local.set({ state });

function log(state, cfg, entry) {
  state.log.unshift({ ...entry, at: Date.now() });
  state.log = state.log.slice(0, cfg.debugLogSize);
}

function paused(cfg, state, now = Date.now()) {
  return !cfg.enabled || state.authPaused || (cfg.snoozeUntil && Date.parse(cfg.snoozeUntil) > now);
}

async function updateBadge(cfg, state) {
  const n = state.queue.length;
  if (state.authPaused || (state.lastSend && !state.lastSend.ok)) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
    await chrome.action.setBadgeText({ text: '!' });
  } else {
    await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
    await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 999)) : '' });
  }
}

/** Decide the next wake-up after any change. */
async function schedule(cfg, state) {
  await chrome.alarms.clear('flush');
  await chrome.alarms.clear('workStart');
  await chrome.alarms.clear('priority');
  if (!state.queue.length || !cfg.endpointUrl) return;
  const now = new Date();
  if (cfg.snoozeUntil && Date.parse(cfg.snoozeUntil) > now.getTime()) {
    chrome.alarms.create('workStart', { when: Date.parse(cfg.snoozeUntil) + 1000 });
    return;
  }
  if (paused(cfg, state)) return;
  if (!isWorkTime(now, cfg)) {
    const t = nextWorkStart(now, cfg);
    if (t) chrome.alarms.create('workStart', { when: t + 1000 });
    return;
  }
  if (state.queue.some((e) => e.marks.includes('priority'))) {
    chrome.alarms.create('priority', { when: Date.now() + 1000 }); // priority: push right away
    return;
  }
  const oldest = Math.min(...state.queue.map((e) => e.capturedAt));
  chrome.alarms.create('flush', { when: Math.max(Date.now() + 1000, oldest + cfg.batchWindowMin * 60000) });
}

async function post(cfg, payload) {
  if (!cfg.endpointUrl || !cfg.apiKey) return { ok: false, status: 0, error: 'not configured' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(cfg.endpointUrl, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(payload),
    });
    return { ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e), ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

async function flush(reason, attempt = 1) {
  const { config: cfg, state } = await load();
  if (!state.queue.length || paused(cfg, state)) { await saveState(state); return schedule(cfg, state); }
  if (!isWorkTime(new Date(), cfg) && reason !== 'manual') { await saveState(state); return schedule(cfg, state); }
  const { batch, rest } = takeBatch(state.queue, cfg.batchMax);
  const payload = buildPayload({
    events: batch, cfg, instanceId: state.instanceId, extVersion: EXT_VERSION,
    reason: attempt > 1 ? 'retry' : reason, droppedCount: state.droppedSinceLast,
  });
  const res = await post(cfg, payload);
  const verdict = classifyResponse(res);
  state.lastSend = { at: Date.now(), count: batch.length, ok: verdict === 'ok', status: res.status, error: res.error || null };
  if (verdict === 'ok') {
    state.queue = rest;
    state.droppedSinceLast = 0;
    log(state, cfg, { kind: 'sent', note: `${batch.length} event(s), HTTP ${res.status}` });
  } else if (verdict === 'auth') {
    state.authPaused = true; // contract C1: stop auto-push until settings are fixed
    log(state, cfg, { kind: 'error', note: `HTTP ${res.status}: key rejected, auto-push paused` });
  } else {
    log(state, cfg, { kind: 'error', note: `send failed (${res.status || res.error}), attempt ${attempt}` });
    if (attempt === 1) {
      await saveState(state);
      await updateBadge(cfg, state);
      chrome.alarms.create('retry', { delayInMinutes: RETRY_DELAY_MIN });
      return;
    }
  }
  await saveState(state);
  await updateBadge(cfg, state);
  return schedule(cfg, state);
}

async function onEvent(raw) {
  const { config: cfg, state } = await load();
  const nowMs = Date.now();
  if (raw.via === 'notification') state.lastNotificationMs = raw.at || nowMs;
  if (raw.via === 'titleCount' && !shouldKeepTitleEvent(state.lastNotificationMs, raw.at || nowMs)) {
    // F-01: the unread bump is already explained by a notification (or by a muted chat it cannot name).
    log(state, cfg, { kind: 'drop', note: 'title count covered by notification' });
    return saveState(state);
  }
  const res = classify({ ...raw, at: raw.at || nowMs }, cfg, new Date(nowMs));
  if (res.drop) {
    log(state, cfg, { kind: 'drop', note: res.drop, chat: raw.title || null });
    return saveState(state);
  }
  const ev = res.event;
  ev.eventKey = await eventKey(ev);
  if (isDuplicate(state.seen, ev.eventKey, nowMs, cfg.dedupeWindowMin)) {
    log(state, cfg, { kind: 'drop', note: 'duplicate', chat: ev.chatName });
    return saveState(state);
  }
  state.droppedSinceLast += enqueue(state.queue, ev, cfg.queueMax);
  log(state, cfg, { kind: 'queued', chat: ev.chatName, note: (ev.body || '').slice(0, 80), marks: ev.marks });
  await saveState(state);
  await updateBadge(cfg, state);
  await schedule(cfg, state);
}

async function testPush() {
  const { config: cfg, state } = await load();
  const payload = buildPayload({
    events: [], cfg, instanceId: state.instanceId, extVersion: EXT_VERSION, kind: 'test', reason: 'test',
    droppedCount: state.droppedSinceLast,
  });
  const res = await post(cfg, payload);
  const verdict = classifyResponse(res);
  state.lastSend = { at: Date.now(), count: 0, ok: verdict === 'ok', status: res.status, error: res.error || null, test: true };
  if (verdict === 'ok') state.authPaused = false; // a working key lifts the C1 pause
  log(state, cfg, { kind: 'test', note: `HTTP ${res.status || res.error}` });
  await saveState(state);
  await updateBadge(cfg, state);
  await schedule(cfg, state);
  return { ...res, verdict };
}

async function status() {
  const { config: cfg, state } = await load();
  const now = new Date();
  let mode = 'running';
  if (!cfg.enabled) mode = 'disabled';
  else if (state.authPaused) mode = 'authInvalid';
  else if (cfg.snoozeUntil && Date.parse(cfg.snoozeUntil) > now.getTime()) mode = 'snoozed';
  else if (!isWorkTime(now, cfg)) mode = 'outsideHours';
  if (!cfg.endpointUrl || !cfg.apiKey) mode = 'notConfigured';
  return {
    mode, queue: state.queue.length, dropped: state.droppedSinceLast, lastSend: state.lastSend,
    log: state.log.map((l) => ({ ...l, time: formatClock(new Date(l.at), cfg.timezone) })),
    lastSendTime: state.lastSend ? formatClock(new Date(state.lastSend.at), cfg.timezone) : null,
    instanceId: state.instanceId, snoozeUntil: cfg.snoozeUntil, timezone: cfg.timezone,
  };
}

async function setConfig(patch) {
  const r = await chrome.storage.local.get('config');
  const { config, errors } = normalizeConfig({ ...(r.config || {}), ...patch });
  await chrome.storage.local.set({ config });
  return { errors };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const run = (fn) => { locked(async () => reply(await fn())); return true; };
  if (msg && msg.type === 'feishu-event') { locked(() => onEvent(msg.event)); return false; }
  // Everything else is only accepted from the extension's own pages, never from content scripts.
  if (sender.tab || !String(sender.url || '').startsWith(chrome.runtime.getURL(''))) return false;
  switch (msg && msg.type) {
    case 'test-push': return run(testPush);
    case 'status': return run(status);
    case 'flush-now': return run(async () => { await flush('manual'); return status(); });
    case 'snooze': return run(async () => { await setConfig({ snoozeUntil: msg.until }); const s = await load(); await schedule(s.config, s.state); return status(); });
    case 'resume': return run(async () => {
      await setConfig({ snoozeUntil: null, enabled: true });
      const s = await load(); s.state.authPaused = false; await saveState(s.state); await schedule(s.config, s.state); return status();
    });
    case 'save-config': return run(async () => {
      const out = await setConfig(msg.config);
      const s = await load(); s.state.authPaused = false; await saveState(s.state); await schedule(s.config, s.state);
      return out;
    });
    case 'export-config': return run(async () => exportConfig((await load()).config));
    case 'import-config': return run(async () => {
      const cur = (await load()).config;
      const { config, errors } = importConfig(msg.json, cur);
      await chrome.storage.local.set({ config });
      return { errors };
    });
    default: return false;
  }
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'flush') locked(() => flush('window'));
  else if (a.name === 'workStart') locked(() => flush('workStart'));
  else if (a.name === 'priority') locked(() => flush('priority'));
  else if (a.name === 'retry') locked(() => flush('retry', 2));
});

chrome.runtime.onStartup.addListener(() => locked(async () => { const s = await load(); await saveState(s.state); await updateBadge(s.config, s.state); await schedule(s.config, s.state); }));
chrome.runtime.onInstalled.addListener(() => locked(async () => {
  const s = await load();
  await chrome.storage.local.set({ config: s.config });
  await saveState(s.state);
  await schedule(s.config, s.state);
}));
