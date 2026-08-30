# dsh-plugins · DSH 自研插件工坊

> DeepSeek Harness（DSH）自研插件聚合仓库——`@dsh-local` 系列插件的单一来源。
> 全部插件遵循 DSH 的"一切皆插件"哲学：**不碰核心、可插拔、可恢复**。

## 插件清单

| 插件 | 目录 | 功能 | 状态 |
|------|------|------|------|
| **cost-gauge** | `plugins/cost-gauge/` | 右上角钟表式 API 消耗/余额仪表（周期语义、充值自动检测、产物链接→预览桥）| ✅ 工作中（基于官方 0.1.16 + 本地修复）|
| **loop-rules** | `plugins/loop-rules/` | P0 loop 优化：目标可验证性 + 完成证据规则（prompt 层，零崩溃风险）| ✅ 工作中 |

> cost-gauge 的独立开源仓库：[tramington/dsh-cost-gauge](https://github.com/tramington/dsh-cost-gauge)

## 设计原则

1. **不碰 DSH 核心**：全部为用户级插件（node 半 / browser 半），无任何官方源码改动
2. **可恢复**：从 profile 卸载即完全恢复原状
3. **崩溃安全**：注册失败静默降级（try/catch），纯文本注入无执行路径

## 安装

见 `docs/install.md`（复制到 profile node_modules + patch 注册 + 重启）。

## License

MIT © 2026 Rammy Tang (tramington)
