# codexhale Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Claude Code plugin (`codexhale`) that runs dual-model (CodeWhale + Codex) code reviews, delegates implementation tasks to CodeWhale, and optionally gates Claude's turn completion behind a CodeWhale review.

**Architecture:** A Claude Code plugin (slash commands + one subagent + one Stop hook) backed by a single Node.js dispatcher script (`codexhale-companion.mjs`). Review commands spawn `codewhale exec` and `codex exec review` in parallel and merge findings; rescue delegates to `codewhale exec --yolo`; the Stop hook runs a read-only `codewhale exec` review. State lives in `~/.codexhale-cc/`. No long-lived daemon.

**Tech Stack:** Node.js 18.18+ (ESM, `.mjs`), `node:test` for unit tests. External CLIs: `codewhale` (v0.8.61+) and `codex`. Claude Code plugin conventions (commands/agents/hooks/prompts/schemas directories).

**Spec:** `docs/superpowers/specs/2026-06-21-codexhale-plugin-design.md`

---

## Verified external CLI surfaces (do not re-derive)

CodeWhale `exec` (confirmed from CodeWhale v0.8.61 docs):
```
codewhale exec --auto --output-format stream-json \
  --allowed-tools <csv> --disallowed-tools <csv>   # deny wins \
  --max-turns <n> --append-system-prompt "<text>" \
  [--yolo] [--model <m>] [--continue | --resume <id>] \
  "<prompt>"
```
- `--disallowed-tools write_file,edit_file,apply_patch` enforces read-only at harness level.
- `--auto` = tool-backed + auto-approve. `--yolo` = write + shell + auto-approve + trust.
- stream-json emits one JSON object per line.

Codex `exec` (confirmed from `openai/codex` `codex-rs/exec/src/cli.rs`):
```
codex exec review --json --sandbox read-only \
  [--base <branch> | --uncommitted | --commit <sha>] \
  "<focus-or-instructions>"
codex exec --json --sandbox <read-only|workspace-write> --model <m> \
  --output-last-message <file> "<prompt>"
codex exec resume --last "<prompt>"     # continue most recent session
```
- `--json`, `--sandbox`, `--model` are `global = true` → apply to the `review` subcommand.
- `--output-last-message <FILE>` (`-o`) writes the agent's final message to a file — no stream parsing needed for rescue.
- `review`'s positional `PROMPT` = custom review instructions = our focus text.

---

## File Structure

```
plugins/codexhale/
  commands/
    review.md                 # /codexhale:review — dual-model review
    adversarial-review.md     # /codexhale:adversarial-review — dual-model adversarial
    rescue.md                 # /codexhale:rescue — delegate to CodeWhale
    status.md                 # /codexhale:status — list jobs
    result.md                 # /codexhale:result — show job output
    cancel.md                 # /codexhale:cancel — stop running job
    setup.md                  # /codexhale:setup — readiness + gate toggle
  agents/
    codexhale-rescue.md       # thin forwarding subagent (model: sonnet, tools: Bash)
  hooks/
    hooks.json                # Stop hook + SessionStart/End
  prompts/
    review.md                 # stable cache-prefix rubric (review)
    adversarial-review.md     # stable cache-prefix rubric (adversarial)
    stop-review-gate.md       # stable cache-prefix rubric (gate)
  schemas/
    review-output.schema.json # JSON schema both CLIs' final messages conform to
  scripts/
    codexhale-companion.mjs   # dispatcher: all subcommands live here
    stop-review-gate-hook.mjs # Stop hook entrypoint
    lib/
      args.mjs                # argv parsing helpers
      jobs.mjs                # job manifest read/write
      codewhale.mjs           # spawn codewhale exec, parse stream-json
      codex.mjs               # spawn codex exec review, parse jsonl
      merge.mjs               # dedupe/merge findings from two models
      config.mjs              # ~/.codexhale-cc/config.json read/write
      review-prompt.mjs       # build instruction text (base/scope/focus)
tests/
  args.test.mjs
  jobs.test.mjs
  merge.test.mjs
  config.test.mjs
  review-prompt.test.mjs
  codewhale.test.mjs          # stream-json parsing (fixture lines)
  codex.test.mjs              # jsonl parsing (fixture lines)
  setup.test.mjs              # doctor/version parsing (mocked)
package.json                  # type: module, test script
```

Each `lib/*.mjs` has one responsibility and is independently testable. The companion script is thin glue over these libs.

---

## Task 1: Project scaffold + package.json + test runner

**Files:**
- Create: `package.json`
- Create: `tests/.gitkeep`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@codexhale/cc-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Claude Code plugin: dual-model (CodeWhale + Codex) review and CodeWhale task delegation.",
  "license": "MIT",
  "engines": { "node": ">=18.18.0" },
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

- [ ] **Step 2: Verify test runner works with a placeholder test**

Create `tests/sanity.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";

test("sanity", () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 1 passing.

- [ ] **Step 4: Remove placeholder, commit**

Delete `tests/sanity.test.mjs`. Run:
```bash
git add package.json tests/.gitkeep
git commit -m "chore: scaffold codexhale plugin package"
```

---

## Task 2: args.mjs — argv parsing

Parses the companion script's argv into a structured options object shared across subcommands.

**Files:**
- Create: `plugins/codexhale/scripts/lib/args.mjs`
- Test: `tests/args.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/args.test.mjs`:
```js
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

