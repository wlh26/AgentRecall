# SSH Optional CLI Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SSH 环境能够索引、查看和恢复 TClaude、TCodex、CodeBuddy CLI 会话，并保留三个来源的独立身份。

**Architecture:** 远程 collector 使用来源描述符扫描五类目录，摘要和按需详情 payload 都携带具体 `SessionSource`。Claude/TClaude、Codex/TCodex 复用各自解析族，CodeBuddy 增加可接收 rows 的 Loader；watcher、健康检查和 Resume 预检使用同一份来源映射。

**Tech Stack:** TypeScript、Vitest、Electron、Node.js、远端 Python 3 collector、OpenSSH、inotifywait/fswatch。

## Global Constraints

- 支持 `~/.tclaude/projects/**/*.jsonl`、`~/.tcodex/sessions/**/*.jsonl`、`~/.codebuddy/projects/**/*.jsonl`。
- 来源必须分别保存为 `tclaude-cli`、`tcodex-cli`、`codebuddy-cli`，不得降级成 `claude-cli` 或 `codex-cli`。
- 首次 SSH 同步只传摘要，完整 JSONL 仍按需拉取。
- 缺少 CLI、目录或单个损坏文件不得阻断其他来源。
- Optional sources 默认值保持不变；远程 collector 只扫描已开启的扩展来源，关闭后清理已索引的对应来源。
- 单次扫描总量继续受 `MAX_SESSION_FILES = 2500` 限制。
- 最终分支只保留一份 `.release-notes/ssh-tclaude-tcodex.md`，交付前删除本设计和计划文件。

---

### Task 1: 让远程 Loader 保留具体来源

**Files:**
- Modify: `src/core/session-loader.ts`
- Modify: `src/core/remote-session-loader.ts`
- Test: `src/core/session-loader.test.ts`
- Test: `src/core/remote-session-loader.test.ts`

**Interfaces:**
- Produces: `loadCodeBuddyCliSessionRows(filePath, rows, stat): LoadedSession | null`
- Produces: `RemoteSessionFilePayload.source?: SessionSource`
- Produces: `scopeRemoteSession(loaded, environment, source): LoadedSession`，会话键格式为 `ssh:<environment-id>:<source>:<raw-id>`。

- [ ] **Step 1: 为 CodeBuddy rows Loader 写失败测试**

在 `src/core/session-loader.test.ts` 增加直接传入 JSON rows 的用例：

```ts
it("loads CodeBuddy rows without a temporary file", () => {
  const rows = [
    { type: "ai-title", aiTitle: "远程 CodeBuddy", sessionId: "cb-remote", cwd: "/repo" },
    {
      id: "user-1",
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "远程问题" }],
      sessionId: "cb-remote",
      cwd: "/repo",
      timestamp: 1_780_000_000_000,
    },
  ];
  const loaded = loadCodeBuddyCliSessionRows(
    "/home/me/.codebuddy/projects/repo/cb-remote.jsonl",
    rows,
    { mtimeMs: 1_780_000_000_000, size: 100 },
  );
  expect(loaded?.session).toMatchObject({
    rawId: "cb-remote",
    source: "codebuddy-cli",
    originalTitle: "远程 CodeBuddy",
    projectPath: "/repo",
  });
});
```

- [ ] **Step 2: 运行测试并确认红灯**

Run: `npx vitest run src/core/session-loader.test.ts`

Expected: FAIL，提示 `loadCodeBuddyCliSessionRows` 未导出。

- [ ] **Step 3: 提取 CodeBuddy rows Loader**

在 `src/core/session-loader.ts` 中让文件入口只负责读文件：

