# 0002 · 笔记内查找替换

状态：待启动 · 负责人：项目维护者 · 核验日期：2026-10-01

## 目标

在笔记编辑器内提供 VS Code 风格的查找替换：正则开关、大小写开关、全词（whole word）开关，支持逐个导航、单个替换与全部替换。保留原生撤销栈与中文输入法行为，不引入编辑器框架。

## 范围决策（2026-10-01）

- 作用域为**当前打开的笔记正文**。跨笔记搜索不做（侧栏已有标题+正文过滤，⌘K）。
- 编辑器是自绘 `<textarea>` + 高亮镜像（`src/ui/Editor.tsx`），无 CodeMirror/Monaco，匹配引擎与工具条全部自研。
- 入口：⌘/Ctrl+F 打开浮动条；Esc 关闭并把焦点还回编辑器。编辑器有选区时打开自动带入选中文本。
- 键盘：Enter 下一个、Shift+Enter 上一个（首尾回绕）；替换行内 Enter 替换当前并前进。
- 废纸篓（只读）模式只显示查找行，不显示替换行。
- 全词开关用 `\b` 边界，与 VS Code 行为一致；中文无词边界，全词对纯中文词不生效，在 UI 规范文档注明。
- 正则模式下替换串支持 `$&`、`$1`–`$9` 捕获组引用（与 VS Code 一致）；非法正则给可见错误提示，不崩溃、不匹配。
- 匹配高亮叠加（镜像层渲染全部匹配、当前匹配醒目）放阶段 B；阶段 A 先以「选中当前匹配 + 计数 n/m」交付核心闭环。

## 工作量评估

总计约 **1.5–2 人日**。阶段 A（核心闭环）约 1 天，阶段 B（高亮与打磨）约 0.5 天。

### 阶段 A · 核心查找替换（约 1 天）

1. `src/domain/search.ts` 纯函数（约 3h 含测试）——符合架构不变量 1（domain 不依赖 React/DOM/Tauri）：
   - `buildMatcher(query, { regex, caseSensitive, wholeWord })` → `{ pattern: RegExp } | { error: string }`。
   - `findMatches(body, pattern)` → `{ start, end }[]`；空匹配（如 `a*`、`^`）命中后前进一位，防死循环。
   - `replaceAllText(body, pattern, replacement)` → `{ text, count }`；正则模式解析 `$&`/`$1`–`$9`，普通模式按字面替换。
   - 循环导航辅助：给定当前光标位置求 next/prev 索引并回绕。
2. `tests/search.test.ts`（node --test，与现有测试同约定）：正则/大小写/全词独立与组合、非法正则、空匹配、跨行匹配、替换引用、含中文与 emoji 的正文。
3. `src/ui/FindReplaceBar.tsx` 浮动条（约 4h）：
   - 查找输入 + 三个切换按钮（Aa 大小写、`\b` 全词、`.*` 正则，aria-pressed + 可访问名称）。
   - 匹配计数 `n/m`（无匹配显示「无结果」）、上一个/下一个、关闭按钮。
   - 可展开的替换行：替换输入、「替换」「全部替换」按钮。
   - 复用现有 `IconButton` 与样式变量；焦点顺序完整，Esc 关闭。
4. Editor/App 集成（约 3h）：
   - App 全局快捷键里加 ⌘/Ctrl+F（preventDefault 拦掉 WebView 原生查找）；`isComposing` 守卫沿用现有写法。
   - 跳转定位：`setSelectionRange(start, end)` 选中匹配；滚动定位垂直方向按行高 34px 计算（`editor-scroll` 容器），水平方向按等宽列宽估算。
   - 单个替换：选中匹配后 `execCommand("insertText")`（沿用格式化的已验证范式，保留原生撤销栈），随后跳到下一个匹配。
   - 全部替换：先走 `onDestructiveChange` 留档，再全选 + `execCommand("insertText")` 整篇替换（一次 Cmd+Z 还原）；`execCommand` 返回 false 时回退 React 状态替换，并复用 `formatUndoRef` 模式提供应用内撤销。
   - 替换后正文超 `MAX_NOTE_LENGTH` 时拒绝并提示。
   - 正文被手动编辑后重算匹配并校正当前序号。

### 阶段 B · 高亮与打磨（约 0.5 天）

5. 高亮镜像叠加全部匹配（当前匹配用醒目色）：把匹配区间按行切分后传入 `Highlight` 渲染。
6. UI 验收与文档：桌面尺寸 + 窄窗口、明暗两套主题实际操作；更新 [界面与交互规范](../../design-docs/ui.md) 与质量证据。

## 风险与对策

- **`execCommand("insertText")` 在某些 WebView 返回 false**（中）：已有格式化功能同款回退路径，直接复用；回退时用应用内撤销兜底。
- **水平滚动定位不准**（低）：正文等宽但 CJK 字符宽度不同，长行混排时列宽估算有偏差；允许近似定位（保证匹配可见即可），验收以实际操作为准。
- **⌘F 与浏览器/WebView 原生查找冲突**（低）：window 级 keydown preventDefault，浏览器预览与 Tauri WKWebView 均已验证现有快捷键可被拦截。
- **空匹配正则死循环**（低）：domain 层前进一位，测试覆盖。

## 验收

- [ ] 三个开关独立生效且可任意组合；切换开关后匹配与计数即时刷新。
- [ ] 非法正则在查找框给出可见错误状态，不崩溃、不清空正文。
- [ ] Enter/Shift+Enter 循环导航且首尾回绕，计数 `n/m` 与实际一致。
- [ ] 单个替换后 Cmd+Z 原生撤销逐步还原；全部替换后一次 Cmd+Z 整体还原，且替换前内容已进入历史留档。
- [ ] 中文输入法组合过程中（isComposing）快捷键不误触发；编辑器撤销/输入法行为无回归。
- [ ] 只读（废纸篓）模式只能查找，不出现替换行。
- [ ] `pnpm check` 全绿；阶段 B 完成匹配高亮叠加。
- [ ] 桌面 .app 明暗主题、窄窗口实际操作验收通过，证据记入本文档。

## 执行记录

- 2026-10-01：评估完成。编辑器为自绘 textarea + 高亮镜像，无现成搜索插件；可复用 `execCommand` 撤销范式、`onDestructiveChange` 留档钩子、domain 纯函数测试约定。版本计划 1.4.7 → 1.5.0（新功能）。

## 完成证据

实施结束后填入实际命令、UI 场景和未验证项。
