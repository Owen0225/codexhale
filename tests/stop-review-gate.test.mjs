import { test } from "node:test";
import assert from "node:assert/strict";
import { extractChangedFiles, extractClaim } from "../plugins/codexhale/scripts/stop-review-gate-hook.mjs";

test("extractChangedFiles collects Edit/Write file paths, deduped, ignoring read-only tools", () => {
  const transcript = [
    { role: "assistant", content: [
      { type: "tool_use", name: "Read", input: { file_path: "/x/read-only.ts" } },
      { type: "tool_use", name: "Edit", input: { file_path: "/x/a.ts" } },
    ] },
    { role: "assistant", content: [
      { type: "tool_use", name: "Write", input: { file_path: "/x/b.ts" } },
      { type: "tool_use", name: "Edit", input: { file_path: "/x/a.ts" } },
    ] },
  ];
  assert.deepEqual(extractChangedFiles(transcript).sort(), ["/x/a.ts", "/x/b.ts"]);
});

test("extractChangedFiles returns empty when no edits happened", () => {
  const transcript = [{ role: "assistant", content: [{ type: "text", text: "hi" }] }];
  assert.deepEqual(extractChangedFiles(transcript), []);
});

test("extractChangedFiles falls back to input.path", () => {
  const transcript = [{ type: "tool_use", name: "NotebookEdit", input: { path: "/x/nb.ipynb" } }];
  assert.deepEqual(extractChangedFiles(transcript), ["/x/nb.ipynb"]);
});

test("extractClaim returns the last text node", () => {
  const transcript = [
    { type: "text", text: "first" },
    { role: "assistant", content: "earlier claim" },
    { type: "text", text: "final claim" },
  ];
  assert.equal(extractClaim(transcript), "final claim");
});

test("extractClaim returns empty string when no text present", () => {
  assert.equal(extractClaim([{ type: "tool_use", name: "Edit", input: { file_path: "a" } }]), "");
});

test("extractClaim truncates to 500 chars", () => {
  assert.equal(extractClaim([{ type: "text", text: "x".repeat(600) }]).length, 500);
});
