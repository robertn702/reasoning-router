# @reasoning-router/proxy

[English](README.md) | 简体中文 | [日本語](README_JA.md) | [한국어](README_KO.md)

一个独立的 HTTP 代理，它会向分类器询问每个请求需要多少推理强度，然后在不破坏提示缓存的前提下，将该强度应用到发出的
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

按上述方式启动代理，然后在 `~/.codex/reasoning-router.config.toml` 创建一个 Codex 配置文件（profile）。它保留模型名称，只更改提供方，因此你的默认 Codex 设置不受影响：

```toml
model = "gpt-6-astra"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

运行 `codex -p reasoning-router` 即可通过代理路由；直接运行 `codex` 不受影响。`-p` 指定的是配置文件名，而不是提供方；这里两者都叫 `reasoning-router`。配置文件并不绑定单一模型：可用 `-m` 选择其他模型，例如 `codex -p reasoning-router -m gpt-6-sol`。配置文件（`-p`）需要 Codex 0.161.0 或更高版本。在更早的版本上，请将相同的几行放入 `~/.codex/config.toml`。

Codex 不发送任何凭据；代理会添加 `REASONING_ROUTER_UPSTREAM_API_KEY`
（`REASONING_ROUTER_UPSTREAM_AUTH=bearer`）。请不要设置 `supports_websockets`，因为代理只提供 HTTP 服务。

- 请使用真实的模型 ID。Codex 按名称读取模型元数据，而代理没有别名，因此像 `astra-rr` 这样自编的名称会让 Codex 使用通用元数据，并让代理在本地返回 `400`。
- 使用 `gpt-6-astra`、`gpt-6-luna`、`gpt-6-sol` 或 `gpt-6.1-sol`。其他模型会在本地得到 `400`。
- 由分类器选择强度。Codex 的 `model_reasoning_effort` 和 `/model` 强度会被忽略，尽管 Codex 仍会显示它们。
- 代理会在上游流 60 秒没有数据后将其关闭。如果较长的轮次被截断，请调高
  `REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS`。

<a id="chatgpt-subscription-through-cliproxyapi"></a>

### 通过 CLIProxyAPI 使用 ChatGPT 订阅

代理无法直接使用 ChatGPT 登录。若要使用订阅，请运行已登录 Codex 的 [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)，并将其置于代理之后：

```text
codex -p reasoning-router → reasoning-router (127.0.0.1:4320) → CLIProxyAPI (127.0.0.1:8317) → ChatGPT
```

以 `forward` 模式启动代理，指向 CLIProxyAPI，且不设置上游密钥：

```dotenv
REASONING_ROUTER_UPSTREAM_BASE_URL=http://127.0.0.1:8317/v1
REASONING_ROUTER_UPSTREAM_AUTH=forward
```

然后在配置文件的提供方配置块中添加 `env_key`，让 Codex 发送你的 CLIProxyAPI 客户端密钥，代理会原样转发：

```toml
env_key = "CLIPROXY_KEY"   # environment variable holding a CLIProxyAPI api-key
```

CLIProxyAPI 会为 Codex Plus、Pro 和 Team 套餐上的 GPT-6 模型透传 `configuration_update`；在 Free 套餐上，除 `gpt-6-luna` 外，它会对所有模型剥离该项，因此路由在那里不起作用。已在 Codex 0.161.0 和 CLIProxyAPI 8.0.23 上验证：后端接受了推理强度变更，并在变更前后保持了提示缓存。

详情请参阅 [`docs/harnesses/codex.md`](../../docs/harnesses/codex.md)。

## 许可证

[MIT](LICENSE)
