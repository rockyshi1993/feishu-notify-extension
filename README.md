# 飞书通知扩展（Feishu Notify for Grok Bot）

[English](README.en.md) | 简体中文

一个 Chrome（Manifest V3）扩展：监测飞书网页版（`*.feishu.cn`）的新消息，按你的规则过滤、合并后，以 JSON 推送到你配置的 Webhook 接收地址（例如 Grok Bot），由助手再去飞书阅读和汇总。

> **只通知，不操作。** 扩展从不发送飞书消息、不修改多维表格、不调用飞书内部接口。它只读取页面本身可见的内容：桌面通知的标题和正文、标签页标题里的未读数，以及（尽力读取）当前打开会话的最近几条消息。

## 功能

- 拦截飞书网页的桌面通知（`Notification` / `showNotification`），解析出会话名、发送人、正文。
- 标签页标题未读数兜底：没有通知时，未读数增加也会生成一条匿名事件。
- 丰富的过滤规则：排除 / 只看会话、排除发送人、机器人策略、免打扰会话、@我 / @所有人、单聊 / 群聊、撤回 / 表情回复 / 系统消息、关键词（支持正则）。
- 工作时间内按时间窗合并推送；优先消息（优先关键词、@我）立即推送并排在最前；非工作时间全部排队，到上班时间再推。
- 去重、队列上限、失败重试、密钥失效（401/403）自动暂停。
- 工具栏弹窗显示运行状态、队列、最近事件，可暂停 / 恢复 / 立即推送。
- 配置可导出 / 导入（导出文件**不含密钥**）。

## 安装（加载已解压的扩展程序）

1. 运行 `sh scripts/build.sh`，生成 `dist/feishu-notify-extension` 和 zip 包（也可以直接加载仓库根目录）。
2. 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择 `dist/feishu-notify-extension`（或仓库根目录）。
3. 打开扩展的「设置」页（弹窗底部的「设置」链接，或扩展详情里的「扩展程序选项」），填写「Grok Bot 接收地址」和「密钥」，点「保存」（Chrome 会请求访问该域名的权限，请允许），再点「发送测试推送」，看到 `测试成功（HTTP 200，… 毫秒）` 即表示连通。
4. 保持一个已登录的飞书网页标签页开着。Chrome 关闭或电脑休眠期间到达的消息不会被抓到。

## 设置项

设置页分四组，下表名称与界面一致（括号内为配置字段名）。

**连接**

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| Grok Bot 接收地址（`endpointUrl`） | 空 | 必须是 `https://` 地址 |
| 密钥（`apiKey`） | 空 | 以 `Authorization: Bearer <密钥>` 发送；留空保存则保留原密钥 |
| 实例名称（`instanceName`） | 空 | 留空时推送里用 `chrome-<instanceId 前 4 位>` |
| 启用（`enabled`） | 开 | |

**来源过滤**

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 我的飞书名字（`myName`） | 空 | 例如 `张三`。正文包含 `@<名字>` 时打 `mentionMe` 标记；**需要填写才能识别 @我，留空则不识别 @我** |
| 排除会话（`excludeChats`） | 空 | 每行一个，会话名包含即排除（不区分大小写） |
| 只看这些会话（`includeOnlyChats`） | 空 | 留空 = 全部 |
| 排除发送人（`excludeSenders`） | 空 | 单聊时也匹配会话名 |
| 机器人 / 助手发送人（`botSenders`） | `多维表格助手` | |
| 机器人消息（`botPolicy`） | 放行并标记 | 放行 / 放行并标记（`bot`）/ 丢弃 |
| 免打扰会话（`mutedChats`） | 跟随飞书（不推送） | 照样推送 / 连未读数事件也丢弃 |
| @我（`mentionMe`） | 优先 | 优先 / 普通 |
| @所有人（`mentionAll`） | 普通 | 普通 / 优先 / 忽略（直接丢弃） |
| 单聊、群聊（`chatTypes`） | 都开 | |
| 忽略：撤回、表情回复、系统消息（`ignoreTypes`） | 全部忽略 | |
| 用标签页标题里的未读数兜底（`titleFallback`） | 开 | |
| 飞书的 Chrome 通知被关闭时也照样抓取（`captureWhenOff`） | 关 | 开启后页面会认为通知权限已授予，但不弹系统通知 |
| 当前打开且在前台的会话（`focusedChatPolicy`） | 推送 | 推送 / 不推送 |

