import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "../plugins/codexhale/scripts/lib/extract-json.mjs";

test("parses a pure JSON object", () => {
  assert.deepEqual(extractJsonObject('{"issues":[]}'), { issues: [] });
});

test("parses pretty-printed JSON with surrounding whitespace", () => {
  assert.deepEqual(extractJsonObject('\n  {\n  "issues": []\n}\n '), { issues: [] });
});

test("extracts the object when wrapped in leading prose", () => {
  assert.deepEqual(extractJsonObject('Here are the findings:\n{"issues":[{"file":"a"}]}'), {
    issues: [{ file: "a" }],
  });
});

test("regression: trailing prose with extra braces does not drop findings", () => {
  const msg = 'Findings: {"issues":[{"file":"a","severity":"high"}]} -- see {other} for context.';
  const out = extractJsonObject(msg);
  assert.equal(out.issues.length, 1);
  assert.equal(out.issues[0].file, "a");
});

test("handles nested braces inside the object", () => {
  assert.deepEqual(extractJsonObject('text {"issues":[{"meta":{"k":"v"}}]} trailing'), {
    issues: [{ meta: { k: "v" } }],
  });
});

test("brace scan ignores braces inside strings", () => {
  assert.deepEqual(extractJsonObject('prefix {"d":"a } b","n":1} suffix'), { d: "a } b", n: 1 });
});

test("returns null when there is no JSON object", () => {
  assert.equal(extractJsonObject("not json at all"), null);
  assert.equal(extractJsonObject(""), null);
  assert.equal(extractJsonObject(null), null);
});