```ts
export function loadCodeBuddyCliSessionRows(
  filePath: string,
  rows: unknown[],
  stat: VirtualSessionFileStat,
): LoadedSession | null {
  if (rows.length === 0) return null;
  const fallbackRawId = path.basename(filePath, ".jsonl");
  const meta = firstCodeBuddySessionMeta(rows, fallbackRawId);
  const messages = extractMessages(rows, "codebuddy");
  const tokenEvents = extractCodeBuddyTokenEvents(rows);
  const traceEvents = extractTraceEvents(rows, "codebuddy");
  const question = firstQuestion(messages);
  return {
    session: createIndexedSession({
      keyPrefix: "codebuddy",
      rawId: meta.rawId,
      source: "codebuddy-cli",
      projectPath: meta.projectPath,
      filePath,
      originalTitle: firstAiTitle(rows) || cleanTitle(question) || "Untitled Session",
      firstQuestion: cleanTitle(question),
      timestamp: meta.timestamp,
      tokenUsage: tokenUsageFromEvents(tokenEvents),
      stat,
    }),
    messages,
    tokenEvents,
    traceEvents,
  };
}

export function loadCodeBuddyCliSessionFile(filePath: string, stat = safeStat(filePath)): LoadedSession | null {
  return loadCodeBuddyCliSessionRows(filePath, readJsonl(filePath), stat);
}
```

- [ ] **Step 4: 为三个远程来源写失败测试**

在 `src/core/remote-session-loader.test.ts` 参数化 TClaude、TCodex、CodeBuddy payload：

```ts
it.each([
  ["tclaude-cli", "claude-project", "/home/me/.tclaude/projects/repo/tc.jsonl", claudeRows, "tclaude-cli"],
  ["tcodex-cli", "codex-session", "/home/me/.tcodex/sessions/2026/07/15/rollout.jsonl", codexRows, "tcodex-cli"],
  ["codebuddy-cli", "codebuddy-project", "/home/me/.codebuddy/projects/repo/cb.jsonl", codeBuddyRows, "codebuddy-cli"],
])("loads remote %s payloads", (source, kind, filePath, rows, expectedSource) => {
  const [loaded] = loadRemoteSessionPayloads(environment, [{
    source,
    kind,
    path: filePath,
    mtimeMs: 100,
    size: 200,
    content: rows.map(JSON.stringify).join("\n"),
  } as RemoteSessionFilePayload]);
  expect(loaded.session.source).toBe(expectedSource);
  expect(loaded.session.sessionKey).toBe(`ssh:ssh-devbox:${expectedSource}:${loaded.session.rawId}`);
});
```

- [ ] **Step 5: 运行测试并确认来源被错误归类**

Run: `npx vitest run src/core/session-loader.test.ts src/core/remote-session-loader.test.ts`

Expected: FAIL，远程 payload 类型不接受 `source/codebuddy-project`，TClaude/TCodex 仍成为基础来源。

- [ ] **Step 6: 实现来源感知的远程 Loader**

在 `src/core/remote-session-loader.ts`：

```ts
export type RemoteSessionFileKind =
  | "codex-session"
  | "codex-index"
  | "claude-project"
  | "claude-session-index"
  | "codebuddy-project";

export interface RemoteSessionFilePayload {
  kind: RemoteSessionFileKind;
  source?: SessionSource;
  path: string;
  mtimeMs: number;
  size: number;
  content: string;
}

function payloadSource(payload: RemoteSessionFilePayload): SessionSource {
  if (payload.source) return payload.source;
  if (payload.kind === "codex-session") return "codex-cli";
  if (payload.kind === "codebuddy-project") return "codebuddy-cli";
  return "claude-cli";
}
```

Claude payload 调用 `loadClaudeCliSessionRows(..., { source: payloadSource(payload) })`，Codex payload 传 `sourceOverride: payloadSource(payload)`，CodeBuddy payload 调用新 rows Loader。`scopeRemoteSession` 接收具体 source 并生成独立键。

- [ ] **Step 7: 运行定向测试并提交**

Run: `npx vitest run src/core/session-loader.test.ts src/core/remote-session-loader.test.ts`

Expected: PASS。

```bash
git add src/core/session-loader.ts src/core/session-loader.test.ts src/core/remote-session-loader.ts src/core/remote-session-loader.test.ts
git commit -m "feat: preserve optional CLI sources in remote loaders"
```

---

### Task 2: 扩展轻量远程 collector

