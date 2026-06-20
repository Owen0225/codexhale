import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "../plugins/codexhale/scripts/lib/args.mjs";

test("parses review subcommand with flags", () => {
  const out = parseArgs(["review", "--base", "main", "--background", "--scope", "branch"]);
  assert.deepEqual(out, {
    subcommand: "review",
    wait: false,
    background: true,
    base: "main",
    scope: "branch",
    model: null,
    resume: null,
    fresh: false,
    positional: [],
    reviewGate: null,
  });
});

test("wait flag sets wait true and background false", () => {
  const out = parseArgs(["review", "--wait"]);
  assert.equal(out.wait, true);
  assert.equal(out.background, false);
});

test("rescue collects positional task text", () => {
  const out = parseArgs(["rescue", "--background", "fix", "the", "flaky", "test"]);
  assert.equal(out.subcommand, "rescue");
  assert.equal(out.background, true);
  assert.equal(out.positional.join(" "), "fix the flaky test");
});

test("rescue model fin maps to deepseek-v4-flash", () => {
  const out = parseArgs(["rescue", "--model", "fin", "do thing"]);
  assert.equal(out.model, "deepseek-v4-flash");
});

test("rescue resume bare (no args) becomes --continue", () => {
  const out = parseArgs(["rescue", "--resume"]);
  assert.equal(out.resume, "continue");
  assert.equal(out.positional.length, 0);
});

test("rescue resume with id keeps id", () => {
  const out = parseArgs(["rescue", "--resume", "sess_abc", "apply fix"]);
  assert.equal(out.resume, "sess_abc");
});

test("rescue fresh flag", () => {
  const out = parseArgs(["rescue", "--fresh", "do thing"]);
  assert.equal(out.fresh, true);
  assert.equal(out.resume, null);
});

test("status with job id positional", () => {
  const out = parseArgs(["status", "job_123"]);
  assert.equal(out.subcommand, "status");
  assert.equal(out.positional[0], "job_123");
});

test("setup enable/disable review gate", () => {
  assert.equal(parseArgs(["setup", "--enable-review-gate"]).reviewGate, "enable");
  assert.equal(parseArgs(["setup", "--disable-review-gate"]).reviewGate, "disable");
  assert.equal(parseArgs(["setup"]).reviewGate, null);
});

test("rescue resume with non-sess_ id is consumed", () => {
  const out = parseArgs(["rescue", "--resume", "my-custom-id", "apply fix"]);
  assert.equal(out.resume, "my-custom-id");
  assert.equal(out.positional.join(" "), "apply fix");
});

test("rescue resume bare before another flag becomes continue", () => {
  const out = parseArgs(["rescue", "--resume", "--background", "do thing"]);
  assert.equal(out.resume, "continue");
  assert.equal(out.background, true);
  assert.equal(out.positional.join(" "), "do thing");
});
