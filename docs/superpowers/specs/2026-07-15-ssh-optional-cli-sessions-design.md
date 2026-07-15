# SSH 扩展 CLI 会话同步设计

## 背景

SSH 远程采集器目前只扫描 `~/.claude` 和 `~/.codex`。本地已经支持 TClaude、TCodex、CodeBuddy CLI，但远程机器上的这些会话不会被索引，文件变化也不会触发同步。Issue #74 要求补齐这部分能力。

本次支持三个远程来源：

- TClaude：`~/.tclaude/projects/**/*.jsonl`
- TCodex：`~/.tcodex/sessions/**/*.jsonl`
- CodeBuddy CLI：`~/.codebuddy/projects/**/*.jsonl`

## 目标

- SSH 环境能够索引、搜索和查看三个扩展 CLI 的会话。
- 会话保留独立来源：`tclaude-cli`、`tcodex-cli`、`codebuddy-cli`，不伪装成 Claude Code 或 Codex。
- 远程详情按需加载，首次同步只传轻量摘要，不传完整会话文件。
- 扩展目录发生变化时触发增量同步；服务器没有相关目录时继续正常工作。
- TClaude、TCodex、CodeBuddy 的远程 Resume 使用各自命令，并在启动前检查正确的 CLI。
- 不改变本地 Optional sources 的默认关闭策略；关闭来源后，现有搜索过滤逻辑继续隐藏对应会话。

## 非目标

- 不把 OpenClaw、Hermes、OpenCode、Cursor Agent、Trae 一并扩展到 SSH。
- 不修改三个 CLI 自身的会话格式。
- 不要求远程机器安装本应用或额外采集服务。
- 不处理 CodeBuddy 新旧 CLI 安装器的升级和替换。

## 方案

### 1. 用来源描述符驱动远程采集

远程采集脚本增加四个字段明确描述每类会话：

- `kind`：解析族，取 `claude-project`、`codex-session`、`codebuddy-project`。
- `source`：具体来源，取 `claude-cli`、`codex-cli`、`tclaude-cli`、`tcodex-cli`、`codebuddy-cli`。
- `root`：会话根目录。
- `pattern`：递归扫描的文件模式。

Claude/TClaude 共用 Claude JSONL 解析器，Codex/TCodex 共用 Codex JSONL 解析器。CodeBuddy 使用现有本地 Loader 已支持的 message、ai-title、providerData usage 结构。采集结果必须携带 `source`，避免根据目录或文件后缀反推来源。

会话键改为 `ssh:<environment-id>:<source>:<raw-id>`。这样同一台机器中 ID 相同的 Claude/TClaude 或 Codex/TCodex 会话不会互相覆盖。

### 2. 摘要、详情和分页保持同一来源

首次同步只返回标题、项目路径、时间、消息数、Token 用量等摘要。远程摘要类型增加 `source`，TypeScript 侧根据来源生成正确的 `SessionSource`。

打开详情时，文件拉取请求同时携带预期来源和解析族。返回值不能再通过 `.claude/projects` 或 `.json` 后缀判断类型。消息分页按解析族读取：

- TClaude 使用 Claude parser。
- TCodex 使用 Codex parser。
- CodeBuddy 使用 CodeBuddy parser。

详情 Loader 分别调用 `loadClaudeCliSessionRows`、`loadCodexSessionRows`、`loadCodeBuddyCliSessionFile` 对应的纯文本/行级入口。若 CodeBuddy 当前只有文件入口，则先提取可接收 JSONL rows 和虚拟 stat 的入口，本地 Loader 也复用它，避免远程落临时文件。

### 3. 监听和降级

远程 watcher 加入：

- `~/.tclaude/projects`
- `~/.tcodex/sessions`
- `~/.tcodex/session_index.jsonl`
- `~/.codebuddy/projects`

`inotifywait` 只能接收存在的路径，因此启动脚本先构造实际存在的目录和索引文件列表。一个扩展 CLI 未安装或尚未生成会话目录时，不得让整个 watcher 失败。没有可监听路径或远程没有 `inotifywait/fswatch` 时，沿用轮询降级。

### 4. 健康检查和 Resume

健康检查展示三个扩展 CLI 的命令和目录状态。Resume 预检按来源映射命令：

- `tclaude-cli` -> `tclaude`
- `tcodex-cli` -> `tcodex`
- `codebuddy-cli` -> `codebuddy`

现有映射把 TClaude 当成 `claude`、TCodex 当成 `codex`，本次一并纠正。实际启动继续复用 `platform.ts` 已有的来源级 Resume 命令构造逻辑。

### 5. 兼容性和边界

- 远程协议解析继续接受没有 `source` 的旧测试 payload，并按原有 `kind` 回退到 Claude/Codex，减少内部兼容风险。
- 单次扫描仍受 `MAX_SESSION_FILES` 限制，所有来源合并后按修改时间排序，避免某个来源绕过总量上限。
- 路径只作为 base64 数据传给远端 Python，不拼接到 shell 命令。
- 远端无相关 CLI、无目录、目录为空或单个 JSONL 损坏时，其他来源仍可同步。

## 测试策略

### 自动化测试

- 远程 collector 同时发现 Claude、Codex、TClaude、TCodex、CodeBuddy，并产生正确 `source`、会话键和摘要。
- 三个扩展来源的详情加载、尾部分页、Token 用量和标题解析。
- 相同 raw ID 跨来源不会覆盖。
- 文件 fetch 不再依赖目录后缀推断来源。
- watcher 只监听存在路径，并包含三个扩展来源。
- Resume 预检查找 `tclaude`、`tcodex`、`codebuddy`。
- 缺目录、空目录、损坏文件和旧 payload 回退。

按 TDD 执行：先写失败测试，再做最小实现，最后重构来源描述符和公共解析逻辑。

### DevCloud 实测

服务器 `devcloud` 已准备 Node.js 22、TClaude、TCodex 和 CodeBuddy CLI。实现后进行：

1. 在三个会话目录放入不含凭证的最小真实格式 fixture，验证 SSH 首次同步。
2. 修改 fixture，验证 watcher 或轮询触发更新。
3. 从应用拉取详情，确认来源、标题、项目路径和消息完整。
4. 运行 Resume 预检，确认找到对应命令；不自动进入需要用户认证的交互会话。
5. 清理测试 fixture，不改动服务器原有 CodeBuddy 数据。

## 验收标准

- 开启对应 Optional source 后，SSH 环境能显示三个来源的会话，并显示正确来源标签。
- 关闭对应来源后，会话不出现在搜索结果中。
- 三个来源可以打开详情，消息数量和尾部内容正确。
- 同 ID 的不同来源会话可以并存。
- 缺少任意 CLI 或目录不会阻断其他远程来源。
- 全量测试、类型检查、构建、发布说明检查通过，并完成一次 `devcloud` SSH 端到端冒烟测试。
