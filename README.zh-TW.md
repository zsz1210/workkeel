# Workkeel

Workkeel 把程式開發任務核准的範圍、負責人、交接、審查與驗收，
保存在儲存庫的本機紀錄。執行主機提供模型、工具與存取控制；
Workkeel 本身不是沙箱。

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

實驗性 Beta.1 · Node.js 24 以上 · [MIT](LICENSE)

## 開始使用

在使用程式開發工具的專案安裝已發布的預發版本：

```sh
npm install --save-dev --save-exact --ignore-scripts @zsz1210/workkeel@0.1.0-beta.1
npx --no-install workkeel --version
npx --no-install workkeel start .
```

`start` 只預覽設定與任務受理指引，不會初始化專案、執行模型或核准工作。
依照[原生快速入門](docs/getting-started/workkeel.md)審查本機政策、
初始化任務狀態，並根據核准的簡報建立任務。

若要查看原始碼，先執行 `npm ci --omit=optional --ignore-scripts`，
再執行 `node bin/workkeel.mjs help`。原始碼可能與已發布的 Beta.1
套件不同。[測試指南](docs/getting-started/testing.md)說明貢獻者的檢查；
單一工作目錄通過測試，不等於版本已通過發布認證。

## 任務流程

1. 由人核准目標、路徑、環境、資料處理方式與驗收條件。
2. Agent 領取任務，記錄對應 Git 候選版本的工作與證據。
3. 由另一位已註冊的 Agent 審查該候選版本。
4. 有權限的 Principal 驗收，或要求修改。

這套流程可搭配不同開發主機與模型供應商。可選的
[工作流程執行](docs/operations/workkeel-workflows.md)和
[原生派遣](docs/operations/workkeel-native-dispatch.md)提供經核准的路由與復原，
不是基本任務流程的必要條件。可選的[本機觀察介面](docs/operations/workkeel-observer.md)
讀取現有紀錄，不會呼叫模型。主機回報的用量可能不完整。

## 原始碼與私人狀態的界線

全新複製的原始碼儲存庫不含維護者的任務歷史。開發框架時，
應在本機初始化任務狀態。實際任務、核准、執行紀錄、審查證據、
`.ai-org/` 和 `workkeel.lock` 不應進入公開 Git 歷史；
需要保留的私人狀態應另行備份。詳見[分離決策](docs/adr/0083-public-source-private-state.md)
與[貢獻指南](CONTRIBUTING.md)。

新專案預設使用原生 Workkeel。既有 Temple 專案可保留原本鎖定的舊流程；
變更前請閱讀[相容與遷移指南](docs/getting-started/migration-from-temple.md)。
相容程式碼和測試會保留，但 Position 流程的指示不適用於此原始碼儲存庫。

Workkeel 仍在實驗階段。本機鎖不是分散式協調，紀錄中的身分不等於驗證；
執行完成也不代表驗收或發布。請參閱[架構](docs/concepts/architecture.md)、
[文件索引](docs/README.md)、[安全政策](SECURITY.md)和
[第三方聲明](THIRD_PARTY_NOTICES.md)。
