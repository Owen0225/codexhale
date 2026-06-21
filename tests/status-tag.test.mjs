import { test } from "node:test";
import assert from "node:assert/strict";
import { addIds, tagFindings, computeVerdict } from "../plugins/codexhale/scripts/lib/status-tag.mjs";

test("addIds assigns deterministic file:line:category ids", () => {
  const issues = [{ file: "a.rs", line_range: [10, 20], category: "bug" }];
  assert.equal(addIds(issues)[0].id, "a.rs:10:bug");
});

test("addIds tolerates missing line_range", () => {
  assert.equal(addIds([{ file: "f", category: "design" }])[0].id, "f:0:design");
});

test("tagFindings: found_by both -> agreed", () => {
  const issues = addIds([{ file: "f", line_range: [1, 2], category: "bug", severity: "high", found_by: ["codewhale", "codex"] }]);
  assert.equal(tagFindings(issues, [], [])[0].status, "agreed");
});

test("tagFindings: single codewhale finding refuted by codex -> refuted", () => {
  const issues = addIds([{ file: "f", line_range: [1, 2], category: "bug", severity: "high", found_by: ["codewhale"] }]);
  const out = tagFindings(issues, [], [{ finding_id: "f:1:bug", verdict: "refute", reason: "not reachable" }]);
  assert.equal(out[0].status, "refuted");
});

test("tagFindings: single codex finding agreed by codewhale -> agreed", () => {
  const issues = addIds([{ file: "f", line_range: [3, 4], category: "security", severity: "critical", found_by: ["codex"] }]);
  const out = tagFindings(issues, [{ finding_id: "f:3:security", verdict: "agree", reason: "confirmed" }], []);
  assert.equal(out[0].status, "agreed");
});

test("tagFindings: single finding with no rebuttal -> disputed", () => {
  const issues = addIds([{ file: "f", line_range: [5, 6], category: "bug", severity: "medium", found_by: ["codewhale"] }]);
  assert.equal(tagFindings(issues, [], [])[0].status, "disputed");
});

test("computeVerdict: clean iff no agreed critical/high", () => {
  const dirty = [{ status: "agreed", severity: "high" }];
  const clean = [{ status: "agreed", severity: "medium" }, { status: "disputed", severity: "critical" }, { status: "refuted", severity: "high" }];
  assert.equal(computeVerdict(dirty).clean, false);
  assert.equal(computeVerdict(clean).clean, true);
});