test("rescue resume bare becomes --continue", () => {
  const out = parseArgs(["rescue", "--resume", "apply top fix"]);
  assert.equal(out.resume, "continue");
  assert.equal(out.positional.join(" "), "apply top fix");
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../args.mjs`.

- [ ] **Step 3: Implement args.mjs**

`plugins/codexhale/scripts/lib/args.mjs`:
```js
// Minimal argv parser for codexhale-companion. Value flags consume the next token;
// boolean flags set a bool. Unknown flags are ignored. Positionals accumulate.
const VALUE_FLAGS = new Set(["--base", "--scope", "--model", "--resume"]);
const BOOL_FLAGS = new Set(["--wait", "--background", "--fresh"]);

const DEFAULTS = {
  subcommand: null,
  wait: false,
  background: false,
  base: null,
  scope: null,
  model: null,
  resume: null,
  fresh: false,
  positional: [],
  reviewGate: null,
};

export function parseArgs(argv) {
  const out = { ...DEFAULTS, positional: [] };
  if (argv.length === 0) return out;
  out.subcommand = argv[0];
  const rest = argv.slice(1);

  let i = 0;
  while (i < rest.length) {
    const tok = rest[i];
    if (tok === "--enable-review-gate") { out.reviewGate = "enable"; i += 1; continue; }
    if (tok === "--disable-review-gate") { out.reviewGate = "disable"; i += 1; continue; }
    if (VALUE_FLAGS.has(tok)) {
      out[flagKey(tok)] = rest[i + 1];
      i += 2;
      continue;
    }
    if (BOOL_FLAGS.has(tok)) {
      out[flagKey(tok)] = true;
      i += 1;
      continue;
    }
    if (tok.startsWith("--")) { i += 1; continue; } // ignore unknown flags
    out.positional.push(tok);
    i += 1;
  }

  if (out.subcommand === "rescue") {
    normalizeRescue(out);
  }
  return out;
}

function flagKey(flag) {
  return flag.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function normalizeRescue(out) {
  // --model fin alias
  if (out.model === "fin") out.model = "deepseek-v4-flash";
  // --resume: bare (no id) means continue most-recent; id stays as-is
  if (out.resume !== null && out.resume === "") out.resume = "continue";
  // heuristic: if --resume was given without a value, clap-style would error;
  // but our parser consumed next token as its value. A bare --resume is represented
  // by the caller passing "--resume" with nothing after; we treat the consumed
  // value: if it looks like a task word rather than a session id, treat as continue.
  // Simpler contract: --resume with NO following value => continue.
  // (Handled in parser by checking in step 3b below — see note.)
}
```

Wait — the `--resume` bare case: with VALUE_FLAGS consuming the next token, `["--resume", "apply", "top", "fix"]` would set `resume="apply"` and leave `["top","fix"]` as positional. The test expects `resume="continue"` and positional `"apply top fix"`. Fix the parser to detect resume specifically.

Replace the `normalizeRescue` and parsing logic. Final `args.mjs`:
```js
const BOOL_FLAGS = new Set(["--wait", "--background", "--fresh"]);
const DEFAULTS = {
  subcommand: null, wait: false, background: false, base: null, scope: null,
  model: null, resume: null, fresh: false, positional: [], reviewGate: null,
};

export function parseArgs(argv) {
  const out = { ...DEFAULTS, positional: [] };
  if (argv.length === 0) return out;
  out.subcommand = argv[0];
  const rest = argv.slice(1);

  let i = 0;
  while (i < rest.length) {
    const tok = rest[i];
    if (tok === "--enable-review-gate") { out.reviewGate = "enable"; i += 1; continue; }
    if (tok === "--disable-review-gate") { out.reviewGate = "disable"; i += 1; continue; }
    if (tok === "--base") { out.base = rest[i + 1]; i += 2; continue; }
    if (tok === "--scope") { out.scope = rest[i + 1]; i += 2; continue; }
    if (tok === "--model") { out.model = rest[i + 1]; i += 2; continue; }
    if (tok === "--resume") {
      const next = rest[i + 1];
      // bare --resume (no following token, or next is a flag) => continue most-recent
      if (next === undefined || String(next).startsWith("--")) {
        out.resume = "continue";
        i += 1;
      } else {
        out.resume = next;
        i += 2;
      }
      continue;
    }
    if (BOOL_FLAGS.has(tok)) { out[flagKey(tok)] = true; i += 1; continue; }
    if (tok.startsWith("--")) { i += 1; continue; }
    out.positional.push(tok);
    i += 1;
  }

  if (out.subcommand === "rescue" && out.model === "fin") {
    out.model = "deepseek-v4-flash";
  }
  return out;
}

function flagKey(flag) {
  return flag.replace(/^--/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/args.mjs tests/args.test.mjs
git commit -m "feat(args): add argv parser for companion subcommands"
```

---

## Task 3: config.mjs — plugin config read/write

**Files:**
- Create: `plugins/codexhale/scripts/lib/config.mjs`
- Test: `tests/config.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/config.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig, writeConfig } from "../plugins/codexhale/scripts/lib/config.mjs";

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cwhome-"));
  return dir;
}

test("readConfig returns defaults when no file", () => {
  const home = tmpHome();
  const cfg = readConfig(home);
  assert.deepEqual(cfg, { review_gate_enabled: false });
});

test("writeConfig then readConfig round-trips", () => {
  const home = tmpHome();
  writeConfig(home, { review_gate_enabled: true });
  const cfg = readConfig(home);
  assert.equal(cfg.review_gate_enabled, true);
});

test("writeConfig preserves unknown keys", () => {
  const home = tmpHome();
  writeConfig(home, { review_gate_enabled: false, custom: "x" });
  assert.equal(readConfig(home).custom, "x");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement config.mjs**

`plugins/codexhale/scripts/lib/config.mjs`:
```js
import fs from "node:fs";
import path from "node:path";

const DEFAULTS = { review_gate_enabled: false };

export function configPath(home) {
  return path.join(home, ".codexhale-cc", "config.json");
}

export function readConfig(home) {
  const p = configPath(home);
  if (!fs.existsSync(p)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeConfig(home, cfg) {
  const p = configPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const existing = readConfig(home);
  const merged = { ...existing, ...cfg };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return merged;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: 3 passing (plus args tests still passing).

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/config.mjs tests/config.test.mjs
git commit -m "feat(config): plugin config read/write with defaults"
```

---

## Task 4: jobs.mjs — job manifest read/write

**Files:**
- Create: `plugins/codexhale/scripts/lib/jobs.mjs`
- Test: `tests/jobs.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/jobs.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { createJob, updateJob, readJob, listJobsForRepo } from "../plugins/codexhale/scripts/lib/jobs.mjs";

function tmpHome() { return require("node:fs").mkdtempSync(require("node:path").join(os.tmpdir(), "cw-")); }

test("createJob writes manifest with running status and id", () => {
  const home = tmpHome();
  const job = createJob(home, { kind: "review", repo: "r1", cc_task_id: "t1" });
  assert.match(job.id, /^job_/);
  assert.equal(job.status, "running");
  assert.equal(job.kind, "review");
  assert.ok(job.started_at);
  const back = readJob(home, job.id);
  assert.equal(back.id, job.id);
});

test("updateJob merges fields and sets ended_at on terminal status", () => {
  const home = tmpHome();
  const job = createJob(home, { kind: "rescue", repo: "r1", cc_task_id: "t1" });
  updateJob(home, job.id, { status: "completed", exit_code: 0, sub_jobs: [{ model: "codewhale", status: "completed" }] });
  const back = readJob(home, job.id);
  assert.equal(back.status, "completed");
  assert.equal(back.exit_code, 0);
  assert.ok(back.ended_at);
  assert.equal(back.sub_jobs[0].model, "codewhale");
});

test("listJobsForRepo filters by repo and sorts newest first", () => {
  const home = tmpHome();
  const a = createJob(home, { kind: "review", repo: "r1", cc_task_id: "t" });
  const b = createJob(home, { kind: "review", repo: "r2", cc_task_id: "t" });
  const c = createJob(home, { kind: "review", repo: "r1", cc_task_id: "t" });
  const r1 = listJobsForRepo(home, "r1");
  assert.equal(r1.length, 2);
  assert.deepEqual(r1.map(j => j.id), [c.id, a.id]); // newest first
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement jobs.mjs**

`plugins/codexhale/scripts/lib/jobs.mjs`:
```js
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function jobsDir(home) {
  return path.join(home, ".codexhale-cc", "jobs");
}

export function jobPath(home, id) {
  return path.join(jobsDir(home), `${id}.json`);
}

let _seq = 0;
function genId() {
  _seq += 1;
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
}

export function createJob(home, { kind, repo, cc_task_id }) {
  const id = genId();
  const job = {
    id, kind, repo, cc_task_id: cc_task_id ?? null,
    status: "running",
    started_at: new Date().toISOString(),
    ended_at: null,
    exit_code: null,
    sub_jobs: [],
  };
  fs.mkdirSync(jobsDir(home), { recursive: true });
  fs.writeFileSync(jobPath(home, id), JSON.stringify(job, null, 2) + "\n", "utf8");
  return job;
}

export function readJob(home, id) {
  const p = jobPath(home, id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const TERMINAL = new Set(["completed", "failed", "canceled"]);

export function updateJob(home, id, patch) {
  const job = readJob(home, id);
  if (!job) throw new Error(`job not found: ${id}`);
  const next = { ...job, ...patch };
  if (TERMINAL.has(next.status) && !next.ended_at) {
    next.ended_at = new Date().toISOString();
  }
  fs.writeFileSync(jobPath(home, id), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function listJobsForRepo(home, repo) {
  const dir = jobsDir(home);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter(j => j.repo === repo)
    .sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/jobs.mjs tests/jobs.test.mjs
git commit -m "feat(jobs): job manifest create/read/update/list"
```

---

## Task 5: review-prompt.mjs — build review instruction text

Builds the dynamic instruction (the non-cached tail) given base/scope/focus. The rubric (cached prefix) is read from `prompts/*.md` separately.

**Files:**
- Create: `plugins/codexhale/scripts/lib/review-prompt.mjs`
- Test: `tests/review-prompt.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/review-prompt.test.mjs`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement review-prompt.mjs**

`plugins/codexhale/scripts/lib/review-prompt.mjs`:
```js
export function buildReviewInstruction({ base, focus, adversarial }) {
  const target = base
    ? `Review the changes on the current branch compared to base \`${base}\`. Run \`git diff ${base}...HEAD\` and \`git log --oneline ${base}..HEAD\` to see them.`
    : `Review the current uncommitted changes. Run \`git status --short --untracked-files=all\`, \`git diff --cached\`, and \`git diff\` to see them. Treat untracked files as in scope.`;

  const framing = adversarial
    ? `Challenge the chosen implementation and design. Pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would be safer or simpler. Do not just describe the code — question it.`
    : `Review for correctness, bugs, security, and maintainability. Report concrete issues with file and line references.`;

  const focusLine = focus ? `\n\nFocus: ${focus}` : "";

  return `${framing}\n\n${target}\n\nRead referenced files with read_file to verify your claims. Report findings as a JSON object matching the review-output schema (issues array with file, line_range, category, severity, description).${focusLine}`;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/review-prompt.mjs tests/review-prompt.test.mjs
git commit -m "feat(review-prompt): build review instruction text"
```

---

## Task 6: schemas/review-output.schema.json + prompts rubrics

The shared schema both CLIs are asked to conform to (via instruction text). Prompts are the stable cache prefix.

**Files:**
- Create: `plugins/codexhale/schemas/review-output.schema.json`
- Create: `plugins/codexhale/prompts/review.md`
- Create: `plugins/codexhale/prompts/adversarial-review.md`
- Create: `plugins/codexhale/prompts/stop-review-gate.md`

- [ ] **Step 1: Create the schema**

`plugins/codexhale/schemas/review-output.schema.json`:
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "CodexhaleReviewOutput",
  "type": "object",
  "required": ["issues"],
  "properties": {
    "summary": { "type": "string" },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["file", "category", "severity", "description"],
        "properties": {
          "file": { "type": "string" },
          "line_range": { "type": "array", "items": { "type": "integer" }, "minItems": 2, "maxItems": 2 },
          "category": { "type": "string", "enum": ["bug", "security", "performance", "design", "correctness", "maintainability", "other"] },
          "severity": { "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
          "description": { "type": "string" }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create prompts/review.md (stable cache prefix)**

`plugins/codexhale/prompts/review.md`:
```markdown
You are a rigorous code reviewer. You review changes in the current git repository.

Rules:
- Base every finding on evidence you gathered by reading the actual code. Never speculate.
- Report findings as a single JSON object matching the review-output schema: an `issues` array where each issue has `file`, `line_range` (two integers `[start, end]`), `category`, `severity`, and `description`.
- If you find no issues, return `{ "summary": "...", "issues": [] }`.
- Do not modify any files. This is a read-only review.
- Categories: bug, security, performance, design, correctness, maintainability, other.
- Severities: critical, high, medium, low, info.
- Output ONLY the JSON object as your final message, no prose before or after.
```

- [ ] **Step 3: Create prompts/adversarial-review.md**

`plugins/codexhale/prompts/adversarial-review.md`:
```markdown
You are an adversarial code reviewer. Your job is to question the chosen implementation and design, not just describe it.

Rules:
- Pressure-test assumptions, tradeoffs, hidden failure modes, and whether a different approach would be safer or simpler.
- Report findings as a single JSON object matching the review-output schema: an `issues` array where each issue has `file`, `line_range` (two integers `[start, end]`), `category`, `severity`, and `description`. Use the `design` and `correctness` categories liberally.
- If you find nothing worth challenging, return `{ "summary": "...", "issues": [] }`.
- Do not modify any files. This is a read-only review.
- Output ONLY the JSON object as your final message, no prose before or after.
```

- [ ] **Step 4: Create prompts/stop-review-gate.md**

`plugins/codexhale/prompts/stop-review-gate.md`:
```markdown
You are a focused code reviewer checking a single turn of changes that Claude just made.

Rules:
- You are given the list of files Claude changed and a short summary of its claim.
- Verify the claim against the actual code. Report only real problems that should block completion.
- Report findings as a single JSON object matching the review-output schema: an `issues` array.
- If the changes are sound, return `{ "summary": "no blocking issues", "issues": [] }`.
- Do not modify any files. Read-only.
- Output ONLY the JSON object as your final message.
```

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/schemas plugins/codexhale/prompts
git commit -m "feat(prompts): review rubrics + shared output schema"
```

---

## Task 7: merge.mjs — dedupe/merge findings from two models

**Files:**
- Create: `plugins/codexhale/scripts/lib/merge.mjs`
- Test: `tests/merge.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/merge.test.mjs`:
```js
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
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement merge.mjs**

`plugins/codexhale/scripts/lib/merge.mjs`:
```js
// Merge two review outputs (each { summary?, issues[] }) into one.
// Dedupe by (file, category, overlapping line_range). Deterministic, no LLM.

function rangesOverlap(a, b) {
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  return a[0] <= b[1] && b[0] <= a[1];
}

function sameKey(x, y) {
  return x.file === y.file && x.category === y.category && rangesOverlap(x.line_range, y.line_range);
}

export function mergeFindings(codewhaleOut, codexOut) {
  const cwIssues = (codewhaleOut?.issues ?? []).map(i => ({ ...i, found_by: ["codewhale"] }));
  const codexIssues = (codexOut?.issues ?? []).map(i => ({ ...i, found_by: ["codex"] }));

  const merged = [];
  const used = new Set();

  for (const cw of cwIssues) {
    const matchIdx = codexIssues.findIndex((c, idx) => !used.has(idx) && sameKey(cw, c));
    if (matchIdx >= 0) {
      used.add(matchIdx);
      const cx = codexIssues[matchIdx];
      merged.push({
        ...cw,
        found_by: ["codewhale", "codex"],
        descriptions: [cw.description, cx.description],
        description: cw.description,
      });
    } else {
      merged.push(cw);
    }
  }
  for (let i = 0; i < codexIssues.length; i++) {
    if (!used.has(i)) merged.push(codexIssues[i]);
  }

  // Mark disputed: a file+category appearing in one model's issues where the other model
  // reviewed the same file but did NOT report that category => disputed.
  const cwFiles = new Set(cwIssues.map(i => i.file));
  const codexFiles = new Set(codexIssues.map(i => i.file));
  for (const issue of merged) {
    const otherReviewedFile =
      (issue.found_by.includes("codewhale") && codexFiles.has(issue.file)) ||
      (issue.found_by.includes("codex") && cwFiles.has(issue.file));
    if (issue.found_by.length === 1 && otherReviewedFile) {
      issue.disputed = true;
    }
  }

  const summary = [codewhaleOut?.summary, codexOut?.summary].filter(Boolean).join(" | ");
  return { summary: summary || "", issues: merged };
}

export function renderMergedReport(merged) {
  const byFile = new Map();
  for (const i of merged.issues) {
    if (!byFile.has(i.file)) byFile.set(i.file, []);
    byFile.get(i.file).push(i);
  }
  const lines = [];
  lines.push(`# Codexhale review`);
  if (merged.summary) lines.push(`\n${merged.summary}`);
  lines.push(`\n${merged.issues.length} issue(s) from codewhale + codex.\n`);
  for (const [file, issues] of byFile) {
    lines.push(`## ${file}`);
    for (const i of issues) {
      const tag = i.found_by.length === 2
        ? "[cw+codex]"
        : (i.disputed ? "[disputed]" : (i.found_by[0] === "codewhale" ? "[cw]" : "[codex]"));
      const loc = i.line_range ? `:${i.line_range[0]}-${i.line_range[1]}` : "";
      lines.push(`- ${tag} ${i.severity} ${i.category}${loc} — ${i.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/merge.mjs tests/merge.test.mjs
git commit -m "feat(merge): deterministic dual-model finding merge + report renderer"
```

---

## Task 8: codewhale.mjs — spawn codewhale exec, parse stream-json

**Files:**
- Create: `plugins/codexhale/scripts/lib/codewhale.mjs`
- Test: `tests/codewhale.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/codewhale.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStreamJson, buildReviewArgv, buildRescueArgv } from "../plugins/codexhale/scripts/lib/codewhale.mjs";

test("parseStreamJson extracts final message JSON from stream lines", () => {
  const lines = [
    JSON.stringify({ type: "tool_use", name: "read_file" }),
    JSON.stringify({ type: "agent_message", delta: "partial" }),
    JSON.stringify({ type: "turn_completed", final_message: '{\n  "issues": []\n}' }),
  ];
  const out = parseStreamJson(lines.join("\n"));
  assert.deepEqual(out, { issues: [] });
});

test("parseStreamJson returns null when no final message", () => {
  const lines = [JSON.stringify({ type: "tool_use" })];
  assert.equal(parseStreamJson(lines.join("\n")), null);
});

test("buildReviewArgv includes read-only disallowed-tools and stable system prompt", () => {
  const argv = buildReviewArgv({
    rubric: "RUBRIC_TEXT",
    instruction: "DO_REVIEW",
    maxTurns: 50,
  });
  assert.ok(argv.includes("--auto"));
  assert.ok(argv.includes("--output-format"));
  assert.ok(argv.includes("stream-json"));
  assert.ok(argv.includes("--disallowed-tools"));
  assert.ok(argv.includes("write_file,edit_file,apply_patch"));
  assert.ok(argv.includes("--allowed-tools"));
  assert.ok(argv.includes("read_file,exec_shell"));
  assert.ok(argv.includes("--max-turns"));
  assert.ok(argv.includes("50"));
  assert.ok(argv.includes("--append-system-prompt"));
  assert.ok(argv.includes("RUBRIC_TEXT"));
  assert.ok(argv[argv.length - 1] === "DO_REVIEW");
});

test("buildReviewArgv stable: identical inputs produce byte-identical argv", () => {
  const a = buildReviewArgv({ rubric: "R", instruction: "I", maxTurns: 50 });
  const b = buildReviewArgv({ rubric: "R", instruction: "I", maxTurns: 50 });
  assert.deepEqual(a, b);
});

test("buildRescueArgv uses yolo and no max-turns, applies model + continue", () => {
  const argv = buildRescueArgv({ task: "fix it", model: "deepseek-v4-flash", resume: "continue" });
  assert.ok(argv.includes("--yolo"));
  assert.ok(!argv.includes("--max-turns"));
  assert.ok(argv.includes("--model"));
  assert.ok(argv.includes("deepseek-v4-flash"));
  assert.ok(argv.includes("--continue"));
  assert.ok(argv[argv.length - 1] === "fix it");
});

test("buildRescueArgv resume id uses --resume", () => {
  const argv = buildRescueArgv({ task: "fix it", model: null, resume: "sess_abc" });
  assert.ok(argv.includes("--resume"));
  assert.ok(argv.includes("sess_abc"));
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement codewhale.mjs**

`plugins/codexhale/scripts/lib/codewhale.mjs`:
```js
import { spawn } from "node:child_process";

export function buildReviewArgv({ rubric, instruction, maxTurns }) {
  return [
    "exec", "--auto", "--output-format", "stream-json",
    "--allowed-tools", "read_file,exec_shell",
    "--disallowed-tools", "write_file,edit_file,apply_patch",
    "--max-turns", String(maxTurns),
    "--append-system-prompt", rubric,
    instruction,
  ];
}

export function buildRescueArgv({ task, model, resume }) {
  const argv = ["exec", "--yolo", "--output-format", "stream-json"];
  if (model) argv.push("--model", model);
  if (resume === "continue") argv.push("--continue");
  else if (resume) argv.push("--resume", resume);
  argv.push(task);
  return argv;
}

// Parse newline-delimited stream-json. Look for the final agent message,
// attempt to JSON.parse it as the review-output schema.
export function parseStreamJson(stdout) {
  const lines = stdout.split("\n");
  let finalMessage = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (obj.type === "turn_completed" && typeof obj.final_message === "string") {
      finalMessage = obj.final_message;
    } else if (obj.type === "agent_message" && typeof obj.message === "string") {
      finalMessage = obj.message; // last agent_message wins as fallback
    }
  }
  if (!finalMessage) return null;
  // Extract first JSON object from the message (it may have surrounding text)
  const match = finalMessage.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function runCodewhale(argv, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("codewhale", argv, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/codewhale.mjs tests/codewhale.test.mjs
git commit -m "feat(codewhale): argv builders + stream-json parser"
```

---

## Task 9: codex.mjs — spawn codex exec review, parse jsonl

**Files:**
- Create: `plugins/codexhale/scripts/lib/codex.mjs`
- Test: `tests/codex.test.mjs`

- [ ] **Step 1: Write failing tests**

`tests/codex.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReviewArgv, parseReviewOutput } from "../plugins/codexhale/scripts/lib/codex.mjs";

test("buildReviewArgv uses exec review subcommand with json + read-only sandbox", () => {
  const argv = buildReviewArgv({ base: "main", focus: "look for races" });
  assert.equal(argv[0], "exec");
  assert.equal(argv[1], "review");
  assert.ok(argv.includes("--json"));
  assert.ok(argv.includes("--sandbox"));
  assert.ok(argv.includes("read-only"));
  assert.ok(argv.includes("--base"));
  assert.ok(argv.includes("main"));
  assert.ok(argv[argv.length - 1] === "look for races");
});

test("buildReviewArgv uncommitted when no base", () => {
  const argv = buildReviewArgv({ base: null, focus: null });
  assert.ok(argv.includes("--uncommitted"));
});

test("buildReviewArgv stable: identical inputs byte-identical", () => {
  const a = buildReviewArgv({ base: "main", focus: "x" });
  const b = buildReviewArgv({ base: "main", focus: "x" });
  assert.deepEqual(a, b);
});

test("parseReviewOutput extracts JSON from last-message jsonl event", () => {
  const lines = [
    JSON.stringify({ type: "message", content: "thinking..." }),
    JSON.stringify({ type: "completed", last_message: '{\n  "issues": []\n}' }),
  ];
  const out = parseReviewOutput(lines.join("\n"));
  assert.deepEqual(out, { issues: [] });
});

test("parseReviewOutput returns null on no parseable message", () => {
  assert.equal(parseReviewOutput("not json at all"), null);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement codex.mjs**

`plugins/codexhale/scripts/lib/codex.mjs`:
```js
import { spawn } from "node:child_process";

// codex exec review --json --sandbox read-only [--base <b> | --uncommitted] <focus>
export function buildReviewArgv({ base, focus }) {
  const argv = ["exec", "review", "--json", "--sandbox", "read-only"];
  if (base) argv.push("--base", base);
  else argv.push("--uncommitted");
  if (focus) argv.push(focus);
  return argv;
}

// Parse JSONL. Codex --json emits events; the final review message is carried in
// a `last_message` field on the terminal event. Extract the first JSON object.
export function parseReviewOutput(stdout) {
  const lines = stdout.split("\n");
  let lastMessage = null;
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    let obj;
    try { obj = JSON.parse(t); } catch { continue; }
    if (typeof obj.last_message === "string") lastMessage = obj.last_message;
    else if (typeof obj.message === "string") lastMessage = obj.message;
  }
  if (!lastMessage) return null;
  const match = lastMessage.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function runCodex(argv, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", argv, { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/codex.mjs tests/codex.test.mjs
git commit -m "feat(codex): codex exec review argv + jsonl parser"
```

---

## Task 10: codexhale-companion.mjs — dispatcher (review + rescue + status/result/cancel + setup)

This is the glue. Each subcommand orchestrates the libs.

**Files:**
- Create: `plugins/codexhale/scripts/codexhale-companion.mjs`

- [ ] **Step 1: Implement the dispatcher**

`plugins/codexhale/scripts/codexhale-companion.mjs`:
```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { parseArgs } from "./lib/args.mjs";
import { readConfig, writeConfig } from "./lib/config.mjs";
import { createJob, updateJob, readJob, listJobsForRepo } from "./lib/jobs.mjs";
import { buildReviewInstruction } from "./lib/review-prompt.mjs";
import { buildReviewArgv as cwReviewArgv, buildRescueArgv, runCodewhale, parseStreamJson } from "./lib/codewhale.mjs";
import { buildReviewArgv as codexReviewArgv, runCodex, parseReviewOutput } from "./lib/codex.mjs";
import { mergeFindings, renderMergedReport } from "./lib/merge.mjs";

const HOME = os.homedir();
const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");

function readPrompt(name) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "prompts", name), "utf8");
}

function repoKey() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  switch (opts.subcommand) {
    case "review":
    case "adversarial-review":
      return runReview(opts);
    case "rescue":
      return runRescue(opts);
    case "status":
      return runStatus(opts);
    case "result":
      return runResult(opts);
    case "cancel":
      return runCancel(opts);
    case "setup":
      return runSetup(opts);
    default:
      process.stderr.write(`unknown subcommand: ${opts.subcommand}\n`);
      process.exit(2);
  }
}

async function runReview(opts) {
  const adversarial = opts.subcommand === "adversarial-review";
  const rubricFile = adversarial ? "adversarial-review.md" : "review.md";
  const rubric = readPrompt(rubricFile);
  const instruction = buildReviewInstruction({ base: opts.base, focus: opts.positional.join(" "), adversarial });
  const cwd = process.cwd();
  const job = createJob(HOME, { kind: opts.subcommand, repo: repoKey(), cc_task_id: null });

  const cwPromise = runCodewhale(cwReviewArgv({ rubric, instruction, maxTurns: 50 }), { cwd });
  const codexPromise = runCodex(codexReviewArgv({ base: opts.base, focus: opts.positional.join(" ") || null }), { cwd });

  const [cw, cx] = await Promise.allSettled([cwPromise, codexPromise]);
  const cwRes = cw.status === "fulfilled" ? cw.value : { code: -1, stdout: "", stderr: String(cw.reason) };
  const cxRes = cx.status === "fulfilled" ? cx.value : { code: -1, stdout: "", stderr: String(cx.reason) };

  const cwOut = parseStreamJson(cwRes.stdout);
  const cxOut = parseReviewOutput(cxRes.stdout);
  const merged = mergeFindings(cwOut ?? { issues: [] }, cxOut ?? { issues: [] });
  const report = renderMergedReport(merged);

  const reportPath = path.join(path.dirname(require_path(job.id)), `${job.id}.merged.md`);
  // write logs
  writeJobLogs(job.id, { codewhale: cwRes, codex: cxRes, report });

  updateJob(HOME, job.id, {
    status: "completed",
    exit_code: (cwRes.code === 0 && cxRes.code === 0) ? 0 : 1,
    sub_jobs: [
      { model: "codewhale", status: cwRes.code === 0 ? "completed" : "failed", exit_code: cwRes.code, code_whale_session_id: extractSessionId(cwRes.stdout), log: `${job.id}.codewhale.stdout.log` },
      { model: "codex", status: cxRes.code === 0 ? "completed" : "failed", exit_code: cxRes.code, codex_session_id: extractCodexSessionId(cxRes.stdout), log: `${job.id}.codex.stdout.log` },
    ],
    merged_report_path: `${job.id}.merged.md`,
  });

  process.stdout.write(report);
}

// helper to get jobs dir without requiring import.meta plumbing for paths
function require_path(jobId) {
  return path.join(HOME, ".codexhale-cc", "jobs", `${jobId}.json`);
}

function writeJobLogs(jobId, { codewhale, codex, report }) {
  const dir = path.join(HOME, ".codexhale-cc", "jobs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${jobId}.codewhale.stdout.log`), codewhale.stdout + "\n---STDERR---\n" + codewhale.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${jobId}.codex.stdout.log`), codex.stdout + "\n---STDERR---\n" + codex.stderr, "utf8");
  fs.writeFileSync(path.join(dir, `${jobId}.merged.md`), report, "utf8");
}

function extractSessionId(stdout) {
  const m = stdout.match(/"session_id"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}
function extractCodexSessionId(stdout) {
  const m = stdout.match(/"session_id"\s*:\s*"([0-9a-f-]{36})"/);
  return m ? m[1] : null;
}

async function runRescue(opts) {
  const task = opts.positional.join(" ");
  if (!task) { process.stderr.write("rescue requires task text\n"); process.exit(2); }
  const argv = buildRescueArgv({ task, model: opts.model, resume: opts.fresh ? null : opts.resume });
  const job = createJob(HOME, { kind: "rescue", repo: repoKey(), cc_task_id: null });
  const res = await runCodewhale(argv, { cwd: process.cwd() });
  const dir = path.join(HOME, ".codexhale-cc", "jobs");
  fs.writeFileSync(path.join(dir, `${job.id}.codewhale.stdout.log`), res.stdout + "\n---STDERR---\n" + res.stderr, "utf8");
  updateJob(HOME, job.id, {
    status: res.code === 0 ? "completed" : "failed",
    exit_code: res.code,
    sub_jobs: [{ model: "codewhale", status: res.code === 0 ? "completed" : "failed", exit_code: res.code, code_whale_session_id: extractSessionId(res.stdout), log: `${job.id}.codewhale.stdout.log` }],
  });
  process.stdout.write(res.stdout);
}

function runStatus(opts) {
  const repo = repoKey();
  const jobs = listJobsForRepo(HOME, repo);
  if (opts.positional[0]) {
    const j = readJob(HOME, opts.positional[0]);
    if (!j) { process.stderr.write("job not found\n"); process.exit(1); }
    process.stdout.write(JSON.stringify(j, null, 2) + "\n");
    return;
  }
  for (const j of jobs) {
    const age = j.ended_at ? `ended ${j.ended_at}` : "running";
    process.stdout.write(`${j.id}  ${j.kind}  ${j.status}  ${age}\n`);
  }
}

function runResult(opts) {
  const jobs = listJobsForRepo(HOME, repoKey());
  const id = opts.positional[0] ?? jobs[0]?.id;
  if (!id) { process.stderr.write("no jobs\n"); process.exit(1); }
  const j = readJob(HOME, id);
  if (!j) { process.stderr.write("job not found\n"); process.exit(1); }
  const dir = path.join(HOME, ".codexhale-cc", "jobs");
  if (j.kind === "rescue") {
    const log = path.join(dir, `${id}.codewhale.stdout.log`);
    process.stdout.write(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "(no log)\n");
    const sid = j.sub_jobs?.[0]?.code_whale_session_id;
    if (sid) process.stdout.write(`\nresume: codewhale resume ${sid}\n`);
  } else {
    const report = path.join(dir, j.merged_report_path || `${id}.merged.md`);
    process.stdout.write(fs.existsSync(report) ? fs.readFileSync(report, "utf8") : "(no report)\n");
    for (const s of j.sub_jobs ?? []) {
      if (s.model === "codewhale" && s.code_whale_session_id) process.stdout.write(`\nresume: codewhale resume ${s.code_whale_session_id}\n`);
      if (s.model === "codex" && s.codex_session_id) process.stdout.write(`resume: codex exec resume ${s.codex_session_id}\n`);
    }
  }
}

function runCancel(opts) {
  const jobs = listJobsForRepo(HOME, repoKey());
  const id = opts.positional[0] ?? jobs.find(j => j.status === "running")?.id;
  if (!id) { process.stderr.write("no running job\n"); process.exit(1); }
  updateJob(HOME, id, { status: "canceled" });
  process.stdout.write(`canceled ${id}\n`);
  process.stdout.write(`NOTE: stop the Claude Code background task via /tasks if running in background.\n`);
}

function runSetup(opts) {
  if (opts.reviewGate) {
    writeConfig(HOME, { review_gate_enabled: opts.reviewGate === "enable" });
    process.stdout.write(`review gate ${opts.reviewGate}d\n`);
    return;
  }
  const report = { codewhale: checkCli("codewhale"), codex: checkCli("codex") };
  let allowShell = "unknown";
  try {
    const doc = execSync("codewhale doctor --json", { encoding: "utf8" });
    allowShell = JSON.parse(doc).allow_shell ? "on" : "off";
  } catch {}
  process.stdout.write(`codewhale: ${report.codewhale.present ? `v${report.codewhale.version}` : "MISSING (npm i -g codewhale)"}\n`);
  process.stdout.write(`codex:     ${report.codex.present ? `v${report.codex.version}` : "MISSING (npm i -g @openai/codex; codex login)"}\n`);
  process.stdout.write(`allow_shell: ${allowShell} (review needs on)\n`);
  const cfg = readConfig(HOME);
  process.stdout.write(`review gate: ${cfg.review_gate_enabled ? "ENABLED" : "disabled"}\n`);
  if (!report.codewhale.present) process.stdout.write("\nrescue/gate unavailable without codewhale.\n");
  if (report.codewhale.present && !report.codex.present) process.stdout.write("\nreview will degrade to single-model (codewhale only) until codex is installed.\n");
}

function checkCli(name) {
  try {
    const v = execSync(`${name} --version`, { encoding: "utf8" }).trim();
    return { present: true, version: v.replace(/^[^\d]*/, "") };
  } catch {
    return { present: false, version: null };
  }
}

main().catch(e => { process.stderr.write(`${e.stack || e}\n`); process.exit(1); });
```

- [ ] **Step 2: Smoke test the dispatcher (requires both CLIs; skip if absent)**

If `codewhale` and `codex` are installed:
Run: `node plugins/codexhale/scripts/codexhale-companion.mjs setup`
Expected: prints codewhale/codex versions + allow_shell + gate status.

If not installed, verify it fails gracefully:
Run: `node plugins/codexhale/scripts/codexhale-companion.mjs setup`
Expected: prints `codewhale: MISSING ...` and `codex: MISSING ...`, exit 0.

- [ ] **Step 3: Verify all unit tests still pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 4: Commit**

```bash
git add plugins/codexhale/scripts/codexhale-companion.mjs
git commit -m "feat(companion): dispatcher for review/rescue/status/result/cancel/setup"
```

---

## Task 11: setup.test.mjs — setup readiness parsing (mocked)

**Files:**
- Create: `tests/setup.test.mjs`

- [ ] **Step 1: Write tests for the checkCli/doctor parsing helpers**

The `checkCli` and doctor parsing logic is inline in the companion. Extract `checkCli` into a testable lib first.

Create `plugins/codexhale/scripts/lib/check-cli.mjs`:
```js
import { execSync } from "node:child_process";

export function checkCli(name) {
  try {
    const v = execSync(`${name} --version`, { encoding: "utf8" }).trim();
    return { present: true, version: v.replace(/^[^\d]*/, "") };
  } catch {
    return { present: false, version: null };
  }
}

export function parseDoctor(docJson) {
  try {
    const doc = JSON.parse(docJson);
    return { allow_shell: Boolean(doc.allow_shell), version: doc.version ?? null };
  } catch {
    return { allow_shell: false, version: null };
  }
}
```

`tests/setup.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoctor } from "../plugins/codexhale/scripts/lib/check-cli.mjs";

test("parseDoctor reads allow_shell true", () => {
  const r = parseDoctor('{"version":"0.8.61","allow_shell":true}');
  assert.equal(r.allow_shell, true);
  assert.equal(r.version, "0.8.61");
});

test("parseDoctor handles missing allow_shell as false", () => {
  const r = parseDoctor('{"version":"0.8.61"}');
  assert.equal(r.allow_shell, false);
});

test("parseDoctor returns safe defaults on garbage", () => {
  const r = parseDoctor("not json");
  assert.equal(r.allow_shell, false);
  assert.equal(r.version, null);
});
```

- [ ] **Step 2: Run tests, verify pass**

Run: `npm test`
Expected: all passing.

- [ ] **Step 3: Refactor companion to use the extracted lib**

In `codexhale-companion.mjs`, replace the inline `checkCli` with:
```js
import { checkCli, parseDoctor } from "./lib/check-cli.mjs";
```
and in `runSetup`, replace the inline doctor parsing:
```js
  try {
    const doc = execSync("codewhale doctor --json", { encoding: "utf8" });
    allowShell = parseDoctor(doc).allow_shell ? "on" : "off";
  } catch {}
```
Remove the now-duplicate inline `checkCli` function.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test` and `node plugins/codexhale/scripts/codexhale-companion.mjs setup`
Expected: all passing; setup still prints readiness.

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/scripts/lib/check-cli.mjs tests/setup.test.mjs plugins/codexhale/scripts/codexhale-companion.mjs
git commit -m "feat(setup): extract + test CLI readiness parsing"
```

---

## Task 12: Slash command .md files

**Files:**
- Create: `plugins/codexhale/commands/review.md`
- Create: `plugins/codexhale/commands/adversarial-review.md`
- Create: `plugins/codexhale/commands/rescue.md`
- Create: `plugins/codexhale/commands/status.md`
- Create: `plugins/codexhale/commands/result.md`
- Create: `plugins/codexhale/commands/cancel.md`
- Create: `plugins/codexhale/commands/setup.md`

- [ ] **Step 1: Create commands/review.md**

```markdown
---
description: Run a dual-model (CodeWhale + Codex) code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a dual-model code review through CodeWhale and Codex in parallel, then merge findings.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only. Do not fix issues or apply patches.
- Your only job is to run the review and return the merged report verbatim.

Execution mode rules:
- If the raw arguments include `--wait`, run in the foreground.
- If the raw arguments include `--background`, run in a Claude background task.
- Otherwise, estimate review size first: run `git status --short --untracked-files=all`, `git diff --shortstat`, and `git diff --shortstat --cached` (or `git diff --shortstat <base>...HEAD` for `--base`). Only recommend waiting for clearly tiny changes (1-2 files). In every other case recommend background.
- Then use `AskUserQuestion` exactly once with two options, recommended first suffixed with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" review $ARGUMENTS
```
Return the command stdout verbatim. Do not paraphrase or add commentary.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" review $ARGUMENTS`,
  description: "Codexhale dual-model review",
  run_in_background: true
})
```
After launching, tell the user: "Dual-model review started in the background. Check `/codexhale:status` for progress."
```

- [ ] **Step 2: Create commands/adversarial-review.md**

```markdown
---
description: Run a steerable dual-model adversarial review challenging the implementation and design
argument-hint: '[--wait|--background] [--base <ref>] [focus text...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a steerable adversarial review through CodeWhale and Codex in parallel.

Raw slash-command arguments:
`$ARGUMENTS`

Same execution-mode rules as `/codexhale:review` (estimate size, then `AskUserQuestion` once with recommended option first). The flags `--wait`/`--background`/`--base` are parsed by the companion; everything after the flags is focus text passed to both models.

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" adversarial-review $ARGUMENTS
```
Return stdout verbatim. Do not fix issues.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" adversarial-review $ARGUMENTS`,
  description: "Codexhale adversarial review",
  run_in_background: true
})
```
After launching, tell the user to check `/codexhale:status`.
```

- [ ] **Step 3: Create commands/rescue.md**

```markdown
---
description: Delegate an implementation/debugging task to CodeWhale (DeepSeek)
argument-hint: '[--background|--wait] [--model <m|fin>] [--resume|--fresh] <task text>'
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion
---

Delegate a task to CodeWhale via the codexhale-rescue subagent.

Raw slash-command arguments:
`$ARGUMENTS`

Prefer invoking the `codexhale-rescue` subagent (Task tool) to forward the request. The subagent runs:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" rescue $ARGUMENTS
```
Notes:
- `--model fin` maps to `deepseek-v4-flash` (cheap/fast tier).
- `--resume` (bare) continues the most recent CodeWhale session for this repo; `--resume <id>` resumes a specific session; `--fresh` starts clean.
- Open-ended multi-step tasks (implement/refactor/add tests/fix bug) default to background.
Return the companion stdout verbatim.
```

- [ ] **Step 4: Create commands/status.md, result.md, cancel.md, setup.md**

`commands/status.md`:
```markdown
---
description: Show running and recent codexhale jobs for this repo
argument-hint: '[<job_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" status $ARGUMENTS
```
Return stdout verbatim.
```

`commands/result.md`:
```markdown
---
description: Show the stored output of a finished codexhale job
argument-hint: '[<job_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" result $ARGUMENTS
```
Return stdout verbatim, including any `resume:` hints.
```

`commands/cancel.md`:
```markdown
---
description: Cancel an active background codexhale job
argument-hint: '[<job_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" cancel $ARGUMENTS
```
Return stdout verbatim. If the job was running in a Claude background task, also stop it via /tasks.
```

`commands/setup.md`:
```markdown
---
description: Check codewhale + codex readiness and manage the review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(codewhale:*), Bash(codex:*), Bash(npm:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" setup $ARGUMENTS
```
Return stdout verbatim. If codewhale is missing and npm is available, offer to run `npm i -g codewhale`. If codex is missing, suggest `npm i -g @openai/codex` then `!codex login`.
```

- [ ] **Step 5: Commit**

```bash
git add plugins/codexhale/commands
git commit -m "feat(commands): slash command definitions for all subcommands"
```

---

## Task 13: codexhale-rescue subagent

**Files:**
- Create: `plugins/codexhale/agents/codexhale-rescue.md`

- [ ] **Step 1: Create the subagent definition**

`plugins/codexhale/agents/codexhale-rescue.md`:
```markdown
---
name: codexhale-rescue
description: Proactively use when Claude Code wants to delegate a substantial implementation, debugging, or refactoring task to CodeWhale (DeepSeek) through the shared runtime — especially batch work where DeepSeek's low cost and high cache hit rate matter.
model: sonnet
tools: Bash
---

You are a thin forwarding wrapper around the codexhale companion task runtime.

Your only job is to forward the user's rescue request to the companion script. Do not do anything else.

Selection guidance:
- Do not wait for the user to explicitly ask for CodeWhale. Use this subagent proactively when the main Claude thread should hand a substantial debugging or implementation task to CodeWhale.
- Do not grab simple asks the main Claude thread can finish quickly on its own.
- Prefer background for open-ended, multi-step, or long-running tasks. Prefer foreground only for small, clearly bounded requests.

Forwarding rules:
- Use exactly one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" rescue ...`.
- If the user did not explicitly choose `--background` or `--wait`, prefer background for complicated/open-ended tasks and foreground for small bounded ones.
- `--model fin` maps to `deepseek-v4-flash`. Pass a concrete model name through with `--model`.
- `--resume` (bare) → add resume=continue; `--resume <id>` → resume that id; `--fresh` → no resume. If the user clearly wants to continue prior CodeWhale work ("continue", "resume", "apply the top fix"), add `--resume` unless `--fresh` is present.
- Preserve the user's task text as-is apart from stripping routing flags.
- Return the stdout of the companion command exactly as-is.
- If the Bash call fails, return nothing.

Response style:
- Do not add commentary before or after the forwarded output.
```

- [ ] **Step 2: Commit**

```bash
git add plugins/codexhale/agents
git commit -m "feat(agent): codexhale-rescue thin forwarding subagent"
```

---

## Task 14: hooks.json + stop-review-gate-hook.mjs

**Files:**
- Create: `plugins/codexhale/hooks/hooks.json`
- Create: `plugins/codexhale/scripts/stop-review-gate-hook.mjs`

- [ ] **Step 1: Create hooks.json**

`plugins/codexhale/hooks/hooks.json`:
```json
{
  "description": "Optional stop-time review gate for codexhale.",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs\" __noop_session_start",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs\"",
            "timeout": 1800
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Implement the Stop hook**

The Stop hook receives Claude's transcript on stdin (JSON) per Claude Code hook protocol. It checks the gate flag, inspects the turn for Edit/Write/Bash tool use, runs a read-only CodeWhale review, parses the result, and emits a `block` decision if issues found.

`plugins/codexhale/scripts/stop-review-gate-hook.mjs`:
```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readConfig } from "./lib/config.mjs";
import { buildReviewArgv, runCodewhale, parseStreamJson } from "./lib/codewhale.mjs";

const HOME = os.homedir();
const PLUGIN_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")), "..");

async function main() {
  // Claude Code Stop hooks read JSON from stdin.
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { /* no stdin */ }

  const cfg = readConfig(HOME);
  if (!cfg.review_gate_enabled) {
    process.exit(0); // gate off => allow stop
  }

  // Fail-open: if we can't parse the transcript, allow stop.
  let transcript;
  try { transcript = JSON.parse(raw); } catch { process.exit(0); }

  const changedFiles = extractChangedFiles(transcript);
  if (changedFiles.length === 0) {
    process.exit(0); // no code changes this turn => skip
  }

  const rubric = fs.readFileSync(path.join(PLUGIN_ROOT, "prompts", "stop-review-gate.md"), "utf8");
  const claim = extractClaim(transcript);
  const instruction = `Claude just made changes to: ${changedFiles.join(", ")}.\nClaude's claim: ${claim}\nVerify the changes are sound and complete. Report blocking issues only.`;

  let res;
  try {
    res = await runCodewhale(buildReviewArgv({ rubric, instruction, maxTurns: 40 }), { cwd: process.cwd() });
  } catch {
    process.exit(0); // fail-open
  }
  if (res.code !== 0) {
    process.exit(0); // fail-open on codewhale error
  }

  const out = parseStreamJson(res.stdout);
  const issues = (out?.issues ?? []).filter(i => ["critical", "high"].includes(i.severity));
  if (issues.length === 0) {
    process.exit(0); // clean => allow stop
  }

  // Block: emit the Claude Code Stop-hook block decision.
  const reasons = issues.map(i => `- [${i.severity}] ${i.file}:${(i.line_range || []).join("-")} ${i.category}: ${i.description}`).join("\n");
  const decision = {
    decision: "block",
    reason: `CodeWhale review gate found ${issues.length} blocking issue(s):\n${reasons}\n\nAddress these before stopping.`,
  };
  process.stdout.write(JSON.stringify(decision));
  process.exit(0);
}

function extractChangedFiles(transcript) {
  // Claude Code transcript shape varies; scan tool calls for file targets.
  const files = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === "tool_use" && ["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(node.name)) {
      const fp = node.input?.file_path || node.input?.path;
      if (fp) files.add(fp);
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(transcript);
  return [...files];
}

function extractClaim(transcript) {
  // Best-effort: last assistant text message.
  const texts = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.role === "assistant" && typeof node.content === "string") texts.push(node.content);
    if (node.type === "text" && typeof node.text === "string") texts.push(node.text);
    for (const v of Object.values(node)) walk(v);
  };
  walk(transcript);
  return (texts[texts.length - 1] || "").slice(0, 500);
}

