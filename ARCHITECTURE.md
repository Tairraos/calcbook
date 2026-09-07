# 架构地图

状态：有效 · 负责人：项目维护者 · 核验日期：2026-09-07

一个桌面进程、一个窗口、一份工作区。保持计算可独立验证，持久化边界清晰，UI 可直接由浏览器驱动。

```text
App.tsx + useWorkspace.ts（编排、生命周期、快捷键）
  ├─ ui/        → domain/（展示、编辑器、普通计算器）
  └─ platform/  → domain/（校验模型、浏览器/原生存储与导出）
                      ↑
src-tauri/      ← invoke（固定命令、系统路径、原子写入、保存对话框）
```

## 模块职责

| 位置 | 职责 | 禁止 |
| --- | --- | --- |
| `src/domain/calculation.ts` | 逐行语义、x/括号别名、AST 白名单、BigNumber/Unit、两种显示精度 | DOM、I/O、React、任意脚本执行 |
| `src/domain/keypad.ts` | 普通计算器的确定性状态转换 | 自己实现第二套数学语义 |
| `src/domain/notebook.ts` | 工作区结构、旧主题迁移、两套主题与显示偏好校验 | 获取时间、生成 ID、读写数据 |
| `src/ui/` | 原生 textarea 镜像、结果、按键、帮助与设置 dialog | Tauri、localStorage、文件系统 |
| `src/platform/storage.ts` | 平台分支、数据校验、关闭保护、导出、目录选择、打开项目链接 | 组件状态、业务计算 |
| `src/useWorkspace.ts` | 先读后写、串行保存、成功/失败状态 | 静默吞掉最终保存失败 |
| `src-tauri/src/storage.rs` | 持久化、备份、旧路径迁移、配置提交与目录切换 | 使用前端提供的数据路径 |

`scripts/check-repo.mjs` 通过 TypeScript AST 检查静态/动态 import、平台 API 越界和危险执行。边界内不强制仓储接口、依赖注入、全局 store 或额外的分层。

## 数据流与可靠性

1. 从平台加载 `Workspace(version=1)`，校验版本、字段、ID 唯一性、当前笔记引用及尺寸。
2. 只有不存在数据时才创建示例。无法读取、格式错误或版本超前时保留原始数据并显示重试入口。
3. 用户编辑立即更新内存，所有保存通过同一 Promise 队列顺序提交；只有最新保存成功才显示「已保存」。
4. Rust 以互斥锁串行访问固定文件：先写临时文件并同步，验证旧文件，保留一份 `.bak`，再原子替换。
5. 原生窗口关闭请求会等待保存；失败时保留窗口。浏览器离开时对未保存状态触发原生提示。
6. 删除是 `trashed=true`，可随时恢复；没有自动清理或永久删除。
7. 工作区继续使用 version 1；旧主题 `light`/`sand`/`mist` 迁移为 `paper`，`dark`/`forest`/`graphite` 迁移为 `midnight`，缺失 `calculatorMode` 时采用 `sidebar`。非法配置仍报错。

工作区没有保存计算结果，结果始终从源文本推导。变量仅在一篇笔记中自上而下有效。计算器状态由 App 持有，在边栏/弹窗切换、收起后保留，重启后清空。

## 存储位置与切换

- 默认笔记位于 `~/.calcbook/workspace.json`；上一快照为 `workspace.json.bak`。
- 系统 app config 目录中的 `settings.json` 仅记住 `dataDirectory`。macOS 该配置目录也是旧版笔记目录；首次加载默认目录且文件缺失时，复制校验通过的旧工作区，保留旧文件。
- 用户选择路径由 Rust 系统文件夹对话框产生。前端先 flush 保存队列；Rust 获得存储锁后读取最新文件、检查目标、复制完整工作区，最后通过临时文件与 rename 提交目录配置。
- 目标有不同或损坏的工作区时拒绝覆盖；配置写入失败时仍使用原目录。已配置目录的工作区丢失时明确报错，不悄悄创建示例。
- 调试构建可同时用 `CALCBOOK_CONFIG_DIR`、`CALCBOOK_DATA_DIR` 隔离路径，此时不迁移正式数据。普通开发启动与发行版都默认使用 `~/.calcbook`。

## 平台与安全边界

生产 CSP 只允许打包资源与 Tauri IPC。没有网络访问、遥测、远程字体或用户 HTML 渲染。表达式不是 JavaScript：mathjs 节点类型、运算符、函数、符号逐一校验，并限制长度、深度、节点数和指数。

Rust 暴露六个固定命令：读取、保存、导出、读取存储位置、选择存储目录、打开项目链接。导出与目录选择均使用系统对话框；前端不能直接给出任意文件路径。GitHub 通过原生 opener 打开固定项目地址，不授予前端任意 shell 权限。窗口权限只覆盖本地 `main` 窗口。

关于信息由 Vite 在构建时注入版本、UTC 构建时间和 GitHub URL；界面按用户本地时间显示。版本来源为 package.json，仓库检查要求它与 Tauri/Cargo 版本一致。

详见 [语言契约](docs/product-specs/calculation-language.md)、[工作闭环](docs/harness.md) 和 [已知边界](docs/exec-plans/tech-debt.md)。
