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
