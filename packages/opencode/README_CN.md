# @reasoning-router/opencode

[English](README.md) | 简体中文 | [日本語](README_JA.md) | [한국어](README_KO.md)

一个 [OpenCode](https://opencode.ai) V2 插件，它会向分类器询问每一步需要多少推理强度，然后在不破坏提示缓存的前提下，
将该强度应用到发出的模型请求上。[`@reasoning-router/classifiers`](../classifiers/README_CN.md) 中的所有分类器均可使用。

> **Alpha。** OpenCode 按包名从 npm 安装该插件；请如下所示将其列在 `plugins` 下。

移植自 [`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router)。

## 要求

- OpenCode V2 2.0.4 或更高版本（已使用 2.0.18 进行冒烟测试）。
- 所选分类器所需的一切（密钥，或你自行运行的服务器）；请参阅[分类器](../classifiers/README_CN.md)。
- 一个提供 GPT-6 Astra、Luna 或 Sol 的 Responses API 端点，或一个启用了对话中途 output-config beta 的
  Anthropic Messages 端点。

## 用法

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [{ "package": "@reasoning-router/opencode", "options": {
    "classifier": { "provider": "jev", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" },
    "wrap": { "openai": ["openai/gpt-6-astra"] },
    "decisionsLogPath": "/tmp/reasoning-decisions.jsonl"
  }}],
  "model": "reasoning-router/gpt-6-astra"
}
```

插件只为 `wrap` 中列出的源模型（`openai` 和/或 `anthropic` 数组，元素为 `provider/model` 引用）注册
`reasoning-router/<profile>` 别名。源模型本身保持不变。对别名发出的每个主请求都会进行一次分类；
如果分类器失败，请求会以回退强度（默认为 `high`）继续。设置 `decisionsLogPath` 后，每个被路由的请求都会追加一条
仅含元数据的 `ReasoningDecision` 事件，其中记录了做出决策的 `classifier`。

对于 OpenAI Decisions（公开测试版），请将 `classifier` 块替换为：

```jsonc
"classifier": { "provider": "openai-decisions", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" }
```

完整示例请参阅 [`examples/opencode.jsonc`](../../examples/opencode.jsonc)。

## 选项

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `classifier.provider` | `REASONING_ROUTER_CLASSIFIER` 环境变量，然后是 `jev` | 分类器提供方名称，例如 `jev`（参见[分类器](../classifiers/README_CN.md)）。 |
| `classifier.apiKey` | `REASONING_ROUTER_CLASSIFIER_API_KEY` 环境变量 | 分类器密钥（如果提供方需要；设置了 `fixedEffort` 时不需要）。 |
| `classifier.baseUrl` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` 环境变量，然后是提供方默认值 | 分类器端点；默认为提供方的默认值。 |
| `classifier.accountId` | `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` 环境变量 | 账户 ID，适用于需要它的提供方。 |
| `classifier.model` | `REASONING_ROUTER_CLASSIFIER_MODEL` 环境变量 | 分类器模型，适用于需要它的提供方。 |
| `classifier.timeoutMs` | `4000` | 分类的总预算，含重试。 |
| `wrap` | 无 | 必填的非空对象，包含 `openai`/`anthropic` 源引用。 |
| `decisionsLogPath` | 关闭 | `ReasoningDecision` JSONL 的绝对路径。 |
| `baseEffort` | 配置档默认值 | 响应中报告的请求级强度。 |
| `fixedEffort` | 无 | 跳过分类器，始终使用此强度。 |
| `maxRetries` | `1` | 遇到暂时性分类器错误后的额外尝试次数。 |
| `fallbackMode` | `fixed` | `fixed`、`previous` 或 `error`。 |
| `fallbackEffort` | `high` | 分类失败时使用的强度。 |
| `maxRequestBytes` | `33554432` | 请求体大小上限。 |
| `maxInFlight` | `32` | 并发请求数。 |
| `upstreamHeaderTimeoutMs` | `10000` | 等待端点响应头的时间。 |
| `upstreamIdleTimeoutMs` | `60000` | 流式数据块之间的最长间隔。 |

线路行为、日志和限制记录在
[`docs/behavior.md`](../../docs/behavior.md) 和
[`docs/classification-policy.md`](../../docs/classification-policy.md) 中。

## 许可证

[MIT](LICENSE)