main().catch(() => process.exit(0)); // always fail-open
```

- [ ] **Step 3: Verify the hook exits 0 when gate disabled**

With gate disabled (default):
Run: `echo '{}' | node plugins/codexhale/scripts/stop-review-gate-hook.mjs; echo "exit=$?"`
Expected: `exit=0` (no output — gate off).

- [ ] **Step 4: Commit**

```bash
git add plugins/codexhale/hooks/hooks.json plugins/codexhale/scripts/stop-review-gate-hook.mjs
git commit -m "feat(hooks): Stop review gate + session lifecycle hooks"
```

---

## Task 15: Plugin manifest + marketplace metadata

Claude Code plugins need a `.claude-plugin/plugin.json` so they can be installed.

**Files:**
- Create: `plugins/codexhale/.claude-plugin/plugin.json`

- [ ] **Step 1: Create plugin.json**

`plugins/codexhale/.claude-plugin/plugin.json`:
```json
{
  "name": "codexhale",
  "version": "0.1.0",
  "description": "Dual-model (CodeWhale + Codex) code review and CodeWhale task delegation for Claude Code.",
  "author": "codexhale",
  "license": "MIT",
  "homepage": "https://github.com/Hmbown/CodeWhale"
}
```

- [ ] **Step 2: Commit**

```bash
git add plugins/codexhale/.claude-plugin/plugin.json
git commit -m "feat(manifest): claude-plugin manifest for installability"
```

---

## Task 16: README + integration smoke test

**Files:**
- Create: `plugins/codexhale/README.md`

- [ ] **Step 1: Create README**

`plugins/codexhale/README.md`:
```markdown
# codexhale — CodeWhale + Codex plugin for Claude Code

