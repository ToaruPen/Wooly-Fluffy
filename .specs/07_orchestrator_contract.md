# Orchestrator 契約（MVP A→B0）

このドキュメントは、MVP（A→B0）における `Conversation Orchestrator` の「入力/出力/状態/タイマー/優先順位」を固定します。  
実装は差し替え可能でも、**この契約とテスト**は固定します。

## 0) 位置づけ（決定）

- Orchestrator は **純粋ロジック**（副作用なし）として実装し、ユニットテストで固定する
- I/O（録音、STT/LLM/TTS 呼び出し、DB 書込、UI 更新）はすべて **Effect** として外に出し、実行結果は **Event** として Orchestrator に戻す
- 会話生成（外側）と内部処理（内側）を分ける
  - 外側: `ChatProvider`（会話文を生成）
  - 内側: `InnerTaskProvider`（分類/抽出/要約などを **スキーマ固定JSON** で返す）

## 1) 対象スコープ（決定）

- モード: `ROOM` / `PERSONAL(name)`
- モード切替コマンド
  - `PERSONAL(name)` 開始: `「パーソナル、<name>」`（STTの表記揺れは許容し、正規化して決定的に解釈）
  - `ROOM` 戻し: `「ルーム」` または `「ルームに戻る」`
- `PERSONAL` の無操作タイムアウト: `300秒`（定義は `.specs/03_modes_identification_and_consent.md` を正とする）
- 記憶保存同意の最小フロー（`「覚えていい？」`、待ち `30秒`、超過で破棄 + 定型返答）

### 1.1 コマンド解釈（決定）

- コマンドは **正規化後の先頭一致のみ**で判定する（部分一致での誤爆を避ける）
- `PERSONAL(name)` の成立条件
  - 正規化後に `パーソナル` で始まり、区切り（`、` / `,` / 空白）の直後に `name` がある
  - `name` は区切り直後の **1トークン**（空白/句読点で区切る）
  - `name` が欠けている場合は不成立
  - `name` の後ろに余計な語があっても無視してよい（開始に必要なのは `name` のみ）
- `ROOM` 戻しの成立条件
  - 正規化後に **完全一致**で `ルーム` または `ルームに戻る`
  - 追加語（例: `ルームに戻るよ`）はコマンド不成立とする

## 2) 非スコープ（この段階では固定しない）

- Web 実装詳細（KIOSK/STAFF の画面実装）
- DB スキーマの確定（`.specs/04_data_policy_and_memory_model.md` は方針・叩き台）
- STT/TTS/LLM の具体プロバイダ選定（差し替え前提）

## 3) 不変条件（決定）

- **データ最小化**
  - `ROOM` の会話は永続保存しない（短期セッションの保持は必要最小で）
  - 音声（録音ファイル）や STT 全文テキストは保存しない（`.specs/04_data_policy_and_memory_model.md` を正）
- **止めない（フォールバック）**
  - STT/LLM/TTS/DB が失敗しても Orchestrator が停止しない（定型フォールバックへ）
- **決定的**
  - モード遷移や同意判定は、外側LLMの自由文に依存させない（必要な非決定処理は `InnerTaskProvider` の JSON に寄せる）

## 4) インターフェース（決定）

Orchestrator は「Event を受け取り、次状態と Effect 列」を返す。

- 入力: `event`（外部からの入力 or Provider の結果）
- 入力: `now`（時刻。タイマー判定のために常に渡す）
- 出力:
  - `nextState`
  - `effects[]`（I/O は呼び出し側が実行する）

> `now` はテスト容易性のために外から注入し、Orchestrator は実時間を参照しない。

## 5) Orchestrator State（たたき台 / 決定したら更新）

最小の状態は以下を含む（形は実装に依存するが、意味は固定する）。

- `mode`: `ROOM | PERSONAL`
- `personal_name`: `string | null`
- `phase`: `idle | listening | waiting_stt | waiting_chat | asking_consent | waiting_inner_task`
- `last_action_at_ms`: `number`（`.specs/03` の「最後の操作」起点で更新）
- `consent_deadline_at_ms`: `number | null`（`「覚えていい？」` から `30秒`）
- `in_flight`:
  - `stt_request_id?: string`
  - `chat_request_id?: string`
  - `inner_task_request_id?: string`

## 6) Events（決定）

外部I/Oの結果も含め、Orchestrator に入るものを Event と呼ぶ。

- 入力（STAFF/UI）
  - `STAFF_PTT_DOWN`
  - `STAFF_PTT_UP`
  - `UI_CONSENT_BUTTON(answer: "yes" | "no")`
  - `STAFF_FORCE_ROOM`
  - `STAFF_EMERGENCY_STOP`
  - `STAFF_RESUME`
