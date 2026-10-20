# Workkeel

コーディングエージェントのためのタスク連携を、リポジトリの中で記録するフレームワークです。

Workkeel は承認済みのタスク範囲、引き継ぎ、レビューの証跡をコードの横に保存し、Git コミットに結び付けます。
プロジェクトの指示に従えるコーディングツールであれば、クラウドでもローカルモデルでも使えます。
特定のプロバイダーやモデルには依存しません。

[English](README.md) · [繁體中文](README.zh-TW.md) · 日本語

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
0.2.0-beta.0 未公開のソース · Node.js 24.15+ · [MIT](LICENSE)

## できること

- **作業を再開できる：** ツールや会話が変わっても、目標、制約、決定、途中の成果がリポジトリに残ります。
- **リスクに応じてレビューを強める：** 各タスクは `low`、`standard`、`high`、`critical` のいずれかです。
  最低ランクはプロジェクトのポリシーで決まり、引き継ぎ時により危険なファイルが変わっていれば引き上げられます。
- **正確な変更をレビューする：** 別の Agent が引き渡されたコミットそのものをレビューし、承認者が受け入れます。
  承認と証跡はチャットではなく Git に結び付きます。
- **邪魔にならない：** 中核は CLI とリポジトリ内のファイルだけです。サーバー、モデル呼び出し、グローバル設定は不要です。
- **既存の記録を見る：** 任意のローカル Web サイトで、タスク、文書、実行時間、トークンをモデルを呼ばずに確認できます。

作業を実行し、権限を強制するのは普段使っているコーディングツールです。Workkeel の記録はサンドボックスではなく、
実行が終わってもタスクが受け入れられたことにはなりません。

## 依頼から受け入れまで

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="範囲を承認し、実行し、正確な候補をレビューして受け入れる。レビューに通らなければ実装に戻る。">
</picture>

バグ修正なら、目標と変更してよいファイルを承認し、コーディングツールに調査と実装を任せ、テストの証跡を残してから、
別の Agent に候補コミットをレビューしてもらいます。レビューに通らなければ、同じ承認範囲のまま差し戻されます。

## クイックスタート

