import { test } from "node:test";
import assert from "node:assert/strict";
import { renderDebateReport } from "../plugins/codexhale/scripts/lib/debate-report.mjs";

test("renders findings grouped by file with status badges and a verdict", () => {
  const issues = [
    { file: "a.rs", line_range: [1, 5], category: "bug", severity: "high", description: "npe", status: "agreed", found_by: ["codewhale", "codex"] },
    { file: "a.rs", line_range: [9, 9], category: "design", severity: "low", description: "naming", status: "refuted", found_by: ["codex"] },
  ];
  const out = renderDebateReport(issues, { clean: false, reason: "1 agreed critical/high finding(s) remain" });
  assert.match(out, /## a\.rs/);
  assert.match(out, /\[agreed\]/);
  assert.match(out, /\[refuted\]/);
  assert.match(out, /## Verdict/);
  assert.match(out, /BLOCKING|not clean|remain/i);
});

test("clean verdict renders a clean marker", () => {
  const out = renderDebateReport([], { clean: true, reason: "no agreed critical/high findings" });
  assert.match(out, /## Verdict/);
  assert.match(out, /clean/i);
});
