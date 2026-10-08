# 0003 · 界面双语（中文 / English）

状态：已完成（2026-10-08 归档，v1.7.0 已发） · 负责人：项目维护者 · 核验日期：2026-10-08

## 目标

在 `bilingual` 分支把整个界面做成中英双语：侧栏设置行、主题按钮旁新增语言按钮，点击在
中文/English 间切换并持久化（`workspace.uiLanguage`）。英文为出厂默认；语言按钮字形显示
切换目标——英文界面显示「中」，中文界面显示「En」（自绘 SVG，currentColor 随主题）。
英文界面下中文单位仍可使用，但结果的单位语言优先级翻转为英文优先。

## 范围决策

- 词典方案：`src/ui/i18n.ts` 单文件两棵同形树（`STRINGS.zh` / `STRINGS.en`），类型保证缺
  译即编译错误；组件经 `makeT(lang)` 取翻译函数，lang 由 App 从 workspace 逐层传入
  （不用全局 store，与现有 props 风格一致）。
- 领域错误消息：`src/domain/messages.ts` 按消息键双语，`calculate` / `evaluateNotebook` /
  `calculateInput` / `parseWorkspace` 增加 `lang` 参数（默认 zh，向后兼容现有测试）。
- 单位语言优先级（英文界面）：设置「单位写法」> 英文小写 > 英文大写 > 中文；中文界面维持
  1.6.20 全序（设置 > 中文 > 英文小写 > 英文大写）。设置强制依然最高。
- 中文写法记忆 `zhUnits` 只在中文界面回涂变量携带的单位；英文界面英文优先、不回涂。
- 计算器子窗：语言经新事件 `calculator://lang` 同步（主题同款机制），浏览器预览读 localStorage。
- 随手算提示行与标题按界面语言（id `scratch/随手算` 固定不变，持久化判定不受影响）。
- 示例笔记、帮助速查里的中文单位别名数据两语言共用（中文写法本身就是数据）；帮助速查的
  说明、示例期望值按语言各给一套（英文界面示例值 = 英文优先引擎输出）。
- 不翻译：用户笔记正文、文件名、日期时间值本身；`parseWorkspace` 加载失败的消息保持中文
  （此时界面语言不可知，老中文用户为主）。

## 验收

- [x] 语言按钮在主题按钮旁；字形/aria 随语言切换；点击切换并持久化（刷新/重启保持）。
- [x] 英文界面全 UI 字符串为英文（侧栏、顶栏、编辑器、四个弹窗、计算器子窗、toast、状态栏）。
- [x] 领域错误消息随界面语言（`foo + 1`：中文「尚未定义」/ 英文 "is not defined"）。
- [x] 英文界面单位语言英文优先（`5米` → `5 m`），设置「单位写法」仍可强制中文。
- [x] 浏览器实操作验收：双语言切换、刷新保持、控制台无错误（800×640 自动化实测）。
- [x] 桌面 .app 实机：语言切换持久化（维护者提供的 1.7.0 桌面实机截图含中英两态，语言按钮/界面/笔记渲染均正确，见 README 双截图）；计算器子窗语言跟随未经专项操作验证，随日常使用确认，异常另开修复。
- [x] `pnpm check` 全绿（120 测试）；`pnpm check:native` 全绿（16 测试）。

## 执行记录

- 2026-10-08：domain 层完成（messages.ts、lang 穿参、en 优先级、zhUnits 门控、uiLanguage
  进 workspace 模式与 Rust Payload/settings/命令）；UI 层完成（i18n 词典 ~200 键、语言按钮
  SVG、App/Editor/FindReplaceBar/Settings/History/Help/CalculatorWindow 全量替换、帮助速查
  双语内容两套）；新增 tests/language.test.ts 5 组。版本 1.7.0。

## 完成证据

- v1.7.0 合入 master 并打 tag 触发四平台 Release 构建。
- `pnpm check` 全绿（120 测试）、`check:native` 全绿（16 测试）；桌面实机中英两态截图进入 README（screenshot-zh/en.png）。
- 未竟事项：计算器子窗语言跟随的桌面专项操作验证，随日常使用确认。
