# Codex App 任务工作区友好名称设计

## 背景

AgentRecall 当前把会话的 `projectPath` 作为项目身份，并取路径最后一级作为左侧项目名称。Codex App 在没有长期项目目录的任务型会话中，会创建类似以下结构的本地工作区：

```text
~/Documents/Codex/2026-07-18/https-ucna5j4m2598-feishu-cn-wiki-afjhwarhmie1btkoelscie1rnog
```

这种目录名适合保证文件系统唯一性，但不适合阅读。用户本机调研得到以下事实：

- `/Users/mac/Documents/Codex` 下有 23 个日期任务目录；
- 19 个目录已经关联 Codex App 会话；
- 每个已关联目录恰好有一个根会话；
- 其余 48 个会话全部是该根会话创建的 subagent；
- 根会话已有可读标题，例如 `Hermes 重写`、`求玉米品质平均值`、`修正树上最大子段和`；
- 目录通常包含 `work/`、`outputs/`，部分任务还包含 `docs/`、`diagrams/`，说明这些目录承担的是单次会话工作区，而不是长期项目身份。

因此，问题的根因是 AgentRecall 把 Codex App 的任务工作区路径末级误当成了用户可读项目名。

## 目标

- 对 Codex App 日期任务工作区，在左侧项目树中显示唯一根会话的可读标题。
- 保持 `projectPath` 作为筛选、Resume、文件定位和环境区分的稳定身份。
- 复用现有会话重命名能力，让用户只维护一份名称。
- 保持普通 Git 项目、普通本地目录、其他 Agent 来源和远程环境的现有项目名称行为。
- 对重复标题提供稳定、可读的消歧信息。

## 非目标

- 不重命名、移动或删除物理目录。
- 不修改 Codex 原始 JSONL 或 `session_index.jsonl`。
- 不增加 AI 命名请求。
- 不新增项目别名表、项目重命名 IPC 或设置项。
- 不改变项目筛选键、会话键、Resume 命令或文件定位行为。
- 不把 subagent 标题作为项目名称候选。

## 术语

- **根会话**：`is_subagent = 0` 的会话。
- **任务工作区**：Codex App 为单次本地任务创建的日期目录，路径末尾符合 `Codex/YYYY-MM-DD/<任务目录>`。
- **友好名称**：左侧项目树中展示给用户的项目 `label`。它只影响显示，不改变项目身份。

## 任务工作区识别

只有同时满足以下条件，项目才使用根会话标题作为友好名称：

1. 项目聚合结果中恰好存在一个根会话；
2. 该根会话的 `source` 是 `codex-app`；
3. 规范化路径末尾符合 `Codex/YYYY-MM-DD/<非空目录名>`；`Codex` 段按 ASCII 不区分大小写比较；
4. 日期段是有效的 ISO 日历日期，而不只是形似 `YYYY-MM-DD` 的字符串。

