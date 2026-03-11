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
    helpWhoami: "{prefix}whoami — Show your identity profile",
    helpStatus: "{prefix}status — Show session status",
    helpTts: "{prefix}tts — Toggle TTS (owner only)",
    helpLive: "{prefix}live — Get a live voice chat link",
    helpAsr: "{prefix}asr — Get an ASR transcription link",
    helpHelp: "{prefix}help — Show this message",
    helpFooter: "Send any text to chat.",

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
    subscriptionRequired: "🔒 A subscription is required to continue. Choose a plan below:",
    subscriptionPlanItem: "• *{name}* — {price} ({desc})",
    subscriptionPayHere: "👉 [Subscribe Now]({url})",
    subscriptionActivated: "✅ Subscription activated! Valid until {date}.",
    subscriptionActivatedQuota: "✅ Subscription activated! {quota} messages available.",
    subscriptionExpiringSoon: "⏰ Your subscription expires in {days} day(s). Please renew to continue.",
    subscriptionExpired: "⏳ Your subscription has expired. Please renew to continue chatting.",
    quotaRemaining: "📊 Remaining messages: {n}",
    quotaExhausted: "📊 Your message quota is used up. Please purchase a new plan.",
    trialWelcome: "👋 Welcome! You have {n} free trial message(s). Enjoy!",

    errorPrefix: "⚠️ Error: {error}",
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

    pushApproved: "✅ Push approved",
    pushRejected: "❌ Push rejected",
    pushExpired: "⏱️ Approval expired",
    pushExpiredTitle: "⏱️ *Push approval expired*",
    pushAlreadyProcessed: "Already processed",
    pushApprovedTitle: "✅ *Push Approved*\n\n{summary}",
    pushRejectedTitle: "❌ *Push Rejected*\n\n{summary}",
    pushApprovedNotify: "✅ Push approved. Please send a message from the owner account to tell the agent to proceed with pushing.",
    pushRejectedNotify: "❌ Push rejected by owner.",

    welcomeTitle: "👋 *Welcome!*",
    welcomeBody: "Your access is now active. Here are the available commands to get started:",

    cmdDescNew: "Start a new session (clear history)",
    cmdDescSwitch: "Switch to a different agent",
    cmdDescWhoami: "Show your channel info and soul",
    cmdDescStatus: "Show current agent and session status",
    cmdDescTts: "Toggle TTS text-to-speech (owner only)",
    cmdDescLive: "Get a live voice chat link",
    cmdDescAsr: "Get an ASR transcription link",
    cmdDescHelp: "Show available commands",
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
    helpWhoami: "{prefix}whoami — 查看你的身份档案",
    helpStatus: "{prefix}status — 查看会话状态",
    helpTts: "{prefix}tts — 开关 TTS 语音（仅实控人）",
    helpLive: "{prefix}live — 获取实时语音聊天链接",
    helpAsr: "{prefix}asr — 获取 ASR 语音识别链接",
    helpHelp: "{prefix}help — 显示此帮助信息",
    helpFooter: "直接发送文字即可开始聊天。",

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
    subscriptionRequired: "🔒 需要订阅后才能继续使用。请选择套餐：",
    subscriptionPlanItem: "• *{name}* — {price}（{desc}）",
    subscriptionPayHere: "👉 [立即订阅]({url})",
    subscriptionActivated: "✅ 订阅已激活！有效期至 {date}。",
    subscriptionActivatedQuota: "✅ 订阅已激活！可用对话 {quota} 次。",
    subscriptionExpiringSoon: "⏰ 你的订阅将在 {days} 天后到期，请及时续费。",
    subscriptionExpired: "⏳ 你的订阅已过期，请续费后继续使用。",
    quotaRemaining: "📊 剩余对话次数：{n}",
    quotaExhausted: "📊 对话次数已用完，请购买新套餐。",
    trialWelcome: "👋 欢迎！你有 {n} 次免费试用机会，尽情体验吧！",

    errorPrefix: "⚠️ 错误：{error}",
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

    pushApproved: "✅ 推送已批准",
    pushRejected: "❌ 推送已拒绝",
    pushExpired: "⏱️ 审批已过期",
    pushExpiredTitle: "⏱️ *推送审批已过期*",
    pushAlreadyProcessed: "已处理过",
    pushApprovedTitle: "✅ *推送已批准*\n\n{summary}",
    pushRejectedTitle: "❌ *推送已拒绝*\n\n{summary}",
    pushApprovedNotify: "✅ 推送已批准。请从实控人账号发送消息，告知 Agent 继续推送。",
    pushRejectedNotify: "❌ 推送已被实控人拒绝。",

    welcomeTitle: "👋 *欢迎！*",
    welcomeBody: "你的访问已激活。以下是可用的命令，帮助你快速上手：",

    cmdDescNew: "开始新会话（清除历史）",
    cmdDescSwitch: "切换到其他 Agent",
    cmdDescWhoami: "查看你的频道信息和灵魂档案",
    cmdDescStatus: "查看当前 Agent 和会话状态",
    cmdDescTts: "开关 TTS 文字转语音（仅实控人）",
    cmdDescLive: "获取实时语音聊天链接",
    cmdDescAsr: "获取 ASR 语音识别链接",
    cmdDescHelp: "显示可用命令",
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

export function buildHelpText(
  locale: Locale,
  agentName: string,
  platform: string,
): string {
  const prefix = platform === "telegram" ? "/" : "!";
  const t = (k: BotStringKey, p?: Record<string, string | number>) => botT(locale, k, p);
  return (
    t("helpTitle", { agentName }) + "\n\n" +
    t("helpNew", { prefix }) + "\n" +
    t("helpWhoami", { prefix }) + "\n" +
    t("helpStatus", { prefix }) + "\n" +
    t("helpTts", { prefix }) + "\n" +
    t("helpLive", { prefix }) + "\n" +
    t("helpAsr", { prefix }) + "\n" +
    t("helpHelp", { prefix }) + "\n\n" +
    t("helpFooter")
  );
}

export function buildWelcomeText(
  locale: Locale,
  agentName: string,
  platform: string,
): string {
  const prefix = platform === "telegram" ? "/" : "!";
  const t = (k: BotStringKey, p?: Record<string, string | number>) => botT(locale, k, p);
  return (
    t("welcomeTitle") + "\n" +
    t("welcomeBody") + "\n\n" +
    t("helpNew", { prefix }) + "\n" +
    t("helpWhoami", { prefix }) + "\n" +
    t("helpStatus", { prefix }) + "\n" +
    t("helpTts", { prefix }) + "\n" +
    t("helpLive", { prefix }) + "\n" +
    t("helpAsr", { prefix }) + "\n" +
    t("helpHelp", { prefix }) + "\n\n" +
    t("helpFooter")
  );
}

export function getBotCommands(locale: Locale) {
  const t = (k: BotStringKey) => botT(locale, k);
  return [
    { command: "new", description: t("cmdDescNew") },
    { command: "switch", description: t("cmdDescSwitch") },
    { command: "whoami", description: t("cmdDescWhoami") },
    { command: "status", description: t("cmdDescStatus") },
    { command: "tts", description: t("cmdDescTts") },
    { command: "live", description: t("cmdDescLive") },
    { command: "asr", description: t("cmdDescAsr") },
    { command: "help", description: t("cmdDescHelp") },
  ];
}
