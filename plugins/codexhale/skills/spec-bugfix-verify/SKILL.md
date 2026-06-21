---
name: spec-bugfix-verify
description: "Bugfix verification phase - tests, quality checks, fix confirmation"
argument-hint: "<path/to/plan.md>"
user-invocable: false
hooks:
  Stop:
    - command: uv run --no-project --python python3 python "$HOME/.claude/hooks/spec_verify_validator.py"
---

# /spec-bugfix-verify - Bugfix Verification Phase

**Phase 3 (bugfix).** Lightweight verification: run tests, quality checks, confirm fix works end-to-end.

**Input:** Bugfix plan with `Status: COMPLETE`
**Output:** Plan → VERIFIED (success) or loop back to implementation (failure)

**Why no sub-agents:** The regression test plus end-to-end verification (Step 1.6 / Step 3 Verification Scenario) prove the fix works. The full test suite proves nothing else broke. Sub-agents would re-verify what tests + E2E already prove.

---

## Critical Constraints

- **NO review sub-agents** — tests + E2E re-check carry the proof for bugfixes
- **NO stopping** — everything automatic. Never ask "Should I fix these?"
- **Fix ALL issues automatically** — no permission needed
- **Plan file is source of truth** — re-read after auto-compaction
- ⛔ **NEVER claim VERIFIED on tests alone.** Step 1.6 (non-UI) and Step 3 (UI Verification Scenario) require running the actual program — Chrome / Chrome DevTools MCP / playwright-cli / agent-browser for UI; CLI / API / REPL for non-UI. Skip is never an option.

## Step 1: Verify the Fix — Behavior Contract Audit

Audits that the process was followed. A retroactive test that passes proves nothing.

### 1.0 Run Full Test Suite (Baseline)

Run all tests. Fix any failures immediately. Re-run until green. The remaining sub-steps assume a clean baseline.

### 1.1 Read the plan

Read: `## Behavior Contract`, Task 1's `Entry point:` and test file/name, `Root Cause: file:line` from the summary.

If `## Behavior Contract` is missing (older plan): reconstruct from Summary + Fix Approach and add it to the plan before continuing.

### 1.2 Run the reproducing test

```bash
uv run pytest <test-path>::<test-name> -q   # or language-appropriate equivalent
```

Must PASS. If not, fix is incomplete — fix immediately.

### 1.3 Prove the test is a genuine RED (always run)

A test only has value if it would fail without the fix. Run the test against pre-fix code; it must fail. One atomic bash with trap-based cleanup — touches only the root-cause file, always restores it (works in worktree and non-worktree mode):

```bash
ROOT_CAUSE_FILE="<path from plan Summary>"
TEST_CMD="<command that runs the single reproducing test>"

BACKUP=$(mktemp)
cp "$ROOT_CAUSE_FILE" "$BACKUP"
trap 'cp "$BACKUP" "$ROOT_CAUSE_FILE" 2>/dev/null; rm -f "$BACKUP"; trap - EXIT INT TERM' EXIT INT TERM

if ! git diff --quiet HEAD -- "$ROOT_CAUSE_FILE"; then
    git show "HEAD:$ROOT_CAUSE_FILE" > "$ROOT_CAUSE_FILE"
else
    FIX_COMMIT=$(git log --format=%H -1 -- "$ROOT_CAUSE_FILE")
    git show "${FIX_COMMIT}~1:$ROOT_CAUSE_FILE" > "$ROOT_CAUSE_FILE"
fi

eval "$TEST_CMD"
```

`cp + trap` instead of `git stash`: stash modifies index/working-tree globally and can leave untracked files or merge conflicts on pop. `cp + trap` touches one file and always restores it.

Outcomes:

- **Test failed with the documented `Currently (bug)` error** → RED proven.
- **Test passed without fix** → test doesn't encode the bug. Set `Status: PENDING`, note "reproducing test does not fail without fix", return to `codexhale:spec-implement`.
- **Test errored unrelated** (import, missing fixture) → not a valid signal. Investigate: test depends on something only the fix creates (design problem) or unrelated change snuck in. Resolve before accepting.

