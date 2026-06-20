---
description: Run a steerable dual-model adversarial review challenging the implementation and design
argument-hint: '[--wait|--background] [--base <ref>] [focus text...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a steerable adversarial review through CodeWhale and Codex in parallel.

Raw slash-command arguments:
`$ARGUMENTS`

Same execution-mode rules as `/codexhale:review` (estimate size, then `AskUserQuestion` once with recommended option first). The flags `--wait`/`--background`/`--base` are parsed by the companion; everything after the flags is focus text passed to both models.

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" adversarial-review $ARGUMENTS
```
Return stdout verbatim. Do not fix issues.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" adversarial-review $ARGUMENTS`,
  description: "Codexhale adversarial review",
  run_in_background: true
})
```
After launching, tell the user to check `/codexhale:status`.