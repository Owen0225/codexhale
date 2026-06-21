# Design: codexhale multi-round consensus ("debate") review for the spec workflow

Date: 2026-06-20
Status: Approved (design), pre-implementation
Author: codexhale

## 概览 (Chinese TL;DR)

把 Pilot `spec` 工作流里那个一次性的、可选的 Codex companion 评审，替换成 codexhale 的
**双模型辩论评审**：CodeWhale + Codex 各自评审 + 交叉反驳，产出带状态标记
(agreed / disputed / refuted) 的合并 findings 和一个 verdict (clean = 无双方认同的
critical/high)。

- **接线**：在 codexhale 插件里 fork 整条 spec 链 (6 个技能)，用 `/codexhale:spec` 调用，
  不动全局 Pilot。只有 `codexhale:spec-verify` 和 `codexhale:spec-bugfix-verify` 有真实
  行为改动；另外 4 个只是把跨技能 `Skill()` 调用改成 `codexhale:` 命名空间。
- **循环**：debate-review 每次 verify pass 只跑**一轮**，findings 进**现有**修复队列；
  "多轮" 由**现有**的 `verify -> PENDING -> implement -> re-verify` 外层循环提供 (上限 3 轮)。
  不新增内层循环 (避免与现有循环冲突)。
- **反驳不能推翻共识**：两模型独立都报的 finding (agreed) 不可被反驳降级；反驳只裁定
  单模型的 critical/high disputed finding，且姿态是 "除非有具体代码证据否则认同"。
- `/code-review` 主评保持不变。

---

## 1. Context and goal

### 1.1 What exists today

On Claude Code, `spec-verify` runs two reviews:

1. **Primary (always, when enabled):** the built-in `/code-review` skill, inline, on the
   session model (`spec-verify/steps/03-collect-results.md:21`). Full finder -> verify ->
   sweep. **This stays untouched.**
2. **Optional companion:** a single-shot **Codex** changes-review, gated by
   `PILOT_CODEX_CHANGES_REVIEW_ENABLED`. Launched in the background in
   `spec-verify/steps/01-launch-review.md:20-97`, collected in
   `spec-verify/steps/03-collect-results.md:42-100`. It runs **once** per `/spec`
   (codex-once sentinel), returns one `{verdict, findings}` JSON, findings get the
   severity -> action treatment, done.

codexhale today (`/codexhale:review`) runs CodeWhale + Codex **in parallel, one shot each**,
then `merge.mjs` does a **deterministic dedup** (tags `cw` / `codex` / `cw+codex` /
`disputed`). There is **no rebuttal between models, no rounds, no consensus verdict.**

### 1.2 Goal

Replace the optional single-shot Codex companion with a codexhale **debate review**:
the two models cross-examine each other's findings, producing a consensus-tagged report,
and the spec workflow iterates (review -> fix -> re-review) until a verify pass comes back
clean, then completes. The primary `/code-review` is unaffected.

### 1.3 Non-goals

- NOT replacing `/code-review` (primary review stays).
- NOT editing the global Pilot skills (the integration is a namespaced fork; see Decision D4).
- NOT a generic "any repo" reviewer change; this is the spec-verify integration plus the
  reusable `debate-review` engine in the codexhale plugin.

---

## 2. Decisions (with rationale)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Loop semantics | Debate -> fix -> re-review until clean | User intent: "多轮辩论到都没问题" |
| D2 | Who drives the loop | The main Claude, via the **existing** spec-verify outer loop (see D6) | Reuses existing fix machinery; avoids a second loop |
| D3 | Replace scope | Replace ONLY the optional Codex companion; keep `/code-review` | `/code-review`'s deep finder pass is valuable |
| D4 | Wiring | Namespaced 6-skill fork in the plugin, invoked as `/codexhale:spec` | Keeps global Pilot untouched (user priority) |
| D5 | Termination | Clean = a round with zero **agreed** critical/high findings; hard cap = the existing outer-loop cap (3) | No-cap + brittle fingerprints = no guaranteed termination (hardening finding) |
| D6 | Loop architecture (CORRECTED) | `debate-review` = **one round per verify pass**; multi-round via the existing `verify -> implement -> re-verify` loop | Fixes a **blocking** double-loop collision (hardening finding) |
| D7 | Bugfix path | `spec-bugfix-verify` also gets the debate review (additive; it has no codex block to replace) | Consistency feature/bugfix |