**Files:**
- Modify: `src/core/remote-sync.ts`
- Modify: `src/main/index.ts`
- Test: `src/core/remote-sync.test.ts`

**Interfaces:**
- Consumes: `RemoteSessionFilePayload.source?: SessionSource`
- Produces: `RemoteSessionSummaryPayload.source?: SessionSource`
- Produces: `RemoteSyncOptions.enabledOptionalSources?: SessionSource[]`
- Produces: Python `emit_claude_summary(path, stat, index, source)`、`emit_codex_summary(path, stat, titles, source)`、`emit_codebuddy_summary(path, stat)`。

- [ ] **Step 1: 写五来源 collector 失败测试**

用临时 HOME 创建五个最小 JSONL，再执行测试中解出的 Python collector：

```ts
expect(summaries.map((item) => [item.source, item.rawId])).toEqual(expect.arrayContaining([
  ["claude-cli", "claude-1"],
  ["codex-cli", "codex-1"],
  ["tclaude-cli", "tclaude-1"],
  ["tcodex-cli", "tcodex-1"],
  ["codebuddy-cli", "codebuddy-1"],
]));
```

再验证相同 raw ID 可以并存：

```ts
expect(store.getSession("ssh:ssh-devbox:claude-cli:same-id")).not.toBeNull();
expect(store.getSession("ssh:ssh-devbox:tclaude-cli:same-id")).not.toBeNull();
```

增加开关边界测试：同一份 TClaude 摘要在 `enabledOptionalSources: []` 时不进入 store，传入 `["tclaude-cli"]` 后才被索引。捕获 collector script，断言关闭时没有 `.tclaude` source descriptor，开启时存在。

- [ ] **Step 2: 运行测试并确认只发现 Claude/Codex**

Run: `npx vitest run src/core/remote-sync.test.ts`

Expected: FAIL，三个扩展来源缺失。

- [ ] **Step 3: 为摘要协议增加来源字段**

```ts
export interface RemoteSessionSummaryPayload {
  kind: "codex-session" | "claude-project" | "codebuddy-project";
  source?: SessionSource;
  // existing fields stay unchanged
}

function summarySource(summary: RemoteSessionSummaryPayload): SessionSource {
  if (summary.source) return summary.source;
  if (summary.kind === "codex-session") return "codex-cli";
  if (summary.kind === "codebuddy-project") return "codebuddy-cli";
  return "claude-cli";
}
```

`remoteSummaryToIndexedSession` 使用 `source`，键改为 `ssh:${environment.id}:${source}:${summary.rawId}`。

- [ ] **Step 4: 用 Python 来源描述符扫描五个目录**

`RemoteSyncOptions` 增加 `enabledOptionalSources`。构造 collector command 时把它序列化成 Python `enabled_optional_sources` 集合，再定义候选来源：

```py
sources = [
  ("codex-session", "codex-cli", home / ".codex" / "sessions", "*.jsonl"),
  ("claude-project", "claude-cli", home / ".claude" / "projects", "*.jsonl"),
]
optional_sources = [
  ("claude-project", "tclaude-cli", home / ".tclaude" / "projects", "*.jsonl"),
  ("codex-session", "tcodex-cli", home / ".tcodex" / "sessions", "*.jsonl"),
  ("codebuddy-project", "codebuddy-cli", home / ".codebuddy" / "projects", "*.jsonl"),
]
sources.extend(item for item in optional_sources if item[1] in enabled_optional_sources)
```

候选项保存 `(mtime, kind, source, path, size)`，全来源合并排序后只取前 `MAX_SESSION_FILES`。Claude/Codex emit 函数把 `source` 写入 JSON；CodeBuddy emit 读取 `sessionId/cwd/timestamp/aiTitle`、message rows 和 `providerData.usage`，输出相同摘要字段。

- [ ] **Step 5: 让共享 Python parser 支持 CodeBuddy**

在 `parse_message` 中增加：

