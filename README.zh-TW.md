# Workkeel

以程式庫為基礎的 AI 開發代理任務協作框架。

換了對話、代理或模型，工作仍能接著走。

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)
Early Alpha · Node.js 24+ · [MIT](LICENSE)

## 協調工作，不必先組一間 AI 公司

現在的 coding agent 已經能規劃、實作與測試。換一段對話後容易遺失的，往往是工作周圍的約定：核准了什麼、誰正在做、允許碰哪些檔案與工具、交接了什麼，以及哪個確切版本通過驗收。

Workkeel 把這些約定留在程式碼旁邊。新的任務優先模式不需要 CEO、PM 或工程師職稱，也不用建立一大張通用技能表，才能告訴 AI「你會寫程式」。你繼續使用既有 coding agent；Workkeel 記錄範圍、身分、操作邊界、相依關係、證據與驗收。

它不是應用程式框架、模型、新的代理執行引擎，也不是自主發號施令的管理者。專案架構、工具與人類決策權仍由你掌握。「AI 公司」保留為舊模式的選項，不再是新核心的前提。

## 一項任務，從核准到可驗證交接

1. 確認目標、範圍、驗收條件與實際工作環境。
2. 由指定代理認領，在既有 coding runtime 裡工作。
3. 交付確切 Git 版本、驗證證據，先處理未解決事項。
4. 由不同的已登記代理審查；不通過就保留失敗紀錄並重做。
5. 明確接受已審查的版本。驗收不等於發布或部署。

核准契約不隨進度改寫；進度、認領、失敗嘗試與驗收結果分開記錄。版本檢查防止過期更新，雜湊檢查可發現證據被改動。「附件」目錄也不能用來藏未驗收的程式。實際工具與網路隔離仍由執行環境負責，設定格式正確不代表獲得權限。

## 從開發中原始碼開始

這次 Workkeel 改版是**尚未發布的原始碼**，不是先前已發布的 Temple Alpha.33 套件。Repository 或套件資訊改名，不代表已發布 npm 版本。需要 Git、Node.js 24 以上，以及一個已有 Git 的專案。

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --ignore-scripts
node bin/workkeel.mjs help
```

在 coding agent 開啟這份原始碼，然後提出：

> 閱讀任務優先模式指南與我的專案指令。協助確認 Agent／Principal 身分、核准規則、工作目錄、可碰的檔案與工具，以及資料處理條件。先讓我確認設定，再初始化不依賴公司職稱的 Workkeel；保留既有專案檔案。

[快速開始指南（英文）](docs/getting-started/workkeel.md)提供精簡政策、完整任務範例，以及認領、交付、驗收指令。每個專案有版本固定的 `workkeelw.mjs`；套件發布前，指南會說明如何使用經版本檢查的原始碼入口。不必全域安裝，也不必先架模型 Gateway。

## 四件事，各自處理

- **任務與授權：** 核准成果、Agent／Principal 身分、範圍、允許的操作與驗收身分分離。
- **環境與執行：** 工作目錄、讀寫範圍、工具、資源、網路與資料政策；由既有 coding agent 實際執行。
- **專案方法：** 需要時才加入特定知識或流程的 Skill，不要求填寫模型的通用能力清單。
- **模型連接：** 預設沿用原生設定；固定 Gateway 連接是選配，不與工具能力或任務驗收混在一起。

目前 LiteLLM／Codex 選配路徑提供的是**唯讀執行設定計畫**，不會啟動模型、修改全域設定或讀取金鑰。真實 Gateway 的工具互動尚未完成驗證，自動派工到新模式也尚未啟用。自動選模與新的 Graph 引擎不在這次範圍內。

## 舊 Temple 專案保留歷史

Workkeel 是 Temple 的新名稱。`temple` 相容指令、`templew.mjs`、`temple.lock`、`temple.*` 格式識別與歷史證據仍保留，不做全域取代。

既有專案在明確遷移之前，繼續使用原本的職位流程。只有已停止活動、採相容預設政策的一般 Solo 專案，才支援帶有雜湊確認的遷移。進行中、自訂政策、團隊、高風險與敏感資料工作繼續使用[舊模式指南（英文）](docs/getting-started/usage.md)。舊 Console、路由與高保證文件描述的是相容模式，不是新專案必填的設定。[遷移說明（英文）](docs/getting-started/workkeel.md#legacy-history-and-migration)。

## 成熟度與參與開發

目前是適合有人監督之本機工作的 Early Alpha。任務生命週期與拒絕情境有離線測試，但不代表正式環境成熟度、經認證的多人協作、分散式鎖定、真實 Gateway 支援，或所有專案都能節省時間與 token。同一位擁有者下的不同代理，也不是獨立人類驗證。

開發框架時依照[測試指南（英文）](docs/getting-started/testing.md)：修改期間做相關檢查，最終行為版本做完整驗證。初始化產品專案不需要每次重跑框架整套測試；既有測試指令與失敗紀錄都保留。

[文件導覽](docs/README.md) · [任務契約](docs/concepts/task-contract.md) · [設計決策](docs/adr/0072-task-first-lifecycle.md) · [更新紀錄](CHANGELOG.md) · [參與貢獻](CONTRIBUTING.md) · [治理](GOVERNANCE.md) · [行為準則](CODE_OF_CONDUCT.md) · [安全回報](SECURITY.md)

[MIT](LICENSE)。選配整合的來源與採用界線見[第三方聲明](THIRD_PARTY_NOTICES.md)。
