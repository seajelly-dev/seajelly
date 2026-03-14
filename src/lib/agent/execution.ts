import { generateText, stepCountIs, type ModelMessage } from "ai";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformSender } from "@/lib/platform/types";
import type { Agent } from "@/types/database";

type GenerateTextResultLike = {
  text?: string;
  steps?: unknown[];
  totalUsage?: unknown;
  usage?: unknown;
};

type DeployCheckState = "BUILDING" | "READY" | "ERROR" | "QUEUED" | "CANCELED" | "NOT_FOUND";

interface DeployCheckObservation {
  commitSha: string | null;
  success: boolean;
  fatal: boolean;
  state: DeployCheckState | null;
  url: string | null;
  error: string | null;
  errorMessage: string | null;
  buildLogs: string | null;
}

interface ExecuteAgentRunParams {
  model: Parameters<typeof generateText>[0]["model"];
  systemPrompt: string;
  messages: ModelMessage[];
  tools: NonNullable<Parameters<typeof generateText>[0]["tools"]>;
  toolDirective: { activeTools: string[]; toolChoice?: "required" } | null;
  sender: PlatformSender;
  platformChatId: string;
  traceId: string;
  locale: "en" | "zh";
  agent: Agent;
  eventId: string | null;
  channelId: string | null;
  sessionId: string;
  supabase: SupabaseClient;
  resolvedProviderId: string | null;
  pickedKeyId: string | null;
  maxWallTimeMs: number;
  maxSteps: number;
  maxTokens: number;
  payloadCharLimit: number;
  readToolName: (stepItem: unknown) => string | null;
  extractDeployCheckObservation: (toolCalls: unknown[], toolResults: unknown[]) => DeployCheckObservation | null;
  formatDeployCheckReply: (params: {
    locale: "en" | "zh";
    observation: DeployCheckObservation;
    pollCount: number;
  }) => string;
  extractToolInputPath: (toolCalls: unknown[]) => string | null;
  extractUsageMetrics: (usage: unknown) => { present: boolean; inputTokens: number; outputTokens: number };
  trimPayload: (input: unknown) => unknown;
  selfEvolutionReadOnlyToolNameSet: Set<string>;
  selfEvolutionToolNameSet: Set<string>;
  isRateLimitError: (error: unknown) => boolean;
  getCooldownDuration: (error: unknown) => number;
  markKeyCooldown: (keyId: string, reason: string, cooldownMs: number) => void;
}

export interface ExecuteAgentRunResult {
  result: GenerateTextResultLike;
  usageRowsInserted: number;
  loggedInputTokens: number;
  loggedOutputTokens: number;
}

export function resolveAgentReply(params: {
  resultText: string;
  calledToolNames: Set<string>;
  stepsCount: number;
  locale: "en" | "zh";
  maxSteps: number;
  noResponseText: string;
}): { reply: string; roomToolCalled: boolean } {
  const { resultText, calledToolNames, stepsCount, locale, maxSteps, noResponseText } = params;
  const roomToolCalled =
    calledToolNames.has("create_chat_room") ||
    calledToolNames.has("close_chat_room") ||
    calledToolNames.has("reopen_chat_room");

  let reply = roomToolCalled ? "" : resultText || noResponseText;
  if (!roomToolCalled && stepsCount >= maxSteps && !resultText.trim()) {
    const hasPushSuccess =
      calledToolNames.has("github_commit_push") || calledToolNames.has("github_patch_files");
    reply = hasPushSuccess
      ? locale === "zh"
        ? "代码已成功推送到 GitHub，Vercel 将自动部署。可以发送\"查询部署状态\"来跟进。"
        : "Code pushed to GitHub. Vercel will auto-deploy. Ask me to check deploy status."
      : locale === "zh"
        ? "本轮任务已达到执行步骤上限。请告诉我需要继续做什么。"
        : "This run reached the step limit. Please tell me what to do next.";
  }

  return { reply, roomToolCalled };
}

