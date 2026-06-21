## Step 2: Automated Checks

Run all mechanical checks in sequence. Fix any failures before proceeding.

1. **Full test suite** — `uv run pytest -q` / `bun test` / `npm test`. Fix failures immediately.
2. **Type checker** — `basedpyright` / `tsc --noEmit`. Zero errors required.
3. **Linter** — `ruff check` / `eslint`. Errors are blockers, warnings acceptable.
4. **Coverage** — If the project already has coverage tooling, or the task touches critical paths (business logic, security, data integrity, error handling), run the existing coverage command and inspect the report. **No blanket numeric gate.** If a critical path's coverage or explicit behaviour coverage dropped vs main, fix it. Glue/CRUD/UI-binding files are not gated, and do not add coverage tooling just to satisfy this step.
5. **Test Parsimony Audit** — For each task whose `Files:` block adds new test files, group new test classes by production class/entry point and count only classes added by this task. If any production class has more than 2 new test classes (1 unit + 1 functional/integration) AND the task does not declare a `Why >2 test classes:` note in Key Decisions, flag as **must_fix** and return to spec-implement. Also scan new test files for: (i) per-method test classes (e.g. `DoSomethingTests` for class `Foo` with method `DoSomething`) — flag as **must_fix**; (ii) two or more tests asserting the same observable behaviour through different internal paths — flag as **should_fix**. On Codex, the `changes-review` reviewer does the same audit independently in Phase A; this step is the verifier's first pass.

   **2.1. `Trivial:` claim audit** — For every plan task that declares a `Trivial:` justification, run `git diff <base>..HEAD -- <task's Files: block>` and check the production-code diff against the four parsimony criteria. Flag **must_fix** if any of the following hold:
   - the `Trivial:` field does not name an existing covering test or verification command, OR
   - net added lines of production code > 5 (excluding pure import lines, blank lines, and comment-only lines), OR
   - the diff introduces a new control-flow construct with a non-trivial body — `if/elif/else`, `match`, `for`/`while` loop, `try/except` (a one-line guard like `if x is None: return None` is NOT non-trivial; a multi-line block is), OR
   - the diff adds a new public symbol (function name not starting with `_`, class name not starting with `_`, module-level constant exported via `__all__`), OR
   - the diff adds a new error path (raises a new exception type, returns a new error sentinel, calls `logger.error`/`logger.warning` that did not exist).

   When flagged, the implementer must: remove the `Trivial:` field from the task, write a real RED test, and re-implement the task per the standard TDD loop. This audit is the post-implementation guardrail against the `Trivial:` field being abused to skip TDD; the planner's pre-implementation claim is not authoritative.

<!-- CC-ONLY -->
   **2.2. Plan Compliance & Goal-Truth Audit (ALWAYS runs — not conditional on item 5's new-test-files scope)** — On Claude Code, the inline `/code-review` skill (Step 3) hunts bugs and cleanups only — it does NOT read the plan. This audit replaces the compliance (§2), test-quality (§3), and goal-achievement (§4) passes the retired `changes-review` subagent performed. Its findings feed the same fix loop and report counts as the Step 3 review findings (fix → test → log "Fixed:"), and any **must_fix** loops back to spec-implement per Step 11. Walk the plan once:

   - **Per task:** (a) every file in the task's `Files:` block exists or was modified in the diff (`git diff --name-only` + `git status --short`) and is non-stub (no bare `pass` / `return None` placeholder / `NotImplementedError` / empty render bodies) — a missing or unmodified planned file is a **must_fix** (unimplemented task); (b) every mitigation committed in the plan's Risks table is evidenced in code; (c) every DoD criterion has diff or command evidence. Missing mitigation → **must_fix**; mitigation present but untested or DoD criterion unevidenced → **should_fix**.
   - **Test-quality floor:** a new public class in the diff with no test (unit OR functional) → **must_fix**; a new public function on an existing class with no test AND no `Trivial:` justification → **should_fix**; unit tests added by the diff that exercise subprocess / network / file-I/O without mocking → **must_fix** (the #1 cause of CI-only failures).
   - **User-request check:** the final diff still serves the ORIGINAL user request that invoked `/spec` — not just the latest plan edit (verify-loop plan mutations can drift from intent). Drift → **must_fix**.
   - **Goal-truth audit:** for each truth in the plan's `## Goal Verification` section (when present), confirm evidence in the diff or via targeted Grep; mark **verified / failed / uncertain**. Any **failed** truth is a **must_fix** that loops back to spec-implement. Record the N/M verified count — the Step 3 and Step 11 reports cite it as "Goal Achievement: N/M truths verified".
<!-- /CC-ONLY -->
6. **Build** — Clean build, zero errors.
7. **File length** — Changed production files (non-test): >800 lines consider splitting, >1000 flag for review.
8. **Plan verify commands** — For each task's `Verify:` section, run each command wrapped in `timeout 30 <cmd> || echo 'TIMEOUT'`. Defer server-dependent commands (containing `curl`, `localhost`, `http://`, browser automation) to Phase B.
9. **Performance audit** — For each changed file on a hot path (UI render, request handler, polling loop, CLI inner loop): is expensive work (parsing, serialization, I/O, dependency loading) cached/memoized? Are heavy dependencies imported fully when lighter alternatives exist? Does repeated invocation redo work when input hasn't changed? **This is a static code review — no running program needed.** Performance issues from missing caching are structural and visible in the source.
10. **Feature Parity Check (migration/refactoring only)** — Skip unless the plan has a `## Feature Inventory` section.
    1. Compare old vs new implementation
    2. Verify each feature exists in new code
    3. Run new code and verify same behavior

    <!-- CC-ONLY -->
    **If features are MISSING:** Run the iteration-cap check from Step 11 first (read `Iterations:` from the plan header; if `>= 3` ask the user Continue / Pivot / Abandon before incrementing). On Continue: add tasks with `[MISSING]` prefix, set `Status: PENDING`, increment `Iterations`, register status change, invoke `Skill(skill='codexhale:spec-implement', args='<plan-path>')`.
    <!-- /CC-ONLY -->
    <!-- CODEX-START
    **If features are MISSING:** Run the iteration-cap check from Step 11 first (read `Iterations:` from the plan header; if `>= 3` present the user with Continue / Pivot / Abandon options before incrementing). On Continue: add tasks with `[MISSING]` prefix, set `Status: PENDING`, increment `Iterations`, register status change, then continue immediately with the `$spec-implement` skill instructions using arguments: `<plan-path>`.
    CODEX-END -->
