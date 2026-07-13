# Codex 额度周期识别修复设计

## 背景

Codex 当前额度接口只返回 `rate_limit.primary_window`，其中 `limit_window_seconds` 为 `604800`（7 天），`secondary_window` 为 `null`。现有解析逻辑把 `primary_window` 固定标记为 `5h`，导致界面把实际 7 天额度错误显示成 5 小时额度。

## 目标

- 根据接口返回的 `limit_window_seconds` 识别额度周期。
- `18000` 秒显示为 `5h`，`604800` 秒显示为 `7d`。
- 兼容旧版同时返回 primary 5h、secondary 7d 的响应。
- 不改动额度请求、认证、缓存和 UI 渲染链路。

## 设计

在 `src/core/quota.ts` 的 Codex 响应解析层增加窗口周期识别：

1. 优先根据 `limit_window_seconds` 选择稳定的额度 key 和 label。
2. 时长为 5 小时或 7 天时分别映射到现有 `five_hour` / `seven_day` 数据模型。
3. 接口未提供窗口时长时，保留现有位置兜底：primary 为 5h，secondary 为 7d，以兼容历史响应。
4. 不影响 `code_review_rate_limit`，其标签仍为 `Review`。

## 测试

- 新增回归测试：只有 primary 窗口且 `limit_window_seconds = 604800` 时，只输出 `7d`。
- 保留并运行旧双窗口测试，验证 primary 5h、secondary 7d 的兼容行为。
- 运行额度模块测试、类型检查和完整测试套件。

## 非目标

- 不改变 Codex 官方接口地址或请求方式。
- 不修改 Claude Code 的 5h / 7d 额度解析。
- 不增加新的设置项或 UI 控件。
