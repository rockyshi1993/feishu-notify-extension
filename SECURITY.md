# 安全策略

## 报告漏洞

请**不要**在公开 Issue 里报告安全问题。请使用 GitHub 的私密漏洞报告：在仓库的 **Security → Advisories → Report a vulnerability** 页面提交（[直达链接](https://github.com/rockyshi1993/feishu-notify-extension/security/advisories/new)）。

请尽量提供：受影响的版本、复现步骤、影响范围。我们会尽快确认并处理。

## 范围

特别关注以下问题：

- 密钥处理：密钥被导出、写入日志、在界面明文显示，或被发送到配置之外的地址；
- 发往接收地址的数据：超出设置范围的消息内容（例如关闭「推送中包含消息原文」后仍发送正文）；
- 扩展页面的消息接口被内容脚本或网页滥用；
- 任何导致扩展在飞书里执行写操作的情况。

飞书本身或你自建接收端的问题不在本项目范围内。

## Reporting (English)

Please report vulnerabilities privately via GitHub Security Advisories (Security → Report a vulnerability), not via public issues.
