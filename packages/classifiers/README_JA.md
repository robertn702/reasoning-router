# @reasoning-router/classifiers

[English](README.md) | [简体中文](README_CN.md) | 日本語 | [한국어](README_KO.md)

reasoning-router の推論強度の分類器です。各分類器は、対象モデルがサポートする推論強度に限定した `choice` 質問を 1 つ、プレーンな `fetch` で判断モデルに尋ねます。OpenAI Decisions のみ、独自のリクエスト形式を使用します。

`classifier` 設定ブロックの `provider` で 1 つ選択します。

## Jev（`provider: "jev"`）

[Jev](https://typesafe.ai/)。TypeSafe または Vercel AI Gateway 経由で利用します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | TypeSafe キー、または Vercel AI Gateway キー。必須。 |
| `baseUrl` | `https://api.typesafe.ai` | Vercel のキーを使う場合は `https://ai-gateway.vercel.sh/typesafe` に設定します。それ以外の値は受け付けられません。 |
| `model` | エンドポイントのモデル | 省略可。TypeSafe の場合は `jev-latest`、Vercel の場合は `typesafe-ai/jev` にする必要があります。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

キーは検査されず、エンドポイントも自動検出されないため、`baseUrl` は認証情報に合わせて設定する必要があります。

## Clef（`provider: "clef"`）

Cloudflare の [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)。Workers AI 上で動作します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | Workers AI の権限を持つ Cloudflare API トークン。必須。 |
| `accountId` | なし | Cloudflare アカウント ID。必須。 |
| `model` | なし | `clef` または `clef-flash`。必須。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

キーはアカウント ID とともに、Workers AI の
`https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/@cf/cloudflare/{model}`
の呼び出しに使われます。`baseUrl` は無視されます。

## Laya（`provider: "laya"`）

[Laya](https://huggingface.co/convaiinnovations/laya)。自分で動かす Laya サーバー（`laya-serve` など）が提供する、オープンソースの Jev 互換モデルです。このパッケージは HTTP 経由で呼び出すだけです。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya サーバー。HTTPS、またはループバックホスト宛ての平文 HTTP のみ。 |
| `apiKey` | なし | 省略可。サーバー側で `LAYA_API_KEY` を設定している場合にのみ設定します。 |
| `model` | サーバーの選択 | 省略可のチェックポイント: `english`、`multilingual`、`typed-decisions`。未設定の場合、サーバーが状態の言語に応じて選びます。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

`{baseUrl}/v1/systemone` を呼び出します。キーは bearer トークンとして送信され、空白のキーは未設定として扱われます。

## Kev（`provider: "kev"`）

[Kev](https://github.com/jaredpalmer/kev)。自分で動かす `kev.serve` サーバーが提供する、オープンソースの Jev 互換判断モデルファミリーです。このパッケージは HTTP 経由で呼び出すだけです。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8008` | Kev サーバー。HTTPS、またはループバックホスト宛ての平文 HTTP のみ。 |
| `apiKey` | なし | 省略可。サーバー側で `KEV_API_KEY` を設定している場合にのみ設定します。 |
| `model` | なし | 省略可。そのままエコーバックされるだけで、チェックポイントは起動時にサーバーが選びます（`--run`）。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

`{baseUrl}/v1/systemone` を呼び出し、キーの規則は Laya と同じです（bearer トークン。空白のキーは未設定として扱われます）。[Kev の提案](../../docs/proposals/kev.md)を参照してください。

<a id="openai-decisions-provider-openai-decisions"></a>

## OpenAI Decisions（`provider: "openai-decisions"`）

OpenAI の Decisions API を呼び出します。ユーザーは、Decisions へのアクセス権を持つ OpenAI API キーを用意します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | OpenAI API キー。必須。 |
| `baseUrl` | `https://api.openai.com/v1` | `https://us.api.openai.com/v1` または `https://eu.api.openai.com/v1` も指定できます。それ以外の値は受け付けられません。 |
| `model` | `gpt-6-luna` | 受け付けられる値は `gpt-6-luna` のみ。対象の生成モデルとは独立しています。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

このプロバイダーは `POST {baseUrl}/decisions` を呼び出します。長さに上限を設けた分類器の状態は `input` 内の JSON テキストとして渡され、`effort` という名前の `choice` 質問は、既存の推論強度の説明とともに、対象モデルがサポートする推論強度だけを選択肢として提示します。回答は名前で照合されます。拒否、回答の欠落や重複、choice 以外の回答、未サポートの推論強度は、`classifier_invalid_output` としてフォールバックします。認証エラーはリトライされません。429 と 5xx のレスポンスは、`Retry-After` を尊重しつつ、期限内でリトライされます。クライアントによるキャンセルはフォールバックせずに中断します。

OpenAI には、他の分類器と同じ長さに上限を設けた要約が送られます。内容は、直近のユーザーテキスト、アシスタントの進捗、最大 8 件のツール結果、失敗の要約、対象モデル ID です。Zero Data Retention とデータレジデンシーはプロジェクトの適格性に依存します。[OpenAI のデータガイド](https://developers.openai.com/api/docs/guides/your-data)を参照してください。`us.` と `eu.` のエンドポイントを使うには、OpenAI のリージョン要件を満たすプロジェクトまたは組織が必要です（`eu.` の場合は Modified Abuse Monitoring または Zero Data Retention）。満たしていない場合、リクエストは失敗し、ルーターはフォールバックします。この API はパブリックベータで、サポートされるモデルは `gpt-6-luna` のみです。料金は 2026-10-07 時点の確認で、入力 100 万トークンあたり $0.10 で、出力やキャッシュの課金はありません。リージョン別の割増料金や長いコンテキスト向けの乗数が適用される場合があります。[OpenAI の料金](https://developers.openai.com/api/docs/pricing)を再確認してください。

検証にはモックした HTTP コントラクトテストのみを使用しました。実環境での、または認証付きの呼び出しは行っていないため、実環境での互換性は未検証です。Responses API と比べてレイテンシが約 10 倍低いという OpenAI の主張は同社自身のものであり、ルーターの期限の下では測定していません。推論強度の選択品質は、ラベル付きのコーディングエージェントの判断に対して評価していないため、デフォルトは引き続き Jev です。

[Decisions ガイド](https://developers.openai.com/api/docs/guides/decisions)は 2026-10-07 に確認しました。リクエストとレスポンスの型は `openai` npm パッケージ 7.30.0（`src/resources/decisions.ts`。OpenAI の OpenAPI 仕様から生成）から取得しました。当時、`/v1/decisions` の API リファレンスページは公開されていませんでした。リージョン別 URL はデータコントロールガイドから取得し、同日に確認しました。[issue #33](https://github.com/robertn702/reasoning-router/issues/33) を参照してください。

## CLM（`provider: "clm"`）

[CLM](https://github.com/Contrastive-LM/CLM)。自分で動かす `clm-serve` サーバーが提供します。`clm-serve` には、同じく自分で動かす別のプーリングバックエンド（Qwen3-8B の埋め込み。例: vLLM）が必要です。このパッケージは `clm-serve` を HTTP 経由で呼び出すだけです。固定バージョンと制限については [docs/classifiers/clm.md](../../docs/classifiers/clm.md) を参照してください。検証したのは API の互換性のみで、推論強度の判断品質は検証していません。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8700` | CLM サーバー。HTTPS、またはループバックホスト宛ての平文 HTTP のみ。 |
| `apiKey` | なし | 省略可。サーバー側で `CLM_API_KEY` を設定している場合にのみ設定します。 |
| `model` | サーバーの `clm-latest` | 省略可の CLM ヘッド: `clm-latest`、`clm-raw`、または `--model NAME=PATH` で読み込んだヘッド。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

`{baseUrl}/v1/systemone` を呼び出し、キーの規則は Laya と同じです（bearer トークン。空白のキーは未設定として扱われます）。

<a id="microsoft-decision-1-provider-microsoft-decision"></a>

## Microsoft-Decision-1（`provider: "microsoft-decision"`）

Microsoft の [Microsoft-Decision-1](https://learn.microsoft.com/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)。ご自身の Microsoft Foundry リソースにデプロイして使います。モデルをデプロイしたら、デプロイの詳細ページからリソースエンドポイント、デプロイ名、API キーをコピーします。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `baseUrl` | なし | Foundry リソースエンドポイント。例: `https://<resource>.services.ai.azure.com`。必須。HTTPS で、認証情報、クエリ、フラグメントを含まないこと。 |
| `apiKey` | なし | リソースの API キー。`api-key` ヘッダーで送信されます。必須。 |
| `model` | なし | モデル名ではなく、ご自身のデプロイ名。必須。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

このプロバイダーは、System One リクエストを付けて `POST {baseUrl}/providers/microsoft/v1/systemone` を呼び出します。リクエストは、長さに上限を設けた状態と、対象モデルがサポートする推論強度を選択肢とする `effort` という名前の `choice` 質問 1 つで構成されます。`answers.effort.choice` を読み取り、未サポートまたは欠落した選択は `classifier_invalid_output` としてフォールバックします。エラーボディは破棄されます。認証エラーはリトライされません。429 と 5xx のレスポンスは、`Retry-After` を尊重しつつ、期限内でリトライされます。ルーターは Microsoft Entra ID のベアラートークンを取得も更新もしないため、サポートされません。料金は再確認していません。使用前に Foundry のモデルカタログを確認してください。

このコントラクトは 2026-10-11 に Microsoft のハウツーガイドと照合して確認しました（[issue #64](https://github.com/robertn702/reasoning-router/issues/64) を参照）。検証にはモックした HTTP コントラクトテストのみを使用し、実環境での、または認証付きの呼び出しは行っていません。精度とレイテンシに関する Microsoft の主張は同社自身のものであり、推論強度の選択品質は評価していないため、デフォルトは引き続き Jev です。

<a id="liquid-d1-provider-liquid"></a>

## Liquid d1（`provider: "liquid"`）

Liquid AI のホスト型判断モデル [Liquid d1](https://docs.liquid.ai/lfm/models/d1)。Liquid の API または Vercel AI Gateway 経由で利用します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | Liquid キー（`liquid_...`）、または Vercel AI Gateway キー。必須。 |
| `baseUrl` | `https://api.liquid.ai` | Vercel キーを使う場合は `https://ai-gateway.vercel.sh/typesafe` に設定します。それ以外の値は受け付けません。 |
| `model` | エンドポイントのモデル | 省略可。Liquid では `d1`（デフォルト）またはテキスト専用の `d1:free`、Vercel では `liquid/d1`。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

このプロバイダーは、System One リクエストと bearer キーを付けて `POST https://api.liquid.ai/decisions/v1/systemone` または `POST https://ai-gateway.vercel.sh/typesafe/v1/systemone` を呼び出し、`answers.effort.choice` を読み取ります。Jev と同様にキーは検査しないため、`baseUrl` は認証情報と一致させる必要があります。未サポートまたは欠落した選択は `classifier_invalid_output` としてフォールバックします。エラーボディは破棄されます。認証エラーはリトライされません。429 と 5xx のレスポンスは、`Retry-After` を尊重しつつ、期限内でリトライされます。d1 の `probabilities` と `confidence` は無視されます。

このコントラクトは 2026-10-11 に Liquid の d1 ガイド、および Vercel の TypeSafe API ページと d1 の変更履歴と照合して確認しました（[issue #68](https://github.com/robertn702/reasoning-router/issues/68) を参照）。検証にはモックした HTTP コントラクトテストのみを使用し、実環境での、または認証付きの呼び出しは行っていません。品質に関する Liquid の主張は同社自身のものであり、推論強度の選択品質は評価していないため、デフォルトは引き続き Jev です。

## エクスポート

- `classifierProviders`: すべての分類器。[`@reasoning-router/core`](../core/README_JA.md) の `createConfiguredSelector` 用。
- `jevClassifierProvider`、`clefClassifierProvider`、`layaClassifierProvider`、`kevClassifierProvider`: 各プロバイダー。
- `openAIDecisionsClassifierProvider`、`createOpenAIDecisionsTransport`、`resolveOpenAIDecisionsConnection`、および `OpenAIDecisionsConnection` 型。
- `clmClassifierProvider`、`createClmTransport`、`resolveClmConnection`、および `ClmConnection` 型。
- `microsoftDecisionClassifierProvider`、`createMicrosoftDecisionTransport`、`resolveMicrosoftDecisionConnection`、および `MicrosoftDecisionConnection` 型。
- `liquidClassifierProvider`、`createLiquidTransport`、`resolveLiquidConnection`、および `LiquidConnection` 型。
- `createJevClassifier`、`createJevTransport`、`createClefTransport`、`createLayaTransport`、`createKevTransport`、`resolveJevConnection`、`resolveClefConnection`、`resolveLayaConnection`、`resolveKevConnection`: 低レベルのヘルパー。
- `ClassifierRequestError` と `Fetch` 型。トランスポートが使用します。

## ライセンス

[MIT](LICENSE)
