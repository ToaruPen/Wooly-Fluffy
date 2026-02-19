# Epic: Wooly-Fluffy MVP（A→B0）

---

## メタ情報

- 作成日: 2026-01-31
- 作成者: -
- ステータス: Draft
- 参照PRD: `docs/prd/wooly-fluffy.md`

---

## 1. 概要

### 1.1 目的

学童の現場で破綻しない運用（職員見守り・責任分界）を前提に、「モード表示なし」「ROOM一本の会話セッション」「アイドル5分でセッション終了→セッション要約をpendingとして保存→職員Confirm/Deny」を最小の形で成立させる。

### 1.2 スコープ

**含む:**

- モード表示なし（子ども側に `ROOM/PERSONAL` の表示や切り替え操作を出さない）
- 会話はroomセッションとして扱い、最後の会話からアイドル5分でセッション終了
- セッション終了時にセッション要約（短いタイトル + 構造化JSON）を生成し、`pending` として保存
- pendingは7日で自動失効し、職員がConfirm/Denyできる（Confirmは永続、Denyは削除）
- Push-to-talk（KIOSK/職員操作。KIOSK/STAFFとも hold-to-talk を前提）
- KIOSK/STAFFのRealtime（SSE）と最小UI
- STAFF最小アクセス制御（LAN内限定/共有パスコード/自動ロック）
- 「芸事」（例: ダンス/手をふる等）の最小対応（許可リストのモーションIDのみ）
- ツール呼び出しの最小対応（例: 天気の取得。許可リスト + タイムアウト + フォールバック）

**含まない（PRDのスコープ外を継承）:**

- バイオメトリクス（声紋等）による本人確認
- 録音ファイル/会話全文/STT全文の永続保存
- 施設外からの遠隔アクセス（インターネット公開）
- Webカメラの常時稼働/保存/個人識別
- タッチゲーム
- AI応答の低遅延音声パイプライン改修（別Epic: `docs/epics/wooly-fluffy-ai-voice-latency-epic.md`）

### 1.3 PRD制約の確認

項目: 規模感
PRDの値: 小規模
Epic対応: コンポーネント数を2に抑え、単機ローカル運用を前提にする

項目: 技術方針
PRDの値: シンプル優先
Epic対応: 外部サービス数の上限では縛らず、許可リスト + タイムアウト + フォールバックで暴走/コスト/故障モードを抑制する（同時に有効なLLM Providerは1つ。切り替えはサーバ再起動で行う）

項目: 既存言語/FW
PRDの値: Yes
Epic対応: TypeScript（Node.js LTS）+ React（Vite）+ SQLite

項目: デプロイ先
PRDの値: Yes
Epic対応: 常設PC上のローカル稼働 + 同一LAN内ブラウザ

---

## 2. 必須提出物（3一覧）

### 2.1 外部サービス一覧

外部サービス-1
名称: なし（デフォルト）
用途: -
必須理由: -
代替案: 外部サービスを使う場合は下記

外部サービス-2
名称: 外部LLM API（例: OpenAI / GLM など）
用途: LLM（会話/内側タスク）、およびツール呼び出しの結果統合
必須理由: ローカルLLMの品質/遅延が要件を満たさない場合の代替。
代替案: ローカルLLM（LM Studio等）

外部サービス-3
名称: 天気API（候補は後で確定）
用途: `get_weather` ツール（例: 「今日の天気は？」への回答補助）
必須理由: リアルタイム情報の参照が必要なため
代替案: ツール無し（「わからない」と返す）

### 2.2 コンポーネント一覧

コンポーネント-1
名称: API Server
責務: HTTP API、SSE配信、Orchestrator実行、Provider呼び出し、SQLite永続、Housekeeping
デプロイ形態: 常設PC上の単一プロセス

コンポーネント-2
名称: Web Frontend（KIOSK/STAFF）
責務: KIOSK表示・入力（PTT/モーション実行）、STAFF操作（PTT/セッション要約Confirm/Deny/緊急操作）、SSE受信
デプロイ形態: 常設PC上で配信（または静的ホスティング）

