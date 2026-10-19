# Workkeel

把任務協作紀錄放在 repository 裡、給程式開發 Agent 用的框架。

Workkeel 把已批准的任務範圍、交接與審查證據存在程式碼旁邊，並綁定到 Git commit。
能遵循專案指示的開發工具都能使用，雲端或本機模型皆可，不綁定特定廠商或模型。

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
0.2.0-beta.0 未發布的原始碼 · Node.js 24.15+ · [MIT](LICENSE)

## 可以做什麼

- **工作可以接續：** 換工具或換對話之後，目標、限制、決策和做到一半的成果都還在 repository 裡。
- **審查強度跟著風險走：** 每個任務分成 `low`、`standard`、`high`、`critical` 四級。
  專案政策訂出最低等級，交接時如果改到風險更高的檔案，等級會自動調高。
- **審查確切的變更：** 由另一個 Agent 審查交付的那個 commit，再由核准者驗收。
  核准和證據都綁在 Git 上，不靠聊天紀錄。
- **不增加負擔：** 核心只有一個 CLI 和 repository 裡的檔案，不需要伺服器、模型呼叫或全域設定。
- **查看既有紀錄：** 選用的本機網站可以看任務、文件、執行時間和 Token，不會呼叫模型。

實際執行工作、套用權限限制的是你原本使用的開發工具。Workkeel 的紀錄不是沙箱，
執行跑完也不代表任務已經驗收。

## 從需求到驗收

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="批准範圍、執行工作、審查確切版本、驗收；審查未通過則返回實作。">
</picture>

以修一個 bug 為例：先批准目標和允許修改的檔案，讓開發工具調查並實作，保留測試證據，
再請另一個 Agent 審查這個候選 commit。審查沒過的話，任務會在同一個已批准範圍內退回重做。

## 快速開始

