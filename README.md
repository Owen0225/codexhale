# codexhale

把 **CodeWhale**（DeepSeek，高缓存命中）和 **Codex**（OpenAI）接入 Claude Code 的插件。

两个模型并行审查你的代码改动，合并去重发现；实现/重构/修 bug 等力气活可外包给便宜的 DeepSeek。

---

## 功能

| 命令 | 说明 |
|------|------|
| `/codexhale:review` | 双模型并行 code review，合并去重，每条发现标注来源 |
| `/codexhale:adversarial-review` | 对抗性审查：质疑设计权衡、隐藏假设、边界失败模式 |
| `/codexhale:rescue` | 把任务委派给 CodeWhale/DeepSeek（写代码、重构、补测试、修 bug） |
| `/codexhale:status` | 查看当前仓库的 job 列表 |
| `/codexhale:result` | 读取合并后的审查报告或 rescue 输出 |
| `/codexhale:cancel` | 取消运行中的后台 job |
| `/codexhale:setup` | 就绪检查 + 配置 Stop 审查门 |

---

## 什么时候用哪个模型

| 场景 | 用法 |
|------|------|
| 审查 / 质疑设计 | `/codexhale:review` 或 `:adversarial-review`（双模型，覆盖最彻底） |
| 批量实现 / 重构 / 补测试 / 修 bug | `/codexhale:rescue --background`（DeepSeek 便宜，量大优势大） |
| 微小单行改动 | 留给 Claude（启动 CodeWhale 进程的开销比收益大） |
| 规划 / 编排 / 最终交付 | Claude |

---

## 前置依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 18.18 | codewhale / codex npm 包装器 |
| Claude Code | 最新 | 插件宿主 |
| Git | 任意 | review 在 git 仓库内运行 |
| `codewhale` CLI | ≥ 0.8.61 | review / rescue / Stop gate |
| `codex` CLI | 最新 | 双模型 review（缺席时降级为单模型） |

**账号要求：**
- **DeepSeek**：需要 DeepSeek API key（或 CodeWhale 支持的其它 provider，如 openrouter / ollama）。ChatGPT 订阅不能驱动 codewhale。
- **OpenAI / ChatGPT**：codex 登录用。ChatGPT 订阅或 OpenAI API key 均可。

---

## 安装

### 1. 安装 CodeWhale CLI

```bash
npm install -g codewhale
codewhale --version   # 应输出 0.8.61+
```

配置 provider（以 DeepSeek 为例）：

```bash
codewhale auth set --provider deepseek
# 按提示填入 API key
```

### 2. 开启 allow_shell（review 必需）

review 命令让 CodeWhale 自己跑 `git diff`，需要 shell 权限：

```bash
codewhale config set allow_shell true
```

> ⚠️ **已知坑**：`config set` 会把值写成字符串 `"true"`（带引号），导致 TOML 解析失败，所有 codewhale 命令报 `invalid type: string "true", expected a boolean`。
>
> **设完后必须手动打开 `~/.codewhale/config.toml`，把顶层的 `allow_shell = "true"` 改为 `allow_shell = true`（去掉引号）。**
>
> 或者直接手编文件，在所有 `[section]` 之前加一行 `allow_shell = true`，跳过 `config set`。

验证：

```bash
codewhale config get allow_shell   # 应输出 true（无引号）
codewhale doctor --json            # 应输出 JSON，无 TOML 解析错误
```

注意：`doctor --json` 的 schema 里没有 `allow_shell` 字段，用 `config get` 查它。

### 3. 安装 Codex CLI

```bash
npm install -g @openai/codex
```

登录（交互式，必须在终端跑，不能由插件代跑）：

```bash
codex login
# 或在 Claude Code 会话内：!codex login
```

### 4. 安装 codexhale 插件

**从 GitHub 安装（推荐）：**

在 Claude Code 会话内：

```
/plugin marketplace add Owen0225/codexhale
/plugin install codexhale
```

**本地路径安装（开发 / 调试）：**

```bash
# 克隆仓库
git clone git@github.com:Owen0225/codexhale.git

# 在 Claude Code 会话内：
/plugin marketplace add /path/to/codexhale
/plugin install codexhale
```

或使用 `--plugin-dir` 临时加载（仅当次会话有效）：

```bash
claude --plugin-dir /path/to/codexhale/plugins/codexhale
```

> `--plugin-dir` 路径要指向 `plugins/codexhale`（里面有 `.claude-plugin/plugin.json`），不是仓库根目录。

### 5. 就绪检查

```
/codexhale:setup
```

正常输出：

```
codewhale: v0.8.61
codex:     v<版本>
allow_shell: on (review needs on)
review gate: disabled
```

---

## 命令详解

### `/codexhale:review`

对未提交改动做双模型并行审查。

