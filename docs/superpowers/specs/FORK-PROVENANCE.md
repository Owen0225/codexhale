# Fork provenance: vendored Pilot spec chain

The `plugins/codexhale/skills/{spec,spec-plan,spec-bugfix-plan,spec-implement,spec-verify,spec-bugfix-verify}/`
directories are a **namespaced fork** of the global Pilot skills at `~/.claude/skills/`.

- **Forked on:** 2026-06-20
- **Source:** `~/.claude/skills/` (Pilot install)
- **Skill manifest version at fork time:** `1` (all six)
- **Invoked as:** `/codexhale:spec` (plugin namespace; the global `/spec` is untouched).

## The only intended delta from upstream

1. **Namespacing:** every inter-chain `Skill(skill='spec-*')` call and every dispatch-table
   reference to a phase skill is rewritten to `codexhale:spec-*`. `Skill(skill='code-review')`
   stays bare (it is the global built-in, not part of the fork).
2. **Behavior change (2 skills only):**
   - `spec-verify`: the optional Codex companion review (Step 1 launch + Step 3 collect) is
     replaced by a call to the codexhale `debate-review` subcommand, feeding the existing
     fix queue. The inline `/code-review` is untouched.
   - `spec-bugfix-verify`: an additive `debate-review` step (it had no Codex block).

The other four forks (`spec`, `spec-plan`, `spec-bugfix-plan`, `spec-implement`) differ from
upstream ONLY by the namespacing.

## Re-syncing after a Pilot update

Run `plugins/codexhale/scripts/check-fork-drift.sh` to see divergence from the current global
skills (ignoring the intended namespacing delta). To re-sync the four namespace-only forks:
re-copy from `~/.claude/skills/` and re-apply the namespacing (`spec-*` -> `codexhale:spec-*`,
excluding `code-review`). Re-apply the `spec-verify` / `spec-bugfix-verify` debate edits by hand
(they are small and documented in the implementation plan).
