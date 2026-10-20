# Workkeel

用儲存庫檔案協調 coding agents 任務的小型框架。

把核准範圍、交接與審查證據留在程式碼旁，綁定 Git commit。
你可以沿用現有的 coding tool，核心只需要儲存庫檔案和 CLI。

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)

0.2.0-beta.0 未發布原始碼 · Node.js 24.15+ · [MIT](LICENSE)

## 為什麼用 Workkeel

- **換工具也能接著做：**對話結束或切換 coding tool 後，任務範圍、決策與部分成果仍在。
- **審查確切變更：**由不同 Agent 檢查交付的 commit，再由 approver 驗收。
- **依風險決定審查要求：**先約定風險等級，政策與實際變更可提高等級；重做次數設有上限。
- **核心保持小巧：**協調任務不需要伺服器、模型呼叫或修改全域模型設定。

## 哪些情況不適合

Workkeel 不是 sandbox，也不是 agent runtime，不會替你部署。
你的 coding tool 負責限制權限、執行變更。使用 Workkeel 時，你會把任務授權和證據
綁到 commit，這是它與任務追蹤器的差別。寫程式的執行迴圈則沿用你現有的工具，
這點與 agent framework 不同。

## 一個任務怎麼走

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="約定範圍與風險，以現有 coding tool 實作，由不同 Agent 審查確切 commit，再驗收、完成。審查失敗仍停在 test，直到 approver 執行 task rework，才沿用同一份契約回到 intake；low 最多重做 2 次，其餘 3 次，達上限就停下來問人。">
</picture>

先約定範圍、權限、驗收條件和風險等級，再認領任務，用 coding tool 實作，
交付 commit 給另一個 Agent 審查。
審查失敗後，任務會停在 `test`，直到 approver 執行 `task rework`，
保存失敗紀錄，沿用同一份契約回到 `intake`。接著由 builder 重新認領，交付新的 commit。
`low` 最多重做兩次，其餘等級三次，達上限就停下來問人。
審查通過後，由有權限的 approver 結案；`high` 與 `critical` 須由不同模型家族審查，
完成規定的交叉審查，再由原核准人（Principal）結案。

## 30 秒示範

依下方步驟安裝原始碼 CLI，再到既有 Git 專案執行示範。輸出只列出部分 JSON 欄位。
`init` 會在同一位 `owner` 下註冊 `builder` 與 `reviewer`。模型家族預設分別為 `claude` 與 `codex`，可用 `--builder <family>` 與 `--reviewer <family>` 指定。
owner 核准任務與驗收，兩個 Agent 各自完成實作和審查。

```text
$ workkeel init .
{"initialized":true,"mode":"task-first"}
# 忽略 .workkeel/，並在認領前提交產生的設定檔。
$ workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --risk low --actor builder
{"id":"WK-0001","state":"intake"}
$ workkeel task claim --id WK-0001 --actor builder
{"id":"WK-0001","state":"build"}
# builder 修改指南、檢查內容並提交變更。
$ workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated"
{"id":"WK-0001","state":"test"}
# reviewer 依驗收條件檢查交付的確切 commit。
$ workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion"
{"id":"WK-0001","state":"release_gate"}
$ workkeel task close --id WK-0001 --actor builder --summary "Owner accepts" --rollback "Revert the guide commit"
{"id":"WK-0001","state":"done","external_release":"not-performed"}
```

這個 `low` 範例不需要證據檔；其他等級的要求見下表。
CLI 只記錄生命週期；修改和審查由你的 Agent 完成，不是 CLI。

## 快速開始

你需要 Git、Node.js 24.15+ 和 coding tool。安裝目前的原始碼：

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
alias workkeel="node $PWD/bin/workkeel.mjs"
```

切換到你自己的專案 Git 儲存庫，執行 `workkeel start .` 預覽設定步驟，不會寫入檔案。
初始化、政策、證據與回復方式見[快速入門指南](docs/getting-started/workkeel.md)。
開發 Workkeel 本身則請依[貢獻指南](CONTRIBUTING.md)操作。

## 風險等級

| 等級 | 常見用途 | 結案前要求 | 重做上限 |
| --- | --- | --- | --- |
| `low` | 文件、文字調整 | 不同 Agent 審查；證據檔可省略 | 2 |
| `standard` | 一般功能與修正 | 交付證據、不同 Agent 審查 | 3 |
| `high` | 認證、資料遷移、敏感資料 | 不同模型家族、審查者自己的報告及交叉審查；無未解問題；原核准人結案 | 3 |
| `critical` | 部署、CI、正式環境設定 | `high` 的全部要求，加上交付時的回復計畫與已提交的核准紀錄 | 3 |

達上限就停下來，請人決定重訂範圍、核准新任務或取消。
[QA 流程](docs/operations/workkeel-review-assessment.md#independent-qa-and-release-gate)
將問題分為 Must fix（阻擋）及 Consider／Note／Dismiss（留存紀錄），
並要求 `high`、`critical` 由 Codex／Claude 獨立交叉審查；
CLI 會檢查已註冊的模型家族，但這項檢查本身不能證明交叉審查已完成。

## 選用功能

- **[Workspace 觀測台](docs/operations/workkeel-workspace.md)：**以 `workkeel workspace serve` 啟動，瀏覽專案紀錄，閒置時不呼叫模型。另有獨立的[唯讀觀察器](docs/operations/workkeel-observer.md)，使用 `workkeel monitor`。
- **[工作流程／LangGraph](docs/operations/workkeel-workflows.md)：**選用 runner，依核准的流程圖、模型政策執行可復原步驟。
- **[Workkeel Loop L1 報告](docs/operations/loop-trial.md)：**`workkeel stats --report --cutoff 2026-10-19T00:00:00Z --timezone UTC` 產生每週唯讀報告，模型／API 花費為零。
- **[原生派工](docs/operations/workkeel-native-dispatch.md)：**記錄執行交接和指定模型，實際執行結果由 host 回報。
- **[Bot 層參考用法](docs/operations/reference-usage-bot-layer.md)：**示範如何用人工關卡協調專案 Bot、Claude Code 與 Codex，屬於核心以外的用法。

到[文件索引](docs/README.md)查看這些功能與其他選用功能。

## 限制

- 仍是實驗性 beta，尚未完整驗證所有中斷復原情境及全新機器安裝。
- Principal 與 Agent 是署名，不是經過身分驗證的帳號。Workkeel 無法證明兩個 Principal 就是兩個人，也無法證明實際用了哪個模型。
- 本機鎖無法協調多台機器；原生 host 用量資料只有在 host 有記錄時才存在。

## 文件與貢獻

[文件](docs/README.md) · [架構](docs/concepts/architecture.md) · [測試](docs/getting-started/testing.md) · [貢獻指南](CONTRIBUTING.md) · [安全性](SECURITY.md) · [MIT](LICENSE) · [第三方聲明](THIRD_PARTY_NOTICES.md)
