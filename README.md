# Feishu Notify for Grok Bot

A Chrome (MV3) extension that watches the Feishu web app (`*.feishu.cn`) for new messages and pushes batched,
filtered notices to a Grok Bot webhook receiver, so the assistant can go and read Feishu for you.

**Notify only.** It never sends Feishu messages, never edits Bitable, and never calls Feishu's internal APIs.
It only reads what the page shows: notification title/body, the tab-title unread count, and (best effort) the
recent messages of the chat that is currently open.

## Install (Load unpacked)
1. `sh scripts/build.sh` (or use the repo root directly).
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → choose `dist/feishu-notify-extension` (or the repo root).
3. Open the extension's **Settings**, fill in the Grok Bot receiver URL and key, click **Save** (Chrome asks for permission
   to reach that host), then **Send test push** – you should see `Test OK (HTTP 200…)`.
4. Keep a logged-in Feishu web tab open. Messages that arrive while Chrome is closed or asleep are not captured.

## How it works
`main-world.js` wraps `Notification` / `showNotification` and watches the tab title → `relay.js` forwards events →
the service worker filters, dedupes (10 min), queues, and pushes:
- in work hours (default Mon–Fri 09:00–18:30, Asia/Shanghai) after a 2‑minute batch window, at most 20 events per push;
- priority events (priority keywords, @me) push immediately in work hours and sort first;
- outside work hours everything queues (keywords too) and is pushed when work hours start;
- queue limit 200: the oldest events are dropped and the next push reports `droppedCount`;
- failure: one retry after 30 s, then the batch stays queued; HTTP 401/403 pauses auto-push until settings are saved or a test push succeeds.

## Push format (schemaVersion 1)
`POST <receiver URL>` with `Content-Type: application/json` and `Authorization: Bearer <key>`.
```json
{"source":"feishu-notify-extension","schemaVersion":1,"extVersion":"1.0.0","instanceId":"…","instanceName":"rocky-chrome",
 "kind":"batch","sentAt":"2026-10-29T09:00:05+08:00","reason":"workStart","droppedCount":0,
 "events":[{"eventKey":"a1b2c3d4e5f60718","capturedAt":"2026-10-28T19:12:40+08:00","via":"notification",
  "chatName":"Requirements","sender":"Base Assistant","chatType":"group","body":"…","truncated":false,
  "marks":["priority","bot","keyword:需求","outsideHours"],"context":null,"contextAvailable":false}]}
```
`kind` is `test` for the settings-page test push. `via` is `titleCount` for unread-count fallback events (no chat name).
Marks: `priority`, `mentionMe`, `mentionAll`, `bot`, `keyword:<word>`, `outsideHours`.
Receivers should dedupe by `eventKey` across `instanceId`s (10‑minute window).

## Settings
Connection (URL, key, instance name, enabled) · source filters (exclude / include-only chats, exclude senders,
bot senders and policy, muted chats, @me / @all, DM / group, ignore recalls / reactions / system notices,
title fallback, capture when notifications are off, focused-chat policy) · content (priority / ignore keywords,
regex, body length, context count, include text) · timing (per-day work hours, time zone, batch window, batch size,
dedupe window, queue limit, log size). Export/import produces `feishu-notify-config.json` **without the key**.

## Limits
- Matching is by visible names (chat title, sender prefix): renamed or same-named chats can be mismatched.
- Muted chats usually raise no notification, so they can only show up as an anonymous unread-count bump.
- Context and focused-chat detection use undocumented page markup (`.chat-tabPanel-active .js-message-item`,
  bubble text in `.message-right`). Feishu web shows no readable chat-header name, so a notification counts as
  "open chat" when its body (or the part after `Sender:`) appears in one of the last 5 message bubbles; the
  check retries at 300 ms and 1200 ms. Group sender names are not read (null); in DMs the sender is the chat
  name, own messages are `me`. After Feishu UI changes this may read nothing; the push still goes out with
  `contextAvailable: false`.
- The relay stores one flag (`__feishuNotifyExtCfg`) in Feishu's localStorage so the page script sees it at startup.

## Privacy
The key is stored only in `chrome.storage.local`, masked in the UI, never exported or logged. Message text is kept
locally in a short debug log (default 20 entries) and sent only to the receiver you configure. Turn off
**Include message text** to send only chat names and counts.

## Development
`npm test` (Node ≥ 20, no dependencies) · `npm run check` (syntax, manifest, secret scan) · `npm run build`.
