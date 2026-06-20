import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeFindings, renderMergedReport } from "../plugins/codexhale/scripts/lib/merge.mjs";

test("same file/category/line merges into one with both found_by", () => {
  const a = { issues: [{ file: "src/a.rs", line_range: [10, 20], category: "bug", severity: "high", description: "null deref" }] };
  const b = { issues: [{ file: "src/a.rs", line_range: [12, 18], category: "bug", severity: "high", description: "possible NPE" }] };
  const m = mergeFindings(a, b);
  assert.equal(m.issues.length, 1);
  assert.deepEqual(m.issues[0].found_by.sort(), ["codewhale", "codex"]);
  assert.equal(m.issues[0].disputed, undefined);
});

test("different categories same file do not merge", () => {
  const a = { issues: [{ file: "src/a.rs", line_range: [10, 20], category: "bug", severity: "high", description: "x" }] };
  const b = { issues: [{ file: "src/a.rs", line_range: [10, 20], category: "design", severity: "medium", description: "y" }] };
  const m = mergeFindings(a, b);
  assert.equal(m.issues.length, 2);
});

test("overlap detection uses line range intersection", () => {
  const a = { issues: [{ file: "f", line_range: [1, 50], category: "bug", severity: "high", description: "a" }] };
  const b = { issues: [{ file: "f", line_range: [100, 120], category: "bug", severity: "high", description: "b" }] };
  const m = mergeFindings(a, b);
  assert.equal(m.issues.length, 2);
});

test("one model reports, other silent => found_by single, not disputed", () => {
  const a = { issues: [{ file: "f", line_range: [1, 5], category: "bug", severity: "high", description: "a" }] };
  const b = { issues: [] };
  const m = mergeFindings(a, b);
  assert.equal(m.issues.length, 1);
  assert.deepEqual(m.issues[0].found_by, ["codewhale"]);
});

test("renderMergedReport groups by file with source tags", () => {
  const m = {
    summary: "ok",
    issues: [
      { file: "f.rs", line_range: [1, 5], category: "bug", severity: "high", description: "d1", found_by: ["codewhale", "codex"] },
      { file: "f.rs", line_range: [9, 9], category: "design", severity: "low", description: "d2", found_by: ["codex"], disputed: true },
    ],
  };
  const out = renderMergedReport(m);
  assert.match(out, /## f\.rs/);
  assert.match(out, /\[cw\+codex\]/);
  assert.match(out, /\[disputed\]/);
  assert.match(out, /d1/);
});
