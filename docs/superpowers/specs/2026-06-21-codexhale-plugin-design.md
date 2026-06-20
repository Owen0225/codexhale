# codexhale —— Claude Code 的 CodeWhale 插件（设计 spec）

- 日期：2026-06-21
- 状态：已通过设计评审，待 spec 复核
- 参考实现：`openai/codex-plugin-cc`（结构模板）；目标运行时：`Hmbown/CodeWhale`（v0.8.61+）

## 1. 目标与动机

把 CodeWhale（一个 Rust 写的、模型无关的、DeepSeek 缓存命中率高的终端 agent 框架）和 Codex（OpenAI）作为"另两个 agent"接入 Claude Code，主要用途：

1. **双模型对抗审查**（review / adversarial-review）：CodeWhale（DeepSeek）与 Codex（OpenAI）两个独立模型族**总是并行**审查同一份改动，各自用同一份 rubric，companion 合并去重发现 → 最彻底的盲区覆盖。
2. **任务委派**（rescue）：把实现/重构/补测试/修 bug 这类力气活外包给便宜且高缓存命中的 DeepSeek（仅 CodeWhale，单模型够）。
3. **互审闭环**（Stop hook gate，可选，默认关）：Claude 交付前触发 CodeWhale 审查（仅 CodeWhale，控制高频成本），发现问题 block 让 Claude 先修。

为什么用 CodeWhale 而不是直接调 DeepSeek API：DeepSeek 的缓存红利只在**稳定前缀重复**时兑现，CodeWhale 把 rubric/系统提示做成稳定前缀并通过 `--append-system-prompt` 传入，配合自身的磁盘级 prompt 缓存（跨模式翻转稳定），实现高缓存命中。

## 2. 关键决策（已确认）

| 决策点 | 选择 | 理由 |
|---|---|---|
| 通信方式 | `codewhale exec` + `codex exec` 一次性调用（双模型） | 最简单，无需守护进程；UX 对齐 codex-plugin-cc；每次调用仍享受各自稳定前缀缓存 |
| Codex 参与范围 | review / adversarial-review **总是双模型平行**；rescue 仅 CodeWhale；Stop hook gate 默认仅 CodeWhale | 用户要求最彻底的双模型对抗审查；rescue 是委派干活（一个模型够）；gate 高频自动触发，加 Codex 过贵过慢 |
| 功能范围 | 全量（review / adversarial-review / rescue / status / result / cancel / setup / Stop hook） | 对齐 codex-plugin-cc 主力命令族 + 互审门 |
| diff 传递 | CodeWhale 自己取上下文（`read_file` + git shell） | 缓存红利最大；对抗审查能深挖 diff 外引用文件；代价是给 CodeWhale 限定的 shell（仅 git） |
| 只读强制 | harness 层 `--disallowed-tools write_file,edit_file,apply_patch` | 比 prompt-only 更强，模型无法绕过 |
| rescue 写权限 | `--yolo` | 非交互后台场景需要写+shell+自动批准 |
| Stop hook | 默认关闭 | 避免烧额度与 Claude↔CodeWhale 长循环 |
| Stop hook 超时 | 1800s（30 分钟） | 对抗审查读多文件+多轮工具调用，15 分钟可能不够；gate 默认关，使用者本就主动监控 |
| review `--max-turns` | 50 | 给大 diff 对抗审查更多深挖空间，配合 `--background` 不阻塞 |
| gate `--max-turns` | 40 | 针对性审查，比交互 review 小，防止 gate 跑太久 |
| rescue `--max-turns` | 不设（交 CodeWhale 按目标跑） | 用 `--background` 兜底 |
| rescue 模型默认值 | 不设默认，保留 CodeWhale `--model auto` 路由 | auto 按复杂度选模型比硬编码更聪明 |
| 便宜档别名 | `--model fin` → `deepseek-v4-flash` | 给"又便宜又快"的实现任务专门档位，对齐 codex-plugin-cc 的 `spark` 思路 |

### 2.1 模型分工原则（写进 README）

| 任务类型 | 用谁 | 理由 |
|---|---|---|
| 审查 / 对抗质疑 | CodeWhale | 缓存命中高、便宜、视角独立 |
| 批量实现 / 机械重构 / 补测试 | rescue + `--background`（可选 `--model fin`） | DeepSeek 单价低，量大利息大 |
| 微小一次性编辑 | Claude（不调 CodeWhale） | CodeWhale 冷启动进程+重建会话开销可能比省下的还多 |
| 编排 / 规划 / 复杂推理 / 最终交付 | Claude | 推理强、用户已在用 |

## 3. 架构

