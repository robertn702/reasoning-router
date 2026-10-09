# reasoning-router

[English](README.md) | 简体中文 | [日本語](README_JA.md) | [한국어](README_KO.md)

[![CI](https://github.com/robertn702/reasoning-router/actions/workflows/ci.yml/badge.svg)](https://github.com/robertn702/reasoning-router/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40reasoning-router%2Fproxy?label=%40reasoning-router%2Fproxy)](https://www.npmjs.com/package/@reasoning-router/proxy)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**质量不降，推理更省。** `reasoning-router` 会向分类器询问编码会话中的每一步需要多少推理强度，
这样一个强大的模型就能同时胜任快速编辑和高难度调试，而无需你手动切换强度档位。它可用于
OpenCode、Pi、Codex CLI，以及任何能与本地代理通信的客户端，分类器由你自行选择。

![核心对比：两组均解决 44 个任务中的 44 个；与固定 high 相比，Jev 平均减少 20.2% 的输入、14.3% 的输出和 8.7% 的耗时。](eval/results/router-core-comparison.svg)

在所测试的 GPT-6 Astra 任务组合上，Jev 路由的推理强度与固定 `high` 强度各自解决了
**44/44 次尝试**，而 Jev 平均少用了 **14% 的输出 token**（含推理）、完成速度快了 **9%**。
在其他工作负载、模型和分类器上，结果可能不同。
[查看评测](eval/results/router-consolidated-2026-09-25.md)。

> **状态：alpha。** 请按各软件包 README 中的说明，从 npm 安装下列软件包。

## 快速开始

选择你的 harness。每个示例都使用 Jev 和 [TypeSafe](https://typesafe.ai/) 密钥；其他分类器请参阅[分类器](#classifiers)。

**OpenCode** — 将插件添加到 `opencode.json`
（[完整指南](packages/opencode/README_CN.md)）：

```jsonc
{
  "plugins": [{ "package": "@reasoning-router/opencode", "options": {
    "classifier": { "provider": "jev", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" },
    "wrap": { "openai": ["openai/gpt-6-astra"] }
  }}],
  "model": "reasoning-router/gpt-6-astra"
}
```

**Pi** — 仅支持 Claude 模型（[完整指南](packages/pi/README_CN.md)）：

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key>
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

**Codex CLI 或任何 Responses/Messages 客户端** — 运行本地代理，并将客户端指向
`http://127.0.0.1:4320/v1`（[完整指南](packages/proxy/README_CN.md)）：

```bash
REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key> \
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1 \
REASONING_ROUTER_UPSTREAM_AUTH=bearer \
REASONING_ROUTER_UPSTREAM_API_KEY=<openai-key> \
npx @reasoning-router/proxy
```

如果分类器响应缓慢或不可用，请求仍会照常执行，使用回退强度（默认为 `high`）。

## 工作原理

对于每个主请求，路由器会：

1. 将近期对话的有限摘要发送给分类器，由分类器选出推理强度（例如重命名用 `low`，
   修复失败的测试用 `high`）。
2. 将该强度作为 OpenAI `configuration_update` 条目或 Anthropic 仅含强度的系统消息添加到请求中。
   之前的更新保持不变，因此提示词前缀仍可被缓存。
3. 将请求发送到你的模型端点，并原样将响应以流式方式传回。

## 数据发送范围

- **发送给分类器：** 近期用户文本和助手文本的有限摘录、最多 8 条近期工具结果
  （含工具名称和错误标记）、一份简短的失败摘要，以及模型 ID。托管工具和 computer-use
  的载荷不会发送。Laya 和 Kev 运行在你自己的服务器上。
- **发送给你的端点：** 完整请求，并附加强度更新。
- **日志记录：** 仅记录元数据（ID、模型、强度、延迟、token 数量），并且只输出到代理的
  stdout 或你启用的决策日志。提示词、工具输出、凭据和原始错误绝不会被记录。

详情请参阅 [docs/behavior.md](docs/behavior.md)。

## 为什么需要

同一个模型在低强度和最高强度下的差异，可以像不同模型档位之间的差异一样大，无论是能力还是价格。

你可以把编码会话中较简单的步骤路由到更便宜的模型，但切换模型会使提示缓存失效。
在较长的会话中，重建上下文的开销可能超过更便宜模型所节省的费用。

允许在对话中途调整推理强度的模型可以保留缓存，因此整个会话可以一直使用同一个强大的模型。
简单的编辑和工具调用可以使用低强度，把 high 或 max 留给架构设计和高难度调试。
`reasoning-router` 为每一步挑选合适的强度。

## Alpha 阶段的限制

- **已测试环境：** Node.js 24.x、OpenCode V2 2.0.18、Pi 1.0.4，以及 Codex CLI 0.159.0
  （通过代理）。其他版本可能可用，但未经测试。
- **模型：** 仅限[支持的模型](#supported-models)中列出的模型。其他模型会在本地被拒绝。Pi 仅路由 Claude 模型。
- **分类器：** 路由器向已配置的分类器发出询问并采用其答案；对于任何分类器在你的工作负载上选择强度的效果，
  它不做任何保证。
- **代理：** 仅限可信的本地使用；请参阅其
  [信任模型](packages/proxy/README_CN.md#trust-model)。

请按照 [SECURITY.md](SECURITY.md) 中的说明报告漏洞。

## 设计意图

`reasoning-router` 会向分类器询问智能体会话中的每一步需要多少推理强度，然后在不破坏提示缓存的前提下，
将该强度应用到发出的模型请求上。

- **任意分类器。** [Jev](https://typesafe.ai/) 只是可用于判断某一步需要多少推理的若干决策模型之一，
  而且更多模型正在陆续发布。使用哪个分类器是配置问题，而不是依赖项：
  `reasoning-router` 不得依赖 Jev 或任何单一提供方。
- **任意 harness。** 同样的路由可以在 OpenCode、Pi 或任何能与独立代理通信的客户端中运行。

软件包如下：

- [`@reasoning-router/core`](packages/core/README_CN.md)：共享的、与 harness 和分类器无关的路由器。
- [`@reasoning-router/opencode`](packages/opencode/README_CN.md)：OpenCode V2 插件。
- [`@reasoning-router/classifiers`](packages/classifiers/README_CN.md)：各分类器
  （Jev、Cloudflare Clef、Laya、Kev 和 OpenAI Decisions），通过 `classifier.provider` 选择。
- [`@reasoning-router/pi`](packages/pi/README_CN.md)：Pi 扩展（目前仅支持 Claude 模型）。
- [`@reasoning-router/proxy`](packages/proxy/README_CN.md)：独立的
  Responses/Messages 代理（命令为 `reasoning-router`）。

问题陈述、软件包规划和待决问题请参阅 [docs/architecture.md](docs/architecture.md)，
路由器的线路行为请参阅 [docs/behavior.md](docs/behavior.md)。

<a id="classifiers"></a>
## 分类器

通过 `REASONING_ROUTER_CLASSIFIER`（代理和 Pi）或插件的 `classifier.provider` 选项（OpenCode）
选择分类器。下面的示例使用代理；OpenCode 插件接受相同的设置，对应为 `classifier.apiKey`、
`classifier.baseUrl`、`classifier.accountId` 和 `classifier.model`，并会回退到这些环境变量。
全部设置请参阅 [docs/environment.md](docs/environment.md) 和
[`@reasoning-router/classifiers`](packages/classifiers/README_CN.md)。

### Jev（默认）

[Jev](https://typesafe.ai/) 是 TypeSafe 提供的托管决策模型。获取 TypeSafe API 密钥，然后：

```bash
REASONING_ROUTER_CLASSIFIER=jev \
REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key> \
reasoning-router
```

如果要改用 Vercel AI Gateway 密钥，还需设置
`REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe`。

### Cloudflare Clef

[Clef](https://developers.cloudflare.com/workers-ai/models/clef/) 运行在 Cloudflare Workers AI 上。
创建一个具有 Workers AI 权限的 Cloudflare API token，然后：

```bash
REASONING_ROUTER_CLASSIFIER=clef \
REASONING_ROUTER_CLASSIFIER_API_KEY=<cloudflare-token> \
REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID=<cloudflare-account-id> \
REASONING_ROUTER_CLASSIFIER_MODEL=clef \
reasoning-router
```

将 `REASONING_ROUTER_CLASSIFIER_MODEL` 设置为 `clef` 或 `clef-flash`。此项为必填。

### Laya

[Laya](https://huggingface.co/convaiinnovations/laya) 是一个开源的、与 Jev 兼容的决策模型，由你自行运行。
路由器只通过 HTTP 调用它，绝不会安装或加载该模型。先启动 Laya 的 `laya-serve`，然后让路由器指向它：

```bash
pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_PRELOAD=1 laya-serve   # http://127.0.0.1:8000
REASONING_ROUTER_CLASSIFIER=laya reasoning-router
```

默认的基础 URL 是 `http://127.0.0.1:8000`。远程服务器必须使用 HTTPS。仅当服务器设置了
`LAYA_API_KEY` 时才需要设置 `REASONING_ROUTER_CLASSIFIER_API_KEY`，并通过
`REASONING_ROUTER_CLASSIFIER_MODEL` 选择检查点（`english`、`multilingual` 或 `typed-decisions`）。

### Kev

[Kev](https://github.com/jaredpalmer/kev) 是一个开源的、与 Jev 兼容的决策模型系列，
由你通过其 `kev.serve` 自行运行。路由器只通过 HTTP 调用它：

```bash
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0   # http://127.0.0.1:8008
REASONING_ROUTER_CLASSIFIER=kev reasoning-router
```

固定的版本、已确认的 HTTP 契约、认证、限制以及尚未验证的内容，请参阅
[docs/proposals/kev.md](docs/proposals/kev.md)。

### OpenAI Decisions

`openai-decisions` 分类器使用你自己的 OpenAI API 密钥调用 OpenAI 的 Decisions API
（公开测试版，模型为 `gpt-6-luna`）：

```bash
REASONING_ROUTER_CLASSIFIER=openai-decisions \
REASONING_ROUTER_CLASSIFIER_API_KEY="$OPENAI_API_KEY" \
reasoning-router
```

它只针对模拟响应进行过测试；实际兼容性和强度选择质量均未经验证。隐私边界、区域端点和费用请参阅
[packages/classifiers](packages/classifiers/README_CN.md#openai-decisions-provider-openai-decisions)。

<a id="supported-models"></a>
## 支持的模型

路由器会在本地拒绝任何其他模型。你的上游账户能否使用某个模型则是另一回事。

| 模型 | ID | API | 强度 | 基础强度 | Pi |
| --- | --- | --- | --- | --- | --- |
| GPT-6 Astra | `gpt-6-astra` | Responses | low–max | medium | 否 |
| GPT-6 Luna | `gpt-6-luna` | Responses | none–max | medium | 否 |
| GPT-6 Sol | `gpt-6-sol` | Responses | none–max | medium | 否 |
| GPT-6.1 Sol | `gpt-6.1-sol` | Responses | low–max | medium | 否 |
| Claude Fable 5.1 | `claude-fable-5-1` | Messages | low–max | high | 是 |
| Claude Mythos 5.1 | `claude-mythos-5-1` | Messages | low–max | high | 否 (Pi 1.0.4) |
| Claude Opus 5.5 | `claude-opus-5-5` | Messages | low–max | medium | 是 |
| Claude Opus 5 | `claude-opus-5` | Messages | low–max | high | 是 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | Messages | low–max | medium | 是 |

强度由低到高依次为 none、low、medium、high、xhigh、max。基础强度是模型默认的请求级强度，
可通过 `REASONING_ROUTER_BASE_EFFORT` 覆盖。分类失败时，路由器会使用回退强度，对所有模型默认均为
`high`；可通过 `REASONING_ROUTER_FALLBACK_EFFORT` 或插件的 `fallbackEffort` 选项进行设置。
请参阅 [docs/behavior.md](docs/behavior.md) 和
[docs/classification-policy.md](docs/classification-policy.md)。模型注册表位于
[`packages/core/src/models.ts`](packages/core/src/models.ts)。

## 开发

需要 Node.js 24.x。

```bash
npm ci
npm run check   # typecheck + lint + test
```

完整的命令列表和仓库约定请参阅 [AGENTS.md](AGENTS.md)。

## 目前的决策

这些决策都是可逆的：

- **npm workspaces**（`packages/*`）。
- **Node 24、TypeScript、Vitest**。
- **Biome** 用于 lint 和格式化，只需一个开发依赖、无需插件即可同时覆盖两者。`noNonNullAssertion`
  已关闭，测试中的 `noExplicitAny` 也已关闭。
- **不使用类型断言。** Biome 的 `nursery/noUnsafeTypeAssertion` 设为 error，唯一的例外是 `as const`。
  请使用类型标注、`satisfies`、类型谓词或类型收窄，并修复被标记的代码，而不是抑制该规则。
  该规则位于 Biome 的 nursery 中，因此其行为可能在次要版本中发生变化。
- **Source 条件。** 软件包的 `exports` 将自定义的 `@reasoning-router/source` 条件映射到 `src/*.ts`，
  因此类型检查和测试无需构建即可针对源码运行；已发布软件包的使用者获得的是 `dist/`。
- **Changesets**，采用独立版本。每个更改软件包已发布行为的 PR 都要添加一个 changeset。
  发布工作流会创建一个 "Version Packages" PR，合并后会通过 npm 可信发布（trusted publishing）
  带来源证明（provenance）地发布到 npm（不存储 npm token）。
- **独立代理是单独的软件包**（`@reasoning-router/proxy`，命令 `reasoning-router`），因为它需要一个分类器，
  而 core 不得依赖分类器。不带作用域的 `reasoning-router` 名称保持空闲，留给未来的统一 CLI。
- **Zod 仅用于配置。** 插件选项、代理环境变量和分类器设置都是 Zod schema，其选项类型由这些 schema 推导而来。
  Core 导出共享的 schema 和 `parseConfig`，后者会在一个错误中报告所有问题。请求体和流式用量仍使用
  `isRecord` 收窄，以便未知的提供方字段原样透传。Zod 是 core 唯一的依赖。
- **Pi 扩展使用 Pi 的虚拟模型。** 它只设置思考级别，由 Pi 负责放置强度，因此只支持 Pi 为其提供对话中途强度
  调整的 Anthropic 模型。它读取代理的 `REASONING_ROUTER_*` 变量（因为 Pi 扩展没有选项），
  并将最近一次分类得到的强度存储在 Pi 的会话中，以供 `previous` 回退使用。
- **Laya 的 `baseUrl` 为 HTTPS，或仅限回环地址的纯 HTTP**，因此对话摘要绝不会在网络上以未加密方式传输。
  默认值是 `laya-serve` 的 `http://127.0.0.1:8000`，且路由器不发送 `max_len`。
- **Kev 是独立的 `kev` 预设**，沿用 Laya 的连接规则，以便决策日志标明正确的服务。
  其默认基础 URL 是 `kev.serve` 的 `http://127.0.0.1:8008`。
- **OpenAI Decisions 的基础 URL 采用允许列表**（全球、`us.` 和 `eu.` 的 OpenAI API 根地址），
  因此沿用自其他分类器的基础 URL 无法接收到 OpenAI 密钥。在 OpenAI 增加新模型之前，`model` 只接受 `gpt-6-luna`。

## 许可证

[MIT](LICENSE)
