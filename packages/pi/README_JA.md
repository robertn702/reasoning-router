# @reasoning-router/pi

[English](README.md) | [简体中文](README_CN.md) | 日本語 | [한국어](README_KO.md)

各 Claude リクエストにどれだけの推論が必要かを分類器に尋ね、そのエフォートをプロンプトキャッシュを壊すことなく Pi に配置させる [Pi](https://pi.dev) 拡張機能です。Pi 1.0.0 以降と Node.js 24.x が必要です。

```bash
export REASONING_ROUTER_CLASSIFIER_API_KEY=your-jev-key
pi install npm:@reasoning-router/pi
pi --model reasoning-router/claude-opus-5-5
```

`@earendil-works/pi-coding-agent` に対するピア範囲 `*` は、Pi 1.0.0 を強制しません。古い Pi には `registerVirtualModel` がないため、拡張機能の読み込みに失敗します。

この拡張機能は、ルーターが認識している Claude モデルごとに、仮想モデル `reasoning-router/<id>` を追加します。各リクエストは、既存の Anthropic ログインまたはキーを使って、対応する `anthropic/<id>` モデル上で実行されます。ルーターが選ぶのは思考レベルだけです。会話途中のエフォートに対応するこれらのモデルでは、Pi が `output_config.effort: "high"` を固定し、選ばれたエフォートをエフォートのみのシステムメッセージで伝えます。そのため、エフォートを変更してもキャッシュされたプレフィックスは保たれます。

- ユーザーターンと継続が分類されます。リトライでは、失敗した試行の思考レベルが再利用されます。コンパクションなどの直接リクエストでは、`REASONING_ROUTER_BASE_EFFORT`、またはモデルのベースエフォートが使用されます。この変数が影響するのはそれらのリクエストだけで、上記の固定された `high` には影響しません。
- 最後に分類されたエフォートは、仮想モデルごとにセッションへ保存されるため、`previous` フォールバックは再起動後も維持されます。
- Pi にないモデルや、Pi が会話途中のエフォートを提供できないモデルは、`reasoning-router unsupported_model: ...` で拒否されます。Pi 1.0.0 と 1.0.4 では、`claude-mythos-5-1` がこれに該当します。
- `error` フォールバックモードで分類に失敗すると、リクエストは `reasoning-router classification_failed: ...` で拒否されます。リクエストのキャンセル時は決してフォールバックしません。Pi は一時的なプロバイダー障害のように見えるエラーをリトライするため、これらのメッセージには HTTP ステータスコードを含めません。
- 分類器のエンドポイントが受け取るのは、直近のユーザーテキスト、直近のアシスタントテキスト、および直近のツール結果の名前と出力の抜粋です。システムメッセージ、thinking ブロック、ツール呼び出しの引数は送信されません。

OpenAI モデルはまだルーティングされません。

## 環境変数

この拡張機能は、Pi が読み込まれるときではなく、最初にルーティングされるリクエストの時点で、プロキシの変数を読み取ります。仮想モデルは常に一覧に表示されます。分類器のキーがない場合、`TYPESAFE_API_KEY` のようなレガシー変数が使われている場合、その他の無効な値がある場合は、そのリクエストが `reasoning-router invalid_config: ...` で失敗します。Pi は動作を続け、次のリクエストでは、有効になるまで変数が再度読み取られます。

| 変数 | デフォルト | 用途 |
| --- | --- | --- |
| `REASONING_ROUTER_CLASSIFIER` | `jev` | 分類器プロバイダー: `jev`、`clef`、`laya`、`kev`、または `openai-decisions`。 |
| `REASONING_ROUTER_CLASSIFIER_API_KEY` | なし | 分類器の認証情報。`jev`、`clef`、`openai-decisions` では必須。`laya` と `kev` では省略可。 |
| `REASONING_ROUTER_CLASSIFIER_BASE_URL` | プロバイダーのデフォルト | Jev のエンドポイント、Laya サーバー（デフォルトは `http://127.0.0.1:8000`）、Kev サーバー（デフォルトは `http://127.0.0.1:8008`）、または OpenAI のリージョナルエンドポイント。`clef` では無視されます。 |
| `REASONING_ROUTER_CLASSIFIER_ACCOUNT_ID` | なし | Clef: Cloudflare アカウント ID。`clef` では必須。 |
| `REASONING_ROUTER_CLASSIFIER_MODEL` | なし | Clef: `clef` または `clef-flash`。`clef` では必須。Laya: 省略可のチェックポイント。Kev: 省略可、エコーバックのみ。OpenAI Decisions: `gpt-6-luna`。 |
| `REASONING_ROUTER_CLASSIFICATION_TIMEOUT_MS` | `4000` | リトライを含む、分類全体の時間予算。 |
| `REASONING_ROUTER_MAX_RETRIES` | `1` | リトライ可能なエラーの後の分類器のリトライ回数（0–10）。 |
| `REASONING_ROUTER_FALLBACK_MODE` | `fixed` | 失敗時の動作: `fixed`、`previous`（最後に分類されたエフォート、なければ fixed）、または `error`。 |
| `REASONING_ROUTER_FALLBACK_EFFORT` | `high` | `fixed` フォールバックで使用するエフォート。 |
| `REASONING_ROUTER_BASE_EFFORT` | モデルのデフォルト | 直接リクエストのエフォート。 |
| `REASONING_ROUTER_DECISIONS_LOG_PATH` | なし | 判断の JSONL ログを書き出す絶対パス。 |

分類器の認証情報については [`docs/environment.md`](../../docs/environment.md) を参照してください。判断ログに含まれるのはメタデータのみで、モデル、エフォート、分類器のレイテンシと試行回数、フォールバック、キャッシュ読み取りを含むトークン使用量、結果が記録されます。プロンプトテキストや認証情報は含まれません。

## ライセンス

[MIT](LICENSE)