**内容**

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 优先关键词（`priorityKeywords`） | `任务`、`需求`、`bug` | 命中即打 `priority` 和 `keyword:<词>` 标记 |
| 忽略关键词（`ignoreKeywords`） | 空 | 命中即丢弃 |
| 关键词按正则表达式匹配（`useRegex`） | 关 | 不区分大小写 |
| 正文最大字数（`bodyMaxChars`） | 300 | 范围 50–1000，超出截断并标 `truncated: true` |
| 上下文消息条数（`contextCount`） | 5 | 范围 0–10 |
| 推送中包含消息原文（`includeText`） | 开 | 关闭后只推会话名、发送人等元数据，不含正文和上下文 |

**时间**

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 时区（`timezone`） | `Asia/Shanghai` | IANA 时区名 |
| 工作时间（`workHours`） | 周一至周五 09:00–18:30 | 每天可单独设置或设为休息日 |
| 合并等待时间（分钟）（`batchWindowMin`） | 1 | 范围 1–30 |
| 每次推送最多条数（`batchMax`） | 20 | 范围 1–20 |
| 去重时间窗（分钟）（`dedupeWindowMin`） | 10 | 范围 1–60 |
| 队列上限（`queueMax`） | 200 | 范围 20–1000 |
| 调试日志条数（`debugLogSize`） | 20 | 范围 0–100 |

无效的值不会保存，界面会提示「以下设置无效，已保留原值」。「导出」生成 `feishu-notify-config.json`（不含密钥）；「导入」会保留本机已保存的密钥。

## 工作原理

`src/main-world.js`（在飞书页面内运行）包装 `Notification` / `showNotification` 并观察标签页标题 → `src/relay.js` 把事件转发给 Service Worker → `src/background.js` 过滤、去重、排队并推送：

- **工作时间内**：普通消息从队列里最早一条算起等待「合并等待时间」（默认 1 分钟）后合并推送，每次最多 20 条；
- **优先消息**（命中优先关键词、@我，或把 @所有人 设为优先）在工作时间内约 1 秒后立即推送，并排在批次最前；
- **非工作时间**：所有消息（包括优先消息）都排队，到下一个工作时间开始时推送；
- **去重**：同一会话、发送人、正文的消息在 10 分钟内只推一次；
- **队列上限 200**：满了先丢最旧的非优先消息（没有非优先消息时丢最旧的），下次推送通过 `droppedCount` 报告丢弃数；
- **失败重试**：失败 30 秒后重试 1 次，仍失败则留在队列等下次；
- **密钥失效**：返回 HTTP 401/403 时暂停自动推送（图标显示红色 `!`），重新保存设置、在弹窗点「恢复」或测试推送成功后恢复。

弹窗里「暂停 1 小时」「暂停到明早」（到设置时区的次日 09:00）、「恢复」「立即推送队列」（不受工作时间限制）可随时使用。

## 推送格式（schemaVersion 1）

`POST <接收地址>`，请求头 `Content-Type: application/json` 和 `Authorization: Bearer <密钥>`，超时 15 秒。

