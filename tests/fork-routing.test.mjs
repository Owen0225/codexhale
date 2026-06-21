import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = path.join(ROOT, "plugins/codexhale/skills");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

const mdFiles = () => walk(SKILLS).filter(f => f.endsWith(".md"));

test("no forked file invokes a bare spec-* skill (must be codexhale:spec-*)", () => {
  const offenders = [];
  for (const f of mdFiles()) {
    const text = fs.readFileSync(f, "utf8");
    const re = /Skill\(skill=['"](spec-[a-z-]+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) offenders.push(`${path.relative(ROOT, f)} -> ${m[1]}`);
  }
  assert.deepEqual(offenders, [], `bare spec-* calls found:\n${offenders.join("\n")}`);
});

test("status-dispatch table routes to codexhale: phase skills, not bare", () => {
  const dispatch = fs.readFileSync(path.join(SKILLS, "spec/steps/02-status-dispatch.md"), "utf8");
  for (const phase of ["spec-plan", "spec-bugfix-plan", "spec-implement", "spec-verify", "spec-bugfix-verify"]) {
    assert.ok(dispatch.includes(`codexhale:${phase}`), `dispatch table missing codexhale:${phase}`);
    assert.ok(!new RegExp("`" + phase + "`").test(dispatch), `dispatch table still has bare \`${phase}\``);
  }
});

test("code-review stays bare (not namespaced)", () => {
  const verify = fs.readFileSync(path.join(SKILLS, "spec-verify/steps/03-collect-results.md"), "utf8");
  assert.match(verify, /Skill\(skill=['"]code-review['"]/);
  assert.ok(!/codexhale:code-review/.test(verify));
});