```py
if kind == "codebuddy":
  if row.get("type") != "message" or row.get("role") not in {"user", "assistant"}:
    return None
  text = text_from_blocks(row.get("content"))
  role = row.get("role")
  if not text or (role == "user" and not meaningful_user(text)):
    return None
  return {"role": role, "content": text, "timestamp": row.get("timestamp")}
```

`text_from_blocks` 同时接受 `text/input_text/output_text`。CodeBuddy token 汇总与 TypeScript Loader 一致：input 扣 cached、output 扣 reasoning，`totalTokens` 保持原总数。

- [ ] **Step 6: 从主进程传入当前 Optional sources**

在 `src/main/index.ts` 增加纯映射函数，并让 lifecycle 的每次同步读取最新设置：

```ts
function enabledRemoteOptionalSources(settings: AppSettings): SessionSource[] {
  return [
    ...(settings.includeTclaude ? ["tclaude-cli" as const] : []),
    ...(settings.includeTcodex ? ["tcodex-cli" as const] : []),
    ...(settings.includeCodeBuddyCli ? ["codebuddy-cli" as const] : []),
  ];
}

syncRemoteEnvironment(store, environment, {
  enabledOptionalSources: enabledRemoteOptionalSources(getSettings()),
});
```

手动刷新和 watcher 都通过 `RemoteEnvironmentLifecycle` 的同一 closure 调用，因此设置变更后下一次同步使用新值。已有 `pruneDisabledOptionalSources` 继续负责清理关闭来源。

- [ ] **Step 7: 运行定向测试并提交**

Run: `npx vitest run src/core/remote-sync.test.ts`

Expected: PASS，包括五来源、同 ID 隔离、Token 事件和 2500 总量限制。

```bash
git add src/core/remote-sync.ts src/core/remote-sync.test.ts src/main/index.ts
git commit -m "feat: collect optional CLI sessions over SSH"
```

---

### Task 3: 修复按需文件拉取和消息分页

**Files:**
- Modify: `src/core/remote-sync.ts`
- Modify: `src/core/remote-session-loader.ts`
- Test: `src/core/remote-sync.test.ts`
- Test: `src/core/remote-session-loader.test.ts`

**Interfaces:**
- Consumes: `SessionSearchResult.source`
- Produces: `remoteFamilyForSource(source): "claude" | "codex" | "codebuddy"`
- Produces: 文件 payload 中的 `source` 和显式 `kind`。

- [ ] **Step 1: 写三个扩展来源的文件拉取失败测试**

```ts
it.each([
  ["tclaude-cli", "claude-project"],
  ["tcodex-cli", "codex-session"],
  ["codebuddy-cli", "codebuddy-project"],
])("fetches %s files with an explicit source", async (source, kind) => {
  const payload = await fetchRemoteSessionFilePayload(environment, {
    source,
    filePath: `/home/me/private/${source}.jsonl`,
  } as SessionSearchResult, { runSsh: executeDecodedPython });
  expect(payload).toMatchObject({ source, kind });
});
```

- [ ] **Step 2: 写三个扩展来源的分页失败测试**

分别用 Claude、Codex、CodeBuddy rows 调用 `fetchRemoteSessionMessagePage`，断言用户/助手消息顺序和尾部分页：

```ts
expect(messages.map((message) => [message.role, message.content])).toEqual([
  ["user", "remote question"],
  ["assistant", "remote answer"],
]);
```

- [ ] **Step 3: 运行测试并确认目录后缀推断错误**

Run: `npx vitest run src/core/remote-sync.test.ts src/core/remote-session-loader.test.ts`

Expected: FAIL，TClaude/TCodex 来源丢失，CodeBuddy 使用错误 parser。

- [ ] **Step 4: 显式传递来源和解析族**

```ts
function remoteFamilyForSource(source: SessionSource): "claude" | "codex" | "codebuddy" {
  if (source === "codebuddy-cli") return "codebuddy";
  if (source === "claude-cli" || source === "claude-app" || source === "claude-internal" || source === "tclaude-cli") return "claude";
  return "codex";
}

function remoteKindForSource(source: SessionSource): RemoteSessionFileKind {
  const family = remoteFamilyForSource(source);
  if (family === "claude") return "claude-project";
  if (family === "codebuddy") return "codebuddy-project";
  return "codex-session";
}
```

