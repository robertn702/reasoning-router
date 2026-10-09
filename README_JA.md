# reasoning-router

[English](README.md) | [简体中文](README_CN.md) | 日本語 | [한국어](README_KO.md)

[![CI](https://github.com/robertn702/reasoning-router/actions/workflows/ci.yml/badge.svg)](https://github.com/robertn702/reasoning-router/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40reasoning-router%2Fproxy?label=%40reasoning-router%2Fproxy)](https://www.npmjs.com/package/@reasoning-router/proxy)
[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**品質はそのままに、推論コストを抑えます。** `reasoning-router` は、コーディングセッションの各ステップにどれだけの推論が必要かを分類器に尋ねます。これにより、推論強度（エフォート）を手動で切り替えなくても、1 つの強力なモデルで素早い編集も難しいデバッグもこなせます。OpenCode、Pi、Codex CLI、そしてローカルプロキシと通信できる任意のクライアントで動作し、分類器は自由に選べます。

![コア比較: 両アームとも 44 件中 44 件を解決。Jev は固定 high と比べて、入力が平均 20.2% 少なく、出力が 14.3% 少なく、時間が 8.7% 短い。](eval/results/router-core-comparison.svg)

テストした GPT-6 Astra のタスク構成では、Jev でルーティングした推論強度と固定の推論強度 `high` はどちらも **44/44 回の試行**を解決し、Jev は平均で出力トークンが **14% 少なく**（推論を含む）、完了までの時間が **9% 短く**なりました。他のワークロード、モデル、分類器では結果が異なる可能性があります。
[評価を見る](eval/results/router-consolidated-2026-09-25.md)。

> **ステータス: alpha。** 以下のパッケージは、各パッケージの README の説明に従って npm からインストールしてください。

## クイックスタート

使用するハーネスを選んでください。各例では TypeSafe キーを使った Jev を使用しています。他の分類器については[分類器](#classifiers)を参照してください。

**OpenCode** — `opencode.json` にプラグインを追加します
（[詳細ガイド](packages/opencode/README_JA.md)）:

```jsonc
{
  "plugins": [{ "package": "@reasoning-router/opencode", "options": {
    "classifier": { "provider": "jev", "apiKey": "{env:REASONING_ROUTER_CLASSIFIER_API_KEY}" },
    "wrap": { "openai": ["openai/gpt-6-astra"] }
  }}],
  "model": "reasoning-router/gpt-6-astra"
}
```

**Pi** — Claude モデルのみ（[詳細ガイド](packages/pi/README_JA.md)）:

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key>
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

**Codex CLI、または Responses/Messages クライアント** — ローカルプロキシを起動し、クライアントの接続先を `http://127.0.0.1:4320/v1` に設定します（[詳細ガイド](packages/proxy/README_JA.md)）:

```bash
REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key> \
REASONING_ROUTER_UPSTREAM_BASE_URL=https://api.openai.com/v1 \
REASONING_ROUTER_UPSTREAM_AUTH=bearer \
REASONING_ROUTER_UPSTREAM_API_KEY=<openai-key> \
npx @reasoning-router/proxy
```

分類器が遅い場合や利用できない場合でも、リクエストはフォールバックの推論強度（デフォルトは `high`）で実行されます。

## 仕組み

プライマリリクエストごとに、ルーターは次の処理を行います。

1. 直近の会話の要約（長さに上限あり）を分類器に送信し、分類器が推論強度を選びます（たとえば、リネームなら `low`、失敗しているテストなら `high`）。
2. その推論強度を、OpenAI の `configuration_update` アイテム、または Anthropic の推論強度のみのシステムメッセージとしてリクエストに追加します。以前の更新はそのまま残るため、プロンプトのプレフィックスはキャッシュ可能な状態を保ちます。
3. リクエストをモデルのエンドポイントに送信し、レスポンスをそのままストリーミングで返します。

## 何がどこに送信されるか

- **分類器へ:** 直近のユーザーおよびアシスタントのテキストの抜粋（長さに上限あり）、最大 8 件の直近のツール結果（ツール名とエラーフラグ付き）、短い失敗の要約、およびモデル ID。ホスト型ツールとコンピューター操作のペイロードは送信されません。Laya、Kev、SemIf、CLM は自分のサーバー上で動作します。
- **お使いのエンドポイントへ:** 推論強度の更新を追加した完全なリクエスト。
- **ログに記録されるもの:** メタデータのみ（ID、モデル、推論強度、レイテンシ、トークン数）で、記録先もプロキシの stdout か、有効にした判断ログのみです。プロンプト、ツールの出力、認証情報、生のエラーが記録されることはありません。

詳細は [docs/behavior.md](docs/behavior.md) を参照してください。

## なぜ必要か

同じモデルでも、低い推論強度と最大の推論強度とでは、能力も価格も別々のモデルティアと同じくらい差が出ることがあります。

コーディングセッションの簡単なステップを安価なモデルに振り分けることもできますが、モデルを切り替えるとプロンプトキャッシュが無効になります。長いセッションでは、そのコンテキストを再構築するコストが、安価なモデルで節約できる分を上回ることがあります。

会話の途中で推論強度を変更できるモデルならキャッシュが保たれるため、セッション全体を 1 つの強力なモデルで通せます。単純な編集やツール呼び出しには低い推論強度を使い、高い推論強度や最大の推論強度はアーキテクチャの検討や難しいデバッグのために温存できます。`reasoning-router` は、各ステップの推論強度を選びます。

## alpha 版の制限事項

- **動作確認済み:** Node.js 24.x、OpenCode V2 2.0.18、Pi 1.0.4、Codex CLI 0.159.0（プロキシ経由）。他のバージョンでも動作する可能性はありますが、未検証です。
- **モデル:** [対応モデル](#supported-models)に記載のものだけです。それ以外のモデルはローカルで拒否されます。Pi がルーティングするのは Claude モデルのみです。
- **分類器:** ルーターは設定された分類器に問い合わせ、その回答を適用します。ご利用のワークロードに対して分類器がどれだけ適切に推論強度を選べるかについては、何も保証しません。
- **プロキシ:** 信頼できるローカル環境での使用に限ります。詳しくは[信頼モデル](packages/proxy/README_JA.md#trust-model)を参照してください。

脆弱性は [SECURITY.md](SECURITY.md) の手順に従って報告してください。

## 目的

`reasoning-router` は、エージェントセッションの各ステップにどれだけの推論が必要かを分類器に尋ね、その推論強度を、プロンプトキャッシュを壊すことなく送信するモデルリクエストに適用します。

- **任意の分類器。** [Jev](https://typesafe.ai/) は、あるステップにどれだけの推論が必要かを分類できる複数の判断モデルの 1 つであり、今後も追加が予定されています。どの分類器を使うかは依存関係ではなく設定です。`reasoning-router` は Jev や特定の単一プロバイダーに依存してはなりません。
- **任意のハーネス。** 同じルーティングが、OpenCode、Pi、またはスタンドアロンプロキシと通信できる任意のクライアント内で動作します。

パッケージは次のとおりです。

- [`@reasoning-router/core`](packages/core/README_JA.md): ハーネスにも分類器にも依存しない、共有のルーター。
- [`@reasoning-router/opencode`](packages/opencode/README_JA.md): OpenCode V2 プラグイン。
- [`@reasoning-router/classifiers`](packages/classifiers/README_JA.md): 分類器（Jev、Cloudflare Clef、Laya、Kev、SemIf、OpenAI Decisions、CLM）。`classifier.provider` で選択します。
- [`@reasoning-router/pi`](packages/pi/README_JA.md): Pi 拡張機能（現時点では Claude モデルのみ）。
- [`@reasoning-router/proxy`](packages/proxy/README_JA.md): スタンドアロンの Responses/Messages プロキシ（コマンド `reasoning-router`）。

課題の整理、パッケージ計画、未解決の論点については [docs/architecture.md](docs/architecture.md) を、ルーターのワイヤー上の挙動については [docs/behavior.md](docs/behavior.md) を参照してください。

<a id="classifiers"></a>

## 分類器

分類器は、`REASONING_ROUTER_CLASSIFIER`（プロキシと Pi）またはプラグインの `classifier.provider` オプション（OpenCode）で選びます。以下の例ではプロキシを使用しています。OpenCode プラグインでは `classifier.apiKey`、`classifier.baseUrl`、`classifier.accountId`、`classifier.model` として同じ設定を指定でき、指定がなければこれらの環境変数にフォールバックします。すべての設定については [docs/environment.md](docs/environment.md) と [`@reasoning-router/classifiers`](packages/classifiers/README_JA.md) を参照してください。

### Jev（デフォルト）

[Jev](https://typesafe.ai/) は TypeSafe が提供するホスト型の判断モデルです。TypeSafe の API キーを取得してから、次を実行します。

```bash
REASONING_ROUTER_CLASSIFIER=jev \
REASONING_ROUTER_CLASSIFIER_API_KEY=<typesafe-key> \
reasoning-router
```

代わりに Vercel AI Gateway のキーを使う場合は、
`REASONING_ROUTER_CLASSIFIER_BASE_URL=https://ai-gateway.vercel.sh/typesafe` も設定してください。

### Cloudflare Clef

[Clef](https://developers.cloudflare.com/workers-ai/models/clef/) は Cloudflare Workers AI 上で動作します。Workers AI の権限を持つ Cloudflare API トークンを作成してから、次を実行します。

```bash
REASONING_ROUTER_CLASSIFIER=clef \
REASONING_ROUTER_CLASSIFIER_API_KEY=<cloudflare-token> \
REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID=<cloudflare-account-id> \
REASONING_ROUTER_CLASSIFIER_MODEL=clef \
reasoning-router
```

`REASONING_ROUTER_CLASSIFIER_MODEL` は `clef` または `clef-flash` に設定します。この設定は必須です。

### Laya

[Laya](https://huggingface.co/convaiinnovations/laya) は、自分で動かすオープンソースの Jev 互換判断モデルです。ルーターは HTTP 経由で呼び出すだけで、モデルのインストールやロードは行いません。Laya の `laya-serve` を起動してから、ルーターの接続先をそこに向けます。

```bash
pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_PRELOAD=1 laya-serve   # http://127.0.0.1:8000
REASONING_ROUTER_CLASSIFIER=laya reasoning-router
```

デフォルトのベース URL は `http://127.0.0.1:8000` です。リモートサーバーでは HTTPS を使う必要があります。`REASONING_ROUTER_CLASSIFIER_API_KEY` は、サーバー側で `LAYA_API_KEY` を設定している場合にのみ設定してください。チェックポイント（`english`、`multilingual`、`typed-decisions`）は `REASONING_ROUTER_CLASSIFIER_MODEL` で選びます。

### Kev

[Kev](https://github.com/jaredpalmer/kev) は、自分で `kev.serve` を使って動かす、オープンソースの Jev 互換判断モデルファミリーです。ルーターは HTTP 経由で呼び出すだけです。

```bash
uv run --extra serve python -m kev.serve --run jaredpalmer/kev-4b@v1.0   # http://127.0.0.1:8008
REASONING_ROUTER_CLASSIFIER=kev reasoning-router
```

固定バージョン、確認済みの HTTP コントラクト、認証、制限、まだ検証されていない事項については [docs/proposals/kev.md](docs/proposals/kev.md) を参照してください。

### SemIf

[SemIf](https://github.com/TheoLeeCJ/SemIf-OpenJev)（旧 OpenJev）は、自分で動かす固定（frozen）のオープンモデルの次トークン logits から、各選択肢の確率を読み取ります。ルーターは HTTP 経由で呼び出すだけです。アップストリームはまだサーバーをリリースしていません。`semif-serve` は [PR #27](https://github.com/TheoLeeCJ/SemIf-OpenJev/pull/27) にしか存在しないため、その PR のブランチから実行してください。これは未リリースのコードであり、コントラクトが変わる可能性があります。

```bash
SEMIF_BACKEND=torch SEMIF_MODEL=Qwen/Qwen3.5-4B \
SEMIF_REVISION=851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a \
SEMIF_MAX_INPUT_TOKENS=8192 semif-serve   # http://127.0.0.1:8471
REASONING_ROUTER_CLASSIFIER=semif reasoning-router
```

`SEMIF_BACKEND` は `torch`（CUDA）、`mlx`（Apple Silicon）、`llamacpp`（CPU、`SEMIF_GGUF` が必要）のいずれかです。デフォルトのベース URL は `http://127.0.0.1:8471` です。リモートサーバーでは HTTPS を使う必要があります。`REASONING_ROUTER_CLASSIFIER_API_KEY` は、サーバー側で `SEMIF_API_KEY` を設定している場合にのみ設定してください。サーバーは `model` を必須とするため、ルーターは常に `model` を送信します。デフォルトは `semif-latest` で、`REASONING_ROUTER_CLASSIFIER_MODEL` に、サーバーが提供するモデル ID または Jev のエイリアスを設定することもできます。

ルーターの上限付きの状態は最大で約 18.4k 文字になり、サーバーのデフォルトの `SEMIF_MAX_INPUT_TOKENS`（4096）を超えることがあります。上限を超えたプロンプトは失敗し（サーバーは切り詰めません）、ルーターはフォールバックするため、この値を引き上げてください。8192 は未計測です。このプリセットはモックした `fetch` に対してのみテストされており、SemIf が推論強度をどれだけうまく選べるかを示す証拠もまだありません。[docs/proposals/semif.md](docs/proposals/semif.md) を参照してください。

### OpenAI Decisions

`openai-decisions` 分類器は、ご自身の OpenAI API キーで OpenAI の Decisions API（パブリックベータ、モデルは `gpt-6-luna`）を呼び出します。

```bash
REASONING_ROUTER_CLASSIFIER=openai-decisions \
REASONING_ROUTER_CLASSIFIER_API_KEY="$OPENAI_API_KEY" \
reasoning-router
```

モックしたレスポンスに対してのみテストされており、実環境での互換性と推論強度の選択品質は未検証です。プライバシーの境界、リージョナルエンドポイント、コストについては
[packages/classifiers](packages/classifiers/README_JA.md#openai-decisions-provider-openai-decisions)
を参照してください。

### CLM

[CLM](https://github.com/Contrastive-LM/CLM) は、自分で `clm-serve` を使って動かす判断モデルです。`clm-serve` には、同じく自分で動かす別のプーリングバックエンド（Qwen3-8B の埋め込み。例: vLLM）が必要です。ルーターは `clm-serve` を HTTP 経由で呼び出すだけです。

```bash
vllm serve Qwen/Qwen3-8B --served-model-name qwen3-8b --runner pooling --max-model-len 2048 --host 127.0.0.1 --port 8090
clm-serve --host 127.0.0.1 --no-ui   # http://127.0.0.1:8700
REASONING_ROUTER_CLASSIFIER=clm reasoning-router
```

デフォルトのベース URL は `http://127.0.0.1:8700` です。`REASONING_ROUTER_CLASSIFIER_API_KEY` は、サーバー側で `CLM_API_KEY` を設定している場合にのみ設定してください。CLM ヘッドは `REASONING_ROUTER_CLASSIFIER_MODEL` で選びます（サーバーのデフォルトは `clm-latest`）。固定バージョン、プーリングバックエンド、2,048 トークンでの切り詰めについては [docs/classifiers/clm.md](docs/classifiers/clm.md) を参照してください。検証したのは API の互換性のみで、推論強度の判断品質は検証していません。

<a id="supported-models"></a>

## 対応モデル

ルーターは、これら以外のモデルをローカルで拒否します。お使いのアップストリームアカウントでそのモデルを利用できるかどうかは、別の問題です。

| モデル | ID | API | 推論強度 | ベースの推論強度 | Pi |
| --- | --- | --- | --- | --- | --- |
| GPT-6 Astra | `gpt-6-astra` | Responses | low–max | medium | 非対応 |
| GPT-6 Luna | `gpt-6-luna` | Responses | none–max | medium | 非対応 |
| GPT-6 Sol | `gpt-6-sol` | Responses | none–max | medium | 非対応 |
| GPT-6.1 Sol | `gpt-6.1-sol` | Responses | low–max | medium | 非対応 |
| Claude Fable 5.1 | `claude-fable-5-1` | Messages | low–max | high | 対応 |
| Claude Mythos 5.1 | `claude-mythos-5-1` | Messages | low–max | high | 非対応 (Pi 1.0.4) |
| Claude Opus 5.5 | `claude-opus-5-5` | Messages | low–max | medium | 対応 |
| Claude Opus 5 | `claude-opus-5` | Messages | low–max | high | 対応 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | Messages | low–max | medium | 対応 |

推論強度は none、low、medium、high、xhigh、max の順です。ベースの推論強度はモデルのデフォルトのリクエストレベルの推論強度で、`REASONING_ROUTER_BASE_EFFORT` で上書きできます。分類に失敗した場合、ルーターはフォールバックの推論強度を使用します。これはすべてのモデルでデフォルトが `high` で、`REASONING_ROUTER_FALLBACK_EFFORT` またはプラグインの `fallbackEffort` オプションで設定できます。[docs/behavior.md](docs/behavior.md) と [docs/classification-policy.md](docs/classification-policy.md) を参照してください。レジストリは
[`packages/core/src/models.ts`](packages/core/src/models.ts)
にあります。

## 開発

Node.js 24.x が必要です。

```bash
npm ci
npm run check   # typecheck + lint + test
```

コマンドの全一覧とリポジトリの規約については [AGENTS.md](AGENTS.md) を参照してください。

## これまでの決定事項

以下は元に戻せる決定です。

- **npm workspaces**（`packages/*`）。
- **Node 24、TypeScript、Vitest**。
- **Biome** による lint とフォーマット。1 つの開発依存関係でプラグインなしに両方をカバーします。`noNonNullAssertion` は無効、`noExplicitAny` はテストでは無効です。
- **型アサーションは使用しません。** Biome の `nursery/noUnsafeTypeAssertion` はエラーとして扱い、例外は `as const` のみです。アノテーション、`satisfies`、型述語、絞り込みを使い、指摘されたコードはルールを抑制せずに修正してください。このルールは Biome の nursery にあるため、マイナーリリースで挙動が変わる可能性があります。
- **ソース条件。** パッケージの `exports` はカスタムの `@reasoning-router/source` 条件を `src/*.ts` にマップします。そのため、型チェックとテストはビルドなしでソースに対して実行され、公開パッケージの利用者には `dist/` が提供されます。
- **Changesets**（バージョンは独立）。パッケージの公開される挙動を変更する PR ごとに changeset を追加します。リリースワークフローが "Version Packages" PR を作成し、それをマージすると、npm の trusted publishing により provenance 付きで npm に公開されます（npm トークンは保存されません）。
- **スタンドアロンプロキシは独立したパッケージです**（`@reasoning-router/proxy`、コマンドは `reasoning-router`）。分類器を必要とする一方で、core は分類器に依存してはならないためです。スコープなしの `reasoning-router` という名前は、将来の統合 CLI のために空けてあります。
- **Zod は設定のみに使用します。** プラグインオプション、プロキシの環境変数、分類器の設定は Zod スキーマであり、オプションの型はそれらのスキーマから推論されます。core は共有スキーマと、すべての問題を 1 つのエラーにまとめて報告する `parseConfig` をエクスポートします。リクエストボディとストリーミングされる使用量は `isRecord` による絞り込みのままとし、未知のプロバイダーフィールドがそのまま通過するようにしています。Zod は core の唯一の依存関係です。
- **Pi 拡張機能は Pi の仮想モデルを使用します。** 設定するのは思考レベルのみで、推論強度の配置は Pi に任せるため、Pi が会話途中の推論強度を提供する Anthropic モデルのみをサポートします。Pi 拡張機能にはオプションがないため、プロキシの `REASONING_ROUTER_*` 変数を読み取り、最後に分類された推論強度を `previous` フォールバック用に Pi のセッションへ保存します。
- **Laya の `baseUrl` は HTTPS か、ループバック宛ての平文 HTTP のみです。** これにより、会話の要約がネットワーク上を暗号化なしで流れることはありません。デフォルトは `laya-serve` の `http://127.0.0.1:8000` で、ルーターは `max_len` を送信しません。
- **Kev は独自の `kev` プリセットです。** 接続ルールは Laya と同じで、判断ログに正しいサービス名が記録されます。デフォルトのベース URL は `kev.serve` の `http://127.0.0.1:8008` です。
- **SemIf は独自の `semif` プリセットです。** 接続ルールは Laya と同じです。デフォルトのベース URL は `semif-serve` の `http://127.0.0.1:8471` で、このサーバーは `model` を必須とするため、プリセットは常に `model` を送信します（デフォルトは `semif-latest`）。
- **CLM も独自の `clm` プリセットです。** 接続ルールは Laya と同じです。デフォルトのベース URL は `clm-serve` の `http://127.0.0.1:8700` です。
- **OpenAI Decisions のベース URL は許可リスト方式です**（グローバル、`us.`、`eu.` の OpenAI API ルート）。そのため、別の分類器の設定から残ったベース URL に OpenAI キーが送られることはありません。`model` は、OpenAI がモデルを追加するまで `gpt-6-luna` のみを受け付けます。

## ライセンス

[MIT](LICENSE)
