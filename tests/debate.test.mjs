import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRebuttalInstruction, buildCodexRebuttalArgv, parseRebuttalOutput } from "../plugins/codexhale/scripts/lib/debate.mjs";

test("buildRebuttalInstruction embeds opponent findings as JSON and asks for verdicts", () => {
  const s = buildRebuttalInstruction("codewhale", [{ id: "f:1:bug", description: "npe" }], "main");
  assert.match(s, /Opponent findings/);
  assert.match(s, /f:1:bug/);
  assert.match(s, /agree|refute/);
  assert.match(s, /main/);
});

test("buildRebuttalInstruction default posture is agree-unless-counter and no new issues", () => {
  const s = buildRebuttalInstruction("codex", [{ id: "x:2:security", description: "y" }], null);
  assert.match(s, /agree unless/i);
  assert.match(s, /do not (invent|introduce) new/i);
});

test("buildCodexRebuttalArgv uses plain exec with read-only sandbox, not exec review", () => {
  const argv = buildCodexRebuttalArgv("codex", [{ id: "a:1:bug" }], "main");
  assert.equal(argv[0], "exec");
  assert.ok(!argv.includes("review"));
  assert.ok(argv.includes("--sandbox"));
  assert.ok(argv.includes("read-only"));
  assert.equal(typeof argv[argv.length - 1], "string");
});

test("parseRebuttalOutput extracts rebuttals and drops malformed entries", () => {
  const obj = { rebuttals: [{ finding_id: "a", verdict: "agree", reason: "ok" }, { reason: "missing id" }] };
  const out = parseRebuttalOutput(obj);
  assert.equal(out.length, 1);
  assert.equal(out[0].finding_id, "a");
});

test("parseRebuttalOutput returns [] on null/garbage", () => {
  assert.deepEqual(parseRebuttalOutput(null), []);
  assert.deepEqual(parseRebuttalOutput({}), []);
});