```
Claude Code
  │  /codexhale:* 命令  +  codexhale-rescue 子agent  +  Stop hook
  ▼
codexhale-companion.mjs          ← 唯一带逻辑的 Node 分发脚本
  │  review: 并行 spawn 两个子进程
  ├──────────────────────┬───────────────────────┐
  ▼                      ▼                       ▼ (rescue / gate 单进程)
codewhale exec --auto    codex exec ...          codewhale exec --auto
  │                      │
  ▼                      ▼
CodeWhale→DeepSeek      Codex→OpenAI
  │                      │
  └────── 合并/去重 ─────┘
       (companion 侧)
```

- review/adversarial-review：companion 并行 spawn `codewhale exec` 与 `codex exec`，各自用**同一份 rubric**（`prompts/review.md` 或 `adversarial-review.md`）作为系统提示，保证两模型指令一致、发现可比较。
- rescue：仅 `codewhale exec`（委派干活，单模型够）。
- Stop hook gate：仅 `codewhale exec`（高频自动触发，控制成本与延迟）。

### 3.1 状态目录（两套，分离避免冲突）

- `~/.codewhale/` —— CodeWhale 自有（auth、`config.toml`、sessions）。插件只读、不写。
- `~/.codexhale-cc/` —— 插件状态：
  - `config.json`：`{ review_gate_enabled: bool, default_model?: string, defaults: {...} }`
  - `jobs/<job_id>.json`：manifest，`{ id, kind, cc_task_id, status, started_at, ended_at, exit_code, code_whale_session_id? }`
  - `jobs/<job_id>.stdout.log` / `.stderr.log`：完整输出

## 4. 插件目录结构

```
plugins/codexhale/
  commands/{review,adversarial-review,rescue,status,result,cancel,setup}.md
  agents/codexhale-rescue.md          # 瘦转发子agent（model: sonnet，仅 Bash）
  hooks/hooks.json                    # Stop hook（审查门）+ SessionStart/End
  prompts/{review,adversarial-review,stop-review-gate}.md   # 稳定缓存前缀 rubric
  schemas/review-output.schema.json   # CodeWhale 输出 schema；gate 解析它
  scripts/{codexhale-companion.mjs, stop-review-gate-hook.mjs}
```

## 5. 命令规格

`codexhale-companion.mjs` 是唯一带逻辑的脚本；命令 `.md` 文件是薄指令、shell 调它（同 codex-plugin-cc 模式）。所有 `codewhale exec` 调用都用 `--auto --output-format stream-json`，输出可解析。

### 5.1 `/codexhale:review`

只读审查，工作区或 `--base <ref>`。**总是双模型**：companion 并行 spawn CodeWhale 和 Codex，各用同一份 `prompts/review.md` rubric。

CodeWhale 调用：
```
codewhale exec --auto \
  --allowed-tools read_file,exec_shell \
  --disallowed-tools write_file,edit_file,apply_patch \
  --max-turns 50 \
  --append-system-prompt "$(cat prompts/review.md)" \
  "<指令：审查当前未提交改动 [vs base X]，自己跑 git status/git diff>"
```

Codex 调用（codex CLI 非交互模式，同一 rubric + 同一指令；具体 flag 实现前用 `codex exec --help` 核对）：
```
codex exec \
  --sandbox read-only \
  "<rubric>\n\n<同一指令>"
```

- 两进程并行（Node `child_process.spawn`，`Promise.all`）。
- `--disallowed-tools` / `--sandbox read-only` 在各自 harness 层强制只读（强于纯 prompt）。
- CodeWhale 需 `allow_shell=true`（setup 检查）；Codex 用其自身 sandbox read-only。
- shell 限定 git（指令层面）。
- 支持 `--wait` / `--background`；`--base <ref>`；`--scope auto|working-tree|branch`。
- 纯只读，不改代码。
- 命令 `.md` 用 `AskUserQuestion` 在无显式 flag 时推荐前台/后台（小改动推荐 wait，其余推荐 background；双模型审查通常更慢，倾向 background）。
- 任一模型缺失/失败 → 该模型子结果标 `failed`，另一模型结果照常返回（不整体失败）。

### 5.2 `/codexhale:adversarial-review`

同 review 的双模型并行结构，但：
- 用 `prompts/adversarial-review.md` 作为 rubric。
- 接受自由 focus 文本（flag 之后的文字），拼进两模型指令尾部。
- 质疑设计/权衡/隐藏假设/失败模式/替代方案。

### 5.2.1 审查结果合并（companion 侧）

两模型各产一份发现列表，companion 合并：

