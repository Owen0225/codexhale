---
description: Run a dual-model (CodeWhale + Codex) code review against local git state
argument-hint: '[--wait|--background] [--base <ref>] [--scope auto|working-tree|branch]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a dual-model code review through CodeWhale and Codex in parallel, then merge findings.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only. Do not fix issues or apply patches.
- Your only job is to run the review and return the merged report verbatim.

Execution mode rules:
- If the raw arguments include `--wait`, run in the foreground.
- If the raw arguments include `--background`, run in a Claude background task.
- Otherwise, estimate review size first: run `git status --short --untracked-files=all`, `git diff --shortstat`, and `git diff --shortstat --cached` (or `git diff --shortstat <base>...HEAD` for `--base`). Only recommend waiting for clearly tiny changes (1-2 files). In every other case recommend background.
- Then use `AskUserQuestion` exactly once with two options, recommended first suffixed with `(Recommended)`:
  - `Wait for results`
  - `Run in background`

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" review $ARGUMENTS
```
Return the command stdout verbatim. Do not paraphrase or add commentary.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" review $ARGUMENTS`,
  description: "Codexhale dual-model review",
  run_in_background: true
})
```
After launching, tell the user: "Dual-model review started in the background. Check `/codexhale:status` for progress."