### 1.4 Root-cause + scope audit

```bash
git diff --name-only <base>..HEAD
```

1. **Root-cause file MUST be in the diff.** If not, fix is at symptom — set `Status: PENDING`, return to `codexhale:spec-implement`.
2. **Symptom-patching smells:** new broad `try/except` around the failing call, `if value is None: return default` at the caller when the bug is upstream, swallowed exceptions, silently normalised bad inputs, early returns hiding wrong state, renamed/suppressed log lines. Record + justify in Investigation, or revert.
3. **Scope check:** diff matches plan scope (Task 1 tests + Task 2 root-cause file ± documented defense-in-depth). Unplanned changes belong elsewhere — revert or extend the plan.

### 1.5 Instrumentation cleanup

```bash
if git diff <base>..HEAD | grep -n "SPEC-DEBUG"; then
    echo "Temporary debug markers present — remove before continuing"
    exit 1
fi
```

Zero matches = clean. Any match = remove and re-run. Unmarked `console.log`/`print` additions are also suspect — inspect, justify, or remove.

### 1.6 Original symptom re-check — MANDATORY end-to-end verification

⛔ **The regression test passing does NOT prove the bug is fixed.** Unit tests can sit below the user's layer. A green test plus a still-broken app is the most common "fixed but not really" failure mode. You MUST run the actual program with the original input and observe the symptom is gone.

**Skip is NOT an option.** Capture concrete evidence (command, output, page state, status code) — bare assertions are insufficient.

Re-run the original repro from `## Summary — Trigger:` using the matching lane:

| Bug surface | What to run | Evidence to capture |
|-------------|-------------|---------------------|
| **CLI** | The exact command the user ran | Command + relevant output lines + exit code |
| **API** | `curl` / HTTP client with the user's input | Status code + the field/value that proves the fix |
| **Library / SDK / function** | `python -c '...'`, `node -e '...'`, REPL, or scratch script | Invocation + returned value |
| **Background job / cron / worker** | Trigger the job manually with the failing input | Run + log lines |
| **UI** | **Skip here — handled by Step 3 (Verification Scenario)** with browser automation (Claude Code Chrome → Chrome DevTools MCP → playwright-cli → agent-browser per `browser-automation.md`) | — |

**If the regression test passes but the original repro still fails:** test is at the wrong layer. Set `Status: PENDING`, note "test green but original repro still fails — layer mismatch", return to `codexhale:spec-implement` to rewrite Task 1's test at the user's entry point.

**If the running program is unavailable** (build broken, infra missing, integration env down): set `Status: PENDING`, note the blocker, escalate to the user. Do not advance to VERIFIED on tests alone.

## Step 2: Quality Checks + Residual Plan Verifies

1. **Type checker** — zero new errors
2. **Linter** — errors are blockers, fix immediately
3. **Build** (if applicable) — must succeed
4. **Residual `Verify:` commands.** The uniform 3-task plan structure means Task 1's verify (RED) was run by `codexhale:spec-implement`, Task 2's verify (PASS) was run in Step 1.2, and Task 3's verify (lint/types/build) is covered by 1–3 above. Skip those. Run only **residual** commands a human author added (e.g. `uv run python -c "import foo; foo.smoke()"`, an endpoint smoke test) — usually nothing.

   For server-dependent residuals (containing `curl`, `localhost`, `http://`): start the service → run the command → stop the service → fix failures. Skip this branch entirely if no residuals exist.

### Codexhale debate review (optional)

**If `PILOT_CODEX_CHANGES_REVIEW_ENABLED` is `"true"`:** run the codexhale debate review on the bugfix diff - CodeWhale + Codex (read-only) plus a cross-rebuttal, ONE round per verify pass.

```
Bash(
  command="node \"${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs\" debate-review --base ${BASE_REF:-main}",
  run_in_background=true,
  timeout=900000
)
```

