// Unit tests for pure logic. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../src/lib/core.js';

const cfg = (o = {}) => c.normalizeConfig(o).config;
// 2026-10-28 is a Wednesday. Times below are UTC; Shanghai = UTC+8.
const WED_10 = new Date('2026-10-28T02:00:00Z'); // 10:00 Shanghai
const WED_19 = new Date('2026-10-28T11:00:00Z'); // 19:00 Shanghai
const SAT_10 = new Date('2026-10-31T02:00:00Z');
const n = (title, body, extra = {}) => ({ via: 'notification', title, body, at: WED_10.getTime(), ...extra });

test('defaults and validation', () => {
  const { config, errors } = c.normalizeConfig({ batchMax: 50, botPolicy: 'x', endpointUrl: 'http://a', foo: 1, priorityKeywords: [' a ', ''] });
  assert.deepEqual(errors.sort(), ['batchMax', 'botPolicy', 'endpointUrl', 'foo']);
  assert.equal(config.batchMax, 20);
  assert.deepEqual(config.priorityKeywords, ['a']);
  assert.deepEqual(c.DEFAULT_CONFIG.priorityKeywords, ['任务', '需求', 'bug']); // C3 / F-03: no @name keyword
});

test('work hours and time zone (known issue 4)', () => {
  const k = cfg();
  assert.equal(c.isWorkTime(WED_10, k), true);
  assert.equal(c.isWorkTime(WED_19, k), false);
  assert.equal(c.isWorkTime(SAT_10, k), false);
  assert.equal(c.isWorkTime(new Date('2026-10-28T10:29:00Z'), k), true); // 18:29
  assert.equal(c.isWorkTime(new Date('2026-10-28T10:30:00Z'), k), false); // 18:30
  assert.equal(c.toZonedIso(WED_19, 'Asia/Shanghai'), '2026-10-28T19:00:00+08:00');
  assert.equal(c.formatClock(WED_19, 'Asia/Shanghai'), '10-28 19:00');
  const next = new Date(c.nextWorkStart(WED_19, k));
  assert.equal(c.toZonedIso(next, 'Asia/Shanghai'), '2026-10-29T09:00:00+08:00');
  const fri = new Date('2026-10-30T11:00:00Z');
  assert.equal(c.toZonedIso(new Date(c.nextWorkStart(fri, k)), 'Asia/Shanghai'), '2026-11-02T09:00:00+08:00');
});

test('parse and classify basics', () => {
  const k = cfg();
  const r = c.classify(n('需求池通知', '多维表格助手: 你被指派为开发人员：登录页改版'), k, WED_10);
  assert.equal(r.event.sender, '多维表格助手');
  assert.equal(r.event.chatType, 'group');
  assert.deepEqual(r.event.marks, ['priority', 'bot', 'keyword:需求']);
  const dm = c.classify(n('周智祥', '下午好'), k, WED_10);
  assert.equal(dm.event.chatType, 'dm');
  assert.deepEqual(dm.event.marks, []);
});

test('filters: exclude, include-only, senders, types, chat types', () => {
  assert.equal(c.classify(n('CICD 构建群', 'bot: done @石火坚'), cfg({ excludeChats: ['cicd'] }), WED_10).drop, 'excludeChats'); // D2
  assert.equal(c.classify(n('其他群', 'a: b'), cfg({ includeOnlyChats: ['项目'] }), WED_10).drop, 'includeOnlyChats');
  assert.ok(c.classify(n('项目群', 'a: b'), cfg({ includeOnlyChats: ['项目'] }), WED_10).event);
  assert.equal(c.classify(n('群', '张三: hi'), cfg({ excludeSenders: ['张三'] }), WED_10).drop, 'excludeSenders');
  assert.equal(c.classify(n('张三', 'hi'), cfg({ excludeSenders: ['张三'] }), WED_10).drop, 'excludeSenders');
  assert.equal(c.classify(n('群', '李四撤回了一条消息'), cfg(), WED_10).drop, 'type-recall');
  assert.ok(c.classify(n('群', '李四撤回了一条消息'), cfg({ ignoreTypes: [] }), WED_10).event);
  assert.equal(c.classify(n('群', 'a: b'), cfg({ chatTypes: { dm: true, group: false } }), WED_10).drop, 'chatType-group');
  assert.equal(c.classify(n('群', 'a: 午饭'), cfg({ ignoreKeywords: ['午饭'] }), WED_10).drop, 'ignoreKeywords');
  assert.equal(c.classify(n('群', 'a: x'), cfg({ botSenders: ['a'], botPolicy: 'drop' }), WED_10).drop, 'bot');
});

