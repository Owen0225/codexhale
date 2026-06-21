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
