# codexhale debate-review for spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-round dual-model "debate" review (`debate-review` companion subcommand) to codexhale and wire it into a namespaced fork of the spec chain (`/codexhale:spec`), replacing the optional single-shot Codex companion review.

**Architecture:** Phase A builds the engine inside the codexhale plugin (new lib modules + a `debate-review` subcommand), unit-tested with mocked model runners, reusing the existing review plumbing. Phase B forks the 6-skill spec chain into `plugins/codexhale/skills/`, namespaces every inter-chain `Skill()` call to `codexhale:`, and changes only `spec-verify` / `spec-bugfix-verify` to call `debate-review`. Phase C adds fork-drift tooling and E2E.

**Tech Stack:** Node.js ESM (`.mjs`), `node:test` + `node:assert/strict`, `node:child_process` spawn, existing codexhale `lib/*` modules. No new runtime dependencies.

## Global Constraints

- Node `>=18.18.0` (from `package.json` engines); ESM modules only (`"type": "module"`).
- No new npm dependencies.
- ASCII-only in source files (project hook rejects decorative non-ASCII like em-dash / smart quotes); use `-`, `->`, `"`, `'`.
- Do NOT change the output shape of `lib/merge.mjs` `mergeFindings` / `renderMergedReport` (would break the 51 existing tests). Add a separate `addIds` wrapper instead.
- Tests run via `node --test tests/*.test.mjs` (the `package.json` `test` script).
- Read-only model flags are fixed: CodeWhale `--disallowed-tools write_file,edit_file,apply_patch`; Codex `--sandbox read-only`.
- Forked skill files: rewrite every `Skill(skill='spec-*')` to `Skill(skill='codexhale:spec-*')`; leave `Skill(skill='code-review')` bare.
- Design reference: `docs/superpowers/specs/2026-06-20-codexhale-spec-debate-review-design.md`.

---

## File Structure

New (Phase A, engine):
- `plugins/codexhale/scripts/lib/status-tag.mjs` -- `addIds`, `tagFindings`, `computeVerdict` (pure).
- `plugins/codexhale/scripts/lib/debate.mjs` -- rebuttal instruction builder, rebuttal runners, rebuttal parse.
- `plugins/codexhale/scripts/lib/debate-report.mjs` -- `renderDebateReport`.
- `plugins/codexhale/prompts/rebuttal-codewhale.md`, `prompts/rebuttal-codex.md` -- rebuttal rubrics.
- `plugins/codexhale/schemas/debate-output.schema.json` -- rebuttal response schema.
- Tests: `tests/status-tag.test.mjs`, `tests/debate.test.mjs`, `tests/debate-report.test.mjs`, `tests/debate-review.test.mjs`.

Modified (Phase A):
- `plugins/codexhale/scripts/codexhale-companion.mjs` -- add `runDebateReview` + `case 'debate-review'`.

New (Phase B, fork): `plugins/codexhale/skills/{spec,spec-plan,spec-bugfix-plan,spec-implement,spec-verify,spec-bugfix-verify}/` (copied from global, then edited).

New (Phase C): `plugins/codexhale/scripts/check-fork-drift.sh`, `docs/superpowers/specs/FORK-PROVENANCE.md`, `tests/fork-routing.test.mjs`.

---

## PHASE A -- the debate-review engine

### Task A1: `addIds` + `tagFindings` + `computeVerdict` (status-tag.mjs)

**Files:**
- Create: `plugins/codexhale/scripts/lib/status-tag.mjs`
- Test: `tests/status-tag.test.mjs`

**Interfaces:**
- Consumes: merged issue objects shaped like `mergeFindings` output: `{file, line_range?, category, severity, description, found_by:[...], disputed?}`.
- Produces:
  - `addIds(issues) -> issues` where each issue gains `id` = `` `${file}:${line_range?.[0] ?? 0}:${category}` ``.
  - `tagFindings(issues, cwRebuttals, codexRebuttals) -> issues` each gaining `status: 'agreed'|'disputed'|'refuted'`. `cwRebuttals`/`codexRebuttals` are arrays of `{finding_id, verdict:'agree'|'refute', reason}`. Rule: `found_by` has both -> `agreed`; single-model `['codewhale']` looked up in `codexRebuttals`, `['codex']` in `cwRebuttals`; rebuttal `agree` -> `agreed`; rebuttal `refute` -> `refuted`; no rebuttal -> `disputed`.
  - `computeVerdict(taggedIssues) -> {clean:boolean, agreedBlocking:number, reason:string}` where `clean = true` iff no issue has `status==='agreed' && severity in {critical,high}`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/status-tag.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/status-tag.test.mjs`
Expected: FAIL ("Cannot find module .../status-tag.mjs").

- [ ] **Step 3: Write minimal implementation**

```javascript
// plugins/codexhale/scripts/lib/status-tag.mjs
// Pure helpers for the debate-review engine: stable ids, per-finding status
// tagging from cross-rebuttals, and the clean/blocking verdict.

