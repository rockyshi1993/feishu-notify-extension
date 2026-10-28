// Options page: edit config, test push, import/export (export never contains the key).
import { DEFAULT_CONFIG, mask } from './lib/core.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const LISTS = ['excludeChats', 'includeOnlyChats', 'excludeSenders', 'botSenders', 'priorityKeywords', 'ignoreKeywords'];
const TEXTS = ['endpointUrl', 'instanceName', 'myName', 'timezone'];
const SELECTS = ['botPolicy', 'mutedChats', 'mentionMe', 'mentionAll', 'focusedChatPolicy'];
const BOOLS = ['enabled', 'useRegex', 'includeText', 'titleFallback', 'captureWhenOff'];
const NUMS = ['bodyMaxChars', 'contextCount', 'batchWindowMin', 'batchMax', 'dedupeWindowMin', 'queueMax', 'debugLogSize'];
const status = (t) => { $('status').textContent = t; };
const send = (m) => chrome.runtime.sendMessage(m);

function buildHours() {
  const tb = $('hours');
  for (const d of DAYS) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d}</td><td><input type="checkbox" id="wh_${d}_on"></td><td><input type="time" id="wh_${d}_s"></td><td><input type="time" id="wh_${d}_e"></td>`;
    tb.appendChild(tr);
  }
}

async function load() {
  const { config = {} } = await chrome.storage.local.get('config');
  const c = { ...DEFAULT_CONFIG, ...config };
  TEXTS.forEach((k) => { $(k).value = c[k] || ''; });
  SELECTS.forEach((k) => { $(k).value = c[k]; });
  BOOLS.forEach((k) => { $(k).checked = !!c[k]; });
  NUMS.forEach((k) => { $(k).value = c[k]; });
  LISTS.forEach((k) => { $(k).value = (c[k] || []).join('\n'); });
  $('ct_dm').checked = c.chatTypes.dm; $('ct_group').checked = c.chatTypes.group;
  ['recall', 'reaction', 'system'].forEach((t) => { $(`it_${t}`).checked = c.ignoreTypes.includes(t); });
  for (const d of DAYS) {
    const w = c.workHours[d];
    $(`wh_${d}_on`).checked = !!w; $(`wh_${d}_s`).value = w ? w.start : '09:00'; $(`wh_${d}_e`).value = w ? w.end : '18:30';
  }
  $('apiKey').value = '';
  $('keyHint').textContent = c.apiKey ? `Saved key: ${mask(c.apiKey)}` : 'No key saved';
}

function collect() {
  const o = {};
  TEXTS.forEach((k) => { o[k] = $(k).value.trim(); });
  SELECTS.forEach((k) => { o[k] = $(k).value; });
  BOOLS.forEach((k) => { o[k] = $(k).checked; });
  NUMS.forEach((k) => { o[k] = parseInt($(k).value, 10); });
  LISTS.forEach((k) => { o[k] = $(k).value.split('\n').map((s) => s.trim()).filter(Boolean); });
  o.chatTypes = { dm: $('ct_dm').checked, group: $('ct_group').checked };
  o.ignoreTypes = ['recall', 'reaction', 'system'].filter((t) => $(`it_${t}`).checked);
  o.workHours = {};
  for (const d of DAYS) o.workHours[d] = $(`wh_${d}_on`).checked ? { start: $(`wh_${d}_s`).value, end: $(`wh_${d}_e`).value } : null;
  const key = $('apiKey').value.trim();
  if (key) o.apiKey = key;
  return o;
}

async function save() {
  const o = collect();
  if (o.endpointUrl) {
    let origin;
    try { origin = new URL(o.endpointUrl).origin; } catch { status('Invalid URL'); return false; }
    // Host permission for the receiver must be requested from a user gesture.
    if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) { status('Host permission denied'); return false; }
  }
  const r = await send({ type: 'save-config', config: o });
  $('errors').textContent = r.errors && r.errors.length ? `Rejected (kept previous value): ${r.errors.join(', ')}` : '';
  status('Saved');
  await load();
  return true;
}

buildHours();
$('save').onclick = save;
$('test').onclick = async () => {
  if (!(await save())) return;
  status('Sending…');
  const r = await send({ type: 'test-push' });
  status(r.verdict === 'ok' ? `Test OK (HTTP ${r.status}, ${r.ms} ms)` : `Test failed (${r.status || r.error})`);
};
$('export').onclick = async () => {
  const data = await send({ type: 'export-config' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'feishu-notify-config.json';
  a.click();
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await send({ type: 'import-config', json: await f.text() });
    $('errors').textContent = r.errors && r.errors.length ? `Ignored fields: ${r.errors.join(', ')}` : '';
    status('Imported'); await load();
  } catch (err) { status(`Import failed: ${err.message}`); }
};
load();