需要 Git、Node.js 24.15+ 和一套開發工具。從 clone 下來的原始碼執行目前版本：

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel && npm ci --omit=optional --ignore-scripts
alias workkeel="node $PWD/bin/workkeel.mjs"
```

在你的專案裡，用一位負責人加上 `builder` 和 `reviewer` 兩個 Agent：

```sh
workkeel init . --solo
echo ".workkeel/" >> .gitignore && git add -A && git commit -m "Start Workkeel"
workkeel task new --goal "Clarify the guide" --acceptance "The guide names its audience" --write docs --actor builder
workkeel task claim --id WK-0001 --actor builder
# edit, commit, and save evidence under .ai-org/artifacts/WK-0001/
workkeel task handoff --id WK-0001 --actor builder --summary "Guide updated" --evidence .ai-org/artifacts/WK-0001/check.md
workkeel task review --id WK-0001 --actor reviewer --judgment pass --summary "Meets the criterion" --evidence .ai-org/artifacts/WK-0001/review.md
workkeel task close --id WK-0001 --actor builder --summary Accepted --rollback "Revert the guide commit" --evidence .ai-org/artifacts/WK-0001/review.md
```

`workkeel start .` 只預覽設定步驟，不會寫入任何檔案；`workkeel help advanced` 會列出 request 檔案形式和選用子系統。
團隊政策、request 檔案和回復方式請看[快速開始指南](docs/getting-started/workkeel.md)。

## 風險等級與團隊

| 等級 | 常見用途 | 驗收前需要 |
| --- | --- | --- |
| `low` | 文件、文字修改 | 由不同 Agent 審查；證據可省略 |
| `standard` | 一般功能與修正 | 交接證據，加上不同 Agent 審查 |
| `high` | 認證、資料遷移、敏感資料 | 審查者來自另一個模型系列，並附上自己的審查報告；不能留有未解決問題；由核准的 Principal 驗收 |
| `critical` | 部署、CI、正式環境設定 | `high` 的全部要求，再加上回復計畫和已 commit 的核准紀錄 |

專案登記超過一位 Principal 就算團隊。這時 high 以上的核准、審查和驗收，都必須由實作者以外的人負責。
要在團隊導入 Workkeel 之前，請先讀[團隊導入與風險分級](docs/operations/team-adoption-and-risk.md)。

## 已發布的 Beta.1

npm `next` 通道上的 `@zsz1210/workkeel@0.1.0-beta.1` 是較早的版本，
仍包含這份原始碼已經移除的 Temple 相容模式，也沒有上面的旗標指令和 high、critical 等級。
只有在評估那個舊版時才使用它，詳見它的[發布說明](CHANGELOG.md#010-beta1)。

## 選用元件

除了任務協作，其他元件都是選用的。簡短的 `workkeel help` 不列出這些子系統，
`workkeel help advanced` 才會列出。它們仍然可以使用，也都有測試；沒有人使用的部分，之後的版本可能會移除。

| 元件 | 預設 | 範圍 |
| --- | --- | --- |
| 任務協作 | 核心 | 任務契約、認領、交接、審查與驗收；不需要伺服器 |
| 開發工具與模型 | 沿用你現有的工具 | Workkeel 不更改任何全域模型設定 |
| 觀察站（`workkeel monitor`） | 關閉 | 本機、唯讀，完全不呼叫模型 |
| 工作流程執行 | 需要明確啟用 | 選用的 LangGraph 相依套件，以及已批准的流程圖和模型政策 |
| 原生派工與模型選擇 | 需要明確啟用 | 記錄要求的模型和理由；實際執行的模型由工具回報 |
| Headroom 工具輸出檢視 | 關閉 | 只在要求時提供有損壓縮的檢視；原始內容仍可讀取 |
| 學習紀錄與 Skill 版本 | 選用紀錄 | 核准不會自動建立或啟用 Skill |
| 工具用量紀錄與保存封存 | 選用紀錄 | 用量由工具回報；封存只在要求時執行 |
| 桌面工作區、整體目標、有限自主執行 | 實驗性 | 只能透過原始碼 CLI 使用；自動執行只限 `low` 和 `standard` 任務 |

[觀察站](docs/operations/workkeel-observer.md) ·
[工作流程](docs/operations/workkeel-workflows.md) ·
[原生派工](docs/operations/workkeel-native-dispatch.md) ·
[專案脈絡與 Skill](docs/extensions/workkeel-context.md)

## 架構

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="專案任務契約連到協調與選用的工作流程執行；執行工具使用工具並回傳證據；審查與驗收保持分開。">
</picture>

任務的權限和證據存在專案檔案裡。開發工具在自己的權限範圍內執行。選用的 runner 負責
工作流程進度和已批准的模型選擇；結果不確定時會停下來等待核對。觀察站只負責讀取。

[架構](docs/concepts/architecture.md) ·
[任務契約](docs/concepts/task-contract.md)

## 限制

- 目前是實驗性的 beta。各種中斷後的復原，以及在全新機器上安裝，都還沒有完整驗證。
- Principal 和 Agent 只是記錄下來的名稱，不是經過驗證的帳號。Workkeel 無法證明兩位
  Principal 真的是兩個人，也無法證明實際跑的是哪個模型。
- 本機鎖不是分散式協調。原生工具的工作階段，除非工具自己記錄，否則沒有用量資料。
- 用舊版 Temple 模式建立的專案請繼續使用原本的 CLI 版本，沒有遷移路徑。

## 開發 Workkeel

這個 repository 只放框架原始碼、公開文件、通用範本和可重現的測試。開發 Workkeel 時
實際產生的任務、核准、紀錄和審查證據，一律放在[獨立的私有工作區](docs/operations/framework-development.md)，
不放進這個 checkout，即使 Git 會忽略那些檔案也一樣。請見
[ADR-0083](docs/adr/0083-public-source-private-state.md)。

[文件](docs/README.md) · [測試](docs/getting-started/testing.md) ·
[貢獻指南](CONTRIBUTING.md) · [安全性](SECURITY.md) ·
[MIT](LICENSE) · [第三方授權聲明](THIRD_PARTY_NOTICES.md)
