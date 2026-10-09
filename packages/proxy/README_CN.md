# @reasoning-router/proxy

[English](README.md) | 简体中文 | [日本語](README_JA.md)

一个独立的 HTTP 代理，它会向分类器询问每个请求需要多少推理强度，然后在不破坏提示词缓存的前提下，将该强度应用到发出的
Responses（`POST /v1/responses`）或 Anthropic Messages（`POST /v1/messages`）请求上。需要 Node.js 24.x。

> **Alpha。** 仅限可信的本地使用；请先阅读
> [信任模型](#trust-model)。

## 安装

```bash
npm install -g @reasoning-router/proxy   # installs the reasoning-router command
```

或者无需安装直接运行：`npx @reasoning-router/proxy`。

## 用法

在你运行命令的目录中创建 `.env`（或直接导出这些变量）：

```dotenv
REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
# REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe   # Vercel keys only
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1
REASONING_ROUTER_UPSTREAM_AUTH=bearer
REASONING_ROUTER_UPSTREAM_API_KEY=your-endpoint-key
```

然后启动它，并让客户端指向 `http://127.0.0.1:4320/v1`：

```bash
reasoning-router
curl --fail http://127.0.0.1:4320/ready
```

运行 `reasoning-router --help` 查看所有变量。默认值请参阅 [`.env.example`](../../.env.example)，
分类器设置请参阅 [`docs/environment.md`](../../docs/environment.md)，
探针、关闭、限制和转发请参阅 [`docs/behavior.md`](../../docs/behavior.md)。

<a id="trust-model"></a>
## 信任模型

该代理适用于单台可信机器。它只监听 `127.0.0.1`，没有调用方认证：任何能够访问该端口的本地进程都可以发送请求，
而在 `REASONING_ROUTER_UPSTREAM_AUTH=bearer` 时，这些请求会使用你配置的上游密钥。

每个请求都必须携带 `Host`，其值为代理所监听端口对应的 `127.0.0.1:<port>` 或 `localhost:<port>`；
否则会在读取请求体、分类或转发之前返回 `400`。这可以阻止来自网页的 DNS 重绑定攻击。它不是认证，
也不能阻止网页直接向 `http://127.0.0.1:<port>` 发送请求。请勿通过隧道或反向代理暴露该端口；
映射到不同端口的转发或容器映射也会得到 `400 invalid_host`。

## Codex CLI

按上述方式启动代理，然后在 `~/.codex/config.toml` 中添加一个自定义提供方：

```toml
model = "gpt-6.1-sol"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

Codex 不发送任何凭据；代理会添加 `REASONING_ROUTER_UPSTREAM_API_KEY`
（`REASONING_ROUTER_UPSTREAM_AUTH=bearer`）。请不要设置 `supports_websockets`，因为代理只提供 HTTP 服务。

- 仅支持 OpenAI API 密钥。不支持 ChatGPT 订阅登录。
- 使用 `gpt-6-astra`、`gpt-6-luna`、`gpt-6-sol` 或 `gpt-6.1-sol`。其他模型会在本地得到 `400`。
- 由分类器选择强度。Codex 的 `model_reasoning_effort` 和 `/model` 强度会被忽略，尽管 Codex 仍会显示它们。
- Codex 0.159.0 不认识 `gpt-6.1-sol`，除非你提供 `model_catalog_json`，否则会使用通用元数据运行它。
- 代理会在上游流 60 秒没有数据后将其关闭。如果较长的轮次被截断，请调高
  `REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS`。

详情请参阅 [`docs/harnesses/codex.md`](../../docs/harnesses/codex.md)。

## 许可证

[MIT](LICENSE)