- **去重**：按 `(file, line_range, issue_category)` 启发式聚类；同一处同类问题合并为一条，`found_by` 标 `[codewhale, codex]`。
- **溯源**：每条发现保留 `found_by` 字段（哪个模型先发现）。
- **冲突**：一个模型报问题、另一个判无问题 → 保留并标 `disputed: true`，两份理由都列出，交 Claude/用户裁决。
- **输出**：按文件分组的合并报告，每条发现标 `[cw]` / `[codex]` / `[cw+codex]` / `[disputed]`。
- 合并是纯启发式（无 LLM 介入），确定性、可测。



### 5.3 `/codexhale:rescue`（+ `codexhale-rescue` 子agent）

写权限委派。走 `codexhale-rescue` 子agent（瘦转发，对齐 codex-plugin-cc 的 `codex:codex-rescue`）。

调用形：
```
codewhale exec --yolo \
  [--continue | --resume <id>] \
  [--model <model|fin>] \
  --output-format stream-json \
  "<任务文本>"
```

- `--yolo`：写 + shell + 自动批准（非交互后台必需）。
- `--resume`（无参）→ `codewhale exec --continue`（继续本 repo 最近会话）；`--resume <id>` → `codewhale exec --resume <id>`；`--fresh` 不加任何 resume/continue。
- `--model fin` → 映射 `deepseek-v4-flash`；`--model <具体名>` 透传。
- 默认不设 `--model`，保留 CodeWhale `--model auto` 智能路由。
- `--background` / `--wait`：开放式多步任务（实现/重构/补测试/修 bug）默认倾向后台。
- 不设 `--max-turns`，用 `--background` 兜底。
- 子agent 规则：只允许一次 Bash 调 companion；不许自己读代码/分析/poll status；返回 companion stdout 原样。

### 5.4 `/codexhale:status`

- 列出当前 repo 的 jobs（按 repo 路径 hash 过滤 `~/.codexhale-cc/jobs/`）。
- 运行中任务与 CC 后台任务状态交叉引用（通过 manifest 里的 `cc_task_id`）。
- 可带 `<job_id>` 看单个。

### 5.5 `/codexhale:result`

- review 类：输出 `jobs/<id>.merged.md`（合并报告）+ 各子模型 session id（`codewhale resume <id>` / `codex resume <id>` 接续）。
- rescue 类：输出 `jobs/<id>.codewhale.stdout.log` 全文 + CodeWhale session id。
- 默认看最近完成的 job。

### 5.6 `/codexhale:cancel`

- 停掉 CC 后台任务（通过 `cc_task_id`）。
- 更新 manifest status → `canceled`。

### 5.7 `/codexhale:setup`

- 双依赖就绪检查：
  - `codewhale --version` + `codewhale doctor --json`（review + rescue + gate 都需要）。
  - `codex --version`（review 双模型需要）。缺 codex → 建议 `npm i -g @openai/codex` + `codex login`。
- 缺 codewhale 且有 npm → 建议 `npm i -g codewhale`。
- `allow_shell` 关 → 警告（review 需要）。
- 任一 CLI 缺失时，明确告知哪些命令可用（codewhale 缺 → 全瘫痪；codex 缺 → rescue/gate 可用、review 降级为单模型并警告）。
- `--enable-review-gate` / `--disable-review-gate` 写 `~/.codexhale-cc/config.json` 的 `review_gate_enabled`。

### 5.8 任务生命周期（companion 侧）

manifest 扩展为支持双子任务（review）：
```json
{
  "id": "job_...",
  "kind": "review|adversarial-review|rescue",
  "cc_task_id": "...",
  "status": "running|completed|failed|canceled",
  "started_at": "...",
  "ended_at": "...",
  "repo": "<path hash>",
  "sub_jobs": [
    { "model": "codewhale", "status": "completed", "exit_code": 0,
      "code_whale_session_id": "...", "log": "jobs/<id>.codewhale.stdout.log" },
    { "model": "codex", "status": "completed", "exit_code": 0,
      "codex_session_id": "...", "log": "jobs/<id>.codex.stdout.log" }
  ],
  "merged_report_path": "jobs/<id>.merged.md"
}
```

- rescue 的 `sub_jobs` 只有一项（codewhale）。
- 启动时写 manifest（status=`running`，`cc_task_id`，`started_at`）。
- 完成时更新 manifest（status=`completed|failed|canceled`，`ended_at`，各 sub_job 状态/exit_code/session_id）+ 落各子任务 stdout/stderr 日志 + 合并报告（review）。
- 已完成任务跨会话持久；运行中任务是会话级（CC 后台任务不跨会话，同 codex-plugin-cc 限制）。

## 6. Stop hook 审查门

`hooks/hooks.json`：
```json
{
  "Stop": [{
    "hooks": [{
      "type": "command",
      "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-review-gate-hook.mjs\"",
      "timeout": 1800
    }]
  }],
  "SessionStart": [...],
  "SessionEnd": [...]
}
```

