# 文档地图

状态：有效 · 负责人：项目维护者 · 核验日期：2026-09-06

仓库是产品决策和工程事实的记录系统。先找到对应文档，不需要把所有文档一次读入上下文。

| 想了解什么 | 事实来源 |
| --- | --- |
| 启动与日常命令 | [README](../README.md) |
| 智能体工作入口 | [AGENTS](../AGENTS.md) |
| 模块边界、持久化、安全 | [架构](../ARCHITECTURE.md) |
| 首版做什么、怎样验收 | [产品规格](product-specs/mvp.md) |
| 算式、变量、百分比、错误规则 | [语言契约](product-specs/calculation-language.md) |
| 界面、主题、键盘与可访问性 | [设计规范](design-docs/ui.md) |
| 为什么这样启动 | [官方资料调研](references/research.md) |
| 如何复现、修改、验证、交付 | [Harness](harness.md) |
| 哪些证据已具备、哪些尚未验证 | [质量记录](QUALITY_SCORE.md) |
| 当前与已完成工作 | [执行计划](exec-plans/README.md) |
| 有意延后的工作 | [技术债务](exec-plans/tech-debt.md) |

每个正式文档标注状态、负责人和核验日期。行为改变时同次更新文档；计划完成后移入 completed 并更新索引。`pnpm check:repo` 检查链接、元数据和是否可从此地图抵达；超过 90 天未核验会提醒维护者重新检查。