### 2.3 新規技術一覧

新規技術-1
名称: SSE（Server-Sent Events）
カテゴリ: Realtime
既存との差: 新規導入
導入理由: Polling前提にせず、KIOSK/STAFFへ状態とコマンドを配信する

新規技術-2
名称: SQLite（`session_summary_items`）
カテゴリ: Database
既存との差: 新規導入
導入理由: `pending/confirmed` を単機ローカルで永続でき、TTL掃除を含め運用が軽い

---

## 3. 技術設計

### 3.1 アーキテクチャ概要

システム境界:

- UI（KIOSK/STAFF）はI/O（録音、再生、表示、入力）を担当
- Serverは状態（Orchestrator）と永続（SQLite）と境界（Provider）を担当
- Providerは差し替え可能な境界として設計し、失敗しても会話が止まらない

主要データフロー-1
from: STAFF UI
to: API Server
用途: PTT/強制ROOM/緊急停止/復帰のイベント入力
プロトコル: HTTP（`/api/v1/staff/event`）

主要データフロー-2
from: API Server
to: KIOSK UI
用途: 録音開始/停止、発話、出力停止などのコマンド配信
プロトコル: SSE（`/api/v1/kiosk/stream`）

主要データフロー-3
from: KIOSK UI
to: API Server
用途: STT音声アップロード
プロトコル: HTTP multipart（`/api/v1/kiosk/stt-audio`）

### 3.2 技術選定

技術選定-1
カテゴリ: 言語
選択: TypeScript（Node.js LTS）
理由: 中核ロジックを型で固定し、ユニットテストと相性が良い

技術選定-2
カテゴリ: フロントエンド
選択: React + Vite
理由: KIOSK/STAFFの2画面をSPAとして分離しやすい

技術選定-3
カテゴリ: データベース
選択: SQLite
理由: 単機ローカル運用で `pending/confirmed` とTTL掃除を成立させやすい

### 3.3 データモデル（概要）

DBファイル:

- `DB_PATH` 環境変数で指定する
- 未指定の場合の既定値: `var/wooly-fluffy.sqlite3`

エンティティ-1
名前: session_summary_items
主要属性: id, status, title, summary_json, trigger, schema_version, created_at_ms, updated_at_ms, expires_at_ms
関連: -

#### 3.3.1 `session_summary_items`（DDL要約）

MVPではセッション要約を `pending/confirmed` の2状態で扱う（Denyは物理削除し本文を残さない）。

- `id` TEXT (UUID) PRIMARY KEY
- `status` TEXT NOT NULL（値: `pending|confirmed`）
- `title` TEXT NOT NULL
- `summary_json` TEXT NOT NULL（構造化JSON。スキーマ固定 + 保存前バリデーション/簡易マスク）
- `trigger` TEXT NOT NULL（値: `idle`）
- `schema_version` INTEGER NOT NULL
- `created_at_ms` INTEGER NOT NULL
- `updated_at_ms` INTEGER NOT NULL
- `expires_at_ms` INTEGER NULL

インデックス:

- `idx_session_summary_items_status_created_at` on (`status`, `created_at_ms` DESC)
- `idx_session_summary_items_status_expires_at` on (`status`, `expires_at_ms`)

#### 3.3.2 状態遷移（要約）

- `pending` 作成
  - `status=pending`
  - `expires_at_ms = now + 7d`
- STAFF Confirm
  - `pending -> confirmed`
  - `expires_at_ms = NULL`（自動忘却しない）
- STAFF Deny
  - pending行を物理削除（本文保持しない）

#### 3.3.3 Housekeeping（TTL掃除）

- 対象: `status=pending` かつ `expires_at_ms <= now` の行
- 実行: Server起動時に1回 + 定期（例: 10分間隔）

### 3.4 API設計（概要）

