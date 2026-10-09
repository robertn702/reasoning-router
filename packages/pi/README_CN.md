# @reasoning-router/pi

[English](README.md) | 简体中文 | [日本語](README_JA.md) | [한국어](README_KO.md)

一个 [Pi](https://pi.dev) 扩展，它会向分类器询问每个 Claude 请求需要多少推理强度，并让 Pi 在不破坏提示词缓存的前提下
放置该强度。需要 Pi 1.0.0 或更高版本以及 Node.js 24.x。

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

`@earendil-works/pi-coding-agent` 上的 `*` peer 范围并不会强制要求 Pi 1.0.0。较旧的 Pi 因为没有
`registerVirtualModel` 而无法加载该扩展。

该扩展会为路由器已知的每个 Claude 模型添加一个虚拟模型 `reasoning-router/<id>`。每个请求都会使用你现有的
Anthropic 登录或密钥，在对应的 `anthropic/<id>` 模型上运行；路由器只负责选择其思考级别。对于这些支持对话中途调整强度的模型，
Pi 会固定 `output_config.effort: "high"`，并在仅含强度的系统消息中声明所选强度，因此更改强度时缓存的前缀得以保留。

- 用户轮次和续写会被分类。重试会沿用失败那次尝试的思考级别。直接请求（例如压缩）使用
  `REASONING_ROUTER_BASE_EFFORT`，或模型的基础强度；该变量只影响这些请求，不影响上面固定的 `high`。
- 最近一次分类得到的强度按虚拟模型存储在会话中，因此 `previous` 回退在重启后依然有效。
- Pi 中不存在、或 Pi 无法为其提供对话中途强度调整的模型，会被以 `reasoning-router unsupported_model: ...`
  拒绝。在 Pi 1.0.0 和 1.0.4 中，这包括 `claude-mythos-5-1`。
- 在 `error` 回退模式下，分类失败会以 `reasoning-router classification_failed: ...` 拒绝该请求。
  取消请求绝不会触发回退。这些消息不带 HTTP 状态码，因为 Pi 会重试看起来像暂时性提供方故障的错误。
- 分类器端点会收到最近的用户文本、最近的助手文本，以及近期工具结果的名称和输出摘录。
  系统消息、thinking 块和工具调用参数不会被发送。

目前尚不路由 OpenAI 模型。

## 环境

扩展在第一次被路由的请求时读取代理的变量，而不是在 Pi 加载它时。虚拟模型始终会被列出。缺少分类器密钥、使用了
`TYPESAFE_API_KEY` 之类的旧版变量，或其他无效值，都会使该请求以 `reasoning-router invalid_config: ...` 失败；
Pi 会继续运行，并且在变量有效之前，下一个请求会再次读取这些变量。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `REASONING_ROUTER_CLASSIFIER` | `jev` | 分类器提供方：`jev`、`clef`、`laya`、`kev` 或 `openai-decisions`。 |
| `REASONING_ROUTER_CLASSIFIER_API_KEY` | 无 | 分类器凭据。`jev`、`clef` 和 `openai-decisions` 必填；`laya` 和 `kev` 可选。 |
| `REASONING_ROUTER_CLASSIFIER_BASE_URL` | 提供方默认值 | Jev 端点、Laya 服务器（默认 `http://127.0.0.1:8000`）、Kev 服务器（默认 `http://127.0.0.1:8008`）或 OpenAI 区域端点。`clef` 会忽略它。 |
| `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` | 无 | Clef：Cloudflare 账户 ID。`clef` 必填。 |
| `REASONING_ROUTER_CLASSIFIER_MODEL` | 无 | Clef：`clef` 或 `clef-flash`。`clef` 必填。Laya：可选的检查点。Kev：可选，仅原样回显。OpenAI Decisions：`gpt-6-luna`。 |
| `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | `4000` | 分类的总预算，含重试。 |
| `REASONING_ROUTER_MAX_RETRIES` | `1` | 遇到可重试错误后分类器的重试次数（0–10）。 |
| `REASONING_ROUTER_FALLBACK_MODE` | `fixed` | 失败时：`fixed`、`previous`（上一次分类得到的强度，否则为 fixed）或 `error`。 |
| `REASONING_ROUTER_FALLBACK_EFFORT` | `high` | `fixed` 回退所使用的强度。 |
| `REASONING_ROUTER_BASE_EFFORT` | 模型默认值 | 直接请求所使用的强度。 |
| `REASONING_ROUTER_DECISIONS_LOG_PATH` | 无 | 决策 JSONL 日志的绝对路径。 |

分类器凭据请参阅 [`docs/environment.md`](../../docs/environment.md)。决策日志仅包含元数据：模型、强度、
分类器延迟和尝试次数、回退、含缓存读取的 token 用量以及结果，不包含提示词文本或凭据。

## 许可证

[MIT](LICENSE)
