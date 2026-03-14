import assert from "node:assert/strict";
import test from "node:test";
import { runKnowledgeImageSearch } from "@/lib/agent/media-search";

test("runKnowledgeImageSearch returns error when no image_url provided", async () => {
  const result = await runKnowledgeImageSearch({ agentId: "agent_1", imageUrl: null });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /No image URL/);
});