### 2.1 Corrections from the hardening pass

A 4-agent hardening pass (Opus 4.8, cross-checked against a Sonnet run) verified the facts
and adversarially critiqued the originally-approved design. Two corrections were adopted:

- **D6 (blocking):** the original "main Claude drives a NEW inner debate-fix-rerun loop
  inside one verify pass" collides with spec-verify's existing outer loop (they share the
  plan file, `Status`, and `Iterations` but neither tracks the other -> defeated cap,
  inconsistent `Status` on escalation). Corrected: debate-review is a single stateless round
  per verify pass; the existing outer loop provides "multi-round" and owns the cap.
- **D5 (high):** the original "no hard cap + zero-progress/reappearance fingerprint
  safeguard" cannot guarantee termination (line-number fingerprints break after fixes;
  oscillation trips neither detector). Corrected: the existing outer-loop cap (3) is the
  backstop. A semantic fingerprint (file + category + description, line-independent) is kept
  only as a belt-and-suspenders dedup hint, not as the termination guarantee.

Additional refinements folded in (all from the hardening critique):

- **Rebuttal soundness (high):** a rebuttal can NEVER downgrade an *agreed* finding (both
  models found it independently). Rebuttal only adjudicates *single-model* critical/high
  disputed findings, with the posture "agree unless you have a concrete, code-cited
  counter-argument." Prevents a contrarian rebuttal from suppressing a real bug.
- **Early-exit (cost):** if round 1's merged output has zero critical/high findings (any
  status), skip the rebuttal entirely -> 2 model calls instead of 4. The common clean-diff
  case costs the same as today's review.
- **Degraded mode:** if CodeWhale or Codex is missing/errors, fall back to single-model
  review; tag all findings `uncontested`; set `degraded: true`; do NOT write the codex-once
  sentinel (allow a retry when the model returns).
- **Scope propagation:** the subcommand takes `--base <ref>` / `--changed-files`; on a
  re-verify after fixes, the updated diff (post-fix) is what gets reviewed.
- **Agreed medium findings = `should_fix`** (the existing spec-verify severity rule), not
  silently "suggestions." They are fixed or surfaced at the Step 10 human gate.
