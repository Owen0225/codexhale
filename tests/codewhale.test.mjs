import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStreamJson, buildReviewArgv, buildRescueArgv } from "../plugins/codexhale/scripts/lib/codewhale.mjs";

test("parseStreamJson extracts final message JSON from stream lines", () => {
  const lines = [
    JSON.stringify({ type: "tool_use", name: "read_file" }),
    JSON.stringify({ type: "agent_message", delta: "partial" }),
    JSON.stringify({ type: "turn_completed", final_message: '{\n  "issues": []\n}' }),
  ];
  const out = parseStreamJson(lines.join("\n"));
  assert.deepEqual(out, { issues: [] });
});

test("parseStreamJson returns null when no final message", () => {
  const lines = [JSON.stringify({ type: "tool_use" })];
  assert.equal(parseStreamJson(lines.join("\n")), null);
});

test("buildReviewArgv includes read-only disallowed-tools and stable system prompt", () => {
  const argv = buildReviewArgv({
    rubric: "RUBRIC_TEXT",
    instruction: "DO_REVIEW",
    maxTurns: 50,
  });
  assert.ok(argv.includes("--auto"));
  assert.ok(argv.includes("--output-format"));
  assert.ok(argv.includes("stream-json"));
  assert.ok(argv.includes("--disallowed-tools"));
  assert.ok(argv.includes("write_file,edit_file,apply_patch"));
  assert.ok(argv.includes("--allowed-tools"));
  assert.ok(argv.includes("read_file,exec_shell"));
  assert.ok(argv.includes("--max-turns"));
  assert.ok(argv.includes("50"));
  assert.ok(argv.includes("--append-system-prompt"));
  assert.ok(argv.includes("RUBRIC_TEXT"));
  assert.ok(argv[argv.length - 1] === "DO_REVIEW");
});

test("buildReviewArgv stable: identical inputs produce byte-identical argv", () => {
  const a = buildReviewArgv({ rubric: "R", instruction: "I", maxTurns: 50 });
  const b = buildReviewArgv({ rubric: "R", instruction: "I", maxTurns: 50 });
  assert.deepEqual(a, b);
});

test("buildRescueArgv uses yolo and no max-turns, applies model + continue", () => {
  const argv = buildRescueArgv({ task: "fix it", model: "deepseek-v4-flash", resume: "continue" });
  assert.ok(argv.includes("--yolo"));
  assert.ok(!argv.includes("--max-turns"));
  assert.ok(argv.includes("--model"));
  assert.ok(argv.includes("deepseek-v4-flash"));
  assert.ok(argv.includes("--continue"));
  assert.ok(argv[argv.length - 1] === "fix it");
});

test("buildRescueArgv resume id uses --resume", () => {
  const argv = buildRescueArgv({ task: "fix it", model: null, resume: "sess_abc" });
  assert.ok(argv.includes("--resume"));
  assert.ok(argv.includes("sess_abc"));
});
