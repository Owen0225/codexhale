---
name: spec-verify
description: "Spec verification phase - tests, execution, rules audit, code review"
argument-hint: "<path/to/plan.md>"
user-invocable: false
---

# /spec-verify - Verification Phase

**Phase 3 of the /spec workflow (features).** Runs comprehensive verification: automated checks, code review, program execution, and E2E tests. For bugfix plans, use `codexhale:spec-bugfix-verify` instead.

**Input:** Plan file with `Status: COMPLETE`
**Output:** Plan status → VERIFIED (success) or loop back to implementation (failure)

---

## ⛔ KEY CONSTRAINTS

<!-- CC-ONLY -->
1. **Run code review when enabled** — Step 3 runs the built-in `/code-review` skill at the configured effort (`$PILOT_CODE_REVIEW_EFFORT`, default `xhigh`; resolved and allow-listed in Step 3) when `PILOT_CHANGES_REVIEW_ENABLED` is not `"false"` (read in Step 0). It runs inline in the main session AFTER the Step 2 automated checks; the optional codexhale debate review (Step 1) is the only early background launch. To disable, use Console Settings → Reviewers → Changes Review toggle; the effort is set in Console Settings → Spec Workflow → Code Review Effort.
2. **NEVER launch reviewer sub-agents during verification** — Do NOT launch `spec-review` or `changes-review` via the Agent tool; on Claude Code the review mechanism is the inline `/code-review` skill. Do NOT read or reference `findings-spec-review-*.json` or `findings-changes-review-*.json` files — they are stale artifacts (planning phase / older Pilot versions). If you encounter one, **ignore it completely**.
<!-- /CC-ONLY -->
<!-- CODEX-START
1. **Run native Codex changes review when enabled** — Step 1 launches the managed `changes-review` custom agent via `multi_agent_v1.spawn_agent` when `PILOT_CHANGES_REVIEW_ENABLED` is not `"false"` (read in Step 0). Step 3 waits for and applies its findings.
2. **Only changes-review — NEVER spec-review** — Do NOT launch `spec-review` during verification. Planning findings are stale artifacts from the planning phase and must be ignored.
CODEX-END -->
3. **NO stopping** — Everything automatic. Never ask "Should I fix these?"
4. **Fix ALL findings** — must_fix AND should_fix. No permission needed.
5. **Code changes finish BEFORE runtime testing** — Phase A then Phase B.
6. **Plan file is source of truth** — re-read it after auto-compaction, don't rely on conversation memory.
7. **Re-verification after fixes is MANDATORY** — fixes can introduce new bugs.
8. **Quality over speed** — never rush due to context pressure.