- **Engine specifics:** add a stable `finding_id` slug WITHOUT changing `merge.mjs`'s output
  shape (would break the 51 passing tests); the Codex rebuttal uses plain `codex exec`
  (the `exec review` subcommand hardcodes its own prompt and can't take a rebuttal body);
  extend `writeJobLogs` for the rebuttal log blobs.

---

## 3. Architecture overview

```
/codexhale:spec  <task>
  |
  codexhale:spec (dispatcher fork)  -- routes by status/type to codexhale: phase skills
    |-- planning:  codexhale:spec-plan / codexhale:spec-bugfix-plan   (namespace-only fork)
    |-- implement: codexhale:spec-implement                           (namespace-only fork)
    |-- verify:    codexhale:spec-verify / codexhale:spec-bugfix-verify (REAL change)
  |
  codexhale:spec-verify
    Step 1: launch debate-review in background (replaces codex companion launch)
    Step 2: automated checks                                  (unchanged)
    Step 3: /code-review (primary, inline)                    (unchanged)
            + collect debate-review findings (replaces codex collect)
            + feed BOTH into the existing severity->action / lineage-first fix queue
    ...     existing outer loop: if verify fails -> Status PENDING -> spec-implement
            -> re-verify (re-runs debate-review on the post-fix diff). Cap 3.

  codexhale (plugin engine)
    node codexhale-companion.mjs debate-review --base <ref> [--changed-files ...]
      -> one debate round -> JSON {verdict, findings[], report}
```

Two components:

- **Component A** -- the `debate-review` companion subcommand (the reusable engine), all new
  code inside the codexhale plugin.
- **Component B** -- the 6-skill namespaced fork that wires `/codexhale:spec` to call it.

---

## 4. Component A: the `debate-review` engine

### 4.1 One debate round

`runDebateReview(opts)` in `codexhale-companion.mjs`:

```
1. Parallel initial review (Promise.allSettled):
     cwReview  = runCodewhale(cwReviewArgv({rubric, instruction, maxTurns:50}))   [read-only]
     cxReview  = runCodex(codexReviewArgv({base, focus}))                          [read-only]
2. Parse: parseStreamJson(cw) / parseReviewOutput(cx) -> extractJsonObject
3. Degraded check:
     if exactly one model produced usable output:
       - single-model mode: tag all findings status='uncontested'
       - verdict.clean = (no critical/high), verdict.degraded = true
       - DO NOT write codex-once sentinel
       - render + return
     if neither produced output: verdict.error, return (caller falls back to /code-review only)
4. merged = addIds(mergeFindings(cwOut, cxOut))      // stable id slug, see 4.4
5. EARLY EXIT:
     if merged has zero critical/high findings (any status):
       verdict.clean = true; skip rebuttal; render + return        // 2 model calls total
6. Rebuttal (only for single-model critical/high disputed findings):
     disputed = merged.filter(found_by.length==1 && severity in {critical,high})
     // agreed findings (found_by has both) are NOT eligible -- cannot be downgraded
     Parallel:
       cwRebuttal = runCodewhale(cwReviewArgv({rubric: rebuttalCw,
                       instruction: buildRebuttalInstruction('codewhale', codexDisputed, base),
                       maxTurns: max(20, disputed.length*2)}))
       cxRebuttal = runCodex(['exec','--json','--sandbox','read-only',
                       buildRebuttalInstruction('codex', cwDisputed, base)])   // plain exec
     parse both -> {rebuttals:[{finding_id, verdict:'agree'|'refute', reason, evidence_*}]}
7. tagged = tagFindings(merged, cwRebuttal, codexRebuttal)
     - found_by both                  -> status='agreed'
     - single-model, rebuttal 'agree' -> status='agreed'
     - single-model, rebuttal 'refute' WITH concrete evidence -> status='refuted'
     - otherwise                       -> status='disputed'
8. verdict = computeVerdict(tagged)   // clean = no status='agreed' critical/high
9. report = renderDebateReport(tagged)
10. writeJobLogs(extended w/ rebuttal blobs); updateJob(kind='debate-review', debate_report_path)
11. return {verdict, findings: tagged, report}
```

### 4.2 Reuse map (verified against the codebase)

Directly reusable, no change:

| Ref | Use |
|-----|-----|
| `lib/codewhale.mjs` `buildReviewArgv`, `runCodewhale`, `parseStreamJson` | CodeWhale initial review + rebuttal |
| `lib/codex.mjs` `buildReviewArgv`, `runCodex`, `parseReviewOutput` | Codex initial review |
| `lib/extract-json.mjs` `extractJsonObject` | robust JSON extraction (all passes) |
| `lib/merge.mjs` `mergeFindings`, `renderMergedReport` | build the annotated issue list / base report |
| `lib/review-prompt.mjs` `buildReviewInstruction` | initial-review instruction |
| `lib/jobs.mjs` `createJob`/`updateJob` | job lifecycle (kind='debate-review') |
| `lib/args.mjs` `parseArgs` | already forwards `--base` + positional focus |
| `codexhale-companion.mjs` `main()` switch | add `case 'debate-review'` |

New modules:

| Module | Purpose |
|--------|---------|
| `lib/debate.mjs` | `buildRebuttalInstruction`, `runCodewhaleRebuttal`, `runCodexRebuttal` (own argv builder for plain `codex exec`), `parseRebuttalOutput` |
| `lib/status-tag.mjs` | pure `tagFindings(merged, cwReb, cxReb)` + `computeVerdict(tagged)` |
| `lib/debate-report.mjs` | `renderDebateReport(tagged)` -- status badge + rebuttal block + verdict section (kept separate from `merge.mjs` to avoid coupling) |
| `prompts/rebuttal-codewhale.md` | rebuttal rubric (verdict schema, "agree unless concrete counter") |
| `prompts/rebuttal-codex.md` | same content; injected inline (plain exec takes the instruction as a positional arg) |
| `schemas/debate-output.schema.json` | rebuttal response schema |
| `codexhale-companion.mjs` `runDebateReview` + `case 'debate-review'` | orchestrator + wiring |

### 4.3 Read-only model flags (verified)

- CodeWhale: `exec --auto --output-format stream-json --allowed-tools read_file,exec_shell
  --disallowed-tools write_file,edit_file,apply_patch --max-turns N --append-system-prompt
  <rubric> <instruction>`. Read-only enforced by `--disallowed-tools`. Rebuttal reuses this
  verbatim with the rebuttal rubric + a rebuttal instruction.
- Codex initial: `exec review --json --sandbox read-only [--base <b> | --uncommitted]
  [<focus>]`. Read-only enforced by `--sandbox read-only`.
- Codex rebuttal: MUST use plain `exec --json --sandbox read-only <instruction-text>` -- the
  `exec review` form hardcodes its own prompt and rejects a custom body. Needs its own argv
  builder in `debate.mjs`.

### 4.4 Stable finding ids (do not break the 51 tests)

`merge.mjs` currently adds only `found_by[]` and `disputed:bool` -- no stable id. The
rebuttal correlates verdicts back to findings by id. Add ids in a NEW wrapper
`addIds(merged)` (id = `${file}:${line_range?.[0] ?? 0}:${category}`) called by
`runDebateReview`, NOT by editing `mergeFindings`'s output shape (editing it would break
`renderMergedReport` and the existing tests).

