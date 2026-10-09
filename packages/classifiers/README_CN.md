# @reasoning-router/classifiers

[English](README.md) | 简体中文 | [日本語](README_JA.md) | [한국어](README_KO.md)

reasoning-router 的推理强度分类器。每个分类器都通过普通的 `fetch` 向决策模型提出一个 `choice` 问题，
选项仅限目标模型所支持的强度。OpenAI Decisions 使用它自己的请求格式。

在 `classifier` 配置块中通过 `provider` 选择其一。

## Jev（`provider: "jev"`）

[Jev](https://typesafe.ai/)，通过 TypeSafe 或 Vercel AI Gateway 使用。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `apiKey` | 无 | TypeSafe 密钥，或 Vercel AI Gateway 密钥。必填。 |
| `baseUrl` | `https://api.typesafe.ai` | 使用 Vercel 密钥时设为 `https://ai-gateway.vercel.sh/typesafe`。不接受其他值。 |
| `model` | 端点的模型 | 可选。TypeSafe 必须为 `jev-latest`，Vercel 必须为 `typesafe-ai/jev`。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

## Clef（`provider: "clef"`）

Cloudflare 的 [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)，运行在 Workers AI 上。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `apiKey` | 无 | 具有 Workers AI 权限的 Cloudflare API 令牌。必填。 |
| `accountId` | 无 | Cloudflare 账户 ID。必填。 |
| `model` | 无 | `clef` 或 `clef-flash`。必填。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

## Laya（`provider: "laya"`）

[Laya](https://huggingface.co/convaiinnovations/laya)，一个开源的、与 Jev 兼容的模型，由你自行运行的
Laya 服务器提供服务。本软件包只通过 HTTP 调用它。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya 服务器。使用 HTTPS，或仅限回环主机的纯 HTTP。 |
| `apiKey` | 无 | 可选；仅当服务器设置了 `LAYA_API_KEY` 时才设置。 |
| `model` | 由服务器决定 | 可选的检查点，例如 `english` 或 `multilingual`。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

## Kev（`provider: "kev"`）

[Kev](https://github.com/jaredpalmer/kev)，一个开源的、与 Jev 兼容的决策模型系列，由你自行运行的
`kev.serve` 服务器提供服务。本软件包只通过 HTTP 调用它。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8008` | Kev 服务器。使用 HTTPS，或仅限回环主机的纯 HTTP。 |
| `apiKey` | 无 | 可选；仅当服务器设置了 `KEV_API_KEY` 时才设置。 |
| `model` | 无 | 可选。仅原样回显；服务器在启动时（`--run`）选择检查点。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

<a id="openai-decisions-provider-openai-decisions"></a>
## OpenAI Decisions（`provider: "openai-decisions"`）

调用 OpenAI 的 Decisions API。用户需自备具有 Decisions 访问权限的 OpenAI API 密钥。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `apiKey` | 无 | OpenAI API 密钥。必填。 |
| `baseUrl` | `https://api.openai.com/v1` | 也接受 `https://us.api.openai.com/v1` 或 `https://eu.api.openai.com/v1`。不接受其他值。 |
| `model` | `gpt-6-luna` | 唯一接受的值：`gpt-6-luna`。与目标生成模型无关。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

该提供方调用 `POST {baseUrl}/decisions`。有限的分类器状态以 JSON 文本形式放在 `input` 中；
一个名为 `effort` 的 `choice` 问题只提供目标模型所支持的强度，并附带现有的强度描述。答案按名称匹配。
拒绝、缺失或重复的答案、非 choice 类型的答案以及不受支持的强度，都会作为 `classifier_invalid_output` 回退。
认证错误不会重试；429 和 5xx 响应会在截止时间内重试，并遵循 `Retry-After`。客户端取消会中止请求，且不触发回退。

OpenAI 收到的有限摘要与其他分类器相同：近期用户文本、助手进展、最多 8 条工具结果、失败摘要以及目标模型 ID。
零数据留存（Zero Data Retention）和数据驻留取决于项目资格；请参阅
[OpenAI 的数据指南](https://developers.openai.com/api/docs/guides/your-data)。
`us.` 和 `eu.` 端点要求项目或组织满足 OpenAI 的区域要求（对于 `eu.`，需要 Modified Abuse Monitoring
或 Zero Data Retention）；否则请求会失败，路由器随之回退。
该 API 处于公开测试阶段；`gpt-6-luna` 是唯一受支持的模型。定价（2026-10-07 查询）为每 100 万输入 token
$0.10，不收取输出或缓存费用；可能适用区域溢价和长上下文倍率。请重新核对
[OpenAI 定价](https://developers.openai.com/api/docs/pricing)。

验证仅使用了模拟的 HTTP 契约测试；没有进行任何实际调用或带认证的调用，因此实际兼容性未经验证。
OpenAI 声称延迟比 Responses API 低约 10 倍，这是其自己的说法，并未在路由器的截止时间约束下测量过。
强度选择质量尚未针对带标注的编码智能体决策进行评估，因此 Jev 仍然是默认选项。

[Decisions 指南](https://developers.openai.com/api/docs/guides/decisions)于 2026-10-07 查阅。
请求和响应类型来自 `openai` npm 包 7.30.0（`src/resources/decisions.ts`，由 OpenAI 的 OpenAPI 规范生成）；
当时尚未发布 `/v1/decisions` API 参考页面。区域 URL 来自数据控制指南，同日查阅。请参阅
[issue #33](https://github.com/robertn702/reasoning-router/issues/33)。

## 导出

- `classifierProviders`：所有分类器，供 [`@reasoning-router/core`](../core/README_CN.md) 中的
  `createConfiguredSelector` 使用。
- `jevClassifierProvider`、`clefClassifierProvider`、`layaClassifierProvider`、
  `kevClassifierProvider`：各个提供方。
- `openAIDecisionsClassifierProvider`、`createOpenAIDecisionsTransport`、
  `resolveOpenAIDecisionsConnection`，以及 `OpenAIDecisionsConnection` 类型。
- `createJevClassifier`、`createJevTransport`、`createClefTransport`、
  `createLayaTransport`、`createKevTransport`、`resolveJevConnection`、
  `resolveClefConnection`、`resolveLayaConnection`、`resolveKevConnection`：
  较底层的辅助函数。
- `ClassifierRequestError` 和 `Fetch` 类型，供各 transport 使用。

## 许可证

[MIT](LICENSE)
