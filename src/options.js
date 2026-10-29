// Options page: edit config, test push, import/export (export never contains the key).
import { DEFAULT_CONFIG, mask } from './lib/core.js';

const $ = (id) => document.getElementById(id);
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS = { mon: '周一', tue: '周二', wed: '周三', thu: '周四', fri: '周五', sat: '周六', sun: '周日' };
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
    tr.innerHTML = `<td>${DAY_LABELS[d]}</td><td><label class="row"><input type="checkbox" id="wh_${d}_on"> 工作日</label></td><td><input type="time" id="wh_${d}_s"></td><td><input type="time" id="wh_${d}_e"></td>`;
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
  $('keyHint').textContent = c.apiKey ? `已保存的密钥：${mask(c.apiKey)}` : '尚未保存密钥';
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
    try { origin = new URL(o.endpointUrl).origin; } catch { status('地址无效'); return false; }
    // Host permission for the receiver must be requested from a user gesture.
    if (!(await chrome.permissions.request({ origins: [`${origin}/*`] }))) { status('未获得访问该域名的权限'); return false; }
  }
  const r = await send({ type: 'save-config', config: o });
  $('errors').textContent = r.errors && r.errors.length ? `以下设置无效，已保留原值：${r.errors.join(', ')}` : '';
  status('已保存');
  await load();
  return true;
}

buildHours();
$('save').onclick = save;
$('test').onclick = async () => {
  if (!(await save())) return;
  status('发送中…');
  const r = await send({ type: 'test-push' });
  status(r.verdict === 'ok' ? `测试成功（HTTP ${r.status}，${r.ms} 毫秒）` : `测试失败（${r.status || r.error}）`);
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
    $('errors').textContent = r.errors && r.errors.length ? `已忽略的字段：${r.errors.join(', ')}` : '';
    status('已导入'); await load();
  } catch (err) { status(`导入失败：${err.message}`); }
};
load();