### 4.5 Scope

`debate-review` accepts `--base <ref>` (else `--uncommitted`) and optional `--changed-files`,
matching the Codex companion's `{{BASE_REF}}`/`{{CHANGED_FILES}}` scoping. On a re-verify
after fixes, the caller passes the current state so the second round reviews the post-fix
diff (not the stale pre-fix one).

---

## 5. Component B: the 6-skill namespaced fork

### 5.1 Why all 6 (call-graph verified)

The fork must guarantee that `/codexhale:spec` always reaches `codexhale:spec-verify`, never
the global one. The call graph (mapped exhaustively, cross-checked Opus+Sonnet) shows the
planners hand off to `spec-implement` DIRECTLY (`spec-plan/steps/12-approval.md:68,83,85`;
`spec-bugfix-plan/steps/06-approval.md:66,81,83`), and verify hands back to `spec-implement`
DIRECTLY (the feedback loop does NOT re-dispatch through the dispatcher). So leaving any link
global would let control escape to the unforked chain. Forking all 6 makes the rule uniform.

### 5.2 The rule

In every forked skill file: **rewrite every `Skill(skill='spec-*')` / dispatch-table entry to
`codexhale:spec-*`. Leave `Skill(skill='code-review')` bare (built-in).**

Call-sites to rewrite (from the verified call graph):

- `spec/steps/01-parse-route.md` -> `codexhale:spec-plan`, `codexhale:spec-bugfix-plan`
- `spec/steps/02-status-dispatch.md` (table) -> all five phase skills, `codexhale:`-prefixed
- `spec-plan/steps/12-approval.md` (x3), `spec-bugfix-plan/steps/06-approval.md` (x3) -> `codexhale:spec-implement`
- `spec-implement/steps/03-completion.md` -> `codexhale:spec-verify` / `codexhale:spec-bugfix-verify`
- `spec-verify/steps/02-automated-checks.md:38`, `07-e2e-and-final-regression.md:148`,
  `11-update-status.md:55,73` -> `codexhale:spec-implement`
- `spec-bugfix-verify/steps/03-verification-scenario.md:35`,
  `07-update-status.md:47,56` -> `codexhale:spec-implement`
- LEAVE BARE: `spec-verify/steps/03-collect-results.md:21,25,114` (`code-review`)

### 5.3 Which forks have real changes

| Forked skill | Change |
|--------------|--------|
| `codexhale:spec` | namespace-only |
| `codexhale:spec-plan` | namespace-only |
| `codexhale:spec-bugfix-plan` | namespace-only |
| `codexhale:spec-implement` | namespace-only |
| `codexhale:spec-verify` | namespace + **replace codex companion with debate-review** (below) |
| `codexhale:spec-bugfix-verify` | namespace + **add a debate-review step** (additive; no codex block exists there) |

