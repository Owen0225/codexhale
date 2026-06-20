# codexhale 安装指南

本文档覆盖从零安装到首次跑通 `codexhale` 插件的全部步骤。

> 平台说明：本文以 **Windows + Git Bash** 为主（与开发环境一致），Linux/macOS 命令相同，仅路径分隔符不同。

---

## 0. 前置条件

| 依赖 | 版本 | 用途 |
|---|---|---|
| Node.js | ≥ 18.18 | codewhale / codex 的 npm 包装器需要 |
| Claude Code | 最新版 | 插件宿主（`/plugin` 命令需较新版本） |
| Git | 任意 | review 需要在 git 仓库内运行 |
| `codewhale` CLI | ≥ 0.8.61 | review / rescue / Stop gate 都依赖它 |
| `codex` CLI | 最新版 | 双模型 review 需要；缺则 review 降级为单模型 |

账号：
- **DeepSeek**：ChatGPT 订阅**不行**，需要 DeepSeek API key（或 CodeWhale 支持的其它 provider）。codewhale 用它驱动 review/rescue。
- **OpenAI / ChatGPT**：codex 登录用。ChatGPT 订阅或 OpenAI API key 均可。

---

## 1. 安装 CodeWhale CLI

```bash
npm install -g codewhale
codewhale --version    # 应输出 0.8.61 或更高
```

### 1.1 登录 / 配置 provider

```bash
codewhale auth set --provider deepseek
```

按提示填入 DeepSeek API key。key 落盘到 `~/.codewhale/config.toml`（Windows 下 `~` = `C:\Users\<你>`）。

也可以改用其它 provider（openrouter / 本地 vllm / ollama 等），见 `codewhale auth set --help`。

### 1.2 开启 allow_shell（review 必需）

`codexhale:review` 让 CodeWhale 自己跑 `git status` / `git diff`，需要 shell 工具。编辑 `~/.codewhale/config.toml`，加入或确认：

```toml
allow_shell = true
```

### 1.3 验证

```bash
codewhale doctor
```

应显示 `config_present: true`、`api_key.source: env` 或 `config`、`sandbox` 状态等，无报错。

```bash
codewhale doctor --json
```

JSON 输出里 `allow_shell` 应为 `true`。`/codexhale:setup` 会自动检查这一项。

---

## 2. 安装 Codex CLI

```bash
npm install -g @openai/codex
codex --version
```

### 2.1 登录

codex 登录是**交互式**命令，不能由插件代跑。在 Claude Code 会话里用 `!` 前缀直接在当前 shell 跑：

```
!codex login
```

按提示用 ChatGPT 账号或 OpenAI API key 登录。

> 如果不在 Claude Code 里，直接终端跑 `codex login` 即可。

### 2.2 验证

```bash
codex exec --version
```

能输出版本号即就绪。

---

## 3. 安装 codexhale 插件到 Claude Code

有两条路径。**推荐先用路径 A 本地即测**，确认能跑后再用路径 B 持久化安装。

### 路径 A：本地 `--plugin-dir` 即测（无需 marketplace）

插件代码在本仓库的 `plugins/codexhale/`。启动 Claude Code 时直接加载：

```bash
claude --plugin-dir D:/agent/plugins/codexhale
```

进入会话后跑 `/help`，应能看到 `/codexhale:review` 等命令。

- 改了插件代码后，会话内跑 `/reload-plugins` 即可热加载，无需重启。
- 这种方式**只对当前启动的会话生效**，关掉就没了。要长期用走路径 B。

### 路径 B：marketplace 持久化安装

#### B.1 给仓库补 marketplace 清单

当前仓库根目录还没有 `.claude-plugin/marketplace.json`（只有插件级的 `plugins/codexhale/.claude-plugin/plugin.json`）。创建 `D:/agent/.claude-plugin/marketplace.json`：

```json
{
  "name": "codexhale-local",
  "owner": {
    "name": "local"
  },
  "plugins": [
    {
      "name": "codexhale",
      "source": "./plugins/codexhale"
    }
  ]
}
```

#### B.2 添加 marketplace

在 Claude Code 会话里：

```
/plugin marketplace add D:/agent
```

（本地路径；如果以后推到 GitHub，可改用 `/plugin marketplace add <github-owner>/<repo>`。）

#### B.3 安装插件

```
/plugin install codexhale@codexhale-local
```

#### B.4 重载

```
/reload-plugins
```

#### B.5 验证已加载

```
/help
```

应列出 `/codexhale:review`、`/codexhale:adversarial-review`、`/codexhale:rescue`、`/codexhale:status`、`/codexhale:result`、`/codexhale:cancel`、`/codexhale:setup`。

```
/agents
```

应能看到 `codexhale-rescue` 子agent。

