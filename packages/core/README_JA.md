# @reasoning-router/core

[English](README.md) | [简体中文](README_CN.md) | 日本語

reasoning-router のうち、ハーネスにも分類器にも依存しない共有部分です。リクエストの検証、モデルレジストリ、Responses と Anthropic Messages に対するキャッシュを保つエフォートの書き換え、キャッシュのリネージ、リトライとフォールバックを備えた分類器の選択、アップストリームへの転送ヘルパー、使用量の観測、判断のログ記録を提供します。

分類器は `Classifier` と `ClassifierProvider` インターフェースを通じて組み込みます。`createConfiguredSelector` は、`classifier` 設定ブロック（`provider`、`timeoutMs`、およびそのプロバイダー固有のフィールド）から分類器を 1 つ選びます。このパッケージは分類器の SDK に依存しません。

[`@reasoning-router/opencode`](../opencode/README_JA.md) と [`@reasoning-router/proxy`](../proxy/README_JA.md) が使用しています。[`docs/behavior.md`](../../docs/behavior.md) と [`docs/classification-policy.md`](../../docs/classification-policy.md) も参照してください。

## ライセンス

[MIT](LICENSE)
