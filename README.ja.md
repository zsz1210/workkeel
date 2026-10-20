# Workkeel

コーディングエージェントのタスクを、リポジトリ内のファイルで管理する小さなフレームワーク。

承認した範囲や引き継ぎ、レビューの証跡は、Git コミットに結び付けてコードのそばに残します。
普段のコーディングツールをそのまま使えます。コアに必要なのはリポジトリ内のファイルと CLI だけです。

[English](README.md) · [繁體中文](README.zh-TW.md) · 日本語

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)

0.2.0-beta.0 未公開ソース · Node.js 24.15+ · [MIT](LICENSE)

## Workkeel を使う理由

- **ツールを変えても再開できる：**会話が終わっても、別のコーディングツールに移っても、タスクの範囲、判断、途中の成果が残ります。
- **渡した変更そのものをレビューする：**別の Agent が提出コミットを確認し、その後に承認権限を持つ人が受け入れます。
- **リスクに応じてレビューする：**最初にリスク区分を合意し、ポリシーや変更内容に応じて引き上げます。やり直し回数にも上限があります。
- **コアを小さく保つ：**タスクの管理にサーバーやモデル呼び出し、グローバルなモデル設定の変更は要りません。

## 向かない用途

Workkeel はサンドボックスでもエージェントランタイムでもなく、デプロイも行いません。
普段のコーディングツールで権限を制御し、変更を実行します。Workkeel では、
タスクの権限と証跡をコミットに結び付けます。ここがタスクトラッカーとの違いです。
コーディングの実行ループは既存のツールに任せる点で、エージェントフレームワークとも異なります。

## タスクの流れ

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="範囲とリスクを合意し、普段のツールで実装、別の Agent が提出コミットをレビューし、受け入れて完了。レビュー不合格でも test に留まり、承認者が task rework を実行して初めて同じ契約のまま intake に戻る。やり直しは low が 2 回、その他は 3 回まで。上限では停止して人に判断を求める。">
</picture>

範囲、権限、受け入れ条件、リスク区分を合意してからタスクを引き受け、
普段のツールで実装し、コミットを別の Agent に渡してレビューを受けます。
レビューが不合格なら、承認者が `task rework` を実行するまでタスクは `test` に留まります。
実行すると、不合格の記録を残して同じ契約のまま `intake` に戻ります。
builder が再び引き受け、新しいコミットを提出します。
やり直しは `low` が 2 回、その他は 3 回までで、上限に達したら停止して人に判断を求めます。
合格後は権限を持つ承認者が同じ候補をクローズします。`high` と `critical` では、
別のモデルファミリーによるレビューと所定の相互レビューを経て、元の承認者（Principal）がクローズします。

## 30 秒デモ

下の手順でソース版 CLI を用意したら、既存の Git プロジェクトでデモを実行します。出力には JSON の一部のフィールドだけを載せています。
`init` は 1 人の `owner` の下に `builder` と `reviewer` を登録します。モデルファミリーの既定値はそれぞれ `claude` と `codex` です。`--builder <family>` と `--reviewer <family>` で変更できます。
owner がタスクと受け入れを承認し、2 つの Agent がそれぞれ実装とレビューを行います。

```text
$ workkeel init .
{"initialized":true,"mode":"task-first"}
# .workkeel/ を Git の対象から除外し、生成した設定ファイルをコミットしてから引き受ける。
$ workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --risk low --actor builder
{"id":"WK-0001","state":"intake"}
$ workkeel task claim --id WK-0001 --actor builder
{"id":"WK-0001","state":"build"}
# builder がガイドを編集、確認し、変更をコミットする。
$ workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated"
{"id":"WK-0001","state":"test"}
# reviewer が提出されたコミットを受け入れ条件と照らし合わせる。
$ workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion"
{"id":"WK-0001","state":"release_gate"}
$ workkeel task close --id WK-0001 --actor builder --summary "Owner accepts" --rollback "Revert the guide commit"
{"id":"WK-0001","state":"done","external_release":"not-performed"}
```

