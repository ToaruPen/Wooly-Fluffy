# マイルストーン実装チェックリスト（M0〜）

目的: Epic `docs/epics/wooly-fluffy-mvp-epic.md` を実装に落とすときの「抜け漏れ防止」用チェックリスト。

位置づけ:
- このファイルは SoT ではなく `docs/memo/` 配下（検討/ToDo）に置く
- 仕様/方針として固定したい項目は、PRD/Epic/ADR（`docs/decisions.md`）へ反映する

## 共通（全マイルストーン）

### 事前

- [ ] 対象マイルストーンと関連 SoT を読む（PRD `docs/prd/wooly-fluffy.md` + Epic `docs/epics/wooly-fluffy-mvp-epic.md`）
- [ ] 曖昧/未確定を `docs/memo/90_open_questions.md` に追記し、決定したらPRD/Epic/ADRへ反映する
- [ ] ブランチを作る（例: `feat/m1-orchestrator`）
- [ ] 依存追加/主要変更は事前合意し、Epic（`docs/epics/wooly-fluffy-mvp-epic.md`）またはADR（`docs/decisions.md`）に採用理由/ライセンスURLを記録
- [ ] Secrets をコミットしない（例: `STAFF_PASSCODE`）
- [ ] データ最小化とログ方針を確認（会話本文/STT全文/音声/カメラ等を保存・ログ出力しない）

### 実装中

- [ ] 失敗時フォールバックを先に決める（timeout/cancel/retry、UI 表示）
- [ ] API エラー形式を `{ "error": { "code": string, "message": string } }` に統一する（Epic `docs/epics/wooly-fluffy-mvp-epic.md`）
- [ ] テストを同時に追加し、`coverage 100%` を崩さない

### 仕上げ（DoD）

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run coverage`（100%）
- [ ] `npm run deadcode`
- [ ] `README.md` の手順でローカル再現できる（起動/疎通が最短で確認できる）

## M0: 開発可能な最小骨格（UI/Server/DBの空配線）

- [ ] `server`: `/health` が `200 {"status":"ok"}` を返す
- [ ] `server`: `/api/v1` の枠（404/エラー統一）がある
- [ ] `server`: SSE 枠（Epic `docs/epics/wooly-fluffy-mvp-epic.md`）
  - [ ] `GET /api/v1/kiosk/stream`（初回 `kiosk.snapshot` + keep-alive）
  - [ ] `GET /api/v1/staff/stream`（初回 `staff.snapshot` + keep-alive）
- [ ] `web`: KIOSK/STAFF の最小ルーティング枠（例: `/kiosk`, `/staff`）がある
- [ ] `web`: `EventSource` で SSE に接続し、受信した `*.snapshot` を画面に反映できる
- [ ] `web`: `web` でも lint / deadcode / coverage を運用できる
- [ ] SQLite の配線枠（空でもよい）
- [ ] `DB_PATH` の既定値は `var/wooly-fluffy.sqlite3`（Epic `docs/epics/wooly-fluffy-mvp-epic.md`）
  - [ ] DB ファイルはコミットされない（`.gitignore` で除外されている）
- [ ] Evidence: `README.md` にローカル起動手順があり、手元で再現できる

## M1: Orchestrator（状態機械）を純粋ロジックとして確定 + ユニットテスト

- [x] Orchestrator を「純粋ロジック」として実装する（HTTP/DB/タイマーの実体に依存しない）
- [x] Orchestrator の状態/イベント/Effect を実装で表現できている（legacy: 旧契約ドキュメント）
- [x] `ROOM` / `PERSONAL(name)` 遷移がテストで担保されている
- [x] `3分` 無操作で `ROOM` へ戻る（`TICK` + `now` 注入で検証）
- [x] 同意フロー（「覚えていい？」→ yes/no）がテストで担保されている
- [x] 同意の対象は常に1件（複数候補の並行をしない）を担保できている
- [x] 緊急停止/復帰（`STAFF_EMERGENCY_STOP` / `STAFF_RESUME`）がテストで担保されている
- [x] 失敗時フォールバック（STT/Chat/InnerTask 失敗でも止めない）をテストで担保（DB/TTS は M1 では I/O 未接続）

### M1 Evidence / Notes（2026-01-18）

- Branch: `feat/m1-orchestrator`
- 実装:
  - `server/src/orchestrator.ts`
  - `server/src/orchestrator.test.ts`
- 実行した確認:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run coverage`
  - `npm run deadcode`
- Review artifact:
  - `.agentic-sdd/reviews/`（ローカルのレビュー結果はここに出力される。コミットしない）
- 気づき:
- `stop_output` のような「出力停止」は legacy の旧契約ドキュメントの Effects 一覧に無かったため、M1 では新規 Effect 追加はせず（必要ならSoT更新で合意）

