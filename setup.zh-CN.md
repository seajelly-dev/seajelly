# SEAJelly Setup 指南

面向第一次接触 SEAJelly 的小白用户。

官方域名：[seajelly.ai](https://seajelly.ai)

> English: [setup.md](./setup.md)

## 开始前先准备这些

| 项目 | 是否必需 | 说明 |
| --- | --- | --- |
| Supabase 账号和项目 | 是 | 用于 Auth、Postgres、pgvector 和调度 |
| Vercel 账号和部署 | 是 | 推荐的生产部署方式 |
| 一个公网可访问的应用地址 | 是 | setup、webhook、预览、语音链接和 cron 回调都要用到 |
| 至少一个大模型 API Key | 是 | setup 至少要保存一个 Provider Key |
| IM 平台凭证 | 可选 | setup 里可以先跳过，后面再配 |

如果你还没部署，最快的方式就是使用 [README.zh-CN.md](./README.zh-CN.md) 里的 Vercel 一键部署按钮。

## 基础环境变量

在打开 `/setup` 之前，请先保证部署环境里已经配置好：

| 变量名 | 为什么需要 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 让应用连接到你的 Supabase 项目 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器端和会话态服务端访问 |
| `SUPABASE_SERVICE_ROLE_KEY` | 必须先在 Vercel 里配好，`/setup` 才会继续 |
| `ENCRYPTION_KEY` | 用于加密数据库中保存的密钥 |
| `NEXT_PUBLIC_APP_URL` | 用于跳转、webhook、预览和 cron 回调 |
| `CRON_SECRET` | 保护 worker 路由 |

`ENCRYPTION_KEY` 和 `CRON_SECRET` 可以这样生成：

```bash
openssl rand -base64 32
```

现在 SEAJelly 会在 setup 第 1 步真正执行初始化前，先检查这些部署环境变量。如果有配置错误，`/setup` 会直接阻断，并明确提示你先去 Vercel 修正后重新部署。

最常见的错误包括：

- `NEXT_PUBLIC_APP_URL` 少了 `https://`
- `NEXT_PUBLIC_APP_URL` 填成了带路径的地址，而不是纯站点根地址
- `ENCRYPTION_KEY` 不是有效的 32 字节 base64 key
- `SUPABASE_SERVICE_ROLE_KEY` 或 `CRON_SECRET` 是部署后才补的，但没有重新部署

## 第 1 步：连接 Supabase

打开 `/setup` 后，第一步会让你填写：

- `Supabase Access Token (PAT)`
- `Project Ref`

### 这两个值在哪里找

- PAT：Supabase 控制台 -> 头像 -> `Account` -> `Access Tokens`
- Project Ref：`https://<ref>.supabase.co` 中间这段 `<ref>`

### 点击 Connect 之后会发生什么

SEAJelly 会自动：

- 验证能否连接到你的 Supabase 项目
- 创建所需的数据表和函数
- 启用必须的扩展
- 安全保存初始化所需的 Supabase 凭证

正常 setup 流程下，你不需要自己手动跑 SQL。

现在 SEAJelly 会把 PAT 和 Project Ref 临时放进一个 HttpOnly setup cookie，所以只要还是同一个浏览器，刷新页面后通常也能安全续跑，直到 setup 完成。

## 第 2 步：创建第一个管理员

填写：

- 邮箱
- 密码
- 重复确认密码

这个账号会成为第一个 Dashboard 管理员。建议使用你自己能稳定访问的邮箱和一组好记但安全的密码。

这里有两个重要提醒：

- 如果 Supabase Auth 里的 `Confirm email` 还开着，或者 URL Configuration 配错了，setup 现在会自动回滚这次半成功的管理员注册，不再把你留在“半坏状态”里。
- 如果 setup 发现管理员已经存在，但当前浏览器没有登录，会在第 2 步给出“清理未完成 setup 数据”的按钮，让你能干净重来。

## 第 3 步：保存必须的密钥

这一步至少需要：

- 至少一个大模型 Provider API Key
- 如果你想现在就配，也可以顺手填上 Embedding 凭证

当前 setup 内置支持填写的 Provider 包括：

- Anthropic
- OpenAI
- Google
- DeepSeek

说明：

- 你只需要填写一个 Provider Key 就能继续完成 setup
- 更多 Provider 和模型后续都可以在 Dashboard 里补充
- `SUPABASE_SERVICE_ROLE_KEY` 现在被视为部署前提，不再通过 setup 表单粘贴

## 第 4 步：创建第一个 Agent

这一步会创建你的第一个可工作的 SEAJelly Agent。

### 必填项

- `Agent Name`
- `Model`
- `System Prompt`

### 可选的平台接入

你也可以在这里直接接入一个 IM 平台，或者先跳过，等进入 Dashboard 后再配置。

当前 setup 支持：

- Telegram
- Feishu
- WeCom
- Slack
- QQ Bot
- WhatsApp
- 暂时跳过

如果你还不确定要接哪一个平台，建议先跳过，把 Dashboard 和 Agent 本体先跑通。

### 平台说明

- Telegram：需要从 `@BotFather` 获取 Bot Token
- Feishu / WeCom / Slack / QQ Bot / WhatsApp：setup 可以先保存核心凭证，后续建议再检查 webhook 和平台侧配置
- 某些平台会用到验证 token，setup 里可以帮助生成

## 一个非常重要的生产环境提醒：保存安全登录链接

setup 最后完成时，生产环境会弹出一个专门的**安全登录链接确认弹窗**。

请先保存好这个链接，再点击确认继续。

原因很简单：

- 生产环境可能会自动开启登录门禁
- 这个登录链接是最方便、最直接的安全入口
- 如果你还没进 Dashboard 就把它丢了，后续恢复会麻烦很多

## Setup 完成后做什么

完成 setup 后，建议按这个顺序继续：

1. 进入 Dashboard
2. 确认第一个 Agent 已经创建成功
3. 在你选择的平台里测试一次消息收发，或者稍后再补平台配置
4. 继续配置知识库、Skills、MCP、多模态等能力
5. 准备好之后再尝试自进化工作流

推荐继续阅读：

- [README.zh-CN.md](./README.zh-CN.md)
- [skills/self-evolution-guide/SKILL.md](./skills/self-evolution-guide/SKILL.md)
- [src/lib/agent/README.md](./src/lib/agent/README.md)

## 常见问题

### Setup 提示 connection failed

优先检查：

- Supabase PAT 是否正确
- Project Ref 是否正确
- 当前部署环境能否访问 Supabase

### 最后一步没有可选模型

回到第 3 步，确认至少有一个 Provider API Key 已经成功保存。

### Telegram Bot 配好了但没有反应

请检查：

- Bot Token 是否正确
- `NEXT_PUBLIC_APP_URL` 是否与你的真实公网域名一致
- Dashboard 里 Agent 是否创建成功
- Dashboard 中的 webhook 状态和事件日志

### 生产环境里找不到登录入口

直接使用 setup 最后一步保存下来的安全登录链接。