共通:

- Base Path: `/api/v1`
- Error 形式: `{ "error": { "code": string, "message": string } }`

API-1
エンドポイント: /api/v1/kiosk/stream
メソッド: GET
説明: KIOSK向けSSEストリーム（snapshot + commands）

API-2
エンドポイント: /api/v1/staff/stream
メソッド: GET
説明: STAFF向けSSEストリーム（snapshot + session_summaries_pending_list）

API-3
エンドポイント: /api/v1/staff/auth/login
メソッド: POST
説明: 共有パスコードでログインし、セッションCookieを付与

API-4
エンドポイント: /api/v1/staff/event
メソッド: POST
説明: STAFFイベント（PTT/緊急停止/復帰）

API-5
エンドポイント: /api/v1/kiosk/event
メソッド: POST
説明: KIOSKイベント（PTTなど）

API-6
エンドポイント: /api/v1/staff/session-summaries/pending
メソッド: GET
説明: セッション要約pending一覧取得

API-7
エンドポイント: /api/v1/staff/session-summaries/:id/confirm
メソッド: POST
説明: pendingをconfirmedへ

API-8
エンドポイント: /api/v1/staff/session-summaries/:id/deny
メソッド: POST
説明: pendingを削除（本文保持しない）

#### 3.4.1 Realtime（SSE）契約（詳細）

SSEエンドポイント:

- KIOSK: `GET /api/v1/kiosk/stream`
- STAFF: `GET /api/v1/staff/stream`

メッセージ封筒（SSE/WS共通の形）:

- `ServerMessage`
  - `type: string`（例: `kiosk.snapshot`）
  - `seq: number`（単調増加の連番。接続単位でよい）
  - `data: object`

接続時の挙動:

- 接続が確立したら必ず `*.snapshot` を1回送る（初回/再接続とも）
- 以降は変更があった時のみ送る
- keep-alive（`ping` 等）を定期送信する

#### 3.4.2 KIOSK -> Server（HTTP）

- `POST /api/v1/kiosk/event`
  - body:
    - `{ "type": "KIOSK_PTT_DOWN" }`
    - `{ "type": "KIOSK_PTT_UP" }`
  - response: `200 { "ok": true }`

- `POST /api/v1/kiosk/stt-audio`
  - Content-Type: `multipart/form-data`
  - fields:
    - `stt_request_id: string`
    - `audio: File`（例: `audio/webm` / `audio/wav`）
  - response: `202 { "ok": true }`
  - 方針: 音声はディスクに永続保存しない

#### 3.4.3 Server -> KIOSK（SSE）

- `kiosk.snapshot`
  - `data`:
    - `{ "state": { "phase": string } }`

- `kiosk.command.record_start`
  - `data`: `{}`

- `kiosk.command.record_stop`
  - `data`: `{ "stt_request_id": string }`

- `kiosk.command.speak`
  - `data`: `{ "say_id": string, "text": string, "expression"?: "neutral" | "happy" | "sad" | "surprised" }`
  - 注記: `say_id` は再接続時の二重再生を避けるためのUI側の重複排除用

- `kiosk.command.tool_calls`
  - `data`: `{ "tool_calls": Array<{ "id": string, "function": { "name": string } }> }`
  - 注記: `arguments` は送らない（データ最小化 + 実行はServer側の別Issue）

- `kiosk.command.play_motion`
  - `data`: `{ "motion_id": string, "motion_instance_id": string }`
  - 意味: 許可リストのモーションを再生する（`motion_instance_id` は重複排除/上書き制御用）
  - 制約: 許可リスト外の `motion_id` は安全に無視する
  - 初期許可リスト（PoC）: `idle` / `greeting` / `cheer` / `thinking`
  - 運用ルール: `thinking` は主に `waiting_chat` 中の待機フィードバック用途。回答開始時は `greeting` / `cheer` / `idle` で上書き停止する
  - ローカル運用: モーション資産はローカル配置し、リポジトリにコミットしない（Mixamo等のrawファイル再配布を避ける）
  - 参照: ADR-11（Mixamoモーション運用方針）, Issue #38（Mixamo motion playback PoC）