When it completes, read its Markdown report (`## Verdict` is `clean` or `BLOCKING`; each finding is tagged `agreed` / `disputed` / `refuted` / `uncontested`). Fix `agreed` critical/high (must_fix) and `agreed` medium (should_fix); mention the rest. Do NOT loop here - if unresolved `agreed` critical/high remain, the existing outer loop (Step 7: Status -> PENDING -> codexhale:spec-implement -> re-verify, capped at 3) re-runs verify on the post-fix diff. A `degraded` verdict (one model unavailable) is a warning, not a full debate.

## Step 3: Verification Scenario (if exists in plan)

Check whether the plan has a `## Verification Scenario` section (only present for UI-facing bugs).

**If no Verification Scenario:** proceed to Step 4.

**If Verification Scenario exists:**

**Resolve browser tool (4-tier):** Check if `mcp__claude-in-chrome__*` tools are available → use Chrome. Otherwise check for `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*` → use Chrome DevTools MCP. Otherwise use playwright-cli (preferred CLI) or agent-browser (lightweight). See `browser-automation.md`.

```bash
<!-- CC-ONLY -->
# Chrome DevTools MCP: load via ToolSearch(query="chrome-devtools-mcp", max_results=30)
<!-- /CC-ONLY -->
<!-- CODEX-START
# Chrome DevTools MCP: use the available Chrome DevTools MCP tools if present; if deferred, load them with the available tool-discovery helper.
CODEX-END -->
# playwright-cli:
playwright-cli -s=$PILOT_SESSION_ID open <url>
# agent-browser fallback:
AB_SESSION="${PILOT_SESSION_ID:-default}"
agent-browser --session "$AB_SESSION" open <url>
```

1. Execute each step from the scenario using the resolved browser tool
   - **Chrome:** `navigate`, `read_page`, `computer`/`form_input`
   - **Chrome DevTools MCP:** `navigate_page`, `take_snapshot`, `click(uid=...)`/`fill(uid=...)`
   - **playwright-cli:** `open`/`goto`, `snapshot`, `click`/`fill` (bare refs: `e1`)
   - **agent-browser:** `open`/`goto`, `snapshot -i`, `click`/`fill` (refs: `@e1`)
2. Verify the expected result for each step (read page after each interaction)
3. **PASS:** Scenario confirms fix works — close browser (CLI tools only), proceed to Step 4
4. **FAIL (attempt 1):** Analyze root cause, implement fix, re-run tests, re-execute scenario
5. **FAIL (attempt 2):** Implement second fix, re-run tests, re-execute scenario
<!-- CC-ONLY -->
6. **FAIL after 2 attempts:** The bug is not fully fixed — set `Status: PENDING`, increment `Iterations`, invoke `Skill(skill='codexhale:spec-implement', args='<plan-path>')`. Do not proceed to VERIFIED.
<!-- /CC-ONLY -->
<!-- CODEX-START
6. **FAIL after 2 attempts:** The bug is not fully fixed — set `Status: PENDING`, increment `Iterations`, then continue immediately with the `$spec-implement` skill instructions using arguments: `<plan-path>`. Do not proceed to VERIFIED.
CODEX-END -->

```bash
# Chrome DevTools MCP: no explicit close needed
# playwright-cli: playwright-cli -s=$PILOT_SESSION_ID close
# agent-browser: agent-browser --session "$AB_SESSION" close
```

## Step 4: Worktree Sync (if worktree active)

1. Detect: `~/.pilot/bin/pilot worktree detect --json <plan_slug>`
2. If no worktree: skip to Step 6.
3. Save plan to project root (only if gitignored):
   `git -C <project_root> check-ignore -q docs/plans/<plan_filename>` — if exit 0: `cp <worktree_plan> <project_root>/docs/plans/`; if exit 1 (tracked): skip — squash merge brings the updated plan.