Git、Node.js 24.15+、コーディングツールが必要です。clone したソースから現在の版を実行します。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel && npm ci --omit=optional --ignore-scripts
alias workkeel="node $PWD/bin/workkeel.mjs"
```

プロジェクトでは、`init` が 1 人の責任者と `builder`（model family `claude`）、`reviewer`（model family `codex`）の 2 つの Agent を作成します。

```sh
workkeel init .
echo ".workkeel/" >> .gitignore && git add -A && git commit -m "Start Workkeel"
workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --actor builder
workkeel task claim --id WK-0001 --actor builder
# edit, commit, and save evidence under .ai-org/artifacts/WK-0001/
workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated" --evidence .ai-org/artifacts/WK-0001/check.md
workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion" --evidence .ai-org/artifacts/WK-0001/review.md
workkeel task close --id WK-0001 --actor builder --summary Accepted --rollback "Revert the guide commit" --evidence .ai-org/artifacts/WK-0001/review.md
```

`workkeel start .` は何も書き込まずに設定手順をプレビューし、`workkeel help advanced` はリクエストファイル形式と任意のサブシステムを表示します。
独自のポリシー（`init --policy`）、リクエストファイル、ロールバックは[クイックスタートガイド](docs/getting-started/workkeel.md)を参照してください。

## リスクランク

| ランク | 主な用途 | 受け入れ前に必要なもの |
| --- | --- | --- |
| `low` | 文書や文言の修正 | 別の Agent によるレビュー。証跡は省略可 |
| `standard` | 通常の機能追加と修正 | 引き継ぎの証跡と、別の Agent によるレビュー |
| `high` | 認証、データ移行、機密データ | 別のモデル系列のレビュアーと、その人自身のレビュー報告。未解決の問題は残せない。承認した Principal が受け入れる |
| `critical` | デプロイ、CI、本番設定 | `high` のすべてに加えて、ロールバック計画とコミット済みの承認記録 |

high 以上の作業は、1 人でも複数人でも同じです。別のモデル系列のレビュアーが確認し、そのあと承認した Principal が人として確定します。
導入する前に[導入とリスクランク](docs/operations/team-adoption-and-risk.md)を読んでください。

手戻りの上限は `low` が 2 回、`standard`、`high`、`critical` が 3 回です。上限に達したら停止し、人の判断を求めます。
任意のレビュースコア欄は[統計](docs/operations/team-adoption-and-risk.md#review-scores-optional)用に保持し、
差し戻しや受け入れの条件には使いません。
[QA 手順](docs/operations/workkeel-review-assessment.md#independent-qa-and-release-gate)では、
指摘を Must fix（修正必須）／Consider（検討）／Note（記録）／Dismiss（不採用）に分類し、
`high` と `critical` では Codex と Claude による独立したクロスレビューを必須とします。

## 公開済みの Beta.1

npm の `next` チャネルにある `@zsz1210/workkeel@0.1.0-beta.1` は以前の系統です。
このソースから削除した Temple 互換モードを含み、上記のフラグコマンドや high、critical ランクはありません。
その旧版を評価する場合にだけ使ってください。詳しくは[リリースノート](CHANGELOG.md#010-beta1)を参照してください。

## 任意のコンポーネント

タスク連携以外はすべて任意です。短い `workkeel help` はこれらのサブシステムを表示せず、
`workkeel help advanced` だけが表示します。引き続き使え、テストもありますが、使われていないものは今後のリリースで削除する場合があります。

| コンポーネント | 既定 | 範囲 |
| --- | --- | --- |
| タスク連携 | 中核 | 契約、着手、引き継ぎ、レビュー、受け入れ。サーバー不要 |
| コーディングツールとモデル | 既存のホスト | Workkeel はグローバルなモデル設定を変更しない |
| オブザーバー（`workkeel monitor`） | オフ | ローカルかつ読み取り専用。モデル呼び出しはゼロ |
| オブザーバトリー／ワークスペース UI（`workkeel workspace serve`） | 任意 | 中核の作業・受け入れフローには不要 |
| ワークフロー実行 | 明示的に有効化 | 任意の LangGraph 依存関係と、承認済みのグラフおよびモデルポリシー |
| ネイティブディスパッチとモデル選択 | 明示的に有効化 | 要求したモデルと理由を記録し、実際に動いたモデルはホストが報告 |
| Headroom のツール出力ビュー | オフ | 要求時だけ非可逆なビューを作る。元の出力は読める |
| 学習記録と Skill のバージョン | 任意の記録 | 承認しても Skill は作成も有効化もされない |
| ホストの使用量記録と保存アーカイブ | 任意の記録 | 使用量はホストが報告し、アーカイブは要求時だけ実行 |
| デスクトップワークスペース、目標全体、範囲付き自律実行 | 実験的 | ソース版 CLI のみ。自動実行は `low` と `standard` のタスクに限る |

[オブザーバー](docs/operations/workkeel-observer.md) ·
[ワークフロー](docs/operations/workkeel-workflows.md) ·
[ネイティブディスパッチ](docs/operations/workkeel-native-dispatch.md) ·
[ワークスペース UI](docs/operations/workkeel-workspace.md) ·
[プロジェクトの文脈と Skill](docs/extensions/workkeel-context.md)

任意の [Workkeel Loop](docs/operations/loop-trial.md) は、モデル／API 支出ゼロで L1 の週次読み取り専用レポート
（`workkeel stats --report`）を提供します。試行用の実行ガードは、待機時間を含めて 60 操作・2 時間を上限とし、
停止フラグはユーザーが解除するまで保持します。L2 の比較記録はデータのみで、作業の実行や承認は行いません。

プロジェクト Bot、Claude Code、Codex を 3 つの人による確認段階と組み合わせる任意の構成は、
[参考の使い方：Bot レイヤー](docs/operations/reference-usage-bot-layer.md)を参照してください。フレームワークの中核には含まれません。

## アーキテクチャ

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="プロジェクトのタスク契約が連携と任意のワークフロー実行につながる。実行ホストはツールを使い証跡を返す。レビューと受け入れは分かれている。">
</picture>

タスクの権限と証跡はプロジェクトのファイルにあります。コーディングホストは自身の権限内で実行します。
任意のランナーはワークフローの進行と承認済みのモデル選択を管理し、結果が不確かな場合は照合のために停止します。
オブザーバーは読み取るだけです。

[アーキテクチャ](docs/concepts/architecture.md) ·
[タスク契約](docs/concepts/task-contract.md)

## 制限

- 実験的なベータ版です。あらゆる中断からの復旧や、新しいマシンへのインストールはまだ十分に検証されていません。
- Principal と Agent は記録された名前であり、認証されたアカウントではありません。2 人の Principal が
  本当に 2 人の人間か、実際にどのモデルが動いたかを Workkeel は証明できません。
- ローカルロックは分散協調ではありません。ネイティブホストのセッションは、ホストが記録しない限り使用量データを持ちません。
- 以前の Temple モードで作成したプロジェクトは、その CLI バージョンを使い続けてください。移行手段はありません。

## Workkeel の開発

このリポジトリにあるのはフレームワークのソース、公開文書、汎用テンプレート、再現可能なテストだけです。
Workkeel の開発で生じる実際のタスク、承認、ログ、レビュー証跡は
[独立したプライベートワークスペース](docs/operations/framework-development.md)に置き、
Git が無視するファイルであってもこの checkout には置きません。
[ADR-0083](docs/adr/0083-public-source-private-state.md) を参照してください。

[ドキュメント](docs/README.md) · [テスト](docs/getting-started/testing.md) ·
[コントリビューション](CONTRIBUTING.md) · [セキュリティ](SECURITY.md) ·
[MIT](LICENSE) · [サードパーティ通知](THIRD_PARTY_NOTICES.md)
