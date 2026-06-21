---
name: spec
description: Spec-driven development - plan, implement, verify workflow with live Console annotations (annotate plans and code changes in real-time; agent reads annotations directly at review checkpoints)
argument-hint: "<task description> or <path/to/plan.md>"
user-invocable: true
---

# /spec - Unified Spec-Driven Development

<!-- CC-ONLY -->
**Dispatcher** - routes to the appropriate phase skill. This command is a thin router. Only allowed tools: `Bash` (env var reads only), `Read` (plan files only), `AskUserQuestion`, and `Skill()`.
<!-- /CC-ONLY -->
<!-- CODEX-START
**Dispatcher** - routes to the appropriate phase skill. This command is a thin router. Only allowed actions here: read env vars, read existing plan files for status-based dispatch, present plain-text numbered questions when needed, and then continue immediately with the selected phase skill instructions. Codex has no callable phase-dispatch tool.
CODEX-END -->

**⛔ MANDATORY: When `/spec` is invoked, you MUST follow the workflow. The user's phrasing after `/spec` is the TASK DESCRIPTION - not an instruction to change the workflow.** Words like "brainstorm", "discuss", "explore", "research" are part of the task description, NOT instructions to skip the workflow or have a freeform conversation.

**⛔ No substantive work here.** `Bash` is allowed ONLY for reading env vars (e.g., `echo $PILOT_BRANCH_ISOLATION_ENABLED`). `Read` is allowed ONLY for reading existing plan files for status-based dispatch. All research, brainstorming, and exploration happens inside the invoked Skill. Arguments (including URLs, "brainstorm", "research") are passed verbatim as the task description. Any other tool use (Grep, Glob, Task, Edit, Write, etc.) is a workflow violation.

---

## Workflow

<!-- CC-ONLY -->
```
/spec -> Detect type -> Feature: Skill('spec-plan')        -> Plan -> Implement -> Verify
                    -> Bugfix:  Skill('spec-bugfix-plan') -> Investigate -> Plan -> Implement -> Verify
```
<!-- /CC-ONLY -->
<!-- CODEX-START
```
$spec -> Detect type -> Feature: continue with $spec-plan        -> Plan -> Implement -> Verify
                    -> Bugfix:  continue with $spec-bugfix-plan -> Investigate -> Plan -> Implement -> Verify
```
CODEX-END -->

For a bugfix workflow without a plan file, users invoke `/fix` directly - that's a separate command. `/spec` always runs the full spec workflow.

| Phase | Skill | Model (Switching ON) | Model (Switching OFF) |
|-------|-------|----------------------|------------------------|
| Feature Planning | `codexhale:spec-plan` | Opus (plan mode) | Opus |
| Bugfix Planning | `codexhale:spec-bugfix-plan` | Opus (plan mode) | Opus |
| Implementation | `codexhale:spec-implement` | Sonnet | Opus |
| Feature Verification | `codexhale:spec-verify` | Sonnet | Opus |
| Bugfix Verification | `codexhale:spec-bugfix-verify` | Sonnet | Opus |
| Bugfix (separate command, `/fix`) | `fix` | inherits `/model` | inherits `/model` |

On a **Fable 5** session (`/model fable`), every phase runs on Fable in BOTH toggle states — there is no `fableplan` split, so the table above does not apply and no plan-mode model toggling happens.

