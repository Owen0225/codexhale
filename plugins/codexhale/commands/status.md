---
description: Show running and recent codexhale jobs for this repo
argument-hint: '[<job_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" status $ARGUMENTS
```
Return stdout verbatim.