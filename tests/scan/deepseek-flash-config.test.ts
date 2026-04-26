import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEEPSEEK_NON_THINKING_MODE,
  DEFAULT_DEEPSEEK_MODEL,
  resolveDeepSeekModel,
} from "../../backend/src/deepseekConfig.js";

const DEEPSEEK_REQUEST_FILES = [
  "backend/src/deepseek.ts",
  "backend/src/server.ts",
  "backend/src/personalization/explainers/deepseekExplainer.ts",
  "scripts/maintainer/run-ingredient-overview-targeted-replay.ts",
];

test("DeepSeek default model is explicit V4 Flash", () => {
  assert.equal(DEFAULT_DEEPSEEK_MODEL, "deepseek-v4-flash");
  assert.equal(resolveDeepSeekModel(null), "deepseek-v4-flash");
  assert.equal(resolveDeepSeekModel(""), "deepseek-v4-flash");
  assert.equal(resolveDeepSeekModel(" deepseek-v4-flash "), "deepseek-v4-flash");
  assert.equal(resolveDeepSeekModel("deepseek-chat"), "deepseek-v4-flash");
  assert.equal(resolveDeepSeekModel("deepseek-reasoner"), "deepseek-v4-flash");
});

test("DeepSeek requests explicitly disable thinking mode", async () => {
  assert.deepEqual(DEEPSEEK_NON_THINKING_MODE, { type: "disabled" });

  for (const file of DEEPSEEK_REQUEST_FILES) {
    const source = await readFile(file, "utf8");
    const directCallCount = (
      source.match(/https:\/\/api\.deepseek\.com\/v1\/chat\/completions/g) ?? []
    ).length;
    const nonThinkingCount = (
      source.match(/thinking:\s*DEEPSEEK_NON_THINKING_MODE/g) ?? []
    ).length;

    assert.equal(
      nonThinkingCount,
      directCallCount,
      `${file} should set thinking disabled for every direct DeepSeek chat completion request`,
    );
    assert.equal(source.includes("deepseek-chat"), false, `${file} should not default to the deprecated alias`);
  }
});