const BLOCKING = new Set(["critical", "high"]);

export function addIds(issues) {
  return issues.map(i => ({ ...i, id: `${i.file}:${i.line_range?.[0] ?? 0}:${i.category}` }));
}

function rebuttalFor(id, rebuttals) {
  return rebuttals.find(r => r.finding_id === id) || null;
}

// cwRebuttals = CodeWhale adjudicating Codex's single-model findings.
// codexRebuttals = Codex adjudicating CodeWhale's single-model findings.
export function tagFindings(issues, cwRebuttals = [], codexRebuttals = []) {
  return issues.map(issue => {
    const by = issue.found_by || [];
    if (by.includes("codewhale") && by.includes("codex")) {
      return { ...issue, status: "agreed" }; // both found it independently -- unfalsifiable here
    }
    const opposing = by.includes("codewhale") ? codexRebuttals : cwRebuttals;
    const r = rebuttalFor(issue.id, opposing);
    if (r && r.verdict === "agree") return { ...issue, status: "agreed" };
    if (r && r.verdict === "refute") return { ...issue, status: "refuted" };
    return { ...issue, status: "disputed" };
  });
}

export function computeVerdict(taggedIssues) {
  const agreedBlocking = taggedIssues.filter(i => i.status === "agreed" && BLOCKING.has(i.severity)).length;
  return {
    clean: agreedBlocking === 0,
    agreedBlocking,
    reason: agreedBlocking === 0
      ? "no agreed critical/high findings"
      : `${agreedBlocking} agreed critical/high finding(s) remain`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/status-tag.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/status-tag.mjs tests/status-tag.test.mjs
git commit -m "feat(debate): status-tag (ids, tagFindings, computeVerdict)"
```

---

### Task A2: rebuttal builder + parse (debate.mjs)

**Files:**
- Create: `plugins/codexhale/scripts/lib/debate.mjs`
- Test: `tests/debate.test.mjs`

**Interfaces:**
- Consumes: `runCodewhale`, `buildReviewArgv` from `codewhale.mjs`; `runCodex` from `codex.mjs`; `parseStreamJson`/`parseReviewOutput`.
- Produces:
  - `buildRebuttalInstruction(role, opponentFindings, base) -> string` -- diff-target text + serialized opponent findings (with ids) + the per-finding verdict instruction.
  - `buildCodexRebuttalArgv(role, opponentFindings, base) -> string[]` = `['exec','--json','--sandbox','read-only', <instruction>]` (plain exec, NOT `exec review`).
  - `parseRebuttalOutput(parsedObj) -> [{finding_id, verdict, reason}]` -- returns `obj?.rebuttals ?? []`, filtering entries missing `finding_id` or `verdict`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/debate.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debate.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```javascript
// plugins/codexhale/scripts/lib/debate.mjs
// Cross-rebuttal stage of the debate round: each model adjudicates the OTHER
// model's single-model findings. Default posture: agree unless a concrete,
// code-cited counter-argument exists. Models stay read-only and add no new issues.
import { buildReviewArgv, runCodewhale, parseStreamJson } from "./codewhale.mjs";
import { runCodex, parseReviewOutput } from "./codex.mjs";

function diffTarget(base) {
  return base
    ? `Review target: the diff of the current branch vs base \`${base}\` (run \`git diff ${base}...HEAD\`).`
    : `Review target: the current uncommitted changes (run \`git status --short\` and \`git diff\`).`;
}

export function buildRebuttalInstruction(role, opponentFindings, base) {
  const findings = JSON.stringify(opponentFindings ?? [], null, 2);
  return [
    `You are the ${role} reviewer adjudicating another model's findings. ${diffTarget(base)}`,
    `Opponent findings (JSON; each has a stable "id"):`,
    findings,
    `For EACH opponent finding: open the referenced file and line range with read_file, then decide.`,
    `Default posture: AGREE unless you have a concrete, code-cited counter-argument. Do not invent or introduce new issues. Do not modify files.`,
    `Return ONLY a JSON object: {"rebuttals":[{"finding_id":"<id>","verdict":"agree"|"refute","reason":"<one sentence>","evidence_file":"<path>","evidence_line_range":[start,end]}]}`,
  ].join("\n\n");
}

export function buildCodexRebuttalArgv(role, opponentFindings, base) {
  // Plain `codex exec` (NOT `exec review`) so the rebuttal instruction is honored.
  return ["exec", "--json", "--sandbox", "read-only", buildRebuttalInstruction(role, opponentFindings, base)];
}

export function parseRebuttalOutput(parsedObj) {
  const arr = parsedObj?.rebuttals;
  if (!Array.isArray(arr)) return [];
  return arr.filter(r => r && typeof r.finding_id === "string" && (r.verdict === "agree" || r.verdict === "refute"));
}

export async function runCodewhaleRebuttal(rubric, opponentFindings, base, { cwd } = {}) {
  if (!opponentFindings || opponentFindings.length === 0) return [];
  const argv = buildReviewArgv({
    rubric,
    instruction: buildRebuttalInstruction("codewhale", opponentFindings, base),
    maxTurns: Math.max(20, opponentFindings.length * 2),
  });
  const res = await runCodewhale(argv, { cwd });
  return parseRebuttalOutput(parseStreamJson(res.stdout));
}

export async function runCodexRebuttal(opponentFindings, base, { cwd } = {}) {
  if (!opponentFindings || opponentFindings.length === 0) return [];
  const res = await runCodex(buildCodexRebuttalArgv("codex", opponentFindings, base), { cwd });
  return parseRebuttalOutput(parseReviewOutput(res.stdout));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debate.test.mjs`
Expected: PASS (5 tests). (The two `run*Rebuttal` functions are covered by Task A4's integration test with mocked runners.)

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/debate.mjs tests/debate.test.mjs
git commit -m "feat(debate): rebuttal instruction builder, argv, parse + runners"
```

---

### Task A3: debate report renderer (debate-report.mjs)

**Files:**
- Create: `plugins/codexhale/scripts/lib/debate-report.mjs`
- Test: `tests/debate-report.test.mjs`

**Interfaces:**
- Consumes: tagged issues `[{file, line_range?, category, severity, description, status, found_by}]` + a verdict `{clean, reason}`.
- Produces: `renderDebateReport(taggedIssues, verdict) -> string` (Markdown grouped by file, with a `## Verdict` section).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/debate-report.test.mjs
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debate-report.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```javascript
// plugins/codexhale/scripts/lib/debate-report.mjs
// Markdown renderer for one debate round. Kept separate from merge.mjs so the
// existing report shape (and its tests) stay untouched.

export function renderDebateReport(taggedIssues, verdict) {
  const byFile = new Map();
  for (const i of taggedIssues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  const lines = ["# Codexhale debate review", ""];
  lines.push(`${taggedIssues.length} finding(s) after CodeWhale + Codex cross-examination.`, "");
  for (const [file, issues] of byFile) {
    lines.push(`## ${file}`);
    for (const i of issues) {
      const loc = i.line_range ? `:${i.line_range[0]}-${i.line_range[1]}` : "";
      lines.push(`- [${i.status}] ${i.severity} ${i.category}${loc} - ${i.description}`);
    }
    lines.push("");
  }
  lines.push("## Verdict");
  lines.push(verdict.clean ? `clean - ${verdict.reason}` : `BLOCKING - ${verdict.reason}`);
  lines.push("");
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/debate-report.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/debate-report.mjs tests/debate-report.test.mjs
git commit -m "feat(debate): debate report renderer"
```

---

### Task A4: rubric prompts + output schema

**Files:**
- Create: `plugins/codexhale/prompts/rebuttal-codewhale.md`
- Create: `plugins/codexhale/prompts/rebuttal-codex.md`
- Create: `plugins/codexhale/schemas/debate-output.schema.json`

**Interfaces:**
- Consumes: nothing (static assets read at runtime by `runDebateReview`).
- Produces: the rebuttal system-prompt rubric (CodeWhale `--append-system-prompt`) and the JSON Schema used to document the rebuttal contract.

- [ ] **Step 1: Create the CodeWhale rebuttal rubric**

```markdown
<!-- plugins/codexhale/prompts/rebuttal-codewhale.md -->
You are adjudicating code-review findings produced by another model.

Rules:
- For each finding in the "Opponent findings" block, read the referenced file and
  line range before deciding.
- Default to "agree". Only "refute" when you can cite a concrete reason in the code
  (e.g., the flagged path is unreachable, the input is already validated upstream,
  the API is used correctly).
- Do NOT invent new issues. Do NOT modify any file. You are read-only.
- Output ONLY the JSON object described in the instruction (a `rebuttals` array).
```

- [ ] **Step 2: Create the Codex rebuttal rubric** (same content; documentation parity -- the Codex rebuttal text is injected inline by `buildRebuttalInstruction`, but keep the file so both rubrics live together)

```markdown
<!-- plugins/codexhale/prompts/rebuttal-codex.md -->
You are adjudicating code-review findings produced by another model.

Rules:
- For each finding in the "Opponent findings" block, read the referenced file and
  line range before deciding.
- Default to "agree". Only "refute" with a concrete, code-cited reason.
- Do NOT invent new issues. Do NOT modify any file. You are read-only.
- Output ONLY the JSON object described in the instruction (a `rebuttals` array).
```

- [ ] **Step 3: Create the schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CodexhaleDebateRebuttal",
  "type": "object",
  "required": ["rebuttals"],
  "properties": {
    "rebuttals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["finding_id", "verdict", "reason"],
        "properties": {
          "finding_id": { "type": "string" },
          "verdict": { "type": "string", "enum": ["agree", "refute"] },
          "reason": { "type": "string" },
          "evidence_file": { "type": "string" },
          "evidence_line_range": { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add plugins/codexhale/prompts/rebuttal-codewhale.md plugins/codexhale/prompts/rebuttal-codex.md plugins/codexhale/schemas/debate-output.schema.json
git commit -m "feat(debate): rebuttal rubrics + output schema"
```

---

### Task A5: `runDebateReview` orchestrator + subcommand wiring

**Files:**
- Modify: `plugins/codexhale/scripts/codexhale-companion.mjs` (add import, `case 'debate-review'`, `runDebateReview`)
- Test: `tests/debate-review.test.mjs`

**Interfaces:**
- Consumes: `parseArgs`, `runCodewhale`/`cwReviewArgv`/`parseStreamJson`, `runCodex`/`codexReviewArgv`/`parseReviewOutput`, `mergeFindings`, `buildReviewInstruction`, `readPrompt`, `createJob`/`updateJob`, and Task A1-A3 modules.
- Produces: `runDebateReview(opts, deps?)` returning `{verdict, findings, report}` and writing job logs. `deps` is an optional injection seam `{runCw, runCx}` for tests (defaults to the real spawn runners). Behavior: parallel initial reviews -> degraded check -> merge+addIds -> early-exit if zero critical/high -> rebuttal of single-model critical/high only -> tag -> verdict -> report.

- [ ] **Step 1: Write the failing test (mock the runners via `deps`)**

```javascript
// tests/debate-review.test.mjs
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
    runCw: async (argv) => { if (argv.some(a => /Opponent findings/.test(String(a)))) rebuttalCalls++; return { code: 0, stdout: cwStream({ issues: [{ file: "f", line_range: [1,2], category: "design", severity: "low", description: "x" }] }), stderr: "" }; },
    runCx: async (argv) => { if (String(argv[argv.length-1]).includes("Opponent findings")) rebuttalCalls++; return { code: 0, stdout: cxJsonl({ issues: [] }), stderr: "" }; },
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
    runCx: async (argv) => { if (String(argv[argv.length-1]).includes("Opponent findings")) rebuttalCalls++; return { code: 0, stdout: cxJsonl({ issues: [{ ...bug, line_range: [12, 18] }] }), stderr: "" }; },
    home: tmpHome(),
  };
  const out = await runDebateReview(base, deps);
  assert.equal(out.verdict.clean, false);            // agreed high finding blocks
  assert.equal(rebuttalCalls, 0);                    // agreed findings are not rebutted
  assert.equal(out.findings[0].status, "agreed");
});

test("degraded: codex missing -> single-model uncontested, degraded flag", async () => {
  const deps = {
    runCw: async () => ({ code: 0, stdout: cwStream({ issues: [{ file: "f", line_range: [1,2], category: "bug", severity: "high", description: "x" }] }), stderr: "" }),
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/debate-review.test.mjs`
Expected: FAIL (`runDebateReview` not exported).

- [ ] **Step 3: Implement `runDebateReview` and wire the subcommand**

In `plugins/codexhale/scripts/codexhale-companion.mjs`:

Add imports near the existing ones:
```javascript
import { addIds, tagFindings, computeVerdict } from "./lib/status-tag.mjs";
import { runCodewhaleRebuttal, runCodexRebuttal } from "./lib/debate.mjs";
import { renderDebateReport } from "./lib/debate-report.mjs";
```

Add a case in the `main()` switch (next to `"review"`):
```javascript
    case "debate-review":
      return runDebateReview(opts);
```

Add the exported function (uses a `deps` seam so tests inject runners; defaults to real spawn + real HOME):
```javascript
const BLOCKING = new Set(["critical", "high"]);

export async function runDebateReview(opts, deps = {}) {
  const cwd = process.cwd();
  const home = deps.home ?? HOME;
  const runCw = deps.runCw ?? ((argv) => runCodewhale(argv, { cwd }));
  const runCx = deps.runCx ?? ((argv) => runCodex(argv, { cwd }));
  const rebuttalRubric = readPrompt("rebuttal-codewhale.md");

  const focus = opts.positional.join(" ") || null;
  const reviewInstruction = buildReviewInstruction({ base: opts.base, focus, adversarial: false });
  const rubric = readPrompt("review.md");

  // 1. parallel initial reviews (read-only)
  const [cwR, cxR] = await Promise.allSettled([
    runCw(cwReviewArgv({ rubric, instruction: reviewInstruction, maxTurns: 50 })),
    runCx(codexReviewArgv({ base: opts.base, focus })),
  ]);
  const cwRes = cwR.status === "fulfilled" ? cwR.value : { code: -1, stdout: "", stderr: String(cwR.reason) };
  const cxRes = cxR.status === "fulfilled" ? cxR.value : { code: -1, stdout: "", stderr: String(cxR.reason) };
  const cwOut = cwRes.code === 0 ? parseStreamJson(cwRes.stdout) : null;
  const cxOut = cxRes.code === 0 ? parseReviewOutput(cxRes.stdout) : null;

  // 2. degraded mode: one (or zero) models usable
  const present = [cwOut ? "codewhale" : null, cxOut ? "codex" : null].filter(Boolean);
  if (present.length <= 1) {
    const only = (cwOut ?? cxOut)?.issues ?? [];
    const findings = addIds(only).map(i => ({ ...i, found_by: present, status: "uncontested" }));
    const blocking = findings.filter(i => BLOCKING.has(i.severity)).length;
    const verdict = { clean: blocking === 0, degraded: true, agreedBlocking: blocking,
      reason: present.length === 0 ? "no model produced output" : `degraded single-model review (${present[0] || "none"})` };
    const report = renderDebateReport(findings, verdict);
    finishDebateJob(home, { cwRes, cxRes, report, degraded: true });
    if (opts.subcommand !== "__test") process.stdout.write(report);
    return { verdict, findings, report };
  }

  // 3. merge + ids
  const merged = addIds(mergeFindings(cwOut ?? { issues: [] }, cxOut ?? { issues: [] }).issues);

  // 4. early-exit: no critical/high at all -> clean, skip rebuttal
  const anyBlocking = merged.some(i => BLOCKING.has(i.severity));
  let cwReb = [], cxReb = [];
  if (anyBlocking) {
    // rebuttal only for SINGLE-MODEL critical/high (agreed ones are unfalsifiable here)
    const codexDisputed = merged.filter(i => i.found_by.length === 1 && i.found_by[0] === "codex" && BLOCKING.has(i.severity));
    const cwDisputed = merged.filter(i => i.found_by.length === 1 && i.found_by[0] === "codewhale" && BLOCKING.has(i.severity));
    [cwReb, cxReb] = await Promise.all([
      // CodeWhale adjudicates Codex's single-model findings
      codexDisputed.length ? runCodewhaleRebuttal(rebuttalRubric, codexDisputed, opts.base, { cwd, runner: runCw }) : Promise.resolve([]),
      // Codex adjudicates CodeWhale's single-model findings
      cwDisputed.length ? runCodexRebuttal(cwDisputed, opts.base, { cwd, runner: runCx }) : Promise.resolve([]),
    ]);
  }

  // 5. tag + verdict + report
  const tagged = tagFindings(merged, cwReb, cxReb);
  const verdict = computeVerdict(tagged);
  const report = renderDebateReport(tagged, verdict);
  finishDebateJob(home, { cwRes, cxRes, report, degraded: false });
  if (opts.subcommand !== "__test") process.stdout.write(report);
  return { verdict, findings: tagged, report };
}

function finishDebateJob(home, { cwRes, cxRes, report, degraded }) {
  const job = createJob(home, { kind: "debate-review", repo: repoKey(), cc_task_id: null });
  const dir = path.join(home, ".codexhale-cc", "jobs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${job.id}.codewhale.stdout.log`), cwRes.stdout + "\n---STDERR---\n" + cwRes.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${job.id}.codex.stdout.log`), cxRes.stdout + "\n---STDERR---\n" + cxRes.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${job.id}.debate.md`), report, "utf8");
  updateJob(home, job.id, {
    status: "completed",
    exit_code: 0,
    degraded: !!degraded,
    debate_report_path: `${job.id}.debate.md`,
  });
}
```

Note: update `runCodewhaleRebuttal`/`runCodexRebuttal` in `debate.mjs` (Task A2) to accept an optional `{ runner }` so tests inject `runCw`/`runCx`; default to the real `runCodewhale`/`runCodex`. (Adjust A2 signature: `runCodewhaleRebuttal(rubric, opponentFindings, base, { cwd, runner } = {})` -> use `(runner ?? runCodewhale)`. Same for codex.)

- [ ] **Step 4: Run the full suite**

Run: `node --test tests/*.test.mjs`
Expected: PASS (status-tag 6 + debate 5 + debate-report 2 + debate-review 4 + existing 51 = 68).

- [ ] **Step 5: Smoke-run the subcommand help path**

Run: `node plugins/codexhale/scripts/codexhale-companion.mjs debate-review --help 2>&1 | head -1 || true`
Expected: no crash (it will attempt a review; without `codewhale`/`codex` installed it returns a degraded report). Confirm it prints a `## Verdict` block and exits 0.

- [ ] **Step 6: Commit**

```bash
git add plugins/codexhale/scripts/codexhale-companion.mjs plugins/codexhale/scripts/lib/debate.mjs tests/debate-review.test.mjs
git commit -m "feat(debate): runDebateReview orchestrator + debate-review subcommand"
```

---

## PHASE B -- the namespaced spec fork

### Task B1: copy the 6 skills + provenance

**Files:**
- Create: `plugins/codexhale/skills/{spec,spec-plan,spec-bugfix-plan,spec-implement,spec-verify,spec-bugfix-verify}/` (copied)
- Create: `docs/superpowers/specs/FORK-PROVENANCE.md`

- [ ] **Step 1: Copy the global skills into the plugin**

```bash
cd /Users/weiliu/Dev/codexhale
mkdir -p plugins/codexhale/skills
for s in spec spec-plan spec-bugfix-plan spec-implement spec-verify spec-bugfix-verify; do
  cp -R "$HOME/.claude/skills/$s" "plugins/codexhale/skills/$s"
done
ls plugins/codexhale/skills
```
Expected: the 6 dirs listed.

- [ ] **Step 2: Record provenance**

Create `docs/superpowers/specs/FORK-PROVENANCE.md` with: the date, the source path (`~/.claude/skills`), the 6 forked skill names, the Pilot version if discoverable (`~/.pilot/bin/pilot status --json` or the skills' `manifest.json` version field), and the rule "only delta from upstream = namespaced Skill() calls + the debate-review changes in spec-verify/spec-bugfix-verify."

- [ ] **Step 3: Commit**

```bash
git add plugins/codexhale/skills docs/superpowers/specs/FORK-PROVENANCE.md
git commit -m "chore(fork): vendor spec chain (6 skills) + provenance"
```

---

### Task B2: namespace every inter-chain Skill() call + routing test

**Files:**
- Modify: all files under `plugins/codexhale/skills/**`
- Test: `tests/fork-routing.test.mjs`

- [ ] **Step 1: Write the failing routing test**

```javascript
// tests/fork-routing.test.mjs
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

test("no forked file invokes a bare spec-* skill (must be codexhale:spec-*)", () => {
  const offenders = [];
  for (const f of walk(SKILLS).filter(f => f.endsWith(".md"))) {
    const text = fs.readFileSync(f, "utf8");
    // match Skill(skill='spec-...') or Skill(skill="spec-...") NOT prefixed with codexhale:
    const re = /Skill\(skill=['"](spec-[a-z-]+)['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) offenders.push(`${path.relative(ROOT, f)} -> ${m[1]}`);
  }
  assert.deepEqual(offenders, [], `bare spec-* calls found:\n${offenders.join("\n")}`);
});

test("code-review stays bare (not namespaced)", () => {
  const verify = fs.readFileSync(path.join(SKILLS, "spec-verify/steps/03-collect-results.md"), "utf8");
  assert.match(verify, /Skill\(skill=['"]code-review['"]/);
  assert.ok(!/codexhale:code-review/.test(verify));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/fork-routing.test.mjs`
Expected: FAIL (many bare `spec-*` offenders).

- [ ] **Step 3: Namespace the calls**

Rewrite every literal `Skill(skill='spec-X'` to `Skill(skill='codexhale:spec-X'` across the fork, EXCLUDING `code-review`. Run the mechanical pass, then hand-fix the dispatch TABLE in `spec/steps/02-status-dispatch.md` and `spec/steps/01-parse-route.md` (these reference phase skills in prose/tables, not only literal calls):

```bash
cd /Users/weiliu/Dev/codexhale
# literal Skill(skill='spec-*') -> codexhale: (single and double quotes), excluding code-review
grep -rl "Skill(skill=" plugins/codexhale/skills | while read -r f; do
  perl -0777 -pi -e "s/Skill\\(skill=(['\"])spec-/Skill(skill=\${1}codexhale:spec-/g" "$f"
done
```
Then MANUALLY edit the prose/table references (the dispatcher routes by reading a table, not only via literal `Skill()` calls) in:
- `plugins/codexhale/skills/spec/steps/01-parse-route.md` (1.3 Route to Planning -> `codexhale:spec-plan` / `codexhale:spec-bugfix-plan`)
- `plugins/codexhale/skills/spec/steps/02-status-dispatch.md` (status table -> all phase skills `codexhale:`-prefixed)
- `plugins/codexhale/skills/spec/SKILL.md` (the inlined copies of the same routing text)

Verify only `code-review` remains bare:
```bash
grep -rn "Skill(skill='spec-\|Skill(skill=\"spec-" plugins/codexhale/skills || echo "none-bare"
```
Expected: `none-bare`.

- [ ] **Step 4: Run the routing test to verify it passes**

Run: `node --test tests/fork-routing.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/skills tests/fork-routing.test.mjs
git commit -m "feat(fork): namespace inter-chain Skill() calls to codexhale:"
```

---

### Task B3: `codexhale:spec-verify` -- swap Codex companion for debate-review

**Files:**
- Modify: `plugins/codexhale/skills/spec-verify/steps/01-launch-review.md` (remove codex launch block, insert debate-review launch)
- Modify: `plugins/codexhale/skills/spec-verify/steps/03-collect-results.md` (remove codex collect block, insert debate-review collect feeding the existing fix queue)

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" debate-review --base <BASE>` returning `{verdict, findings, report}` (the subcommand prints the Markdown report; the JSON is in the job's `*.debate.md` + logs).

- [ ] **Step 1: Replace the launch block (01-launch-review.md lines ~20-97)**

Remove the entire `#### Codex Adversarial Review (Optional ...)` CC-ONLY block (sentinel check, `CODEX_COMPANION` detection, prompt-file render, background `node ... task --background`, JOB_ID verify). Insert in its place:

```markdown
#### Codexhale debate review (replaces the single-shot Codex companion)

**If `PILOT_CODEX_CHANGES_REVIEW_ENABLED` is `"true"`:** launch the codexhale debate
review NOW in the background; it runs CodeWhale + Codex (read-only) and a cross-rebuttal,
then prints a consensus report with a verdict. It runs once per verify pass (the existing
outer loop provides multi-round; do NOT loop it here).

```
Bash(
  command="node \"${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs\" debate-review --base ${BASE_REF:-main}",
  run_in_background=true,
  timeout=900000
)
```
Capture nothing special; collect the printed report in Step 3. Do NOT wait -- proceed to Step 2.
```

LEAVE UNTOUCHED: lines 1-19 (stale-findings cleanup + the "inline /code-review is primary" preamble).

- [ ] **Step 2: Replace the collect block (03-collect-results.md lines ~42-100)**

Remove the entire `#### Collect Codex Results (if launched)` sub-section (polling loop, result fetch, rawOutput parse, severity map, re-launch, sentinel touch, cleanup). Insert:

```markdown
#### Collect codexhale debate review (if launched)

When the background debate-review task completes, read its printed Markdown report (the
`## Verdict` line states clean / BLOCKING) and its findings. Feed them into the SAME
severity -> action + lineage-first fix queue used for the inline /code-review findings above:
- `agreed` critical/high -> must_fix (fix now)
- `agreed` medium -> should_fix (fix now)
- `disputed` / `refuted` / `uncontested` -> mention; surface at the Step 10 gate; do not auto-fix
- out-of-lineage findings -> mention-only (the lineage-first rule already in this step)

Do NOT loop debate-review here. If unresolved blocking issues remain, the existing outer
loop (Step 11: Status -> PENDING -> codexhale:spec-implement -> re-verify) re-runs verify
(and thus debate-review) on the post-fix diff, capped at 3 iterations. A `degraded` verdict
(one model unavailable) is surfaced as a warning, not treated as a full debate.
```

LEAVE UNTOUCHED: lines 1-41 (the entire inline `/code-review` block) and 101-115 (re-verification).

- [ ] **Step 3: Verify nothing bare/broken**

Run: `node --test tests/fork-routing.test.mjs`
Expected: PASS (still no bare spec-* calls; code-review still bare).

Run: `grep -n "CODEX_COMPANION\|codex-changes-review-ran\|task --background" plugins/codexhale/skills/spec-verify/steps/0*.md || echo "codex-companion-removed"`
Expected: `codex-companion-removed`.

- [ ] **Step 4: Commit**

```bash
git add plugins/codexhale/skills/spec-verify
git commit -m "feat(fork): spec-verify calls codexhale debate-review (collapsed into existing loop)"
```

---

### Task B4: `codexhale:spec-bugfix-verify` -- add debate-review step (additive)

**Files:**
- Modify: `plugins/codexhale/skills/spec-bugfix-verify/` (add a debate-review step; it has NO codex block to remove)

- [ ] **Step 1: Insert an additive debate step**

In `spec-bugfix-verify`, after the existing quality checks and before the verification
scenario, add a new sub-section (gated by `PILOT_CODEX_CHANGES_REVIEW_ENABLED`) that runs
`node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" debate-review --base ${BASE_REF:-main}`
and feeds findings into the bugfix-verify fix flow with the same severity -> action mapping
as Task B3. Reference the same "do not loop; the outer loop re-runs" note. (Locate the exact
step file during implementation, e.g. between the quality-checks step and
`03-verification-scenario.md`.)

- [ ] **Step 2: Verify routing still clean**

Run: `node --test tests/fork-routing.test.mjs`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plugins/codexhale/skills/spec-bugfix-verify
git commit -m "feat(fork): spec-bugfix-verify gains debate-review step (additive)"
```

---

## PHASE C -- hygiene + E2E

### Task C1: fork-drift checker + full regression + E2E note

**Files:**
- Create: `plugins/codexhale/scripts/check-fork-drift.sh`

- [ ] **Step 1: Write the drift checker**

```bash
#!/usr/bin/env bash
# Reports divergence between the vendored fork and the current global Pilot skills,
# ignoring the intended delta (namespaced Skill() calls). Exit 0 = only-intended-delta.
set -euo pipefail
GLOBAL="$HOME/.claude/skills"
FORK="$(cd "$(dirname "$0")/../skills" && pwd)"
status=0
for s in spec spec-plan spec-bugfix-plan spec-implement spec-verify spec-bugfix-verify; do
  for f in $(cd "$FORK/$s" && find . -type f -name '*.md'); do
    g="$GLOBAL/$s/$f"; k="$FORK/$s/$f"
    [ -f "$g" ] || { echo "NEW-IN-FORK: $s/$f"; continue; }
    # normalize the intended delta (codexhale: prefix) before diffing
    if ! diff -q <(sed "s/codexhale:spec-/spec-/g" "$k") "$g" >/dev/null 2>&1; then
      echo "DRIFT: $s/$f (beyond namespacing/debate edits)"; status=1
    fi
  done
done
[ "$status" = 0 ] && echo "fork in sync (only intended delta)"
exit $status
```
(Note: `spec-verify`/`spec-bugfix-verify` will report DRIFT by design -- they carry the debate edits. That is expected; the checker is for the 4 namespace-only forks.)

- [ ] **Step 2: Make it executable and run it**

Run: `chmod +x plugins/codexhale/scripts/check-fork-drift.sh && plugins/codexhale/scripts/check-fork-drift.sh || true`
Expected: the 4 namespace-only skills report in-sync; spec-verify/spec-bugfix-verify report DRIFT (expected, documented).

- [ ] **Step 3: Full regression**

Run: `node --test tests/*.test.mjs`
Expected: PASS (all engine + routing tests + existing 51).

- [ ] **Step 4: E2E (requires `codewhale` + `codex` installed)**

If both CLIs are present (`node plugins/codexhale/scripts/codexhale-companion.mjs setup`):
run `/codexhale:spec` on a tiny intentional change in this repo and confirm (a) the chain
reaches `codexhale:spec-verify`, (b) debate-review runs and prints a `## Verdict`, (c) an
agreed finding drives a fix via the existing loop, (d) a clean re-verify completes.
If the CLIs are NOT installed, record the gap: engine is unit-verified (mocked runners);
live E2E pending CLI availability.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/check-fork-drift.sh
git commit -m "chore(fork): fork-drift checker + full regression green"
```

---

## Self-Review (plan vs spec)

- **Spec coverage:** debate engine (A1-A5) covers design Section 4 (round flow, reuse,
  read-only flags, stable ids, degraded, early-exit, rebuttal soundness). Fork (B1-B4)
  covers Section 5 (all-6 fork, namespacing rule, spec-verify swap, bugfix additive).
  Hygiene/E2E (C1) covers Section 5.6 + Section 8.
- **Soundness rules honored:** agreed findings never rebutted (A5 test 2); rebuttal only for
  single-model critical/high (A5 impl); cap = existing outer loop (B3 text, no inner loop).
- **Type consistency:** `addIds`/`tagFindings`/`computeVerdict` (A1) used verbatim in A5;
  `runCodewhaleRebuttal`/`runCodexRebuttal` (A2) called in A5 with the `{runner}` seam noted;
  `renderDebateReport(issues, verdict)` (A3) called in A5.
- **No-merge-shape-change:** ids added via `addIds` wrapper, not inside `mergeFindings`
  (Global Constraints + A1).
