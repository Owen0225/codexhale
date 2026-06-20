import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewInstruction } from "../plugins/codexhale/scripts/lib/review-prompt.mjs";

test("working-tree review with no base", () => {
  const s = buildReviewInstruction({ base: null, focus: null });
  assert.match(s, /Review the current uncommitted changes/);
  assert.match(s, /git status/);
  assert.match(s, /git diff/);
});

test("base-branch review names the base", () => {
  const s = buildReviewInstruction({ base: "main", focus: null });
  assert.match(s, /git diff main\.\.\.HEAD/);
});

test("focus text appended at end", () => {
  const s = buildReviewInstruction({ base: null, focus: "look for race conditions" });
  assert.match(s, /look for race conditions$/);
});

test("adversarial flag adds challenge framing", () => {
  const s = buildReviewInstruction({ base: null, focus: null, adversarial: true });
  assert.match(s, /Challenge the chosen implementation and design/);
});
