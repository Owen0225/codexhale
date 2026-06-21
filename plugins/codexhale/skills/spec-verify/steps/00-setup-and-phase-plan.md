## Step 0: Setup, Process Overview, & Runtime Classification

### 0.1 Read Toggle Configuration

**Run first, before any other step.** Read the reviewer toggle env vars:

<!-- CC-ONLY -->
```bash
echo "REVIEWER=$PILOT_CHANGES_REVIEW_ENABLED CODEX_CHG=$PILOT_CODEX_CHANGES_REVIEW_ENABLED EFFORT=$PILOT_CODE_REVIEW_EFFORT"
```

Codex reviewers are controlled entirely by Console Settings — the env vars are authoritative. `EFFORT` is the configured `/code-review` effort (default `xhigh` when unset/invalid; allow-listed at the point of use in Step 3).

Reference these values in Steps 1 (codexhale debate review launch) and 3 (inline /code-review + debate review collection).
<!-- /CC-ONLY -->
<!-- CODEX-START
```bash
echo "REVIEWER=$PILOT_CHANGES_REVIEW_ENABLED"
```

Native Codex changes review is controlled by the regular reviewer toggle. Reference this value in Steps 1 and 3.
CODEX-END -->

### 0.2 Process Overview

<!-- CC-ONLY -->
```
Phase A — Finalize the code:
  Launch codexhale debate review (if enabled) → Automated Checks (tests + lint + verify commands + Plan Compliance & Goal-Truth Audit) → Feature Parity (if migration) → /code-review (configured effort) + Collect codexhale debate review → Fix

Phase B — Verify the running program (depth depends on runtime profile):
  Build → Program Execution → Per-Task DoD Audit → E2E

Final:
  Regression check → Worktree sync → Post-merge verification → Update status
```
<!-- /CC-ONLY -->
<!-- CODEX-START
```
Phase A — Finalize the code:
  Launch Reviewer → Automated Checks (tests + lint + verify commands) → Feature Parity (if migration) → Collect Review Results → Fix

Phase B — Verify the running program (depth depends on runtime profile):
  Build → Program Execution → Per-Task DoD Audit → E2E

Final:
  Regression check → Worktree sync → Post-merge verification → Update status
```
CODEX-END -->

### 0.3 Classify Runtime Profile

**Determine verification depth based on what changed:**

| Profile | Criteria | Phase B Scope |
|---------|----------|---------------|
| **Minimal** | No server, no UI, no built artifacts (libraries, CLI tools, hooks, scripts) | Build check only |
| **API** | Server/API but no frontend changes | Build + program execution + DoD audit. Skip E2E. |
| **Full** | Frontend/UI changes or complex deployment | All Phase B steps |

Read the plan's Runtime Environment section (if present) and the changed file types to classify.
