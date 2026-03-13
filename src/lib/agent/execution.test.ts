import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentReply } from "@/lib/agent/execution";

test("resolveAgentReply returns deploy follow-up when step limit reached after push with no text", () => {
  const result = resolveAgentReply({
    resultText: "",
    calledToolNames: new Set(["github_commit_push"]),
    stepsCount: 10,
    locale: "en",
    maxSteps: 10,
    noResponseText: "fallback",
  });

  assert.equal(result.roomToolCalled, false);
  assert.match(result.reply, /auto-deploy/i);
});

test("resolveAgentReply suppresses text when room tool handled", () => {
  const result = resolveAgentReply({
    resultText: "ignored",
    calledToolNames: new Set(["create_chat_room"]),
    stepsCount: 1,
    locale: "en",
    maxSteps: 10,
    noResponseText: "fallback",
  });

  assert.equal(result.roomToolCalled, true);
  assert.equal(result.reply, "");
});

test("resolveAgentReply returns generic step-limit prompt when no push succeeded", () => {
  const result = resolveAgentReply({
    resultText: "",
    calledToolNames: new Set(),
    stepsCount: 10,
    locale: "en",
    maxSteps: 10,
    noResponseText: "fallback",
  });

  assert.equal(result.roomToolCalled, false);
  assert.match(result.reply, /step limit/i);
});

test("resolveAgentReply falls back to noResponseText before step limit", () => {
  const result = resolveAgentReply({
    resultText: "",
    calledToolNames: new Set(),
    stepsCount: 2,
    locale: "en",
    maxSteps: 10,
    noResponseText: "fallback",
  });

  assert.equal(result.reply, "fallback");
});