## M2: Store（SQLite）+ pending TTL + staff confirm（データパス）

- [ ] `DB_PATH`（既定: `var/wooly-fluffy.sqlite3`）で SQLite を開ける
- [ ] Epic `docs/epics/wooly-fluffy-mvp-epic.md` のデータモデル（SQLite）で動く
  - [ ] `memory_items` テーブル + indexes
  - [ ] `pending/confirmed/rejected/deleted` の状態遷移
  - [ ] `source_quote` の扱い（`pending` は任意、`confirmed/rejected` では `NULL`）
- [ ] Housekeeping（起動時 + 定期）で期限切れを物理削除できる
- [ ] 統合テストで次が担保されている
  - [ ] `pending` → staff confirm → `confirmed`
  - [ ] `pending` → staff deny → `rejected`
  - [ ] TTL で `pending/rejected/deleted` が消える

## M3: API（KIOSK/STAFF）と Provider 境界（スタブでOK）

- [ ] Epic `docs/epics/wooly-fluffy-mvp-epic.md` の API を実装できている
  - [ ] `POST /api/v1/kiosk/event`（例: `UI_CONSENT_BUTTON`）
  - [ ] `POST /api/v1/kiosk/stt-audio`（multipart。音声は永続保存しない）
  - [ ] `POST /api/v1/staff/event`（PTT/Reset Session/緊急停止/復帰）
  - [ ] `GET /api/v1/staff/pending`
  - [ ] `POST /api/v1/staff/pending/:id/confirm` / `deny`
- [ ] Epic `docs/epics/wooly-fluffy-mvp-epic.md` のセキュリティ設計（STAFF最小アクセス制御）を実装できている
  - [ ] LAN 内限定（remote address 判定、`X-Forwarded-For` を信頼しない）
  - [ ] `POST /api/v1/staff/auth/login`（共有パスコード、Cookie セッション）
  - [ ] `POST /api/v1/staff/auth/keepalive`（無操作3分で失効）
  - [ ] STAFF API / STAFF SSE は認証必須
- [ ] Provider 境界（スタブ）を実装できている
  - [ ] STT / Chat / InnerTask（`consent_decision`, `memory_extract`）
  - [ ] timeout/cancel/retry 方針があり、落ちても UI が固まらない
- [ ] UI が成立する最小の Realtime（SSE）イベントが流れる
  - [ ] `kiosk.command.*`（record_start/record_stop/speak/stop_output）
  - [ ] `staff.pending_list`

## M4: KIOSK UI（状態表示/フォールバック）+ STAFF UI（PTT + 運用最低ライン）

- [ ] KIOSK UI
  - [ ] 状態表示（録音中/認識中/発話中 など）が分かる
  - [ ] 「はい/いいえ」ボタンで同意を確実に入力できる（STT誤認対策）
  - [ ] `kiosk.command.record_*` に従って録音→音声アップロードができる
  - [ ] `kiosk.command.speak` の表示 +（可能なら）音声出力、失敗時は表示のみ
  - [ ] `kiosk.command.stop_output` で出力を止められる
- [ ] STAFF UI
  - [ ] ログイン（共有パスコード）
  - [ ] 無操作3分でロック（keepalive + UI 操作検知）
  - [ ] PTT（`Space` 長押しを基本、画面ボタンはフォールバック）
  - [ ] pending 一覧、Confirm/Deny、Reset Session、緊急停止/復帰ができる
  - [ ] 診断（疎通）ページで DB/Provider の状態が分かる
- [ ] Evidence: 現場手順（起動/復旧/最低限の操作）が「1枚」で説明できる

## M5: 実 Provider を段階導入（1つずつ）

- [ ] Provider を 1 系統ずつ導入する（TTS → STT → LLM を推奨）
- [ ] 各 Provider で次を担保できている
  - [ ] 起動してない/遅い/失敗時にタイムアウトしてフォールバックへ落ちる
  - [ ] Secrets をログに出さない（パスコード/キー/音声/本文 等）
  - [ ] 診断画面で状態が確認できる

## M5.5: （後続）`ROOM` の「みんなの思い出」

- [ ] 個人特定なしの日付単位要約を扱える
- [ ] 作り方（職員手入力/半自動/自動抽出）と保持期間が決められている

## M6: 常設運用（起動/監視/バックアップ/削除運用）

- [ ] 自動起動（macOS の仕組み）で運用できる
- [ ] ログ最小化（会話本文/STT全文/音声/カメラを出さない）を運用として守れている
- [ ] バックアップ（暗号化）と復旧手順がある
- [ ] 削除要求（稼働 DB / バックアップの範囲を含む）の手順がある
