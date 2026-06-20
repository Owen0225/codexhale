---
description: Delegate an implementation/debugging task to CodeWhale (DeepSeek)
argument-hint: '[--background|--wait] [--model <m|fin>] [--resume|--fresh] <task text>'
disable-model-invocation: true
allowed-tools: Bash(node:*), AskUserQuestion
---

Delegate a task to CodeWhale via the codexhale-rescue subagent.

Raw slash-command arguments:
`$ARGUMENTS`

Prefer invoking the `codexhale-rescue` subagent (Task tool) to forward the request. The subagent runs:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" rescue $ARGUMENTS
```
Notes:
- `--model fin` maps to `deepseek-v4-flash` (cheap/fast tier).
- `--resume` (bare) continues the most recent CodeWhale session for this repo; `--resume <id>` resumes a specific session; `--fresh` starts clean.
- Open-ended multi-step tasks (implement/refactor/add tests/fix bug) default to background.
Return the companion stdout verbatim.