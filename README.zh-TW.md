# Workkeel

[![CI](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml/badge.svg)](https://github.com/zsz1210/workkeel/actions/workflows/ci.yml)

Workkeel 把程式開發任務核准的範圍、負責人、交接、審查與驗收，
保存在儲存庫的本機紀錄。執行主機提供模型、工具與存取控制；
Workkeel 本身不是沙箱。

[English](README.md) · 繁體中文 · [日本語](README.ja.md)

實驗性 Beta.1 · Node.js 24 以上 · [MIT](LICENSE)

[快速入門](docs/getting-started/workkeel.md) · [文件](docs/README.md) ·
[參與貢獻](CONTRIBUTING.md) · [安全政策](SECURITY.md)

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

若只要查看框架原始碼，不需要建立任務狀態：

```sh
git clone https://github.com/zsz1210/workkeel.git
cd workkeel
npm ci --omit=optional --ignore-scripts
node bin/workkeel.mjs help
```

原始碼可能與已發布的 Beta.1 套件不同。CI 徽章只代表範圍有限的儲存庫檢查；
完整候選版本與發布檢查請見[測試指南](docs/getting-started/testing.md)。
要修改框架，請先建立[獨立私人開發工作區](docs/operations/framework-development.md)。

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

這個儲存庫**只放框架內容**：原始碼、公開文件、通用範本、合成範例與可重現測試。
實際開發任務、計畫、核准、對話、量測資料、執行紀錄及驗收證據，
一律放在**公開 checkout 以外的獨立私人工作區**。
即使路徑已被 Git 忽略，也不要在這裡初始化維護者的任務狀態。

公開 Issue 與 PR 用合成案例說明產品問題和原始碼變更，不用來同步私人任務帳本。
私人紀錄不得進入公開 commit、分支、tag、附件或 Release。
詳見[開發指南](docs/operations/framework-development.md)、
[發布邊界](docs/operations/publication-boundary.md)與
[分離決策](docs/adr/0083-public-source-private-state.md)。

新專案預設使用原生 Workkeel。既有 Temple 專案可保留原本鎖定的舊流程；
變更前請閱讀[相容與遷移指南](docs/getting-started/migration-from-temple.md)。
相容程式碼和測試會保留，但 Position 流程的指示不適用於此原始碼儲存庫。

Workkeel 仍在實驗階段。本機鎖不是分散式協調，紀錄中的身分不等於驗證；
執行完成也不代表驗收或發布。請參閱[架構](docs/concepts/architecture.md)、
[文件索引](docs/README.md)、[安全政策](SECURITY.md)和
[第三方聲明](THIRD_PARTY_NOTICES.md)。