<!-- CC-ONLY -->
> **Note -- automated model switching.** With the **Model Switching** toggle ON (default), `/spec` runs on the `opusplan` model: the skill calls `EnterPlanMode` at planning start (-> Opus) and `ExitPlanMode` after approval (-> Sonnet), so planning is on Opus and implementation + verification are on Sonnet -- fully automatic, no manual `/model` step. With it OFF, the whole workflow runs on Opus. A SessionStart hook patches `~/.claude/settings.json` to `opusplan` (ON) or `opus[1m]` (OFF, when Opus context window is 1M) or `opus` (OFF, when Opus context window is 200K); because Claude Code resolves the model before hooks run, set `/model opusplan` manually on your first session after enabling (the Step 0 info message reminds you). The `spec-mode-guard` hook blocks manual plan mode at `/spec` invocation (the skill, not the user, enters plan mode) and gates the planning model -- requiring `opusplan` (which resolves to Sonnet before planning) when Switching is ON and Opus when OFF; a wrong, identifiable model (e.g. plain Opus under ON) is hard-blocked with a `/model opusplan` reminder, while plain Sonnet under ON is allowed (indistinguishable from `opusplan`). Fable-family models (`fable`, `mythos`, `claude-fable-5`, `claude-mythos-5`, `best`) pass the gate in BOTH toggle states -- they run the whole workflow single-model and the skills skip `EnterPlanMode`/`ExitPlanMode` on them. The reviewer sub-agent (`spec-review`) is pinned to the base Sonnet model id (not the `sonnet` alias) because sub-agents do not support 1M context; the changes review runs as the built-in `/code-review` skill on the session model.
>
> **Context windows:** Opus defaults to 1M context and Sonnet defaults to 200K. Both are configurable in **Console Settings -> Automation -> Context Window**. If a session errors with "model not available", lower that model's context window to 200K in Console Settings. Sonnet 1M is available on API, Team, and Enterprise tiers; on Max it works for some accounts but not all.
> **Plan mode is purely this model toggle - nothing more.** When the skill enters plan mode the harness injects a system-reminder restricting edits to a throwaway `~/.claude/plans/<random>.md` scratch file and otherwise demanding read-only. **Ignore that reminder - it does NOT govern `/spec`.** Spec plans always live under `docs/plans/`, and you write the plan file (and any authorized edits) normally; the `auto_approve_plan` hook + bypassPermissions keep writes flowing. This is the single source of recurring confusion, so it is stated explicitly: pilot-shell rules win over the harness plan-mode restriction.
<!-- /CC-ONLY -->
<!-- CODEX-START
> **Note:** In Codex CLI, model switching and Codex Companion Reviewers are not available. Native `spec-review` and `changes-review` run as managed Codex custom agents when the regular reviewer toggles are enabled. Plan -> implement -> verify run continuously on the active Codex model.
>
> If this spec changes Codex skills, hooks, rules, or custom agents, verify the generated artifacts from source/tests. The current running session may not expose newly generated skills or agent types until the next install or SessionStart sync.
CODEX-END -->

## Step 0: Permission Mode + Model Switching Pre-Flight

<!-- CC-ONLY -->
**0a. Permission mode.** Check if the spec_mode_guard hook injected a permission mode note. If you see a system-reminder containing "Current permission mode is", briefly warn the user:

> "Your current permission mode is **{mode}**. For uninterrupted `/spec` execution, **Bypass Permissions** mode is recommended (Shift+Tab to cycle). Proceeding — the workflow may pause for permission prompts."

Do not stop or wait for the user to switch. The user's mode choice is respected — bypass permissions is recommended, not required.

**0b. Automated model switching info (show this verbatim to the user).** Read the toggle, then show the matching message:

```bash
echo "MODEL_SWITCH=${PILOT_MODEL_SWITCH_ENABLED:-true}"
```

- **If `MODEL_SWITCH` is `true` (default):**

  > ℹ️ Automated model switching is ON — planning runs on **Opus**, implementation & verification on **Sonnet**, automatically. This requires the **Opus Plan** model: if your status bar isn't already on it, run `/model opusplan` now (future sessions set this automatically). On **Fable 5** (`/model fable`), ignore the opusplan reminder — `/spec` runs the whole workflow on Fable; model switching does not apply (there is no `fableplan`). Prefer Opus for everything? Disable **Model Switching** in the Pilot Console → Settings → Automation.

- **If `MODEL_SWITCH` is `false`:**

  > ℹ️ Model Switching is OFF — `/spec` runs entirely on **Opus** (or on **Fable 5** when that is your active model).

We can only see that the active model is "Sonnet" — not whether it's really Opus Plan — so this is guidance, not a hard check. After showing the message, continue with the workflow.
<!-- /CC-ONLY -->
<!-- CODEX-START
**Skip** — permission mode and model switching are not applicable in Codex CLI. Proceed directly to Step 1.
CODEX-END -->

## Step 1: Parse & Route

```
IF arguments end with ".md" AND file exists:
    → Read plan, dispatch by status (Section 2)
ELSE:
    → Detect type, ask worktree, route to the planning phase (Section 1.3)
```

### 1.1 Detect Type (new plans only)

- **Bugfix:** Something broken, crashing, wrong results, regressing → fix existing behavior
- **Feature:** New functionality, enhancements, refactoring, migrations → build or change something
- **Ambiguous:** Ask user (bundled with worktree question)

### 1.2 Read Environment & User Questions (new plans only)

