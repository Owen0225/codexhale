---
name: add-new-library-module-with-tests
description: Workflow command scaffold for add-new-library-module-with-tests in codex-codewhale-cc.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /add-new-library-module-with-tests

Use this workflow when working on **add-new-library-module-with-tests** in `codex-codewhale-cc`.

## Goal

Implements a new library module (feature) and its corresponding test file.

## Common Files

- `plugins/codexhale/scripts/lib/*.mjs`
- `tests/*.test.mjs`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create or update a file in plugins/codexhale/scripts/lib/*.mjs implementing the feature.
- Create or update a corresponding test file in tests/*.test.mjs.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.