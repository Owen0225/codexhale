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
