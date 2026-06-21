## Step 3: Code Review & Re-Verify

<!-- CC-ONLY -->
**If `PILOT_CHANGES_REVIEW_ENABLED` is `"false"` (from Step 0),** skip the inline `/code-review` below. If the codexhale debate review was launched in Step 1, still run its collection sub-step — then proceed to Step 4 (Phase B). If neither reviewer is enabled, skip this step entirely.

**When enabled — mandatory. Never skip** — even if you're confident, context is high, or tests pass.

#### Run /code-review (inline — AFTER the Step 2 automated checks are green)

Resolve the configured effort first, fail-closed to `xhigh` for an unset/invalid value (never pass the raw env var straight through):

```bash
EFFORT="${PILOT_CODE_REVIEW_EFFORT:-xhigh}"
case "$EFFORT" in low|medium|high|xhigh|max) ;; *) EFFORT=xhigh ;; esac
echo "$EFFORT"
```

Then invoke the built-in code review skill at that effort (substitute the resolved `<EFFORT>`):

```
Skill(skill='code-review', args='<EFFORT>')
```

- Execute the loaded review protocol fully (finder angles → verify → sweep). Do NOT pass `--fix` — findings are applied by this orchestrator (below), not by the review.
- The default scope (branch commits ahead of upstream + uncommitted changes) is correct for a clean worktree or branch. **If the working tree carries unrelated dirty files, pass the plan's files AS THE TARGET in the Skill args** — `Skill(skill='code-review', args='<EFFORT> <file1> <file2> …')` with the paths from the plan's `Files:` blocks — so the review protocol itself scopes its diff (`git diff HEAD -- <those paths>`); prose-level scoping outside the args does NOT bind the review and risks spending the capped findings on unrelated files. ⛔ Do NOT use a bare ref-range like `main...HEAD` to narrow a dirty tree — ref-ranges cover committed work only and would scope AWAY the spec's uncommitted changes.
- Output: a ranked JSON array of findings `{file, line, summary, failure_scenario}` — most severe first, no severity labels.
- **If the `code-review` skill is unavailable (older Claude Code version) or the invocation errors:** do NOT silently proceed as if reviewed. Record the gap explicitly in the Step 3 report and the Step 6.2 Not-Verified table, and rely on the Step 2.2 audit results for this iteration.

#### Apply /code-review Findings (severity → action)

**Fix automatically — no user permission needed.** **Lineage is evaluated FIRST:** a finding on a file outside the spec's lineage — the plan's `Files:` blocks plus files legitimately touched as documented deviations — is mention-only regardless of severity (out-of-lineage crashes are reported, never auto-fixed). Only in-lineage findings are classified by the remaining rows:

| Finding class | Action |
|---------------|--------|
| Finding on a file OUTSIDE the spec's lineage (CHECK FIRST — overrides all rows below) | **Mention-only — do NOT fix** (mirrors the pre-existing-issue rule) |
| `failure_scenario` names a concrete crash, wrong output, security, or data-integrity problem | **must_fix** — fix immediately |
| Cleanup / efficiency / altitude finding (duplication, wasted work, maintainability), single-site | **should_fix** — fix immediately |
| Cleanup finding that would expand scope (3+ files, architectural) | **suggestion** — implement if quick, else mention in the report |

Rank order is the tiebreaker within a class. For each fix: implement → run relevant tests → log "Fixed: [title]"

#### Collect codexhale debate review (if launched)

When the background debate-review task completes, read its printed Markdown report. The
`## Verdict` line states `clean` or `BLOCKING`; each finding carries a status tag
(`agreed` / `disputed` / `refuted` / `uncontested`). Feed them into the SAME
severity -> action + lineage-first fix queue used for the inline /code-review findings above:

- `agreed` critical/high -> must_fix (fix now)
- `agreed` medium -> should_fix (fix now)
- `disputed` / `refuted` / `uncontested` -> mention; surface at the Step 10 gate; do not auto-fix
- out-of-lineage findings -> mention-only (the lineage-first rule above applies)

Do NOT loop debate-review here. If unresolved `agreed` critical/high findings remain, the
existing outer loop (Step 11: Status -> PENDING -> codexhale:spec-implement -> re-verify)
re-runs verify (and thus debate-review) on the post-fix diff, capped at 3 iterations. A
`degraded` verdict (one model unavailable) is a warning, not treated as a full debate.

**Report:**
```
## Code Verification Complete
**Issues Found:** X
### Goal Achievement: N/M truths verified   (from the Step 2.2 Plan Compliance & Goal-Truth Audit)
### Must Fix (N) | Should Fix (N) | Suggestions (N) | Out-of-lineage mentions (N)
```

#### Re-verification (Only for Structural Fixes)

**Skip** when fixes were localized (terminology, error handling, test updates, minor bugs). Run tests + lint to confirm, proceed to Phase B.

**Re-verify** when fixes required new functionality, changed APIs, or significant new code paths: re-run the Step 2.2 Plan Compliance & Goal-Truth Audit on the post-fix diff (fixes can break mitigations or truths), then re-run the inline review SCOPED to the files the fixes touched — pass them as the target: `Skill(skill='code-review', args='<EFFORT> <fixed files>')` (same resolved `<EFFORT>` as the first run) — rather than the whole spec diff. Max 2 iterations before adding remaining issues to plan.
<!-- /CC-ONLY -->
<!-- CODEX-START
**If `PILOT_CHANGES_REVIEW_ENABLED` is `"false"` (from Step 0 — Step 1 was skipped),** skip this step entirely and proceed to Step 4 (Phase B).

**When enabled — mandatory. Never skip.** Read the `changes-review` agent id captured in Step 1 from working notes or the session file:

```bash
AGENT_ID_FILE="$HOME/.pilot/sessions/${PILOT_SESSION_ID:-default}/changes-review-agent-id-<plan-slug>.txt"
```

If `CHANGES_REVIEW_AGENT_ID` is missing and the file exists, read the file and use its trimmed contents. If both are missing or empty, re-launch `changes-review` once using the Step 1 prompt, persist the new id to the file, then continue. Do not silently skip review while `PILOT_CHANGES_REVIEW_ENABLED` is enabled.

Wait for the final result:

```python
result = multi_agent_v1.wait_agent(targets=[CHANGES_REVIEW_AGENT_ID], timeout_ms=600000)
```

Parse the agent's final message as JSON. If parsing fails, treat the raw final message as one `suggestion` finding and continue; do not re-launch on parse failure.

Validate `plan_file` matches the current plan. If it does not, discard the stale result and self-review the diff before proceeding.

Severity mapping:
- `must_fix` → fix immediately
- `should_fix` → fix immediately
- `suggestion` → implement if quick

For each fix: implement → run relevant tests → log `Fixed: [title]`.

After all findings are handled, re-run the relevant automated checks from Step 2 before proceeding to Step 4.
CODEX-END -->