- `kiosk.command.stop_output`
  - `data`: `{}`
  - 意味: 進行中の音声出力（speechSynthesis 等）を停止する

#### 3.4.4 STAFF（認証/イベント/データ）

- 認証
  - `POST /api/v1/staff/auth/login`
    - request: `{ "passcode": string }`
    - success: `200 { "ok": true }` + session cookie
    - failure: `401 { "error": ... }`
  - `POST /api/v1/staff/auth/keepalive`
    - success: `200 { "ok": true }`
    - expired: `401 { "error": ... }`

- イベント
  - `POST /api/v1/staff/event`
    - body例:
      - `{ "type": "STAFF_PTT_DOWN" }`
      - `{ "type": "STAFF_PTT_UP" }`
      - `{ "type": "STAFF_EMERGENCY_STOP" }`
      - `{ "type": "STAFF_RESUME" }`
    - response: `200 { "ok": true }`

- Session summary pending
  - `GET /api/v1/staff/session-summaries/pending`
    - response: `200 { "items": SessionSummaryItem[] }`
  - `POST /api/v1/staff/session-summaries/:id/confirm`
    - response: `200 { "ok": true }`
  - `POST /api/v1/staff/session-summaries/:id/deny`
    - response: `200 { "ok": true }`

- STAFF SSEメッセージ
  - `staff.snapshot`
    - `data`:
      - `{ "state": { "phase": string }, "pending_session_summaries": { "count": number } }`
  - `staff.session_summaries_pending_list`
    - `data`:
      - `{ "items": SessionSummaryItem[] }`

- `SessionSummaryItem` DTO
  - `id: string`
  - `title: string`
  - `summary_json: object`
  - `status: "pending" | "confirmed"`
  - `created_at_ms: number`
  - `expires_at_ms: number | null`

### 3.5 Orchestrator（仕様要約 / MVP A->B0）

Orchestrator は純粋ロジック（副作用なし）として実装する:

- input: `event` + `now`
- output: `nextState` + `effects[]`

決定性ルール:

- セッション終了判定、要約生成、allowlistチェックは外側LLMの自由文に依存させない
- 非決定的な処理は、スキーマ固定JSON（InnerTask）を返し、コード側で validate して採用する

コマンド解釈ルール（正規化後テキスト）:

- モード切替コマンドは扱わない（例: `パーソナル、...` / `ルームに戻る` 等は通常発話として扱う）

リクエスト相関（`request_id`）:

- Provider結果は `request_id` で関連付ける
- `request_id` が現状態の in-flight と一致しない結果は無視する

優先順位:

- `STAFF_EMERGENCY_STOP` を最優先とし、進行中のフローを中断する
- `STAFF_EMERGENCY_STOP` ではUI出力を停止する（`kiosk.command.stop_output` を使用）

タイムアウト:

- セッションアイドル: 300秒（5分）。最後の会話からアイドルが続いた場合、セッションを終了しセッション要約生成へ進む

要約入力（RAMのみ）:

- 会話本文の永続化は禁止し、セッション要約生成に使う入力はRAM上の短期データに限定する（セッション確定後に必ず破棄）
- RAM暴走防止のため上限を設ける。長セッションで古い発話ログが溢れる場合は、古い分をRAM内の短い要約へ畳み込み、直近ログを優先して残す（このRAM内要約は永続化しない）

Provider方針:

- timeout: STT=15s, Chat=12s, InnerTask=4s（いずれも環境変数で調整可能）
- retry: 0（MVP）
- cancel: 状態変化（force-room / emergency stop 等）でベストエフォートキャンセル

イベント/Effect（MVPで扱う最小セット）:

- イベント（例）
  - 入力（STAFF/UI）
    - `STAFF_PTT_DOWN`
    - `STAFF_PTT_UP`
    - `KIOSK_PTT_DOWN`
    - `KIOSK_PTT_UP`
    - `STAFF_EMERGENCY_STOP`
    - `STAFF_RESUME`
  - Provider結果
    - `STT_RESULT(text: string, request_id: string)`
    - `STT_FAILED(request_id: string)`
    - `CHAT_RESULT(assistant_text: string, request_id: string)`
    - `CHAT_FAILED(request_id: string)`
    - `INNER_TASK_RESULT(json_text: string, request_id: string)`
    - `INNER_TASK_FAILED(request_id: string)`
  - タイマー
    - `TICK`

- Effects（例）
  - 録音
    - `KIOSK_RECORD_START`
    - `KIOSK_RECORD_STOP`
  - Provider呼び出し
    - `CALL_STT(request_id: string)`
    - `CALL_CHAT(request_id: string, input: object)`
    - `CALL_INNER_TASK(request_id: string, task: "session_summary", input: object)`
  - UI/出力
    - `SAY(text: string)`
    - `SET_EXPRESSION(expression: "neutral" | "happy" | "sad" | "surprised")`
    - `PLAY_MOTION(motion_id: string, motion_instance_id: string)`
  - 永続
    - `STORE_WRITE_SESSION_SUMMARY_PENDING(input: { title: string, summary_json: object })`

InnerTask JSON（最小）:

- `session_summary`: `{ "task": "session_summary", "title": string, "summary_json": object }`

---

## 4. Issue分割案

### 4.1 Issue一覧

Issue-1
番号: 114
Issue名: PRD/Epic/ADR同期（モード撤廃・セッション要約pending）
概要: SoT（PRD/Epic/ADR）を新設計に同期し、以降の実装Issueの前提を固定する
推定行数: N/A（ドキュメント）
依存: -

Issue-2
番号: 115
Issue名: db: セッション要約pending用テーブル追加（confirm/deny/expiry）
概要: `session_summary_items` スキーマ、pending作成、Confirm/Deny、pending 7日失効をテストで固定する
推定行数: 200-400行
依存: #114

Issue-3
番号: 116
Issue名: llm: セッション要約タスク（構造化JSON + 注入/PIIガード）
概要: `Providers["llm"]` の要約タスクを追加し、構造化JSONと安全要件をテストで固定する
推定行数: 150-300行
依存: #114

Issue-4
番号: 117
Issue名: server: ROOM一本でセッション管理 + アイドル5分で要約生成→pending保存
概要: idle 5分でセッションを確定し、要約生成→pending保存までを実装し、ユニット/動的検証で固定する
推定行数: 250-500行
依存: #115, #116

Issue-5
番号: 118
Issue名: api(staff): セッション要約pendingのlist/confirm/deny + SSE更新
概要: セッション要約pendingを一覧/Confirm/Denyでき、SSEで更新が配信されるAPIを実装する
推定行数: 200-400行
依存: #115, #117

Issue-6
番号: 119
Issue名: web(staff): セッション要約pending表示 + Mode表示削除
概要: STAFF画面からMode表示を撤廃し、セッション要約pendingのレビューUIを実装する
推定行数: 150-300行
依存: #118

### 4.2 依存関係図

依存関係（関係を1行ずつ列挙）:

- Issue 115 depends_on Issue 114
- Issue 116 depends_on Issue 114
- Issue 117 depends_on Issue 115
- Issue 117 depends_on Issue 116
- Issue 118 depends_on Issue 115
- Issue 118 depends_on Issue 117
- Issue 119 depends_on Issue 118

---

## 5. プロダクション品質設計（PRD Q6に応じて記載）

### 5.1 パフォーマンス設計（PRD Q6-7: Yesの場合必須）

PRD Q6-7: No
N/A（本Epicでは数値目標を置かない）

### 5.2 セキュリティ設計（PRD Q6-5: Yesの場合必須）

