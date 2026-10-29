# Feishu Notify for Grok Bot

English | [简体中文](README.md)

A Chrome (Manifest V3) extension that watches the Feishu web app (`*.feishu.cn`) for new messages, filters and batches them by your rules, and POSTs them as JSON to a webhook receiver you configure (for example Grok Bot), so an assistant can go and read Feishu for you.

> **Notify only.** It never sends Feishu messages, never edits Bitable, and never calls Feishu's internal APIs. It only reads what the page itself shows: desktop notification title/body, the unread count in the tab title, and (best effort) the most recent messages of the chat that is currently open.

The extension UI is in Simplified Chinese. Below, UI labels are given in Chinese with an English gloss.

## Features

- Hooks Feishu web desktop notifications (`Notification` / `showNotification`) and parses chat name, sender and text.
- Tab-title unread-count fallback: an unread bump with no notification becomes an anonymous event.
- Filters: exclude / include-only chats, excluded senders, bot policy, muted chats, @me / @all, DM / group, recalls / reactions / system notices, keywords (optionally regex).
- Batching in work hours; priority events (priority keywords, @me) push immediately and sort first; outside work hours everything queues until work starts.
- Dedupe, queue limit, one retry, auto-pause on HTTP 401/403.
- Toolbar popup with status, queue, recent events, pause / resume / push now.
- Config export / import (the export **never contains the key**).

## Install (Load unpacked)

1. `sh scripts/build.sh` → `dist/feishu-notify-extension` plus a zip (or load the repo root directly).
2. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose `dist/feishu-notify-extension` (or the repo root).
3. Open the extension settings (the 「设置」 link in the popup, or *Extension options*), fill in 「Grok Bot 接收地址」 (receiver URL) and 「密钥」 (key), click 「保存」 (Save; Chrome asks for permission to reach that host), then 「发送测试推送」 (Send test push). You should see `测试成功（HTTP 200，… 毫秒）` (test OK).
4. Keep a logged-in Feishu web tab open. Messages that arrive while Chrome is closed or the machine sleeps are not captured.

## Settings

| Group | Setting (UI label → config key) | Default |
| --- | --- | --- |
| 连接 Connection | 接收地址 URL `endpointUrl` (https only) · 密钥 key `apiKey` (empty = keep saved) · 实例名称 instance name `instanceName` (empty → `chrome-<first 4 of instanceId>`) · 启用 enabled `enabled` | empty · empty · empty · on |
| 来源过滤 Source filters | 我的飞书名字 `myName` (for `@me`, e.g. `张三`) | empty — **@me detection only works when this is filled in; empty turns it off** |
| | 排除会话 `excludeChats` · 只看这些会话 `includeOnlyChats` · 排除发送人 `excludeSenders` (one per line, case-insensitive substring) | empty |
| | 机器人 / 助手发送人 `botSenders` | `多维表格助手` |
| | 机器人消息 `botPolicy`: pass / mark / drop | mark |
| | 免打扰会话 `mutedChats`: followFeishu / all / none (also drop unread-count events) | followFeishu |
| | @我 `mentionMe`: priority / normal · @所有人 `mentionAll`: normal / priority / ignore (drop) | priority · normal |
| | 单聊 / 群聊 `chatTypes` · 忽略 撤回/表情回复/系统消息 `ignoreTypes` | both on · all ignored |
| | 未读数兜底 `titleFallback` · 通知关闭也抓取 `captureWhenOff` | on · off |
| | 当前打开且在前台的会话 `focusedChatPolicy`: push / skip | push |
| 内容 Content | 优先关键词 `priorityKeywords` · 忽略关键词 `ignoreKeywords` · 正则 `useRegex` | `任务`,`需求`,`bug` · empty · off |
| | 正文最大字数 `bodyMaxChars` (50–1000) · 上下文消息条数 `contextCount` (0–10) · 包含消息原文 `includeText` | 300 · 5 · on |
| 时间 Timing | 时区 `timezone` · 工作时间 `workHours` (per day) | `Asia/Shanghai` · Mon–Fri 09:00–18:30 |
| | 合并等待时间 `batchWindowMin` (1–30) · 每次最多条数 `batchMax` (1–20) · 去重时间窗 `dedupeWindowMin` (1–60) · 队列上限 `queueMax` (20–1000) · 调试日志条数 `debugLogSize` (0–100) | 1 · 20 · 10 · 200 · 20 |

