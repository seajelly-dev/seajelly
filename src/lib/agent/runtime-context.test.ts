import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentSystemPrompt, resolveSkillActivationPlan } from "@/lib/agent/runtime-context";
import type { ChatMessage } from "@/types/database";

test("resolveSkillActivationPlan backfills legacy sessions and activates matching skills", () => {
  const history: ChatMessage[] = [{ role: "user", content: "hello" }];
  const result = resolveSkillActivationPlan({
    allAgentSkills: [
      { id: "s1", name: "Calendar", description: "calendar booking", content: "calendar content" },
      { id: "s2", name: "Travel", description: "trip planning", content: "travel content" },
    ],
    sessionActiveSkillIds: [],
    history,
    messageText: "I need help with travel planning",
  });

  assert.equal(result.isLegacySession, true);
  assert.deepEqual(result.sessionActiveSkillIds, ["s1", "s2"]);
  assert.deepEqual(result.activeSkillIds, ["s1", "s2"]);
});

test("resolveSkillActivationPlan activates relevant inactive skills for current message", () => {
  const result = resolveSkillActivationPlan({
    allAgentSkills: [
      { id: "s1", name: "Calendar", description: "calendar booking", content: "calendar content" },
      { id: "s2", name: "Travel", description: "trip planning", content: "travel content" },
    ],
    sessionActiveSkillIds: ["s1"],
    history: [],
    messageText: "Need help with trip planning next week",
  });

  assert.equal(result.isLegacySession, false);
  assert.deepEqual(result.newlyActivatedIds, ["s2"]);
  assert.deepEqual(result.activeSkillIds, ["s1", "s2"]);
});

test("buildAgentSystemPrompt includes identity, memories, skills, summary, and tool policies", () => {
  const prompt = buildAgentSystemPrompt({
    basePrompt: "Base prompt",
    aiSoul: "Helpful assistant",
    userSoul: "Prefers concise replies",
    canEditAiSoul: false,
    memories: {
      channel: [{ category: "preference", content: "Likes tables" }],
      global: [{ category: "fact", content: "Product ships worldwide" }],
    },
    sessionSummarySection: "## Session Summary\nRecent work",
    activeSkills: [{ id: "s1", name: "Calendar", description: "calendar booking", content: "calendar content" }],
    inactiveSkills: [{ id: "s2", name: "Travel", description: "trip planning", content: "travel content" }],
    toolPolicySections: ["## Tool Policy\nUse tools honestly."],
  });

  assert.match(prompt, /Your Identity/);
  assert.match(prompt, /About This User/);
  assert.match(prompt, /Identity Protection/);
  assert.match(prompt, /## Memories/);
  assert.match(prompt, /## Session Summary/);
  assert.match(prompt, /## Active Skills/);
  assert.match(prompt, /## Available Skills/);
  assert.match(prompt, /## Tool Policy/);
});
