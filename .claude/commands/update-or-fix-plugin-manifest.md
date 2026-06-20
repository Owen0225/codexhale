---
name: update-or-fix-plugin-manifest
description: Workflow command scaffold for update-or-fix-plugin-manifest in codex-codewhale-cc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /update-or-fix-plugin-manifest

Use this workflow when working on **update-or-fix-plugin-manifest** in `codex-codewhale-cc`.

## Goal

Creates or corrects the plugin manifest for installability or schema compliance.

## Common Files

- `plugins/codexhale/.claude-plugin/plugin.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or update plugins/codexhale/.claude-plugin/plugin.json with correct schema fields.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.