---

## 4. 首次就绪检查

```
/codexhale:setup
```

期望输出（两个 CLI 都装好时）：

```
codewhale: v0.8.61
codex:     v<某版本>
allow_shell: on (review needs on)
review gate: disabled
```

常见警告含义：
- `codewhale: MISSING` → 回到第 1 步装 codewhale。**rescue / gate 全瘫痪**。
- `codex: MISSING` → 回到第 2 步装 codex。**review 降级为单模型**（只跑 codewhale），rescue / gate 不受影响。
- `allow_shell: off` → 回到 1.2 开 `allow_shell`，否则 review 跑不了 git。
- `allow_shell: unknown` → `codewhale doctor --json` 没跑成功，通常 codewhale 没装好或没登录。

---

## 5. 首次跑一次 review

在一个有未提交改动的 git 仓库里（比如本仓库 `D:/agent`，先随便改个文件）：

```
/codexhale:review
```

命令会先估算改动规模，用 `AskUserQuestion` 问你前台等还是后台跑。小改动选 `Wait for results`，其余选 `Run in background`。

后台跑时：

```
/codexhale:status       # 看进度
/codexhale:result       # 看合并后的双模型审查报告
```

报告里每条发现带来源标签：
- `[cw+codex]` 两个模型都报了
- `[cw]` / `[codex]` 只有一个模型报
- `[disputed]` 一个模型报、另一个审了同文件却没报（值得人工裁决）

想接续到原生 CLI 里看细节：

```bash
codewhale resume <session-id>     # session-id 从 /codexhale:result 输出里取
codex exec resume <session-id>
```

---

## 6. （可选）开启 Stop 审查门

默认关闭。开启后，Claude 每次准备停止交付前，会自动跑一次只读 CodeWhale 审查；发现 critical/high 问题就 block，逼 Claude 先修。

```
/codexhale:setup --enable-review-gate
```

关闭：

```
/codexhale:setup --disable-review-gate
```

> ⚠️ 警告：审查门会形成 Claude ↔ CodeWhale 循环，可能快速消耗额度。只在你会主动监控时开启。gate 单次最多 40 轮、超时 1800s，且**全程 fail-open**（gate 自己出错不会卡住你）。

---

## 7. rescue：把活儿外包给 DeepSeek

把实现 / 重构 / 补测试 / 修 bug 这类力气活丢给便宜的 DeepSeek：

```
/codexhale:rescue --background 给 utils.ts 的 parseConfig 补单元测试
```

便宜档（`deepseek-v4-flash`）：

```
/codexhale:rescue --model fin --background 快速修这个 flaky 测试
```

续上次会话：

```
/codexhale:rescue --resume 继续上次的修复
```

> 何时用 rescue、何时留给 Claude，见 `plugins/codexhale/README.md` 的「When to use which model」一节。一句话：批量可后台的活给 rescue，单行小改留给 Claude。

---

## 8. 故障排查

### `codewhale: command not found`（Windows）

npm 全局 bin 没在 PATH 里。确认 `npm config get prefix` 指向的目录下的 `codewhale.cmd` 所在路径已加入系统 PATH，或重启终端。

### `codewhale doctor` 报 key 被拒

环境里有错误的 key 覆盖了配置。检查并清除 `DEEPSEEK_API_KEY` 等环境变量，或 `codewhale auth set --provider deepseek` 重新设。

### review 报 `sandbox.denied` 或 shell 不执行

`allow_shell` 没开。回到 1.2。

### `/codexhale:review` 跑出来只有 `[cw]` 没有 `[codex]`

codex 没装或没登录。`codex --version` / `codex login` 检查。companion 用 `Promise.allSettled`，codex 挂了不会让整个 review 失败，只是降级单模型。

### Stop hook 把 Claude 卡住了

gate 只在发现 critical/high 时 block，且每次 block 会把问题回灌给 Claude 让它修。如果陷入循环，关掉 gate：`/codexhale:setup --disable-review-gate`。

### 插件改了代码不生效

会话内跑 `/reload-plugins`。如果是 marketplace 安装且改了 `plugins/codexhale/` 下文件，reload 即可；改了 marketplace.json 才需要重新 `/plugin marketplace add`。

### `--plugin-dir` 加载报错

确认路径指向 `plugins/codexhale`（里面有 `.claude-plugin/plugin.json`），而不是仓库根。根目录只有 marketplace.json，不是插件本身。

---

## 9. 卸载

```
/plugin uninstall codexhale
```

或停止用 `--plugin-dir` 启动即可。

清理插件状态（可选）：

```bash
rm -rf ~/.codexhale-cc
```

（`~/.codewhale/` 是 CodeWhale 自己的，别删，删了 codewhale 本体配置也没了。）
