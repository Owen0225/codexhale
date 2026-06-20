import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewArgv, parseReviewOutput } from "../plugins/codexhale/scripts/lib/codex.mjs";

test("buildReviewArgv uses exec review subcommand with json + read-only sandbox", () => {
  const argv = buildReviewArgv({ base: "main", focus: "look for races" });
  assert.equal(argv[0], "exec");
  assert.equal(argv[1], "review");
  assert.ok(argv.includes("--json"));
  assert.ok(argv.includes("--sandbox"));
  assert.ok(argv.includes("read-only"));
  assert.ok(argv.includes("--base"));
  assert.ok(argv.includes("main"));
  assert.ok(argv[argv.length - 1] === "look for races");
});

test("buildReviewArgv uncommitted when no base", () => {
  const argv = buildReviewArgv({ base: null, focus: null });
  assert.ok(argv.includes("--uncommitted"));
});

test("buildReviewArgv stable: identical inputs byte-identical", () => {
  const a = buildReviewArgv({ base: "main", focus: "x" });
  const b = buildReviewArgv({ base: "main", focus: "x" });
  assert.deepEqual(a, b);
});

test("parseReviewOutput extracts JSON from last-message jsonl event", () => {
  const lines = [
    JSON.stringify({ type: "message", content: "thinking..." }),
    JSON.stringify({ type: "completed", last_message: '{\n  "issues": []\n}' }),
  ];
  const out = parseReviewOutput(lines.join("\n"));
  assert.deepEqual(out, { issues: [] });
});

test("parseReviewOutput returns null on no parseable message", () => {
  assert.equal(parseReviewOutput("not json at all"), null);
});
