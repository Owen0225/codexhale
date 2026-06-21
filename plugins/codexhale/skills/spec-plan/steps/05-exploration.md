## Step 5: Exploration

**Start from the Step 3 Workspace Scan — don't re-run `codegraph_context` with the same query.**

<!-- CODEX-START

### Codex Exploration Budget

For Codex, this budget overrides the broader exploration guidance below.

- Spend at most 6 expensive exploration calls before the first plan draft. Expensive calls are CodeGraph, Semble, web/doc lookups, GitHub search, and broad Grep. Direct reads of already-identified files are allowed but should stay scoped to files the plan will touch.
- For docs, rules, markdown, config, and UI-label changes, stop once the named files and one nearby pattern are verified. Do not run call graph or impact analysis.
- For runtime code changes, run callers/callees/impact only for shared public functions you already expect to modify. Do not enumerate every dependency just to make the plan look complete.
- If uncertainty remains after the budget, either ask one bundled question or document the assumption. Do not continue broad research before drafting the plan.
CODEX-END -->

#### 5.1: Review Step 3 scan output

The Workspace Scan in Step 3 already ran `codegraph_context(task=<task description>)` and (when applicable) a Semble pattern search. Re-read its structured output before any deeper exploration:

```
Entry points: [...]
Related symbols: [...]
Similar patterns: [...]
Greenfield?: [yes | no]
```

<!-- CC-ONLY -->
If the scan didn't fully cover the intent (concept-heavy, cross-cutting, debugging-style, or greenfield), broaden with `mcp__semble__search` using different phrasings or `mcp__semble__find_related` from a promising hit. Then proceed to 5.2.
<!-- /CC-ONLY -->
<!-- CODEX-START
If the scan did not identify candidate files, use one more targeted Semble search or ask one bundled question. If it did identify files, read those files and proceed to planning.
CODEX-END -->

<!-- CC-ONLY -->
#### 5.2: Deep dive with CodeGraph explore

After orienting, use `codegraph_search` to find specific symbol names, then:

```
codegraph_explore(query="SymbolA SymbolB relevant-file.ts")
```

This returns **full source code sections** from all relevant files in ONE call — replacing dozens of Read/Grep calls. Use specific symbol names (from search results), not natural language. Follow the call budget in the tool description.

#### 5.3: Systematic exploration

**Explore one area at a time (sequentially, not parallel).** Use CodeGraph and Semble as primary tools — Grep/Glob only for exact text patterns.

| Need                            | Tool                                                    |
| ------------------------------- | ------------------------------------------------------- |
| **Orient on the task**          | CodeGraph `codegraph_context(task=<description>)` — already done in Step 3 |
| **Deep understanding of code**  | CodeGraph `codegraph_search` → `codegraph_explore(query="<symbol names>")` |
| **Understand a feature by intent** | Semble `semble search "how does X work"` or `mcp__semble__search` |
| **Find symbols by name**        | CodeGraph `codegraph_search`                            |
| **Discover similar code from a hit** | Semble `semble find-related file.ts 42` or `mcp__semble__find_related` |
| **Extract enclosing block at `file:line`** | `Read` with `offset`/`limit`, or `codegraph_node` (by symbol name) |
| **Project file structure**      | CodeGraph `codegraph_files`                             |
| **Call tracing**                | CodeGraph `codegraph_callers`/`codegraph_callees`       |
| **Library/framework docs**      | Context7                                                |
| **Real-world GitHub examples**  | grep-mcp                                                |
| **Exact text/regex**            | Grep/Glob (last resort)                                 |

**Areas (in order):** Architecture → Similar Features → Dependencies → Tests
<!-- /CC-ONLY -->
<!-- CODEX-START
#### 5.2: Codex focused exploration

Read the concrete files the plan will touch and one nearby test or pattern file when available. Use one additional `codegraph_explore`, `mcp__semble__find_related`, or exact-text search only when a target file remains unclear.

**Areas (in order):** target behavior -> target files -> tests. Skip broad architecture surveys unless the user requested an architectural change.
CODEX-END -->

<!-- CC-ONLY -->
#### 5.4: Dependency analysis (MANDATORY for 3+ file changes)

For every function you plan to modify: (1) `codegraph_callers` + `codegraph_callees` for the call graph, (2) `Grep` for the symbol name to catch callers the graph may miss, (3) `codegraph_impact` to assess blast radius. CodeGraph gives structure; Grep gives completeness — use both.
<!-- /CC-ONLY -->
<!-- CODEX-START
#### 5.4: Dependency analysis (Codex scoped)

Run dependency analysis only for runtime functions/classes whose behavior will change and whose callers are not obvious from the files already read. Skip this step for docs, rules, config, markdown-only, generated text, and UI-copy changes.
CODEX-END -->

For each area: document hypotheses, note full file paths, track unanswered questions. After exploration: read identified files to verify hypotheses, build complete mental model, identify integration points, note reusable patterns.
