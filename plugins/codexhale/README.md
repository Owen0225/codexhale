# codexhale — CodeWhale + Codex plugin for Claude Code

Dual-model adversarial code review and cheap task delegation. CodeWhale (DeepSeek, high cache hit rate) and Codex (OpenAI) review your changes in parallel; implementation tasks delegate to CodeWhale.

## Requirements
- `codewhale` v0.8.61+ (`npm i -g codewhale`) with `allow_shell=true` in `~/.codewhale/config.toml`
- `codex` (`npm i -g @openai/codex`, then `codex login`)

## Install
```
/plugin marketplace add <this-repo>
/plugin install codexhale
/reload-plugins
/codexhale:setup
```

## Commands
- `/codexhale:review` — dual-model review of uncommitted changes (add `--base main` for branch review)
- `/codexhale:adversarial-review [focus]` — steerable challenge review
- `/codexhale:rescue <task>` — delegate implementation/debugging to CodeWhale (`--model fin` for cheap tier, `--resume` to continue)
- `/codexhale:status` / `result` / `cancel` — manage background jobs
- `/codexhale:setup --enable-review-gate` — gate Claude's turn completion behind a CodeWhale review (default off)

## When to use which model
- **Review / adversarial** → always codexhale (dual-model, highest blind-spot coverage)
- **Batch implement / refactor / add tests / fix bug** → `/codexhale:rescue --background` (DeepSeek is cheap; optional `--model fin`)
- **Tiny one-line edits** → keep in Claude (spawning CodeWhale costs more than it saves)
- **Orchestration / planning / final delivery** → Claude

## Review gate warning
The Stop hook review gate creates a Claude↔CodeWhale loop and drains usage. Only enable when actively monitoring. Default off.

## How the cache benefit works
Review rubrics live in `prompts/*.md` and are passed via CodeWhale's `--append-system-prompt` — byte-identical every review, so DeepSeek caches the stable prefix. You pay full price only on the diff.