`stop-review-gate-hook.mjs` 流程（仅在 `review_gate_enabled=true` 时执行）：
1. 读 `~/.codexhale-cc/config.json`，未开 → 直接 exit 0（allow stop）。
2. 解析 hook 输入的 transcript JSON，看 Claude 本回合有无 `Edit|Write|Bash` 工具调用。无 → 跳过（纯对话不审查）。
3. 跑针对性 `codewhale exec --auto` 审查：
   - `--max-turns 40`
   - `--disallowed-tools write_file,edit_file,apply_patch`（只读）
   - prompt 聚焦本回合改动文件 + Claude 的声明
4. 按 `schemas/review-output.schema.json` 解析 CodeWhale 最终消息。
5. 发现问题 → 输出 Claude Code Stop-hook **block** decision，把问题回灌（decision=`block`，reason=问题清单），逼 Claude 先修。
6. 干净 → exit 0（allow stop）。
7. 超时/解析失败 → 默认 allow（fail-open，不卡用户）。

## 7. 缓存策略

- review/adversarial 的 rubric 放 `prompts/*.md`，经 `--append-system-prompt` 传入 → **每次字节一致** → DeepSeek 缓存稳定前缀。动态部分（diff、focus）在尾巴，只在 diff 上付全价。
- rescue 复用 CodeWhale 自身磁盘级 prompt 缓存（ARCHITECTURE.md 称跨模式翻转稳定）。
- 单元测试断言 `--append-system-prompt` 跨调用字节一致（缓存前缀稳定性回归）。

## 8. 安全

- review：harness 层只读（`--disallowed-tools`），shell 限 git。
- rescue：`--yolo` 可写，每次自愿开启，在用户 repo 跑（同 codex-plugin-cc `--write` 信任模型）。
- 不碰密钥：CodeWhale 自管 auth，插件从不接触 key。
- Stop hook：只读审查，`--max-turns` 有界，1800s 超时，fail-open。

## 9. 测试

Node `--test` 套件（对齐 codex-plugin-cc `tests/`）：
- 参数解析（`--wait`/`--background`/`--base`/`--model`/`--resume`/`--fresh`/`fin` 别名）
- prompt 构造 + 缓存前缀稳定性（断言 CodeWhale/Codex 两路 `--append-system-prompt`/rubric 字节一致且彼此一致）
- job manifest 读写（含双子任务结构）
- setup 就绪解析（mock `codewhale doctor --json` + `codex --version`，覆盖单/双依赖缺失场景）
- stream-json 解析（gate 用）
- `--model fin` → `deepseek-v4-flash` 映射
- **合并/去重逻辑**：构造两份假发现，断言去重、溯源 `found_by`、`disputed` 标记、按文件分组输出确定性

单元测试不跑真实 `codewhale` / `codex`。

## 10. 不在范围（v2）

- 长驻 `codewhale serve --http` 持久 thread / 跨会话运行中任务跟踪
- review 的 `--resume`
- Fleet / 多 worker 编排
- mobile / ACP / MCP server 集成

## 11. 风险

- **CodeWhale `exec` 接口可能在版本间变动**：spec 基于 v0.8.61 文档；实现前需 `codewhale exec --help` 核对 flag。setup 命令做版本检查。
- **Codex CLI 非交互 review 调用方式未定**：spec 假设 `codex exec --sandbox read-only`；实现前需 `codex exec --help` 核对确切 flag（codex-plugin-cc 走 app-server `review/start`，本插件走一次性 `codex exec` 需验证是否等价）。若 codex 无等价 read-only exec，备选：复用 codex-plugin-cc 的 app-server broker 思路调 `review/start`。
- **`--disallowed-tools` 行为**：需确认它真能在 `codewhale --auto` 下硬拦写工具（而非仅从 catalog 移除）。实现前实测一条 `write_file` 调用是否被拒。
- **合并去重启发式质量**：纯规则去重可能误合并/漏合并。先实现确定性版本，若实际使用中发现合并质量差，再考虑用 CodeWhale（cheap）做一次合并裁决。
- **双模型成本**：review 每次跑 CodeWhale + Codex，Codex 消耗 OpenAI/Codex 额度。README 明示；`--background` 缓解阻塞。rescue 与 gate 不受影响（单模型）。
- **Stop hook 长循环**：Claude 改完→gate 再审→又发现问题→无限循环。README 警告 + 默认关 + gate `--max-turns 40` 限制单次成本。
- **DeepSeek 缓存实际命中率**：依赖 CodeWhale 的 `--append-system-prompt` 是否进入缓存前缀。需在实现后用 `/v1/usage` 的 `cached_tokens` 验证。
