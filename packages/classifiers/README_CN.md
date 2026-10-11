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

不会检查密钥，也不会自动检测端点，因此 `baseUrl` 必须与凭据匹配。

## Clef（`provider: "clef"`）

Cloudflare 的 [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)，运行在 Workers AI 上。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `apiKey` | 无 | 具有 Workers AI 权限的 Cloudflare API token。必填。 |
| `accountId` | 无 | Cloudflare 账户 ID。必填。 |
| `model` | 无 | `clef`、`clef-omni` 或 `clef-flash`。必填。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

该密钥与账户 ID 一起用于调用 Workers AI：
`https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}`。
`baseUrl` 会被忽略。

## Laya（`provider: "laya"`）

[Laya](https://huggingface.co/convaiinnovations/laya)，一个开源的、与 Jev 兼容的模型，由你自行运行的
Laya 服务器（例如 `laya-serve`）提供服务。本软件包只通过 HTTP 调用它。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya 服务器。使用 HTTPS，或仅限回环主机的纯 HTTP。 |
| `apiKey` | 无 | 可选；仅当服务器设置了 `LAYA_API_KEY` 时才设置。 |
| `model` | 由服务器决定 | 可选的检查点：`english`、`multilingual` 或 `typed-decisions`。未设置时，服务器根据状态的语言选择。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

调用 `{baseUrl}/v1/systemone`。密钥作为 bearer token 发送；空白密钥视为未设置。

## Kev（`provider: "kev"`）

[Kev](https://github.com/jaredpalmer/kev)，一个开源的、与 Jev 兼容的决策模型系列，由你自行运行的
`kev.serve` 服务器提供服务。本软件包只通过 HTTP 调用它。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8008` | Kev 服务器。使用 HTTPS，或仅限回环主机的纯 HTTP。 |
| `apiKey` | 无 | 可选；仅当服务器设置了 `KEV_API_KEY` 时才设置。 |
| `model` | 无 | 可选。仅原样回显；服务器在启动时（`--run`）选择检查点。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

调用 `{baseUrl}/v1/systemone`，密钥规则与 Laya 相同（bearer token；空白密钥视为未设置）。参见 [Kev 提案](../../docs/proposals/kev.md)。

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

## CLM（`provider: "clm"`）

[CLM](https://github.com/Contrastive-LM/CLM)，由你自行运行的 `clm-serve` 服务器提供服务。
`clm-serve` 另需一个你同样自行运行的池化后端（Qwen3-8B 嵌入，例如 vLLM）。本软件包只通过 HTTP 调用
`clm-serve`。固定的版本和限制请参阅 [docs/classifiers/clm.md](../../docs/classifiers/clm.md)。
目前只验证了 API 兼容性，尚未验证推理强度决策的质量。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8700` | CLM 服务器。使用 HTTPS，或仅限回环主机的纯 HTTP。 |
| `apiKey` | 无 | 可选；仅当服务器设置了 `CLM_API_KEY` 时才设置。 |
| `model` | 服务器的 `clm-latest` | 可选的 CLM head：`clm-latest`、`clm-raw`，或通过 `--model NAME=PATH` 加载的 head。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

调用 `{baseUrl}/v1/systemone`，密钥规则与 Laya 相同（bearer token；空白密钥视为未设置）。

<a id="microsoft-decision-1-provider-microsoft-decision"></a>
## Microsoft-Decision-1（`provider: "microsoft-decision"`）

Microsoft 的 [Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)，
部署在你自己的 Microsoft Foundry 资源中。部署该模型后，从部署详情页面复制资源端点、部署名称和 API 密钥。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `baseUrl` | 无 | Foundry 资源端点，例如 `https://<resource>.services.ai.azure.com`。必填。使用 HTTPS，不含凭据、查询字符串或片段。 |
| `apiKey` | 无 | 该资源的 API 密钥，通过 `api-key` 请求头发送。必填。 |
| `model` | 无 | 你的部署名称，而不是模型名称。必填。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

该提供方调用 `POST {baseUrl}/providers/microsoft/v1/systemone`，请求体为 System One 请求：
有限的状态，以及一个名为 `effort` 的 `choice` 问题，选项为目标模型所支持的强度。
它读取 `answers.effort.choice`；不受支持或缺失的选项会作为 `classifier_invalid_output` 回退。
错误响应体会被丢弃。认证错误不会重试；429 和 5xx 响应会在截止时间内重试，并遵循 `Retry-After`。
不支持 Microsoft Entra ID 持有者 token，因为路由器不会获取或刷新它们。
定价未重新核对；使用前请查看 Foundry 的模型目录。

该契约已于 2026-10-11 对照 Microsoft 的操作指南核对过（请参阅
[issue #64](https://github.com/robertn702/reasoning-router/issues/64)）。
验证仅使用了模拟的 HTTP 契约测试；没有进行任何实际调用或带认证的调用。
Microsoft 关于准确率和延迟的说法是其自己的说法，强度选择质量尚未评估，因此 Jev 仍然是默认选项。

<a id="liquid-d1-provider-liquid"></a>
## Liquid d1（`provider: "liquid"`）

[Liquid d1](https://docs.liquid.ai/lfm/models/d1)，Liquid AI 提供的托管决策模型，
通过 Liquid 的 API 或 Vercel AI Gateway 访问。

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `apiKey` | 无 | Liquid 密钥（`liquid_...`），或 Vercel AI Gateway 密钥。必填。 |
| `baseUrl` | `https://api.liquid.ai` | 使用 Vercel 密钥时设置为 `https://ai-gateway.vercel.sh/typesafe`。不接受其他值。 |
| `model` | 端点的模型 | 可选。Liquid 使用 `d1`（默认）或纯文本的 `d1:free`；Vercel 使用 `liquid/d1`。 |
| `timeoutMs` | `4000` | 分类的总预算，含重试。 |

该提供方调用 `POST https://api.liquid.ai/decisions/v1/systemone` 或
`POST https://ai-gateway.vercel.sh/typesafe/v1/systemone`，请求体为 System One 请求，并携带 bearer 密钥，
然后读取 `answers.effort.choice`。与 Jev 一样，密钥不会被检查，因此 `baseUrl` 必须与凭据匹配。
不受支持或缺失的选项会作为 `classifier_invalid_output` 回退。错误响应体会被丢弃。
认证错误不会重试；429 和 5xx 响应会在截止时间内重试，并遵循 `Retry-After`。
d1 的 `probabilities` 和 `confidence` 会被忽略。

该契约已于 2026-10-11 对照 Liquid 的 d1 指南，以及 Vercel 的 TypeSafe API 页面和 d1 更新日志核对过（请参阅
[issue #68](https://github.com/robertn702/reasoning-router/issues/68)）。
验证仅使用了模拟的 HTTP 契约测试；没有进行任何实际调用或带认证的调用。
Liquid 关于质量的说法是其自己的说法，强度选择质量尚未评估，因此 Jev 仍然是默认选项。

## 导出

- `classifierProviders`：所有分类器，供 [`@reasoning-router/core`](../core/README_CN.md) 中的
  `createConfiguredSelector` 使用。
- `jevClassifierProvider`、`clefClassifierProvider`、`layaClassifierProvider`、
  `kevClassifierProvider`：各个提供方。
- `openAIDecisionsClassifierProvider`、`createOpenAIDecisionsTransport`、
  `resolveOpenAIDecisionsConnection`，以及 `OpenAIDecisionsConnection` 类型。
- `clmClassifierProvider`、`createClmTransport`、`resolveClmConnection`，以及 `ClmConnection` 类型。
- `microsoftDecisionClassifierProvider`、`createMicrosoftDecisionTransport`、
  `resolveMicrosoftDecisionConnection`，以及 `MicrosoftDecisionConnection` 类型。
- `liquidClassifierProvider`、`createLiquidTransport`、
  `resolveLiquidConnection`，以及 `LiquidConnection` 类型。
- `createJevClassifier`、`createJevTransport`、`createClefTransport`、
  `createLayaTransport`、`createKevTransport`、`resolveJevConnection`、
  `resolveClefConnection`、`resolveLayaConnection`、`resolveKevConnection`：
  较底层的辅助函数。
- `ClassifierRequestError` 和 `Fetch` 类型，供各 transport 使用。

## 许可证

[MIT](LICENSE)
