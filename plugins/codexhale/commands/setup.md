---
description: Check codewhale + codex readiness and manage the review gate
argument-hint: '[--enable-review-gate|--disable-review-gate]'
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(codewhale:*), Bash(codex:*), Bash(npm:*)
---
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codexhale-companion.mjs" setup $ARGUMENTS
```
Return stdout verbatim. If codewhale is missing and npm is available, offer to run `npm i -g codewhale`. If codex is missing, suggest `npm i -g @openai/codex` then `!codex login`.