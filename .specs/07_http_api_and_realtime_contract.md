# HTTP API / Realtime（SSE）契約（MVP A→B0）

このドキュメントは、MVP（A→B0）における **Server ⇄ UI（KIOSK/STAFF）** のネットワーク契約を固定します。  
Orchestrator の状態/イベント/Effect は `.specs/06_orchestrator_contract.md` を正とします。

## 0) 位置づけ（決定）

- 画面更新は Realtime を前提にする（Polling を前提にしない）
- MVP の Realtime は **SSE（Server-Sent Events）** を採用する
- 将来 WebSocket に移行できるよう、**メッセージ（JSON）の形は transport に依存させない**（SSE/WS 共通）
- KIOSK 用と STAFF 用の配信ストリームは分離する（KIOSK に STAFF 情報を流さない）

## 1) 前提（決定）

- 端末構成: KIOSK（モニター側ブラウザ）/ STAFF（別端末ブラウザ）/ Server（常設PC）
- ネットワーク: 同一LAN（施設内）。施設外アクセスはスコープ外
- API は `v1` をパスでバージョン固定する

## 2) 共通ルール（決定）

### 2.1 Base Path

- Base: `/api/v1`

### 2.2 JSON

- API は原則 JSON を返す（音声アップロード等を除く）
- 文字コードは UTF-8

### 2.3 Error（決定）

- エラーは次の形に統一する（HTTP status は適切に付与）
  - `{ "error": { "code": string, "message": string } }`

## 3) Realtime（SSE）契約（決定）

### 3.1 SSE Endpoints（決定）

- KIOSK: `GET /api/v1/kiosk/stream`（SSE）
- STAFF: `GET /api/v1/staff/stream`（SSE）

### 3.2 メッセージ封筒（決定）

SSE で流すデータは次の JSON を `data:` に入れる（WebSocket に移行する場合も同じ JSON を送る）。

- `ServerMessage`:
  - `type: string`（例: `kiosk.snapshot`）
  - `seq: number`（単調増加の連番。接続単位でよい）
  - `data: object`（型は `type` ごとに決める）

> SSE の `id:` には `seq` を入れてよい。ただし MVP では「取りこぼしの再送」は保証せず、再接続時は `snapshot` を送り直す方針とする。

### 3.3 初回/再接続（決定）

- 接続が確立したら必ず `*.snapshot` を 1 回送る（その時点の最新状態）
- その後は変更があった時だけ通知する（頻度は実装依存）

### 3.4 keep-alive（決定）

- 中間機器で切断されないよう、定期的に keep-alive を送る（`ping` など）

## 4) KIOSK API（決定）

### 4.1 KIOSK → Server（HTTP）

#### 4.1.1 KIOSK Event

- `POST /api/v1/kiosk/event`
  - body:
    - `{ "type": "UI_CONSENT_BUTTON", "answer": "yes" | "no" }`
  - response:
    - `200 { "ok": true }`

#### 4.1.2 STT 音声アップロード

- `POST /api/v1/kiosk/stt-audio`
  - 目的: `CALL_STT(request_id)` に対応する音声を Server に渡す（音声は永続保存しない）
  - request:
    - `Content-Type: multipart/form-data`
    - fields:
      - `stt_request_id: string`
      - `audio: File`（例: `audio/webm` / `audio/wav`。採用は実装で決める）
  - response:
    - `202 { "ok": true }`

### 4.2 Server → KIOSK（SSE）

#### 4.2.1 `kiosk.snapshot`（決定）

- `data`:
  - `{ "state": { "mode": "ROOM" | "PERSONAL", "personal_name": string | null, "phase": string, "consent_ui_visible": boolean } }`

> `phase` は `.specs/06_orchestrator_contract.md` を正とする。

#### 4.2.2 KIOSK Commands（決定）

KIOSK は次の `type` を受け取ったら、端末内で I/O を実行する。

- `kiosk.command.record_start`
  - data: `{}`
  - 意味: マイク録音開始（PTT中）
- `kiosk.command.record_stop`
  - data: `{ "stt_request_id": string }`
  - 意味: 録音停止 → `POST /api/v1/kiosk/stt-audio` で音声をアップロード
- `kiosk.command.speak`
  - data: `{ "say_id": string, "text": string }`
  - 意味: 画面表示 +（可能なら）音声出力（TTS失敗時は表示のみ）
- `kiosk.command.stop_output`
  - data: `{}`
  - 意味: 進行中の音声出力（speechSynthesis 等）を停止する（`.specs/06_orchestrator_contract.md` の強制停止/緊急停止に対応）

> `say_id` は UI 側の重複排除用（再接続時に同じ発話を二重再生しないため）。保持は短期でよい。

## 5) STAFF API（決定）

### 5.1 STAFF → Server（HTTP）

#### 5.1.0 認証（決定）

- STAFF の認証/自動ロック/LAN 内限定は `.specs/08_staff_access_control.md` を正とする

#### 5.1.1 STAFF Event

- `POST /api/v1/staff/event`
  - body（例）:
    - `{ "type": "STAFF_PTT_DOWN" }`
    - `{ "type": "STAFF_PTT_UP" }`
    - `{ "type": "STAFF_FORCE_ROOM" }`
    - `{ "type": "STAFF_EMERGENCY_STOP" }`
    - `{ "type": "STAFF_RESUME" }`
  - response:
    - `200 { "ok": true }`

> STAFF 系エンドポイントは認証必須。

#### 5.1.2 `pending` 一覧

- `GET /api/v1/staff/pending`
  - response:
    - `200 { "items": PendingItem[] }`

#### 5.1.3 `pending` Confirm / Deny

- `POST /api/v1/staff/pending/:id/confirm`
  - response:
    - `200 { "ok": true }`
- `POST /api/v1/staff/pending/:id/deny`
  - response:
    - `200 { "ok": true }`

### 5.2 Server → STAFF（SSE）

#### 5.2.1 `staff.snapshot`（決定）

- `data`:
  - `{ "state": { "mode": "ROOM" | "PERSONAL", "personal_name": string | null, "phase": string }, "pending": { "count": number } }`

#### 5.2.2 `staff.pending_list`（決定）

- `data`:
  - `{ "items": PendingItem[] }`

### 5.3 `PendingItem` DTO（決定）

- `PendingItem`:
  - `id: string`
  - `personal_name: string`
  - `kind: "likes" | "food" | "play" | "hobby"`
  - `value: string`
  - `source_quote?: string`（任意。`pending` の確認補助。`confirmed` には原則残さない）
  - `status: "pending" | "confirmed" | "rejected" | "deleted"`
  - `created_at_ms: number`
  - `expires_at_ms: number | null`

## 6) WebSocket への移行方針（決定）

- 将来 WebSocket を導入する場合も、`ServerMessage` / `event` の JSON 形は維持し、transport（SSE/WS）だけ差し替える
- KIOSK/STAFF のストリーム分離（情報境界）は維持する