5. Show diff: `~/.pilot/bin/pilot worktree diff --json <plan_slug>`
6. Notify + AskUserQuestion: "Yes, squash merge" | "No, keep" | "Discard"
7. Handle:
   - **Squash:** `worktree sync && cleanup --force + cd` — ALL in ONE Bash call chained with `&&`. Cleanup MUST NOT run if sync fails.
   - **Keep:** Report path
   - **Discard:** `cleanup --discard` + `cd` in SAME bash call (no sync needed — `--discard` explicitly allows deleting unmerged work)

   ⛔ NEVER split sync, cleanup, or cd into separate Bash calls — compaction between them can cause work loss.

## Step 5: Check for Code Review Feedback

**Run BEFORE marking VERIFIED.** Check if the user left code review annotations in the Console's Changes tab. Annotations auto-save — no "Send Feedback" button needed.

Derive the annotation file path: `docs/plans/.annotations/<plan-filename>.json` (same basename as the plan, `.json` extension).

Read the annotation file with the Read tool. If the file doesn't exist, treat as `NO_ANNOTATIONS_FOUND`. If it exists, check whether `codeReviewAnnotations` has any entries (`ANNOTATIONS_FOUND`) or is empty/missing (`NO_ANNOTATIONS_FOUND`).

**⛔ Absence of annotations ≠ approval.** Annotations are an *optional* inline channel; most users approve verbally via Step 6. Never collapse Step 5 → Step 7 because the file is missing or empty.

**If `ANNOTATIONS_FOUND`:** Each annotation in `codeReviewAnnotations` has `filePath`, `lineStart`, `text`. Fix all issues, delete the annotation file via `rm -f "<annotation-file-path>"` (e.g. `rm -f "docs/plans/.annotations/2026-03-26-my-bug.json"`), re-run tests, continue to Step 6.
**If `NO_ANNOTATIONS_FOUND`:** continue to Step 6. **You still MUST run Step 6 (the human gate).**

## Step 6: Code Review Gate (User Confirmation)

**⛔ MANDATORY before marking VERIFIED.**

<!-- CC-ONLY -->
**⛔ MUST use `AskUserQuestion`** — the stop guard only allows stopping when it detects this tool in the transcript. Plain text output will cause the stop guard to block session exit while waiting for user feedback.

**⛔ Resume / compaction / idle:** if you wake into a session where the previous Step 6 is unresolved (no in-turn approve keyword received from the user), **re-ask via `AskUserQuestion`**. Do NOT infer approval from "checks all passed," empty annotations, or a long quiet gap. Silence is never approval.
<!-- /CC-ONLY -->
<!-- CODEX-START
**⛔ Present options as numbered text and wait for user response.** Do NOT infer approval from "checks all passed" or silence. Explicit approval keywords required.
CODEX-END -->

1. Notify:
   ```bash
   ~/.pilot/bin/pilot notify plan_approval "Bugfix Verification Complete" "<plan-slug> — please review changes" --plan-path "<plan_path>" 2>/dev/null || true
   ```

2. Summarize what was done (brief: fix applied, tests passed, verification results), then ask:

   ```
   AskUserQuestion(
     question="All automated checks passed. Please review the code changes in the Console's **Changes** tab.\n\nYou can leave inline annotations using the **Review** mode toggle — annotations save automatically.\n\n[brief summary of fix]\n\nChoose an option below, or type your feedback directly into the input box (free text works the same as picking 'Manual'):",
     options=["Approve — mark spec as verified", "Fix — address my annotations from the Console", "Manual — I'll test manually and report back"]
   )
   ```