```json
{
  "source": "feishu-notify-extension",
  "schemaVersion": 1,
  "extVersion": "1.0.0",
  "instanceId": "3f1c…",
  "instanceName": "office-chrome",
  "kind": "batch",
  "sentAt": "2026-10-29T09:00:05+08:00",
  "reason": "workStart",
  "droppedCount": 0,
  "events": [
    {
      "eventKey": "a1b2c3d4e5f60718",
      "via": "notification",
      "capturedAt": "2026-10-28T19:12:40+08:00",
      "chatName": "需求池通知",
      "sender": "多维表格助手",
      "chatType": "group",
      "body": "你被指派为开发人员：登录页改版",
      "truncated": false,
      "marks": ["priority", "bot", "keyword:需求", "outsideHours"],
      "context": null,
      "contextAvailable": false
    }
  ]
}
```

- `kind`：`batch`（正常推送）或 `test`（设置页的测试推送，`events` 为空）。
- `reason`：`window`（合并等待到期）、`priority`、`workStart`（上班或暂停结束）、`manual`（立即推送）、`retry`、`test`。
- `via`：`notification`，或 `titleCount`（未读数兜底事件，`chatName`/`sender` 为 `null`，`body` 形如 `unread +2`，另有 `unreadDelta`）。
- `chatType`：`group`、`dm` 或 `unknown`。单聊时 `sender` 就是会话名。
- `marks`：`priority`、`mentionMe`、`mentionAll`、`bot`、`keyword:<词>`、`outsideHours`。
- `context`：当前打开会话的最近消息 `[{ "sender", "text" }]`，读不到时为 `null` 且 `contextAvailable: false`。群聊发送人通常读不到（`null`），自己发的为 `me`。
- 时间均为带时区偏移的 ISO 8601。

### 接收端建议

- 返回 2xx 表示成功；401/403 会让扩展暂停自动推送；其他状态码或超时会重试。
- 多个浏览器 / 实例可能推送同一条消息，请按 `eventKey` 跨 `instanceId` 去重（建议 10 分钟窗口）。
- 把推送当作「去飞书看看」的提示，而非消息的完整记录。

## 已知限制

- 按可见名称匹配（会话标题、正文中的发送人前缀），改名或同名会话可能误判。
- 免打扰会话通常不弹通知，只能以匿名的未读数事件出现。
- 上下文和「当前打开会话」判断依赖飞书未公开的页面结构（`.chat-tabPanel-active .js-message-item`、`.message-right` 中的气泡文本）。由于读不到会话标题，当通知正文（或 `发送人:` 之后的部分）出现在最近 5 条消息气泡中时视为「已打开」，在 300 ms 和 1200 ms 各重试一次。飞书改版后可能读不到，推送仍会发出，但 `contextAvailable: false`。
- 为了让页面脚本启动时就能读到配置，`relay.js` 会在飞书的 localStorage 写入一个标记 `__feishuNotifyExtCfg`。
- 只支持 `*.feishu.cn`；Lark 国际版（`*.larksuite.com`）暂不支持。

## 隐私

- 密钥只保存在 `chrome.storage.local`，界面上打码显示，不会导出，也不写入日志。
- 消息原文只在本地调试日志中保留最近若干条（默认 20 条），并且只发送到你配置的接收地址。
- 关闭「推送中包含消息原文」后，只推会话名、发送人和条数。
- 扩展默认只有 `*.feishu.cn` 的访问权限，接收地址的域名权限在保存时单独请求。

## 开发

需要 Node.js ≥ 20，无第三方依赖。

```sh
npm test         # 单元测试（node --test）
npm run check    # 语法检查、manifest 校验、密钥扫描
npm run build    # 生成 dist/ 下的解压目录和 zip 包
```

目录结构：`manifest.json`，`src/`（扩展代码，`src/lib/core.js` 为可单测的纯逻辑），`tests/`，`scripts/`。

## 参与贡献

欢迎提交 Issue 和 Pull Request，流程见 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题请按 [SECURITY.md](SECURITY.md) 私密报告。提交前请确保 `npm test` 和 `npm run check` 通过；代码注释和提交信息请使用英文。飞书页面结构变化导致抓取失效时，欢迎附上（脱敏后的）页面结构信息。

## 许可证

[MIT](LICENSE) © 2026 Rocky Shi
