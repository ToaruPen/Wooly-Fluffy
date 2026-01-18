# Estimation: M1 Orchestrator (pure logic + unit tests)

### 0. 前提確認
- 参照した一次情報:
  - `AGENTS.md:7`（SoTは`.specs/`）
  - `AGENTS.md:27`（データ最小化/ログ方針）
  - `AGENTS.md:29`（依存追加は事前合意 + `.specs/10`へ記録）
  - `server/AGENTS.md:16`（`strict` / `noUnusedLocals` / `noUnusedParameters`）
  - `server/AGENTS.md:18`（`console.log` 禁止 / `fs` 直利用禁止）
  - `.specs/99_implementation_roadmap.md:38`（M1の狙い/実装対象/Evidence）
  - `.specs/06_orchestrator_contract.md:8`（Orchestratorは純粋ロジック）
  - `.specs/06_orchestrator_contract.md:23`（コマンド解釈：正規化+先頭一致/完全一致）
  - `.specs/06_orchestrator_contract.md:80`（Events一覧）
  - `.specs/06_orchestrator_contract.md:101`（Effects一覧）
  - `.specs/06_orchestrator_contract.md:145`（タイマー契約：300秒/30秒）
  - `.specs/03_modes_identification_and_consent.md:29`（`ROOM`/`PERSONAL(name)` と無操作300秒の定義）
  - `.specs/03_modes_identification_and_consent.md:45`（同意フロー：30秒で破棄 + 定型返答）
  - `.specs/04_data_policy_and_memory_model.md:3`（保存しない方針）
  - `.specs/07_http_api_and_realtime_contract.md:88`（`kiosk.snapshot` の `phase`/`consent_ui_visible`）
  - `server/src/http-server.ts:26`（現状snapshotの形）
- 不足/矛盾:
  - `.specs/06` は `STAFF_FORCE_ROOM`/緊急停止で「進行中の`SAY`を即停止」とある（`.:179`, `.:209`）一方、Effects一覧に停止系Effectが無い（`.:101`）。`.specs/07` には `kiosk.command.stop_output` がある（`.specs/07_http_api_and_realtime_contract.md:108`）。→ OrchestratorのEffectとして停止を表現するか要確認。
  - `.specs/06` の `KIOSK_RECORD_STOP` は引数無し（`.:105`）だが、`.specs/07` の `kiosk.command.record_stop` には `stt_request_id` が必要（`.specs/07_http_api_and_realtime_contract.md:102`）。→ `stt_request_id` は state から導出する前提でよいか要確認。
  - `.specs/06` に Store の失敗Eventが無く（Events一覧 `.:80`）、M1要件（`.specs/99:51`）の「DBが落ちても止めない」を Orchestrator 単体テストでどう表現するか要確認（M1では「Effectを出してもOrchestratorは落ちない」までで良いか）。

### 1. 依頼内容の解釈（引用）
- ユーザー要点: 「M1: `.specs/06` 通りに Orchestrator を純粋ロジックとして実装（Event + now → nextState + effects）し、主要仕様をユニットテストで固定（TICK/fake timers）。」
- 解釈: `server/` 配下に Orchestrator の型と reducer を追加し、`ROOM`/`PERSONAL(name)`、無操作300秒、同意30秒、`STAFF_FORCE_ROOM`最優先、`request_id`不一致無視、緊急停止/復帰、失敗フォールバック（STT/Chat/InnerTask）を unit test で担保する。

### 2. 変更対象（ファイル:行）
- 変更:
  - `server/src/http-server.ts:26`（初期snapshot定義を Orchestrator 側の初期public state に寄せる）
- 新規（予定）:
  - `server/src/orchestrator.ts:1 (新規)`
  - `server/src/orchestrator.test.ts:1 (新規)`

### 3. 作業項目と工数（コーディングエージェント作業のみ）
- Orchestrator: State/Event/Effect 型 + reducer 実装（60–120分）
- コマンド正規化/判定（先頭一致/完全一致、1トークンname抽出）（30–60分）
- ユニットテスト（主要仕様 + fake timers/TICK）（90–180分）
- `server/src/http-server.ts` の初期snapshot差し替え（10–20分）

### 4. DB 影響
- N/A（M1は I/O を繋がない。`STORE_WRITE_PENDING` は Effect 表現のみ）

### 5. ログ出力
- N/A（ログ追加なし。`console.log` 禁止のため）

### 6. I/O 一覧
- N/A（Orchestrator自体は純粋ロジック。HTTP/DB/ファイルI/Oは追加しない）

### 7. リファクタ候補（必須）
- 候補なし。理由: `server/` は現状最小で、M1は新規ロジックの追加が中心。既存のHTTPサーバ分割は M1 のスコープ外（`.specs/99_implementation_roadmap.md:38`）。

### 8. フェイズ分割
- 分割なし（M1単独スコープ）。
- 完了条件: `server` の `typecheck|lint|test|coverage` が green、root の `npm run deadcode` も green。

### 9. テスト計画
- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run coverage`
- `npm run deadcode`

### 10. 矛盾点/不明点/確認事項
- 確認:
  1) `stop_output`（`.specs/07:108`）相当の停止は Orchestrator の Effect として追加しますか？（追加なら `.specs/06` 更新が必要）
  2) `kiosk.command.record_stop` の `stt_request_id` は state (`in_flight.stt_request_id`) から導出する前提でよいですか？（Effectに含めないまま実装する前提）
  3) 「DBが落ちても止めない」（`.specs/99:51`）は、M1では「Store系Effectを出してもOrchestratorは例外で止まらない/継続できる」まででOKですか？（Store失敗Eventを追加しない前提）

### 11. 変更しないこと
- `.specs/` の仕様変更（上記の確認事項が「変更する」回答の場合は先にSoT更新が必要）
- Provider 実体（STT/Chat/InnerTask/TTS/DB）の接続
- API（HTTP/SSE）契約の追加実装（M3以降）