`buildRemoteFileFetchCommand` 接收 `{ path, source, kind }` 的 JSON request，经 base64 注入 Python；Python 原样返回 `source/kind`，不再检查 `.claude/projects` 或 `.json`。`buildRemoteMessagePageCommand` 使用 `remoteFamilyForSource`。

- [ ] **Step 5: 运行定向测试并提交**

Run: `npx vitest run src/core/remote-sync.test.ts src/core/remote-session-loader.test.ts`

Expected: PASS。

```bash
git add src/core/remote-sync.ts src/core/remote-sync.test.ts src/core/remote-session-loader.ts src/core/remote-session-loader.test.ts
git commit -m "fix: keep SSH session sources during detail loading"
```

---

### Task 4: 扩展 watcher、健康检查和 Resume 预检

**Files:**
- Modify: `src/core/remote-watch.ts`
- Modify: `src/core/remote-health.ts`
- Test: `src/core/remote-watch.test.ts`
- Test: `src/core/remote-health.test.ts`

**Interfaces:**
- Produces: `resumeCliForSource(source): "claude" | "codex" | "tclaude" | "tcodex" | "codebuddy"`
- Produces: watcher shell command只把存在路径传给 inotifywait/fswatch。

- [ ] **Step 1: 写 watcher 失败测试**

导出纯函数 `buildRemoteWatchCommand()` 并验证命令包含扩展目录、存在性过滤和轮询退出码：

```ts
const command = buildRemoteWatchCommand();
expect(command).toContain("$HOME/.tclaude/projects");
expect(command).toContain("$HOME/.tcodex/sessions");
expect(command).toContain("$HOME/.tcodex/session_index.jsonl");
expect(command).toContain("$HOME/.codebuddy/projects");
expect(command).toContain('[ -e "$path" ]');
expect(command).toContain("exit 86");
```

- [ ] **Step 2: 写 Resume CLI 映射失败测试**

```ts
it.each([
  ["tclaude-cli", "tclaude"],
  ["tcodex-cli", "tcodex"],
  ["codebuddy-cli", "codebuddy"],
])("preflights %s with %s", async (source, binary) => {
  await preflightRemoteSessionResume(environment, { ...session, source } as SessionSearchResult, {
    runSsh: async (_environment, command) => {
      const script = decodePythonCommand(command);
      expect(script).toContain(`cli = "${binary}"`);
      return JSON.stringify({ fileExists: true, fileReadable: true, projectExists: true, cliPath: `/bin/${binary}` });
    },
  });
});
```

- [ ] **Step 3: 运行测试并确认旧映射失败**

Run: `npx vitest run src/core/remote-watch.test.ts src/core/remote-health.test.ts`

Expected: FAIL，watcher 不含扩展路径，TClaude/TCodex 分别检查了 `claude/codex`。

- [ ] **Step 4: 实现存在路径 watcher**

远程 shell 先构造候选路径并筛选存在项：

```sh
set --
for path in "$HOME/.codex/sessions" "$HOME/.codex/session_index.jsonl" "$HOME/.claude/projects" "$HOME/.claude/sessions" "$HOME/.tclaude/projects" "$HOME/.tcodex/sessions" "$HOME/.tcodex/session_index.jsonl" "$HOME/.codebuddy/projects"; do
  if [ -e "$path" ]; then set -- "$@" "$path"; fi
done
[ "$#" -gt 0 ] || exit 86
```

inotifywait 使用筛选后的 `"$@"`。fswatch 也使用同一列表，避免一个缺失目录让 watcher 立即退出。

- [ ] **Step 5: 修正健康检查和 Resume CLI 映射**

```ts
function resumeCliForSource(source: SessionSource): "codex" | "claude" | "tclaude" | "tcodex" | "codebuddy" {
  if (source === "tclaude-cli") return "tclaude";
  if (source === "tcodex-cli") return "tcodex";
  if (source === "codebuddy-cli") return "codebuddy";
  if (source.startsWith("claude")) return "claude";
  return "codex";
}
```

