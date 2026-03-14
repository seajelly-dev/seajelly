import type { Locale } from "./types";

const botStrings = {
  en: {
    accessDenied: "⛔ Access denied. Contact the admin.",
    accessRevoked: "⛔ Your access has been revoked.",
    pendingApproval:
      "⏳ This agent is in approval mode. Your access request has been sent to the owner. " +
      "You will be notified once approved or rejected. Please wait.",
    accessApproved: "✅ Your access has been approved! You can start chatting now.",
    accessRejected: "❌ Your access request has been rejected.",
    newSession: "✨ New session started.",
    sessionCreateFailed: "Failed to create session.",
    noChannelRecord: "No channel record found.",

    helpTitle: "📋 *{agentName} — Commands*",
    helpNew: "{prefix}new — Start a new session",
    helpSkill: "{prefix}skill — Show available skills",
    helpWhoami: "{prefix}whoami — Show your identity profile",
    helpStatus: "{prefix}status — Show session status",
    helpTts: "{prefix}tts — Toggle TTS (owner only)",
    helpLive: "{prefix}live — Get a live voice chat link",
    helpAsr: "{prefix}asr — Get an ASR transcription link",
    helpRoom: "{prefix}room — Create a cross-platform chatroom (owner only)",
    helpHelp: "{prefix}help — Show this message",
    helpFooter: "Send any text to chat.",
    helpSlackTip: "💡 _Slack tip: type a space before `/` if commands don't trigger, or use `!` as prefix (e.g. `!new`)._",

    skillTitle: "🧩 *Skills*",
    skillActive: "✅ *Active ({count})*",
    skillAvailable: "💤 *Available ({count})*",
    skillNone: "No skills configured for this agent.",
    skillAutoHint: "Skills auto-activate when you discuss related topics.",

    statusTitle: "📊 *Status*",
    statusAgent: "*Agent:* {agentName}",
    statusModel: "*Model:* `{model}`",
    statusAccessMode: "*Access Mode:* {accessMode}",
    statusMessages: "*Session Messages:* {count}",

    whoamiTitle: "👤 *Who Am I*",
    whoamiUid: "*Platform UID:* `{uid}`",
    whoamiName: "*Display Name:* {name}",
    whoamiAllowed: "*Allowed:* {status}",
    whoamiSoul: "*User Soul:*\n{soul}",

    startGreeting: "👋 Hi! I'm *{agentName}*. Send me a message or type {prefix}help for commands.",

    ttsOwnerOnly: "⛔ Only the agent owner can toggle TTS.",
    ttsEnabled: "🔊 TTS has been *enabled* for agent *{agentName}*.",
    ttsDisabled: "🔇 TTS has been *disabled* for agent *{agentName}*.",

    liveTitle: "🎙 *Live Voice Chat*",
    liveLink: "[Open Live Voice]({url})",
    liveExpires: "⏰ Expires: {time}",
    liveSecurity: "⚠️ *Security Warning:* This link contains your API key access. Do NOT share it with anyone.",
    liveCreateFailed: "❌ Failed to create live voice link.",

    asrTitle: "🎤 *ASR Transcription*",
    asrLink: "[Open ASR Recorder]({url})",
    asrExpires: "⏰ Expires: {time}",
    asrSecurity: "⚠️ *Security Warning:* This link contains your API key access. Do NOT share it with anyone.",
    asrCreateFailed: "❌ Failed to create ASR link.",

    trialRemaining: "🎁 You have {n} free trial message(s) remaining.",
    trialExhausted: "⏳ Your free trial has been used up.",
    trialExhaustedApproval:
      "⏳ Your free trial has been used up. Your access request has been sent to the owner for approval. " +
      "You will be notified once approved. Please wait.",
    subscriptionRequired: "🔒 A subscription is required to continue. Choose a plan below:",
    subscriptionPlanItem: "• *{name}* — {price} ({desc})",
    subscriptionPayHere: "👉 [Subscribe Now]({url})",
    subscriptionContactAdmin: "📩 Please contact the admin to subscribe.",
    planDescDays: "{n} days",
    planDescMessages: "{n} messages",
    subscriptionActivated: "✅ Subscription activated! Valid until {date}.",
    subscriptionActivatedQuota: "✅ Subscription activated! {quota} messages available.",
    subscriptionExpiringSoon: "⏰ Your subscription expires in {days} day(s). Please renew to continue.",
    subscriptionExpired: "⏳ Your subscription has expired. Please renew to continue chatting.",
    quotaRemaining: "📊 Remaining messages: {n}",
    quotaExhausted: "📊 Your message quota is used up. Please purchase a new plan.",
    trialWelcome: "👋 Welcome! You have {n} free trial message(s). Enjoy!",

    errorPrefix: "⚠️ Error: {error}",
    errorAllKeysCooling: "All API keys for this provider are cooling down. Please retry later.",
    errorAllKeysCoolingAfter: "All API keys for this provider are cooling down. Please retry in {minutes} minute(s).",
    errorInvalidApiKeys: "API keys are configured but invalid.",
    errorRateLimit: "Rate limit / high demand — please retry later",
    errorModelNotFound: "Model not found — please check provider & model settings",
    errorNoApiKey: "No API key configured for this provider",
    errorAuthFailed: "API key authentication failed",
    errorTimeout: "Request timed out",
    errorAborted: "Request aborted (possibly exceeded max processing time)",
    errorContextTooLong: "Message too long — exceeds context window limit",
    errorNetwork: "Network connection failed",
    noResponse: "[No response]",
    noResponseGenerated: "[No response generated]",

    notifyApprovalRequest:
      "🔔 *Access request*\n\n" +
      "*Name:* {name}\n" +
      "*Platform:* {platform}\n" +
      "*ID:* `{uid}`\n\n" +
      "This user wants to chat. Approve or reject?",
    notifyNewUser:
      "🔔 *New user joined*\n\n" +
      "*Name:* {name}\n" +
      "*Platform:* {platform}\n" +
      "*ID:* `{uid}`",
    approveButton: "✅ Approve",
    rejectButton: "❌ Reject",
    approved: "✅ *Approved:* {name}",
    rejected: "❌ *Rejected:* {name}",
    approvedShort: "✅ {name} approved",
    rejectedShort: "❌ {name} rejected",
    alreadyProcessed: "⚠️ Already processed",
    alreadyProcessedDot: "⚠️ Already processed.",
    onlyOwnerAction: "Only the owner can do this",
    unknownAction: "Unknown action",

    welcomeTitle: "👋 *Welcome!*",
    welcomeBody: "Your access is now active. Here are the available commands to get started:",

    cmdDescNew: "Start a new session (clear history)",
    cmdDescSkill: "Show skills available in this session",
    cmdDescWhoami: "Show your channel info and soul",
    cmdDescStatus: "Show current agent and session status",
    cmdDescTts: "Toggle TTS text-to-speech (owner only)",
    cmdDescLive: "Get a live voice chat link",
    cmdDescAsr: "Get an ASR transcription link",
    cmdDescHelp: "Show available commands",
    cmdDescRoom: "Create a cross-platform chatroom",

    roomCreated:
      "🏠 *Chatroom Created*\n\n" +
      "*Title:* {title}\n" +
      "🔗 [Join Chatroom]({url})\n\n" +
      "Share this link with anyone to join the chatroom.",
    roomBroadcast: "🏠 *You're invited to a chatroom!*\n\n*Title:* {title}\n🔗 [Join Chatroom]({url})",
    roomClosed: "🏠 Chatroom *{title}* has been closed.",
    roomReopened: "🏠 Chatroom *{title}* has been reopened!\n\n🔗 [Join Chatroom]({url})",
    roomOwnerOnly: "Only the owner can create, close, or reopen chatrooms.",
    roomCreateFailed: "Failed to create chatroom.",
    roomConfigRequired:
      "Room Sub-App security is not configured yet. Ask the admin to finish the Room configuration in Dashboard → Sub-Apps.",
    roomNoActive: "No active chatroom to close.",
    roomNoClosed: "No closed chatroom to reopen.",

    jellyboxNoR2Hint: "💡 The file has been processed for this turn, but cloud storage (JellyBox) is not configured. It cannot be referenced in later turns. Contact the admin to set up JellyBox.",

  },

  zh: {
    accessDenied: "⛔ 拒绝访问。请联系管理员。",
    accessRevoked: "⛔ 你的访问权限已被撤销。",
    pendingApproval:
      "⏳ 此 Agent 为审批模式。你的访问请求已发送给实控人。" +
      "审批通过或拒绝后会通知你，请耐心等待。",
    accessApproved: "✅ 你的访问已被批准！现在可以开始聊天了。",
    accessRejected: "❌ 你的访问请求已被拒绝。",
    newSession: "✨ 新会话已开始。",
    sessionCreateFailed: "创建会话失败。",
    noChannelRecord: "未找到频道记录。",

    helpTitle: "📋 *{agentName} — 命令列表*",
    helpNew: "{prefix}new — 开始新会话",
    helpSkill: "{prefix}skill — 查看可用技能",
    helpWhoami: "{prefix}whoami — 查看你的身份档案",
    helpStatus: "{prefix}status — 查看会话状态",
    helpTts: "{prefix}tts — 开关 TTS 语音（仅实控人）",
    helpLive: "{prefix}live — 获取实时语音聊天链接",
    helpAsr: "{prefix}asr — 获取 ASR 语音识别链接",
    helpRoom: "{prefix}room — 创建跨平台聊天室（仅实控人）",
    helpHelp: "{prefix}help — 显示此帮助信息",
    helpFooter: "直接发送文字即可开始聊天。",
    helpSlackTip: "💡 _Slack 提示：如果 `/` 命令未触发，请在 `/` 前加一个空格，或使用 `!` 前缀（如 `!new`）。_",

    statusTitle: "📊 *状态*",
    statusAgent: "*Agent：* {agentName}",
    statusModel: "*模型：* `{model}`",
    statusAccessMode: "*访问模式：* {accessMode}",
    statusMessages: "*会话消息数：* {count}",

    whoamiTitle: "👤 *我是谁*",
    whoamiUid: "*平台 UID：* `{uid}`",
    whoamiName: "*显示名称：* {name}",
    whoamiAllowed: "*状态：* {status}",
    whoamiSoul: "*用户灵魂：*\n{soul}",

    startGreeting: "👋 你好！我是 *{agentName}*。发送消息或输入 {prefix}help 查看命令列表。",

    ttsOwnerOnly: "⛔ 只有实控人可以切换 TTS。",
    ttsEnabled: "🔊 已为 Agent *{agentName}* *开启* TTS。",
    ttsDisabled: "🔇 已为 Agent *{agentName}* *关闭* TTS。",

    liveTitle: "🎙 *实时语音聊天*",
    liveLink: "[打开实时语音]({url})",
    liveExpires: "⏰ 过期时间：{time}",
    liveSecurity: "⚠️ *安全警告：* 此链接包含你的 API 密钥访问权限，请勿分享给任何人。",
    liveCreateFailed: "❌ 创建实时语音链接失败。",

    asrTitle: "🎤 *ASR 语音识别*",
    asrLink: "[打开 ASR 录音]({url})",
    asrExpires: "⏰ 过期时间：{time}",
    asrSecurity: "⚠️ *安全警告：* 此链接包含你的 API 密钥访问权限，请勿分享给任何人。",
    asrCreateFailed: "❌ 创建 ASR 链接失败。",

    trialRemaining: "🎁 你还有 {n} 次免费试用机会。",
    trialExhausted: "⏳ 免费试用已用完。",
    trialExhaustedApproval:
      "⏳ 免费试用已用完。你的访问请求已发送给实控人审批，审批通过后会通知你，请耐心等待。",
    subscriptionRequired: "🔒 需要订阅后才能继续使用。请选择套餐：",
    subscriptionPlanItem: "• *{name}* — {price}（{desc}）",
    subscriptionPayHere: "👉 [立即订阅]({url})",
    subscriptionContactAdmin: "📩 请联系管理员进行订阅。",
    planDescDays: "{n} 天",
    planDescMessages: "{n} 条消息",
    subscriptionActivated: "✅ 订阅已激活！有效期至 {date}。",
    subscriptionActivatedQuota: "✅ 订阅已激活！可用对话 {quota} 次。",
    subscriptionExpiringSoon: "⏰ 你的订阅将在 {days} 天后到期，请及时续费。",
    subscriptionExpired: "⏳ 你的订阅已过期，请续费后继续使用。",
    quotaRemaining: "📊 剩余对话次数：{n}",
    quotaExhausted: "📊 对话次数已用完，请购买新套餐。",
    trialWelcome: "👋 欢迎！你有 {n} 次免费试用机会，尽情体验吧！",

    errorPrefix: "⚠️ 错误：{error}",
    errorAllKeysCooling: "该模型服务商的全部 API Key 正在冷却中，请稍后重试。",
    errorAllKeysCoolingAfter: "该模型服务商的全部 API Key 正在冷却中，请在剩余 {minutes} 分钟后重试。",
    errorInvalidApiKeys: "该模型服务商的 API Key 已配置，但无效或解密失败。",
    errorRateLimit: "请求过载或达到速率限制，请稍后重试",
    errorModelNotFound: "模型不存在，请检查服务商与模型配置",
    errorNoApiKey: "该模型服务商未配置可用的 API Key",
    errorAuthFailed: "API Key 鉴权失败",
    errorTimeout: "请求超时",
    errorAborted: "请求已中止（可能超过最大处理时长）",
    errorContextTooLong: "消息过长，超出模型上下文窗口限制",
    errorNetwork: "网络连接失败",
    noResponse: "[无回复]",
    noResponseGenerated: "[未生成回复]",

    notifyApprovalRequest:
      "🔔 *访问请求*\n\n" +
      "*名称：* {name}\n" +
      "*平台：* {platform}\n" +
      "*ID：* `{uid}`\n\n" +
      "该用户想要聊天，是否批准？",
    notifyNewUser:
      "🔔 *新用户加入*\n\n" +
      "*名称：* {name}\n" +
      "*平台：* {platform}\n" +
      "*ID：* `{uid}`",
    approveButton: "✅ 批准",
    rejectButton: "❌ 拒绝",
    approved: "✅ *已批准：* {name}",
    rejected: "❌ *已拒绝：* {name}",
    approvedShort: "✅ {name} 已批准",
    rejectedShort: "❌ {name} 已拒绝",
    alreadyProcessed: "⚠️ 已处理过",
    alreadyProcessedDot: "⚠️ 已处理过。",
    onlyOwnerAction: "只有实控人可以执行此操作",
    unknownAction: "未知操作",

    welcomeTitle: "👋 *欢迎！*",
    welcomeBody: "你的访问已激活。以下是可用的命令，帮助你快速上手：",

    cmdDescNew: "开始新会话（清除历史）",
    cmdDescSkill: "查看本会话可用的技能",
    cmdDescWhoami: "查看你的频道信息和灵魂档案",
    cmdDescStatus: "查看当前 Agent 和会话状态",
    cmdDescTts: "开关 TTS 文字转语音（仅实控人）",
    cmdDescLive: "获取实时语音聊天链接",
    cmdDescAsr: "获取 ASR 语音识别链接",
    cmdDescHelp: "显示可用命令",
    cmdDescRoom: "创建跨平台聊天室",

    roomCreated:
      "🏠 *聊天室已创建*\n\n" +
      "*标题：* {title}\n" +
      "🔗 [进入聊天室]({url})\n\n" +
      "分享此链接即可加入聊天室。",
    roomBroadcast: "🏠 *你被邀请加入聊天室！*\n\n*标题：* {title}\n🔗 [进入聊天室]({url})",
    roomClosed: "🏠 聊天室 *{title}* 已关闭。",
    roomReopened: "🏠 聊天室 *{title}* 已重新开启！\n\n🔗 [进入聊天室]({url})",
    roomOwnerOnly: "只有实控人可以创建、关闭或重开聊天室。",
    roomCreateFailed: "创建聊天室失败。",
    roomConfigRequired:
      "Room 子应用的安全配置尚未完成。请让管理员先在 Dashboard → Sub-Apps 完成 Room 配置。",
    roomNoActive: "没有可关闭的活跃聊天室。",
    roomNoClosed: "没有可重新开启的已关闭聊天室。",

    jellyboxNoR2Hint: "💡 文件已在本次对话中处理，但由于未配置云存储（JellyBox），无法在后续对话中引用。请联系管理员配置 JellyBox。",


    skillTitle: "🧩 *技能列表*",
    skillActive: "✅ *已激活 ({count})*",
    skillAvailable: "💤 *可用 ({count})*",
    skillNone: "当前 Agent 未配置任何技能。",
    skillAutoHint: "技能会在讨论相关话题时自动激活。",
  },
} as const;