路径识别同时接受 `/` 和 `\` 分隔符，不硬编码用户主目录，也不要求目标目录仍然存在。历史目录被删除后，AgentRecall 仍可根据已索引路径和标题显示友好名称。

以下情况继续使用当前目录名称逻辑：

- 找不到根会话；
- 同一项目路径存在多个根会话；
- 唯一根会话来自 `codex-cli`、Claude 或其他来源；
- 路径不符合任务工作区结构；
- 日期段无效。

官方 Codex 文档允许通过 deep link 或 `codex app PATH` 为新会话指定任意绝对工作区路径，但没有把自动生成目录的完整命名规则声明为稳定接口。因此，本设计不根据 `codex-app` 来源单独推断任务工作区，也不把 `/Users/mac/Documents/Codex` 作为固定常量。

## 名称来源与优先级

任务工作区的友好名称使用唯一根会话的现有 `displayTitle`。当前 `displayTitle` 已实现以下优先级：

1. 用户在 AgentRecall 中设置的 `customTitle`；
2. Codex `session_index.jsonl` 中的 `thread_name`；
3. Codex 会话元数据中的标题；
4. 第一条有效用户消息的首个非空行，最多 120 个字符；
5. `Untitled Session`。

项目列表不再复制这套标题清洗逻辑，而是从已有会话字段中按同样顺序生成候选名称。空字符串和纯空白值不作为有效标题。

当所有标题来源均为空或只得到通用的 `Untitled Session` 时，项目名称显示为本地化的未命名占位符，并附带唯一根会话最早一条有效消息的时间：

```text
未命名会话 · 07-19 19:25
```

英文界面显示：

```text
Untitled session · 07-19 19:25
```

如果唯一根会话没有正数的消息时间戳，未命名占位符改用任务目录 basename 作为后缀。该后缀只用于显示，不会暴露、重命名或修改物理目录；完整物理路径继续保留在项目行的 `title` 提示和会话详情中。

为了让 core 层保持与语言无关，`ProjectSummary` 增加结构化的 `labelKind` 和 `labelSuffix`。`label` 保存基础名称，`labelSuffix` 保存可选的环境、日期、时间、basename、唯一父路径片段或最终原始路径消歧后缀。渲染器在 `labelKind: "codex-task-untitled"` 时根据当前语言生成“未命名会话”或“Untitled session”，其他情况直接使用 `label`，最后统一拼接 `labelSuffix`。普通路径标签和有标题的任务标签分别使用 `labelKind: "path"` 与 `labelKind: "codex-task-title"`。

## 数据流

### 索引阶段

会话加载和写库流程保持不变。Codex 标题仍按现有规则写入 `original_title`，用户名称仍写入 `custom_title`，subagent 关系仍写入 `is_subagent`。

### 项目聚合阶段

`SessionStore.listProjects()` 在现有按 `project_path` 和 `environment_id` 聚合的查询中增加以下根会话信息：

- 根会话数量；
- 唯一根会话来源；
- 唯一根会话的 `custom_title`、`original_title`、`first_question`；
- 唯一根会话在 `message_events` 中最早的正数时间戳，内部命名为 `root_started_at` / `rootStartedAt`。

稳定开始时间使用相关子查询读取，不把 `message_events` 直接连接到项目聚合，因此不会放大 `root_count` 或 `session_count`。加载器和 `IndexedSession.timestamp` 的现有含义保持不变；重新索引只改变该索引时间时，项目标签后缀不会变化。

聚合完成后：

1. 先按“任务工作区识别”规则判断是否可使用友好名称；
2. 可使用时按“名称来源与优先级”得到基础名称；
3. 不可使用时沿用当前 `projectLabel()` 和重复 basename 的父目录消歧逻辑；
4. 最终只改变 `ProjectSummary` 的显示字段 `label`、`labelKind` 和 `labelSuffix`，`path` 与 `environmentId` 保持不变。

这个实现使用现有数据库字段，不需要 schema migration。

### 渲染与重命名阶段

渲染器通过一个纯展示函数把 `ProjectSummary.label`、`labelKind`、`labelSuffix` 和当前语言解析成左侧名称。项目行、已选筛选标签和项目内搜索提示统一使用该函数，避免同一项目在三个位置显示不同名称。`ProjectSummary.path` 继续作为点击筛选值和悬停提示。

用户重命名根会话后，现有提交逻辑除了刷新会话结果，还必须刷新 sidebar metadata。这样 `custom_title` 保存成功后，左侧项目名称在同一次操作中更新，不需要手动刷新索引。

清空自定义标题时，左侧名称立即回退到 Codex 原生标题或第一条有效问题。

## 重名消歧

友好名称先在同一环境内按不区分大小写的规范化文本统计。只有出现重复时才附加时间信息：

1. 不同日期的同名任务追加 `MM-DD`；
2. 同一天仍然重名时追加 `MM-DD HH:mm`；
3. 如果稳定开始时间缺失，同日标题先保留 `MM-DD`；只有标签仍重复时才追加任务目录 basename。内部 `taskBasenameApplied` 记录该阶段是否已经执行，未命名任务在第一阶段用 basename 兜底后直接进入父片段消歧，不得再次追加 basename；
4. 如果 basename 仍相同，从最近父级向外按相同相对深度查找组内唯一的非空路径片段并追加；没有可用唯一片段时追加原始项目路径，保证结果稳定且唯一。

示例：

```text
调研 OpenCode · 07-18
调研 OpenCode · 07-19 10:32
调研 OpenCode · 07-19 16:48
```

消歧按以下顺序执行：先保留“同一物理路径出现在多个环境”时的环境名称后缀，再在每个环境内部对任务标题执行日期、时间、basename、唯一父路径片段和最终原始路径消歧。环境后缀不参与同一环境内的标题重复计数。

项目排序在现有“本地环境优先、最近活动优先”之后，依次比较基础名称、`labelSuffix ?? ""`、`path` 和 `environmentId`。每个文本键先使用 `localeCompare` 保持自然语言顺序；如果 locale 比较为 0 但原始字符串不同，再按原始 UTF-16 code units 比较，确保 Unicode 规范等价但编码不同的字符串仍构成严格总序。

## 失败与降级

- 根会话数据不完整时回退到当前路径标签，不抛出错误。
- 标题更新失败时沿用现有重命名错误提示，不提前改变项目标签。
- sidebar metadata 刷新失败时保留已经保存的会话名称；下一次成功刷新索引或侧边栏时自动收敛。
- 无效日期、Windows UNC 路径、盘符路径和混合分隔符都必须通过结构化路径分段处理，不能依赖 POSIX-only 的字符串前缀。
- 不读取任务目录正文来猜测名称，避免性能、隐私和目录已删除时的不一致。

## 测试设计

### Store 行为

- Codex App URL slug 任务目录显示根会话标题。
- 代码片段 slug 任务目录显示根会话标题。
- `custom_title` 优先于 Codex 原生标题，并在重新索引后保持。
- 清空 `custom_title` 后回退到原生标题。
- subagent 标题和活动时间不参与名称选择。
- 没有根会话、多个根会话或非 `codex-app` 根会话继续显示目录名。
- 普通 Git 项目即使只有一个 Codex App 会话也继续显示目录名。
- macOS/Linux 路径和 Windows 路径都能识别；无效日期不能识别。
- 目录不存在时仍可从索引元数据生成标签。
- 重复标题使用根会话最早消息时间，重新索引时 `IndexedSession.timestamp` 的变化不会改变后缀。
- 缺失有效消息时间时，有标题任务在发生碰撞时回退到 basename，未命名任务直接使用 basename 后缀。
- 未命名任务已经使用 basename 后，发生碰撞时不会重复追加 basename。
- basename 仍碰撞时使用最近的组内唯一父路径片段；无唯一片段时使用原始项目路径。
- 三个以上碰撞项、不同总深度路径和没有唯一父片段的路径组保持唯一且稳定。
- 无效和纪元前消息时间归一为 0 后被忽略，最早正数消息时间仍作为稳定开始时间。
- 项目文本排序键 locale 相等时按原始 UTF-16 code units 继续比较。
- 匹配日期任务路径的 `codex-cli` 会话仍使用普通路径标签，不进入任务消歧。
- 同一路径跨环境时保留环境名称消歧。

### Renderer 行为

- 根会话重命名成功后调用 sidebar metadata 刷新。
- 清空自定义名称后，项目标签在同一次刷新中回退。
- 项目点击仍以原始 `path + environmentId` 过滤，不以 `label` 过滤。
- 项目行 `title` 继续展示完整物理路径。
- 未命名占位符在中文和英文界面使用对应语言，并在项目行、筛选标签和搜索提示中保持一致。

### 验证命令

实现完成后运行：

```bash
npm run build:mcp
npm run typecheck
npm test
npm run release-note:check
```

涉及安装脚本、Hooks 或会话发现的测试继续使用临时 `HOME`、临时 npm prefix 和合成会话数据。不得读取、改写或删除真实用户会话与配置。

## 发布说明

实现分支添加且只添加一个 `.release-notes/codex-task-workspace-labels.md`。这是用户可见的 Bug 修复，文案描述 Codex App 自动任务目录现在显示可读会话名称，不提及数据库、SQL、路径匹配或内部实现。

## 验收标准

- 用户现有的 Codex App 日期任务目录在左侧显示根会话标题，而不是 URL 或代码片段 slug。
- 用户重命名根会话后，左侧名称立即更新并在重新索引后保留。
- 普通项目、其他来源和项目筛选行为无变化。
- 不发生物理目录、Codex 会话文件或数据库 schema 变更。
- 所有新增和现有验证命令通过。
