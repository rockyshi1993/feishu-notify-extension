// Unit tests for the open-chat matcher used by the MAIN-world script.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/context-match.js';

const { norm, bodyNeedles, matchesOpenChat } = globalThis.__feishuNotifyCtxMatch;

test('norm collapses whitespace incl. NBSP and zero-width', () => {
  assert.equal(norm(' a\u00a0\u00a0b\n c\u200b '), 'a b c');
  assert.equal(norm(null), '');
});

test('bodyNeedles splits "Sender: text" and full-width colon', () => {
  assert.deepEqual(bodyNeedles('张三: 你好 世界'), ['张三: 你好 世界', '你好 世界']);
  assert.deepEqual(bodyNeedles('张三：插件测试'), ['张三：插件测试', '插件测试']);
  assert.deepEqual(bodyNeedles('plain'), ['plain']);
  assert.deepEqual(bodyNeedles(''), []);
});

test('p2p body matches the newest bubble', () => {
  assert.equal(matchesOpenChat('插件测试 5（上下文）', ['hi', '插件测试\u00a05（上下文）']), true);
});

test('group body matches after the colon', () => {
  assert.equal(matchesOpenChat('周智祥：今晚上线', ['今晚上线']), true);
});

test('no match for other chats or empty input', () => {
  assert.equal(matchesOpenChat('别的会话消息', ['插件测试 5']), false);
  assert.equal(matchesOpenChat('', ['x']), false);
  assert.equal(matchesOpenChat('a', ['a']), false);
  assert.equal(matchesOpenChat('abc', null), false);
});

test('truncated notification body still matches a longer bubble', () => {
  assert.equal(matchesOpenChat('很长的一段消息…', ['很长的一段消息…']), true);
  assert.equal(matchesOpenChat('很长的一段消息', ['很长的一段消息，后面还有很多内容']), true);
});
