# Workkeel

コーディングエージェントのタスクと検証記録を、リポジトリで管理するフレームワークです。

承認済みの作業範囲、実行、引き継ぎ、レビューの証拠をコードと一緒に保存します。
プロジェクトの指示に従える開発ツールで、クラウドモデルにもローカルモデルにも利用できます。
OpenAI、Codex、特定のモデルを前提としません。

[English](README.md) · [繁體中文](README.zh-TW.md) · 日本語

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## できること

- **作業の再開：** ツールや会話が変わっても、目標、制約、判断、途中成果を確認できます。
- **実行の調整：** 担当、依存関係、引き渡し、再試行の上限、復旧方法を記録します。
- **ツールとモデルの選択：** ネイティブツールは既存のモデル設定を維持し、自動ワークフローでは明示的に承認されたポリシーを使います。
- **特定の版のレビュー：** 証拠と別の Agent によるレビューを Git の版に結び付け、受け入れを記録します。
- **記録の閲覧：** 任意のローカル観測サイトで、タスク、文書、学習、Skill、実行時間、トークンをモデル呼び出しなしで確認できます。

実際の操作と権限の強制は実行ツールが担当します。Workkeel の記録自体はサンドボックスではありません。
実行が終了しても、成果物が受け入れられたとは限りません。

## 依頼から受け入れまで

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="範囲を承認し、実行し、特定の版をレビューして受け入れる。不合格なら実装へ戻る。">
</picture>

不具合修正なら、目標と変更可能なファイルを承認してから、開発ツールで調査と実装を行います。
テストの証拠を保存し、別の Agent に候補版をレビューしてもらいます。
複数工程を同じモデルに任せることも、異なるモデルに分けることもできます。記録はプロジェクトに残ります。

[クイックスタート](docs/getting-started/workkeel.md) ·
[ワークフロー実行](docs/operations/workkeel-workflows.md)

## ソースから始める