Dual-model adversarial code review and cheap task delegation. CodeWhale (DeepSeek, high cache hit rate) and Codex (OpenAI) review your changes in parallel; implementation tasks delegate to CodeWhale.

## Requirements
- `codewhale` v0.8.61+ (`npm i -g codewhale`) with `allow_shell=true` in `~/.codewhale/config.toml`
- `codex` (`npm i -g @openai/codex`, then `codex login`)

## Install
```
/plugin marketplace add <this-repo>
/plugin install codexhale
/reload-plugins
/codexhale:setup
```

## Commands
- `/codexhale:review` — dual-model review of uncommitted changes (add `--base main` for branch review)
- `/codexhale:adversarial-review [focus]` — steerable challenge review
- `/codexhale:rescue <task>` — delegate implementation/debugging to CodeWhale (`--model fin` for cheap tier, `--resume` to continue)
- `/codexhale:status` / `result` / `cancel` — manage background jobs
- `/codexhale:setup --enable-review-gate` — gate Claude's turn completion behind a CodeWhale review (default off)

## When to use which model
- **Review / adversarial** → always codexhale (dual-model, highest blind-spot coverage)
- **Batch implement / refactor / add tests / fix bug** → `/codexhale:rescue --background` (DeepSeek is cheap; optional `--model fin`)
- **Tiny one-line edits** → keep in Claude (spawning CodeWhale costs more than it saves)
- **Orchestration / planning / final delivery** → Claude

