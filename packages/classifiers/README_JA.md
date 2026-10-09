# @reasoning-router/classifiers

[English](README.md) | [简体中文](README_CN.md) | 日本語 | [한국어](README_KO.md)

reasoning-router の推論エフォート分類器です。各分類器は、対象モデルがサポートするエフォートに限定した `choice` 質問を 1 つ、プレーンな `fetch` で判断モデルに尋ねます。OpenAI Decisions のみ、独自のリクエスト形式を使用します。

`classifier` 設定ブロックの `provider` で 1 つ選択します。

## Jev（`provider: "jev"`）

[Jev](https://typesafe.ai/)。TypeSafe または Vercel AI Gateway 経由で利用します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | TypeSafe キー、または Vercel AI Gateway キー。必須。 |
| `baseUrl` | `https://api.typesafe.ai` | Vercel のキーを使う場合は `https://ai-gateway.vercel.sh/typesafe` に設定します。それ以外の値は受け付けられません。 |
| `model` | エンドポイントのモデル | 省略可。TypeSafe の場合は `jev-latest`、Vercel の場合は `typesafe-ai/jev` にする必要があります。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

## Clef（`provider: "clef"`）

Cloudflare の [Clef](https://developers.cloudflare.com/workers-ai/models/clef/)。Workers AI 上で動作します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | Workers AI の権限を持つ Cloudflare API トークン。必須。 |
| `accountId` | なし | Cloudflare アカウント ID。必須。 |
| `model` | なし | `clef` または `clef-flash`。必須。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

## Laya（`provider: "laya"`）

[Laya](https://huggingface.co/convaiinnovations/laya)。自分で動かす Laya サーバーが提供する、オープンソースの Jev 互換モデルです。このパッケージは HTTP 経由で呼び出すだけです。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8000` | Laya サーバー。HTTPS、またはループバックホスト宛ての平文 HTTP のみ。 |
| `apiKey` | なし | 省略可。サーバー側で `LAYA_API_KEY` を設定している場合にのみ設定します。 |
| `model` | サーバーの選択 | 省略可のチェックポイント。例: `english`、`multilingual`。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

## Kev（`provider: "kev"`）

[Kev](https://github.com/jaredpalmer/kev)。自分で動かす `kev.serve` サーバーが提供する、オープンソースの Jev 互換判断モデルファミリーです。このパッケージは HTTP 経由で呼び出すだけです。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:8008` | Kev サーバー。HTTPS、またはループバックホスト宛ての平文 HTTP のみ。 |
| `apiKey` | なし | 省略可。サーバー側で `KEV_API_KEY` を設定している場合にのみ設定します。 |
| `model` | なし | 省略可。そのままエコーバックされるだけで、チェックポイントは起動時にサーバーが選びます（`--run`）。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

<a id="openai-decisions-provider-openai-decisions"></a>

## OpenAI Decisions（`provider: "openai-decisions"`）

OpenAI の Decisions API を呼び出します。ユーザーは、Decisions へのアクセス権を持つ OpenAI API キーを用意します。

| フィールド | デフォルト | 用途 |
| --- | --- | --- |
| `apiKey` | なし | OpenAI API キー。必須。 |
| `baseUrl` | `https://api.openai.com/v1` | `https://us.api.openai.com/v1` または `https://eu.api.openai.com/v1` も指定できます。それ以外の値は受け付けられません。 |
| `model` | `gpt-6-luna` | 受け付けられる値は `gpt-6-luna` のみ。対象の生成モデルとは独立しています。 |
| `timeoutMs` | `4000` | リトライを含む、分類全体の時間予算。 |

このプロバイダーは `POST {baseUrl}/decisions` を呼び出します。長さに上限を設けた分類器の状態は `input` 内の JSON テキストとして渡され、`effort` という名前の `choice` 質問は、既存のエフォートの説明とともに、対象モデルがサポートするエフォートだけを選択肢として提示します。回答は名前で照合されます。拒否、回答の欠落や重複、choice 以外の回答、未サポートのエフォートは、`classifier_invalid_output` としてフォールバックします。認証エラーはリトライされません。429 と 5xx のレスポンスは、`Retry-After` を尊重しつつ、期限内でリトライされます。クライアントによるキャンセルはフォールバックせずに中断します。

OpenAI には、他の分類器と同じ長さに上限を設けた要約が送られます。内容は、直近のユーザーテキスト、アシスタントの進捗、最大 8 件のツール結果、失敗の要約、対象モデル ID です。Zero Data Retention とデータレジデンシーはプロジェクトの適格性に依存します。[OpenAI のデータガイド](https://developers.openai.com/api/docs/guides/your-data)を参照してください。`us.` と `eu.` のエンドポイントを使うには、OpenAI のリージョン要件を満たすプロジェクトまたは組織が必要です（`eu.` の場合は Modified Abuse Monitoring または Zero Data Retention）。満たしていない場合、リクエストは失敗し、ルーターはフォールバックします。この API はパブリックベータで、サポートされるモデルは `gpt-6-luna` のみです。料金は 2026-10-07 時点の確認で、入力 100 万トークンあたり $0.10 で、出力やキャッシュの課金はありません。リージョン別の割増料金や長いコンテキスト向けの乗数が適用される場合があります。[OpenAI の料金](https://developers.openai.com/api/docs/pricing)を再確認してください。

検証にはモックした HTTP コントラクトテストのみを使用しました。実環境での、または認証付きの呼び出しは行っていないため、実環境での互換性は未検証です。Responses API と比べてレイテンシが約 10 倍低いという OpenAI の主張は同社自身のものであり、ルーターの期限の下では測定していません。エフォート選択の品質は、ラベル付きのコーディングエージェントの判断に対して評価していないため、デフォルトは引き続き Jev です。

[Decisions ガイド](https://developers.openai.com/api/docs/guides/decisions)は 2026-10-07 に確認しました。リクエストとレスポンスの型は `openai` npm パッケージ 7.30.0（`src/resources/decisions.ts`。OpenAI の OpenAPI 仕様から生成）から取得しました。当時、`/v1/decisions` の API リファレンスページは公開されていませんでした。リージョン別 URL はデータコントロールガイドから取得し、同日に確認しました。[issue #33](https://github.com/robertn702/reasoning-router/issues/33) を参照してください。

## エクスポート

- `classifierProviders`: すべての分類器。[`@reasoning-router/core`](../core/README_JA.md) の `createConfiguredSelector` 用。
- `jevClassifierProvider`、`clefClassifierProvider`、`layaClassifierProvider`、`kevClassifierProvider`: 各プロバイダー。
- `openAIDecisionsClassifierProvider`、`createOpenAIDecisionsTransport`、`resolveOpenAIDecisionsConnection`、および `OpenAIDecisionsConnection` 型。
- `createJevClassifier`、`createJevTransport`、`createClefTransport`、`createLayaTransport`、`createKevTransport`、`resolveJevConnection`、`resolveClefConnection`、`resolveLayaConnection`、`resolveKevConnection`: 低レベルのヘルパー。
- `ClassifierRequestError` と `Fetch` 型。トランスポートが使用します。

## ライセンス

[MIT](LICENSE)