PRD Q6-5: Yes

扱うデータ:

- セッション要約（短文・抽象化・構造化JSON）: 職員Confirmの対象として扱う（pendingは7日失効、confirmedは永続）
- 音声/会話全文/全文STT: 永続保存しない（ログ/トレース/例外にも出さない）

認証/認可:

- 認証方式: 共有パスコード（`STAFF_PASSCODE`） + セッションCookie
- 認可モデル: STAFFセッション必須（KIOSKは不要）
- ネットワーク制限: STAFF系はLAN内IPのみ許可

LAN allowlist（remote address 判定）:

- IPv4 private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- IPv4 loopback: `127.0.0.0/8`
- IPv6 local: `::1`（loopback）, `fc00::/7`（ULA）, `fe80::/10`（link-local）

Trust Proxy（方針）:

- MVPでは reverse proxy を前提にしない
- アクセス制御の判定に `X-Forwarded-For` 等を信頼せず、TCP接続のremote address（サーバが観測する実IP）で判定する

自動ロック / セッション失効:

- 自動ロック: 3分（180_000ms）
- 「無操作」はSTAFF UI上のユーザー操作（キー入力/マウス/タップ等）が無い状態を指す（SSE接続のみは操作に含めない）
- STAFF UIは、ユーザー操作が継続している間だけ keepalive を送る（例: 30秒に1回、操作があった時にスケジュール）
- keepalive がタイムアウト内に届かない場合、サーバはセッションを失効させる

対策チェックリスト:

- [ ] パスコード本文をログに出さない
- [ ] LAN外からのSTAFFアクセスを拒否する
- [ ] 自動ロック（keepaliveが無い場合はセッション失効）
- [ ] 会話本文/音声/STT全文をログに出さない

### 5.3 観測性設計（PRD Q6-6: Yesの場合必須）

PRD Q6-6: No
N/A（監査ログ要件なし）

### 5.4 可用性設計（PRD Q6-8: Yesの場合必須）

PRD Q6-8: No
N/A（SLA/SLOなし。単機ローカル運用を前提）

---

## 6. リスクと対策

リスク-1
リスク: STT/LLMが遅い/失敗する
影響度: 高
対策: タイムアウトを固定し、定型フォールバックへ落として会話を止めない

リスク-2
リスク: 運用上の誤操作（子どもが触る/意図しない送信）
影響度: 高
対策: PTTは hold-to-talk（押下中のみ収録）を前提とし、STAFFの緊急停止により入力/出力を中断できる。STAFF画面はアクセス制御+自動ロック

---

## 7. マイルストーン

Phase-1
フェーズ: Phase 1
完了条件: Orchestrator+Store+APIの枠が揃い、テストで主要フローが固定される
目標日: Unknown

Phase-2
フェーズ: Phase 2
完了条件: STAFFアクセス制御とWeb UIが揃い、現場での最小操作が成立する
目標日: Unknown

---

## 8. 技術方針別の制限チェック

### シンプル優先の場合

- [ ] （更新）外部サービス数では縛らず、許可リスト/タイムアウト/フォールバックで制御できている
- [ ] 新規導入ライブラリが3以下
- [ ] 新規コンポーネント数が3以下
- [ ] 非同期基盤（キュー/イベントストリーム）を使用していない
- [ ] マイクロサービス分割をしていない
- [ ] コンテナオーケストレーション（K8s等）を使用していない

### 共通チェック

- [ ] 新規技術/サービス名が5つ以下
- [ ] 各選択に理由がある
- [ ] 代替案（よりシンプルな方法）が提示されている
- [ ] 必須提出物（外部サービス一覧/コンポーネント一覧/新規技術一覧）が揃っている

---

## 9. Unknown項目の確認（PRDから引き継ぎ）

Unknown-1
項目: 期限
PRDの値: Unknown
確認結果: -

---

## 変更履歴

- 2026-01-31: v1.0 初版作成（migration）
