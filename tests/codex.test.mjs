import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewArgv, parseReviewOutput } from "../plugins/codexhale/scripts/lib/codex.mjs";

test("buildReviewArgv uses plain exec (not exec review) with read-only sandbox + json", () => {
  const argv = buildReviewArgv({ base: "main", focus: "look for races" });
  assert.equal(argv[0], "exec");
  assert.ok(!argv.includes("review")); // exec review emits prose; plain exec honors our JSON instruction
  assert.ok(argv.includes("--json"));
  assert.ok(argv.includes("--sandbox"));
  assert.ok(argv.includes("read-only"));
  // scope + focus are carried in the instruction (last arg) since plain exec has no --base
  const instruction = argv[argv.length - 1];
  assert.match(instruction, /git diff main\.\.\.HEAD/);
  assert.match(instruction, /look for races$/);
});

test("buildReviewArgv uncommitted instruction when no base", () => {
  const argv = buildReviewArgv({ base: null, focus: null });
  assert.match(argv[argv.length - 1], /uncommitted/i);
});

test("buildReviewArgv stable: identical inputs byte-identical", () => {
  assert.deepEqual(buildReviewArgv({ base: "main", focus: "x" }), buildReviewArgv({ base: "main", focus: "x" }));
});

test("parseReviewOutput extracts JSON from codex 0.14x item.completed/agent_message/text", () => {
  const lines = [
    JSON.stringify({ type: "thread.started" }),
    JSON.stringify({ type: "item.completed", item: { id: "i1", type: "reasoning", text: "thinking" } }),
    JSON.stringify({ type: "item.completed", item: { id: "i2", type: "agent_message", text: 'here:\n{"issues":[]}' } }),
    JSON.stringify({ type: "turn.completed" }),
  ];
  assert.deepEqual(parseReviewOutput(lines.join("\n")), { issues: [] });
});

test("parseReviewOutput strips ANSI/prefix before the JSON event", () => {
  const ansi = "]0;codex";
  const lines = [ansi + JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"issues":[{"file":"a"}]}' } })];
  assert.deepEqual(parseReviewOutput(lines.join("\n")), { issues: [{ file: "a" }] });
});

test("parseReviewOutput backward-compat: older last_message schema still works", () => {
  const lines = [JSON.stringify({ type: "completed", last_message: '{"issues":[]}' })];
  assert.deepEqual(parseReviewOutput(lines.join("\n")), { issues: [] });
});

test("parseReviewOutput returns null on no parseable message", () => {
  assert.equal(parseReviewOutput("not json at all"), null);
});