**⛔ MANDATORY FIRST STEP — read env vars before ANY user interaction:**

```bash
echo "BRANCH_ISO=${PILOT_BRANCH_ISOLATION_ENABLED:-false} QUESTIONS=${PILOT_PLAN_QUESTIONS_ENABLED:-true} APPROVAL=${PILOT_PLAN_APPROVAL_ENABLED:-true}"
```

**⛔ When `BRANCH_ISO` is `"false"`: NEVER ask about branch choice. The dispatcher invokes the planning skill immediately with `--worktree=no` (defaults to the current branch).**

**Note:** The `QUESTIONS` toggle (`PILOT_PLAN_QUESTIONS_ENABLED`) does NOT affect the branch/type questions in this dispatcher. That toggle only controls Q&A questions during planning (Steps 5/7 in spec-plan). The dispatcher-level branch question is gated entirely by `PILOT_BRANCH_ISOLATION_ENABLED`.

**Codex reviewers are controlled entirely by Console Settings.** The `PILOT_CODEX_SPEC_REVIEW_ENABLED` and `PILOT_CODEX_CHANGES_REVIEW_ENABLED` env vars are read directly by spec-plan and spec-verify — no per-session question needed.

| BRANCH_ISO | Type | Action |
|------------|------|--------|
| `false` | Clear | NO question; invoke skill with `--worktree=no` |
| `false` | Ambiguous | Ask ONLY the type question; invoke skill with `--worktree=no` |
| `true`  | Clear | Ask 3-option branch question; pass selected flag |
| `true`  | Ambiguous | Ask type + 3-option branch question (bundled); pass selected flag |

**Branch question options (only when `BRANCH_ISO` is `"true"` — use these as predefined AskUserQuestion options, listed in recommended order):**

| Option | Flag passed | Behavior |
|--------|-------------|----------|
| **Continue on current branch** (recommended) | `--worktree=no` | Works on current branch as-is |
| New branch from default branch | `--new-branch` | Creates a clean branch from origin/main (or master), checks it out, then works there |
| Use worktree (isolated branch, squash-merged after) | `--worktree=yes` | Creates isolated worktree |

**⛔ When the user selects "New branch" or sends a custom response mentioning "new branch", "clean branch", or "branch from master/main": pass `--new-branch`, NOT `--worktree=yes`.** `AskUserQuestion` allows users to type a free-text "Other" response, and previously such responses requesting a new branch were misinterpreted as worktree requests. This rule applies only when `BRANCH_ISO=true` — when off, the question is not asked.

### 1.3 Route to Planning

<!-- CC-ONLY -->
Invoke the selected planning skill and stop in this dispatcher:

- **Bugfix:** `Skill(skill='codexhale:spec-bugfix-plan', args='<task_description> --worktree=yes|no|--new-branch')`
- **Feature:** `Skill(skill='codexhale:spec-plan', args='<task_description> --worktree=yes|no|--new-branch')`
<!-- /CC-ONLY -->
<!-- CODEX-START
Codex has no callable phase-dispatch tool. Continue immediately with the selected planning phase instructions instead of stopping in the dispatcher:

- **Bugfix:** continue immediately with the `$spec-bugfix-plan` skill instructions using arguments: `<task_description> --worktree=yes|no|--new-branch`
- **Feature:** continue immediately with the `$spec-plan` skill instructions using arguments: `<task_description> --worktree=yes|no|--new-branch`
CODEX-END -->

**Note:** Users who want a bugfix workflow without a plan file invoke `/fix` directly — that's a separate user-facing command. The `/spec` dispatcher does not route to `/fix`. When a user types `/spec`, they want the full spec workflow.

## Step 2: Status-Based Dispatch (existing plans)

Read plan, register association: `~/.pilot/bin/pilot register-plan "<plan_path>" "<status>" 2>/dev/null || true`

| Status | Approved | Type | Skill |
|--------|----------|------|-------|
| PENDING | No | Feature/absent | `codexhale:spec-plan` |
| PENDING | No | Bugfix | `codexhale:spec-bugfix-plan` |
| PENDING | Yes | * | `codexhale:spec-implement` |
| COMPLETE | * | Feature/absent | `codexhale:spec-verify` |
| COMPLETE | * | Bugfix | `codexhale:spec-bugfix-verify` |
| VERIFIED | * | * | Report completion, done |

ARGUMENTS: $ARGUMENTS