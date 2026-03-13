# SEAJelly 🪼

**Self Evolution Agent** — 5 分钟拥有你的云端 AI 助手。由 [seaJelly.ai](https://seajelly.ai) 驱动。

无需服务器、无需 Docker、无需 SSH。只需 Supabase + Vercel 免费套餐。

> 🇬🇧 [English](./README.md)

---

## 目录

- [准备工作](#准备工作)
- [第一步：注册服务](#第一步注册服务)
- [第二步：部署到 Vercel](#第二步部署到-vercel)
- [第三步：绑定自定义域名](#第三步绑定自定义域名)
- [第四步：运行 Setup 向导](#第四步运行-setup-向导)
- [第五步：开始使用](#第五步开始使用)
- [本地开发](#本地开发)
- [架构](#架构)
- [常见问题](#常见问题)

---

## 准备工作

你需要准备以下内容（全部免费）：

| 项目 | 说明 |
|---|---|
| 一个自定义域名 | **强烈建议**使用自己的域名，Vercel 自带的 `.vercel.app` 二级域名在国内无法访问 |
| GitHub 账号 | 用于 Fork 仓库和 Vercel 部署 |
| 科学上网工具 | 注册 Supabase、Vercel、Telegram 时可能需要 |

---

## 第一步：注册服务

### 1.1 Supabase（数据库）

> 官网：**https://supabase.com**

1. 注册账号（支持 GitHub 登录）
2. 点击 **New Project**，选择免费套餐
3. 设置项目名称和数据库密码（记住密码）
4. Region 建议选 **Southeast Asia (Singapore)**
5. 等待项目创建完成（约 1-2 分钟）

**需要记录的信息：**

| 信息 | 获取路径 |
|---|---|
| Project URL | Settings → API → Project URL（形如 `https://xxxxx.supabase.co`） |
| Anon Key | Settings → API → `anon` `public`（以 `eyJ` 开头的长字符串） |
| Service Role Key | Settings → API → `service_role` `secret`（⚠️ **不要泄露！**） |
| Project Ref | 项目 URL 中 `https://` 和 `.supabase.co` 之间的部分 |
| Access Token (PAT) | 点击左下角头像 → Account → Access Tokens → **Generate new token** |

### 1.2 Vercel（部署平台）

> 官网：**https://vercel.com**

1. 使用 GitHub 账号登录
2. 注册完成即可，后续部署时会自动关联

### 1.3 获取 LLM API Key（至少一个）

SEAJelly 支持多家大模型，**至少需要一个** API Key：

| 提供商 | 注册地址 | 获取 Key 路径 | 推荐理由 |
|---|---|---|---|
| **Google Gemini** ⭐ | https://aistudio.google.com/apikey | 直接在页面生成 | **免费额度最高，新手首选** |
| Anthropic (Claude) | https://console.anthropic.com | Settings → API Keys | 最强推理能力 |
| OpenAI (GPT) | https://platform.openai.com/api-keys | 页面直接创建 | 生态最全 |
| DeepSeek | https://platform.deepseek.com/api_keys | 页面直接创建 | 性价比高 |

> 💡 **新手推荐**：先用 Google Gemini，免费额度足够日常使用。

### 1.4 Telegram Bot Token（可选）

> 在 Telegram 中搜索 **@BotFather**

1. 发送 `/newbot`
2. 按提示设置 Bot 名称和用户名
3. 获得一串 Token（形如 `123456789:ABCdef...`）

> 也可以在 Setup 完成后再配置。

---

## 第二步：部署到 Vercel

### 2.1 Fork 仓库

1. 打开本项目 GitHub 页面
2. 点击右上角 **Fork**
3. Fork 到你自己的 GitHub 账号下

### 2.2 在 Vercel 中导入

1. 打开 https://vercel.com/new
2. 选择刚才 Fork 的 `seajelly` 仓库
3. 在 **Environment Variables** 中填入以下变量：

| 变量名 | 值 | 说明 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` | Supabase 项目 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...` | Supabase Anon Key |
| `ENCRYPTION_KEY` | *（见下方生成方法）* | 加密密钥 |
| `NEXT_PUBLIC_APP_URL` | `https://你的域名.com` | 你的自定义域名（⚠️ **非常重要！**） |
| `CRON_SECRET` | *（见下方生成方法）* | Cron 任务密钥 |

**生成 ENCRYPTION_KEY 和 CRON_SECRET：**

在终端运行（运行两次，分别用于两个变量）：

```bash
openssl rand -base64 32
```

或在浏览器控制台运行：

```javascript
crypto.getRandomValues(new Uint8Array(32)).reduce((a,b) => a + b.toString(16).padStart(2,'0'), '')
```

4. 点击 **Deploy** 等待部署完成

---

## 第三步：绑定自定义域名

> ⚠️ **重要**：Vercel 的 `.vercel.app` 域名在中国大陆被墙，**必须绑定自己的域名**才能正常访问。

1. 在 Vercel 项目页面，进入 **Settings → Domains**
2. 输入你的域名（如 `oc.yourdomain.com`）
3. 按照 Vercel 提示，到你的域名 DNS 管理处添加 CNAME 记录：
   - 类型：`CNAME`
   - 名称：`oc`（或你选择的子域名）
   - 值：`cname.vercel-dns.com`
4. 等待 DNS 生效（通常几分钟到几小时）
5. **重要**：回到 Vercel → Settings → Environment Variables，确认 `NEXT_PUBLIC_APP_URL` 已更新为你的自定义域名

---

## 第四步：运行 Setup 向导

打开浏览器访问：

```
https://你的域名/setup
```

Setup 向导共 4 步：

### 第 1 步：连接 Supabase

| 字段 | 填什么 |
|---|---|
| Supabase Access Token (PAT) | 在 [1.1](#11-supabase数据库) 中获取的 Access Token |
| Project Ref | 项目 URL 中间那段（如 `gjtcqawhjgaohawslmbs`） |

> 点击 "Connect & Initialize" 后，系统会自动创建所有数据库表、启用 pg_cron 和 pg_net 扩展。**不需要手动执行任何 SQL。**

### 第 2 步：创建管理员

填写邮箱和密码（密码至少 6 位）。这是你登录 Dashboard 的账号。

### 第 3 步：配置 API 密钥

| 字段 | 必填 | 说明 |
|---|---|---|
| Supabase Service Role Key | ✅ 是 | Settings → API → `service_role` |
| Anthropic API Key | 至少填 | Claude 模型 |
| OpenAI API Key | 一个 | GPT 模型 |
| Google AI API Key | LLM Key | Gemini 模型 ⭐ 推荐 |
| DeepSeek API Key | | DeepSeek 模型 |

### 第 4 步：创建 Agent

| 字段 | 说明 |
|---|---|
| Agent Name | 你的 AI 助手名字 |
| Telegram Bot Token | 可选，从 @BotFather 获取 |
| Model | 根据你填的 API Key 自动显示可用模型 |
| System Prompt | 系统提示词，已有默认值，可自定义 |

> 💡 如果填了 Telegram Bot Token，系统会**自动设置 Webhook**，无需额外操作。

---

## 第五步：开始使用

### Dashboard 管理面板

Setup 完成后会自动跳转到 Dashboard（`https://你的域名/dashboard`）。

| 模块 | 功能 |
|---|---|
| **Agents** | 管理 AI 助手：模型、提示词、Bot Token、Webhook 状态 |
| **Channels** | 管理用户访问权限和身份档案 |
| **Secrets** | 管理加密的 API 密钥 |
| **Sessions** | 查看对话历史 |
| **Tasks** | 管理定时任务 |
| **MCP Servers** | 连接外部 MCP 工具服务 |
| **Skills** | 管理 Agent 知识技能 |
| **Events** | 事件队列调试面板 |

### Telegram Bot

如果你在 Setup 中配置了 Bot Token：

1. 在 Telegram 中找到你的 Bot
2. 发送 `/start` 开始对话
3. 直接发消息即可聊天

**可用命令：**

| 命令 | 功能 |
|---|---|
| `/new` | 开始新会话（清除历史） |
| `/status` | 查看当前 Agent 和会话状态 |
| `/whoami` | 查看你的身份档案 |
| `/help` | 显示命令列表 |

### Webhook 状态确认

在 Dashboard → Agents 页面，每个配了 Bot Token 的 Agent 卡片底部会显示 Webhook 状态：

- ✅ **绿色 "Webhook 已激活"** — 一切正常
- ⚠️ **橙色 "Webhook 未设置"** — 点击 "设置 Webhook" 按钮即可

---

## 本地开发

```bash
# 克隆仓库
git clone https://github.com/your-username/seajelly.git
cd seajelly

# 安装依赖
pnpm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入你的 Supabase 凭证

# 生成加密密钥
openssl rand -base64 32
# 填入 .env.local 的 ENCRYPTION_KEY

# 启动开发服务器 (http://localhost:3000)
pnpm dev
```

---

## 架构

```
用户
  │
  ├── Telegram ──→ Webhook ──→ events 表 ──→ Agent Loop ──→ 回复
  │                                ↑
  │                          after() 触发
  │                          worker 处理
  │
  └── Dashboard ──→ Next.js App ──→ Supabase (RLS + Auth)
                                       │
                                       ├── agents      (AI 助手配置)
                                       ├── sessions    (对话历史)
                                       ├── channels    (用户档案)
                                       ├── secrets     (加密密钥)
                                       ├── events      (事件队列)
                                       ├── memories    (长期记忆)
                                       ├── cron_jobs   (定时任务)
                                       ├── mcp_servers (MCP 工具)
                                       └── skills      (知识技能)
```

**核心流程：**

1. Telegram 消息 → Webhook 接收 → 写入 events 表
2. `after()` 回调触发 Worker → 从 events 表取出 pending 事件
3. Agent Loop 执行：加载 session → 注入 system prompt + skills + soul → 调用 LLM → 执行工具 → 回复
4. 更新 session 历史，标记 event 为 processed

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Next.js 16 (App Router) + shadcn/ui + Tailwind CSS |
| AI 引擎 | Vercel AI SDK (`generateText` + tools) |
| Telegram | grammY (Webhook) |
| 数据库 | Supabase PostgreSQL + pgvector |
| 认证 | Supabase Auth + Row Level Security |
| 定时任务 | pg_cron + pg_net |
| 部署 | Vercel Serverless Functions |

## 支持的模型

| 提供商 | 模型 |
|---|---|
| Anthropic | Claude Sonnet 4、Claude 3.5 Haiku |
| OpenAI | GPT-4o、GPT-4o Mini、o3-mini |
| Google | Gemini 3.1 Pro、Gemini 3/2.5 Flash、Gemini 2.5 Pro |
| DeepSeek | DeepSeek Chat、DeepSeek Reasoner |

---

## 常见问题

### Q: 部署后访问显示 404 或无法连接？

**A:** 中国用户必须绑定自定义域名。`.vercel.app` 在国内被墙。参考[第三步](#第三步绑定自定义域名)。

### Q: Setup 第一步报错 "Connection failed"？

**A:** 检查 Supabase Access Token (PAT) 和 Project Ref 是否正确。PAT 在 Supabase 左下角头像 → Account → Access Tokens 生成。

### Q: Telegram Bot 没有反应？

**A:** 检查以下几点：
1. Dashboard → Agents 页面，确认 Webhook 状态为绿色 "已激活"
2. 如果显示 "未设置"，点击 "设置 Webhook" 按钮
3. 确认 Vercel 环境变量中 `NEXT_PUBLIC_APP_URL` 设置为你的自定义域名
4. 在 Dashboard → Events 页面查看是否有 pending 事件

### Q: Events 一直是 pending 状态？

**A:** 确认 Vercel 部署的是最新代码。Webhook 收到消息后会通过 `after()` 自动触发 Worker 处理。如果仍有问题，检查 Vercel Functions 日志。

### Q: 可以不用 Telegram 吗？

**A:** 目前 Telegram 是唯一支持的消息平台。未来计划支持更多平台。你可以先只使用 Dashboard 管理功能。

### Q: 免费套餐够用吗？

**A:** 对于个人使用完全够用：
- **Supabase Free**：500MB 数据库，5GB 带宽
- **Vercel Hobby**：100GB 带宽，Serverless 函数 100 小时/月
- **Gemini Free**：每分钟 15 次请求，每天 1500 次

---

## License

MIT
