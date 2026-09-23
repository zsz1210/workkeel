# Workkeel

以程式碼儲存庫為核心的 Coding Agent 工作流程框架。

**讓任務、模型選擇與驗證結果持續銜接，不因切換對話而中斷。**

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## 為什麼需要 Workkeel？

Coding Agent 能寫程式，但跨步驟、跨對話交付工作時，仍容易遺失決策、重複執行、
搞不清楚權限、一直使用昂貴的預設模型，或把未經審查的結果當成完成。

Workkeel 把任務約定留在程式碼旁，連接執行過程與實際證據，讓你可以：

- **帶著脈絡接手：**保留核准範圍、負責者、交接內容與失敗紀錄。
- **控制執行：**定義依賴、審批、有限重試及中斷恢復。
- **明確選擇模型：**透過現有 Codex 訂閱，把適合的步驟交給 Luna 或 Sol；
  保留明確指定方式，不會偷偷改用 Astra。
- **審查實際交付：**將檢查結果與另一個 Agent 的審查綁定確切 Git 版本，再接受成果。

Coding runtime 仍負責寫程式的迴圈與工具。Workkeel 協調周邊工作，不是應用程式框架，
也不取代模型。

## 從需求到驗收

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-workflow-mobile.svg">
  <img src="docs/assets/workkeel-workflow.svg" alt="核准目標與邊界，規劃步驟及模型，執行後審查確切版本，再接受成果；審查不通過則回到實作。">
</picture>

想看狀態怎麼移動？將 [`workkeel-flow.html`](docs/assets/workkeel-flow.html) 下載，或從 clone
的資料夾用瀏覽器開啟，選「繁體中文」即可播放、暫停與逐步觀看核准、返工、中斷。
完全離線，不是即時監控；GitHub 的檔案頁只顯示原始碼。

例如：先用 Luna 檢查購物車計算錯誤，暫停等待方案核准，再用 Sol 實作與測試。
保留證據，交接候選版本，交由不同 Agent 審查。Graph 跑完不等於核准、驗收或部署。
[完整流程指南 →](docs/operations/workkeel-workflows.md)

## 從原始碼開始

需要 Git、Node.js 24+ 與既有 Coding Agent。目前是開發中的原始碼，尚非已發布的
Workkeel npm 版本。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
```

依照[快速開始](docs/getting-started/workkeel.md)初始化專案、核准任務、認領工作及記錄審查。
可預覽的 [AGENTS／CLAUDE 指令橋接](docs/extensions/workkeel-context.md)會保留既有指令；
基本任務協調可搭配目前使用的 Coding Agent。

要自動執行 Graph，使用 `npm ci --include=optional --ignore-scripts` 安裝選配依賴，
再依照 [Codex 訂閱設定](docs/operations/workkeel-workflows.md#choose-how-to-run)操作。
目前的實驗性設定限定 macOS 與指定 Codex 版本，不需要額外 API key 或 LiteLLM 伺服器。
選模適用於 Workkeel 啟動的步驟，不會更動既有桌面對話或全域預設模型。

## 預設、選配與支援範圍

| 功能 | 預設 | 支援與限制 |
| --- | --- | --- |
| 任務協調 | 核心／啟用 | 儲存庫中的任務契約、認領、交接與確切版本審查；不需要伺服器 |
| Coding Agent | 使用既有 Agent | Codex、Claude Code 或其他能遵循指令的 Agent；原生使用不會替它選模型 |
| Graph 引擎 | 關閉／選配 | 安裝 LangGraph 依賴並核准流程；支援順序、分支、直接匯合與檢查點 |
| 自動選模 | 關閉／選配 | Workkeel 政策：步驟明確指定 → 符合的規則 → 核准的預設；不另呼叫模型分類 |
| Codex 月費 | 選配／實驗性 | 既有 ChatGPT 登入、macOS 與指定 Codex 版本；最後一次真實驗證失敗 |
| LiteLLM gateway | 關閉／選配 | 固定且核准的連線；不內附伺服器；真實服務驗證待完成 |
| LiteLLM Auto Router | 尚未整合 | 與 Workkeel 規則選模不同；啟用 gateway 不代表啟用 Auto |
| Headroom | 關閉 | 主機自有整合可用無損檢視；不支援攔截 Codex 原生工具輸出 |
| Console／observer | 選配 | 已有本機觀測介面；尚未完成新 Workkeel 任務／Graph 儀表板整合 |
| 任務量測 | Workflow 執行時記錄 | 唯讀查詢模型、token 與耗時；原生代理工作階段尚未收集。[指南](docs/operations/workkeel-measurements.md) |

沒有通用的 Luna／Sol／Astra 預設：原生 Agent 保留自己的設定，自動流程則必須提供核准的政策。
不會安裝 macOS app，也不要求常駐背景程式。詳見[執行設定與限制](docs/operations/workkeel-workflows.md)。

## 架構

<picture>
  <source media="(max-width: 640px)" srcset="docs/assets/workkeel-architecture-mobile.svg">
  <img src="docs/assets/workkeel-architecture.svg" alt="儲存庫中的任務契約供 Workkeel 協調與選配 LangGraph 執行使用；固定模型的 Coding runtime 在主機權限下操作工具，回傳結果；本機檢查點與驗收紀錄分開保存。">
</picture>

儲存庫保存任務授權與審查證據；選配執行器處理 Graph 進度及模型政策；Codex 在主機實際
執行的權限限制下操作工具。SQLite 檢查點與 dispatch journal 支援中斷恢復；遇到無法確認
的外部效果時先停下來釐清，不盲目重跑。

## 採用的概念

| 相關概念 | 在 Workkeel 的應用 |
| --- | --- |
| Agent harness engineering | 在 Coding Agent 周圍建立明確任務邊界、runtime 契約與證據檢查 |
| Context engineering | 任務相關指令、Skills 與精簡證據；選配無損工具輸出檢視 |
| State machines／graph orchestration | 有條件的任務狀態轉移，以及 LangGraph 順序、分支、直接匯合與檢查點 |
| Feedback loops／human-in-the-loop | 有限續跑、審批中斷，以及審查與返工迴圈 |
| Policy-based model routing | 核准模型規則、可解釋的選擇，以及同一對話固定的設定 |

詳見[術語](docs/concepts/terminology.md)與[架構](docs/concepts/architecture.md)。
Skills 提供專案方法；記錄「已讀」不代表真正運用得好。
[選用與成果檢查 →](docs/extensions/workkeel-context.md)

## 驗證資料與限制

最新離線驗證通過 1,392 個案例；先前的自動化基準版本另有九項不呼叫模型的沙箱檢查通過。
最後一次訂閱實測中，Luna 把仍有效的授權誤判為過期，流程在呼叫 Sol 前停止。
自動執行仍屬實驗性功能，尚不能宣稱可靠可用或能節省月費額度。
[測試方法、結果與待驗證項目 →](docs/validation/workkeel-automation.md)

Headroom 保留完整原始資料，但目前的 adapter 不支援自動壓縮 Codex 原生工具輸出。
LiteLLM 是選配 gateway，真實服務驗證仍待進行。鎖定範圍限於本機，身分採明確歸屬紀錄；
此 Alpha 不承諾分散式協調或經驗證的人類身分授權。

[文件](docs/README.md) · [測試](docs/getting-started/testing.md) ·
[參與貢獻](CONTRIBUTING.md) · [安全](SECURITY.md) ·
[相容與遷移](docs/getting-started/workkeel.md#legacy-history-and-migration)

採用 [MIT](LICENSE)。依賴與選配整合的來源及授權見[第三方聲明](THIRD_PARTY_NOTICES.md)。
