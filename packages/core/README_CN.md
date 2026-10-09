# @reasoning-router/core

[English](README.md) | 简体中文 | [日本語](README_JA.md) | [한국어](README_KO.md)

reasoning-router 中与 harness 和分类器无关的共享部分：请求校验、模型注册表、面向 Responses 和
Anthropic Messages 且保持缓存的强度改写、缓存谱系（cache lineage）、带重试和回退的分类器选择、
上游转发辅助函数、用量观测以及决策日志。

分类器通过 `Classifier` 和 `ClassifierProvider` 接口接入；`createConfiguredSelector` 会根据
`classifier` 配置块（`provider`、`timeoutMs` 以及该提供方自己的字段）选出一个分类器。
本软件包不依赖任何分类器 SDK。

被 [`@reasoning-router/opencode`](../opencode/README_CN.md) 和
[`@reasoning-router/proxy`](../proxy/README_CN.md) 使用。请参阅
[`docs/behavior.md`](../../docs/behavior.md) 和
[`docs/classification-policy.md`](../../docs/classification-policy.md)。

## 许可证

[MIT](LICENSE)