export async function executeAgentRun(
  params: ExecuteAgentRunParams,
): Promise<ExecuteAgentRunResult> {
  const {
    model,
    systemPrompt,
    messages,
    tools,
    toolDirective,
    sender,
    platformChatId,
    traceId,
    locale,
    agent,
    eventId,
    channelId,
    sessionId,
    supabase,
    resolvedProviderId,
    pickedKeyId,
    maxWallTimeMs,
    maxSteps,
    maxTokens,
    payloadCharLimit,
    readToolName,
    extractDeployCheckObservation,
    formatDeployCheckReply,
    extractToolInputPath,
    extractUsageMetrics,
    trimPayload,
    selfEvolutionReadOnlyToolNameSet,
    selfEvolutionToolNameSet,
    isRateLimitError,
    getCooldownDuration,
    markKeyCooldown,
  } = params;

  const deadline = Date.now() + maxWallTimeMs;
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), deadline - Date.now());

  await sender.sendTyping(platformChatId);
  const typingInterval = setInterval(() => {
    sender.sendTyping(platformChatId).catch(() => {});
  }, 4000);

  let result: GenerateTextResultLike;
  let stepCounter = 0;
  let lastStepTs = Date.now();
  let forcedToolLoopReply: string | null = null;
  let consecutiveSelfEvolutionReadOnlySteps = 0;
  let lastSelfEvolutionReadPath: string | null = null;
  let consecutiveSameSelfEvolutionReadPath = 0;
  let lastDeployCheckCommitSha: string | null = null;
  let lastDeployCheckState: string | null = null;
  let consecutiveSameDeployCheckState = 0;
  let usageRowsInserted = 0;
  let loggedInputTokens = 0;
  let loggedOutputTokens = 0;

  try {
    const filteredTools = toolDirective
      ? Object.fromEntries(
          Object.entries(tools).filter(([name]) => toolDirective.activeTools.includes(name)),
        )
      : tools;

    const generated = await generateText({
      model,
      system: systemPrompt || undefined,
      messages,
      tools: filteredTools,
      ...(toolDirective?.toolChoice ? { toolChoice: toolDirective.toolChoice } : {}),
      stopWhen: stepCountIs(maxSteps),
      maxOutputTokens: maxTokens,
      abortSignal: abortController.signal,
      onStepFinish: async (step) => {
        try {
          const rec = step as Record<string, unknown>;
          const toolCalls = Array.isArray(rec.toolCalls) ? rec.toolCalls : [];
          const toolResults = Array.isArray(rec.toolResults) ? rec.toolResults : [];
          const callNames = toolCalls.map((call) => readToolName(call)).filter((value): value is string => !!value);
          const resultNames = toolResults.map((call) => readToolName(call)).filter((value): value is string => !!value);
          const names = [...new Set([...callNames, ...resultNames])];
          const phase = toolCalls.length > 0 || toolResults.length > 0 ? "tool" : "model";
          const modelText = typeof rec.text === "string" ? rec.text : "";
          const finishReason = typeof rec.finishReason === "string" ? rec.finishReason : "done";
          const hasToolError = toolResults.some((entry) => {
            if (!entry || typeof entry !== "object") return false;
            const out = ((entry as Record<string, unknown>).output ??
              (entry as Record<string, unknown>).result) as Record<string, unknown> | undefined;
            return Boolean(out && typeof out === "object" && out.success === false);
          });
          const status = finishReason === "error" || hasToolError ? "failed" : "success";
          const toolError = toolResults.find((entry) => {
            if (!entry || typeof entry !== "object") return false;
            const out = ((entry as Record<string, unknown>).output ??
              (entry as Record<string, unknown>).result) as Record<string, unknown> | undefined;
            return Boolean(out && typeof out === "object" && out.success === false);
          }) as Record<string, unknown> | undefined;
          const toolErrorOutput = toolError
            ? ((toolError.output ?? toolError.result) as Record<string, unknown> | undefined)
            : undefined;
          const errorMessage =
            status === "failed" && toolErrorOutput && typeof toolErrorOutput.error === "string"
              ? toolErrorOutput.error
              : finishReason === "error"
                ? "Model step failed"
                : null;
          stepCounter += 1;
          const now = Date.now();
          const latency = Math.max(0, now - lastStepTs);
          lastStepTs = now;

          const deployCheckObservation = extractDeployCheckObservation(toolCalls, toolResults);
          if (deployCheckObservation) {
            const commitKey = deployCheckObservation.commitSha?.toLowerCase() ?? "";
            const stateKey = deployCheckObservation.fatal
              ? "fatal"
              : deployCheckObservation.success
                ? (deployCheckObservation.state ?? "unknown")
                : "error";
            if (commitKey === lastDeployCheckCommitSha && stateKey === lastDeployCheckState) {
              consecutiveSameDeployCheckState += 1;
            } else {
              lastDeployCheckCommitSha = commitKey;
              lastDeployCheckState = stateKey;
              consecutiveSameDeployCheckState = 1;
            }

            const isTerminalDeployState =
              deployCheckObservation.fatal ||
              !deployCheckObservation.success ||
              deployCheckObservation.state === "READY" ||
              deployCheckObservation.state === "ERROR" ||
              deployCheckObservation.state === "NOT_FOUND" ||
              deployCheckObservation.state === "CANCELED";
            const isQueuedTooLong =
              (deployCheckObservation.state === "BUILDING" || deployCheckObservation.state === "QUEUED") &&
              consecutiveSameDeployCheckState >= 3;

            if (!forcedToolLoopReply && (isTerminalDeployState || isQueuedTooLong)) {
              forcedToolLoopReply = formatDeployCheckReply({
                locale,
                observation: deployCheckObservation,
                pollCount: consecutiveSameDeployCheckState,
              });
              console.warn(
                `[agent-loop] trace=${traceId} deploy monitor guard triggered commit=${deployCheckObservation.commitSha ?? ""} state=${deployCheckObservation.state ?? "unknown"} repeats=${consecutiveSameDeployCheckState}`,
              );
              abortController.abort();
            }
          }

          const onlyReadOnlySelfEvolutionTools =
            callNames.length > 0 &&
            callNames.every((name) => selfEvolutionReadOnlyToolNameSet.has(name));
          if (onlyReadOnlySelfEvolutionTools) {
            consecutiveSelfEvolutionReadOnlySteps += 1;
            const readPath = extractToolInputPath(toolCalls);
            if (readPath && readPath === lastSelfEvolutionReadPath) {
              consecutiveSameSelfEvolutionReadPath += 1;
            } else {
              lastSelfEvolutionReadPath = readPath;
              consecutiveSameSelfEvolutionReadPath = readPath ? 1 : 0;
            }

            if (
              !forcedToolLoopReply &&
              (consecutiveSameSelfEvolutionReadPath >= 4 || consecutiveSelfEvolutionReadOnlySteps >= 24)
            ) {
              forcedToolLoopReply =
                locale === "zh"
                  ? `我已经完成仓库初步扫描，但你的需求还不够具体 ${readPath ? `（当前反复读取：${readPath}）` : ""}`.trim() +
                    "。请直接告诉我要改什么功能、哪个页面、文件或报错，我再继续执行。"
                  : `I finished an initial repository scan${readPath ? ` and I keep rereading ${readPath}` : ""}, but the requested change is still too vague. Please tell me the feature, page, file, or error you want me to work on.`;
              console.warn(
                `[agent-loop] trace=${traceId} self-evolution read loop guard triggered after ${consecutiveSelfEvolutionReadOnlySteps} read-only steps (samePathRepeats=${consecutiveSameSelfEvolutionReadPath})`,
              );
              abortController.abort();
            }
          } else if (callNames.some((name) => selfEvolutionToolNameSet.has(name))) {
            consecutiveSelfEvolutionReadOnlySteps = 0;
            lastSelfEvolutionReadPath = null;
            consecutiveSameSelfEvolutionReadPath = 0;
          }

          await supabase.from("agent_step_logs").insert({
            trace_id: traceId,
            event_id: eventId,
            agent_id: agent.id,
            channel_id: channelId,
            session_id: sessionId,
            step_no: typeof rec.stepNumber === "number" ? rec.stepNumber + 1 : stepCounter,
            phase,
            tool_name: names.length > 0 ? names.join(",") : null,
            tool_input_json: trimPayload(toolCalls),
            tool_output_json: trimPayload(toolResults),
            model_text: modelText.length > payloadCharLimit ? modelText.slice(0, payloadCharLimit) : modelText,
            status,
            error_message: errorMessage,
            latency_ms: latency,
          });

          const stepUsage = extractUsageMetrics(rec.usage);
          const actualModelId =
            rec.model &&
            typeof rec.model === "object" &&
            typeof (rec.model as Record<string, unknown>).modelId === "string"
              ? ((rec.model as Record<string, unknown>).modelId as string)
              : agent.model;

          if (stepUsage.present) {
            try {
              await supabase.from("api_usage_logs").insert({
                agent_id: agent.id,
                provider_id: resolvedProviderId,
                model_id: actualModelId,
                key_id: pickedKeyId,
                input_tokens: stepUsage.inputTokens,
                output_tokens: stepUsage.outputTokens,
                duration_ms: latency,
              });
              usageRowsInserted += 1;
              loggedInputTokens += stepUsage.inputTokens;
              loggedOutputTokens += stepUsage.outputTokens;
            } catch (err) {
              console.warn(`[agent-loop] trace=${traceId} api_usage_logs step insert failed:`, err);
            }
          }
        } catch {
          // non-blocking
        }
      },
    });
    result = generated as unknown as GenerateTextResultLike;
  } catch (genErr) {
    if (forcedToolLoopReply && /abort/i.test(genErr instanceof Error ? genErr.message : String(genErr))) {
      result = { text: forcedToolLoopReply, steps: [] };
    } else {
      if (pickedKeyId && isRateLimitError(genErr)) {
        const cd = getCooldownDuration(genErr);
        const reason = genErr instanceof Error ? genErr.message : String(genErr);
        markKeyCooldown(pickedKeyId, reason.slice(0, 500), cd);
      }
      throw genErr;
    }
  } finally {
    clearInterval(typingInterval);
    clearTimeout(timer);
  }

  return {
    result,
    usageRowsInserted,
    loggedInputTokens,
    loggedOutputTokens,
  };
}
