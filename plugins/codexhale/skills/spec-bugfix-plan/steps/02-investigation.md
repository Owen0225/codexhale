## Step 2: Root Cause Investigation

Complete each sub-step before the next. No shortcuts.

<!-- CODEX-START
### Codex Investigation Budget

For Codex, keep investigation proportional:

- Do not exceed 6 expensive investigation calls before drafting the plan. Expensive calls are CodeGraph, Semble, broad Grep, web/doc lookup, and full-file reads beyond the suspected files.
- If the bug is local after reproduction (wrong constant, null check, typo, one renderer label, one config value), use targeted reads and skip deep graph exploration.
- If two reproduction attempts fail because input, command, stack trace, or environment is missing, ask one bundled plain-text clarification prompt and stop guessing.
- If three hypotheses fail, stop and ask for the missing signal instead of continuing another search loop.
CODEX-END -->

### 2.1 Reproduce & understand

- Restate **symptom** (what user observes), **trigger** (when/how), **expected behaviour**.
- Vague? One focused `AskUserQuestion`.
- Reliable repro? Steps?
- **Not reproducible after 2 attempts:** STOP guessing. `AskUserQuestion` for the missing signal — exact command, input, environment, stack trace, or recording.
- **Intermittent (flaky / race):** trigger 10+ times, record state at failure. Flaky bugs need a test that **forces** the race (deterministic ordering, frozen clock, blocked event loop), not one that hopes to hit it.

### 2.2 Recent changes

- `git log --oneline -10 -- <file>`, `git diff` for the obvious suspects.
- **A specific token appeared/disappeared?** `git log -S "<string>" -- <path>` (added/removed). Regex: `git log -G "<pattern>"`. Faster than bisect when correlated with a symbol.
- New deps, config changes, env differences?

### 2.3 Trace the root cause

<!-- CC-ONLY -->
**Start with `codegraph_context(task="<bug description and symptoms>")`** — single call, returns entry points, related symbols, and code context. Then `mcp__semble__search` for the bug's *intent* ("where does X get modified", "error handling in Y") — catches cross-language connections and mutation sites the graph misses.
<!-- /CC-ONLY -->
<!-- CODEX-START
Use `codegraph_context(task="<bug description and symptoms>")` only when the bug location is not already named and the problem appears to involve runtime-code structure. Add one `mcp__semble__search` only when CodeGraph is weak or the bug is cross-cutting. If the user names concrete paths, docs, rules, markdown, config, UI copy, or the symptom points to a specific file, read that file instead of spending a graph call.
CODEX-END -->

<!-- CC-ONLY -->
**Deep dive when needed:** `codegraph_search` to find a specific symbol, then `codegraph_explore(query="<symbol names>")` for full source. Use `mcp__semble__find_related` from the bug site to discover parallel implementations that may share the same flaw.
<!-- /CC-ONLY -->
<!-- CODEX-START
Deep dive only when the root-cause candidate remains unclear after targeted reads. Use one focused `codegraph_explore`, `mcp__semble__find_related`, or exact-text search, then return to the root-cause statement.
CODEX-END -->

**Backward tracing (symptom → source):**

1. Find where the wrong behaviour appears — note `file:line`.
2. `codegraph_callers` traces what called this with the bad value/state.
3. Keep tracing until you find the **source** where the bad data originates.
4. **Fix at the source, not where the error appears.**

**Multi-component systems — instrument at boundaries before concluding:**

```bash
# Layer 1: entry point
echo "=== enter handler — input: ==="
echo "$INPUT"

# Layer 2: business logic
echo "=== leave handler / enter service — payload: ==="
jq . <<< "$PAYLOAD"

# Layer 3: storage
echo "=== query result: ==="
psql -c "SELECT id, status FROM jobs WHERE id=$JOB_ID"
```

This reveals **which** layer breaks. Investigate that layer next — don't speculate across layers.

**⛔ Mark every temporary log/print with `SPEC-DEBUG:`** (e.g. `console.log("SPEC-DEBUG: filters=", filters)`, `# SPEC-DEBUG: print(x)`). Verification greps the diff for this marker — any match fails verification and forces cleanup. Only way temporary diagnostics are allowed in the fix diff.

**Structural tracing — proportional to bug scope.** For bugs spanning 2+ files, modules, or components, run `codegraph_callers` + `codegraph_callees` on the root-cause function plus `codegraph_impact` for blast radius. For local bugs (typo, off-by-one, wrong constant in one function, missing null check at one call site), `codegraph_context` from above plus a targeted Read is enough — skip the full call-graph traversal.

<!-- CODEX-START
Codex override: skip callers/callees/impact for docs, rules, markdown, UI-copy, single-file parser, or single-file config bugs unless the call path itself is the suspected failure.
CODEX-END -->

Tools: CodeGraph, Semble (`semble search`/`semble find-related` or `mcp__semble__search`/`mcp__semble__find_related`), Read/Grep/Glob for exact patterns.

### 2.4 Pattern analysis

1. Find **working examples** — similar code in the codebase that works correctly.
2. Compare: what's different between working and broken?
3. List every difference — don't assume "that can't matter".

### 2.5 Root cause statement

State clearly:

- **Root cause:** `file/path.py:lineN` — `function_name()` does X but should do Y
- **Why:** WHY it causes the symptom (not just what is wrong)
- **Confidence:** High (traced fully) / Medium (strong hypothesis) / Low (needs more data)

Low confidence → gather more evidence. Don't guess.

**Escalation:** if 3+ hypotheses have failed, this is likely architectural. STOP and `AskUserQuestion` before continuing.