この `low` の例では証跡ファイルを省略できます。他の区分の要件は下の表を参照してください。
CLI はライフサイクルを記録するだけで、編集やレビューは CLI ではなく Agent が行います。

## クイックスタート

Git、Node.js 24.15+、コーディングツールが必要です。現在のソースを用意します。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
alias workkeel="node $PWD/bin/workkeel.mjs"
```

自分のプロジェクトの Git リポジトリに移り、`workkeel start .` で書き込みを伴わないセットアップ案内を確認します。
初期化、ポリシー、証跡、ロールバックは[クイックスタートガイド](docs/getting-started/workkeel.md)を参照してください。
Workkeel 自体の開発は[貢献ガイド](CONTRIBUTING.md)に従ってください。

## リスク区分

| 区分 | 主な用途 | クローズ前の要件 | やり直し上限 |
| --- | --- | --- | --- |
| `low` | ドキュメント、文言の変更 | 別の Agent によるレビュー。証跡ファイルは任意 | 2 |
| `standard` | 通常の機能と修正 | 引き継ぎの証跡、別の Agent によるレビュー | 3 |
| `high` | 認証、データ移行、機密データ | 別のモデルファミリー、レビュアー自身の報告書と相互レビュー。未解決事項なし。元の承認者がクローズ | 3 |
| `critical` | デプロイ、CI、本番環境の設定 | `high` の全要件に加え、引き継ぎ時のロールバック計画とコミット済みの承認記録 | 3 |

上限に達したら停止し、範囲の見直し、新しいタスクの承認、キャンセルのいずれかを人に判断してもらいます。
[QA 手順](docs/operations/workkeel-review-assessment.md#independent-qa-and-release-gate)では、
Must fix は進行を止める指摘、Consider／Note／Dismiss は記録する指摘として扱い、
`high` と `critical` には Codex／Claude による独立した相互レビューを求めます。
CLI は登録済みのモデルファミリーを検査しますが、それだけでは相互レビューの実施を証明できません。

## 任意の追加機能

- **[Workspace 観測画面](docs/operations/workkeel-workspace.md)：**`workkeel workspace serve` で起動し、プロジェクトの記録を閲覧します。待機中のモデル呼び出しはありません。別の[読み取り専用オブザーバー](docs/operations/workkeel-observer.md)は `workkeel monitor` で起動します。
- **[ワークフロー／LangGraph](docs/operations/workkeel-workflows.md)：**承認済みのグラフとモデルポリシーに従い、再開可能なステップを実行するランナーを選べます。
- **[Workkeel Loop L1 レポート](docs/operations/loop-trial.md)：**`workkeel stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC` が読み取り専用の週次レポートを生成します。モデル／API の費用はかかりません。
- **[ネイティブディスパッチ](docs/operations/workkeel-native-dispatch.md)：**実行の引き継ぎと指定モデルを記録し、何が実行されたかをホストが報告します。
- **[Bot レイヤーの参考運用](docs/operations/reference-usage-bot-layer.md)：**プロジェクト Bot、Claude Code、Codex を人の承認で連携させる一例です。コアには含まれません。

これらの機能やその他の任意機能は、[ドキュメント一覧](docs/README.md)で確認できます。

## 制限

- 実験的なベータ版です。あらゆる中断からの復旧や、新しいマシンへのインストールは十分に検証できていません。
- Principal と Agent は記録上の名前であり、認証済みアカウントではありません。Workkeel は 2 つの Principal が別人であることや、実際に使ったモデルを証明できません。
- ローカルロックは複数マシン間の調整には使えません。ネイティブホストの使用量データは、ホストが記録した場合にだけ残ります。

## ドキュメントと貢献

[ドキュメント](docs/README.md) · [アーキテクチャ](docs/concepts/architecture.md) · [テスト](docs/getting-started/testing.md) · [貢献ガイド](CONTRIBUTING.md) · [セキュリティ](SECURITY.md) · [MIT](LICENSE) · [サードパーティの表記](THIRD_PARTY_NOTICES.md)