- Provider 結果
  - `STT_RESULT(text: string, request_id: string)`
  - `STT_FAILED(request_id: string)`
  - `CHAT_RESULT(assistant_text: string, request_id: string)`
  - `CHAT_FAILED(request_id: string)`
  - `INNER_TASK_RESULT(json_text: string, request_id: string)`
  - `INNER_TASK_FAILED(request_id: string)`
- タイマー
  - `TICK`（呼び出し側が適当な間隔で呼ぶ。`now` を見て期限超過を判定する）

## 7) Effects（決定）

Orchestrator は I/O を直接実行せず、Effect として要求する。

- 録音
  - `KIOSK_RECORD_START`
  - `KIOSK_RECORD_STOP`
- Provider 呼び出し
  - `CALL_STT(request_id: string, audio_ref: string)`
  - `CALL_CHAT(request_id: string, input: {...})`
  - `CALL_INNER_TASK(request_id: string, task: "consent_decision", input: {...})`
- UI/出力
  - `SAY(text: string)`（TTS or 表示の抽象。失敗時は表示のみ等にフォールバック）
  - `SET_MODE(mode: "ROOM" | "PERSONAL", personal_name?: string)`
  - `SHOW_CONSENT_UI(visible: boolean)`
- 永続（M2で有効化）
  - `STORE_WRITE_PENDING(...)`
  - `STORE_WRITE_CONFIRMED(...)`

## 8) 優先順位 / 競合（決定）

- `STAFF_FORCE_ROOM` は常に最優先
  - 受理したら即 `ROOM` に遷移し、同意待ち/処理中のフローは中断する
- Provider 結果は `request_id` で関連付ける
  - `request_id` が現状態の `in_flight` と一致しない結果は **無視**（遅延/重複/過去結果の混入に耐える）

## 9) タイマー契約（決定）

### 9.1 `PERSONAL` 無操作 `300秒`

- `.specs/03_modes_identification_and_consent.md` を正とする
- 期限超過を `TICK` で検知したら、明示アナウンス無しで `ROOM` に戻す

### 9.2 「覚えていい？」待ち `30秒`

- 待ち状態（`asking_consent`）に入った時点で `consent_deadline_at_ms = now + 30_000`
- 期限超過を `TICK` で検知したら、`SAY("さっきのことは忘れるね")` を行い、候補は破棄する

## 10) `InnerTaskProvider` の JSON 契約（決定）

`はい/いいえ` の意図解釈は内側で行い、次の最小 JSON を返す。

- 最小スキーマ（決定）:
  - `{"task":"consent_decision","answer":"yes"|"no"|"unknown"}`
- JSON検証に失敗、または `InnerTaskProvider` がタイムアウト/失敗した場合
  - `unknown` として扱い、既存の待ち（最大 `30秒`）へ戻す

## 11) `SAY` の扱い（割り込み/停止）（決定）

- `STAFF_FORCE_ROOM` を受理したら、進行中の `SAY`（音声再生中）は即停止する（表示の取り消しは必須としない）

## 12) Provider の timeout/cancel/retry（決定）

### 12.1 timeout（決定）

MVPでは固定値で開始し、運用計測の上で調整する。

- `STTProvider`: `12s`
- `ChatProvider`: `12s`
- `InnerTaskProvider`: `4s`

### 12.2 retry（決定）

MVPでは遅延増を避けるため、いずれも `retry=0` とする。

### 12.3 cancel（決定）

- `STAFF_FORCE_ROOM` などで不要になった `in_flight` は、可能ならベストエフォートでキャンセルする
- キャンセルできない/失敗しても、`request_id` の一致チェックにより安全に無視できる前提とする

## 13) 緊急停止（決定）

### 13.1 Event（決定）

- `STAFF_EMERGENCY_STOP`
- `STAFF_RESUME`

### 13.2 `STAFF_EMERGENCY_STOP` の挙動（決定）

- 進行中の `SAY`（音声再生中）は即停止する
- 録音中であれば即停止する
- `in_flight`（STT/Chat/InnerTask）はベストエフォートでキャンセルする
  - 結果が返ってきても `request_id` の一致チェックで無視できる前提
- `STAFF_RESUME` 以外の入力は無視する（操作不能状態）

### 13.3 `STAFF_RESUME` の挙動（決定）

- `ROOM` の `idle` へ戻す（同意待ち等の途中状態は破棄）
- 復帰時は自動でしゃべらない（必要なら後で復帰メッセージを検討する）
