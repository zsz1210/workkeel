# Workkeel

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)

Workkeel は、コーディング作業の承認済みスコープ、担当、引き継ぎ、レビュー、
受け入れをリポジトリ内のローカル記録に残します。モデル、ツール、
アクセス制御は実行ホストが提供します。Workkeel 自体はサンドボックスではありません。

[English](README.md) · [繁體中文](README.zh-TW.md) · 日本語

実験的な Beta.1 · Node.js 24 以降 · [MIT](LICENSE)

[クイックスタート](docs/getting-started/workkeel.md) · [ドキュメント](docs/README.md) ·
[貢献](CONTRIBUTING.md) · [セキュリティ](SECURITY.md)

## はじめに

コーディングツールを使うプロジェクトで公開済みのプレリリースをインストールします。

```sh
npm install --save-dev --save-exact --ignore-scripts @zsz1210/workkeel@0.1.0-beta.1
npx --no-install workkeel --version
npx --no-install workkeel start .
```

`start` は設定とタスク受付の案内をプレビューします。初期化、モデル実行、
作業承認は行いません。[ネイティブのクイックスタート](docs/getting-started/workkeel.md)
に従い、ローカルの方針を確認してタスク状態を初期化し、承認済みの依頼からタスクを作成します。

タスク状態を作らずにフレームワークのソースを確認できます。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
```

ソースは公開済み Beta.1 パッケージと異なる場合があります。CI バッジは
限定されたリポジトリ検査の結果です。候補とリリースの完全な検証は
[テストガイド](docs/getting-started/testing.md)を参照してください。変更する際は、
先に[独立した非公開の開発環境](docs/operations/framework-development.md)を用意します。

## タスクの流れ

1. 人が目標、対象パス、環境、データの扱い、受け入れ条件を承認します。
2. エージェントがタスクを引き受け、Git 候補に対する作業と証拠を記録します。
3. 別の登録済みエージェントがその候補をレビューします。
4. 権限を持つ Principal が受け入れるか、修正に戻します。

この流れはコーディングホストやモデル提供者を選びません。任意の
[ワークフロー実行](docs/operations/workkeel-workflows.md)と
[ネイティブディスパッチ](docs/operations/workkeel-native-dispatch.md)は、
承認済みのルーティングと回復を追加します。タスクの基本ライフサイクルには不要です。
任意の[ローカルオブザーバー](docs/operations/workkeel-observer.md)は、
モデルを呼ばずに記録済み状態を読みます。ホストが報告する使用量は不完全な場合があります。

## ソースと私的状態の境界

このリポジトリには**フレームワークだけ**を置きます。ソース、公開ドキュメント、
汎用テンプレート、架空の例、再現可能なテストが対象です。実際の開発タスク、計画、
承認、会話、計測、実行ログ、レビュー証拠は、**公開チェックアウトの外にある
独立した非公開の作業環境**で管理します。Git の無視対象でも、ここに保守担当者の
タスク状態を初期化しないでください。

公開 Issue と PR は架空の再現例で製品の問題とソース変更を説明する場です。
非公開タスク台帳の同期先ではありません。私的記録を公開コミット、ブランチ、タグ、
添付ファイル、リリースに含めないでください。
[開発ガイド](docs/operations/framework-development.md)、
[公開範囲](docs/operations/publication-boundary.md)、
[分離の決定](docs/adr/0083-public-source-private-state.md)に詳細があります。

新規プロジェクトではネイティブ Workkeel が既定です。既存の Temple
プロジェクトは固定済みの旧ライフサイクルを維持できます。変更前に
[互換性と移行のガイド](docs/getting-started/migration-from-temple.md)を読んでください。
互換コードとテストは残りますが、Position ベースの指示はこのソースに適用されません。

Workkeel は実験段階です。ローカルロックは分散協調ではなく、記録上の ID は
認証ではありません。実行完了は受け入れや公開を意味しません。
[アーキテクチャ](docs/concepts/architecture.md)、
[ドキュメント](docs/README.md)、[セキュリティ方針](SECURITY.md)、
[第三者の通知](THIRD_PARTY_NOTICES.md)を参照してください。