### 5.4 `codexhale:spec-verify` changes (the core)

REMOVE (verified line ranges in the global source we fork from):

- `01-launch-review.md:20-97` -- the entire Codex companion launch block (sentinel check,
  `CODEX_COMPANION` detection, prompt-file render, background `node ... task --background`,
  JOB_ID registration verify).
- `03-collect-results.md:42-100` -- the entire "Collect Codex Results" sub-section (polling,
  fetch, parse, severity map, re-launch, sentinel touch, cleanup).

INSERT:

- In Step 1: launch `node codexhale-companion.mjs debate-review --base <BASE> --changed-files
  <...>` in the background (mirrors the old codex launch so it runs during Step 2).
- In Step 3 (after `/code-review`): collect the debate-review JSON; feed its findings into the
  SAME severity -> action + lineage-first fix queue as the `/code-review` findings. `agreed`
  critical/high -> must_fix; `agreed` medium -> should_fix; `disputed`/`refuted` -> mention /
  surface at the Step 10 gate. NO internal loop -- unresolved/structural issues flow to the
  existing outer loop, which re-runs verify (and thus debate-review) on the post-fix diff.

MUST NOT TOUCH (verified):

- `01-launch-review.md:1-19` (stale-findings cleanup + the preamble noting `/code-review` is
  primary).
- `03-collect-results.md:1-41` (the entire inline `/code-review` block: gate, effort
  resolution, `Skill('code-review')`, the finding->action table, lineage-first rule).
- `03-collect-results.md:101-115` (re-verification sub-section).
- `PILOT_CHANGES_REVIEW_ENABLED`, `PILOT_CODE_REVIEW_EFFORT` and everything they gate.
- `02-automated-checks.md` Steps 2.1/2.2 (Plan Compliance & Goal-Truth Audit).
- The Step 10 `AskUserQuestion` human gate and Step 11 VERIFIED logic.

Gating: reuse `PILOT_CODEX_CHANGES_REVIEW_ENABLED` as the on/off for the debate review inside
the fork (its meaning becomes "run the codexhale debate review" in the forked chain), OR
introduce `CODEXHALE_DEBATE_REVIEW_ENABLED`. (Decided at implementation; default to reusing
the existing var to avoid a new knob.)

### 5.5 `codexhale:spec-bugfix-verify` changes

It has ZERO codex usage today (only CODEX-START/END runtime markers). So the debate review is
**additive**: insert a new step that runs `debate-review` on the bugfix diff and feeds the
existing fix machinery, placed after the quality checks and before/with the verification
scenario. No deletions.

### 5.6 Fork hygiene (drift mitigation -- since we chose the fork)

The fork's delta from upstream is small and mechanical: namespacing the `Skill()` calls
(Section 5.2) + the `spec-verify`/`spec-bugfix-verify` debate changes (5.4/5.5). To keep
re-syncing cheap after a `pilot update`:

1. Record the upstream Pilot spec version/commit the fork was taken from in
   `docs/superpowers/specs/FORK-PROVENANCE.md`.
2. Keep the namespace-only forks (`spec`, `spec-plan`, `spec-bugfix-plan`, `spec-implement`)
   **byte-identical to upstream except the namespaced call-sites** -- a re-sync is: re-copy
   upstream, re-apply the namespacing (scriptable: `s/Skill(skill='spec-/Skill(skill='codexhale:spec-/`
   with the `code-review` exception).
3. Keep the `spec-verify`/`spec-bugfix-verify` debate deltas as a documented patch so they
   re-apply onto a fresh upstream copy.
4. A `scripts/check-fork-drift.sh` that diffs the forked skills against the current global
   `~/.claude/skills/*` and reports divergence, so drift is visible rather than silent.

---

## 6. Termination and safeguards

- "Clean" verdict = a verify pass whose debate-review returns zero `agreed` critical/high
  findings. The pass then proceeds to completion (Phase B, gates, VERIFIED).
- Multi-round = the existing outer loop: a non-clean verify -> `Status: PENDING` ->
  `codexhale:spec-implement` -> re-verify (re-runs debate-review on the post-fix diff).