Invalid values are rejected and the previous value is kept. 「导出」 (Export) writes `feishu-notify-config.json` without the key; 「导入」 (Import) keeps the locally saved key.

## How it works

`main-world.js` wraps `Notification` / `showNotification` and watches the tab title → `relay.js` forwards events → the service worker filters, dedupes, queues and pushes:

- in work hours, normal events are pushed once the oldest queued event is `batchWindowMin` (default **1 minute**) old, at most 20 per push;
- priority events (priority keyword, @me, or @all when set to priority) push about 1 s later in work hours and sort first;
- outside work hours everything queues (priority too) and is pushed when work hours start;
- dedupe: same chat + sender + body is pushed once per 10 minutes;
- queue limit 200: the oldest non-priority event is dropped first (oldest overall if all are priority); the next push reports `droppedCount`;
- failure: one retry after 30 s, then the batch stays queued;
- HTTP 401/403 pauses auto-push (red `!` badge) until settings are saved, 「恢复」 (Resume) is clicked, or a test push succeeds.

Popup buttons: 「暂停 1 小时」 pause 1 h, 「暂停到明早」 pause until 09:00 tomorrow (configured time zone), 「恢复」 resume, 「立即推送队列」 push queue now (ignores work hours).

## Push format (schemaVersion 1)

`POST <receiver URL>` with `Content-Type: application/json` and `Authorization: Bearer <key>`, 15 s timeout.

```json
{"source":"feishu-notify-extension","schemaVersion":1,"extVersion":"1.0.0","instanceId":"3f1c…","instanceName":"office-chrome",
 "kind":"batch","sentAt":"2026-10-29T09:00:05+08:00","reason":"workStart","droppedCount":0,
 "events":[{"eventKey":"a1b2c3d4e5f60718","via":"notification","capturedAt":"2026-10-28T19:12:40+08:00",
  "chatName":"需求池通知","sender":"多维表格助手","chatType":"group","body":"你被指派为开发人员：登录页改版","truncated":false,
  "marks":["priority","bot","keyword:需求","outsideHours"],"context":null,"contextAvailable":false}]}
```

- `kind`: `batch`, or `test` for the settings-page test push (empty `events`).
- `reason`: `window`, `priority`, `workStart` (work start or snooze end), `manual`, `retry`, `test`.
- `via`: `notification`, or `titleCount` for unread-count fallback events (`chatName`/`sender` null, body like `unread +2`, plus `unreadDelta`).
- `chatType`: `group`, `dm` or `unknown`; in DMs `sender` is the chat name.
- `marks`: `priority`, `mentionMe`, `mentionAll`, `bot`, `keyword:<word>`, `outsideHours`.
- `context`: recent messages of the open chat `[{sender, text}]`, or `null` with `contextAvailable: false`. Group senders are usually unreadable (`null`); own messages are `me`.

### Receiver guidance

Return 2xx on success; 401/403 pauses auto-push; anything else (or a timeout) is retried. Dedupe by `eventKey` across `instanceId`s (10-minute window). Treat pushes as "go look at Feishu" hints, not a complete message record.

## Limits

- Matching is by visible names (chat title, sender prefix): renamed or same-named chats can be mismatched.
- Muted chats usually raise no notification, so they only show up as anonymous unread-count bumps.
- Context and open-chat detection rely on undocumented markup (`.chat-tabPanel-active .js-message-item`, bubble text in `.message-right`). With no readable chat-header name, a notification counts as "open chat" when its body (or the part after `Sender:`) appears in one of the last 5 bubbles; retried at 300 ms and 1200 ms. After Feishu UI changes this may read nothing; the push still goes out with `contextAvailable: false`.
- The relay stores one flag (`__feishuNotifyExtCfg`) in Feishu's localStorage so the page script sees it at startup.
- Only `*.feishu.cn` is supported; Lark (`*.larksuite.com`) is not.

## Privacy

The key is stored only in `chrome.storage.local`, masked in the UI, never exported or logged. Message text is kept locally in a short debug log (default 20 entries) and sent only to the receiver you configure. Turn off 「推送中包含消息原文」 (include message text) to send only chat names, senders and counts. Host permission for the receiver is requested separately on save.

## Development

Node.js ≥ 20, no dependencies: `npm test` · `npm run check` (syntax, manifest, secret scan) · `npm run build`.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately per [SECURITY.md](SECURITY.md). Please run `npm test` and `npm run check` first; code comments and commit messages are in English.

## License

[MIT](LICENSE) © 2026 Rocky Shi
