---
description: Show the stored output of a finished codexhale job
argument-hint: '[<job_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" result $ARGUMENTS
```
Return stdout verbatim, including any `resume:` hints.