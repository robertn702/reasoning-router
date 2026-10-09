# @reasoning-router/opencode

[English](README.md) | [简体中文](README_CN.md) | 日本語 | [한국어](README_KO.md)

各ステップにどれだけの推論が必要かを分類器に尋ね、その推論強度を、プロンプトキャッシュを壊すことなく送信するモデルリクエストに適用する [OpenCode](https://opencode.ai) V2 プラグインです。[`@reasoning-router/classifiers`](../classifiers/README_JA.md) のすべての分類器（Jev、Cloudflare Clef、Laya、Kev、OpenAI Decisions）を利用できます。

> **Alpha。** OpenCode はパッケージ名を指定して npm からプラグインをインストールします。以下に示すように `plugins` に記載してください。

[`opencode-jev-router`](https://github.com/robertn702/opencode-jev-router) から移植されています。

## 要件

- OpenCode V2 2.0.4 以降（2.0.18 でスモークテスト済み）。
- 分類器のキー。Jev の場合: [TypeSafe](https://typesafe.ai/) のキー、または `baseUrl: "https://ai-gateway.vercel.sh/typesafe"` と組み合わせて使う [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/sdks-and-apis/typesafe) のキー。Clef の場合: Cloudflare Workers AI の API トークンとアカウント ID。Laya または Kev の場合: 自分で動かすサーバー（[`docs/environment.md`](../../docs/environment.md) を参照）。OpenAI Decisions の場合: Decisions へのアクセス権を持つ OpenAI API キー。
- GPT-6 Astra、Luna、Sol を提供する Responses API エンドポイント、または会話途中の output-config ベータに対応した Anthropic Messages エンドポイント。

## 使い方

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

プラグインは、`wrap` に列挙したソースモデル（`provider/model` 形式の参照を並べた `openai` および/または `anthropic` 配列）に対してのみ、`reasoning-router/<profile>` エイリアスを登録します。ソースモデル自体には手を加えません。エイリアスへのプライマリリクエストごとに分類が 1 回行われ、分類器が失敗した場合は、フォールバックの推論強度（デフォルトは `high`）でリクエストが続行されます。`decisionsLogPath` を設定すると、ルーティングされた各リクエストについて、判断を下した `classifier` を記録するメタデータのみの `ReasoningDecision` イベントが追記されます。

OpenAI Decisions（パブリックベータ）を使う場合は、`classifier` ブロックを次のように置き換えます。

```jsonc
"classifier": { "provider": "openai-decisions", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" }
```

完全な例は [`examples/opencode.jsonc`](../../examples/opencode.jsonc) を参照してください。

## オプション

| オプション | デフォルト | 用途 |
| --- | --- | --- |
| `classifier.provider` | `REASONING_ROUTER_CLASSIFIER` 環境変数、なければ `jev` | 分類器プロバイダー: `jev`、`clef`、`laya`、`kev`、または `openai-decisions`。 |
| `classifier.apiKey` | `REASONING_ROUTER_CLASSIFIER_API_KEY` 環境変数 | 分類器のキー。`jev`、`clef`、`openai-decisions` では、`fixedEffort` を設定していない限り必須。`laya` と `kev` では省略可。 |
| `classifier.baseUrl` | `REASONING_ROUTER_CLASSIFIER_BASE_URL` 環境変数、なければプロバイダーのデフォルト | Jev のエンドポイント、Laya サーバー（デフォルトは `http://127.0.0.1:8000`）、Kev サーバー（デフォルトは `http://127.0.0.1:8008`）、または OpenAI のリージョナルエンドポイント。 |
| `classifier.accountId` | `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` 環境変数 | Clef: Cloudflare アカウント ID。 |
| `classifier.model` | `REASONING_ROUTER_CLASSIFIER_MODEL` 環境変数 | Clef: `clef` または `clef-flash`（必須）。Laya: 省略可のチェックポイント。Kev: 省略可、エコーバックのみ。OpenAI Decisions: `gpt-6-luna`。 |
| `classifier.timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |
| `wrap` | なし | `openai`/`anthropic` のソース参照を持つ、空でないオブジェクト。必須。 |
| `decisionsLogPath` | オフ | `ReasoningDecision` の JSONL を書き出す絶対パス。 |
| `baseEffort` | プロファイルのデフォルト | レスポンスで報告される、リクエストレベルの推論強度。 |
| `fixedEffort` | なし | 分類器をスキップし、常にこの推論強度を使用します。 |
| `maxRetries` | `1` | 一時的な分類器エラーの後の追加試行回数。 |
| `fallbackMode` | `fixed` | `fixed`、`previous`、または `error`。 |
| `fallbackEffort` | `high` | 分類に失敗したときに使用する推論強度。 |
| `maxRequestBytes` | `1048576` | リクエストボディの最大サイズ。 |
| `maxInFlight` | `32` | 同時リクエスト数。 |
| `upstreamHeaderTimeoutMs` | `10000` | エンドポイントのレスポンスヘッダーを待つ時間。 |
| `upstreamIdleTimeoutMs` | `60000` | ストリーミングされるチャンク間の最大の間隔。 |

ワイヤー上の挙動、ログ記録、制限については、[`docs/behavior.md`](../../docs/behavior.md) と [`docs/classification-policy.md`](../../docs/classification-policy.md) に記載されています。

## ライセンス

[MIT](LICENSE)
