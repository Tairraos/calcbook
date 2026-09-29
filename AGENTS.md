# Calcbook agent map

Calcbook 是 Tauri 2 桌面计算笔记本。先读相关事实来源，再修改代码。

## 从这里开始

- [项目启动与命令](README.md)
- [架构边界](ARCHITECTURE.md)
- [文档索引与维护状态](docs/index.md)
- [产品范围与验收](docs/product-specs/mvp.md)
- [计算语言契约](docs/product-specs/calculation-language.md)
- [界面与交互规范](docs/design-docs/ui.md)
- [Harness 工作闭环](docs/harness.md)
- [质量证据与缺口](docs/QUALITY_SCORE.md)
- [执行计划](docs/exec-plans/README.md)
- [技术债务](docs/exec-plans/tech-debt.md)

## 运行与验证

```sh
pnpm install --frozen-lockfile
pnpm dev              # 浏览器预览，http://127.0.0.1:1420
pnpm desktop          # Tauri 桌面
pnpm check            # 文档/架构、格式、类型、计算/存储/键盘测试、生产构建
pnpm check:native     # Rust 格式、clippy、持久化测试
pnpm bench            # 计算引擎性能基线
```

发布：推送 `v<版本号>` tag（如 `v1.0.0`）触发 GitHub Actions 四路构建（macOS arm64 + Intel、Windows、Linux）并自动上传到 GitHub Release（[.github/workflows/release.yml](.github/workflows/release.yml)）；tag 版本必须与 package.json 一致。tag 默认由用户自己推，用户明确要求时代为推送。

## 会话收尾：构建与清理

- 每次会话结束前构建一次 .app：`pnpm desktop:build --bundles app`，产物在 `target/release/bundle/macos/Calcbook.app`。只出 `.app`，不构建 dmg。会话改了功能或用户可见行为时，先按「每次变更」升级版本号再构建。
- `target/release/` 整体保留，作为下次的增量编译缓存；不要清理、缩小或删除它，用户会手动清理。
- 构建完成后清理对增量编译无用的过程文件：删除 `dist/`（前端产物已嵌入 .app，下次 `pnpm build` 重新生成）和 `src-tauri/gen/`（tauri 构建时自动重建）；若 `target/release/bundle/` 下出现 `.dmg` 一并删除，只保留 `macos/Calcbook.app`。
- `target/debug/` 供 `tauri dev` 与 `check:native` 使用，按同一原则保留。

## 不变量

1. `src/domain/` 是纯 TypeScript；不依赖 React、DOM、Tauri 或持久化。
2. `src/platform/` 是唯一的浏览器/原生持久化边界；UI 不直接读写存储。
3. 笔记和普通计算器共用同一计算内核；不得用 JavaScript `eval` / `Function`。
4. 计算使用十进制高精度数；表达式 AST 必须通过白名单；错误不得伪装成数值。
5. 读取失败时不得用默认数据覆盖原文件；只有成功保存才能显示“已保存”。
6. 用户文本不是 HTML；不添加遥测、外部字体、网络汇率或远程脚本。
7. 用原生表单语义、可见焦点和可访问名称；编辑器保留中文输入法与撤销行为。
8. 保留 LICENSE。复用 Numi 的交互思路，不复制其商标、素材或私有代码。
9. 默认数据目录为 `~/.calcbook`；UI 不能提交任意路径。目录切换须保留源文件，不覆盖目标中的另一份工作区。

## 每次变更

- 从真实用户场景出发，先读相应产品契约。复杂变更在 active 计划中记录。
- 一次完成一个可验证的纵向功能；优先标准能力与已有依赖，不为未来搭框架。
- 功能或用户可见行为变更时升级版本号，保持 package.json、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处一致（`check:repo` 校验）；需要交付时重新构建 `.app`。
- 复现 → 修改 → 最小回归用例 → 相关检查 → 运行 UI 验收 → 更新证据。
- UI 改动需在桌面尺寸和窄窗口实际操作，检查控制台、焦点和保存状态。
- 记录真实运行的命令与结果；没有运行的检查明确标为“未验证”。
- 行为、命令或边界改变时，同次更新对应文档与质量表；完成后归档执行计划。
- 未完成的产品/计算功能在计算语言文档列出状态、边界和验收条件，并关联计划或债务；不能用“已实现”代替“已验证”。
- 原生回归同时设置绝对路径 `CALCBOOK_CONFIG_DIR` 与 `CALCBOOK_DATA_DIR`，隔离真实笔记。
- 不自动发布、推送、合并或安装到用户 Applications；本地构建可直接进行。

让重复出现的错误变成检查规则，让产品判断变成明确的验收例子。