## Review gate warning
The Stop hook review gate creates a Claude↔CodeWhale loop and drains usage. Only enable when actively monitoring. Default off.

## How the cache benefit works
Review rubrics live in `prompts/*.md` and are passed via CodeWhale's `--append-system-prompt` — byte-identical every review, so DeepSeek caches the stable prefix. You pay full price only on the diff.
```

- [ ] **Step 2: Run full test suite one final time**

Run: `npm test`
Expected: all tests passing.

- [ ] **Step 3: Commit**

```bash
git add plugins/codexhale/README.md
git commit -m "docs: plugin README with usage and model-routing guidance"
```

---

## Self-Review Notes

**Spec coverage check:**
- §3 architecture → Task 10 (companion), Task 8/9 (codewhale/codex libs), Task 14 (hook)
- §5.1 review (dual-model, disallowed-tools, --base/--scope, --wait/--background) → Task 8 + Task 10 + Task 12
- §5.2 adversarial-review → Task 5 + Task 10 + Task 12
- §5.2.1 merge/dedupe/disputed → Task 7
- §5.3 rescue (--yolo/--model fin/--resume/--fresh/--background) → Task 8 + Task 10 + Task 13
- §5.4 status → Task 4 + Task 10 + Task 12
- §5.5 result → Task 4 + Task 10 + Task 12
- §5.6 cancel → Task 4 + Task 10 + Task 12
- §5.7 setup (dual deps, doctor, gate toggle) → Task 11 + Task 10 + Task 12
- §5.8 job lifecycle (manifest, sub_jobs, logs) → Task 4 + Task 10
- §6 Stop hook (gate flag, changed-files heuristic, codewhale review, block decision, fail-open, 1800s, 40 turns) → Task 14
- §7 cache strategy (stable --append-system-prompt, byte-identical test) → Task 8 (stability test) + Task 6 (prompts)
- §8 security (disallowed-tools, --yolo opt-in, no secrets) → Task 8 + Task 10
- §9 tests (args, prompt stability, jobs, setup, stream-json, fin mapping, merge) → Tasks 2,3,4,5,7,8,9,11
- §10 out of scope — not implemented (correct)

**Placeholder scan:** none. All steps contain concrete code or commands.

**Type/name consistency:** `mergeFindings`/`renderMergedReport` (Task 7) match usage in Task 10. `buildReviewArgv` exists in both codewhale.mjs and codex.mjs (imported with aliases in Task 10 — confirmed). `parseStreamJson`/`parseReviewOutput` consistent. `createJob`/`updateJob`/`readJob`/`listJobsForRepo` consistent across Tasks 4 & 10. `buildReviewInstruction` (Task 5) signature `{ base, focus, adversarial }` matches Task 10 callsite. `checkCli`/`parseDoctor` (Task 11) match Task 10 refactor.

**One known simplification:** Task 10's `runCancel` cannot directly kill a Claude Code background task from Node (that's a CC-internal handle); it marks the job canceled and instructs the user/agent to stop the CC task via `/tasks`. This matches the spec's session-scoped limitation and is documented in the command.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-codexhale-plugin.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