`diagnoseRemoteEnvironment` 的 Python payload 增加三个 CLI 路径和三个目录状态，检查列表使用明确 label。已有五项检查保持，新增项追加在后面。

- [ ] **Step 6: 运行定向测试并提交**

Run: `npx vitest run src/core/remote-watch.test.ts src/core/remote-health.test.ts src/core/platform.test.ts`

Expected: PASS。

```bash
git add src/core/remote-watch.ts src/core/remote-watch.test.ts src/core/remote-health.ts src/core/remote-health.test.ts
git commit -m "feat: watch and diagnose SSH optional CLI sessions"
```

---

### Task 5: 发布说明、DevCloud 冒烟和全量验证

**Files:**
- Create: `.release-notes/ssh-tclaude-tcodex.md`
- Delete before delivery: `docs/superpowers/specs/2026-07-15-ssh-optional-cli-sessions-design.md`
- Delete before delivery: `docs/superpowers/plans/2026-07-15-ssh-optional-cli-sessions.md`

**Interfaces:**
- Consumes: 完成后的 collector command、详情 fetch 和 Resume preflight。
- Produces: 用户可见发布说明、可复现 DevCloud SSH 冒烟证据、干净的最终分支。

- [ ] **Step 1: 添加唯一发布说明**

```md
# SSH 扩展 CLI 会话支持

## 新增功能

- SSH 远程环境现在可以搜索和查看 TClaude、TCodex、CodeBuddy CLI 会话，并能识别各自的来源和恢复命令。
```

- [ ] **Step 2: 在 DevCloud 创建隔离 fixture**

使用 `/tmp/agent-session-search-ssh-smoke-home` 作为 HOME，创建五类最小 JSONL；不读取或复制 `/root` 下的凭证和已有会话。通过当前分支提取 collector Python 并运行：

```bash
ssh devcloud 'HOME=/tmp/agent-session-search-ssh-smoke-home python3 /tmp/agent-session-search-collector.py'
```

Expected: 五条摘要分别含 `claude-cli`、`codex-cli`、`tclaude-cli`、`tcodex-cli`、`codebuddy-cli`。

- [ ] **Step 3: 验证真实 CLI 预检**

对隔离 fixture 的三个扩展来源运行远程 preflight command。

Expected: `tclaude`、`tcodex`、`codebuddy` 均返回非空 `cliPath`；不启动交互 Resume，不触碰认证数据。

- [ ] **Step 4: 清理 DevCloud fixture**

```bash
ssh devcloud 'rm -rf /tmp/agent-session-search-ssh-smoke-home /tmp/agent-session-search-collector.py'
```

Expected: 两个临时路径不存在，`/root/.codebuddy` 未修改。

- [ ] **Step 5: 运行完整验证**

Run:

```bash
npm run typecheck
npm test
npm run build
npm run release-note:check
git diff --check
```

Expected: typecheck、全部 Vitest、脚本测试、MCP/Electron 构建、发布说明检查全部通过。若沙箱测试出现 `listen EPERM 127.0.0.1`，在宿主环境重跑同一 `npm test` 后再判断结果。

- [ ] **Step 6: 删除临时设计材料并提交**

使用 `apply_patch` 删除两份 `docs/superpowers/` 文件，然后验证最终 diff 只有产品代码、测试和一份 release note。

```bash
git add src .release-notes docs/superpowers
git commit -m "feat: support optional CLI sessions over SSH"
git status --short
```

Expected: worktree clean；相对 `origin/main` 不含 `docs/superpowers/` 新文件。

- [ ] **Step 7: 请求代码审查并准备 Draft PR**

使用 `superpowers:requesting-code-review` 检查需求覆盖、协议兼容、路径安全和验证证据。修复阻塞项后推送 `feat/ssh-tclaude-tcodex`，创建目标为 `main` 的 Draft PR，并在正文关联 Issue #74。
