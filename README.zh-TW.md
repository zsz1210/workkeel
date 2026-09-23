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
目前完成驗證的設定限定 macOS 與指定 Codex 版本，不需要額外 API key 或 LiteLLM 伺服器。
選模適用於 Workkeel 啟動的步驟，不會更動既有桌面對話或全域預設模型。

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

一次真實訂閱測試依序選用 Luna、Sol，約 42 秒產生符合預期的檔案；七項本機沙箱檢查通過。
這是小型功能樣本，不代表普遍的品質、速度或月費額度節省。
[測試方法、結果與待驗證項目 →](docs/validation/workkeel-automation.md)

Headroom 保留完整原始資料，但目前的 adapter 不支援自動壓縮 Codex 原生工具輸出。
LiteLLM 是選配 gateway，真實服務驗證仍待進行。鎖定範圍限於本機，身分採明確歸屬紀錄；
此 Alpha 不承諾分散式協調或經驗證的人類身分授權。

[文件](docs/README.md) · [測試](docs/getting-started/testing.md) ·
[參與貢獻](CONTRIBUTING.md) · [安全](SECURITY.md) ·
[相容與遷移](docs/getting-started/workkeel.md#legacy-history-and-migration)

採用 [MIT](LICENSE)。依賴與選配整合的來源及授權見[第三方聲明](THIRD_PARTY_NOTICES.md)。
