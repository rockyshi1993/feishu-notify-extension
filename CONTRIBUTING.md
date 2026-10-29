# 参与贡献

感谢你愿意改进飞书通知扩展！欢迎提交 Issue 和 Pull Request。

## 基本原则

- **只通知，不操作**：扩展不得在飞书里发送、修改任何内容，不得调用飞书内部接口，只读取页面上可见的内容。破坏这一点的改动不会被合并。
- **不要提交任何密钥**：接收地址的密钥、Webhook 地址、真实的聊天内容都不能进仓库。`npm run check` 会做一次简单的密钥扫描。
- 用户可见的界面文字使用简体中文；代码注释和提交信息使用英文。

## 开发环境

需要 Node.js ≥ 20，没有第三方依赖。

```sh
npm test         # 单元测试
npm run check    # 语法检查、manifest 校验、密钥扫描
npm run build    # 生成 dist/ 下的解压目录和 zip 包
```

在 `chrome://extensions` 里开启「开发者模式」，「加载已解压的扩展程序」选择仓库根目录即可调试；修改后点扩展卡片上的刷新按钮。

## 提交流程

1. Fork 仓库，从 `main` 新建分支。
2. 修改代码；纯逻辑放在 `src/lib/core.js` 并补充 `tests/` 里的单元测试。
3. 确保 `npm test` 和 `npm run check` 通过。
4. 提交信息用英文、祈使句（例如 `Fix title count parsing for full-width brackets`）。
5. 发起 Pull Request，说明改了什么、为什么改、如何验证。

飞书页面结构变化导致抓取失效时，欢迎在 Issue 里附上**脱敏后**的页面结构信息。

## English

Contributions are welcome. Requirements: Node.js ≥ 20; run `npm test` and `npm run check` before opening a PR; write commit messages and code comments in English; keep the extension notify-only (no Feishu writes, no internal Feishu APIs) and never commit secrets.
