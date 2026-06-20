---
description: Cancel an active background codexhale job
argument-hint: '[<job_id>]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" cancel $ARGUMENTS
```
Return stdout verbatim. If the job was running in a Claude background task, also stop it via /tasks.