export type BotStringKey = keyof typeof botStrings.en;

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`,
  );
}

export function botT(
  locale: Locale,
  key: BotStringKey,
  params?: Record<string, string | number>,
): string {
  const dict = botStrings[locale] || botStrings.en;
  const raw = dict[key] || botStrings.en[key] || key;
  return interpolate(raw, params);
}

export function getBotLocaleOrDefault(agentLocale?: string | null): Locale {
  if (agentLocale === "zh" || agentLocale === "en") return agentLocale;
  return "en";
}

export function humanizeAgentError(locale: Locale, error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const coolingMatch = msg.match(/All API keys are cooling down(?:.*?until ([0-9TZ:.\-+]+))?/i);
  if (coolingMatch) {
    const untilRaw = coolingMatch[1];
    if (untilRaw) {
      const dt = new Date(untilRaw);
      if (!Number.isNaN(dt.getTime())) {
        const diffMs = dt.getTime() - Date.now();
        const minutes = Math.max(1, Math.ceil(diffMs / 60_000));
        return botT(locale, "errorAllKeysCoolingAfter", { minutes });
      }
    }
    return botT(locale, "errorAllKeysCooling");
  }

  if (/API keys are configured but invalid/i.test(msg)) {
    return botT(locale, "errorInvalidApiKeys");
  }
  if (/rate.?limit|\b429\b|high.?demand|overloaded|capacity|quota.?exceeded|too.?many.?requests|server.?overloaded|resource.?exhausted/i.test(msg)) {
    return botT(locale, "errorRateLimit");
  }
  if (/\b404\b|not.?found/i.test(msg)) {
    return botT(locale, "errorModelNotFound");
  }
  if (/No API key configured/i.test(msg)) {
    return botT(locale, "errorNoApiKey");
  }
  if (/authentication|unauthorized|invalid.*key|api.?key/i.test(msg)) {
    return botT(locale, "errorAuthFailed");
  }
  if (/timeout|timed?\s*out|deadline/i.test(msg)) {
    return botT(locale, "errorTimeout");
  }
  if (/abort/i.test(msg)) {
    return botT(locale, "errorAborted");
  }
  if (/context.?length|token.?limit|too.?long/i.test(msg)) {
    return botT(locale, "errorContextTooLong");
  }
  if (/network|connect|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
    return botT(locale, "errorNetwork");
  }
  return msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
}

export function buildHelpText(
  locale: Locale,
  agentName: string,
  platform: string,
): string {
  const prefix = "/";
  const t = (k: BotStringKey, p?: Record<string, string | number>) => botT(locale, k, p);
  let text =
    t("helpTitle", { agentName }) + "\n\n" +
    t("helpNew", { prefix }) + "\n" +
    t("helpSkill", { prefix }) + "\n" +
    t("helpWhoami", { prefix }) + "\n" +
    t("helpStatus", { prefix }) + "\n" +
    t("helpTts", { prefix }) + "\n" +
    t("helpLive", { prefix }) + "\n" +
    t("helpAsr", { prefix }) + "\n" +
    t("helpRoom", { prefix }) + "\n" +
    t("helpHelp", { prefix }) + "\n\n" +
    t("helpFooter");
  if (platform === "slack") {
    text += "\n\n" + t("helpSlackTip");
  }
  return text;
}

export function buildWelcomeText(
  locale: Locale,
  agentName: string,
  platform: string,
): string {
  const prefix = "/";
  const t = (k: BotStringKey, p?: Record<string, string | number>) => botT(locale, k, p);
  let text =
    t("welcomeTitle") + "\n" +
    t("welcomeBody") + "\n\n" +
    t("helpNew", { prefix }) + "\n" +
    t("helpSkill", { prefix }) + "\n" +
    t("helpWhoami", { prefix }) + "\n" +
    t("helpStatus", { prefix }) + "\n" +
    t("helpTts", { prefix }) + "\n" +
    t("helpLive", { prefix }) + "\n" +
    t("helpAsr", { prefix }) + "\n" +
    t("helpRoom", { prefix }) + "\n" +
    t("helpHelp", { prefix }) + "\n\n" +
    t("helpFooter");
  if (platform === "slack") {
    text += "\n\n" + t("helpSlackTip");
  }
  return text;
}

export function getBotCommands(locale: Locale) {
  const t = (k: BotStringKey) => botT(locale, k);
  return [
    { command: "new", description: t("cmdDescNew") },
    { command: "skill", description: t("cmdDescSkill") },
    { command: "whoami", description: t("cmdDescWhoami") },
    { command: "status", description: t("cmdDescStatus") },
    { command: "tts", description: t("cmdDescTts") },
    { command: "live", description: t("cmdDescLive") },
    { command: "asr", description: t("cmdDescAsr") },
    { command: "room", description: t("cmdDescRoom") },
    { command: "help", description: t("cmdDescHelp") },
  ];
}
