# Workkeel

Workkeel は、コーディング作業の承認済みスコープ、担当、引き継ぎ、レビュー、
受け入れをリポジトリ内のローカル記録に残します。モデル、ツール、
アクセス制御は実行ホストが提供します。Workkeel 自体はサンドボックスではありません。

[English](README.md) · [繁體中文](README.zh-TW.md) · 日本語

実験的な Beta.1 · Node.js 24 以降 · [MIT](LICENSE)

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

ソースの確認には `npm ci --omit=optional --ignore-scripts` の後に
`node bin/workkeel.mjs help` を実行します。ソースは公開済み Beta.1
パッケージと異なる場合があります。[テストガイド](docs/getting-started/testing.md)
は貢献者向けのチェックを説明します。一つのチェックアウトでのテスト成功は
リリースの認定を意味しません。

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

このソースリポジトリを新規クローンしても、保守担当者のタスク履歴は含まれません。
フレームワーク開発時はタスク状態をローカルで初期化してください。実際のタスク、
承認、実行ログ、レビュー証拠、`.ai-org/`、`workkeel.lock` を
公開 Git 履歴に含めず、必要な私的状態は別途バックアップします。
[分離の決定](docs/adr/0083-public-source-private-state.md)と
[貢献ガイド](CONTRIBUTING.md)に詳細があります。

新規プロジェクトではネイティブ Workkeel が既定です。既存の Temple
プロジェクトは固定済みの旧ライフサイクルを維持できます。変更前に
[互換性と移行のガイド](docs/getting-started/migration-from-temple.md)を読んでください。
互換コードとテストは残りますが、Position ベースの指示はこのソースに適用されません。

Workkeel は実験段階です。ローカルロックは分散協調ではなく、記録上の ID は
認証ではありません。実行完了は受け入れや公開を意味しません。
[アーキテクチャ](docs/concepts/architecture.md)、
[ドキュメント](docs/README.md)、[セキュリティ方針](SECURITY.md)、
[第三者の通知](THIRD_PARTY_NOTICES.md)を参照してください。