```
/codexhale:review                   # 审查工作区改动
/codexhale:review --base main       # 审查当前分支 vs main
/codexhale:review --wait            # 前台等结果（小改动）
/codexhale:review --background      # 后台跑（大 diff，推荐）
```

报告里每条发现带来源标签：

- `[cw+codex]` — 两个模型都发现了
- `[cw]` / `[codex]` — 只有一个模型报
- `[disputed]` — 一个模型报、另一个审了同文件却没报（值得人工裁决）

### `/codexhale:adversarial-review`

对抗性审查，质疑设计而非只找 bug：

```
/codexhale:adversarial-review 重点看缓存失效路径和并发安全
```

### `/codexhale:rescue`

把任务委派给 CodeWhale（DeepSeek）：

```
/codexhale:rescue --background 给 parseConfig 补单元测试
/codexhale:rescue --model fin --background 修这个 flaky 测试   # fin = deepseek-v4-flash（便宜档）
/codexhale:rescue --resume 继续上次会话
/codexhale:rescue --resume <session-id> 续接指定会话
/codexhale:rescue --fresh 不续接，开新会话
```

### `/codexhale:status` / `result` / `cancel`

```
/codexhale:status            # 列出当前仓库的所有 job
/codexhale:status <job-id>   # 看单个 job 详情
/codexhale:result            # 读最近完成 job 的报告
/codexhale:result <job-id>   # 读指定 job 的报告
/codexhale:cancel            # 取消最近的运行中 job
/codexhale:cancel <job-id>   # 取消指定 job
```

result 输出末尾会附 session id，可接续到 CLI：

```bash
codewhale resume <session-id>
codex exec resume <session-id>
```

### `/codexhale:setup`

```
/codexhale:setup                        # 就绪检查
/codexhale:setup --enable-review-gate   # 开启 Stop 审查门
/codexhale:setup --disable-review-gate  # 关闭 Stop 审查门
```

---

## Stop 审查门（可选，默认关）

开启后，Claude 每次准备停止交付前会自动触发一次只读 CodeWhale 审查；发现 critical/high 问题就 block，把问题清单回灌给 Claude 让它先修。

```
/codexhale:setup --enable-review-gate
```

> ⚠️ **警告：** 审查门会形成 Claude ↔ CodeWhale 循环，快速消耗额度。只在主动监控时开启。单次最多 40 轮、超时 1800s，全程 fail-open（gate 自身出错不卡用户）。

---

## 缓存原理

review rubric 存在 `prompts/*.md`，通过 `codewhale --append-system-prompt` 传入。每次调用字节完全相同 → DeepSeek 稳定缓存前缀。动态部分（diff、focus 文本）在最后 → **只对实际改动付全价**。

---

## 故障排查

**`codewhale: MISSING`**  
→ `npm install -g codewhale`，rescue / gate 全瘫痪直到装好。

**`codex: MISSING`**  
→ `npm install -g @openai/codex && codex login`，缺席时 review 自动降级为单模型（codewhale only），rescue / gate 不受影响。

**`allow_shell: off`**  
→ 回到安装第 2 步。review 无法跑 git 命令。

**`invalid type: string "true", expected a boolean`**  
→ `codewhale config set allow_shell true` 写入了带引号的字符串。手动编辑 `~/.codewhale/config.toml`，把 `allow_shell = "true"` 改为 `allow_shell = true`。

**review 只有 `[cw]`，没有 `[codex]`**  
→ codex 未装或未登录。`codex --version` 检查，`!codex login` 重新登录。companion 用 `Promise.allSettled`，codex 挂了只降级不崩溃。

**`codewhale: command not found`（Windows）**  
→ npm 全局 bin 未在 PATH。`npm config get prefix` 找到 bin 目录加入系统 PATH，重启终端。

**Stop gate 把 Claude 卡住**  
→ `gate` 只在发现 critical/high 时 block。如果陷入循环，禁用：`/codexhale:setup --disable-review-gate`。

**插件改了代码不生效**  
→ 会话内跑 `/reload-plugins`。

**`--plugin-dir` 加载报错**  
→ 确认路径指向 `plugins/codexhale`（含 `.claude-plugin/plugin.json`），不是仓库根。

---

## 卸载

```
/plugin uninstall codexhale
```

清理插件状态（可选）：

```bash
rm -rf ~/.codexhale-cc
```

> 不要删 `~/.codewhale/`，那是 CodeWhale 本体的配置，删了 auth 也没了。

---

## 状态文件

插件状态存在 `~/.codexhale-cc/`，不写 `~/.codewhale/`（CodeWhale 自管，插件只读）。

```
~/.codexhale-cc/
├── config.json          # review_gate_enabled 等配置
└── jobs/
    ├── <id>.json        # job manifest（kind / status / sub_jobs / session ids）
    ├── <id>.codewhale.stdout.log
    ├── <id>.codex.stdout.log
    └── <id>.merged.md   # 合并后的双模型审查报告
```