Git、Node.js 24+、既存の開発ツールが必要です。Workkeel の npm パッケージはまだ公開されていません。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
node bin/workkeel.mjs start /path/to/project
```

最後のコマンドは、セットアップの案内と未完成のポリシー／タスク草案を表示するだけです。
モデルは起動しません。[クイックスタート](docs/getting-started/workkeel.md)に従い、初期化、
タスクの承認、担当の登録、レビューを進めてください。

Task-first プロジェクトでは WORKKEEL.md と workkeel CLI を使います。任意の
[AGENTS／CLAUDE ブリッジ](docs/extensions/workkeel-context.md)は既存の指示を保持します。
この repository もネイティブの5段階フローを使用します。workkeel-init／workkeel-work は
ネイティブの初期設定と引き渡し用です。TEMPLE.md と temple-work は旧版の互換資料として保持します。

## ローカル観測サイト

```sh
node bin/workkeel.mjs monitor /path/to/task-first-project
```

端末に表示される完全なローカルアクセス URL を開くと、次の情報を確認できます。

- Dashboard、Task board、Activity、Backlog の文書テーブル。
- 実行時間／トークンの棒グラフ、タスク散布図、日次／週次推移と共通フィルター。
- プロジェクト Skill の出所と全文検索、学習記録と段階表示。
- 読み取り専用の設定、タスク詳細、図解付きの仕組みの説明。
- 繁体字中国語と英語。Settings で切り替えられます。

**観測サイトはモデルを呼び出しません。** ローカルプログラムが既存の記録を読み取り、
集計します。グラフ、検索、更新によるモデルのトークン消費はありません。
タスクを実行するツールの消費とは別です。欠損値と部分的な値を明示し、料金は推定しません。
ページ表示中に更新し、非表示時は停止します。Ctrl-C で前景サービスを終了できます。
常駐プロセスや外部グラフサービスは導入しません。

[観測サイトの使い方とデータの制約](docs/operations/workkeel-observer.md)

## 既定値、オプション、対応範囲

### 経験の再利用

ネイティブな[学習記録](docs/extensions/workkeel-learning.md)は、出所、検証、後続タスクでの利用をつなぎます。
`workkeel learning search` は明示した多言語キーワードから現在有効な指針を探し、
`learning impact` は出所の変更が影響する Lesson、Practice、Skill を調べます。
発見、閲覧、適用、結果の検証は別々に記録し、観測サイトは読み取りのみを行います。
提案条件を満たしても Skill は自動作成されず、時間やトークンの節約が証明されたことにもなりません。

| 機能 | 既定 | 現在の範囲 |
| --- | --- | --- |
| タスク調整 | コア | 契約、担当、引き渡し、レビュー、受け入れ。サーバー不要 |
| 開発ツールとモデル | 既存ホスト | 指示に従えるホスト。ローカルモデルを使うホストも含む。全体のモデル設定は変更しない |
| 自動ワークフロー | 任意 | 任意の LangGraph 依存と承認済みグラフ。自動実行には実際の adapter が必要 |
| モデルルーティング | 任意 | 明示指定 → 承認ルール → 承認済み既定値。分類モデルは呼び出さない |
| 組み込み自動 adapter | 任意／実験段階 | Codex app-server。サブスクリプション構成には macOS と Codex ≥ 0.155.0-alpha.9.2 が必要 |
| Gateway 接続 | 任意 | 対応実行ホスト経由で、承認済みの固定 OpenAI-compatible／LiteLLM 接続を利用。実機検証は別途 |
| Headroom | 無効 | ホスト統合による可逆的な出力ビュー。すべてのツール出力を自動取得するものではない |
| 観測サイト | 任意 | ローカル、読み取り専用、モデル呼び出しなし。記録済み task-first データを表示 |
| 学習と Skill | 任意の記録 | Lesson、Practice、範囲を定めた作成提案。承認だけでは Skill を作成・有効化しない |

自動実行の依存関係と実装済み adapter は[実行ガイド](docs/operations/workkeel-workflows.md)に記載しています。
ネイティブな連携に使えるツールでも、組み込み自動 adapter や使用量の自動収集があるとは限りません。
フレームワーク共通のモデルやプロバイダーは指定していません。

## アーキテクチャ

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="プロジェクトのタスク契約をもとに調整と任意の実行を行う。ホストが証拠を返し、レビューと受け入れは別に記録する。">
</picture>

プロジェクトのファイルが権限と証拠を保持し、任意の実行器がグラフの進行と承認済みモデル選択を管理します。
開発ホストは強制された権限の範囲で作業します。チェックポイントとディスパッチ記録が復旧を支え、
副作用が不明な場合は再実行前に照合します。観測サイトは記録を読むだけで、作業を実行しません。

[アーキテクチャ](docs/concepts/architecture.md) ·
[実行計測](docs/operations/workkeel-measurements.md) ·
[範囲を限定した再開](docs/operations/workkeel-material-and-continuation.md) ·
[Skill の選択と証拠](docs/extensions/workkeel-context.md)

## 検証と制約

現在は Alpha です。ローカルロックは分散調整ではなく、記録上の身元はプロバイダー認証ではありません。
ネイティブセッションの使用量は、ホストが記録しなければ自動取得されません。
Skill の指定は適切な適用の証明ではなく、学習の段階表示も自動昇格を意味しません。

プロバイダー実験が確認するのは記録された条件だけです。過去の Codex 互換性や Luna／Sol の結果は例であり、
他のモデル、ツール、サブスクリプションの節約や将来の版についての証明ではありません。
[実験記録](docs/validation/workkeel-automation.md) ·
[個人用ルーティング実験](docs/validation/workkeel-development-routing.md)

[ドキュメント](docs/README.md) · [テスト](docs/getting-started/testing.md) ·
[貢献](CONTRIBUTING.md) · [セキュリティ](SECURITY.md) ·
[互換性と移行](docs/getting-started/workkeel.md#legacy-history-and-migration)

[MIT](LICENSE) · [第三者通知](THIRD_PARTY_NOTICES.md)
