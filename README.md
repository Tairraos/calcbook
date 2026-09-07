# Calcbook

把计算写进笔记。基于 **Tauri 2 + React + TypeScript**，借鉴 Numi 的逐行计算体验，并加入普通计算器。

当前是可运行的本地首版：中文变量、四则运算、百分比、单位换算、分段汇总、笔记管理、自动保存和文本导入导出。设置中可选择存储位置、三套浅色与三套深色主题，以及计算器边栏或弹窗显示；关于信息包含版本、构建时间和 GitHub 链接。

## 启动

需要 Node.js 22.18+（推荐 24 LTS）、pnpm 10.25；桌面还需要 Rust stable 和系统编译工具。macOS 使用 Xcode Command Line Tools。

```sh
pnpm install --frozen-lockfile
pnpm dev                 # http://127.0.0.1:1420
pnpm desktop             # 独立 Tauri 桌面窗口
```

两个命令会使用相同端口，择一运行。浏览器预览使用 localStorage，不能配置本机文件夹。桌面版默认保存到 `~/.calcbook/workspace.json`，通过左下角设置选择其他目录后，会复制当前笔记并将后续保存写入新目录，原文件保留。所选目录已有不同的笔记时会拒绝覆盖。

存储位置配置保存在系统应用配置目录的 `settings.json`（macOS 为 `~/Library/Application Support/com.tairraos.calcbook/`）。首次升级会在默认目录尚无工作区时复制旧应用数据目录中的笔记；损坏数据不会被空笔记覆盖。

开发也使用上述默认位置。做回归时必须显式隔离配置和数据；两个路径都需为绝对路径，发行版不读取这些环境变量：

```sh
CALCBOOK_PORT=1430 \
CALCBOOK_CONFIG_DIR="$PWD/.calcbook-data/config" \
CALCBOOK_DATA_DIR="$PWD/.calcbook-data/workspace" \
pnpm desktop
```

```sh
pnpm check               # 文档/架构 + lint + 类型 + 测试 + 前端构建
pnpm check:native        # Rust fmt + clippy + 持久化测试
pnpm bench               # 300 行计算性能预算
pnpm desktop:build --bundles app  # 本机生成未签名 .app
```

构建产物在 `src-tauri/target/release/bundle/`。当前以 macOS 为首个验证平台；Windows/Linux 打包、签名、公证、自动更新尚未接入。

## 写法

```text
# 周末预算
交通 = 186 × 2
住宿 = 420 × 2
餐饮 = 240
预算 = 交通 + 住宿 + 餐饮
每人 = 预算 / 2
备用金：每人 + 10%

{[18 + 24] x (3 - 1)}

5 km to m
90 min to hour
```

右侧结果可以点击复制。支持用 `x` 表示乘法，以及 `[]`、`{}`、`()` 分组。普通计算器的结果最多显示三位小数，十位整数以上使用科学计数法；字号随可用宽度缩小，续算保留内部精度。「写入当前笔记」插入原算式，后续仍可编辑重算。

`⌘/Ctrl N` 新建，`⌘/Ctrl K` 搜索，`⌘/Ctrl S` 保存，`⌘/Ctrl Shift C` 复制当前行结果，`⌘/Ctrl ,` 打开设置。计算器弹窗点击外部或按 Escape 关闭，收起后保留本次会话的算式和历史。

## 继续开发

从 [AGENTS.md](AGENTS.md) 进入项目地图，再按任务阅读相关契约：

- [文档索引](docs/index.md) / [产品范围](docs/product-specs/mvp.md)
- [架构](ARCHITECTURE.md) / [计算语言](docs/product-specs/calculation-language.md)
- [Harness 工作方式](docs/harness.md) / [质量与验证证据](docs/QUALITY_SCORE.md)
- [OpenAI 与 Numi 调研](docs/references/research.md) / [技术债务与后续路线](docs/exec-plans/tech-debt.md)

未完成的计算功能及验收条件记录在 [计算语言文档](docs/product-specs/calculation-language.md)，工程与发行缺口记录在 [技术债务](docs/exec-plans/tech-debt.md)。语法范围以仓库契约和测试为准。保留原仓库 [MIT License](LICENSE)。