- Hard cap = the existing outer-loop cap (3 iterations, Step 11). No separate inner cap is
  introduced (the inner loop was removed in D6).
- Semantic fingerprint (file + category + description substring, line-independent) is used
  only as a dedup/repeat hint in reporting, NOT as the termination mechanism.

---

## 7. Error / degraded handling

- One model missing or erroring -> single-model review, findings `uncontested`,
  `degraded:true`, no codex-once sentinel (retry allowed). Caller surfaces a warning, does
  not silently treat as a full debate.
- Both models unavailable -> debate-review returns `verdict.error`; the forked spec-verify
  records the gap explicitly (mirroring the existing "review unavailable" handling) and
  relies on the inline `/code-review` for that iteration.
- Rebuttal parse failure -> affected findings fall through as `disputed` (never silently
  dropped).

---

## 8. Testing strategy

- **Engine units** (mock model stdout): `tagFindings` status assignment (agreed cannot be
  downgraded), `computeVerdict` (clean iff no agreed critical/high), `addIds` stability,
  `buildRebuttalInstruction` shape, `parseRebuttalOutput` (incl. null/garbage -> disputed),
  early-exit path, degraded path.
- **Reuse-safety:** confirm the existing 51 tests still pass (no `merge.mjs` shape change).
- **Engine integration** (mocked `runCodewhale`/`runCodex`): full `runDebateReview` happy
  path, early-exit, degraded, one-model-refutes-real-bug-is-prevented (agreed not downgraded).
- **E2E:** run `/codexhale:spec` on a small change in the codexhale repo itself; confirm the
  forked chain reaches `codexhale:spec-verify`, debate-review runs, a real finding drives a
  fix via the existing loop, and a clean re-verify completes.
- **Fork-routing test:** assert no forked file contains a bare `Skill(skill='spec-*')` (only
  `codexhale:spec-*`), and `code-review` stays bare.

---

## 9. Open risks / notes

- **Fork drift** remains the main long-term cost (accepted, mitigated by Section 5.6).
- **Cost/latency:** worst case 4 model calls/round, but early-exit makes the common clean
  case 2 calls; the existing cap-3 bounds total rounds.
- **Gating var name** (`PILOT_CODEX_CHANGES_REVIEW_ENABLED` reuse vs new
  `CODEXHALE_DEBATE_REVIEW_ENABLED`) finalized at implementation.
- **Rebuttal quality** depends on the rubric enforcing "agree unless concrete code-cited
  counter"; validated by the engine integration test above.

---

## Appendix A: verified call graph (hardening output)

Inter-skill `Skill()` call-sites across the global spec chain (caller -> callee), all
rewritten to `codexhale:` in the fork except `code-review`:

- `spec/01-parse-route.md:52,53` -> spec-bugfix-plan, spec-plan
- `spec/02-status-dispatch.md` (table) -> spec-plan, spec-bugfix-plan, spec-implement,
  spec-verify, spec-bugfix-verify
- `spec-plan/12-approval.md:68,83,85` -> spec-implement
- `spec-bugfix-plan/06-approval.md:66,81,83` -> spec-implement
- `spec-implement/03-completion.md:9` -> spec-verify, spec-bugfix-verify
- `spec-verify/02-automated-checks.md:38` -> spec-implement
- `spec-verify/03-collect-results.md:21,25,114` -> code-review (STAYS BARE)
- `spec-verify/07-e2e-and-final-regression.md:148` -> spec-implement
- `spec-verify/11-update-status.md:55,73` -> spec-implement
- `spec-bugfix-verify/03-verification-scenario.md:35` -> spec-implement
- `spec-bugfix-verify/07-update-status.md:47,56` -> spec-implement

The verify->implement feedback loop is DIRECT (no dispatcher round-trip), which is why every
verify->implement site must be namespaced.

## Appendix B: verified insertion points (global source we fork from)

- Codex launch: `spec-verify/steps/01-launch-review.md:20-97` (remove/replace).
- Codex collect: `spec-verify/steps/03-collect-results.md:42-100` (remove/replace).
- Inline `/code-review` (KEEP): `03-collect-results.md:1-41` + re-verify `101-115`.
- `spec-bugfix-verify`: no codex block -> debate review is additive.
