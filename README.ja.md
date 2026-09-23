# Workkeel

コーディングエージェントのための、リポジトリを基盤としたワークフローフレームワーク。

**会話が変わっても、タスク・モデル選択・検証結果をつなぐ。**

[English](README.md) · [繁體中文](README.zh-TW.md) · 日本語

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## なぜ Workkeel？

コーディングエージェントは変更を実装できます。しかし、複数の工程や会話をまたぐと、
決定事項の消失、作業の重複、曖昧な権限、高コストな既定モデルの使い続け、
未レビューの成果を完了扱いするといった問題が起こります。

Workkeel はタスクの合意をコードのそばに保存し、実行と証拠に結び付けます。

- **文脈を引き継ぐ：**承認範囲、担当、引き継ぎ、失敗履歴を保持。
- **実行を制御する：**依存関係、承認、上限付き再試行、中断からの復旧を定義。
- **モデルを明確に選ぶ：**既存の Codex サブスクリプションで適切な工程を Luna や Sol に振り分け。
  明示指定を保ち、黙って Astra に切り替えません。
- **実際の成果をレビューする：**検証と別エージェントのレビューを、正確な Git リビジョンに紐付けて受け入れ。

コーディングループとツールは既存ランタイムが担当します。Workkeel は周囲の作業を調整するもので、
アプリケーションフレームワークやモデルの代替ではありません。

## 依頼から受け入れまで

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="目的と範囲を承認し、工程とモデルを計画、実行して正確な候補をレビューし、受け入れる。レビュー不合格なら実装に戻る。">
</picture>

例：Luna でカート合計の不具合を調査し、方針の承認を待ってから Sol で実装・テスト。
証拠を残して候補を引き継ぎ、別エージェントがレビューします。
グラフの終了は承認、受け入れ、デプロイを意味しません。
[ワークフローガイド →](docs/operations/workkeel-workflows.md)

## ソースから始める

Git、Node.js 24+、既存のコーディングエージェントが必要です。
この開発ソースは、公開済み Workkeel npm リリースではありません。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
```

[クイックスタート](docs/getting-started/workkeel.md)に沿ってプロジェクトを初期化し、
タスクを承認・取得してレビューを記録します。
プレビュー可能な [AGENTS／CLAUDE ブリッジ](docs/extensions/workkeel-context.md)は既存の指示を保持します。
基本的なタスク調整には、現在のコーディングエージェントを利用できます。

グラフを自動実行する場合は `npm ci --include=optional --ignore-scripts` で任意依存を導入し、
[Codex サブスクリプション設定](docs/operations/workkeel-workflows.md#choose-how-to-run)を参照してください。
検証済みプロファイルは現在 macOS と固定 Codex バージョンが対象です。
追加 API キーや LiteLLM サーバーは不要です。モデル選択は Workkeel が起動する工程に適用され、
既存のデスクトップ会話やグローバル既定値は変更しません。

## アーキテクチャ

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="リポジトリのタスク契約を Workkeel と任意の LangGraph 実行器が利用。モデルを固定したランタイムがホスト権限内でツールを使い、結果を返す。チェックポイントと受け入れ記録は別管理。">
</picture>

リポジトリはタスクの権限とレビュー証拠を保持し、任意の実行器がグラフの進行とモデル方針を管理。
Codex はホストが実際に強制する権限内で作業します。SQLite チェックポイントと dispatch journal で
復旧を支え、副作用が不明な場合は確認のため停止し、無条件に再実行しません。

## 採用している概念

| 関連する概念 | Workkeel での適用 |
| --- | --- |
| Agent harness engineering | エージェントの周囲にタスク境界、ランタイム契約、証拠チェックを配置 |
| Context engineering | 必要な指示、Skills、限定した証拠と、任意の可逆なツール出力ビュー |
| State machines／graph orchestration | 条件付き状態遷移と LangGraph の順序、分岐、直接結合、チェックポイント |
| Feedback loops／human-in-the-loop | 上限付き継続、承認のための中断、レビューと修正のループ |
| Policy-based model routing | 承認済みルール、説明可能な選択、会話単位で固定するモデル設定 |

[用語集](docs/concepts/terminology.md)と[設計](docs/concepts/architecture.md)を参照してください。
Skills はプロジェクト固有の手順です。「読んだ」という記録だけでは適切な適用を証明できません。
[選択と成果の確認 →](docs/extensions/workkeel-context.md)

## 検証データと制限

実サブスクリプションの 2 工程テストで Luna、Sol を順に選択し、約 42 秒で期待どおりのファイルを生成。
ローカルサンドボックスの 7 検査も通過しました。小規模な機能確認であり、一般的な品質、速度、
利用枠の節約を示す比較結果ではありません。
[方法・結果・未検証事項 →](docs/validation/workkeel-automation.md)

Headroom は原文を保持しますが、このアダプターは Codex 標準ツール出力の自動圧縮に未対応です。
LiteLLM は任意のゲートウェイ経路で、実サービスの検証は未完了です。
ロックはローカル、身元は帰属記録です。分散調整や人間の認証済み承認は保証しません。

[ドキュメント](docs/README.md) · [テスト](docs/getting-started/testing.md) ·
[貢献](CONTRIBUTING.md) · [セキュリティ](SECURITY.md) ·
[互換性と移行](docs/getting-started/workkeel.md#legacy-history-and-migration)

[MIT](LICENSE)。依存関係と任意統合の出典・ライセンスは[第三者通知](THIRD_PARTY_NOTICES.md)に記載しています。