3. Handle response — **match strictly, never auto-approve ambiguous input:**
   - **Approve:** Response is one of: "Approve", "approve", "lgtm", "looks good", "continue", "proceed" → proceed to Step 7
   - **Fix:** Response matches "Fix" or mentions annotations/console feedback → re-run Step 5 (check for code review annotations in JSON), apply fixes, re-run tests, return to Step 6
   - **Manual / custom text:** Response matches "Manual" OR is ANY other free-text/custom input → the user wants to pause. **Do NOT mark VERIFIED. Do NOT change plan status.** Use `AskUserQuestion` again (required so the stop guard allows the user to exit while waiting):
     ```
     AskUserQuestion(
       question="Take your time testing. When you're done, choose an option or describe any issues you found:",
       options=["Approve — mark spec as verified", "Issues found — describe below"]
     )
     ```
     Then **stop and wait** for the user's next message.
   - **⛔ After Manual wait — re-evaluation of follow-up:** When the user responds after a Manual pause:
     - Explicit approval ("approve", "lgtm", "looks good") → proceed to Step 7
     - **Any other content** (error descriptions, screenshots, images, bug reports, or ANY non-approval text) → treat as **bug reports to fix**. Investigate the reported issues, implement fixes, re-run tests, then return to Step 6 (ask again).
   - **⛔ NEVER treat ambiguous or custom responses as approval.** Only the explicit keywords listed under "Approve" advance to Step 7.

## Step 7: Update Plan Status

### ⛔ Precondition Gate — verify ALL THREE before writing `Status: VERIFIED`

1. `AskUserQuestion` was called in **this same conversation turn flow** as part of Step 6 (not a previous, abandoned one).
2. The user's most recent reply contains one of the **explicit approve keywords**: `Approve`, `approve`, `lgtm`, `looks good`, `continue`, `proceed`.
3. That reply arrived **after** the AskUserQuestion call — not before, not as a stale message.

If any of the three is false → return to Step 6 and re-ask. Common traps that DO NOT count as approval: "no annotations in file", "all tests pass", "user has been idle", "session was resumed", "user said 'thanks'/'ok'/anything else."

**All passes and user approves:** Set `Status: VERIFIED`, register:
```bash
~/.pilot/bin/pilot register-plan "<plan_path>" "VERIFIED" 2>/dev/null || true
```
Report:
```
Bugfix verified — regression test passes, full suite green.
Run /clear before starting new work — this resets context while keeping project rules loaded.
```

**Fails:**

⛔ **Iteration cap.** Read `Iterations:` from the plan header. If `Iterations >= 3` BEFORE incrementing, stop the fix-on-fix loop:

<!-- CC-ONLY -->
```
AskUserQuestion(
  question="Three fix iterations have failed verification. This pattern usually means the bug is architectural — fixing symptoms in different places, each fix revealing a new failure mode. What now?",
  options=[
    "Continue — try one more fix (rarely the right answer)",
    "Pivot — let me re-investigate root cause with you",
    "Abandon — leave PENDING, I'll come back to it"
  ]
)
```
<!-- /CC-ONLY -->
<!-- CODEX-START
Present these numbered options and wait for user response:

1. Continue — try one more fix (rarely the right answer)
2. Pivot — let me re-investigate root cause with you
3. Abandon — leave PENDING, I'll come back to it
CODEX-END -->

Handle:
<!-- CC-ONLY -->
- **Continue:** increment `Iterations`, invoke `Skill(skill='codexhale:spec-implement', args='<plan-path>')` as below.
<!-- /CC-ONLY -->
<!-- CODEX-START
- **Continue:** increment `Iterations`, then continue immediately with the `$spec-implement` skill instructions using arguments: `<plan-path>`.
CODEX-END -->
- **Pivot:** set `Status: PENDING`, do NOT invoke spec-implement. Tell the user you're standing by for new investigation direction.
- **Abandon:** leave `Status: PENDING`, do not invoke spec-implement. Stop.

<!-- CC-ONLY -->
**When `Iterations < 3`:** Add fix tasks, set `Status: PENDING`, increment `Iterations`, invoke `Skill(skill='codexhale:spec-implement', args='<plan-path>')`.
<!-- /CC-ONLY -->
<!-- CODEX-START
**When `Iterations < 3`:** Add fix tasks, set `Status: PENDING`, increment `Iterations`, then continue immediately with the `$spec-implement` skill instructions using arguments: `<plan-path>`.
CODEX-END -->

ARGUMENTS: $ARGUMENTS