## Phase A — Finalize the Code

## Step 1: Early Background Review Launch

### 1a: Clean Up Stale Review Findings (always run, before any launch)

**Always run this first** — regardless of whether changes-review is enabled. Spec-review findings are stale artifacts from the planning phase that were already addressed during implementation; changes-review findings files are legacy artifacts from older Pilot versions (transitional cleanup — remove the second line once pre-migration installs are gone):

```bash
SESS_DIR="$HOME/.pilot/sessions/${PILOT_SESSION_ID:-default}"
test -d "$SESS_DIR" && find "$SESS_DIR" -maxdepth 1 -name 'findings-spec-review-*.json' -delete
test -d "$SESS_DIR" && find "$SESS_DIR" -maxdepth 1 -name 'findings-changes-review-*.json' -delete
```

---

<!-- CC-ONLY -->
**No native reviewer launch on Claude Code.** The code review runs INLINE in Step 3 via the built-in `/code-review` skill at the configured effort (`$PILOT_CODE_REVIEW_EFFORT`, default `xhigh`; resolved and allow-listed in Step 3) — there is no subagent to launch early and no findings file to derive. The only launch in this step is the optional codexhale debate review below.

#### Codexhale debate review (Optional - launch NOW, in the background)

**If `PILOT_CODEX_CHANGES_REVIEW_ENABLED` is `"true"` (from Step 0):**

Launch the codexhale debate review NOW - it runs CodeWhale + Codex (read-only) plus a
cross-rebuttal in the background while you run the Step 2 automated checks and the Step 3
inline review. It is ONE round per verify pass; the existing outer loop (Step 11) provides
the multi-round, so do NOT loop it here.

```
Bash(
  command="node \"${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs\" debate-review --base ${BASE_REF:-main}",
  run_in_background=true,
  timeout=900000
)
```

The subcommand prints a Markdown report ending in a `## Verdict` line (`clean` or `BLOCKING`);
collect it in Step 3. A `degraded` verdict means one model was unavailable - surface it as a
warning, not a full debate. **Do NOT wait** - proceed to Step 2 immediately.
<!-- /CC-ONLY -->
<!-- CODEX-START
**If `PILOT_CHANGES_REVIEW_ENABLED` is `"false"` (from Step 0),** skip the rest of this step and proceed directly to Step 2 (Automated Checks).

**When enabled:** launch the managed Codex custom agent immediately. It runs while automated checks execute in Step 2.

Gather context first:

```bash
git status --short
```

Collect: changed files list, runtime environment info, test framework constraints, and plan risks section. Derive the plan slug from the plan filename by stripping the date prefix and `.md`.

Persist the returned agent id so Step 3 can survive long checks or compaction. Use a deterministic session file:

```bash
SESS_DIR="$HOME/.pilot/sessions/${PILOT_SESSION_ID:-default}"
AGENT_ID_FILE="$SESS_DIR/changes-review-agent-id-<plan-slug>.txt"
mkdir -p "$SESS_DIR"
```

```python
review = multi_agent_v1.spawn_agent(
    agent_type="changes-review",
    message="""
    Plan file: <plan-path>
    User request: <original task description that invoked $spec>
    Changed files: [file list]
    Runtime environment: [how to start, port, deploy path]
    Test framework constraints: [what it can/cannot test]

    Review implementation: compliance, quality, and goal achievement.
    Return ONLY valid JSON matching the changes-review schema.
    Include the plan file path in the `plan_file` field.
    """,
)
CHANGES_REVIEW_AGENT_ID = review.agent_id
```

After spawning, write `CHANGES_REVIEW_AGENT_ID` to `$AGENT_ID_FILE`.

Do NOT wait here. Proceed directly to Step 2.

Self-review the implementation diff before proceeding: `git diff --stat` to verify scope matches the plan, and spot-check changed files for obvious issues (security, missing error handling, dead code).
CODEX-END -->