test('muted, focused chat, mentions, regex', () => {
  assert.equal(c.classify(n('静音群', 'a: b', { muted: true }), cfg(), WED_10).drop, 'muted'); // D1
  assert.ok(c.classify(n('静音群', 'a: b', { muted: true }), cfg({ mutedChats: 'all' }), WED_10).event);
  assert.equal(c.classify(n('群A', 'a: b', { focused: true, activeChat: '群A' }), cfg(), WED_10).drop, 'focusedChat'); // D4
  assert.ok(c.classify(n('群A', 'a: b', { focused: false, activeChat: '群A' }), cfg(), WED_10).event);
  assert.deepEqual(c.classify(n('群', 'a: @石火坚 看下'), cfg(), WED_10).event.marks, ['priority', 'mentionMe']);
  assert.deepEqual(c.classify(n('群', 'a: @石火坚 看下'), cfg({ mentionMe: 'normal' }), WED_10).event.marks, ['mentionMe']);
  assert.deepEqual(c.classify(n('群', 'a: @所有人 开会'), cfg(), WED_10).event.marks, ['mentionAll']);
  assert.equal(c.classify(n('群', 'a: @所有人 开会'), cfg({ mentionAll: 'ignore' }), WED_10).drop, 'mentionAll-ignore');
  assert.deepEqual(c.classify(n('群', 'a: BUG-12'), cfg({ priorityKeywords: ['^a\\nbug'], useRegex: true }), WED_10).event.marks, []);
  assert.deepEqual(c.classify(n('群', 'a: BUG-12'), cfg({ priorityKeywords: ['bug-\\d+'], useRegex: true }), WED_10).event.marks, ['priority', 'keyword:bug-\\d+']);
});

test('outside hours: keywords still queue, marked (Q3)', () => {
  const r = c.classify(n('群', 'a: 新任务'), cfg(), WED_19);
  assert.deepEqual(r.event.marks, ['priority', 'keyword:任务', 'outsideHours']);
});

test('truncation, context, includeText', () => {
  const long = 'x'.repeat(400);
  const ctx = Array.from({ length: 8 }, (_, i) => ({ sender: 's', text: `${i}` + 'y'.repeat(400) }));
  const r = c.classify(n('群', `a: ${long}`, { context: ctx }), cfg(), WED_10).event;
  assert.equal(r.body.length, 301);
  assert.equal(r.truncated, true);
  assert.equal(r.context.length, 5);
  assert.ok(r.context[0].text.startsWith('3'));
  assert.equal(r.contextAvailable, true);
  const h = c.classify(n('群', 'a: secret', { context: ctx }), cfg({ includeText: false }), WED_10).event;
  assert.equal(h.body, '');
  assert.equal(h.context, null);
  assert.equal(c.classify(n('群', 'a: b'), cfg(), WED_10).event.contextAvailable, false);
});

test('title fallback and F-01', () => {
  const t = c.classify({ via: 'titleCount', unreadDelta: 2, at: WED_10.getTime() }, cfg(), WED_10).event;
  assert.equal(t.chatName, null);
  assert.equal(t.unreadDelta, 2);
  assert.equal(c.classify({ via: 'titleCount', unreadDelta: 1 }, cfg({ titleFallback: false }), WED_10).drop, 'titleFallback-off');
  assert.equal(c.shouldKeepTitleEvent(1000, 5000), false);
  assert.equal(c.shouldKeepTitleEvent(1000, 30000), true);
  assert.equal(c.shouldKeepTitleEvent(0, 30000), true);
});

