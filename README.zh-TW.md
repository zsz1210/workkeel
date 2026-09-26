# Workkeel

把任務協作與驗證紀錄保存在 repository 裡的程式開發框架。

Workkeel 記錄已批准的範圍、執行過程、交接與審查證據。能遵循專案指示的開發工具，
可以搭配雲端或本機模型使用；框架不限定 OpenAI、Codex 或特定模型。

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## 可以做什麼

- **接續工作：** 更換工具或對話後，仍能找到目標、限制、決策與已完成的部分。
- **協調執行：** 記錄負責者、相依任務、交付、重試上限與恢復方式。
- **搭配不同工具與模型：** 原生工具沿用自己的模型設定；選用自動流程時，再提供明確批准的模型政策。
- **審查確切版本：** 將測試證據與另一個 Agent 的審查綁定到 Git 版本，再驗收任務。
- **查看既有紀錄：** 用本機觀察網站查看任務、文件、學習、Skill、執行時間與 Tokens，不必呼叫模型。

執行工具負責實際操作並強制執行權限限制；Workkeel 的紀錄本身不是沙箱。
程式執行完成，也不代表交付結果已經驗收。

## 從需求到驗收

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="批准範圍、執行工作、審查確切版本、驗收；審查未通過則返回實作。">
</picture>

例如修正一個錯誤：先批准目標和可修改的檔案，再由開發工具調查與實作，保存測試證據，
最後交給另一個 Agent 審查。多個步驟可以使用相同模型，也可以分別交給不同模型；
任務紀錄都保留在專案內。

[快速開始](docs/getting-started/workkeel.md) ·
[工作流程執行](docs/operations/workkeel-workflows.md)

## 從原始碼開始

需要 Git、Node.js 24+ 與既有的程式開發工具。目前尚未發布 Workkeel npm 套件。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
node bin/workkeel.mjs start /path/to/project
```

最後一個指令只預覽設定指引，以及尚未補齊的政策／任務草稿，不會啟動模型。
請依[快速開始](docs/getting-started/workkeel.md)初始化專案、批准任務、認領工作並記錄審查。

Task-first 專案使用 WORKKEEL.md 與 workkeel CLI。選配的
[AGENTS／CLAUDE 指示橋接](docs/extensions/workkeel-context.md)會保留原有指示。
這份 repository 也使用原生五階段流程。workkeel-init／workkeel-work 提供原生設定與交付指引；
TEMPLE.md 與 temple-work 保留作為歷史相容資料。

## 本機觀察網站

```sh
node bin/workkeel.mjs monitor /path/to/task-first-project
```

開啟終端輸出的完整本機存取網址，即可查看：

- 需要處理的事項與近期成果總覽、最近工作的看板、可分頁搜尋的任務文件。
- 執行時間／Tokens 長條圖、任務散點圖、每日／每週趨勢，以及共用篩選。
- 專案技能的來源與內容搜尋、學習紀錄與階段進度。
- 附說明浮窗的唯讀設定、任務側欄與完整詳細頁。
- 已記錄的執行時段、連線與來源狀態，以及圖文版運作說明。
- 繁體中文與英文，可在設定切換。

**觀察網站不呼叫模型。** 既有紀錄由本機程式讀取與彙整，圖表、篩選和更新不消耗模型 Tokens；
執行任務的工具則可能另外使用 Tokens。缺少或不完整的資料會明確標示，不估算費用。
背景程序監看檔案變更並更新本機索引；頁面確認連線與資料版本，有變更才取得新資料，隱藏時暫停。
按 Ctrl-C 結束前景服務；這個指令不安裝常駐程序或外部圖表服務。

[觀察網站使用方式與資料限制](docs/operations/workkeel-observer.md)

## 預設、選配與支援範圍

### 重用經驗

原生[學習紀錄](docs/extensions/workkeel-learning.md)會串起來源、驗證與後續任務的採用情況。
`workkeel learning search` 透過明確的多語搜尋字詞尋找現行指引；`learning impact`
可追查來源變更會影響哪些經驗、實務準則與 Skills。找到、閱讀、應用及驗證結果分開記錄，
觀測網站僅讀取呈現。符合提案條件不會自動建立 Skill，也不代表已證明省時或節省 Tokens。

| 能力 | 預設 | 目前範圍 |
| --- | --- | --- |
| 任務協作 | 核心功能 | 任務契約、認領、交付、審查與驗收，不需要伺服器 |
| 開發工具與模型 | 沿用既有工具 | 可遵循指示的工具，包含使用本機模型的工具；不修改全域模型設定 |
| 自動工作流程 | 選配 | 需要選配 LangGraph 套件與已批准的流程；自動執行必須有對應 adapter |
| 模型路由 | 選配 | 明確指定 → 符合的批准規則 → 批准的預設值；不呼叫分類模型 |
| 內建自動執行介面 | 選配／實驗性 | Codex app-server；其訂閱方案需要 macOS 與 Codex ≥ 0.155.0-alpha.9.2 |
| Gateway 連線 | 選配 | 透過支援的執行端連到已批准的固定 OpenAI-compatible／LiteLLM 來源；實測資格另計 |
| Headroom | 關閉 | 透過執行端整合提供可還原的輸出檢視；不會自動攔截所有工具輸出 |
| 觀察網站 | 選配 | 本機唯讀，不呼叫模型；顯示已記錄的 task-first 資料 |
| 學習與 Skill | 選配紀錄 | 經驗、實務準則與有範圍的撰寫提案；核准不會直接建立或啟用 Skill |

[執行介面指南](docs/operations/workkeel-workflows.md)說明自動流程需要的選配套件與已實作介面。
能透過某個工具協作，不表示框架已內建它的自動 adapter，也不表示能自動取得該工具的所有用量。
框架沒有統一指定的模型或供應商。

## 架構

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="專案任務契約提供協作與選配流程的依據；執行工具產生結果與證據，審查及驗收分開記錄。">
</picture>

專案檔案保存任務授權與證據；選配執行器管理流程進度與批准的模型選擇。
開發工具在實際受限制的環境內工作。Checkpoint 與派送紀錄用於恢復；
副作用尚未確認時，先核對結果再決定接續。觀察網站只讀取這些紀錄，不執行任務。

[架構說明](docs/concepts/architecture.md) ·
[執行量測](docs/operations/workkeel-measurements.md) ·
[有範圍的接續](docs/operations/workkeel-material-and-continuation.md) ·
[Skill 選擇與證據](docs/extensions/workkeel-context.md)

## 驗證與限制

目前是 Alpha。本機鎖不等於跨機協調；紀錄上的身分不等於供應商認證。
外部工具的原生對話若沒有提供執行紀錄，就沒有自動用量資料。
指定 Skill 不代表已正確應用；學習進度也不代表已完成自動升格。

各供應商實驗只驗證當時記錄的條件。過往的 Codex 相容性及 Luna／Sol 實驗都是案例，
不是框架預設，也不能推論其他模型、工具、訂閱節省量或未來版本的結果。
[實驗紀錄](docs/validation/workkeel-automation.md) ·
[個人路由實驗](docs/validation/workkeel-development-routing.md)

[文件](docs/README.md) · [測試](docs/getting-started/testing.md) ·
[參與開發](CONTRIBUTING.md) · [安全](SECURITY.md) ·
[相容與遷移](docs/getting-started/workkeel.md#legacy-history-and-migration)

[MIT](LICENSE) · [第三方聲明](THIRD_PARTY_NOTICES.md)
