import { test } from "node:test";
import assert from "node:assert/strict";
import { runDebateReview } from "../plugins/codexhale/scripts/codexhale-companion.mjs";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

function tmpHome() { return fs.mkdtempSync(path.join(os.tmpdir(), "dbr-")); }
const base = { base: null, positional: [] };

// Each dep returns {code, stdout, stderr}. stdout carries JSON the parsers extract.
function cwStream(obj) { return JSON.stringify({ type: "turn_completed", final_message: JSON.stringify(obj) }) + "\n"; }
function cxJsonl(obj) { return JSON.stringify({ type: "completed", last_message: JSON.stringify(obj) }) + "\n"; }

test("early-exit: zero critical/high -> clean, no rebuttal calls", async () => {
  let rebuttalCalls = 0;
  const deps = {
    runCw: async (argv) => { if (argv.some(a => /Opponent findings/.test(String(a)))) rebuttalCalls++; return { code: 0, stdout: cwStream({ issues: [{ file: "f", line_range: [1, 2], category: "design", severity: "low", description: "x" }] }), stderr: "" }; },
    runCx: async (argv) => { if (String(argv[argv.length - 1]).includes("Opponent findings")) rebuttalCalls++; return { code: 0, stdout: cxJsonl({ issues: [] }), stderr: "" }; },
    home: tmpHome(),
  };
  const out = await runDebateReview(base, deps);
  assert.equal(out.verdict.clean, true);
  assert.equal(rebuttalCalls, 0);
});

test("agreed critical/high (both models) -> not clean, never sent to rebuttal", async () => {
  let rebuttalCalls = 0;
  const bug = { file: "a.rs", line_range: [10, 20], category: "bug", severity: "high", description: "npe" };
  const deps = {
    runCw: async (argv) => { if (argv.some(a => /Opponent findings/.test(String(a)))) rebuttalCalls++; return { code: 0, stdout: cwStream({ issues: [bug] }), stderr: "" }; },
    runCx: async (argv) => { if (String(argv[argv.length - 1]).includes("Opponent findings")) rebuttalCalls++; return { code: 0, stdout: cxJsonl({ issues: [{ ...bug, line_range: [12, 18] }] }), stderr: "" }; },
    home: tmpHome(),
  };
  const out = await runDebateReview(base, deps);
  assert.equal(out.verdict.clean, false);
  assert.equal(rebuttalCalls, 0);
  assert.equal(out.findings[0].status, "agreed");
});

test("degraded: codex missing -> single-model uncontested, degraded flag", async () => {
  const deps = {
    runCw: async () => ({ code: 0, stdout: cwStream({ issues: [{ file: "f", line_range: [1, 2], category: "bug", severity: "high", description: "x" }] }), stderr: "" }),
    runCx: async () => ({ code: -1, stdout: "", stderr: "codex not found" }),
    home: tmpHome(),
  };
  const out = await runDebateReview(base, deps);
  assert.equal(out.verdict.degraded, true);
  assert.equal(out.findings[0].status, "uncontested");
});

test("single-model critical/high disputed -> rebuttal runs, refute -> refuted -> clean", async () => {
  const bug = { file: "f", line_range: [1, 2], category: "bug", severity: "critical", description: "only cw saw this" };
  const deps = {
    runCw: async (argv) => {
      const isRebuttal = argv.some(a => /Opponent findings/.test(String(a)));
      return { code: 0, stdout: isRebuttal ? cwStream({ rebuttals: [] }) : cwStream({ issues: [bug] }), stderr: "" };
    },
    runCx: async (argv) => {
      const isRebuttal = String(argv[argv.length - 1]).includes("Opponent findings");
      return { code: 0, stdout: isRebuttal ? cxJsonl({ rebuttals: [{ finding_id: "f:1:bug", verdict: "refute", reason: "guarded upstream" }] }) : cxJsonl({ issues: [] }), stderr: "" };
    },
    home: tmpHome(),
  };
  const out = await runDebateReview(base, deps);
  assert.equal(out.findings[0].status, "refuted");
  assert.equal(out.verdict.clean, true);
});