test('eventKey and dedupe', async () => {
  const a = { chatName: '群', sender: 'a', body: 'hi  there', via: 'notification' };
  const k1 = await c.eventKey(a);
  assert.match(k1, /^[0-9a-f]{16}$/);
  assert.equal(await c.eventKey({ ...a, body: 'hi there' }), k1);
  assert.notEqual(await c.eventKey({ ...a, body: 'other' }), k1);
  const seen = {};
  assert.equal(c.isDuplicate(seen, k1, 0, 10), false);
  assert.equal(c.isDuplicate(seen, k1, 9 * 60000, 10), true);
  assert.equal(c.isDuplicate(seen, k1, 21 * 60000, 10), false);
});

test('queue overflow drops oldest and counts (D5)', () => {
  const q = [];
  let dropped = 0;
  for (let i = 0; i < 205; i++) dropped += c.enqueue(q, { capturedAt: i, marks: i === 0 ? ['priority'] : [] }, 200);
  assert.equal(q.length, 200);
  assert.equal(dropped, 5);
  assert.equal(q[0].capturedAt, 0); // priority survives
  assert.equal(q[1].capturedAt, 6);
});

test('batching: priority first, cap 20', () => {
  const q = Array.from({ length: 25 }, (_, i) => ({ capturedAt: i, marks: i === 24 ? ['priority'] : [] }));
  const { batch, rest } = c.takeBatch(q, 20);
  assert.equal(batch.length, 20);
  assert.equal(batch[0].capturedAt, 24);
  assert.equal(batch[1].capturedAt, 0);
  assert.equal(rest.length, 5);
  assert.deepEqual(rest.map((e) => e.capturedAt), [19, 20, 21, 22, 23]);
});

test('payload matches contract', () => {
  const p = c.buildPayload({
    events: [{ eventKey: 'k', capturedAt: WED_19.getTime(), marks: [] }], cfg: cfg(), instanceId: 'abcd-1234',
    extVersion: '1.0.0', reason: 'workStart', droppedCount: 3, now: WED_19,
  });
  assert.equal(p.source, 'feishu-notify-extension');
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.instanceName, 'chrome-abcd');
  assert.equal(p.kind, 'batch');
  assert.equal(p.sentAt, '2026-10-28T19:00:00+08:00');
  assert.equal(p.events[0].capturedAt, '2026-10-28T19:00:00+08:00');
  assert.equal(p.droppedCount, 3);
});

test('HTTP verdicts (C1)', () => {
  assert.equal(c.classifyResponse({ status: 200 }), 'ok');
  assert.equal(c.classifyResponse({ status: 204 }), 'ok');
  assert.equal(c.classifyResponse({ status: 401 }), 'auth');
  assert.equal(c.classifyResponse({ status: 403 }), 'auth');
  assert.equal(c.classifyResponse({ status: 500 }), 'retry');
  assert.equal(c.classifyResponse({ status: 0 }), 'retry');
});

test('export never contains the key; import keeps local key', () => {
  const k = cfg({ apiKey: 'crsr_secret_value', excludeChats: ['x'] });
  const e = c.exportConfig(k);
  assert.equal('apiKey' in e.config, false);
  assert.equal(JSON.stringify(e).includes('crsr_secret_value'), false);
  const { config, errors } = c.importConfig({ ...e, config: { ...e.config, apiKey: 'evil', batchMax: 999 } }, cfg({ apiKey: 'local' }));
  assert.equal(config.apiKey, 'local');
  assert.deepEqual(errors, ['batchMax']);
  assert.throws(() => c.importConfig({ schemaVersion: 9, config: {} }, k));
  assert.equal(c.mask('crsr_abcdef'), '••••cdef');
});
