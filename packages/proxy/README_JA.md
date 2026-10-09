# @reasoning-router/proxy

[English](README.md) | [简体中文](README_CN.md) | 日本語

各リクエストにどれだけの推論が必要かを分類器に尋ね、そのエフォートを、プロンプトキャッシュを壊すことなく送信する Responses（`POST
/v1/responses`）または Anthropic Messages（`POST /v1/messages`）リクエストに適用する、スタンドアロンの HTTP プロキシです。Node.js 24.x が必要です。

> **Alpha。** 信頼できるローカル環境での使用に限ります。まず[信頼モデル](#trust-model)をお読みください。

## インストール

```bash
npm install -g @reasoning-router/proxy   # installs the reasoning-router command
```

インストールせずに実行することもできます: `npx @reasoning-router/proxy`。

## 使い方

実行するディレクトリに `.env` を作成します（または変数を export します）。

```dotenv
REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
# REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe   # Vercel keys only
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1
REASONING_ROUTER_UPSTREAM_AUTH=bearer
REASONING_ROUTER_UPSTREAM_API_KEY=your-endpoint-key
```

次にプロキシを起動し、クライアントの接続先を `http://127.0.0.1:4320/v1` に設定します。

```bash
reasoning-router
curl --fail http://127.0.0.1:4320/ready
```

すべての変数を確認するには `reasoning-router --help` を実行してください。デフォルト値は [`.env.example`](../../.env.example)、分類器の設定は [`docs/environment.md`](../../docs/environment.md)、プローブ、シャットダウン、制限、転送については [`docs/behavior.md`](../../docs/behavior.md) を参照してください。

<a id="trust-model"></a>

## 信頼モデル

このプロキシは、信頼できる 1 台のマシンで使うためのものです。待ち受けるのは `127.0.0.1` のみで、呼び出し元の認証はありません。ポートに到達できるローカルプロセスならどれでもリクエストを送信でき、`REASONING_ROUTER_UPSTREAM_AUTH=bearer` の場合、それらのリクエストには設定済みのアップストリームキーが使われます。

すべてのリクエストは、プロキシが待ち受けているポートについて、`Host` が `127.0.0.1:<port>` または `localhost:<port>` でなければなりません。それ以外のリクエストは、ボディが読み取られ、分類され、転送される前に `400` を返されます。これにより、Web ページからの DNS リバインディング攻撃を防ぎます。ただしこれは認証ではなく、Web ページが `http://127.0.0.1:<port>` に直接リクエストを送信することは防げません。トンネルやリバースプロキシでポートを公開しないでください。別のポートへのフォワードやコンテナのマッピングも `400 invalid_host` になります。

## Codex CLI

上記のとおりプロキシを起動し、`~/.codex/config.toml` にカスタムプロバイダーを追加します。

```toml
model = "gpt-6.1-sol"
model_provider = "reasoning-router"

[model_providers.reasoning-router]
name = "reasoning-router"
base_url = "http://127.0.0.1:4320/v1"
wire_api = "responses"
```

Codex は認証情報を送信しません。プロキシが `REASONING_ROUTER_UPSTREAM_API_KEY` を付与します（`REASONING_ROUTER_UPSTREAM_AUTH=bearer`）。プロキシは HTTP のみを提供するため、`supports_websockets` は未設定のままにしてください。

- 使えるのは OpenAI API キーのみです。ChatGPT サブスクリプションでのログインはサポートされません。
- `gpt-6-astra`、`gpt-6-luna`、`gpt-6-sol`、`gpt-6.1-sol` を使用してください。それ以外のモデルはローカルで `400` になります。
- エフォートは分類器が選びます。Codex の `model_reasoning_effort` と `/model` のエフォートは、Codex 上には表示されますが無視されます。
- Codex 0.159.0 は `gpt-6.1-sol` を認識せず、`model_catalog_json` を指定しない限り汎用メタデータで実行します。
- プロキシは、60 秒間データがないアップストリームのストリームを閉じます。長いターンが途中で切れる場合は、`REASONING_ROUTER_UPSTREAM_IDLE_TIMEOUT_MS` を引き上げてください。

詳細は [`docs/harnesses/codex.md`](../../docs/harnesses/codex.md) を参照してください。

## ライセンス

[MIT](LICENSE)
