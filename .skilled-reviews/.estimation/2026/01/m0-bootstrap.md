# Estimation: M0 bootstrap (server + web skeleton)

### 0. 前提確認
- 参照した一次情報:
  - `AGENTS.md:17`
  - `server/AGENTS.md:5`
  - `.specs/99_implementation_roadmap.md:22`（M0 成果物/Evidence）
  - `.specs/07_http_api_and_realtime_contract.md:21`（`/api/v1` / Error / SSE 契約）
  - `.specs/10_tech_stack_plan.md:22`（React/Vite/CSS Modules、Vitest、coverage 100%、knip、ESLint）
  - `package.json:5`（workspaces / scripts 現状）
  - `server/src/http-server.ts:13`（現状: `/health` + 404 のみ）
  - `README.md:23`（現状: server 起動手順のみ）
- 不足/矛盾:
  - `.specs/99` は M0 に `web` を含めるが、現状 repo は `server` workspace のみ（`package.json:5`）。→ M0 で `web` 追加が必要。
  - `.specs/07` は API エラー形を `{ error: { code, message } }` に統一としているが、現状 server 404 は `{ error: "not_found" }`（`server/src/http-server.ts:5`）。→ M0 で修正が必要。

### 1. 依頼内容の解釈（引用）
- ユーザー: 「M0から順番ずつブランチを切って作業」「web workspace は含める」「impl-np 実装を開始」
- 解釈: `feat/m0-bootstrap` で、`.specs/99` の M0 を満たす最小実装（server の `/api/v1` 枠 + SSE 接続枠 + web の `/kiosk` `/staff` 表示枠）を追加し、repo 標準チェックが通る状態にする。

### 2. 変更対象（ファイル:行）
- 変更:
  - `package.json:5`
  - `README.md:1`
  - `server/src/http-server.ts:13`
  - `server/src/http-server.test.ts:1`
- 新規（予定）:
  - `web/package.json:1 (新規)`
  - `web/tsconfig.json:1 (新規)`
  - `web/vite.config.ts:1 (新規)`
  - `web/vitest.config.ts:1 (新規)`
  - `web/eslint.config.js:1 (新規)`
  - `web/index.html:1 (新規)`
  - `web/src/main.tsx:1 (新規)`
  - `web/src/app.tsx:1 (新規)`
  - `web/src/app.test.tsx:1 (新規)`
  - `web/src/styles.module.css:1 (新規)`
  - `web/src/vite-env.d.ts:1 (新規)`
  - `web/src/sse-client.ts:1 (新規)`
  - `web/src/sse-client.test.ts:1 (新規)`

### 3. 作業項目と工数（コーディングエージェント作業のみ）
- server: `/api/v1` 404/エラーJSON統一 + SSE endpoints の追加、既存テスト更新/追加（60–120分）
- web workspace: Vite+React の最小起動、`/kiosk`/`/staff` 表示、SSE接続枠（EventSource）、テスト/coverage 100% の整備（90–180分）
- repo root: workspaces/scripts の更新、README へ起動手順追記、knip 対応（30–60分）

### 4. DB 影響
- N/A（M0は SQLite の空配線まで。スキーマ/CRUD/TTL は M2）

### 5. ログ出力
- N/A（ログ追加なし。`console.log` 禁止のため）

### 6. I/O 一覧
- ネットワーク通信:
  - server: `GET /api/v1/kiosk/stream` / `GET /api/v1/staff/stream`（SSE）
  - web: `EventSource("/api/v1/.../stream")`（Vite proxy 経由）
- ファイル読み書き:
  - N/A（アプリ実装での永続化はしない）
- DB I/O:
  - N/A
- 外部プロセス/CLI:
  - `npm install`（依存導入、`package-lock.json` 更新）
  - `npm run typecheck|lint|test|coverage|deadcode`

### 7. リファクタ候補（必須）
- `server/src/http-server.ts` がルーティング/SSE処理で肥大化する可能性があるため、必要なら `src/api-v1/*` 等へ分割（ただし M0 は最小で開始）

### 8. フェイズ分割
- 分割なし（この scope は M0 のみ）。
- M0 完了条件: `server` と `web` の `typecheck|lint|test|coverage` が全て green、root `npm run deadcode` も green。

### 9. テスト計画
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run coverage`
- `npm run deadcode`

### 10. 矛盾点/不明点/確認事項
- 不明点:
  - `knip` の `web` 適用範囲（設定追加が必要かは実行結果で確定）

### 11. 変更しないこと
- `.specs/` の仕様変更（このブランチでは行わない）
- SQLite の実装（スキーマ/CRUD/TTL/Housekeeping は M2）
- STAFF 認証（M3）
- PTT 録音/アップロード（M4）
