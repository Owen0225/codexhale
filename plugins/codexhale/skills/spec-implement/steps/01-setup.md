## Step 1: Setup — Read Plan, Detect Worktree, Set Up Task List

<!-- CC-ONLY -->
### 1.0 Plan Mode Exit Guard (MANDATORY safety net)

**⛔ This is the very first action — before reading the plan or doing any other work.**

`codexhale:spec-plan` should have called `ExitPlanMode` before invoking this skill. If it didn't (model skip, approval edge case, etc.), you are still on Opus in plan mode and implementation will run on the wrong model. Exit now.

```bash
echo "MODEL_SWITCH=$PILOT_MODEL_SWITCH_ENABLED"
SPEC_SESS="${PILOT_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-default}}"
[ -f "$HOME/.pilot/sessions/$SPEC_SESS/plan-mode-skipped-fable" ] && echo "ON_FABLE=true" || echo "ON_FABLE=false"
```

**If `ON_FABLE=true`:** skip this guard entirely even when `MODEL_SWITCH=true` — the planning leg ran on a Fable-class model (no `fableplan` split), `EnterPlanMode` was never called, and there is no plan mode to exit. Proceed to 1.1.

**Otherwise, if `MODEL_SWITCH=true`:**
```
ToolSearch(query="select:ExitPlanMode")   # deferred — load schema first
ExitPlanMode(...)                          # safe to call even if already exited; exits plan mode → Sonnet
```

- If `ToolSearch` returns no tool: emit one visible line ("ExitPlanMode unavailable — implementation will run on current model") and continue.
- If `MODEL_SWITCH=false` or unset: skip entirely — no plan mode was entered.

**Do NOT skip this step to save tokens. An extra ExitPlanMode call costs nothing; running the entire implementation leg on Opus is expensive and wrong.**
<!-- /CC-ONLY -->

### 1.1 Read Plan & Gather Context

1. **Read the COMPLETE plan** — understand architecture and design
2. **Summarize understanding** — demonstrate comprehension
3. **Check current state:** `git status --short`, `git diff --name-only`, plan progress (`[x]` vs `[ ]`)

<!-- CC-ONLY -->
**Research tools during implementation:** CodeGraph (`codegraph_context` to orient on each task, `codegraph_explore` for deep code understanding in one call, `codegraph_callers`/`codegraph_callees` before modifying a shared or non-trivial function, `codegraph_impact` for blast radius), Context7 (library docs), Semble `semble search` or `mcp__semble__search` (find patterns by intent), `semble find-related` (discover parallel implementations), grep-mcp (production examples).

**Before modifying a shared or non-trivial function:** trace `codegraph_callers` + `codegraph_callees` — it catches callers you'd otherwise miss. A self-contained local function the plan already isolated doesn't need it.
<!-- /CC-ONLY -->
<!-- CODEX-START
**Research tools during implementation:** Use CodeGraph for structural runtime-code questions (`codegraph_context` when entry points are unknown, `codegraph_explore` for known symbols, `codegraph_callers`/`codegraph_callees` before non-local function changes, `codegraph_impact` for blast radius), Context7 for library docs, Semble for intent/pattern discovery, and grep-mcp for production examples.

**Codex proportionality:** Skip CodeGraph for docs, rules, markdown, config, UI copy, test-only edits, or named-path local changes unless the call graph itself is the uncertainty. Before modifying a runtime function with non-local effects, run `codegraph_callers` + `codegraph_callees`; for a local function already isolated by the plan and targeted reads, do not add graph calls just to satisfy a checklist.
CODEX-END -->

### 1.2 Detect or Resume Worktree (Conditional)

**Read `Worktree:` header from plan.** If `No` or missing: skip to 1.3.

**If `Worktree: Yes`:**

1. Extract plan slug: `docs/plans/2026-02-09-add-auth.md` → `add-auth`
2. Detect: `~/.pilot/bin/pilot worktree detect --json <plan_slug>`
3. **If found:** `cd` to the worktree `path`
4. **If not found:** Create as fallback:
   ```bash
   ~/.pilot/bin/pilot worktree create --json <plan_slug>
   ```
   Copy plan file into worktree if needed. `cd` to worktree path.
5. If creation fails (old git): continue without worktree.
6. Verify: `git branch --show-current` should show `spec/<plan_slug>`

All subsequent work happens inside the worktree directory.

### 1.3 Set Up Task List (MANDATORY)

<!-- CC-ONLY -->
1. **Check existing:** `TaskList` — if tasks exist from prior session, resume (don't recreate)
2. **If empty:** Create one task per uncompleted `[ ]` plan task:
   ```
   TaskCreate(subject="Task N: <title>", description="<objective>", activeForm="Implementing <desc>")
   ```
   Set dependencies: `TaskUpdate(taskId="...", addBlockedBy=["..."])`
3. Skip `[x]` (already completed) tasks
<!-- /CC-ONLY -->
<!-- CODEX-START
1. List uncompleted `[ ]` plan tasks — these are your work items.
2. Track progress by updating plan checkboxes (`[ ]` → `[x]`) after each task.
3. Skip `[x]` (already completed) tasks.
CODEX-END -->
